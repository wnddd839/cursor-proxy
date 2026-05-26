#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MODELS = [
  { id: "auto", name: "Auto" },
  { id: "composer-1.5", name: "Composer 1.5" },
  { id: "opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)" },
  { id: "opus-4.6", name: "Claude 4.6 Opus" },
  { id: "sonnet-4.6", name: "Claude 4.6 Sonnet" },
  { id: "sonnet-4.6-thinking", name: "Claude 4.6 Sonnet (Thinking)" },
  { id: "opus-4.5", name: "Claude 4.5 Opus" },
  { id: "opus-4.5-thinking", name: "Claude 4.5 Opus (Thinking)" },
  { id: "sonnet-4.5", name: "Claude 4.5 Sonnet" },
  { id: "sonnet-4.5-thinking", name: "Claude 4.5 Sonnet (Thinking)" },
  { id: "gpt-5.4-high", name: "GPT-5.4 High" },
  { id: "gpt-5.4-medium", name: "GPT-5.4" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash" },
  { id: "grok", name: "Grok" },
  { id: "kimi-k2.5", name: "Kimi K2.5" },
];

const NOISE_LINE_PATTERNS = [
  /^\s*<environment_context>/i,
  /^\s*<\/environment_context>/i,
  /^\s*<fast_mode_info>/i,
  /^\s*<\/fast_mode_info>/i,
  /^\s*git status:/i,
  /^\s*recent commits?:/i,
  /^\s*current branch:/i,
  /^\s*working tree:/i,
  /^\s*sandbox[_ ]mode:/i,
  /^\s*network access:/i,
  /^\s*approval mode:/i,
];

class MixedDeltaTracker {
  emittedText = "";
  emittedThinking = "";

  nextText(value) {
    const delta = this.diff(this.emittedText, value);
    if (delta) this.emittedText += delta;
    return delta;
  }

  nextThinking(value) {
    const delta = this.diff(this.emittedThinking, value);
    if (delta) this.emittedThinking += delta;
    return delta;
  }

  diff(emitted, current) {
    if (!emitted) return current;
    if (current.startsWith(emitted)) return current.slice(emitted.length);
    if (emitted.startsWith(current)) return "";
    return current;
  }
}

const config = {
  host: process.env.CURSOR_GATEWAY_HOST || "127.0.0.1",
  port: Number(process.env.CURSOR_GATEWAY_PORT || "32124"),
  workspace: path.resolve(process.env.CURSOR_GATEWAY_WORKSPACE || process.cwd()),
  apiKey: process.env.CURSOR_GATEWAY_API_KEY || "",
  adminPassword:
    process.env.CURSOR_GATEWAY_ADMIN_PASSWORD ||
    process.env.CURSOR_GATEWAY_API_KEY ||
    "changeme",
  requireApiKey:
    process.env.CURSOR_GATEWAY_REQUIRE_API_KEY === "true" ||
    Boolean(process.env.CURSOR_GATEWAY_API_KEY),
  force: process.env.CURSOR_GATEWAY_FORCE === "true",
  trustWorkspace: process.env.CURSOR_GATEWAY_TRUST_WORKSPACE !== "false",
  mode: process.env.CURSOR_GATEWAY_MODE || "default",
  maxSystemChars: Number(process.env.CURSOR_GATEWAY_MAX_SYSTEM_CHARS || "6000"),
  modelsCacheTtlMs: Number(process.env.CURSOR_GATEWAY_MODELS_CACHE_TTL_MS || "60000"),
  probeModel: process.env.CURSOR_GATEWAY_PROBE_MODEL || "composer-2-fast",
  logLevel: process.env.CURSOR_GATEWAY_LOG_LEVEL || "info",
};

const startedAt = Date.now();
const OAUTH_URL_TIMEOUT_MS = 10000;
const OAUTH_COMPLETE_TIMEOUT_MS = Number(process.env.CURSOR_GATEWAY_OAUTH_TIMEOUT_MS || "180000");
const OAUTH_POLL_INTERVAL_MS = 2000;

const stats = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  streamedRequests: 0,
  activeRequests: 0,
  totalPromptChars: 0,
  totalOutputChars: 0,
  totalDurationMs: 0,
  lastPromptChars: 0,
  lastPromptTokens: 0,
  lastCompletionTokens: 0,
  lastTotalTokens: 0,
  lastModel: "",
  lastError: "",
  lastRequestAt: 0,
  lastDurationMs: 0,
};

let modelsCache = {
  expiresAt: 0,
  models: [],
};

function createOAuthSessionState() {
  return {
    id: "",
    status: "idle",
    url: "",
    callbackUrl: "",
    startedAt: 0,
    updatedAt: 0,
    completedAt: 0,
    exitCode: null,
    pid: null,
    error: "",
    stdout: "",
    stderr: "",
    child: null,
  };
}

let oauthSession = createOAuthSessionState();

function log(level, message, meta = undefined) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] ?? 20) < (order[config.logLevel] ?? 20)) return;
  const line = `[cursor-gateway] ${level.toUpperCase()} ${message}`;
  if (meta) {
    console.error(line, JSON.stringify(meta));
  } else {
    console.error(line);
  }
}

function resolveCursorAgentBinary() {
  if (process.env.CURSOR_AGENT_PATH) return process.env.CURSOR_AGENT_PATH;

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const knownPath = path.join(localAppData, "cursor-agent", "cursor-agent.cmd");
    if (knownPath && existsSync(knownPath)) return knownPath;
    return "cursor-agent.cmd";
  }

  const candidates = [
    path.join(homedir(), ".cursor-agent", "cursor-agent"),
    "/usr/local/bin/cursor-agent",
    "/usr/bin/cursor-agent",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "cursor-agent";
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function parseCursorModelsOutput(output) {
  const models = [];
  const seen = new Set();
  for (const line of stripAnsi(output).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-zA-Z0-9._-]+)\s+-\s+(.+?)(?:\s+\((?:current|default)\))*\s*$/);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    models.push({ id: match[1], name: match[2].trim() });
  }
  return models;
}

function listModels(options = {}) {
  const now = Date.now();
  if (!options.fresh && modelsCache.models.length > 0 && now < modelsCache.expiresAt) {
    return modelsCache.models;
  }

  try {
    const output = execFileSync(resolveCursorAgentBinary(), ["models"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });
    const parsed = parseCursorModelsOutput(output);
    const models = parsed.length > 0 ? parsed : DEFAULT_MODELS;
    modelsCache = {
      expiresAt: now + Math.max(0, config.modelsCacheTtlMs),
      models,
    };
    return models;
  } catch (error) {
    log("warn", "cursor-agent models failed, using fallback models", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (modelsCache.models.length > 0) return modelsCache.models;
    return DEFAULT_MODELS;
  }
}

function extractCursorLoginUrl(output) {
  const compact = stripAnsi(output).replace(/\s+/g, "");
  const match = compact.match(/https:\/\/cursor\.com\/loginDeepControl(?:\?[A-Za-z0-9._~%=&-]*)?/);
  return match ? match[0] : "";
}

function parseCursorLoginStatus(output) {
  const message = stripAnsi(output).trim();
  if (!message) return { loggedIn: false, message: "" };
  if (/\bnot logged in\b/i.test(message) || /\bnot authenticated\b/i.test(message)) {
    return { loggedIn: false, message: /not authenticated/i.test(message) ? "Not authenticated" : "Not logged in" };
  }
  if (/\blogged in\b/i.test(message) || /\bauthenticated\b/i.test(message)) {
    return { loggedIn: true, message };
  }
  return { loggedIn: !/\bnot logged in\b/i.test(message), message };
}

function parseCursorAboutOutput(output) {
  const fields = {};
  const fieldMap = new Map([
    ["cli version", "cliVersion"],
    ["model", "model"],
    ["subscription tier", "subscriptionTier"],
    ["os", "os"],
    ["user email", "userEmail"],
  ]);

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z][A-Za-z ]+?)\s{2,}(.+?)$/);
    if (!match) continue;
    const field = fieldMap.get(match[1].trim().toLowerCase());
    if (field) fields[field] = match[2].trim();
  }

  return fields;
}

