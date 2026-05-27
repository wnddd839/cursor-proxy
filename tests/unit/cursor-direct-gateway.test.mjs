import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyDirectCompletionEvents,
  buildDirectAdminHtml,
  buildDirectAdminStatusPayload,
  createAssistantTextAccumulator,
  createConnectFrameParser,
  createDirectMetadataCaches,
  createLegacyDirectAccount,
  extractStringsFromProtobuf,
  getMetadataCache,
  importDirectAccounts,
  invalidateDirectMetadataCaches,
  isDirectAdminAuthorized,
  normalizeDirectModel,
  pickAssistantCandidate,
  pickAssistantText,
  runDirectCompletionWithRetry,
  selectDirectAccount,
  setMetadataCache,
  summarizeCursorAuth,
  summarizeDirectAccount,
} from "../../cursor-direct-gateway.mjs";

function encodeVarint(value) {
  const bytes = [];
  let v = value;
  while (v > 127) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function fieldString(field, value) {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(body.length), body]);
}

function fieldMessage(field, body) {
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(body.length), body]);
}

function connectFrame(payload, flags = 0) {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flags;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function cursorTextDelta(text) {
  return fieldMessage(1, fieldMessage(1, fieldString(1, text)));
}

function cursorThinkingDelta(text) {
  return fieldMessage(1, fieldMessage(4, fieldString(1, text)));
}

function cursorCheckpoint(text) {
  return fieldMessage(3, fieldString(1, text));
}

function cursorTurnEnded() {
  return fieldMessage(1, fieldMessage(14, Buffer.alloc(0)));
}

test("normalizeDirectModel maps public auto alias to Cursor default model id", () => {
  assert.equal(normalizeDirectModel("auto"), "default");
  assert.equal(normalizeDirectModel("cursor/auto"), "default");
  assert.equal(normalizeDirectModel("cursor-acp/composer-2-fast"), "composer-2-fast");
});

test("extractStringsFromProtobuf recursively extracts nested printable strings", () => {
  const nested = fieldMessage(3, fieldString(2, "hello from nested protobuf"));

  assert.deepEqual(
    extractStringsFromProtobuf(nested).map((item) => item.text),
    ["hello from nested protobuf"],
  );
});

test("extractStringsFromProtobuf keeps printable UTF-8 strings", () => {
  const text = "\u4f60\u597d\uff0c\u6211\u5728\u3002";
  const nested = fieldMessage(3, fieldString(2, text));

  assert.deepEqual(
    extractStringsFromProtobuf(nested).map((item) => item.text),
    [text],
  );
});

test("pickAssistantCandidate prefers assistant text over ids, prompt echoes, and blob tokens", () => {
  const strings = [
    { text: "Reply with EXACTLY DIRECT_SMOKE_DONE and no other text.", fieldPath: "1.2", depth: 2, frameIndex: 1 },
    { text: "002dbce7782aa0c8", fieldPath: "1.3", depth: 2, frameIndex: 7 },
    { text: "VE5kj24OBQInX4jurLZONalbmV_W7ionyd8U9JluP-Gye2y8K0Z2R_dJqUk_WSQstOB0oA9nH8X-gX4l", fieldPath: "1.4", depth: 2, frameIndex: 9 },
    { text: "cli", fieldPath: "1.4", depth: 4, frameIndex: 12 },
    { text: "DIRECT_SMOKE_DONE", fieldPath: "1.5", depth: 2, frameIndex: 8 },
  ];

  assert.equal(
    pickAssistantCandidate(strings, {
      prompt: "Reply with EXACTLY DIRECT_SMOKE_DONE and no other text.",
      model: "composer-2-fast",
    }),
    "DIRECT_SMOKE_DONE",
  );
});

test("pickAssistantText prefers non-ASCII assistant text over short protocol labels", () => {
  const assistantText = "\u4f60\u597d\uff01\u6211\u53ef\u4ee5\u6b63\u5e38\u7528\u4e2d\u6587\u56de\u590d\u3002";
  const strings = [
    { text: "CLAUDE.md", fieldPath: "1.2", depth: 2, frameIndex: 1 },
    { text: "The user greets me with a short hello.", fieldPath: "1.3", depth: 2, frameIndex: 1 },
    { text: assistantText, fieldPath: "1.5", depth: 2, frameIndex: 2 },
  ];

  assert.equal(pickAssistantText(strings, { model: "composer-2-fast" }), assistantText);
});

test("pickAssistantText drops language directive fragments and joins CJK without inserted spaces", () => {
  const strings = [
    { text: "\"\" in Chinese.", fieldPath: "1.2", depth: 2, frameIndex: 1 },
    { text: "\u8001\u5927", fieldPath: "1.5", depth: 2, frameIndex: 2 },
    { text: "\u4f60\u597d", fieldPath: "1.5", depth: 2, frameIndex: 3 },
    { text: "\u6211\u662f", fieldPath: "1.5", depth: 2, frameIndex: 4 },
    { text: "\u4f60\u7684", fieldPath: "1.5", depth: 2, frameIndex: 5 },
    { text: "\u7f16\u7a0b\u52a9\u624b", fieldPath: "1.5", depth: 2, frameIndex: 6 },
  ];

  assert.equal(
    pickAssistantText(strings, { model: "composer-2-fast" }),
    "\u8001\u5927\u4f60\u597d\u6211\u662f\u4f60\u7684\u7f16\u7a0b\u52a9\u624b",
  );
});

test("pickAssistantText merges assistant fragments across response frames", () => {
  const strings = [
    { text: "Write a short greeting", fieldPath: "1.2", depth: 2, frameIndex: 0 },
    { text: "Hello", fieldPath: "1.5", depth: 2, frameIndex: 1 },
    { text: "world", fieldPath: "1.5", depth: 2, frameIndex: 2 },
    { text: "002dbce7782aa0c8", fieldPath: "1.3", depth: 2, frameIndex: 3 },
  ];

  assert.equal(
    pickAssistantText(strings, {
      prompt: "Write a short greeting",
      model: "composer-2-fast",
    }),
    "Hello world",
  );
});

test("pickAssistantText handles cumulative assistant snapshots", () => {
  const strings = [
    { text: "Hello", fieldPath: "1.5", depth: 2, frameIndex: 1 },
    { text: "Hello world", fieldPath: "1.5", depth: 2, frameIndex: 2 },
  ];

  assert.equal(pickAssistantText(strings, { model: "composer-2-fast" }), "Hello world");
});

test("pickAssistantText ignores punctuation-only protocol fragments", () => {
  const strings = [
    { text: "1,2,3,4,5", fieldPath: "1.5", depth: 2, frameIndex: 1 },
    { text: ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,", fieldPath: "1.5", depth: 2, frameIndex: 20 },
  ];

  assert.equal(pickAssistantText(strings, { model: "composer-2-fast" }), "1,2,3,4,5");
});

test("extractStringsFromProtobuf stops on invalid varints instead of scanning forever", () => {
  const invalid = Buffer.alloc(20000, 0x80);

  assert.deepEqual(extractStringsFromProtobuf(invalid), []);
});

test("createConnectFrameParser emits strings from partial connect frames", () => {
  const frame = connectFrame(cursorTextDelta("streamed hello"));
  const parser = createConnectFrameParser();

  assert.deepEqual(parser.push(frame.subarray(0, 3)), []);
  assert.deepEqual(
    parser.push(frame.subarray(3)).map((item) => item.text),
    ["streamed hello"],
  );
  assert.equal(parser.finish().pendingBytes, 0);
});

test("createConnectFrameParser emits only Cursor text deltas and ignores protocol strings", () => {
  const frame = connectFrame(Buffer.concat([
    cursorCheckpoint("CLAUDE.md"),
    cursorThinkingDelta("The user greets me with a short hello."),
    cursorTextDelta("\u4f60\u597d\uff0c\u6211\u662f Cursor\u3002"),
  ]));
  const parser = createConnectFrameParser();

  assert.deepEqual(
    parser.push(frame).map((item) => item.text),
    ["\u4f60\u597d\uff0c\u6211\u662f Cursor\u3002"],
  );
});

test("createConnectFrameParser raises Connect trailer errors instead of treating them as text", () => {
  const parser = createConnectFrameParser();
  const trailer = Buffer.from(JSON.stringify({
    error: {
      code: "resource_exhausted",
      message: "quota exceeded",
    },
  }));

  assert.throws(
    () => parser.push(connectFrame(trailer, 0x02)),
    /Cursor direct Connect error resource_exhausted: quota exceeded/,
  );
});

test("createConnectFrameParser emits Connect end-stream control events", () => {
  const parser = createConnectFrameParser();
  const events = parser.push(connectFrame(Buffer.from("{}"), 0x02));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "connect_end");
});

test("createConnectFrameParser emits Cursor turn-ended control events by default", () => {
  const parser = createConnectFrameParser();
  const events = parser.push(connectFrame(cursorTurnEnded()));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "turn_ended");
});

