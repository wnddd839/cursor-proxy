import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCursorAgentArgs,
  extractCursorLoginUrl,
  parseCursorAboutOutput,
  parseCursorLoginStatus,
} from "../../cursor-gateway.mjs";
import { buildDirectAdminHtml } from "../../direct-admin-page.mjs";

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

test("direct admin renders a masked API key copy control", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /id="apiKeyDisplay"/);
  assert.match(html, /type="password"/);
  assert.match(html, /id="copyApiKeyBtn"/);
  assert.doesNotMatch(html, /id="apiKeyPreview"/);
});

test("direct admin copies Base URL from page state instead of a transient input fallback", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /clientBaseUrl:/);
  assert.match(html, /function resolveBaseUrl/);
  assert.match(html, /state\.clientBaseUrl/);
  assert.doesNotMatch(html, /baseUrlInput'\)\.value \|\|/);
});

test("direct admin renders the dashboard header and runtime chips", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /class="dashboard-header"/);
  assert.match(html, /id="runtimeChips"/);
  assert.match(html, /CURSOR DIRECT GATEWAY/);
  assert.match(html, /OAuth/);
});

test("direct admin topbar exists with sticky positioning in CSS", () => {
  const html = buildDirectAdminHtml();

  // topbar element present
  assert.match(html, /class="topbar/);
  // sticky position defined in shared styles
  assert.match(html, /position:\s*sticky/);
});

test("direct admin renders metric-grid with metric cards", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /class="metric-grid"/);
  assert.match(html, /class="metric"/);
  assert.match(html, /id="metricTotal"/);
  assert.match(html, /id="metricEnabled"/);
  assert.match(html, /id="metricDisabled"/);
  assert.match(html, /id="metricLatency"/);
  assert.match(html, /id="metricRequests"/);
  assert.match(html, /id="metricBaseUrl"/);
});

test("direct admin has masked API key control (non-regression)", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /id="apiKeyDisplay"/);
  assert.match(html, /type="password"/);
  assert.match(html, /id="copyApiKeyBtn"/);
  assert.doesNotMatch(html, /id="apiKeyPreview"/);
});

test("direct admin defines resolveBaseUrl and state.clientBaseUrl", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /function resolveBaseUrl/);
  assert.match(html, /clientBaseUrl:/);
  assert.match(html, /state\.clientBaseUrl/);
});

test("direct admin renders import tabs with three modes (single, batch, oauth)", () => {
  const html = buildDirectAdminHtml();

  // tab structure
  assert.match(html, /class="import-tabs"/);
  assert.match(html, /id="importTabs"/);
  // three tab buttons
  assert.match(html, /data-tab="single"/);
  assert.match(html, /data-tab="batch"/);
  assert.match(html, /data-tab="oauth"/);
  // three tab panes
  assert.match(html, /id="importPaneSingle"/);
  assert.match(html, /id="importPaneBatch"/);
  assert.match(html, /id="importPaneOAuth"/);
});

test("direct admin renders probe result area", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /class="probe-result"/);
  assert.match(html, /id="probeBox"/);
  assert.match(html, /id="probeModel"/);
  assert.match(html, /id="probeBtn"/);
});

test("direct admin renders advanced debug details panel", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /<details class="advanced-panel"/);
  assert.match(html, /<summary>高级调试信息<\/summary>/);
  assert.match(html, /id="debugStatus"/);
  assert.match(html, /id="debugAccounts"/);
  assert.match(html, /id="debugOAuth"/);
});

test("direct admin renders the CodeBuddy management panel structure", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /id="codebuddyPanel"/);
  assert.match(html, /CodeBuddy Provider/);
  assert.match(html, /id="codebuddyConfigPill"/);
  assert.match(html, /id="codebuddyAuthPill"/);
  assert.match(html, /id="codebuddyBaseUrl"/);
  assert.match(html, /id="codebuddyAccountSummary"/);
  assert.match(html, /id="codebuddyAccountRows"/);
  assert.match(html, /id="codebuddyModelRows"/);
  assert.match(html, /id="codebuddyImportTabs"/);
  assert.match(html, /data-cb-tab="single"/);
  assert.match(html, /data-cb-tab="batch"/);
  assert.match(html, /id="cbImportAuthToken"/);
  assert.match(html, /id="cbImportApiKey"/);
  assert.match(html, /id="cbImportApiKeyHelper"/);
  assert.match(html, /id="cbImportBaseUrl"/);
  assert.match(html, /id="cbImportInternetEnv"/);
  assert.match(html, /id="cbProbeBtn"/);
  assert.match(html, /id="cbProbeBox"/);
});

