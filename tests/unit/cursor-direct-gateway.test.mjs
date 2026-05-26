import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectAdminHtml,
  buildDirectAdminStatusPayload,
  extractStringsFromProtobuf,
  normalizeDirectModel,
  pickAssistantCandidate,
  summarizeCursorAuth,
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