test("applyDirectCompletionEvents emits text deltas and reports turn-ended", () => {
  const accumulator = createAssistantTextAccumulator();
  const emitted = [];

  const result = applyDirectCompletionEvents([
    { type: "text_delta", text: "OK", frameIndex: 1, eventIndex: 0 },
    { type: "turn_ended", frameIndex: 1, eventIndex: 1 },
  ], {
    accumulator,
    onDelta: (delta) => emitted.push(delta),
  });

  assert.deepEqual(emitted, ["OK"]);
  assert.equal(accumulator.text, "OK");
  assert.equal(result.textEventCount, 1);
  assert.equal(result.deltaCount, 1);
  assert.equal(result.turnEnded, true);
});

test("applyDirectCompletionEvents appends Cursor text deltas without inserted spaces", () => {
  const accumulator = createAssistantTextAccumulator();
  const result = applyDirectCompletionEvents([
    { type: "text_delta", text: "D", frameIndex: 1, eventIndex: 0 },
    { type: "text_delta", text: "IRECT", frameIndex: 2, eventIndex: 0 },
    { type: "text_delta", text: "_ADMIN", frameIndex: 3, eventIndex: 0 },
    { type: "text_delta", text: "_OK", frameIndex: 4, eventIndex: 0 },
    { type: "connect_end", frameIndex: 5, eventIndex: 0 },
  ], {
    accumulator,
  });

  assert.equal(accumulator.text, "DIRECT_ADMIN_OK");
  assert.equal(result.textEventCount, 4);
  assert.equal(result.connectEnded, true);
});

