import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCursorAgentArgs,
  extractCursorLoginUrl,
  parseCursorAboutOutput,
  parseCursorLoginStatus,
} from "../../cursor-gateway.mjs";

test("extractCursorLoginUrl returns the loginDeepControl URL from wrapped CLI output", () => {
  const output = [
    "Starting login process...",
    "Open a browser and navigate to this link:",
    "https://cursor.com/loginDeepControl?challenge=abc",
    "  &uuid=123&mode=login&redirectTarget=cli",
  ].join("\n");

  assert.equal(
    extractCursorLoginUrl(output),
    "https://cursor.com/loginDeepControl?challenge=abc&uuid=123&mode=login&redirectTarget=cli",
  );
});

test("parseCursorLoginStatus detects unauthenticated status", () => {
  assert.deepEqual(parseCursorLoginStatus("Not logged in"), {
    loggedIn: false,
    message: "Not logged in",
  });
});

test("parseCursorAboutOutput extracts account fields", () => {
  const about = [
    "About Cursor CLI",
    "",
    "CLI Version         2026.05.24-dda726e",
    "Model               Auto",
    "Subscription Tier   Pro",
    "OS                  linux (x64)",
    "Terminal            unknown",
    "Shell               bash",
    "User Email          user@example.com",
  ].join("\n");

  assert.deepEqual(parseCursorAboutOutput(about), {
    cliVersion: "2026.05.24-dda726e",
    model: "Auto",
    subscriptionTier: "Pro",
    os: "linux (x64)",
    userEmail: "user@example.com",
  });
});

test("buildCursorAgentArgs trusts the configured workspace for headless calls", () => {
  const args = buildCursorAgentArgs("auto", { stream: true });

  assert.ok(args.includes("--print"));
  assert.ok(args.includes("--trust"));
});

test("buildCursorAgentArgs uses json output for non-stream requests", () => {
  const args = buildCursorAgentArgs("auto", { stream: false });

  assert.equal(args[args.indexOf("--output-format") + 1], "json");
  assert.equal(args.includes("--stream-partial-output"), false);
});

test("buildCursorAgentArgs uses stream-json output for streaming requests", () => {
  const args = buildCursorAgentArgs("auto", { stream: true });

  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(args.includes("--stream-partial-output"));
});