function getCursorAuthPaths() {
  const home = homedir();
  const authFiles = ["cli-config.json", "auth.json"];
  const paths = [];

  if (platform() === "darwin") {
    for (const file of authFiles) paths.push(path.join(home, ".cursor", file));
    for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file));
    return paths;
  }

  for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file));

  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig && xdgConfig !== path.join(home, ".config")) {
    for (const file of authFiles) paths.push(path.join(xdgConfig, "cursor", file));
  }

  for (const file of authFiles) paths.push(path.join(home, ".cursor", file));
  return paths;
}

function getCursorAuthSnapshot() {
  const paths = getCursorAuthPaths();
  const existing = paths.filter((authPath) => existsSync(authPath));
  return {
    present: existing.length > 0,
    paths,
    existing,
  };
}

function runCursorAgentCommand(args, options = {}) {
  try {
    const output = execFileSync(resolveCursorAgentBinary(), args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs || 10000,
      env: { ...process.env, ...(options.env || {}) },
    });
    return { ok: true, output: String(output || ""), error: "", code: 0 };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    return {
      ok: false,
      output: `${stdout}${stderr}`.trim(),
      error: error instanceof Error ? error.message : String(error),
      code: typeof error?.status === "number" ? error.status : null,
    };
  }
}

function buildCursorAgentArgs(model, options = {}) {
  const stream = options.stream !== false;
  const args = [
    "--print",
    "--output-format",
    stream ? "stream-json" : "json",
    "--workspace",
    config.workspace,
    "--model",
    model,
  ];

  if (stream) args.push("--stream-partial-output");
  if (config.trustWorkspace) args.push("--trust");
  if (config.mode === "ask") args.push("--mode", "ask");
  if (config.mode === "plan") args.push("--plan");
  if (config.force) args.push("--force");

  return args;
}

function getCursorAccountSnapshot() {
  const statusResult = runCursorAgentCommand(["status"], { timeoutMs: 8000 });
  const aboutResult = runCursorAgentCommand(["about"], { timeoutMs: 8000 });
  const modelsResult = runCursorAgentCommand(["models"], { timeoutMs: 10000 });
  const authFiles = getCursorAuthSnapshot();
  const statusLogin = parseCursorLoginStatus(statusResult.output);
  const aboutLogin = parseCursorLoginStatus(aboutResult.output);
  const about = parseCursorAboutOutput(aboutResult.output);
  const models = modelsResult.ok ? parseCursorModelsOutput(modelsResult.output) : [];
  const userEmail = about.userEmail || "";
  const loggedInByEmail = Boolean(userEmail && !/\bnot logged in\b/i.test(userEmail));

  return {
    loggedIn: statusLogin.loggedIn || aboutLogin.loggedIn || loggedInByEmail,
    statusMessage: statusLogin.message || aboutLogin.message || statusResult.error || aboutResult.error || "",
    about,
    models,
    authFilesPresent: authFiles.present,
    authFileCount: authFiles.existing.length,
    statusOutput: stripAnsi(statusResult.output).trim(),
    aboutOutput: stripAnsi(aboutResult.output).trim(),
    modelsOutput: stripAnsi(modelsResult.output).trim(),
    errors: {
      status: statusResult.ok ? "" : statusResult.error,
      about: aboutResult.ok ? "" : aboutResult.error,
      models: modelsResult.ok ? "" : modelsResult.error,
    },
  };
}