test("metadata caches clone values and invalidate together", () => {
  const caches = createDirectMetadataCaches();
  const value = setMetadataCache(caches.models, [{ id: "auto" }], { now: 1000, ttlMs: 5000 });
  value[0].id = "mutated";

  assert.deepEqual(getMetadataCache(caches.models, { now: 2000 }), [{ id: "auto" }]);

  invalidateDirectMetadataCaches(caches);

  assert.equal(getMetadataCache(caches.models, { now: 2000 }), null);
});

test("runDirectCompletionWithRetry retries another account before first payload", async () => {
  const selected = [];
  const accounts = [
    { id: "first", accessToken: "token-1" },
    { id: "second", accessToken: "token-2" },
  ];
  const result = await runDirectCompletionWithRetry("hello", "default", {
    maxAttempts: 2,
    idleMs: 1234,
    selectAccount: async () => {
      const account = accounts[selected.length];
      selected.push(account.id);
      return { source: "pool", account, store: { accounts }, index: selected.length - 1 };
    },
    runAttempt: async (_prompt, _model, options) => {
      assert.equal(options.idleMs, 1234);
      if (options.account.id === "first") {
        const error = new Error("socket hang up");
        error.beforeFirstPayload = true;
        throw error;
      }
      return { text: "ok", durationMs: 10, bytes: 2, stringCount: 1 };
    },
    markResult: () => {},
  });

  assert.deepEqual(selected, ["first", "second"]);
  assert.equal(result.text, "ok");
  assert.equal(result.accountId, "second");
});

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

test("summarizeCursorAuth masks credentials and exposes account metadata", () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const auth = {
    accessToken: fakeJwt({
      exp,
      email: "cursor-user@example.com",
      sub: "user_123",
    }),
    refreshToken: "refresh-token-secret",
  };

  const summary = summarizeCursorAuth(auth, { authPath: "/tmp/auth.json" });

  assert.equal(summary.loggedIn, true);
  assert.equal(summary.email, "cursor-user@example.com");
  assert.equal(summary.subject, "user_123");
  assert.equal(summary.authPath, "/tmp/auth.json");
  assert.equal(summary.hasRefreshToken, true);
  assert.match(summary.accessTokenPreview, /^eyJ.+\.\.\.nature$/);
  assert.equal(summary.refreshTokenPreview, "refres...secret");
  assert.equal(summary.accessToken, undefined);
  assert.equal(summary.refreshToken, undefined);
  assert.ok(summary.accessTokenExpiresAt > Date.now());
});

test("buildDirectAdminHtml uses the direct admin API prefix and NewAPI base path", () => {
  const page = buildDirectAdminHtml();

  assert.match(page, /Cursor Direct/);
  assert.match(page, /\/direct-admin\/api/);
  assert.match(page, /\/v1/);
  assert.match(page, /\/accounts\/import/);
  assert.match(page, /\/oauth\/start/);
  assert.match(page, /账号池/);
  assert.doesNotMatch(page, /cursor_gateway_admin_password/);
});

test("buildDirectAdminStatusPayload includes direct runtime fields for the admin dashboard", () => {
  const payload = buildDirectAdminStatusPayload();

  assert.equal(payload.mode, "cursor-direct");
  assert.equal(payload.adminPath, "/direct-admin/");
  assert.equal(payload.apiBasePath, "/v1");
  assert.equal(typeof payload.memory.rss, "number");
  assert.equal(typeof payload.stats.averageDurationMs, "number");
  assert.equal(typeof payload.authRequired, "boolean");
});