test("direct admin wires CodeBuddy state and refresh logic", () => {
  const html = buildDirectAdminHtml();

  // state slot
  assert.match(html, /codebuddy:\s*\{/);
  assert.match(html, /importMode:\s*'single'/);
  assert.match(html, /unsupported:\s*false/);
  // core helpers exist
  assert.match(html, /function refreshCodeBuddy/);
  assert.match(html, /function renderCodeBuddy\b/);
  assert.match(html, /function importCodeBuddyAccounts/);
  assert.match(html, /function codeBuddyAccountAction/);
  assert.match(html, /function runCodeBuddyProbe/);
  assert.match(html, /function loadCodeBuddyModels/);
  // hits the documented backend routes
  assert.match(html, /\/codebuddy\/status/);
  assert.match(html, /\/codebuddy\/accounts/);
  assert.match(html, /\/codebuddy\/accounts\/import/);
  assert.match(html, /\/codebuddy\/models/);
  assert.match(html, /\/codebuddy\/probe/);
  // setActiveView hooks the codebuddy refresh, but normal Cursor refresh stays scoped
  assert.match(html, /refreshCodeBuddy\(true\)/);
  assert.doesNotMatch(html, /renderAll\(\);\s*try\s*\{\s*await refreshCodeBuddy\(true\);/);
});

test("direct admin handles missing CodeBuddy backend routes gracefully", () => {
  const html = buildDirectAdminHtml();

  assert.match(html, /error\.status = response\.status/);
  assert.match(html, /statusRes\.__error\.status === 404/);
  assert.match(html, /CodeBuddy 后端管理接口未启用/);
  assert.match(html, /CodeBuddy 后端模型接口尚未启用/);
  assert.match(html, /当前仅保留前端视图入口/);
});

test("direct admin renders the view nav and view containers", () => {
  const html = buildDirectAdminHtml();

  // Topbar nav present
  assert.match(html, /class="view-nav"/);
  assert.match(html, /id="viewNav"/);
  assert.match(html, /class="view-tab active" data-view="cursor"/);
  assert.match(html, /data-view="codebuddy"/);
  assert.match(html, /Cursor Direct<\/button>/);
  assert.match(html, /CodeBuddy<\/button>/);
  // View containers wrap dashboard / codebuddy panels
  assert.match(html, /id="cursorView"/);
  assert.match(html, /id="codebuddyView" class="hidden"/);
});

test("direct admin wires setActiveView with hash deep linking", () => {
  const html = buildDirectAdminHtml();

  // state slot for active view
  assert.match(html, /activeView:\s*'cursor'/);
  // function definition
  assert.match(html, /function setActiveView/);
  // hash deep link via history.replaceState + hashchange
  assert.match(html, /history\.replaceState\(null, '', '#' \+ view\)/);
  assert.match(html, /addEventListener\('hashchange'/);
  // skipRefresh used during initial bootstrap
  assert.match(html, /skipRefresh:\s*true/);
});

test("direct admin keeps recent manual style edits intact", () => {
  const html = buildDirectAdminHtml();

  // radius-lg is now 8px (not 12px)
  assert.match(html, /--radius-lg:\s*8px/);
  assert.doesNotMatch(html, /--radius-lg:\s*12px/);
  // metric .value letter-spacing reset to 0
  assert.match(html, /\.metric \.value\s*\{[\s\S]*?letter-spacing:\s*0;/);
  // pulse-once helpers removed
  assert.doesNotMatch(html, /pulse-once/);
  assert.doesNotMatch(html, /pulseElement/);
});