function getOAuthSessionSnapshot() {
  return {
    id: oauthSession.id,
    status: oauthSession.status,
    url: oauthSession.url,
    callbackUrl: oauthSession.callbackUrl,
    startedAt: oauthSession.startedAt,
    updatedAt: oauthSession.updatedAt,
    completedAt: oauthSession.completedAt,
    exitCode: oauthSession.exitCode,
    pid: oauthSession.pid,
    error: oauthSession.error,
    running: Boolean(oauthSession.child && oauthSession.child.exitCode === null),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopOAuthSession(reason = "idle") {
  if (oauthSession.child && oauthSession.child.exitCode === null) {
    try {
      oauthSession.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  oauthSession = createOAuthSessionState();
  oauthSession.status = reason;
}

async function startCursorOAuthSession() {
  if (oauthSession.child && oauthSession.child.exitCode === null) {
    return {
      reused: true,
      session: getOAuthSessionSnapshot(),
      account: getCursorAccountSnapshot(),
    };
  }

  const account = getCursorAccountSnapshot();
  if (account.loggedIn) {
    return {
      alreadyAuthenticated: true,
      session: getOAuthSessionSnapshot(),
      account,
    };
  }

  oauthSession = createOAuthSessionState();
  oauthSession.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  oauthSession.status = "starting";
  oauthSession.startedAt = Date.now();
  oauthSession.updatedAt = oauthSession.startedAt;
  const sessionId = oauthSession.id;

  const child = spawn(resolveCursorAgentBinary(), ["login"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_OPEN_BROWSER: "1" },
    shell: process.platform === "win32",
  });

  oauthSession.child = child;
  oauthSession.pid = child.pid || null;

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const tryExtractUrl = () => {
      if (oauthSession.id !== sessionId) return;
      const url = extractCursorLoginUrl(`${oauthSession.stdout}\n${oauthSession.stderr}`);
      if (!url) return;
      oauthSession.url = url;
      oauthSession.status = "waiting";
      oauthSession.updatedAt = Date.now();
      settle(resolve, {
        reused: false,
        session: getOAuthSessionSnapshot(),
        account: getCursorAccountSnapshot(),
      });
    };

    child.stdout.on("data", (chunk) => {
      if (oauthSession.id !== sessionId) return;
      oauthSession.stdout += chunk.toString();
      oauthSession.updatedAt = Date.now();
      tryExtractUrl();
    });

    child.stderr.on("data", (chunk) => {
      if (oauthSession.id !== sessionId) return;
      oauthSession.stderr += chunk.toString();
      oauthSession.updatedAt = Date.now();
      tryExtractUrl();
    });

    child.on("error", (error) => {
      if (oauthSession.id !== sessionId) {
        settle(reject, new Error("Cursor OAuth 会话已取消"));
        return;
      }
      oauthSession.status = "failed";
      oauthSession.error = error instanceof Error ? error.message : String(error);
      oauthSession.updatedAt = Date.now();
      settle(reject, error);
    });

    child.on("close", (code) => {
      if (oauthSession.id !== sessionId) {
        settle(reject, new Error("Cursor OAuth 会话已取消"));
        return;
      }
      oauthSession.exitCode = code;
      oauthSession.child = null;
      oauthSession.updatedAt = Date.now();
      const accountSnapshot = getCursorAccountSnapshot();
      if (accountSnapshot.loggedIn) {
        oauthSession.status = "complete";
        oauthSession.completedAt = Date.now();
        oauthSession.error = "";
        return;
      }
      if (oauthSession.status !== "waiting") {
        oauthSession.status = "failed";
        oauthSession.error = stripAnsi(oauthSession.stderr).trim()
          || stripAnsi(oauthSession.stdout).trim()
          || `cursor-agent login exited with code ${String(code ?? "unknown")}`;
        settle(reject, new Error(oauthSession.error));
      }
    });

    setTimeout(() => {
      if (oauthSession.id !== sessionId) {
        settle(reject, new Error("Cursor OAuth 会话已取消"));
        return;
      }
      if (settled) return;
      oauthSession.status = "failed";
      oauthSession.error = "生成 Cursor 授权链接超时";
      oauthSession.updatedAt = Date.now();
      if (child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      settle(reject, new Error(oauthSession.error));
    }, OAUTH_URL_TIMEOUT_MS);
  });
}

async function waitForCursorOAuthCompletion(callbackUrl = "") {
  if (callbackUrl) {
    oauthSession.callbackUrl = String(callbackUrl).trim();
    oauthSession.updatedAt = Date.now();
    if (oauthSession.child?.stdin?.writable) {
      try {
        oauthSession.child.stdin.write(`${oauthSession.callbackUrl}\n`);
      } catch {
        // cursor-agent usually completes through the browser flow; stdin is best-effort.
      }
    }
  }

  const start = Date.now();
  let account = getCursorAccountSnapshot();
  while (Date.now() - start < OAUTH_COMPLETE_TIMEOUT_MS) {
    account = getCursorAccountSnapshot();
    if (account.loggedIn) {
      oauthSession.status = "complete";
      oauthSession.completedAt = Date.now();
      oauthSession.error = "";
      oauthSession.updatedAt = Date.now();
      return {
        ok: true,
        session: getOAuthSessionSnapshot(),
        account,
      };
    }

    if (oauthSession.exitCode !== null && oauthSession.exitCode !== 0) {
      oauthSession.status = "failed";
      oauthSession.error ||= "Cursor 登录进程已退出，认证未完成";
      break;
    }

    await sleep(OAUTH_POLL_INTERVAL_MS);
  }

  if (!account.loggedIn && oauthSession.status !== "failed") {
    oauthSession.status = "waiting";
    oauthSession.error = "尚未检测到 Cursor 登录态，请完成浏览器授权后重试";
    oauthSession.updatedAt = Date.now();
  }

  return {
    ok: false,
    session: getOAuthSessionSnapshot(),
    account,
  };
}

function logoutCursorAccount() {
  stopOAuthSession("idle");
  const result = runCursorAgentCommand(["logout"], { timeoutMs: 10000 });
  return {
    ok: result.ok,
    output: stripAnsi(result.output).trim(),
    error: result.ok ? "" : result.error,
    account: getCursorAccountSnapshot(),
    session: getOAuthSessionSnapshot(),
  };
}

function normalizeModel(model) {
  const raw = typeof model === "string" && model.trim() ? model.trim() : "auto";
  return raw
    .replace(/^cursor-acp\//, "")
    .replace(/^cursor\//, "")
    .replace(/^cursor-/, "");
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        if (part && typeof part === "object" && part.type === "image_url") return "[image omitted]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function stripPromptNoise(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  return lines
    .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}

function buildPromptFromMessages(messages) {
  const lines = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = typeof message?.role === "string" ? message.role : "user";
    let content = stripPromptNoise(extractTextContent(message?.content));
    if (!content) continue;

    if (role === "system" && config.maxSystemChars > 0 && content.length > config.maxSystemChars) {
      content = `${content.slice(0, config.maxSystemChars)}\n[system prompt truncated by cursor-gateway]`;
    }

    if (role === "tool") {
      const id = message?.tool_call_id || "unknown";
      lines.push(`TOOL_RESULT (${id}): ${content}`);
      continue;
    }

    lines.push(`${role.toUpperCase()}: ${content}`);
  }

  return lines.join("\n\n").trim() || "Hello";
}

function extractAssistantText(event) {
  if (event?.type !== "assistant" || !Array.isArray(event?.message?.content)) return "";
  return event.message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function extractThinkingText(event) {
  if (event?.type === "thinking") return typeof event.text === "string" ? event.text : "";
  if (event?.type !== "assistant" || !Array.isArray(event?.message?.content)) return "";
  return event.message.content
    .filter((part) => part?.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking)
    .join("");
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return undefined;
  const read = (...keys) => {
    for (const key of keys) {
      const raw = value[key];
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    }
    return 0;
  };
  const input = read("inputTokens", "input_tokens", "prompt_tokens");
  const output = read("outputTokens", "output_tokens", "completion_tokens");
  const reasoning = read("reasoningTokens", "reasoning_tokens");
  const cacheRead = read("cacheReadTokens", "cache_read_tokens");
  const cacheWrite = read("cacheWriteTokens", "cache_write_tokens");
  const promptTokens = input + cacheRead + cacheWrite;
  const totalTokens = promptTokens + output + reasoning;
  if (totalTokens === 0) return undefined;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
    },
    completion_tokens_details: {
      reasoning_tokens: reasoning,
    },
  };
}

function openAiError(status, type, message) {
  return json(status, {
    error: {
      message,
      type,
    },
  });
}

function createChatCompletion(model, content, reasoningContent, usage) {
  const message = {
    role: "assistant",
    content,
  };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  const payload = {
    id: `cursor-gateway-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: "stop",
      },
    ],
  };
  if (usage) payload.usage = usage;
  return payload;
}

function createChunk(id, created, model, delta, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: done ? "stop" : null,
      },
    ],
  };
}

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone() {
  return "data: [DONE]\n\n";
}

function json(status, payload) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function html(status, body) {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
    body,
  };
}

function text(status, body, contentType = "text/plain; charset=utf-8") {
  return {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
    body,
  };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const sec = Math.floor(total / 1000);
  const min = Math.floor(sec / 60);
  const hours = Math.floor(min / 60);
  if (hours > 0) return `${hours}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function maskSecret(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  };
}

function getStatusPayload() {
  const averageDurationMs = stats.successRequests > 0
    ? Math.round(stats.totalDurationMs / stats.successRequests)
    : 0;

  return {
    ok: true,
    mode: "cursor-agent",
    workspace: config.workspace,
    authRequired: config.requireApiKey,
    adminPasswordSet: Boolean(config.adminPassword),
    apiKeyConfigured: Boolean(config.apiKey),
    host: config.host,
    port: config.port,
    uptimeMs: Date.now() - startedAt,
    memory: getMemorySnapshot(),
    latency: {
      mode: "cli-per-request",
      lastChatMs: stats.lastDurationMs,
      averageChatMs: averageDurationMs,
      expectedColdStartMs: 7000,
      bottleneck: "cursor-agent process startup and Cursor upstream response time",
      nonStreamOutputFormat: "json",
      streamOutputFormat: "stream-json",
      trustWorkspace: config.trustWorkspace,
      modelsCacheTtlMs: config.modelsCacheTtlMs,
      recommendedFastModels: ["composer-2-fast", "composer-2.5-fast", "auto"],
    },
    stats: {
      ...stats,
      averageDurationMs,
    },
  };
}

function buildAdminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor 网关</title>
  <style>
    :root {
      --bg: #0f1115;
      --panel: #161a21;
      --panel-2: #1d232d;
      --line: #2c3440;
      --text: #e9eef7;
      --muted: #9ea7b6;
      --faint: #6d7787;
      --accent: #efb84d;
      --accent-2: #69d2ff;
      --good: #4ed18c;
      --warn: #f4b860;
      --bad: #ea6b7a;
      --shadow: 0 14px 40px rgba(0,0,0,.34);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background:
      linear-gradient(180deg, rgba(255,255,255,.03), transparent 28%),
      radial-gradient(circle at top left, rgba(239,184,77,.10), transparent 25%),
      linear-gradient(135deg, #0b0d11 0%, #11151b 38%, #0d1116 100%);
      color: var(--text); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0; }
    body::before {
      content: ""; position: fixed; inset: 0; pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px);
      background-size: 22px 22px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.15));
      opacity: .16;
    }
    .shell { position: relative; max-width: 1500px; margin: 0 auto; padding: 24px; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      border: 1px solid var(--line); background: rgba(22,26,33,.88); box-shadow: var(--shadow);
      padding: 18px 20px; border-radius: 8px; backdrop-filter: blur(8px);
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .mark {
      width: 42px; height: 42px; border-radius: 8px; background: linear-gradient(145deg, var(--accent), #ffcf79);
      color: #111; display: grid; place-items: center; font-weight: 800; font-size: 15px;
      box-shadow: inset 0 -1px 0 rgba(255,255,255,.2);
    }
    .title { margin: 0; font: 700 18px/1.1 Georgia, "Times New Roman", serif; letter-spacing: .02em; }
    .subtitle { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    button {
      appearance: none; border: 1px solid var(--line); background: linear-gradient(180deg, #232a35, #1a2029);
      color: var(--text); padding: 10px 14px; border-radius: 8px; font: inherit; cursor: pointer;
    }
    button:hover { border-color: #415069; }
    button.primary { background: linear-gradient(180deg, #f1c55f, #d79d23); color: #1b1404; border-color: #f7d28b; font-weight: 700; }
    button.ghost { background: transparent; }
    .layout { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 18px; margin-top: 18px; }
    .sidebar, .panel, .login {
      border: 1px solid var(--line); background: rgba(22,26,33,.88); box-shadow: var(--shadow); border-radius: 8px;
    }
    .sidebar { padding: 16px; position: sticky; top: 18px; height: fit-content; }
    .navgroup { display: grid; gap: 8px; }
    .navitem { display: flex; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 8px; background: #131820; color: var(--muted); }
    .navitem strong { color: var(--text); font-weight: 700; }
    .navitem span { color: var(--faint); }
    .panel { padding: 18px; }
    .grid { display: grid; gap: 18px; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
    .card {
      border: 1px solid var(--line); background: linear-gradient(180deg, rgba(29,35,45,.96), rgba(20,24,31,.96));
      border-radius: 8px; padding: 14px; min-height: 116px;
    }
    .label { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: .12em; }
    .value { margin-top: 8px; font-size: 30px; font-weight: 800; line-height: 1; }
    .hint { margin-top: 8px; color: var(--faint); font-size: 12px; }
    .section { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 18px; }
    .section h2 { margin: 0 0 12px; font: 700 15px/1.2 Georgia, "Times New Roman", serif; }
    .stack { display: grid; gap: 12px; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
    .mono-box {
      border: 1px solid var(--line); background: #10141a; border-radius: 8px; padding: 14px; overflow: auto; white-space: pre-wrap;
    }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #27303d; vertical-align: top; }
    .table th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
    .status {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 999px; border: 1px solid var(--line);
      font-size: 12px;
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--good); box-shadow: 0 0 0 3px rgba(78,209,140,.15); }
    .dot.warn { background: var(--warn); box-shadow: 0 0 0 3px rgba(244,184,96,.12); }
    .dot.bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(234,107,122,.12); }
    .field { display: grid; gap: 8px; }
    label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
    input, textarea {
      width: 100%; border: 1px solid var(--line); background: #0f1319; color: var(--text);
      border-radius: 8px; padding: 11px 12px; font: inherit;
    }
    textarea { min-height: 140px; resize: vertical; }
    .login-wrap {
      min-height: 100vh; display: grid; place-items: center; padding: 24px;
    }
    .login {
      width: min(560px, 100%); padding: 22px;
    }
    .login h1 { margin: 0; font: 700 28px/1.1 Georgia, "Times New Roman", serif; }
    .login p { margin: 10px 0 20px; color: var(--muted); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .muted { color: var(--muted); }
    .hidden { display: none !important; }
    .footerline { margin-top: 18px; color: var(--faint); font-size: 12px; display:flex; justify-content:space-between; gap: 10px; flex-wrap: wrap; }
    .hero-panel {
      margin-top: 18px; border: 1px solid var(--line); background: linear-gradient(135deg, rgba(29,35,45,.96), rgba(16,20,27,.96));
      box-shadow: var(--shadow); border-radius: 8px; padding: 18px; display: grid; gap: 16px;
    }
    .hero-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .hero-kicker { color: var(--accent); font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
    .hero-title { margin-top: 8px; font: 700 24px/1.15 Georgia, "Times New Roman", serif; }
    .hero-copy { margin-top: 8px; max-width: 760px; color: var(--muted); }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .quick-card {
      border: 1px solid rgba(255,255,255,.10); background: rgba(8,11,15,.42); border-radius: 8px; padding: 13px; min-height: 94px;
    }
    .quick-card .value { font-size: 22px; overflow-wrap: anywhere; }
    .pill-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px;
      padding: 6px 9px; color: var(--muted); background: rgba(15,19,25,.7); font-size: 12px;
    }
    .pill.good { color: var(--good); border-color: rgba(78,209,140,.35); }
    .pill.warn { color: var(--warn); border-color: rgba(244,184,96,.35); }
    .ops-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); gap: 14px; }
    .copyline { display: flex; align-items: stretch; gap: 8px; }
    .copyline input { min-width: 0; }
    .latency-steps { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin-top: 10px; }
    .step {
      border: 1px dashed rgba(255,255,255,.16); border-radius: 8px; padding: 10px; color: var(--muted); min-height: 78px;
    }
    .step strong { display: block; color: var(--text); margin-bottom: 4px; }
    select {
      width: 100%; border: 1px solid var(--line); background: #0f1319; color: var(--text);
      border-radius: 8px; padding: 11px 12px; font: inherit;
    }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .cards { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .split { grid-template-columns: 1fr; }
      .quick-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .ops-grid { grid-template-columns: 1fr; }
      .latency-steps { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .shell { padding: 14px; }
      .topbar { flex-direction: column; align-items: flex-start; }
      .cards { grid-template-columns: 1fr; }
      .quick-grid { grid-template-columns: 1fr; }
      .copyline { display: grid; }
      .value { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="login-wrap" id="loginView">
    <div class="login">
      <div class="brand" style="margin-bottom:16px;">
        <div class="mark">CG</div>
        <div>
          <h1>Cursor 网关</h1>
          <div class="subtitle">服务器 OAuth 与 NewAPI 代理控制台</div>
        </div>
      </div>
      <p>输入管理密码后，可以查看运行状态、管理 Cursor 账号登录态，并复制 NewAPI 接入地址。</p>
      <div class="field">
        <label for="adminPassword">管理密码</label>
        <input id="adminPassword" type="password" placeholder="输入管理密码" autocomplete="current-password" />
      </div>
      <div class="row" style="margin-top:14px;">
        <button class="primary" id="loginBtn">解锁</button>
        <button class="ghost" id="rememberBtn" type="button">记住本浏览器</button>
      </div>
      <div class="footerline">
        <span id="loginStatus">等待输入管理密码。</span>
        <span>管理密码和调用 API Key 是分开的。</span>
      </div>
    </div>
  </div>

  <div class="shell hidden" id="appView">
    <div class="topbar">
      <div class="brand">
        <div class="mark">CG</div>
        <div>
          <div class="title">Cursor 网关</div>
          <div class="subtitle" id="runtimeSubtitle">正在读取运行状态...</div>
        </div>
      </div>
      <div class="actions">
        <button id="refreshBtn" class="primary">刷新</button>
        <button id="copyBaseBtn">复制基础地址</button>
        <button id="logoutBtn" class="ghost">退出管理</button>
      </div>
    </div>

    <section class="hero-panel">
      <div class="hero-head">
        <div>
          <div class="hero-kicker">Cursor Gateway Console</div>
          <div class="hero-title">账号、接入和延迟，一屏看完</div>
          <div class="hero-copy" id="heroAdvice">正在读取网关状态。当前版本采用 cursor-agent 每请求启动一次，稳定性优先，低延迟需要后续做常驻 worker。</div>
        </div>
        <div class="hero-actions">
          <button class="primary" id="heroStartOAuthBtn" type="button">添加 / 刷新账号</button>
          <button id="copyHeroBaseBtn" type="button">复制 NewAPI Base URL</button>
        </div>
      </div>

      <div class="quick-grid">
        <div class="quick-card">
          <div class="label">当前账号</div>
          <div class="value" id="heroAccount">-</div>
          <div class="hint" id="heroPlan">等待账号状态</div>
        </div>
        <div class="quick-card">
          <div class="label">NewAPI Base URL</div>
          <div class="value" id="heroBaseUrl">-</div>
          <div class="hint">渠道类型选 OpenAI 兼容，密钥使用网关 API Key。</div>
        </div>
        <div class="quick-card">
          <div class="label">最近耗时</div>
          <div class="value" id="heroLatency">-</div>
          <div class="hint" id="heroAvgLatency">平均耗时等待请求后统计</div>
        </div>
        <div class="quick-card">
          <div class="label">运行模式</div>
          <div class="value" id="heroMode">CLI</div>
          <div class="hint">当前是稳定优先的 CLI-per-request 模式。</div>
        </div>
      </div>

      <div class="ops-grid">
        <div class="stack">
          <div class="field">
            <label>NewAPI 接入地址</label>
            <div class="copyline">
              <input id="newApiBaseUrl" readonly />
              <button id="copyInlineBaseBtn" type="button">复制</button>
            </div>
          </div>
          <div class="pill-row" id="recommendedModels">
            <span class="pill">composer-2-fast</span>
            <span class="pill">composer-2.5-fast</span>
            <span class="pill">auto</span>
          </div>
        </div>
        <div class="stack">
          <div class="field">
            <label for="probeModel">延迟探针（会消耗一次 Cursor 调用）</label>
            <select id="probeModel">
              <option value="composer-2-fast">composer-2-fast</option>
              <option value="composer-2.5-fast">composer-2.5-fast</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <div class="row">
            <button id="runProbeBtn" class="primary" type="button">跑一次延迟自检</button>
          </div>
          <div class="mono-box" id="probeResult">还没有运行探针。</div>
        </div>
      </div>

      <div class="latency-steps">
        <div class="step"><strong>1. 网关网络</strong><span id="latencyGateway">HTTP 健康检查通常是几十毫秒，不是主要瓶颈。</span></div>
        <div class="step"><strong>2. CLI 启动</strong><span id="latencyCli">每次请求都会启动 cursor-agent，这是当前最大固定开销。</span></div>
        <div class="step"><strong>3. Cursor 上游</strong><span id="latencyUpstream">模型排队和生成时间由 Cursor 侧决定，fast 模型更适合公司内部高频调用。</span></div>
      </div>
    </section>

    <div class="layout">
      <aside class="sidebar">
        <div class="navgroup" id="navgroup">
          <div class="navitem"><strong>健康</strong><span id="navHealth">-</span></div>
          <div class="navitem"><strong>账号</strong><span id="navAccount">-</span></div>
          <div class="navitem"><strong>模型</strong><span id="navModels">-</span></div>
          <div class="navitem"><strong>请求</strong><span id="navRequests">-</span></div>
          <div class="navitem"><strong>内存</strong><span id="navMemory">-</span></div>
          <div class="navitem"><strong>API 密钥</strong><span id="navApiKey">-</span></div>
        </div>
      </aside>

      <main class="grid">
        <section class="cards">
          <div class="card">
            <div class="label">主动请求</div>
            <div class="value" id="statActive">0</div>
            <div class="hint">当前正在网关中运行的请求。</div>
          </div>
          <div class="card">
            <div class="label">成功 / 失败</div>
            <div class="value" id="statSuccess">0 / 0</div>
            <div class="hint">已完成请求和被拒绝调用。</div>
          </div>
          <div class="card">
            <div class="label">RSS 内存</div>
            <div class="value" id="statRss">0 MB</div>
            <div class="hint">Node 进程当前内存占用。</div>
          </div>
          <div class="card">
            <div class="label">正常运行时间</div>
            <div class="value" id="statUptime">0s</div>
            <div class="hint">服务启动后的运行时长。</div>
          </div>
        </section>

        <section class="panel">
          <h2>Cursor OAuth 登录</h2>
          <div class="split">
            <div class="stack">
              <div class="card">
                <div class="label">账号状态</div>
                <div class="mono-box" id="accountBox" style="margin-top:12px; min-height: 160px;">正在读取账号状态...</div>
                <div class="row" style="margin-top:12px;">
                  <button class="primary" id="startOAuthBtn">生成 Cursor 授权链接</button>
                  <button id="openOAuthBtn" type="button">打开链接</button>
                  <button id="logoutCursorBtn" class="ghost" type="button">退出 Cursor 账号</button>
                </div>
              </div>
              <div class="card">
                <div class="label">OAuth 会话</div>
                <div class="mono-box" id="oauthStatus" style="margin-top:12px; min-height: 120px;">未开始登录。</div>
              </div>
            </div>
            <div class="stack">
              <div class="field">
                <label for="oauthUrl">授权链接</label>
                <textarea id="oauthUrl" readonly placeholder="点击生成后显示 Cursor 授权链接"></textarea>
              </div>
              <div class="field">
                <label for="callbackUrl">回调 URL / 授权完成结果</label>
                <input id="callbackUrl" placeholder="浏览器授权后，如果出现最终跳转地址，把完整 URL 粘贴到这里" />
                <div class="hint">Cursor CLI 通常会自动接收浏览器授权；这里的回调框用于兼容需要手动提交结果的情况。</div>
              </div>
              <div class="row">
                <button id="copyOAuthBtn" type="button">复制授权链接</button>
                <button id="submitCallbackBtn" class="primary" type="button">提交回调 / 检查登录</button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>运行状态</h2>
          <div class="split">
            <div class="mono-box" id="runtimeBox">正在读取...</div>
            <div class="stack">
              <div class="card">
                <div class="label">API 表面</div>
                <div class="hint" style="margin-top:10px;">给 NewAPI 使用的 OpenAI 兼容端点。</div>
                <div class="mono-box" id="apiSurface" style="margin-top:12px; min-height: 88px;"></div>
              </div>
              <div class="card">
                <div class="label">凭据</div>
                <div class="hint" style="margin-top:10px;">管理认证和请求 API 密钥刻意分开。</div>
                <div class="mono-box" id="credentialBox" style="margin-top:12px; min-height: 88px;"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>模型</h2>
          <div class="mono-box" style="padding:0;">
            <table class="table">
              <thead>
                <tr>
                  <th style="width: 36%;">模型</th>
                  <th style="width: 22%;">提供方</th>
                  <th style="width: 22%;">创建时间</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody id="modelsBody">
                <tr><td colspan="4" class="muted">正在读取模型...</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <h2>配置快照</h2>
          <div class="split">
            <div class="field">
              <label>网关状态</label>
              <textarea id="statusJson" readonly></textarea>
            </div>
            <div class="field">
              <label>提示词过滤</label>
              <textarea readonly>系统内容中的环境噪音会被剔除。
过长的 system prompt 会按配置上限截断。
工具结果和推理内容只保留 cursor-agent 实际输出的部分。</textarea>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>OpenAI 接入</h2>
          <div class="mono-box" id="probeBox">在 NewAPI 中使用同一个 API Key，并把渠道基础地址指向上面显示的 /v1。</div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const cleanPath = window.location.pathname.replace(/\\/+$/, '');
    const inferredPrefix = cleanPath.endsWith('/admin') ? cleanPath.slice(0, -('/admin'.length)) : '';
    const state = {
      token: localStorage.getItem('cursor_gateway_admin_password') || '',
      remember: localStorage.getItem('cursor_gateway_admin_remember') === '1',
      prefix: inferredPrefix,
      baseUrl: window.location.origin + inferredPrefix,
      oauthUrl: '',
      status: null,
      models: [],
      accountPayload: null,
      oauthSession: null,
    };

    const $ = (id) => document.getElementById(id);

    function setText(id, value) {
      const node = $(id);
      if (node) node.textContent = value;
    }

    function setValue(id, value) {
      const node = $(id);
      if (node) node.value = value;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    function setStatus(msg) {
      $('loginStatus').textContent = msg;
    }

    function setLoginVisible(visible) {
      $('loginView').classList.toggle('hidden', !visible);
      $('appView').classList.toggle('hidden', visible);
    }

    function authHeaders() {
      const headers = { 'X-Admin-Password': state.token };
      return headers;
    }

    async function api(path, options = {}) {
      const headers = Object.assign({}, options.headers || {}, authHeaders());
      const response = await fetch(state.prefix + '/admin/api' + path, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      });
      if (response.status === 401) {
        throw new Error('unauthorized');
      }
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : response.statusText;
        throw new Error(message || 'request failed');
      }
      return data;
    }

    function fmtBytes(bytes) {
      const units = ['B','KB','MB','GB'];
      let value = Number(bytes) || 0;
      let idx = 0;
      while (value >= 1024 && idx < units.length - 1) { value /= 1024; idx += 1; }
      return value.toFixed(value >= 10 || idx === 0 ? 0 : 1) + ' ' + units[idx];
    }

    function fmtDuration(ms) {
      const total = Math.max(0, Math.floor(Number(ms) || 0));
      const sec = Math.floor(total / 1000);
      const min = Math.floor(sec / 60);
      const hour = Math.floor(min / 60);
      if (hour) return hour + '小时' + (min % 60) + '分钟';
      if (min) return min + '分钟' + (sec % 60) + '秒';
      return sec + '秒';
    }

    function fmtMs(ms) {
      const value = Math.max(0, Math.round(Number(ms) || 0));
      if (!value) return '-';
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 1 : 2) + 's';
      return value + 'ms';
    }

    function setModels(rows) {
      const body = $('modelsBody');
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" class="muted">没有模型返回。</td></tr>';
        const select = $('probeModel');
        if (select) select.innerHTML = '<option value="auto">auto</option>';
        return;
      }
      body.innerHTML = rows.map((row) => {
        return '<tr>' +
          '<td>' + escapeHtml(row.id) + '</td>' +
          '<td>' + escapeHtml(row.owned_by) + '</td>' +
          '<td>' + new Date(row.created * 1000).toLocaleString() + '</td>' +
          '<td>' + (row.id === 'auto' ? '默认路由' : '') + '</td>' +
        '</tr>';
      }).join('');

      const select = $('probeModel');
      if (select) {
        const preferred = ['composer-2-fast', 'composer-2.5-fast', 'auto'];
        const ids = Array.from(new Set([...preferred, ...rows.map((row) => row.id)])).filter(Boolean);
        const current = select.value || preferred[0];
        select.innerHTML = ids.map((id) => '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '</option>').join('');
        select.value = ids.includes(current) ? current : (ids[0] || 'auto');
      }
    }

    function renderAccountPanel(accountPayload = state.accountPayload) {
      const account = accountPayload && accountPayload.account ? accountPayload.account : {};
      const oauth = accountPayload && accountPayload.oauth ? accountPayload.oauth : state.oauthSession || {};
      const about = account.about || {};
      const loggedIn = Boolean(account.loggedIn);
      const email = loggedIn ? (about.userEmail || '已登录') : '未登录';
      const sessionStatus = oauth.status || 'idle';
      const url = oauth.url || state.oauthUrl || '';
      state.oauthUrl = url;
      state.oauthSession = oauth;

      $('navAccount').textContent = loggedIn ? '已登录' : (sessionStatus === 'waiting' ? '等待授权' : '未登录');
      $('oauthUrl').value = url;
      if (!$('callbackUrl').value.trim()) {
        $('callbackUrl').value = state.baseUrl + '/admin/oauth/callback';
      }
      $('openOAuthBtn').disabled = !url;
      $('copyOAuthBtn').disabled = !url;
      setText('heroAccount', loggedIn ? email : '未登录');
      setText('heroPlan', [
        '账号等级: ' + (about.subscriptionTier || '-'),
        'CLI 版本: ' + (about.cliVersion || '-'),
        '模型数: ' + (Array.isArray(account.models) ? account.models.length : 0),
      ].join(' · '));

      $('accountBox').textContent = [
        '登录状态: ' + (loggedIn ? '已登录' : '未登录'),
        '账号邮箱: ' + email,
        '订阅等级: ' + (about.subscriptionTier || '-'),
        'CLI 版本: ' + (about.cliVersion || '-'),
        '默认模型: ' + (about.model || '-'),
        '可用模型: ' + (Array.isArray(account.models) ? account.models.length : 0),
        '认证文件: ' + (account.authFilesPresent ? '存在（' + account.authFileCount + '）' : '未检测到'),
        '状态输出: ' + (account.statusOutput || account.statusMessage || '-'),
      ].join('\\n');

      $('oauthStatus').textContent = [
        '会话状态: ' + sessionStatus,
        '会话 ID: ' + (oauth.id || '-'),
        '进程 PID: ' + (oauth.pid || '-'),
        '是否运行: ' + (oauth.running ? '是' : '否'),
        '开始时间: ' + (oauth.startedAt ? new Date(oauth.startedAt).toLocaleString() : '-'),
        '更新时间: ' + (oauth.updatedAt ? new Date(oauth.updatedAt).toLocaleString() : '-'),
        '完成时间: ' + (oauth.completedAt ? new Date(oauth.completedAt).toLocaleString() : '-'),
        '回调 URL: ' + (oauth.callbackUrl || '-'),
        '错误信息: ' + (oauth.error || '-'),
      ].join('\\n');
    }

    function render(status, models, accountPayload) {
      state.status = status;
      state.models = models;
      state.accountPayload = accountPayload || state.accountPayload;

      const account = state.accountPayload && state.accountPayload.account ? state.accountPayload.account : {};
      const about = account.about || {};
      $('runtimeSubtitle').textContent = status.workspace + '  |  ' + status.mode;
      $('navHealth').textContent = '正常';
      $('navModels').textContent = String(models.length);
      $('navRequests').textContent = String(status.stats.totalRequests || 0);
      $('navMemory').textContent = fmtBytes(status.memory.rss);
      $('navApiKey').textContent = status.apiKeyConfigured ? '已配置' : '缺失';

      $('statActive').textContent = String(status.stats.activeRequests || 0);
      $('statSuccess').textContent = (status.stats.successRequests || 0) + ' / ' + (status.stats.failedRequests || 0);
      $('statRss').textContent = fmtBytes(status.memory.rss);
      $('statUptime').textContent = fmtDuration(status.uptimeMs);

      $('runtimeBox').textContent = [
        '工作区: ' + status.workspace,
        '监听: ' + status.host + ':' + status.port,
        'API 认证: ' + (status.authRequired ? '必须' : '关闭'),
        '管理密码: ' + (status.adminPasswordSet ? '已配置' : '缺失'),
        'Cursor 账号: ' + (account.loggedIn ? (about.userEmail || '已登录') : '未登录'),
        '正常运行: ' + fmtDuration(status.uptimeMs),
        'RSS: ' + fmtBytes(status.memory.rss),
        '堆内存: ' + fmtBytes(status.memory.heapUsed),
        '最后模型: ' + (status.stats.lastModel || '-'),
        '最后请求: ' + (status.stats.lastRequestAt ? new Date(status.stats.lastRequestAt).toLocaleString() : '-'),
        '最后 prompt 字符: ' + (status.stats.lastPromptChars || 0),
        '最后 prompt tokens: ' + (status.stats.lastPromptTokens || 0),
        '最后总 tokens: ' + (status.stats.lastTotalTokens || 0),
      ].join('\\n');

      $('statusJson').value = JSON.stringify(status, null, 2);
      $('apiSurface').textContent = [
        '健康检查  GET  ' + state.baseUrl + '/health',
        '模型列表  GET  ' + state.baseUrl + '/v1/models',
        '聊天补全  POST ' + state.baseUrl + '/v1/chat/completions',
      ].join('\\n');
      $('credentialBox').textContent = [
        '管理密码: ' + (status.adminPasswordSet ? '已配置' : '缺失'),
        '调用 API Key: ' + (status.apiKeyConfigured ? '已配置' : '缺失'),
        'NewAPI 基础地址: ' + state.baseUrl + '/v1',
      ].join('\\n');
      $('newApiBaseUrl').value = state.baseUrl + '/v1';
      $('heroBaseUrl').textContent = state.baseUrl + '/v1';
      $('heroAccount').textContent = account.loggedIn ? (about.userEmail || '已登录') : '未登录';
      $('heroPlan').textContent = [
        '账号等级: ' + (about.subscriptionTier || '-'),
        'CLI 版本: ' + (about.cliVersion || '-'),
        '模型数: ' + (Array.isArray(account.models) ? account.models.length : 0),
      ].join(' · ');
      $('heroLatency').textContent = fmtMs(status.stats.lastDurationMs);
      $('heroAvgLatency').textContent = '平均 ' + fmtMs(status.stats.averageDurationMs) + ' · 最近 ' + (status.stats.lastTotalTokens || 0) + ' tokens · 错误 ' + (status.stats.lastError || '-');
      $('heroMode').textContent = status.latency && status.latency.mode ? status.latency.mode : 'cli-per-request';
      $('heroAdvice').textContent = status.latency && status.latency.bottleneck
        ? status.latency.bottleneck
        : '当前版本采用 cursor-agent 每请求启动一次，稳定性优先，低延迟需要后续做常驻 worker。';
      $('latencyGateway').textContent = '健康检查通常只看网络和进程活性，当前是 ' + state.baseUrl + '/health。';
      $('latencyCli').textContent = '非流式请求已经改成 JSON 输出；最近 prompt ' + (status.stats.lastPromptChars || 0) + ' 字符，CLI/上游计费 prompt ' + (status.stats.lastPromptTokens || 0) + ' tokens。';
      $('latencyUpstream').textContent = '最快的模型通常是 composer-2-fast / composer-2.5-fast / auto，适合高频内部调用。';
      const recommended = $('recommendedModels');
      if (recommended && status.latency && Array.isArray(status.latency.recommendedFastModels)) {
        recommended.innerHTML = status.latency.recommendedFastModels.map((model) => '<span class="pill good">' + escapeHtml(model) + '</span>').join('');
      }

      renderAccountPanel(state.accountPayload);
      setModels(models);
    }

    async function refresh() {
      setStatus('正在刷新...');
      const [status, models, accountPayload] = await Promise.all([
        api('/status'),
        api('/models'),
        api('/account'),
      ]);
      render(status, Array.isArray(models.data) ? models.data : [], accountPayload);
      setStatus('已刷新。');
    }

    async function login() {
      state.token = $('adminPassword').value.trim();
      if (!state.token) {
        setStatus('请先输入管理密码。');
        return;
      }
      try {
        const status = await api('/status');
        if (state.remember) {
          localStorage.setItem('cursor_gateway_admin_password', state.token);
          localStorage.setItem('cursor_gateway_admin_remember', '1');
        } else {
          localStorage.removeItem('cursor_gateway_admin_password');
          localStorage.removeItem('cursor_gateway_admin_remember');
        }
        setLoginVisible(false);
        const [models, accountPayload] = await Promise.all([
          api('/models'),
          api('/account'),
        ]);
        render(status, Array.isArray(models.data) ? models.data : [], accountPayload);
        setStatus('已登录管理台。');
      } catch (error) {
        setStatus('管理密码不正确。');
      }
    }

    async function startOAuth() {
      $('oauthStatus').textContent = '正在生成 Cursor 授权链接...';
      try {
        const result = await api('/oauth/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        state.accountPayload = { account: result.account || {}, oauth: result.session || {} };
        state.oauthUrl = result.session && result.session.url ? result.session.url : state.oauthUrl;
        renderAccountPanel(state.accountPayload);
        if (state.oauthUrl) {
          await navigator.clipboard.writeText(state.oauthUrl).catch(() => {});
        }
      } catch (error) {
        $('oauthStatus').textContent = '生成授权链接失败: ' + error.message;
      }
    }

    async function submitCallback() {
      $('oauthStatus').textContent = '正在检查 Cursor 授权结果...';
      try {
        const result = await api('/oauth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callbackUrl: $('callbackUrl').value.trim() }),
        });
        state.accountPayload = { account: result.account || {}, oauth: result.session || {} };
        renderAccountPanel(state.accountPayload);
        if (result.ok) await refresh();
      } catch (error) {
        $('oauthStatus').textContent = '暂未完成登录: ' + error.message;
      }
    }

    async function runProbe() {
      const model = $('probeModel').value || 'composer-2-fast';
      const started = performance.now();
      $('probeResult').textContent = '正在请求 ' + model + '，这会消耗一次 Cursor 调用...';
      try {
        const result = await api('/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        const browserMs = Math.round(performance.now() - started);
        $('probeResult').textContent = [
          '模型: ' + result.model,
          '服务端总耗时: ' + fmtMs(result.durationMs),
          '浏览器感知耗时: ' + fmtMs(browserMs),
          '返回预览: ' + (result.contentPreview || '-'),
        ].join('\\n');
        await refresh();
      } catch (error) {
        $('probeResult').textContent = '延迟自检失败: ' + error.message;
      }
    }

    async function logoutCursor() {
      $('oauthStatus').textContent = '正在退出 Cursor 账号...';
      try {
        const result = await api('/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        state.accountPayload = { account: result.account || {}, oauth: result.session || {} };
        state.oauthUrl = '';
        renderAccountPanel(state.accountPayload);
        await refresh();
      } catch (error) {
        $('oauthStatus').textContent = '退出失败: ' + error.message;
      }
    }

    $('loginBtn').addEventListener('click', login);
    $('adminPassword').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') login();
    });
    $('rememberBtn').addEventListener('click', () => {
      state.remember = !state.remember;
      $('rememberBtn').textContent = state.remember ? '已记住本浏览器' : '记住本浏览器';
      if (!state.remember) {
        localStorage.removeItem('cursor_gateway_admin_password');
        localStorage.removeItem('cursor_gateway_admin_remember');
      }
    });
    $('logoutBtn').addEventListener('click', () => {
      state.token = '';
      localStorage.removeItem('cursor_gateway_admin_password');
      localStorage.removeItem('cursor_gateway_admin_remember');
      $('adminPassword').value = '';
      setLoginVisible(true);
      setStatus('已退出管理台。');
    });
    $('refreshBtn').addEventListener('click', refresh);
    $('copyBaseBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.baseUrl + '/v1');
      setStatus('基础地址已复制。');
    });
    $('copyHeroBaseBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.baseUrl + '/v1');
      setStatus('NewAPI Base URL 已复制。');
    });
    $('copyInlineBaseBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.baseUrl + '/v1');
      setStatus('NewAPI Base URL 已复制。');
    });
    $('heroStartOAuthBtn').addEventListener('click', startOAuth);
    $('startOAuthBtn').addEventListener('click', startOAuth);
    $('runProbeBtn').addEventListener('click', runProbe);
    $('openOAuthBtn').addEventListener('click', () => {
      if (state.oauthUrl) window.open(state.oauthUrl, '_blank', 'noopener,noreferrer');
    });
    $('copyOAuthBtn').addEventListener('click', async () => {
      if (!state.oauthUrl) return;
      await navigator.clipboard.writeText(state.oauthUrl);
      $('oauthStatus').textContent = '授权链接已复制。';
    });
    $('submitCallbackBtn').addEventListener('click', submitCallback);
    $('logoutCursorBtn').addEventListener('click', logoutCursor);

    if (state.remember && state.token) {
      $('adminPassword').value = state.token;
      login();
    }
  </script>
</body>
</html>`;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  return raw ? JSON.parse(raw) : {};
}

function isAuthorized(req) {
  if (!config.requireApiKey) return true;
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const apiKey = req.headers["x-api-key"] || "";
  return bearer === config.apiKey || apiKey === config.apiKey;
}

function isAdminAuthorized(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const password = req.headers["x-admin-password"] || "";
  return bearer === config.adminPassword || password === config.adminPassword;
}

function beginTrackedRequest(model, promptChars, stream) {
  const started = Date.now();
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  stats.totalPromptChars += promptChars;
  stats.lastModel = model;
  stats.lastRequestAt = started;
  if (stream) stats.streamedRequests += 1;

  let finished = false;
  return (ok, details = {}) => {
    if (finished) return;
    finished = true;
    const duration = Date.now() - started;
    stats.activeRequests = Math.max(0, stats.activeRequests - 1);
    stats.lastDurationMs = duration;
    if (typeof details.promptChars === "number") {
      stats.lastPromptChars = Math.max(0, details.promptChars);
    }
    if (details.usage && typeof details.usage === "object") {
      const usage = details.usage;
      stats.lastPromptTokens = Number(usage.prompt_tokens) || 0;
      stats.lastCompletionTokens = Number(usage.completion_tokens) || 0;
      stats.lastTotalTokens = Number(usage.total_tokens) || 0;
    }
    if (ok) {
      stats.successRequests += 1;
      stats.totalDurationMs += duration;
      if (typeof details.outputChars === "number") {
        stats.totalOutputChars += Math.max(0, details.outputChars);
      }
    } else {
      stats.failedRequests += 1;
      stats.lastError = String(details.error || "unknown error").slice(0, 600);
    }
  };
}

function spawnCursorAgent(prompt, model, options = {}) {
  const args = buildCursorAgentArgs(model, options);

  const child = spawn(resolveCursorAgentBinary(), args, {
    cwd: config.workspace,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdin.write(prompt);
  child.stdin.end();
  return child;
}

async function* readJsonEvents(stream) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += Buffer.from(chunk).toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch {
        log("debug", "Ignoring non-json cursor-agent line", { preview: trimmed.slice(0, 160) });
      }
    }
  }
  const trimmed = buffer.trim();
  if (trimmed) {
    try {
      yield JSON.parse(trimmed);
    } catch {
      log("debug", "Ignoring trailing non-json cursor-agent line", { preview: trimmed.slice(0, 160) });
    }
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
}

function readStreamText(stream) {
  return new Promise((resolve, reject) => {
    let output = "";
    stream.on("data", (chunk) => {
      output += Buffer.from(chunk).toString("utf8");
    });
    stream.on("end", () => resolve(output));
    stream.on("error", reject);
  });
}

function parseCursorJsonResult(output) {
  const text = stripAnsi(output).replace(/^\uFEFF/, "").trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function runCompletion(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const model = normalizeModel(body?.model);
  const prompt = buildPromptFromMessages(messages);
  const finishRequest = beginTrackedRequest(model, prompt.length, false);
  const child = spawnCursorAgent(prompt, model, { stream: false });
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += Buffer.from(chunk).toString("utf8");
  });

  const [stdout, code] = await Promise.all([
    readStreamText(child.stdout),
    waitForExit(child),
  ]);
  if (code !== 0) {
    const message = stripAnsi(stderr).trim() || `cursor-agent exited with code ${String(code ?? "unknown")}`;
    finishRequest(false, { error: message, promptChars: prompt.length });
    throw new Error(message);
  }

  let payload;
  try {
    payload = parseCursorJsonResult(stdout);
  } catch {
    const message = "cursor-agent returned invalid JSON output";
    finishRequest(false, { error: message, promptChars: prompt.length });
    throw new Error(message);
  }

  const assistantText = typeof payload?.result === "string" ? payload.result : "";
  const reasoningText = typeof payload?.reasoning === "string" ? payload.reasoning : "";
  const usage = normalizeUsage(payload?.usage);
  finishRequest(true, { outputChars: assistantText.length + reasoningText.length, promptChars: prompt.length, usage });
  return createChatCompletion(model, assistantText, reasoningText, usage);
}

async function streamCompletion(res, body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const model = normalizeModel(body?.model);
  const prompt = buildPromptFromMessages(messages);
  const finishRequest = beginTrackedRequest(model, prompt.length, true);
  const child = spawnCursorAgent(prompt, model, { stream: true });
  const tracker = new MixedDeltaTracker();
  const id = `cursor-gateway-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let stderr = "";
  let usage;
  let outputChars = 0;

  child.stderr.on("data", (chunk) => {
    stderr += Buffer.from(chunk).toString("utf8");
  });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });

  try {
    for await (const event of readJsonEvents(child.stdout)) {
      if (event?.type === "result") usage = normalizeUsage(event.usage) ?? usage;

      const assistant = extractAssistantText(event);
      if (assistant) {
        const delta = tracker.nextText(assistant);
        if (delta) {
          outputChars += delta.length;
          res.write(sse(createChunk(id, created, model, { content: delta })));
        }
      }

      const thinking = extractThinkingText(event);
      if (thinking) {
        const delta = tracker.nextThinking(thinking);
        if (delta) {
          outputChars += delta.length;
          res.write(sse(createChunk(id, created, model, { reasoning_content: delta })));
        }
      }
    }

    const code = await waitForExit(child);
    if (code !== 0) {
      const message = stripAnsi(stderr).trim() || `cursor-agent exited with code ${String(code ?? "unknown")}`;
      finishRequest(false, { error: message, promptChars: prompt.length });
      res.write(sse(createChunk(id, created, model, { content: `cursor-gateway error: ${message}` }, true)));
      res.write(sseDone());
      res.end();
      return;
    }

    if (usage) {
      res.write(sse({ id, object: "chat.completion.chunk", created, model, choices: [], usage }));
    }
    res.write(sse(createChunk(id, created, model, {}, true)));
    res.write(sseDone());
    res.end();
    finishRequest(true, { outputChars, promptChars: prompt.length, usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRequest(false, { error: message, promptChars: prompt.length });
    res.write(sse(createChunk(id, created, model, { content: `cursor-gateway error: ${message}` }, true)));
    res.write(sseDone());
    res.end();
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if ((url.pathname === "/admin" || url.pathname === "/admin/") && req.method === "GET") {
    const response = html(200, buildAdminHtml());
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if (url.pathname.startsWith("/admin/api/")) {
    if (!isAdminAuthorized(req)) {
      const response = openAiError(401, "authentication_error", "Invalid or missing admin password");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/status" && req.method === "GET") {
      const response = json(200, getStatusPayload());
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/account" && req.method === "GET") {
      const response = json(200, {
        ok: true,
        account: getCursorAccountSnapshot(),
        oauth: getOAuthSessionSnapshot(),
        apiKeyConfigured: Boolean(config.apiKey),
        adminPasswordConfigured: Boolean(config.adminPassword),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/oauth/session" && req.method === "GET") {
      const response = json(200, {
        ok: true,
        session: getOAuthSessionSnapshot(),
        account: getCursorAccountSnapshot(),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/oauth/start" && req.method === "POST") {
      try {
        const result = await startCursorOAuthSession();
        const response = json(200, {
          ok: true,
          ...result,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response = openAiError(502, "upstream_error", message);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (url.pathname === "/admin/api/oauth/callback" && req.method === "POST") {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
        res.writeHead(response.status, response.headers);
        res.end(response.body);
        return;
      }

      const result = await waitForCursorOAuthCompletion(body?.callbackUrl || body?.url || "");
      const response = json(200, {
        ok: result.ok,
        ...result,
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/logout" && req.method === "POST") {
      const response = json(200, {
        ok: true,
        ...logoutCursorAccount(),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/models" && req.method === "GET") {
      const created = Math.floor(Date.now() / 1000);
      const response = json(200, {
        object: "list",
        data: listModels().map((model) => ({
          id: model.id,
          name: model.name || model.id,
          object: "model",
          created,
          owned_by: "cursor",
        })),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/admin/api/probe" && req.method === "POST") {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
        res.writeHead(response.status, response.headers);
        res.end(response.body);
        return;
      }

      const model = normalizeModel(body?.model || config.probeModel);
      const started = Date.now();
      try {
        const payload = await runCompletion({
          model,
          messages: [
            { role: "system", content: "只返回 OK，不要解释。" },
            { role: "user", content: "OK" },
          ],
        });
        const response = json(200, {
          ok: true,
          model,
          durationMs: Date.now() - started,
          contentPreview: typeof payload?.choices?.[0]?.message?.content === "string"
            ? payload.choices[0].message.content.slice(0, 120)
            : "",
          usage: payload?.usage || null,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response = openAiError(502, "upstream_error", message);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    const response = openAiError(404, "not_found_error", `Unsupported admin path: ${url.pathname}`);
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if (url.pathname === "/health" && req.method === "GET") {
    const response = json(200, {
      ok: true,
      mode: "cursor-agent",
      workspace: config.workspace,
      auth: config.requireApiKey ? "required" : "disabled",
      memory: getMemorySnapshot(),
    });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if (!isAuthorized(req)) {
    const response = openAiError(401, "authentication_error", "Invalid or missing API key");
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if ((url.pathname === "/v1/models" || url.pathname === "/models") && req.method === "GET") {
    const created = Math.floor(Date.now() / 1000);
    const response = json(200, {
      object: "list",
      data: listModels().map((model) => ({
        id: model.id,
        object: "model",
        created,
        owned_by: "cursor",
      })),
    });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if ((url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions") && req.method === "POST") {
    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (body?.stream === true) {
      await streamCompletion(res, body);
      return;
    }

    try {
      const payload = await runCompletion(body);
      const response = json(200, payload);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response = openAiError(502, "upstream_error", message);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    }
    return;
  }

  const response = openAiError(404, "not_found_error", `Unsupported path: ${url.pathname}`);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export {
  buildCursorAgentArgs,
  buildPromptFromMessages,
  extractCursorLoginUrl,
  listModels,
  normalizeModel,
  parseCursorAboutOutput,
  parseCursorModelsOutput,
  parseCursorLoginStatus,
  stripPromptNoise,
};

const argvEntrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === argvEntrypoint) {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "Unhandled request error", { message });
      const response = openAiError(500, "internal_error", message);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
  });

  server.listen(config.port, config.host, () => {
    log("info", `listening on http://${config.host}:${config.port}/v1`, {
      workspace: config.workspace,
      auth: config.requireApiKey ? "required" : "disabled",
    });
  });

  const shutdown = () => {
    log("info", "shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
