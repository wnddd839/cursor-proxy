import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodeBuddyRunRequest,
  runCodeBuddyCompletion,
} from "../../codebuddy-provider.mjs";

test("buildCodeBuddyRunRequest creates streaming CodeBuddy cloud chat completions requests", () => {
  const request = buildCodeBuddyRunRequest([
    { role: "system", content: "Be brief." },
    { role: "user", content: [{ type: "text", text: "ping" }] },
  ], {
    baseUrl: "https://www.codebuddy.ai/",
    token: "ck_test_secret",
    headers: { "X-Api-Key": "ck_test_secret" },
    model: "glm-4.7",
  });

  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://www.codebuddy.ai/v2/chat/completions");
  assert.equal(request.headers["X-API-Key"], "ck_test_secret");
  assert.equal(request.headers.authorization, "Bearer ck_test_secret");
  assert.equal(request.headers["x-ide-type"], "CLI");
  assert.equal(request.headers["X-CodeBuddy-Request"], "1");
  assert.equal(request.body.model, "glm-4.7");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.stream_options, undefined);
  assert.deepEqual(request.body.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "ping" },
  ]);
  assert.equal(request.body.text, undefined);
  assert.equal(request.body.sender, undefined);
  assert.equal(request.body.payload, undefined);
});

test("buildCodeBuddyRunRequest defaults to the official auto model", () => {
  const request = buildCodeBuddyRunRequest([{ role: "user", content: "Hi" }], {
    baseUrl: "https://www.codebuddy.ai",
    token: "ck-test",
  });

  assert.equal(request.body.model, "auto");
  assert.deepEqual(request.body.messages, [{ role: "user", content: "Hi" }]);
});

test("buildCodeBuddyRunRequest supports a configured full chat endpoint", () => {
  const request = buildCodeBuddyRunRequest([{ role: "user", content: "Hi" }], {
    baseUrl: "https://www.codebuddy.ai",
    apiEndpoint: "https://copilot.tencent.com/v2/chat/completions",
    headers: { "X-Api-Key": "ck-test" },
  });

  assert.equal(request.url, "https://copilot.tencent.com/v2/chat/completions");
});

test("buildCodeBuddyRunRequest supports a configured chat completions path", () => {
  const request = buildCodeBuddyRunRequest([{ role: "user", content: "Hi" }], {
    baseUrl: "https://www.codebuddy.ai/",
    chatCompletionsPath: "/v1/chat/completions",
    headers: { "X-Api-Key": "ck-test" },
  });

  assert.equal(request.url, "https://www.codebuddy.ai/v1/chat/completions");
});

test("buildCodeBuddyRunRequest preserves chat messages and tool options without prompt shims", () => {
  const tools = [{
    type: "function",
    function: {
      name: "lookup",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    },
  }];
  const request = buildCodeBuddyRunRequest([
    { role: "system", content: [{ type: "text", text: "Keep source messages." }] },
    { role: "user", content: "Find one result." },
    {
      role: "assistant",
      content: [{ type: "text", text: "I will call a tool." }],
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"q\":\"hello\"}" },
      }],
    },
  ], {
    baseUrl: "https://www.codebuddy.ai",
    token: "ck-test",
    tools,
    toolChoice: "auto",
  });

  assert.deepEqual(request.body.messages, [
    { role: "system", content: "Keep source messages." },
    { role: "user", content: "Find one result." },
    {
      role: "assistant",
      content: "I will call a tool.",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"q\":\"hello\"}" },
      }],
    },
  ]);
  assert.deepEqual(request.body.tools, tools);
  assert.equal(request.body.tool_choice, "auto");
  assert.equal(request.body.prompt, undefined);
  assert.equal(request.body.text, undefined);
});

test("runCodeBuddyCompletion streams CodeBuddy cloud requests by default", async () => {
  const calls = [];
  const result = await runCodeBuddyCompletion([
    { role: "user", content: "Hi" },
  ], {
    baseUrl: "https://www.codebuddy.ai",
    headers: { "X-Api-Key": "ck-test" },
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
