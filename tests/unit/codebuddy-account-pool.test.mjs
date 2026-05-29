import test from "node:test";
import assert from "node:assert/strict";

import {
  createCodeBuddyAccount,
  importCodeBuddyAccounts,
  resolveCodeBuddyAccountHeaders,
  summarizeCodeBuddyAccount,
} from "../../codebuddy-account-pool.mjs";
import {
  buildCodeBuddyRunRequest,
  runCodeBuddyCompletion,
} from "../../codebuddy-provider.mjs";

test("CodeBuddy apiKey accounts resolve to api-key headers", async () => {
  const account = createCodeBuddyAccount({
    label: "CodeBuddy API Key",
    site: "global",
    apiKey: "sk-codebuddy-secret",
  });

  const summary = summarizeCodeBuddyAccount(account);
  assert.equal(summary.authType, "api_key");
  assert.equal(summary.hasCredentials, true);
  assert.equal(summary.site, "global");
  assert.equal(summary.baseUrl, "https://www.codebuddy.ai");
  assert.notEqual(summary.apiKeyPreview, "sk-codebuddy-secret");

  const headers = await resolveCodeBuddyAccountHeaders(account);
  assert.equal(headers["X-API-Key"], "sk-codebuddy-secret");
  assert.equal(headers["X-CodeBuddy-Request"], "1");
  assert.equal(headers.authorization, "Bearer sk-codebuddy-secret");
  assert.ok(headers["x-conversation-id"]);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["X-CodeBuddy-Request"], "1");
});

test("CodeBuddy domestic apiKey accounts use the China cloud endpoint", async () => {
  const account = createCodeBuddyAccount({
    label: "CodeBuddy CN API Key",
    site: "domestic",
    apiKey: "ck-cn-secret",
  });

  const summary = summarizeCodeBuddyAccount(account);
  assert.equal(summary.site, "domestic");
  assert.equal(summary.internetEnvironment, "domestic");
  assert.equal(summary.baseUrl, "https://www.codebuddy.cn");

  const headers = await resolveCodeBuddyAccountHeaders(account);
  assert.equal(headers.authorization, "Bearer ck-cn-secret");
  assert.equal(headers["X-API-Key"], "ck-cn-secret");
  assert.equal(headers["x-ide-type"], "CLI");
  assert.equal(headers["x-product"], "SaaS");
});

test("CodeBuddy old token and cookie credentials are ignored without an apiKey", async () => {
  const account = createCodeBuddyAccount({
    label: "CodeBuddy Legacy",
    baseUrl: "https://www.codebuddy.ai",
    authToken: "7628910558898046500",
    refreshToken: "refresh-token-value",
    cookie: "codebuddy_session=secret",
    apiKeyHelper: "echo secret",
  });

  const summary = summarizeCodeBuddyAccount(account);
  assert.equal(summary.authType, "");
  assert.equal(summary.hasCredentials, false);
  assert.equal(summary.authTokenPreview, "");
  assert.equal(summary.refreshTokenPreview, "");
  assert.equal(summary.cookiePreview, "");

  await assert.rejects(
    resolveCodeBuddyAccountHeaders(account),
    /has no credentials/i,
  );
});

test("CodeBuddy import only accepts apiKey payloads", () => {
  const emptyResult = importCodeBuddyAccounts(
    { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] },
    { label: "No Key", authToken: "auth-token", refreshToken: "refresh-token", cookie: "codebuddy_session=secret" },
  );
  assert.equal(emptyResult.imported.length, 0);

  const result = importCodeBuddyAccounts(
    { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] },
    { label: "API Key Import", site: "domestic", apiKey: "sk-import-secret" },
  );
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].apiKey, "sk-import-secret");
  assert.equal(result.imported[0].authType, "api_key");
  assert.equal(result.imported[0].site, "domestic");
  assert.equal(result.imported[0].baseUrl, "https://www.codebuddy.cn");

  const jsonResult = importCodeBuddyAccounts(
    { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] },
    JSON.stringify({ accounts: [{ label: "JSON Key", apiKey: "sk-json-secret" }] }),
  );
  assert.equal(jsonResult.imported.length, 1);
  assert.equal(jsonResult.imported[0].apiKey, "sk-json-secret");
});

