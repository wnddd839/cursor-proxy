import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodeBuddyOAuthAccountFromTokenData,
  pollCodeBuddyPluginAuth,
  startCodeBuddyPluginAuth,
} from "../../codebuddy-oauth.mjs";

test("startCodeBuddyPluginAuth parses auth state and login url", async () => {
  const result = await startCodeBuddyPluginAuth({
    site: "global",
    fetchImpl: async (url, init) => {
      assert.match(url, /\/v2\/plugin\/auth\/state/);
      assert.equal(init.method, "POST");
      return new Response(JSON.stringify({
        code: 0,
        data: { state: "state-abc", authUrl: "https://www.codebuddy.ai/login?state=state-abc" },
      }), { status: 200 });
    },
  });

  assert.equal(result.authState, "state-abc");
  assert.match(result.authUrl, /login/);
});

test("pollCodeBuddyPluginAuth returns pending then success", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ code: 11217, msg: "login ing..." }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 0,
      data: {
        accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImVtYWlsIjoidUBleC5jb20ifQ.sig",
        expiresIn: 3600,
        refreshToken: "rt-1",
      },
    }), { status: 200 });
  };

  const pending = await pollCodeBuddyPluginAuth({ authState: "state-abc", fetchImpl });
  assert.equal(pending.status, "pending");

  const success = await pollCodeBuddyPluginAuth({ authState: "state-abc", fetchImpl });
  assert.equal(success.status, "success");
  assert.match(success.tokenData.bearerToken, /^eyJ/);

  const account = buildCodeBuddyOAuthAccountFromTokenData(success.tokenData, { site: "global" });
  assert.equal(account.bearerToken, success.tokenData.bearerToken);
  assert.equal(account.site, "global");
});
