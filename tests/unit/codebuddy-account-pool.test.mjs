import test from "node:test";
import assert from "node:assert/strict";

import {
  createCodeBuddyAccount,
  resolveCodeBuddyAccountHeaders,
  summarizeCodeBuddyAccount,
} from "../../codebuddy-account-pool.mjs";

test("CodeBuddy daemon OAuth accounts are selectable without raw credentials", async () => {
  const account = createCodeBuddyAccount({
    label: "CodeBuddy OAuth",
    source: "oauth",
    authType: "daemon",
    baseUrl: "http://127.0.0.1:8080",
    authStatus: {
      loggedIn: true,
      authMode: "daemon_oauth",
    },
  });

  const summary = summarizeCodeBuddyAccount(account);
  assert.equal(summary.authType, "daemon");
  assert.equal(summary.hasCredentials, true);
  assert.equal(summary.loggedIn, true);

  const headers = await resolveCodeBuddyAccountHeaders(account);
  assert.equal(headers["x-codebuddy-request"], "1");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-api-key"], undefined);
});