test("importDirectAccounts imports multiple accounts and summaries never expose full tokens", () => {
  const store = { version: 1, nextIndex: 0, accounts: [] };
  const accounts = [
    { label: "alpha", accessToken: fakeJwt({ email: "a@example.com", sub: "sub_a" }), refreshToken: "refresh-alpha-secret" },
    { label: "beta", accessToken: fakeJwt({ email: "b@example.com", sub: "sub_b" }), refreshToken: "refresh-beta-secret" },
  ];

  const result = importDirectAccounts(store, accounts, { now: 1000 });

  assert.equal(result.store.accounts.length, 2);
  assert.equal(result.summaries.length, 2);
  assert.equal(result.summaries[0].email, "a@example.com");
  assert.equal(result.summaries[0].accessToken, undefined);
  assert.equal(result.summaries[0].refreshToken, undefined);
  assert.notEqual(result.summaries[0].accessTokenPreview, accounts[0].accessToken);
  assert.notEqual(result.summaries[0].refreshTokenPreview, accounts[0].refreshToken);
});

test("selectDirectAccount skips disabled accounts and rotates enabled accounts", () => {
  const store = importDirectAccounts(
    { version: 1, nextIndex: 0, accounts: [] },
    [
      { label: "disabled", accessToken: fakeJwt({ email: "off@example.com", sub: "off" }), refreshToken: "refresh-off", enabled: false },
      { label: "one", accessToken: fakeJwt({ email: "one@example.com", sub: "one" }), refreshToken: "refresh-one" },
      { label: "two", accessToken: fakeJwt({ email: "two@example.com", sub: "two" }), refreshToken: "refresh-two" },
    ],
    { now: 1000 },
  ).store;

  const first = selectDirectAccount(store, { now: 2000 });
  const second = selectDirectAccount(first.store, { now: 3000 });
  const third = selectDirectAccount(second.store, { now: 4000 });

  assert.equal(first.account.label, "one");
  assert.equal(second.account.label, "two");
  assert.equal(third.account.label, "one");
});

test("selectDirectAccount can use a legacy auth file account when pool is empty", () => {
  const legacy = createLegacyDirectAccount(
    { accessToken: fakeJwt({ email: "legacy@example.com", sub: "legacy_sub" }), refreshToken: "legacy-refresh" },
    { authPath: "/tmp/auth.json", now: 1000 },
  );

  const selected = selectDirectAccount({ version: 1, nextIndex: 0, accounts: [] }, { legacyAccount: legacy });

  assert.equal(selected.account.id, "legacy-auth");
  assert.equal(summarizeDirectAccount(selected.account).email, "legacy@example.com");
});

test("isDirectAdminAuthorized rejects missing admin password and accepts the configured header", () => {
  assert.equal(isDirectAdminAuthorized({ headers: {} }, "secret"), false);
  assert.equal(isDirectAdminAuthorized({ headers: { "x-admin-password": "secret" } }, "secret"), true);
  assert.equal(isDirectAdminAuthorized({ headers: { authorization: "Bearer secret" } }, "secret"), true);
});

test("nginx configs send legacy admin entrypoints to the direct admin console", () => {
  const configs = [
    readFileSync(new URL("../../deploy/cursor-nginx.conf", import.meta.url), "utf8"),
    readFileSync(new URL("../../deploy/cursor-nginx.docker.conf", import.meta.url), "utf8"),
  ];

  for (const nginx of configs) {
    assert.match(nginx, /location = \/ \{\s*return 302 \/direct-admin\/;\s*\}/);
    assert.match(nginx, /location = \/admin \{\s*return 301 \/direct-admin\/;\s*\}/);
    assert.match(nginx, /location = \/admin\/ \{\s*return 301 \/direct-admin\/;\s*\}/);
    assert.match(nginx, /location = \/admin-preview \{\s*return 301 \/direct-admin\/;\s*\}/);
    assert.match(nginx, /location = \/admin-preview\/ \{\s*return 301 \/direct-admin\/;\s*\}/);
    assert.doesNotMatch(nginx, /proxy_pass http:\/\/127\.0\.0\.1:32125/);
  }
});

test("deployment examples expose direct gateway streaming cache and parse knobs", () => {
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../../deploy/install-cursor-direct-gateway.sh", import.meta.url), "utf8");
  const requiredKeys = [
    "CURSOR_DIRECT_STREAM_KEEPALIVE_MS",
    "CURSOR_DIRECT_MODELS_CACHE_TTL_MS",
    "CURSOR_DIRECT_AUTH_CACHE_TTL_MS",
    "CURSOR_DIRECT_OAUTH_CACHE_TTL_MS",
    "CURSOR_DIRECT_PARSE_MAX_TOTAL_BYTES",
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(`${key}=`));
    assert.match(installer, new RegExp(key));
  }
});