test("CodeBuddy apiKey accounts preserve an optional full apiEndpoint", () => {
  const account = createCodeBuddyAccount({
    label: "CodeBuddy Internal API Key",
    site: "domestic",
    apiKey: "ck-internal-secret",
    apiEndpoint: "https://copilot.tencent.com/v2/chat/completions",
  });

  assert.equal(account.apiEndpoint, "https://copilot.tencent.com/v2/chat/completions");
  assert.equal(summarizeCodeBuddyAccount(account).apiEndpoint, "https://copilot.tencent.com/v2/chat/completions");

  const result = importCodeBuddyAccounts(
    { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] },
    { label: "API Endpoint Import", apiKey: "sk-import-endpoint", apiEndpoint: "https://example.test/v1/chat/completions" },
  );

  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].apiEndpoint, "https://example.test/v1/chat/completions");
});

test("CodeBuddy imported apiKey accounts resolve headers and forward raw messages", async () => {
  const imported = importCodeBuddyAccounts(
    { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] },
    {
      label: "Raw JSON Import",
      site: "global",
      apiKey: "ck-import-secret",
      apiEndpoint: "https://www.codebuddy.ai/v2/chat/completions",
    },
  ).imported[0];

  const headers = await resolveCodeBuddyAccountHeaders(imported);
  assert.equal(headers.authorization, "Bearer ck-import-secret");
  assert.equal(headers["X-API-Key"], "ck-import-secret");

  const calls = [];
  const result = await runCodeBuddyCompletion([
    { role: "system", content: [{ type: "text", text: "Keep this." }] },
    { role: "user", content: "Ping" },
  ], {
    apiEndpoint: imported.apiEndpoint,
    headers,
    model: "auto",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      assert.deepEqual(body.messages, [
        { role: "system", content: "Keep this." },
        { role: "user", content: "Ping" },
      ]);
      assert.deepEqual(body.tools, undefined);
      return new Response([
        'data: {"choices":[{"delta":{"content":"pong"},"finish_reason":null}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.codebuddy.ai/v2/chat/completions");
  assert.equal(result.turn.text, "pong");
});

test("CodeBuddy cloud requests use chat completions format", async () => {
  const request = buildCodeBuddyRunRequest([{ role: "user", content: "Say hello" }], {
    baseUrl: "https://www.codebuddy.cn",
    token: "ck_test_secret",
    headers: { "X-Api-Key": "ck_test_secret" },
  });

  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://www.codebuddy.cn/v2/chat/completions");
  assert.equal(request.headers["X-API-Key"], "ck_test_secret");
  assert.equal(request.headers.authorization, "Bearer ck_test_secret");
  assert.equal(request.headers["X-CodeBuddy-Request"], "1");
  assert.deepEqual(request.body.messages, [
    { role: "user", content: "Say hello" },
  ]);
  assert.equal(request.body.model, "auto");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.stream_options, undefined);
  assert.equal(request.body.text, undefined);
  assert.equal(request.body.sender, undefined);
});

test("CodeBuddy cloud completion streams by default on the official auto model", async () => {
  const calls = [];
  const result = await runCodeBuddyCompletion([{ role: "user", content: "Hi" }], {
    baseUrl: "https://www.codebuddy.ai",
    headers: { "X-Api-Key": "ck-test" },
    model: "auto",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      assert.equal(body.stream_options, undefined);
      return new Response([
        'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.codebuddy.ai/v2/chat/completions");
  assert.equal(result.turn.text, "hello");
});

test("CodeBuddy bearer OAuth accounts resolve cloud headers without X-API-Key", async () => {
  const account = createCodeBuddyAccount({
    label: "OAuth User",
    site: "global",
    bearerToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig",
  });

  assert.equal(account.authType, "bearer");
  const headers = await resolveCodeBuddyAccountHeaders(account);
  assert.match(headers.authorization, /^Bearer eyJ/);
  assert.equal(headers["X-API-Key"], undefined);
  assert.equal(headers["X-CodeBuddy-Request"], "1");
});

test("CodeBuddy apiKeyHelper and daemon-style accounts are not treated as usable credentials", async () => {
  const helperAccount = createCodeBuddyAccount({
    label: "CodeBuddy Helper",
    apiKeyHelper: "echo helper-token",
  });
  const daemonAccount = createCodeBuddyAccount({
    label: "CodeBuddy Daemon",
    useDaemonAuth: true,
  });

  assert.equal(summarizeCodeBuddyAccount(helperAccount).hasCredentials, false);
  assert.equal(summarizeCodeBuddyAccount(daemonAccount).hasCredentials, false);
  await assert.rejects(resolveCodeBuddyAccountHeaders(helperAccount), /has no credentials/i);
  await assert.rejects(resolveCodeBuddyAccountHeaders(daemonAccount), /has no credentials/i);
});
