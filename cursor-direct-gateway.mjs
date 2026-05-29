#!/usr/bin/env node
import { createServer } from "node:http";
import net from "node:net";
import http2 from "node:http2";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { buildDirectAdminHtml } from "./direct-admin-page.mjs";
import {
  createClaudeMessageFromProviderTurn,
  createClaudeMessageStreamEventsFromProviderTurn,
  createOpenAIChatCompletionFromProviderTurn,
  createOpenAIChatCompletionStreamChunk,
} from "./provider-events.mjs";
import {
  createCodeBuddyHeaders,
  normalizeBaseUrl as normalizeCodeBuddyBaseUrl,
  normalizeCodeBuddyModels,
  runCodeBuddyCompletion,
} from "./codebuddy-provider.mjs";
import {
  getCodeBuddyAccountsPath,
  importCodeBuddyAccounts,
  markCodeBuddyAccountResult,
  readCodeBuddyAccountsStore,
  resolveCodeBuddyAccountHeaders,
  selectCodeBuddyAccount,
  summarizeCodeBuddyAccount,
  summarizeCodeBuddyAccountsStore,
  writeCodeBuddyAccountsStore,
} from "./codebuddy-account-pool.mjs";
import {
  buildCodeBuddyOAuthAccountFromTokenData,
  pollCodeBuddyPluginAuth,
  startCodeBuddyPluginAuth,
} from "./codebuddy-oauth.mjs";

const DEFAULT_AUTH_PATH = path.join(homedir(), ".config", "cursor", "auth.json");
const DEFAULT_CODEBUDDY_MODELS = [
  "codebuddy/auto",
  "codebuddy/deepseek-v3-2-volc",
  "codebuddy/glm-4.7",
  "codebuddy/glm-4.6",
  "codebuddy/deepseek-v3.1",
  "codebuddy/deepseek-v3-0324",
  "codebuddy/hunyuan-chat",
].join(",");
const DEFAULT_CODEBUDDY_CHAT_COMPLETIONS_PATH = "/v2/chat/completions";
const DEFAULT_DIRECT_PARSE_LIMITS = {
  maxDepth: 8,
  maxFields: 6000,
  maxStrings: 3000,
  maxStringBytes: 32000,
  maxNestedBytes: 256000,
  maxFrameBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
};

function firstEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function resolveDefaultCodeBuddyBaseUrl() {
  const site = firstEnvValue("CURSOR_DIRECT_CODEBUDDY_SITE", "CODEBUDDY_SITE").toLowerCase();
  const internetEnvironment = firstEnvValue(
    "CURSOR_DIRECT_CODEBUDDY_INTERNET_ENVIRONMENT",
    "CODEBUDDY_INTERNET_ENVIRONMENT",
  ).toLowerCase();
  if (["internal", "ioa"].includes(internetEnvironment)) return "https://copilot.tencent.com";
  if (["domestic", "cn", "china"].includes(site) || ["domestic", "cn", "china"].includes(internetEnvironment)) {
    return "https://www.codebuddy.cn";
  }
  return "https://www.codebuddy.ai";
}

const config = {
  host: process.env.CURSOR_DIRECT_HOST || "127.0.0.1",
  port: Number(process.env.CURSOR_DIRECT_PORT || "32126"),
  apiKey: process.env.CURSOR_DIRECT_API_KEY || process.env.CURSOR_GATEWAY_API_KEY || "",
  publicBaseUrl: process.env.CURSOR_DIRECT_PUBLIC_BASE_URL || "",
  adminPassword:
    process.env.CURSOR_DIRECT_ADMIN_PASSWORD ||
    process.env.CURSOR_GATEWAY_ADMIN_PASSWORD ||
    process.env.CURSOR_DIRECT_API_KEY ||
    process.env.CURSOR_GATEWAY_API_KEY ||
    "",
  requireApiKey:
    process.env.CURSOR_DIRECT_REQUIRE_API_KEY === "true" ||
    Boolean(process.env.CURSOR_DIRECT_API_KEY || process.env.CURSOR_GATEWAY_API_KEY),
  authPath: process.env.CURSOR_DIRECT_AUTH_PATH || DEFAULT_AUTH_PATH,
  accountsPath:
    process.env.CURSOR_DIRECT_ACCOUNTS_PATH ||
    path.join(path.dirname(process.env.CURSOR_DIRECT_AUTH_PATH || DEFAULT_AUTH_PATH), "direct-accounts.json"),
  codeBuddyAccountsPath:
    process.env.CODEBUDDY_PROXY_ACCOUNTS_PATH ||
    process.env.CURSOR_DIRECT_CODEBUDDY_ACCOUNTS_PATH ||
    getCodeBuddyAccountsPath(),
  codeBuddyBaseUrl:
    process.env.CURSOR_DIRECT_CODEBUDDY_BASE_URL ||
    process.env.CODEBUDDY_BASE_URL ||
    resolveDefaultCodeBuddyBaseUrl(),
  codeBuddyApiEndpoint:
    process.env.CURSOR_DIRECT_CODEBUDDY_API_ENDPOINT ||
    process.env.CODEBUDDY_API_ENDPOINT ||
    "",
  codeBuddyChatCompletionsPath:
    process.env.CURSOR_DIRECT_CODEBUDDY_CHAT_COMPLETIONS_PATH ||
    process.env.CODEBUDDY_CHAT_COMPLETIONS_PATH ||
    DEFAULT_CODEBUDDY_CHAT_COMPLETIONS_PATH,
  codeBuddyInternetEnvironment:
    process.env.CURSOR_DIRECT_CODEBUDDY_INTERNET_ENVIRONMENT ||
    process.env.CODEBUDDY_INTERNET_ENVIRONMENT ||
    "",
  codeBuddyModels: process.env.CURSOR_DIRECT_CODEBUDDY_MODELS || DEFAULT_CODEBUDDY_MODELS,
  apiBaseUrl: process.env.CURSOR_DIRECT_API_BASE_URL || "https://api2.cursor.sh",
  agentHost: process.env.CURSOR_DIRECT_AGENT_HOST || "agentn.api5.cursor.sh",
  clientVersion: process.env.CURSOR_DIRECT_CLIENT_VERSION || "cli-2026.05.24-dda726e",
  idleMs: Number(process.env.CURSOR_DIRECT_IDLE_MS || "6000"),
  hardTimeoutMs: Number(process.env.CURSOR_DIRECT_TIMEOUT_MS || "60000"),
  streamKeepAliveMs: Number(process.env.CURSOR_DIRECT_STREAM_KEEPALIVE_MS || "15000"),
  modelsCacheTtlMs: Number(process.env.CURSOR_DIRECT_MODELS_CACHE_TTL_MS || "300000"),
  authSummaryCacheTtlMs: Number(process.env.CURSOR_DIRECT_AUTH_CACHE_TTL_MS || "5000"),
  oauthSessionCacheTtlMs: Number(process.env.CURSOR_DIRECT_OAUTH_CACHE_TTL_MS || "1000"),
  parseMaxDepth: Number(process.env.CURSOR_DIRECT_PARSE_MAX_DEPTH || String(DEFAULT_DIRECT_PARSE_LIMITS.maxDepth)),
  parseMaxFields: Number(process.env.CURSOR_DIRECT_PARSE_MAX_FIELDS || String(DEFAULT_DIRECT_PARSE_LIMITS.maxFields)),
  parseMaxStrings: Number(process.env.CURSOR_DIRECT_PARSE_MAX_STRINGS || String(DEFAULT_DIRECT_PARSE_LIMITS.maxStrings)),
  parseMaxStringBytes: Number(process.env.CURSOR_DIRECT_PARSE_MAX_STRING_BYTES || String(DEFAULT_DIRECT_PARSE_LIMITS.maxStringBytes)),
  parseMaxNestedBytes: Number(process.env.CURSOR_DIRECT_PARSE_MAX_NESTED_BYTES || String(DEFAULT_DIRECT_PARSE_LIMITS.maxNestedBytes)),
  parseMaxFrameBytes: Number(process.env.CURSOR_DIRECT_PARSE_MAX_FRAME_BYTES || String(DEFAULT_DIRECT_PARSE_LIMITS.maxFrameBytes)),
  parseMaxTotalBytes: Number(process.env.CURSOR_DIRECT_PARSE_MAX_TOTAL_BYTES || String(DEFAULT_DIRECT_PARSE_LIMITS.maxTotalBytes)),
  logLevel: process.env.CURSOR_DIRECT_LOG_LEVEL || "info",
};

const startedAt = Date.now();
const OAUTH_URL_TIMEOUT_MS = 10000;
const OAUTH_COMPLETE_TIMEOUT_MS = Number(process.env.CURSOR_DIRECT_OAUTH_TIMEOUT_MS || "180000");
const OAUTH_POLL_INTERVAL_MS = 2000;
const CODEBUDDY_OAUTH_SESSION_TTL_MS = Number(process.env.CURSOR_DIRECT_CODEBUDDY_OAUTH_TTL_MS || "900000");
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const CONNECT_COMPRESSION_FLAG = 0x01;
const CONNECT_END_STREAM_FLAG = 0x02;
const PROTO_WIRE_VARINT = 0;
const PROTO_WIRE_FIXED64 = 1;
const PROTO_WIRE_LENGTH_DELIMITED = 2;
const PROTO_WIRE_FIXED32 = 5;
const CURSOR_ASM_INTERACTION_UPDATE = 1;
const CURSOR_ASM_EXEC_SERVER_MESSAGE = 2;
const CURSOR_ASM_CONVERSATION_CHECKPOINT = 3;
const CURSOR_ASM_KV_SERVER_MESSAGE = 4;
const CURSOR_ACM_EXEC_CLIENT_MESSAGE = 2;
const CURSOR_ACM_KV_CLIENT_MESSAGE = 3;
const CURSOR_IU_TEXT_DELTA = 1;
const CURSOR_IU_THINKING_DELTA = 4;
const CURSOR_IU_THINKING_COMPLETED = 5;
const CURSOR_IU_TOKEN_DELTA = 8;
const CURSOR_IU_HEARTBEAT = 13;
const CURSOR_IU_TURN_ENDED = 14;
const CURSOR_TEXT_DELTA_TEXT = 1;
const CURSOR_THINKING_DELTA_TEXT = 1;
const CURSOR_TOKEN_DELTA_VALUE = 1;
const CURSOR_KSM_ID = 1;
const CURSOR_KSM_GET_BLOB_ARGS = 2;
const CURSOR_KSM_SET_BLOB_ARGS = 3;
const CURSOR_KCM_ID = 1;
const CURSOR_KCM_GET_BLOB_RESULT = 2;
const CURSOR_KCM_SET_BLOB_RESULT = 3;
const CURSOR_BLOB_ID = 1;
const CURSOR_BLOB_DATA = 2;
const CURSOR_ESM_ID = 1;
const CURSOR_ESM_SHELL_ARGS = 2;
const CURSOR_ESM_WRITE_ARGS = 3;
const CURSOR_ESM_DELETE_ARGS = 4;
const CURSOR_ESM_GREP_ARGS = 5;
const CURSOR_ESM_READ_ARGS = 7;
const CURSOR_ESM_LS_ARGS = 8;
const CURSOR_ESM_DIAGNOSTICS_ARGS = 9;
const CURSOR_ESM_REQUEST_CONTEXT_ARGS = 10;
const CURSOR_ESM_MCP_ARGS = 11;
const CURSOR_ESM_SHELL_STREAM_ARGS = 14;
const CURSOR_ESM_EXEC_ID = 15;
const CURSOR_ESM_BACKGROUND_SHELL_SPAWN = 16;
const CURSOR_ESM_FETCH_ARGS = 20;
const CURSOR_ESM_WRITE_SHELL_STDIN_ARGS = 23;
const CURSOR_ECM_ID = 1;
const CURSOR_ECM_SHELL_RESULT = 2;
const CURSOR_ECM_WRITE_RESULT = 3;
const CURSOR_ECM_DELETE_RESULT = 4;
const CURSOR_ECM_GREP_RESULT = 5;
const CURSOR_ECM_READ_RESULT = 7;
const CURSOR_ECM_LS_RESULT = 8;
const CURSOR_ECM_DIAGNOSTICS_RESULT = 9;
const CURSOR_ECM_REQUEST_CONTEXT_RESULT = 10;
const CURSOR_ECM_MCP_RESULT = 11;
const CURSOR_ECM_SHELL_STREAM = 14;
const CURSOR_ECM_EXEC_ID = 15;
const CURSOR_ECM_BACKGROUND_SHELL_SPAWN_RESULT = 16;
const CURSOR_ECM_FETCH_RESULT = 20;
const CURSOR_ECM_WRITE_SHELL_STDIN_RESULT = 23;
const CURSOR_REJECTED_READ = 3;
const CURSOR_REJECTED_SHELL = 5;
const CURSOR_REJECTED_WRITE = 5;
const CURSOR_REJECTED_DELETE = 3;
const CURSOR_REJECTED_LS = 3;
const CURSOR_ERROR_GREP = 2;
const CURSOR_ERROR_FETCH = 2;
const CURSOR_REJECTED_BACKGROUND_SHELL = 2;
const CURSOR_ERROR_WRITE_SHELL_STDIN = 2;
const CURSOR_REQUEST_CONTEXT_SUCCESS = 1;
const CURSOR_REQUEST_CONTEXT = 1;
const CURSOR_MCP_ERROR = 2;
const CURSOR_PATH = 1;
const CURSOR_REASON = 2;
const CURSOR_COMMAND = 1;
const CURSOR_WORKING_DIRECTORY = 2;
const CURSOR_SHELL_REASON = 3;
const CURSOR_SHELL_IS_READONLY = 4;
const CURSOR_ERROR_TEXT = 1;
const CURSOR_FETCH_URL = 1;
const CURSOR_FETCH_ERROR = 2;
const CURSOR_EXEC_REJECT_REASON = "Tool not available in this environment. Use the MCP tools provided instead.";
const stats = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  activeRequests: 0,
  totalDurationMs: 0,
  lastModel: "",
  lastError: "",
  lastDurationMs: 0,
  lastPromptChars: 0,
  lastOutputChars: 0,
  lastRequestAt: 0,
  lastStream: false,
  lastUpstreamBytes: 0,
  lastStringCount: 0,
  lastDeltaCount: 0,
};

function cloneMetadataValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function createMetadataCacheEntry() {
  return { expiresAt: 0, value: null };
}

function createDirectMetadataCaches() {
  return {
    models: createMetadataCacheEntry(),
    authSummary: createMetadataCacheEntry(),
    oauthSession: createMetadataCacheEntry(),
    codeBuddyOAuthSession: createMetadataCacheEntry(),
  };
}

const metadataCaches = createDirectMetadataCaches();

function setMetadataCache(cache, value, options = {}) {
  if (!cache) return value;
  const now = Number(options.now || Date.now());
  const ttlMs = Math.max(0, Number(options.ttlMs || 0));
  cache.value = cloneMetadataValue(value);
  cache.expiresAt = now + ttlMs;
  return cloneMetadataValue(value);
}

function getMetadataCache(cache, options = {}) {
  if (!cache || cache.value == null) return null;
  const now = Number(options.now || Date.now());
  if (cache.expiresAt <= 0 || now >= cache.expiresAt) return null;
  return cloneMetadataValue(cache.value);
}

function clearMetadataCache(cache) {
  if (!cache) return;
  cache.expiresAt = 0;
  cache.value = null;
}

function invalidateDirectMetadataCaches(caches = metadataCaches) {
  clearMetadataCache(caches.models);
  clearMetadataCache(caches.authSummary);
  clearMetadataCache(caches.oauthSession);
  clearMetadataCache(caches.codeBuddyOAuthSession);
}

function log(level, message, meta = undefined) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] ?? 20) < (order[config.logLevel] ?? 20)) return;
  const line = `[cursor-direct] ${level.toUpperCase()} ${message}`;
  if (meta) console.error(line, JSON.stringify(meta));
  else console.error(line);
}

function normalizeDirectModel(model) {
  const raw = sanitizeModelName(model);
  const cleaned = raw
    .replace(/^cursor-acp\//, "")
    .replace(/^cursor\//, "")
    .replace(/^cursor-/, "");
  const anthropicAlias = normalizeAnthropicModelAlias(cleaned);
  if (anthropicAlias) return anthropicAlias;
  return ["auto", "default", "sonnet", "opus", "haiku"].includes(cleaned) ? "default" : cleaned;
}

function sanitizeModelName(model) {
  const raw = typeof model === "string" && model.trim() ? model.trim() : "auto";
  return raw
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)m\]?/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim() || "auto";
}

function normalizePublicModelName(model) {
  const cleaned = sanitizeModelName(model)
    .replace(/^cursor-acp\//, "")
    .replace(/^cursor\//, "")
    .replace(/^cursor-/, "");
  return cleaned === "default" ? "auto" : cleaned;
}

function normalizeApiPath(pathname) {
  let normalized = String(pathname || "/");
  while (normalized.startsWith("/v1/v1/")) {
    normalized = normalized.replace(/^\/v1\/v1(?=\/)/, "/v1");
  }
  return normalized === "/v1/v1" ? "/v1" : normalized;
}

function normalizeAnthropicModelAlias(model) {
  const text = String(model || "").trim().toLowerCase();
  if (!text.startsWith("claude-")) return "";

  const familyFirst = text.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:[-.](\d+))?/);
  if (familyFirst) {
    const [, family, major, minor] = familyFirst;
    return `${family}-${major}${minor ? `.${minor}` : ""}`;
  }

  const versionFirst = text.match(/^claude-(\d+)(?:[-.](\d+))?-(opus|sonnet|haiku)/);
  if (versionFirst) {
    const [, major, minor, family] = versionFirst;
    if (Number(major) >= 4) return `${family}-${major}${minor ? `.${minor}` : ""}`;
  }

  return "default";
}

function displayModelId(model) {
  return model === "default" ? "auto" : model;
}

function resolveGatewayProviderModel(model) {
  const cleaned = sanitizeModelName(model);
  const codeBuddyMatch = cleaned.match(/^codebuddy(?:(?:\/|:)(.*))?$/i);
  if (codeBuddyMatch) {
    const requestedModel = String(codeBuddyMatch[1] || "auto").trim() || "auto";
    const upstreamModel = requestedModel === "default" ? "auto" : requestedModel;
    return {
      provider: "codebuddy",
      model: upstreamModel,
      publicModel: `codebuddy/${upstreamModel}`,
    };
  }

  return {
    provider: "cursor",
    model: normalizeDirectModel(cleaned),
    publicModel: normalizePublicModelName(cleaned),
  };
}

function normalizeCodeBuddyPublicModelId(model) {
  const cleaned = sanitizeModelName(model);
  if (!cleaned || cleaned === "default" || cleaned === "auto") {
    return "codebuddy/auto";
  }
  if (/^codebuddy(?:\/|:|$)/i.test(cleaned)) {
    return resolveGatewayProviderModel(cleaned).publicModel;
  }
  return `codebuddy/${cleaned}`;
}

function listConfiguredCodeBuddyModels() {
  const raw = String(config.codeBuddyModels || DEFAULT_CODEBUDDY_MODELS).trim();
  let rows = [];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      rows = normalizeCodeBuddyModels(JSON.parse(raw));
    } catch {
      rows = [];
    }
  }
  if (rows.length === 0) {
    rows = raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => ({
        id: normalizeCodeBuddyPublicModelId(id),
        object: "model",
        name: normalizeCodeBuddyPublicModelId(id),
        owned_by: "codebuddy",
        supportsTools: true,
        supportsImages: false,
      }));
  } else {
    rows = rows.map((model) => ({
      ...model,
      id: normalizeCodeBuddyPublicModelId(model.id),
      name: model.name || normalizeCodeBuddyPublicModelId(model.id),
    }));
  }
  return rows.length > 0 ? rows : [{
    id: "codebuddy/auto",
    object: "model",
    name: "codebuddy/auto",
    owned_by: "codebuddy",
    supportsTools: true,
    supportsImages: false,
  }];
}

function base64UrlDecode(input) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function getJwtPayload(token) {
  try {
    return JSON.parse(base64UrlDecode(String(token).split(".")[1] || "").toString("utf8"));
  } catch {
    return {};
  }
}

function getJwtExpMs(token) {
  const payload = getJwtPayload(token);
  return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
}

function readAuthFile() {
  if (!existsSync(config.authPath)) {
    throw new Error(`Cursor auth file not found: ${config.authPath}`);
  }
  const auth = JSON.parse(readFileSync(config.authPath, "utf8"));
  if (!auth.accessToken) throw new Error(`Cursor auth file has no accessToken: ${config.authPath}`);
  return auth;
}

async function refreshAuthIfNeeded(auth) {
  const result = await refreshAuthRecord(auth);
  return result.accessToken;
}

async function getAccessToken() {
  const selection = await selectAndRefreshDirectAccount();
  return selection.account.accessToken;
}

function maskSecret(value, visible = 4) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= visible * 2) return `${text.slice(0, Math.max(1, visible))}...`;
  return `${text.slice(0, visible)}...${text.slice(-visible)}`;
}

function summarizeCursorAuth(auth, options = {}) {
  const accessToken = String(auth?.accessToken || auth?.access_token || "");
  const refreshToken = String(auth?.refreshToken || auth?.refresh_token || "");
  const payload = getJwtPayload(accessToken);
  const expiresAt = getJwtExpMs(accessToken);
  const email = payload.email || payload.userEmail || auth?.email || auth?.userEmail || "";
  const subject = payload.sub || payload.subject || "";

  return {
    loggedIn: Boolean(accessToken),
    authPath: options.authPath || config.authPath,
    email,
    subject,
    issuedAt: typeof payload.iat === "number" ? payload.iat * 1000 : 0,
    accessTokenExpiresAt: expiresAt,
    hasRefreshToken: Boolean(refreshToken),
    accessTokenPreview: maskSecret(accessToken, 6),
    refreshTokenPreview: maskSecret(refreshToken, 6),
  };
}

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

function createCodeBuddyOAuthSessionState() {
  return {
    id: "",
    token: "",
    provider: "codebuddy",
    status: "idle",
    site: "global",
    authState: "",
    url: "",
    launchUrl: "",
    accessUrl: "",
    callbackUrl: "",
    startedAt: 0,
    updatedAt: 0,
    completedAt: 0,
    confirmedAt: 0,
    error: "",
    authStatus: null,
    login: null,
  };
}

let codeBuddyOAuthSession = createCodeBuddyOAuthSessionState();

function normalizeDirectAccountAuth(input) {
  const source = typeof input === "object" && input ? input : {};
  return {
    accessToken: String(source.accessToken || source.access_token || ""),
    refreshToken: String(source.refreshToken || source.refresh_token || ""),
  };
}

function createEmptyAccountsStore() {
  return { version: 1, nextIndex: 0, accounts: [] };
}

function normalizeStoredDirectAccount(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { accessToken, refreshToken } = normalizeDirectAccountAuth(raw);
  if (!accessToken) return null;
  const payload = getJwtPayload(accessToken);
  const email = raw.email || raw.userEmail || payload.email || payload.userEmail || "";
  const subject = raw.subject || payload.sub || payload.subject || "";
  const now = Date.now();
  return {
    id: String(raw.id || createHash("sha256").update(`${subject}|${email}|${refreshToken}`).digest("hex").slice(0, 16)),
    label: String(raw.label || email || subject || "Cursor account"),
    email: String(email || ""),
    subject: String(subject || ""),
    enabled: raw.enabled !== false,
    source: String(raw.source || "pool"),
    authPath: raw.authPath || "",
    accessToken,
    refreshToken,
    accessTokenExpiresAt: Number(raw.accessTokenExpiresAt || getJwtExpMs(accessToken) || 0),
    createdAt: Number(raw.createdAt || now),
    updatedAt: Number(raw.updatedAt || now),
    lastUsedAt: Number(raw.lastUsedAt || 0),
    lastSelectedAt: Number(raw.lastSelectedAt || 0),
    successRequests: Number(raw.successRequests || 0),
    failedRequests: Number(raw.failedRequests || 0),
    lastError: String(raw.lastError || ""),
  };
}

function normalizeAccountsStore(store) {
  const input = store && typeof store === "object" ? store : createEmptyAccountsStore();
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .map(normalizeStoredDirectAccount)
    .filter(Boolean);
  const rawNext = Number.isInteger(input.nextIndex) ? input.nextIndex : 0;
  const nextIndex = accounts.length > 0 ? ((rawNext % accounts.length) + accounts.length) % accounts.length : 0;
  return { version: 1, nextIndex, accounts };
}

function readAccountsStore() {
  if (!existsSync(config.accountsPath)) return createEmptyAccountsStore();
  return normalizeAccountsStore(JSON.parse(readFileSync(config.accountsPath, "utf8")));
}

function writeAccountsStore(store) {
  const normalized = normalizeAccountsStore(store);
  mkdirSync(path.dirname(config.accountsPath), { recursive: true });
  writeFileSync(config.accountsPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

function createDirectAccount(auth, options = {}) {
  const now = Number(options.now || Date.now());
  const { accessToken, refreshToken } = normalizeDirectAccountAuth(auth);
  if (!accessToken || !refreshToken) {
    throw new Error("auth.json must include accessToken and refreshToken");
  }
  const payload = getJwtPayload(accessToken);
  const email = auth?.email || auth?.userEmail || payload.email || payload.userEmail || "";
  const subject = auth?.subject || payload.sub || payload.subject || "";
  const id = String(
    options.id ||
    auth?.id ||
    createHash("sha256").update(`${subject}|${email}|${refreshToken}`).digest("hex").slice(0, 16),
  );
  return {
    id,
    label: String(options.label || auth?.label || email || subject || `Cursor ${id.slice(0, 6)}`),
    email: String(email || ""),
    subject: String(subject || ""),
    enabled: auth?.enabled !== false && options.enabled !== false,
    source: String(options.source || auth?.source || "pool"),
    authPath: String(options.authPath || auth?.authPath || ""),
    accessToken,
    refreshToken,
    accessTokenExpiresAt: getJwtExpMs(accessToken),
    createdAt: Number(auth?.createdAt || now),
    updatedAt: now,
    lastUsedAt: Number(auth?.lastUsedAt || 0),
    lastSelectedAt: Number(auth?.lastSelectedAt || 0),
    successRequests: Number(auth?.successRequests || 0),
    failedRequests: Number(auth?.failedRequests || 0),
    lastError: String(auth?.lastError || ""),
  };
}

function createLegacyDirectAccount(auth, options = {}) {
  return createDirectAccount(auth, {
    ...options,
    id: "legacy-auth",
    label: options.label || "Legacy auth.json",
    source: "legacy",
    authPath: options.authPath || config.authPath,
  });
}

function summarizeDirectAccount(account) {
  const summary = summarizeCursorAuth(account, { authPath: account?.authPath || config.accountsPath });
  return {
    id: account?.id || "",
    label: account?.label || "",
    enabled: account?.enabled !== false,
    source: account?.source || "pool",
    loggedIn: summary.loggedIn,
    email: account?.email || summary.email || "",
    subject: account?.subject || summary.subject || "",
    authPath: account?.authPath || "",
    issuedAt: summary.issuedAt,
    accessTokenExpiresAt: Number(account?.accessTokenExpiresAt || summary.accessTokenExpiresAt || 0),
    hasRefreshToken: summary.hasRefreshToken,
    accessTokenPreview: summary.accessTokenPreview,
    refreshTokenPreview: summary.refreshTokenPreview,
    createdAt: Number(account?.createdAt || 0),
    updatedAt: Number(account?.updatedAt || 0),
    lastUsedAt: Number(account?.lastUsedAt || 0),
    lastSelectedAt: Number(account?.lastSelectedAt || 0),
    successRequests: Number(account?.successRequests || 0),
    failedRequests: Number(account?.failedRequests || 0),
    lastError: String(account?.lastError || ""),
  };
}

function summarizeAccountsStore(store, options = {}) {
  const normalized = normalizeAccountsStore(store);
  const accounts = normalized.accounts.map(summarizeDirectAccount);
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const primary = enabledAccounts[0] || accounts[0] || options.legacyAccount || null;
  return {
    ok: true,
    version: normalized.version,
    nextIndex: normalized.nextIndex,
    accountsPath: config.accountsPath,
    count: accounts.length,
    enabledCount: enabledAccounts.length,
    disabledCount: accounts.length - enabledAccounts.length,
    loggedIn: Boolean(primary?.loggedIn),
    primary: primary || null,
    accounts,
    legacy: options.legacyAccount || null,
    ...(primary || {}),
  };
}

function parseAccountsImportInput(input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return [];
    return parseAccountsImportInput(JSON.parse(text));
  }
  if (Array.isArray(input)) return input.flatMap(parseAccountsImportInput);
  if (!input || typeof input !== "object") return [];
  if (typeof input.authJson === "string") {
    return parseAccountsImportInput(input.authJson).map((account) => ({
      ...account,
      label: input.label || account.label,
      enabled: typeof input.enabled === "boolean" ? input.enabled : account.enabled,
    }));
  }
  if (Array.isArray(input.accounts)) return input.accounts.flatMap(parseAccountsImportInput);
  return [input];
}

function importDirectAccounts(store, input, options = {}) {
  const now = Number(options.now || Date.now());
  const nextStore = normalizeAccountsStore(store);
  const inputs = parseAccountsImportInput(input);
  const imported = [];

  for (const raw of inputs) {
    const account = createDirectAccount(raw, { now });
    const existingIndex = nextStore.accounts.findIndex((item) => (
      item.id === account.id ||
      (account.subject && item.subject === account.subject) ||
      (account.email && item.email === account.email)
    ));
    if (existingIndex >= 0) {
      const previous = nextStore.accounts[existingIndex];
      nextStore.accounts[existingIndex] = {
        ...previous,
        ...account,
        id: previous.id,
        createdAt: previous.createdAt || account.createdAt,
        successRequests: previous.successRequests || 0,
        failedRequests: previous.failedRequests || 0,
        lastUsedAt: previous.lastUsedAt || 0,
        lastSelectedAt: previous.lastSelectedAt || 0,
        lastError: "",
      };
      imported.push(nextStore.accounts[existingIndex]);
    } else {
      nextStore.accounts.push(account);
      imported.push(account);
    }
  }

  return {
    store: normalizeAccountsStore(nextStore),
    imported,
    summaries: imported.map(summarizeDirectAccount),
  };
}

function selectDirectAccount(store, options = {}) {
  const normalized = normalizeAccountsStore(store);
  const now = Number(options.now || Date.now());
  const accountId = options.accountId ? String(options.accountId) : "";

  if (accountId) {
    const selectedIndex = normalized.accounts.findIndex((account) => account.id === accountId);
    if (selectedIndex < 0) throw new Error(`Cursor direct account not found: ${accountId}`);
    const selected = normalized.accounts[selectedIndex];
    if (selected.enabled === false) throw new Error(`Cursor direct account is disabled: ${accountId}`);
    const nextAccounts = normalized.accounts.slice();
    nextAccounts[selectedIndex] = { ...selected, lastSelectedAt: now };
    return {
      account: nextAccounts[selectedIndex],
      store: { ...normalized, accounts: nextAccounts },
      index: selectedIndex,
      source: "pool",
    };
  }

  if (normalized.accounts.length > 0) {
    for (let offset = 0; offset < normalized.accounts.length; offset += 1) {
      const selectedIndex = (normalized.nextIndex + offset) % normalized.accounts.length;
      const selected = normalized.accounts[selectedIndex];
      if (!selected || selected.enabled === false || !selected.accessToken) continue;
      const nextAccounts = normalized.accounts.slice();
      nextAccounts[selectedIndex] = { ...selected, lastSelectedAt: now };
      return {
        account: nextAccounts[selectedIndex],
        store: {
          ...normalized,
          nextIndex: (selectedIndex + 1) % normalized.accounts.length,
          accounts: nextAccounts,
        },
        index: selectedIndex,
        source: "pool",
      };
    }
  }

  if (options.legacyAccount?.accessToken) {
    return {
      account: options.legacyAccount,
      store: normalized,
      index: -1,
      source: "legacy",
    };
  }

  throw new Error("No enabled Cursor direct accounts available");
}

function readLegacyDirectAccount() {
  try {
    return createLegacyDirectAccount(readAuthFile(), { authPath: config.authPath });
  } catch {
    return null;
  }
}

function updateStoredDirectAccount(accountId, updater) {
  const store = readAccountsStore();
  const index = store.accounts.findIndex((account) => account.id === accountId);
  if (index < 0) return null;
  const accounts = store.accounts.slice();
  accounts[index] = normalizeStoredDirectAccount(updater(accounts[index]));
  writeAccountsStore({ ...store, accounts });
  return accounts[index];
}

async function refreshDirectAccount(account, options = {}) {
  const result = await refreshAuthRecord(account, {
    force: options.force,
    write: account?.source === "legacy",
    authPath: account?.authPath || config.authPath,
  });
  return {
    ...account,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: getJwtExpMs(result.accessToken),
    updatedAt: result.refreshed ? Date.now() : account.updatedAt,
    refreshed: Boolean(result.refreshed),
  };
}

async function selectAndRefreshDirectAccount(options = {}) {
  const store = readAccountsStore();
  const selected = selectDirectAccount(store, {
    accountId: options.accountId,
    legacyAccount: readLegacyDirectAccount(),
  });
  if (selected.source === "pool") {
    let nextStore = writeAccountsStore(selected.store);
    const refreshed = await refreshDirectAccount(selected.account, { force: options.force });
    if (refreshed.refreshed) {
      const accounts = nextStore.accounts.slice();
      accounts[selected.index] = normalizeStoredDirectAccount(refreshed);
      nextStore = writeAccountsStore({ ...nextStore, accounts });
      invalidateDirectMetadataCaches();
    }
    return { ...selected, account: refreshed, store: nextStore };
  }

  const refreshed = await refreshDirectAccount(selected.account, { force: options.force });
  return { ...selected, account: refreshed };
}

function markDirectAccountResult(selection, ok, details = {}) {
  if (!selection || selection.source !== "pool" || !selection.account?.id) return;
  updateStoredDirectAccount(selection.account.id, (account) => ({
    ...account,
    lastUsedAt: Date.now(),
    successRequests: Number(account.successRequests || 0) + (ok ? 1 : 0),
    failedRequests: Number(account.failedRequests || 0) + (ok ? 0 : 1),
    lastError: ok ? "" : String(details.error || "unknown error").slice(0, 600),
  }));
}

function readCodeBuddyStore() {
  return readCodeBuddyAccountsStore({ accountsPath: config.codeBuddyAccountsPath });
}

function writeCodeBuddyStore(store) {
  return writeCodeBuddyAccountsStore(store, { accountsPath: config.codeBuddyAccountsPath });
}

function summarizeCodeBuddyStore(store) {
  return summarizeCodeBuddyAccountsStore(store, { accountsPath: config.codeBuddyAccountsPath });
}

function updateStoredCodeBuddyAccount(accountId, updater) {
  const store = readCodeBuddyStore();
  const index = store.accounts.findIndex((account) => account.id === accountId);
  if (index < 0) return null;
  const accounts = store.accounts.slice();
  accounts[index] = updater(accounts[index]);
  writeCodeBuddyStore({ ...store, accounts });
  return accounts[index];
}

function selectCodeBuddyAccountFromPool(options = {}) {
  const selected = selectCodeBuddyAccount(readCodeBuddyStore(), {
    accountId: options.accountId,
  });
  if (selected.source === "pool") {
    const store = writeCodeBuddyStore(selected.store);
    return { ...selected, store };
  }
  return selected;
}

async function runCodeBuddyCompletionFromPool(messages = [], options = {}) {
  const selection = selectCodeBuddyAccountFromPool({ accountId: options.accountId });
  const headers = await resolveCodeBuddyAccountHeaders(selection.account);
  let emittedOnAttempt = false;
  try {
    const result = await runCodeBuddyCompletion(messages, {
      baseUrl: selection.account.baseUrl || config.codeBuddyBaseUrl,
      apiEndpoint: selection.account.apiEndpoint || config.codeBuddyApiEndpoint,
      chatCompletionsPath: selection.account.chatCompletionsPath || config.codeBuddyChatCompletionsPath,
      token: selection.account.bearerToken || selection.account.apiKey,
      bearerToken: selection.account.bearerToken,
      apiKey: selection.account.apiKey,
      headers,
      model: options.model,
      stream: options.stream !== false,
      tools: options.tools,
      toolChoice: options.toolChoice,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
      onEvent: options.onEvent,
      onDelta: (delta) => {
        emittedOnAttempt = emittedOnAttempt || Boolean(delta);
        options.onDelta?.(delta);
      },
    });
    markCodeBuddyAccountResult(selection, true, { accountsPath: config.codeBuddyAccountsPath });
    return {
      ...result,
      account: summarizeCodeBuddyAccount(selection.account),
      accountId: selection.account.id,
      emittedOnAttempt,
    };
  } catch (error) {
    markCodeBuddyAccountResult(selection, false, {
      accountsPath: config.codeBuddyAccountsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function compactText(value) {
  return String(value || "").trim();
}

function normalizeCodeBuddyLoginStatus(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const authEnabled = typeof source.authEnabled === "boolean"
    ? source.authEnabled
    : typeof source.auth_enabled === "boolean"
      ? source.auth_enabled
      : null;
  const rawAuthenticated = Boolean(
    source.authenticated === true ||
    source.loggedIn === true ||
    source.logged_in === true ||
    source.success === true,
  );
  const accessAllowed = authEnabled === false || rawAuthenticated;
  const authenticated = authEnabled === false ? false : rawAuthenticated;
  return {
    authEnabled,
    authenticated,
    loggedIn: authenticated,
    accessAllowed,
    userId: compactText(source.userId || source.user_id || source.id || ""),
    userName: compactText(source.userName || source.username || source.email || source.name || ""),
    userNickname: compactText(source.userNickname || source.nickname || source.displayName || ""),
    authMode: compactText(source.authMode || source.auth_mode || source.mode || ""),
    message: compactText(source.message || source.statusMessage || source.error || source.note || ""),
    raw: {
      authEnabled,
      authenticated: rawAuthenticated,
      accessAllowed,
    },
  };
}

function isLoopbackUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.");
  } catch {
    return false;
  }
}

function normalizeCodeBuddyLoginUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  if (isLoopbackUrl(text)) return "";
  return text;
}

function isCodeBuddyOAuthSessionActive(session = codeBuddyOAuthSession, now = Date.now()) {
  const source = session && typeof session === "object" ? session : {};
  const startedAt = Number(source.startedAt || 0);
  if (!startedAt) return false;
  if (now - startedAt > CODEBUDDY_OAUTH_SESSION_TTL_MS) return false;
  return Boolean(source.id && source.token);
}

function buildCodeBuddyRemoteUrl(options = {}) {
  const origin = compactText(options.publicOrigin || "").replace(/\/+$/, "");
  const path = "/codebuddy/";
  return origin ? `${origin}${path}` : path;
}

function isCodeBuddyOAuthLaunchUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim(), "http://localhost");
    return parsed.pathname === "/direct-admin/codebuddy/oauth/launch";
  } catch {
    return false;
  }
}

function buildCodeBuddyOAuthLaunchUrl(options = {}) {
  const id = compactText(options.id || codeBuddyOAuthSession.id);
  const token = compactText(options.token || codeBuddyOAuthSession.token);
  if (!id || !token) return "";
  const path = `/direct-admin/codebuddy/oauth/launch?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const origin = compactText(options.publicOrigin || "").replace(/\/+$/, "");
  return origin ? `${origin}${path}` : path;
}

function buildCodeBuddyOAuthCallbackUrl(options = {}) {
  const id = compactText(options.id || codeBuddyOAuthSession.id);
  const token = compactText(options.token || codeBuddyOAuthSession.token);
  if (!id || !token) return "";
  const path = `/direct-admin/codebuddy/oauth/callback?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const origin = compactText(options.publicOrigin || "").replace(/\/+$/, "");
  return origin ? `${origin}${path}` : path;
}

function parseCodeBuddyOAuthCallbackUrl(value, expected = codeBuddyOAuthSession) {
  const text = String(value || "").trim();
  if (!text) {
    return { ok: false, reason: "empty callback url" };
  }
  let parsed;
  try {
    parsed = new URL(text, "http://localhost");
  } catch {
    return { ok: false, reason: "invalid callback url" };
  }
  if (parsed.pathname !== "/direct-admin/codebuddy/oauth/callback") {
    return { ok: false, reason: "unexpected callback path" };
  }
  const id = compactText(parsed.searchParams.get("id") || "");
  const token = compactText(parsed.searchParams.get("token") || "");
  const expectedId = compactText(expected?.id || "");
  const expectedToken = compactText(expected?.token || "");
  if (!expectedId || !expectedToken) {
    return { ok: false, reason: "oauth session is not active" };
  }
  if (!id || !token) {
    return { ok: false, reason: "callback token missing" };
  }
  if (id !== expectedId) {
    return { ok: false, reason: "callback session mismatch" };
  }
  if (token !== expectedToken) {
    return { ok: false, reason: "callback token mismatch" };
  }
  if (Number(expected?.startedAt || 0) && !isCodeBuddyOAuthSessionActive(expected)) {
    return { ok: false, reason: "oauth session expired" };
  }
  return { ok: true, id, token };
}

function parseCodeBuddyManualCallbackUrl(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: false, reason: "empty callback url" };
  let parsed;
  try {
    parsed = new URL(text, "http://localhost");
  } catch {
    return { ok: false, reason: "invalid callback url" };
  }
  const error = compactText(parsed.searchParams.get("error") || parsed.searchParams.get("error_description") || "");
  if (error) {
    return { ok: false, reason: error };
  }
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const callbackLike = /callback|oauth|auth|code=|state=/i.test(text);
  if (!absolute && !callbackLike) {
    return { ok: false, reason: "callback url is not recognizable" };
  }
  return { ok: true, url: text };
}

function normalizeCodeBuddySessionUrl(value, options = {}) {
  const text = String(value || "").trim();
  const publicUrl = normalizeCodeBuddyLoginUrl(text);
  if (publicUrl) return publicUrl;
  if (isCodeBuddyOAuthLaunchUrl(text)) return text;
  return buildCodeBuddyOAuthLaunchUrl(options);
}

function sanitizeCodeBuddyCookieHeader(value) {
  let text = String(value || "").trim();
  text = text.replace(/^\s*(?:-H|--header)\s+/i, "").trim();
  text = text.replace(/^['"]|['"]$/g, "").trim();
  text = text.replace(/^Cookie\s*:\s*/i, "").trim();
  text = text.replace(/\\\s*$/g, "").trim();
  text = text.replace(/^['"]|['"]$/g, "").trim();
  text = text.replace(/['"]\s*$/g, "").trim();
  const cookies = parseCookieHeader(text);
  if (cookies.size === 0) return "";
  cookies.delete("cursor_codebuddy_oauth");
  for (const attr of ["path", "expires", "max-age", "domain", "samesite", "secure", "httponly"]) {
    cookies.delete(attr);
    cookies.delete(attr.toUpperCase());
    cookies.delete(attr.replace(/(^|-)([a-z])/g, (_m, prefix, char) => `${prefix}${char.toUpperCase()}`));
  }
  return Array.from(cookies.entries())
    .filter(([key]) => key)
    .map(([key, val]) => `${key}=${val}`)
    .join("; ");
}

function looksLikeCookieHeader(value) {
  const text = compactText(value);
  return /^[A-Za-z0-9_.-]+=[^;]+(?:;\s*[A-Za-z0-9_.-]+=[^;]+)*$/.test(text);
}

function parseCodeBuddyGatewayCredentialInput(value = "", options = {}) {
  const text = compactText(value);
  const result = {
    ok: false,
    source: "",
    raw: text,
    baseUrl: "",
    authToken: "",
    cookie: "",
  };

  const cookieFromOptions = sanitizeCodeBuddyCookieHeader(options.cookieHeader || "");
  if (cookieFromOptions) {
    result.cookie = cookieFromOptions;
    result.source = "browser_cookie";
  }

  if (!text) {
    result.ok = Boolean(result.cookie);
    return result;
  }

  const loosePassword = text.match(/^\??(?:password|token|auth|access_token)=([^&\s]+)/i);
  if (loosePassword) {
    result.authToken = decodeURIComponent(loosePassword[1]);
    result.source = "password_param";
    result.ok = Boolean(result.authToken || result.cookie);
    return result;
  }

  if (looksLikeCookieHeader(text)) {
    result.cookie = sanitizeCodeBuddyCookieHeader(text);
    result.source = result.source || "cookie";
    result.ok = Boolean(result.cookie);
    return result;
  }

  const bearer = text.match(/^Bearer\s+(.+)$/i);
  if (bearer) {
    result.authToken = compactText(bearer[1]);
    result.source = "bearer";
    result.ok = Boolean(result.authToken || result.cookie);
    return result;
  }

  try {
    const parsed = new URL(text, "http://localhost");
    const password = compactText(
      parsed.searchParams.get("password") ||
      parsed.searchParams.get("token") ||
      parsed.searchParams.get("auth") ||
      parsed.searchParams.get("access_token") ||
      "",
    );
    const cookie = compactText(parsed.searchParams.get("cookie") || "");
    if (password) result.authToken = password;
    if (cookie) result.cookie = sanitizeCodeBuddyCookieHeader(cookie) || cookie;
    if (/^https?:\/\//i.test(text) && !parsed.pathname.startsWith("/direct-admin/")) {
      result.baseUrl = parsed.origin;
    }
    result.source = result.authToken ? "url_password" : (result.cookie ? "url_cookie" : "url");
    result.ok = Boolean(result.authToken || result.cookie || result.baseUrl);
    return result;
  } catch {
    // Plain gateway password/token.
  }

  result.authToken = text;
  result.source = "token";
  result.ok = Boolean(result.authToken || result.cookie);
  return result;
}

function createCodeBuddyCredentialHeaders(credential = {}, options = {}) {
  const headers = createCodeBuddyHeaders({
    token: compactText(credential.authToken || options.authToken || options.token || ""),
    exemptRequestHeader: true,
  });
  const cookie = sanitizeCodeBuddyCookieHeader(credential.cookie || options.cookieHeader || options.cookie || "");
  if (cookie) headers.cookie = cookie;
  return headers;
}

function firstCodeBuddyCredentialText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }
  return "";
}

function looksLikeStructuredCodeBuddyCredentialText(value) {
  const text = compactText(value);
  if (!text) return false;
  if (/^[{[]/.test(text)) return true;
  return /(?:^|\n|\s)(?:CODEBUDDY_API_KEY|API_KEY|api_key|apiKey|x-api-key|CODEBUDDY_SITE|site|CURSOR_DIRECT_CODEBUDDY_API_ENDPOINT|CODEBUDDY_API_ENDPOINT|apiEndpoint|api_endpoint)\s*[:=]/i.test(text);
}

function stripWrappedSecret(value) {
  return compactText(value).replace(/^['"]|['"]$/g, "");
}

function looksLikeCodeBuddySecretValue(value) {
  const text = stripWrappedSecret(value);
  if (!text) return false;
  if (/^\d{10,}$/.test(text)) return false;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) return false;
  if (text.length < 16) return false;
  if (/^eyJ[A-Za-z0-9_-]*\./.test(text)) return true;
  return /[A-Za-z]/.test(text) && /[A-Za-z0-9]/.test(text);
}

function parseCodeBuddyCredentialEnvText(text = {}) {
  const raw = String(text || "");
  const result = {
    apiKey: "",
    baseUrl: "",
    apiEndpoint: "",
    chatCompletionsPath: "",
    internetEnvironment: "",
  };
  const read = (pattern) => {
    const match = raw.match(pattern);
    return match ? stripWrappedSecret(match[1] || "") : "";
  };

  result.apiKey = read(/(?:^|\n|\s)(?:CODEBUDDY_API_KEY|API_KEY|api_key|apiKey|x-api-key)\s*[:=]\s*["']?([^\s"',;]+)/i);
  result.site = read(/(?:^|\n|\s)(?:CURSOR_DIRECT_CODEBUDDY_SITE|CODEBUDDY_SITE|site)\s*[:=]\s*["']?([^\s"',;]+)/i);
  result.baseUrl = read(/(?:^|\n|\s)(?:CODEBUDDY_BASE_URL|baseUrl|base_url)\s*[:=]\s*["']?([^\s"',;]+)/i);
  result.apiEndpoint = read(/(?:^|\n|\s)(?:CURSOR_DIRECT_CODEBUDDY_API_ENDPOINT|CODEBUDDY_API_ENDPOINT|apiEndpoint|api_endpoint)\s*[:=]\s*["']?([^\s"',;]+)/i);
  result.chatCompletionsPath = read(/(?:^|\n|\s)(?:CURSOR_DIRECT_CODEBUDDY_CHAT_COMPLETIONS_PATH|CODEBUDDY_CHAT_COMPLETIONS_PATH|chatCompletionsPath|chat_completions_path|endpointPath|endpoint_path)\s*[:=]\s*["']?([^\s"',;]+)/i);
  result.internetEnvironment = read(/(?:^|\n|\s)(?:CURSOR_DIRECT_CODEBUDDY_INTERNET_ENVIRONMENT|CODEBUDDY_INTERNET_ENVIRONMENT|internetEnvironment|internet_environment)\s*[:=]\s*["']?([^\s"',;]+)/i);

  const apiHeader = raw.match(/(?:x-api-key|X-API-Key)\s*[:=]\s*["']?([^\s"',;]+)/);
  if (!result.apiKey && apiHeader) result.apiKey = stripWrappedSecret(apiHeader[1]);

  return result;
}

function shouldUseCodeBuddyCredentialBaseUrl(value) {
  const text = compactText(value);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host === "codebuddy.ai" || host.endsWith(".codebuddy.ai")) return false;
    return true;
  } catch {
    return false;
  }
}

function collectCodeBuddyCredentialFields(value, out = {}, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
    if (typeof entry === "string" || typeof entry === "number") {
      const text = compactText(entry);
      if (!text) continue;
      if (["apikey", "codebuddyapikey", "xapikey", "x-apikey", "key"].includes(normalizedKey)) {
        out.apiKey ||= text;
      } else if (["baseurl"].includes(normalizedKey) && shouldUseCodeBuddyCredentialBaseUrl(text)) {
        out.baseUrl ||= text;
      } else if (["apiendpoint", "codebuddyapiendpoint", "chatendpoint", "endpoint"].includes(normalizedKey)) {
        out.apiEndpoint ||= text;
      } else if (["chatcompletionspath", "codebuddychatcompletionspath", "endpointpath"].includes(normalizedKey)) {
        out.chatCompletionsPath ||= text;
      } else if (["internetenvironment", "codebuddyinternetenvironment"].includes(normalizedKey)) {
        out.internetEnvironment ||= text;
      } else if (["site", "region", "codebuddysite", "codebuddyregion"].includes(normalizedKey)) {
        out.site ||= text;
      } else if (["weborigin", "weburl", "origin", "url"].includes(normalizedKey)) {
        out.webOrigin ||= text;
      } else if (["label", "name", "email", "username"].includes(normalizedKey)) {
        out.label ||= text;
      }
      continue;
    }
    if (entry && typeof entry === "object") collectCodeBuddyCredentialFields(entry, out, seen);
  }
  return out;
}

function normalizeCodeBuddyImportSite(value) {
  const text = compactText(value).toLowerCase();
  if (["domestic", "cn", "china", "internal"].includes(text)) return "domestic";
  return "global";
}

function getCodeBuddyImportBaseUrl(site) {
  return normalizeCodeBuddyImportSite(site) === "domestic"
    ? "https://www.codebuddy.cn"
    : "https://www.codebuddy.ai";
}

function createCodeBuddyAccountFromCredential(input = {}, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const site = normalizeCodeBuddyImportSite(source.site || source.codeBuddySite || source.codebuddy_site || options.site);
  const baseUrl = normalizeCodeBuddyBaseUrl(source.baseUrl || options.baseUrl || getCodeBuddyImportBaseUrl(site) || config.codeBuddyBaseUrl);
  const apiEndpoint = compactText(source.apiEndpoint || source.api_endpoint || source.endpoint || options.apiEndpoint || "");
  const chatCompletionsPath = compactText(
    source.chatCompletionsPath || source.chat_completions_path || source.endpointPath || source.endpoint_path || options.chatCompletionsPath || "",
  );
  const internetEnvironment = compactText(
    source.internetEnvironment || source.internet_environment || options.internetEnvironment || "",
  );
  const apiKey = compactText(source.apiKey || "");
  const account = {
    label: compactText(source.label || options.label || "CodeBuddy Account"),
    site,
    baseUrl: baseUrl,
    apiEndpoint,
    chatCompletionsPath,
    internetEnvironment,
    source: "manual",
    apiKey,
  };
  if (!account.apiKey) {
    return null;
  }
  return account;
}

function normalizeCodeBuddyCredentialImportRequest(body = {}) {
  const source = body && typeof body === "object" ? body : {};
  if (Array.isArray(source.accounts)) return source;
  if (source.account && typeof source.account === "object") return { accounts: [source.account] };

  const label = compactText(source.label || source.accountLabel || "CodeBuddy Account");
  const site = normalizeCodeBuddyImportSite(source.site || source.codeBuddySite || source.codebuddy_site);
  const baseUrl = normalizeCodeBuddyBaseUrl(source.baseUrl || getCodeBuddyImportBaseUrl(site) || config.codeBuddyBaseUrl);
  const apiEndpoint = compactText(source.apiEndpoint || source.api_endpoint || source.endpoint || "");
  const chatCompletionsPath = compactText(source.chatCompletionsPath || source.chat_completions_path || source.endpointPath || source.endpoint_path || "");
  const internetEnvironment = compactText(source.internetEnvironment || source.internet_environment || "");
  const text = firstCodeBuddyCredentialText(
    source.credentialText,
    source.credential,
    source.authJson,
    source.raw,
    source.text,
    source.token,
    source.apiKey,
  );
  const textLooksStructured = looksLikeStructuredCodeBuddyCredentialText(text);
  const accounts = [];
  const add = (candidate) => {
    const account = createCodeBuddyAccountFromCredential(candidate, {
      label,
      site,
      baseUrl,
      apiEndpoint,
      chatCompletionsPath,
      internetEnvironment,
    });
    if (account) accounts.push(account);
  };

  const rawApiKeyCandidate = compactText(source.apiKey || source.api_key || source["x-api-key"] || source.key || "");
  const apiKeyCandidate = looksLikeStructuredCodeBuddyCredentialText(rawApiKeyCandidate) ? "" : rawApiKeyCandidate;
  if (apiKeyCandidate) add({ label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment, apiKey: apiKeyCandidate });

  if (text) {
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      parsedJson = null;
    }
    if (parsedJson) {
      if (Array.isArray(parsedJson)) {
        for (const item of parsedJson) add(collectCodeBuddyCredentialFields(item, { label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment }));
      } else if (Array.isArray(parsedJson.accounts)) {
        for (const item of parsedJson.accounts) add(collectCodeBuddyCredentialFields(item, { label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment }));
      } else {
        add(collectCodeBuddyCredentialFields(parsedJson, { label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment }));
      }
    }
    const envFields = parseCodeBuddyCredentialEnvText(text);
    add({ label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment, ...envFields });
    if (!parsedJson && !textLooksStructured) {
      add({ label, site, baseUrl, apiEndpoint, chatCompletionsPath, internetEnvironment, apiKey: text });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const account of accounts) {
    const key = [account.apiKey, account.baseUrl, account.apiEndpoint, account.chatCompletionsPath].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(account);
  }

  return { accounts: unique };
}

function buildCodeBuddyOAuthSessionResponse(options = {}) {
  const gatewayLaunchUrl = buildCodeBuddyOAuthLaunchUrl({
    publicOrigin: options.publicOrigin,
    id: codeBuddyOAuthSession.id,
    token: codeBuddyOAuthSession.token,
  });
  const sessionUrl = compactText(codeBuddyOAuthSession.url || codeBuddyOAuthSession.login?.url || "");
  const login = codeBuddyOAuthSession.login && typeof codeBuddyOAuthSession.login === "object"
    ? {
      success: Boolean(codeBuddyOAuthSession.login.success),
      message: compactText(codeBuddyOAuthSession.login.message || ""),
      url: compactText(codeBuddyOAuthSession.login.url || sessionUrl),
    }
    : null;
  return {
    id: codeBuddyOAuthSession.id,
    provider: codeBuddyOAuthSession.provider,
    status: codeBuddyOAuthSession.status,
    url: sessionUrl,
    launchUrl: gatewayLaunchUrl,
    gatewayLaunchUrl,
    accessUrl: codeBuddyOAuthSession.accessUrl || buildCodeBuddyRemoteUrl({ publicOrigin: options.publicOrigin }),
    callbackUrl: codeBuddyOAuthSession.callbackUrl,
    startedAt: codeBuddyOAuthSession.startedAt,
    updatedAt: codeBuddyOAuthSession.updatedAt,
    completedAt: codeBuddyOAuthSession.completedAt,
    confirmedAt: codeBuddyOAuthSession.confirmedAt,
    error: codeBuddyOAuthSession.error,
    authStatus: codeBuddyOAuthSession.authStatus,
    login,
    label: codeBuddyOAuthSession.label,
    site: codeBuddyOAuthSession.site || "global",
    authState: codeBuddyOAuthSession.authState || "",
    externalAuthUrl: sessionUrl,
    running: codeBuddyOAuthSession.status === "waiting",
    authenticated: Boolean(options.authenticated ?? (codeBuddyOAuthSession.status === "complete")),
  };
}

function escapeHtmlText(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function buildCodeBuddyOAuthLaunchPage(message, options = {}) {
  const launchUrl = buildCodeBuddyOAuthLaunchUrl({
    publicOrigin: options.publicOrigin,
    id: codeBuddyOAuthSession.id,
    token: codeBuddyOAuthSession.token,
  });
  const body = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>CodeBuddy Gateway Login</title>",
    "  <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.6;color:#111}a,button{display:inline-block;margin-top:12px;padding:10px 14px;border-radius:8px;border:1px solid #111;text-decoration:none;color:#fff;background:#111}p{white-space:pre-wrap} .muted{color:#666}</style>",
    "</head>",
    "<body>",
    "  <h1>CodeBuddy Gateway Login</h1>",
    `  <p>${escapeHtmlText(message || "")}</p>`,
    launchUrl ? `  <p class="muted">登录入口：<a href="${escapeHtmlText(launchUrl)}">${escapeHtmlText(launchUrl)}</a></p>` : "",
    `  <p class="muted">登录完成后回到管理台，粘贴最终回调/登录链接或直接点击检查。</p>`,
    `  <p><a href="/direct-admin/#codebuddy">返回管理台</a></p>`,
    "</body>",
    "</html>",
  ].filter(Boolean).join("\n");
  return html(200, body);
}

function getCodeBuddyDaemonAccountId(baseUrl) {
  return `daemon-${createHash("sha256").update(String(baseUrl || "")).digest("hex").slice(0, 16)}`;
}

function createCodeBuddyDaemonAccount(authStatus, options = {}) {
  const baseUrl = normalizeCodeBuddyBaseUrl(options.baseUrl || config.codeBuddyBaseUrl);
  const normalizedAuthStatus = normalizeCodeBuddyLoginStatus(authStatus);
  const confirmed = Boolean(options.confirmed);
  const authToken = compactText(options.authToken || "");
  const cookie = sanitizeCodeBuddyCookieHeader(options.cookie || "");
  const authType = authToken ? "auth_token" : (cookie ? "cookie" : "daemon");
  return {
    id: authToken || cookie
      ? createHash("sha256").update(`${baseUrl}|${authToken || cookie}`).digest("hex").slice(0, 16)
      : getCodeBuddyDaemonAccountId(baseUrl),
    label: compactText(options.label || "CodeBuddy Gateway"),
    source: "gateway",
    baseUrl,
    authType,
    useDaemonAuth: !authToken && !cookie,
    authToken,
    cookie,
    enabled: true,
    authStatus: {
      ...normalizedAuthStatus,
      loggedIn: confirmed || Boolean(normalizedAuthStatus.loggedIn),
      authenticated: confirmed || Boolean(normalizedAuthStatus.authenticated),
      accessAllowed: Boolean(normalizedAuthStatus.accessAllowed),
      authMode: confirmed ? (normalizedAuthStatus.authMode || authType || "gateway") : normalizedAuthStatus.raw?.authMode || "daemon",
      confirmedAt: confirmed ? Date.now() : 0,
    },
  };
}

async function fetchCodeBuddyAuthStatus(options = {}) {
  const credential = options.credential && typeof options.credential === "object"
    ? options.credential
    : {
      authToken: options.authToken || options.token || "",
      cookie: options.cookie || options.cookieHeader || "",
    };
  const baseUrl = normalizeCodeBuddyBaseUrl(credential.baseUrl || options.baseUrl || config.codeBuddyBaseUrl);
  const response = await fetch(`${baseUrl}/api/v1/auth/status`, {
    headers: createCodeBuddyCredentialHeaders(credential, {
      token: options.token,
      cookieHeader: options.cookieHeader,
    }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(`CodeBuddy auth/status failed with ${response.status}`);
  }
  return normalizeCodeBuddyLoginStatus(data);
}

function importCodeBuddyGatewayAccount(authStatus, options = {}) {
  const account = createCodeBuddyDaemonAccount(authStatus, options);
  const result = importCodeBuddyAccounts(readCodeBuddyStore(), { accounts: [account] });
  const store = writeCodeBuddyStore(result.store);
  return {
    account: summarizeCodeBuddyAccount(result.imported[0] || account),
    accounts: summarizeCodeBuddyStore(store),
  };
}

async function getCodeBuddyOAuthSessionPayload(options = {}) {
  const now = Date.now();
  const cached = getMetadataCache(metadataCaches.codeBuddyOAuthSession, { now });
  if (!options.fresh && cached) {
    return {
      ...cached,
      session: {
        ...(cached.session || {}),
        url: normalizeCodeBuddySessionUrl(cached.session?.url || "", {
          publicOrigin: options.publicOrigin,
          id: cached.session?.id || codeBuddyOAuthSession.id,
          token: codeBuddyOAuthSession.token,
        }),
        login: cached.session?.login ? {
          ...cached.session.login,
          url: normalizeCodeBuddySessionUrl(cached.session.login.url || "", {
            publicOrigin: options.publicOrigin,
            id: cached.session?.id || codeBuddyOAuthSession.id,
            token: codeBuddyOAuthSession.token,
          }),
        } : null,
      },
    };
  }
  const accounts = summarizeCodeBuddyStore(readCodeBuddyStore());
  const payload = {
    ok: true,
    provider: "codebuddy",
    session: buildCodeBuddyOAuthSessionResponse({
      publicOrigin: options.publicOrigin,
      authenticated: Boolean(accounts.primary?.hasCredentials),
    }),
    accounts,
    account: accounts.primary,
  };
  return setMetadataCache(metadataCaches.codeBuddyOAuthSession, payload, { now, ttlMs: config.oauthSessionCacheTtlMs });
}

function importCodeBuddyOAuthAccount(tokenData = {}, options = {}) {
  const accountInput = buildCodeBuddyOAuthAccountFromTokenData(tokenData, {
    label: options.label || codeBuddyOAuthSession.label,
    site: options.site || codeBuddyOAuthSession.site || "global",
  });
  const result = importCodeBuddyAccounts(readCodeBuddyStore(), accountInput, {
    accountsPath: config.codeBuddyAccountsPath,
  });
  const store = writeCodeBuddyStore(result.store);
  return {
    imported: result.imported,
    summaries: result.summaries,
    account: summarizeCodeBuddyAccount(result.imported[0] || accountInput),
    accounts: summarizeCodeBuddyStore(store),
  };
}

async function pollCodeBuddyOAuthSession(options = {}) {
  const authState = compactText(options.authState || codeBuddyOAuthSession.authState);
  if (!authState) {
    return {
      ok: false,
      provider: "codebuddy",
      status: "error",
      message: "OAuth session has no auth state; click start login again.",
      session: buildCodeBuddyOAuthSessionResponse({ publicOrigin: options.publicOrigin }),
    };
  }
  const poll = await pollCodeBuddyPluginAuth({
    authState,
    site: options.site || codeBuddyOAuthSession.site || "global",
    baseUrl: options.baseUrl,
  });
  if (poll.status === "pending") {
    codeBuddyOAuthSession.status = "waiting";
    codeBuddyOAuthSession.error = "";
    codeBuddyOAuthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
    const accounts = summarizeCodeBuddyStore(readCodeBuddyStore());
    return {
      ok: false,
      pending: true,
      provider: "codebuddy",
      status: "pending",
      message: poll.message || "waiting for login",
      session: buildCodeBuddyOAuthSessionResponse({ publicOrigin: options.publicOrigin }),
      accounts,
      account: accounts.primary,
    };
  }
  if (poll.status !== "success" || !poll.tokenData) {
    codeBuddyOAuthSession.status = "failed";
    codeBuddyOAuthSession.error = poll.message || "CodeBuddy OAuth poll failed";
    codeBuddyOAuthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
    const accounts = summarizeCodeBuddyStore(readCodeBuddyStore());
    return {
      ok: false,
      provider: "codebuddy",
      status: poll.status || "error",
      message: codeBuddyOAuthSession.error,
      session: buildCodeBuddyOAuthSessionResponse({ publicOrigin: options.publicOrigin }),
      accounts,
      account: accounts.primary,
    };
  }
  const imported = importCodeBuddyOAuthAccount(poll.tokenData, options);
  codeBuddyOAuthSession.status = "complete";
  codeBuddyOAuthSession.completedAt = Date.now();
  codeBuddyOAuthSession.updatedAt = codeBuddyOAuthSession.completedAt;
  codeBuddyOAuthSession.error = "";
  codeBuddyOAuthSession.authStatus = imported.account?.authStatus || null;
  clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
  return {
    ok: true,
    provider: "codebuddy",
    status: "complete",
    message: "CodeBuddy OAuth login completed and account imported.",
    session: buildCodeBuddyOAuthSessionResponse({
      publicOrigin: options.publicOrigin,
      authenticated: true,
    }),
    imported: imported.summaries,
    account: imported.account,
    accounts: imported.accounts,
  };
}

async function startCodeBuddyOAuthSession(options = {}) {
  if (codeBuddyOAuthSession.status === "waiting" && isCodeBuddyOAuthSessionActive(codeBuddyOAuthSession)) {
    return getCodeBuddyOAuthSessionPayload({ fresh: true, publicOrigin: options.publicOrigin });
  }
  codeBuddyOAuthSession = createCodeBuddyOAuthSessionState();
  codeBuddyOAuthSession.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  codeBuddyOAuthSession.token = randomUUID();
  codeBuddyOAuthSession.status = "starting";
  codeBuddyOAuthSession.site = compactText(options.site || "global") || "global";
  codeBuddyOAuthSession.startedAt = Date.now();
  codeBuddyOAuthSession.updatedAt = codeBuddyOAuthSession.startedAt;
  codeBuddyOAuthSession.label = compactText(options.label || "CodeBuddy OAuth");
  codeBuddyOAuthSession.launchUrl = buildCodeBuddyOAuthLaunchUrl({
    publicOrigin: options.publicOrigin,
    id: codeBuddyOAuthSession.id,
    token: codeBuddyOAuthSession.token,
  });
  codeBuddyOAuthSession.accessUrl = buildCodeBuddyRemoteUrl({ publicOrigin: options.publicOrigin });
  codeBuddyOAuthSession.callbackUrl = buildCodeBuddyOAuthCallbackUrl({
    publicOrigin: options.publicOrigin,
    id: codeBuddyOAuthSession.id,
    token: codeBuddyOAuthSession.token,
  });
  try {
    const started = await startCodeBuddyPluginAuth({ site: codeBuddyOAuthSession.site });
    codeBuddyOAuthSession.authState = started.authState;
    codeBuddyOAuthSession.url = started.authUrl;
    codeBuddyOAuthSession.status = "waiting";
    codeBuddyOAuthSession.error = "";
    codeBuddyOAuthSession.login = {
      success: true,
      message: "请在打开的 CodeBuddy 页面完成登录，然后回到管理台点击「检查登录」或等待自动轮询。",
      url: started.authUrl,
      externalUrl: started.authUrl,
    };
  } catch (error) {
    codeBuddyOAuthSession.status = "failed";
    codeBuddyOAuthSession.error = error instanceof Error ? error.message : String(error);
    codeBuddyOAuthSession.login = {
      success: false,
      message: codeBuddyOAuthSession.error,
      url: "",
      externalUrl: "",
    };
  }
  clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
  codeBuddyOAuthSession.updatedAt = Date.now();
  clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
  return getCodeBuddyOAuthSessionPayload({ fresh: true, publicOrigin: options.publicOrigin });
}

async function completeCodeBuddyGatewayAuth(callbackUrl = "", options = {}) {
  const rawCallbackUrl = String(callbackUrl || "").trim();
  if (rawCallbackUrl) {
    const tokenCallback = parseCodeBuddyOAuthCallbackUrl(rawCallbackUrl, codeBuddyOAuthSession);
    const manualCallback = !tokenCallback.ok ? parseCodeBuddyManualCallbackUrl(rawCallbackUrl) : { ok: false };
    const gatewayCredential = parseCodeBuddyGatewayCredentialInput(rawCallbackUrl, {
      cookieHeader: options.cookieHeader,
      publicOrigin: options.publicOrigin,
    });
    if (!(tokenCallback.ok || manualCallback.ok || gatewayCredential.ok || gatewayCredential.authToken)) {
      codeBuddyOAuthSession.status = "waiting";
      codeBuddyOAuthSession.error = `CodeBuddy 登录回调无效：${manualCallback.reason || tokenCallback.reason}`;
      codeBuddyOAuthSession.updatedAt = Date.now();
      clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
      const accounts = summarizeCodeBuddyStore(readCodeBuddyStore());
      return {
        ok: false,
        provider: "codebuddy",
        session: buildCodeBuddyOAuthSessionResponse({ publicOrigin: options.publicOrigin }),
        accounts,
        account: accounts.primary,
      };
    }
    codeBuddyOAuthSession.callbackUrl = rawCallbackUrl;
    codeBuddyOAuthSession.confirmedAt = Date.now();
    codeBuddyOAuthSession.updatedAt = codeBuddyOAuthSession.confirmedAt;
    clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
  }
  return pollCodeBuddyOAuthSession(options);
}

async function waitForCodeBuddyOAuthCompletion(callbackUrl = "", options = {}) {
  return completeCodeBuddyGatewayAuth(callbackUrl, options);
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

function extractCursorLoginUrl(output) {
  const compact = stripAnsi(output).replace(/\s+/g, "");
  const match = compact.match(/https:\/\/cursor\.com\/loginDeepControl(?:\?[A-Za-z0-9._~%=&-]*)?/);
  return match ? match[0] : "";
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

function getOAuthSessionPayload() {
  const cached = getMetadataCache(metadataCaches.oauthSession, { now: Date.now() });
  if (cached) return cached;
  const payload = {
    ok: true,
    session: getOAuthSessionSnapshot(),
    accounts: summarizeAccountsStore(readAccountsStore()),
  };
  return setMetadataCache(metadataCaches.oauthSession, payload, { ttlMs: config.oauthSessionCacheTtlMs });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopDirectOAuthSession(reason = "idle") {
  if (oauthSession.child && oauthSession.child.exitCode === null) {
    try {
      oauthSession.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  oauthSession = createOAuthSessionState();
  oauthSession.status = reason;
  clearMetadataCache(metadataCaches.oauthSession);
}

function importCurrentAuthFileToPool(options = {}) {
  const auth = readAuthFile();
  const store = readAccountsStore();
  const result = importDirectAccounts(store, {
    ...auth,
    label: options.label || "OAuth account",
    source: "oauth",
    authPath: config.authPath,
  });
  const nextStore = writeAccountsStore(result.store);
  invalidateDirectMetadataCaches();
  return {
    ok: true,
    accounts: summarizeAccountsStore(nextStore),
    imported: result.summaries,
  };
}

async function startDirectOAuthSession() {
  if (oauthSession.child && oauthSession.child.exitCode === null) {
    return {
      reused: true,
      session: getOAuthSessionSnapshot(),
      accounts: summarizeAccountsStore(readAccountsStore()),
    };
  }

  oauthSession = createOAuthSessionState();
  clearMetadataCache(metadataCaches.oauthSession);
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
      clearMetadataCache(metadataCaches.oauthSession);
      settle(resolve, {
        reused: false,
        session: getOAuthSessionSnapshot(),
        accounts: summarizeAccountsStore(readAccountsStore()),
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
        settle(reject, new Error("Cursor OAuth session was replaced"));
        return;
      }
      oauthSession.status = "failed";
      oauthSession.error = error instanceof Error ? error.message : String(error);
      oauthSession.updatedAt = Date.now();
      settle(reject, error);
    });

    child.on("close", (code) => {
      if (oauthSession.id !== sessionId) {
        settle(reject, new Error("Cursor OAuth session was replaced"));
        return;
      }
      oauthSession.exitCode = code;
      oauthSession.child = null;
      oauthSession.updatedAt = Date.now();
      try {
        const imported = importCurrentAuthFileToPool({ label: "OAuth account" });
        oauthSession.status = "complete";
        oauthSession.completedAt = Date.now();
        oauthSession.error = "";
        clearMetadataCache(metadataCaches.oauthSession);
        settle(resolve, {
          ...imported,
          session: getOAuthSessionSnapshot(),
        });
      } catch {
        if (oauthSession.status !== "waiting") {
          oauthSession.status = "failed";
          oauthSession.error = stripAnsi(oauthSession.stderr).trim()
            || stripAnsi(oauthSession.stdout).trim()
            || `cursor-agent login exited with code ${String(code ?? "unknown")}`;
          clearMetadataCache(metadataCaches.oauthSession);
          settle(reject, new Error(oauthSession.error));
        }
      }
    });

    setTimeout(() => {
      if (oauthSession.id !== sessionId || settled) return;
      oauthSession.status = "failed";
      oauthSession.error = "生成 Cursor 授权链接超时";
      oauthSession.updatedAt = Date.now();
      clearMetadataCache(metadataCaches.oauthSession);
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

async function waitForDirectOAuthCompletion(callbackUrl = "") {
  if (callbackUrl) {
    oauthSession.callbackUrl = String(callbackUrl).trim();
    oauthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.oauthSession);
    if (oauthSession.child?.stdin?.writable) {
      try {
        oauthSession.child.stdin.write(`${oauthSession.callbackUrl}\n`);
      } catch {
        // Cursor usually completes through browser callback; stdin is best effort.
      }
    }
  }

  const start = Date.now();
  while (Date.now() - start < OAUTH_COMPLETE_TIMEOUT_MS) {
    try {
      const imported = importCurrentAuthFileToPool({ label: "OAuth account" });
      oauthSession.status = "complete";
      oauthSession.completedAt = Date.now();
      oauthSession.error = "";
      oauthSession.updatedAt = Date.now();
      clearMetadataCache(metadataCaches.oauthSession);
      return {
        ...imported,
        session: getOAuthSessionSnapshot(),
      };
    } catch {
      if (oauthSession.exitCode !== null && oauthSession.exitCode !== 0) {
        oauthSession.status = "failed";
        oauthSession.error ||= "Cursor 登录进程已退出，认证未完成";
        clearMetadataCache(metadataCaches.oauthSession);
        break;
      }
      await sleep(OAUTH_POLL_INTERVAL_MS);
    }
  }

  if (oauthSession.status !== "failed") {
    oauthSession.status = "waiting";
    oauthSession.error = "尚未检测到 Cursor 登录态，请完成浏览器授权后重试";
    oauthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.oauthSession);
  }

  return {
    ok: false,
    session: getOAuthSessionSnapshot(),
    accounts: summarizeAccountsStore(readAccountsStore()),
  };
}

async function refreshAuthRecord(auth, options = {}) {
  const current = {
    accessToken: auth?.accessToken || auth?.access_token || "",
    refreshToken: auth?.refreshToken || auth?.refresh_token || "",
  };
  const expMs = getJwtExpMs(current.accessToken);
  const shouldRefresh =
    Boolean(current.refreshToken) && Boolean(current.accessToken) && (options.force || (expMs > 0 && expMs - Date.now() < 5 * 60 * 1000));
  if (!shouldRefresh) {
    return { ...current, refreshed: false };
  }

  const response = await fetch(`${config.apiBaseUrl}/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${current.refreshToken}`,
    },
    body: "{}",
  });
  if (!response.ok) {
    return { ...current, refreshed: false };
  }

  const next = await response.json();
  if (!next?.accessToken || !next?.refreshToken) {
    return { ...current, refreshed: false };
  }

  if (options.write !== false) {
    const targetPath = options.authPath || config.authPath;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }
  return { accessToken: next.accessToken, refreshToken: next.refreshToken, refreshed: true };
}

async function readAndSummarizeAuth() {
  const cached = getMetadataCache(metadataCaches.authSummary, { now: Date.now() });
  if (cached) return cached;
  const store = readAccountsStore();
  const legacy = readLegacyDirectAccount();
  const summary = summarizeAccountsStore(store, { legacyAccount: legacy ? summarizeDirectAccount(legacy) : null });
  return setMetadataCache(metadataCaches.authSummary, summary, { ttlMs: config.authSummaryCacheTtlMs });
}

function clearAuthFile() {
  if (existsSync(config.authPath)) {
    unlinkSync(config.authPath);
  }
}

function clearAccountsStore() {
  if (existsSync(config.accountsPath)) {
    unlinkSync(config.accountsPath);
  }
}

function generateChecksum(token, nowValue = new Date()) {
  const salt = String(token).split(".");
  const calc = (data) => {
    let t = 165;
    for (let i = 0; i < data.length; i += 1) {
      data[i] = ((data[i] ^ t) + i) & 0xff;
      t = data[i];
    }
  };

  const now = new Date(nowValue);
  now.setMinutes(30 * Math.floor(now.getMinutes() / 30), 0, 0);
  const timestamp = Math.floor(now.getTime() / 1e6);
  const timestampBuffer = Buffer.alloc(6);
  let temp = timestamp;
  for (let i = 5; i >= 0; i -= 1) {
    timestampBuffer[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }
  calc(timestampBuffer);

  const calcHex = (input) => createHash("sha256").update(input).digest("hex").slice(0, 8);
  const hex1 = salt[1] ? calcHex(salt[1]) : "00000000";
  const hex2 = calcHex(token);
  return `${timestampBuffer.toString("base64url")}${hex1}/${hex2}`;
}

function cursorHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    "user-agent": "connect-es/1.4.0",
    "x-cursor-checksum": generateChecksum(token),
    "x-cursor-client-version": config.clientVersion,
    "x-cursor-client-type": "cli",
    "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "x-ghost-mode": "true",
    "x-request-id": randomUUID(),
    ...extra,
  };
}

async function listDirectModels(options = {}) {
  const now = Date.now();
  const cached = getMetadataCache(metadataCaches.models, { now });
  if (!options.fresh && Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  const token = options.accessToken || options.account?.accessToken || await getAccessToken();
  const response = await fetch(`${config.apiBaseUrl}/aiserver.v1.AiService/GetUsableModels`, {
    method: "POST",
    headers: cursorHeaders(token, {
      "content-type": "application/json",
      accept: "application/json",
      "connect-protocol-version": "1",
    }),
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(`GetUsableModels failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data?.models) ? data.models : [];
  const models = rows
    .map((row) => ({
      id: row?.displayModelId || row?.modelId || "",
      modelId: row?.modelId || row?.displayModelId || "",
      displayName: row?.displayNameShort || row?.displayName || row?.displayModelId || row?.modelId || "",
    }))
    .filter((row) => row.id && row.modelId);

  return setMetadataCache(metadataCaches.models, models, { now, ttlMs: config.modelsCacheTtlMs });
}

class ProtoWriter {
  parts = [];

  writeVarint(value) {
    const bytes = [];
    let v = value;
    while (v > 127) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v & 0x7f);
    this.parts.push(Buffer.from(bytes));
  }

  writeString(field, value) {
    const buf = Buffer.from(String(value ?? ""), "utf8");
    this.writeVarint((field << 3) | 2);
    this.writeVarint(buf.length);
    this.parts.push(buf);
  }

  writeBytes(field, value) {
    const buf = Buffer.from(value || Buffer.alloc(0));
    this.writeVarint((field << 3) | 2);
    this.writeVarint(buf.length);
    this.parts.push(buf);
  }

  writeMessage(field, writer) {
    const buf = writer.toBuffer();
    this.writeVarint((field << 3) | 2);
    this.writeVarint(buf.length);
    this.parts.push(buf);
  }

  writeInt32(field, value) {
    this.writeVarint((field << 3) | 0);
    this.writeVarint(value);
  }

  writeBool(field, value) {
    this.writeInt32(field, value ? 1 : 0);
  }

  toBuffer() {
    return Buffer.concat(this.parts);
  }
}

function buildDirectRunPayload(prompt, model) {
  const messageId = randomUUID();
  const conversationId = randomUUID();

  const userMsg = new ProtoWriter();
  userMsg.writeString(1, prompt);
  userMsg.writeString(2, messageId);
  userMsg.writeString(3, "");

  const fileCtx = new ProtoWriter();
  fileCtx.writeString(1, "/context.txt");
  fileCtx.writeString(2, "OpenAI-compatible direct gateway request");

  const explicitCtx = new ProtoWriter();
  explicitCtx.writeMessage(2, fileCtx);

  const userMsgAction = new ProtoWriter();
  userMsgAction.writeMessage(1, userMsg);
  userMsgAction.writeMessage(2, explicitCtx);

  const convAction = new ProtoWriter();
  convAction.writeMessage(1, userMsgAction);

  const modelDetails = new ProtoWriter();
  modelDetails.writeString(1, model);
  modelDetails.writeString(3, displayModelId(model));
  modelDetails.writeString(4, displayModelId(model));
  modelDetails.writeString(5, displayModelId(model));
  modelDetails.writeInt32(7, 0);

  const runReq = new ProtoWriter();
  runReq.writeString(1, "");
  runReq.writeMessage(2, convAction);
  runReq.writeMessage(3, modelDetails);
  runReq.writeString(4, "");
  runReq.writeString(5, conversationId);

  const clientMsg = new ProtoWriter();
  clientMsg.writeMessage(1, runReq);
  return clientMsg.toBuffer();
}

function createConnectFrame(payload) {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function getDirectParseLimits(options = {}) {
  const custom = options.limits || {};
  return {
    maxDepth: Number(custom.maxDepth || config.parseMaxDepth || DEFAULT_DIRECT_PARSE_LIMITS.maxDepth),
    maxFields: Number(custom.maxFields || config.parseMaxFields || DEFAULT_DIRECT_PARSE_LIMITS.maxFields),
    maxStrings: Number(custom.maxStrings || config.parseMaxStrings || DEFAULT_DIRECT_PARSE_LIMITS.maxStrings),
    maxStringBytes: Number(custom.maxStringBytes || config.parseMaxStringBytes || DEFAULT_DIRECT_PARSE_LIMITS.maxStringBytes),
    maxNestedBytes: Number(custom.maxNestedBytes || config.parseMaxNestedBytes || DEFAULT_DIRECT_PARSE_LIMITS.maxNestedBytes),
    maxFrameBytes: Number(custom.maxFrameBytes || config.parseMaxFrameBytes || DEFAULT_DIRECT_PARSE_LIMITS.maxFrameBytes),
    maxTotalBytes: Number(custom.maxTotalBytes || config.parseMaxTotalBytes || DEFAULT_DIRECT_PARSE_LIMITS.maxTotalBytes),
  };
}

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let cursor = pos;
  while (cursor < buf.length && shift <= 63) {
    const byte = buf[cursor];
    cursor += 1;
    result += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return [result, cursor, true];
    shift += 7;
  }
  return [0, pos, false];
}

function readLengthDelimited(buf, pos) {
  const [len, dataStart, lenOk] = readVarint(buf, pos);
  if (!lenOk || dataStart === pos || len < 0 || !Number.isSafeInteger(len)) {
    return [null, pos, false];
  }
  const dataEnd = dataStart + len;
  if (dataEnd > buf.length) return [null, pos, false];
  return [buf.subarray(dataStart, dataEnd), dataEnd, true];
}

function skipProtoFieldValue(buf, pos, wireType) {
  if (wireType === PROTO_WIRE_VARINT) {
    const [, nextPos, ok] = readVarint(buf, pos);
    return [nextPos, ok && nextPos > pos];
  }
  if (wireType === PROTO_WIRE_FIXED64) {
    const nextPos = pos + 8;
    return [nextPos, nextPos <= buf.length];
  }
  if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
    const [, nextPos, ok] = readLengthDelimited(buf, pos);
    return [nextPos, ok && nextPos >= pos];
  }
  if (wireType === PROTO_WIRE_FIXED32) {
    const nextPos = pos + 4;
    return [nextPos, nextPos <= buf.length];
  }
  return [pos, false];
}

function countDecodedField(state) {
  if (!state?.limits) return true;
  state.fields += 1;
  return state.fields <= state.limits.maxFields;
}

function decodeUtf8Text(data) {
  try {
    return UTF8_TEXT_DECODER.decode(data);
  } catch {
    return "";
  }
}

function decodeCursorStringField(buf, targetField, state) {
  let pos = 0;
  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [data, nextPos, ok] = readLengthDelimited(buf, pos);
      if (!ok) break;
      pos = nextPos;
      if (fieldNum === targetField) return decodeUtf8Text(data);
      continue;
    }

    const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
    if (!ok) break;
    pos = nextPos;
  }
  return "";
}

function decodeCursorBytesField(buf, targetField, state) {
  let pos = 0;
  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [data, nextPos, ok] = readLengthDelimited(buf, pos);
      if (!ok) break;
      pos = nextPos;
      if (fieldNum === targetField) return Buffer.from(data);
      continue;
    }

    const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
    if (!ok) break;
    pos = nextPos;
  }
  return Buffer.alloc(0);
}

function decodeCursorVarintField(buf, targetField, state) {
  let pos = 0;
  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType === PROTO_WIRE_VARINT) {
      const [value, nextPos, ok] = readVarint(buf, pos);
      if (!ok) break;
      pos = nextPos;
      if (fieldNum === targetField) return value;
      continue;
    }

    const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
    if (!ok) break;
    pos = nextPos;
  }
  return 0;
}

function createParseState(options = {}) {
  return {
    fields: 0,
    strings: 0,
    limits: getDirectParseLimits(options),
  };
}

function isPrintableTextBuffer(data, limits = getDirectParseLimits()) {
  if (!data || data.length <= 0 || data.length > limits.maxStringBytes) return false;
  let text = "";
  try {
    text = UTF8_TEXT_DECODER.decode(data);
  } catch {
    return false;
  }
  if (!text || text.includes("\uFFFD")) return false;
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text);
}

function extractStringsFromProtobuf(buf, fieldPath = "", depth = 0, state = createParseState()) {
  if (!buf || depth > state.limits.maxDepth || state.fields >= state.limits.maxFields) return [];
  const strings = [];
  let pos = 0;

  while (pos < buf.length) {
    if (state.fields >= state.limits.maxFields || state.strings >= state.limits.maxStrings) break;
    state.fields += 1;

    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    const currentPath = fieldPath ? `${fieldPath}.${fieldNum}` : String(fieldNum);

    if (wireType === 0) {
      const [, nextPos, ok] = readVarint(buf, pos);
      if (!ok || nextPos === pos) break;
      pos = nextPos;
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) break;
      pos += 8;
    } else if (wireType === 2) {
      const [len, dataStart, lenOk] = readVarint(buf, pos);
      if (!lenOk || dataStart === pos) break;
      pos = dataStart + len;
      if (len <= 0 || dataStart + len > buf.length) break;
      const data = buf.subarray(dataStart, dataStart + len);
      if (isPrintableTextBuffer(data, state.limits)) {
        const text = data.toString("utf8");
        strings.push({ text, fieldPath: currentPath, depth, frameIndex: 0 });
        state.strings += 1;
        continue;
      }
      if (len <= state.limits.maxNestedBytes) {
        strings.push(...extractStringsFromProtobuf(data, currentPath, depth + 1, state));
      }
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) break;
      pos += 4;
    } else {
      break;
    }
  }

  return strings;
}

function decodeCursorInteractionUpdate(buf, state = createParseState()) {
  const events = [];
  let pos = 0;

  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType !== PROTO_WIRE_LENGTH_DELIMITED) {
      const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
      if (!ok) break;
      pos = nextPos;
      continue;
    }

    const [data, nextPos, ok] = readLengthDelimited(buf, pos);
    if (!ok) break;
    pos = nextPos;

    if (fieldNum === CURSOR_IU_TEXT_DELTA) {
      const text = decodeCursorStringField(data, CURSOR_TEXT_DELTA_TEXT, state);
      if (text) events.push({ type: "text_delta", text });
    } else if (fieldNum === CURSOR_IU_THINKING_DELTA) {
      const text = decodeCursorStringField(data, CURSOR_THINKING_DELTA_TEXT, state);
      events.push({ type: "thinking_delta", text });
    } else if (fieldNum === CURSOR_IU_THINKING_COMPLETED) {
      events.push({ type: "thinking_completed" });
    } else if (fieldNum === CURSOR_IU_TOKEN_DELTA) {
      events.push({
        type: "token_delta",
        tokenDelta: decodeCursorVarintField(data, CURSOR_TOKEN_DELTA_VALUE, state),
      });
    } else if (fieldNum === CURSOR_IU_HEARTBEAT) {
      events.push({ type: "heartbeat" });
    } else if (fieldNum === CURSOR_IU_TURN_ENDED) {
      events.push({ type: "turn_ended" });
    }
  }

  return events;
}

function decodeCursorKvServerMessage(buf, state = createParseState()) {
  const event = { type: "kv_server_message", kvId: 0 };
  let pos = 0;

  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType === PROTO_WIRE_VARINT && fieldNum === CURSOR_KSM_ID) {
      const [value, nextPos, ok] = readVarint(buf, pos);
      if (!ok) break;
      event.kvId = value;
      pos = nextPos;
      continue;
    }

    if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [data, nextPos, ok] = readLengthDelimited(buf, pos);
      if (!ok) break;
      pos = nextPos;
      if (fieldNum === CURSOR_KSM_GET_BLOB_ARGS) {
        event.type = "kv_get_blob";
        event.blobId = decodeCursorBytesField(data, CURSOR_BLOB_ID, state);
      } else if (fieldNum === CURSOR_KSM_SET_BLOB_ARGS) {
        event.type = "kv_set_blob";
        event.blobId = decodeCursorBytesField(data, CURSOR_BLOB_ID, state);
        event.blobData = decodeCursorBytesField(data, CURSOR_BLOB_DATA, state);
      }
      continue;
    }

    const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
    if (!ok) break;
    pos = nextPos;
  }

  return event;
}

function decodeCursorShellArgs(buf, state = createParseState()) {
  return {
    command: decodeCursorStringField(buf, CURSOR_COMMAND, state),
    workingDirectory: decodeCursorStringField(buf, CURSOR_WORKING_DIRECTORY, state),
  };
}

function decodeCursorExecServerMessage(buf, state = createParseState()) {
  const event = { type: "exec_server_message", execMsgId: 0, execId: "" };
  let pos = 0;

  while (pos < buf.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(buf, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType === PROTO_WIRE_VARINT && fieldNum === CURSOR_ESM_ID) {
      const [value, nextPos, ok] = readVarint(buf, pos);
      if (!ok) break;
      event.execMsgId = value;
      pos = nextPos;
      continue;
    }

    if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [data, nextPos, ok] = readLengthDelimited(buf, pos);
      if (!ok) break;
      pos = nextPos;

      if (fieldNum === CURSOR_ESM_EXEC_ID) {
        event.execId = decodeUtf8Text(data);
      } else if (fieldNum === CURSOR_ESM_REQUEST_CONTEXT_ARGS) {
        event.type = "exec_request_context";
      } else if (fieldNum === CURSOR_ESM_MCP_ARGS) {
        event.type = "exec_mcp_error";
      } else if (fieldNum === CURSOR_ESM_READ_ARGS) {
        event.type = "exec_read_rejected";
        event.path = decodeCursorStringField(data, CURSOR_PATH, state);
      } else if (fieldNum === CURSOR_ESM_WRITE_ARGS) {
        event.type = "exec_write_rejected";
        event.path = decodeCursorStringField(data, CURSOR_PATH, state);
      } else if (fieldNum === CURSOR_ESM_DELETE_ARGS) {
        event.type = "exec_delete_rejected";
        event.path = decodeCursorStringField(data, CURSOR_PATH, state);
      } else if (fieldNum === CURSOR_ESM_LS_ARGS) {
        event.type = "exec_ls_rejected";
        event.path = decodeCursorStringField(data, CURSOR_PATH, state);
      } else if (fieldNum === CURSOR_ESM_GREP_ARGS) {
        event.type = "exec_grep_error";
      } else if (fieldNum === CURSOR_ESM_SHELL_ARGS || fieldNum === CURSOR_ESM_SHELL_STREAM_ARGS) {
        event.type = fieldNum === CURSOR_ESM_SHELL_STREAM_ARGS ? "exec_shell_stream_rejected" : "exec_shell_rejected";
        Object.assign(event, decodeCursorShellArgs(data, state));
      } else if (fieldNum === CURSOR_ESM_BACKGROUND_SHELL_SPAWN) {
        event.type = "exec_background_shell_rejected";
        Object.assign(event, decodeCursorShellArgs(data, state));
      } else if (fieldNum === CURSOR_ESM_FETCH_ARGS) {
        event.type = "exec_fetch_error";
        event.url = decodeCursorStringField(data, CURSOR_FETCH_URL, state);
      } else if (fieldNum === CURSOR_ESM_DIAGNOSTICS_ARGS) {
        event.type = "exec_diagnostics_result";
      } else if (fieldNum === CURSOR_ESM_WRITE_SHELL_STDIN_ARGS) {
        event.type = "exec_write_shell_stdin_error";
      } else if (event.type === "exec_server_message") {
        event.type = "exec_other_error";
        event.execFieldNumber = fieldNum;
      }
      continue;
    }

    const [nextPos, ok] = skipProtoFieldValue(buf, pos, wireType);
    if (!ok) break;
    pos = nextPos;
  }

  return event;
}

function decodeCursorServerMessage(payload, options = {}) {
  const state = options.state || createParseState(options);
  const events = [];
  let pos = 0;

  while (pos < payload.length) {
    if (!countDecodedField(state)) break;
    const [tag, tagEnd, tagOk] = readVarint(payload, pos);
    if (!tagOk || tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x07;
    if (wireType !== PROTO_WIRE_LENGTH_DELIMITED) {
      const [nextPos, ok] = skipProtoFieldValue(payload, pos, wireType);
      if (!ok) break;
      pos = nextPos;
      continue;
    }

    const [data, nextPos, ok] = readLengthDelimited(payload, pos);
    if (!ok) break;
    pos = nextPos;

    if (fieldNum === CURSOR_ASM_INTERACTION_UPDATE) {
      events.push(...decodeCursorInteractionUpdate(data, state));
    } else if (fieldNum === CURSOR_ASM_CONVERSATION_CHECKPOINT) {
      events.push({ type: "checkpoint", bytes: Buffer.from(data) });
    } else if (fieldNum === CURSOR_ASM_KV_SERVER_MESSAGE) {
      events.push(decodeCursorKvServerMessage(data, state));
    } else if (fieldNum === CURSOR_ASM_EXEC_SERVER_MESSAGE) {
      events.push(decodeCursorExecServerMessage(data, state));
    }
  }

  return events;
}

function parseConnectEndStream(payload) {
  if (!payload || payload.length === 0) return null;
  let trailer;
  try {
    trailer = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Cursor direct Connect end-stream parse failed: ${message}`);
  }

  const trailerError = trailer?.error;
  if (!trailerError) return null;
  const code = String(trailerError.code || "unknown");
  const message = String(trailerError.message || "Unknown error");
  const error = new Error(`Cursor direct Connect error ${code}: ${message}`);
  error.code = code;
  return error;
}

function parseConnectFrames(data, options = {}) {
  const parser = createConnectFrameParser(options);
  return parser.push(data);
}

function createConnectFrameParser(options = {}) {
  const state = createParseState(options);
  let pending = Buffer.alloc(0);
  let frameIndex = 0;
  let bufferedBytes = 0;

  return {
    push(chunk) {
      const input = Buffer.from(chunk || Buffer.alloc(0));
      if (input.length <= 0) return [];
      bufferedBytes += input.length;
      if (bufferedBytes > state.limits.maxTotalBytes) {
        pending = Buffer.alloc(0);
        throw new Error(`Cursor direct response exceeded parse limit (${state.limits.maxTotalBytes} bytes)`);
      }

      pending = pending.length > 0 ? Buffer.concat([pending, input]) : input;
      const events = [];
      let offset = 0;

      while (offset + 5 <= pending.length) {
        if (state.fields >= state.limits.maxFields || state.strings >= state.limits.maxStrings) break;
        const flags = pending[offset];
        const length = pending.readUInt32BE(offset + 1);
        if (length > state.limits.maxFrameBytes) {
          pending = Buffer.alloc(0);
          throw new Error(`Cursor direct frame exceeded parse limit (${state.limits.maxFrameBytes} bytes)`);
        }
        if (offset + 5 + length > pending.length) break;
        let payload = pending.subarray(offset + 5, offset + 5 + length);
        if (flags & CONNECT_COMPRESSION_FLAG) {
          try {
            payload = zlib.gunzipSync(payload);
          } catch {
            // keep the original payload
          }
        }

        if (flags & CONNECT_END_STREAM_FLAG) {
          const trailerError = parseConnectEndStream(payload);
          if (trailerError) {
            pending = Buffer.alloc(0);
            throw trailerError;
          }
          events.push({ type: "connect_end", frameIndex, eventIndex: 0 });
          offset += 5 + length;
          frameIndex += 1;
          continue;
        }

        let eventIndex = 0;
        for (const event of decodeCursorServerMessage(payload, { state })) {
          if (event.type === "text_delta") {
            events.push({
              ...event,
              fieldPath: "1.1.1",
              depth: 2,
              frameIndex,
              eventIndex,
            });
            state.strings += 1;
          } else if (
            event.type === "turn_ended" ||
            event.type === "kv_get_blob" ||
            event.type === "kv_set_blob" ||
            String(event.type || "").startsWith("exec_")
          ) {
            events.push({ ...event, frameIndex, eventIndex });
          } else if (options.includeNonTextEvents) {
            events.push({ ...event, frameIndex, eventIndex });
          }
          eventIndex += 1;
        }
        offset += 5 + length;
        frameIndex += 1;
      }

      pending = offset > 0 ? pending.subarray(offset) : pending;
      return events;
    },
    finish() {
      return { pendingBytes: pending.length, frameIndex };
    },
  };
}

function looksLikeOpaqueToken(text) {
  const value = text.trim();
  if (/^[0-9a-f]{12,}$/i.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  if (/^[A-Za-z0-9_-]{48,}$/.test(value) && !/\s/.test(value)) return true;
  return false;
}

function looksLikeProtocolLabel(text) {
  const value = text.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.[A-Za-z0-9]{1,8}$/.test(value)) return true;
  if (/^The user (asks|wants|is|has|greets|requests|provided|said|needs)\b/i.test(value)) return true;
  if (/^["'`“”‘’]{2}\s+in\s+[A-Za-z][A-Za-z -]{1,40}\.?$/u.test(value)) return true;
  if (/^["'`“”‘’][^"'`“”‘’]{0,120}["'`“”‘’]\s+in\s+[A-Za-z][A-Za-z -]{1,40}\.?$/u.test(value)) return true;
  return false;
}

function countLettersAndNumbers(text) {
  return (String(text || "").match(/[\p{L}\p{N}]/gu) || []).length;
}

function pickAssistantCandidate(strings, options = {}) {
  return pickAssistantText(strings, options);
}

function getAssistantCandidates(strings, options = {}) {
  const prompt = String(options.prompt || "");
  const model = String(options.model || "");
  const ignoredExact = new Set([
    prompt.trim(),
    model,
    displayModelId(model),
    "/context.txt",
    "OpenAI-compatible direct gateway request",
  ].filter(Boolean));

  const candidates = strings
    .map((item) => ({ ...item, text: String(item.text || "").trim() }))
    .filter((item) => {
      if (!item.text || item.text.length > 12000) return false;
      if (ignoredExact.has(item.text)) return false;
      if (looksLikeOpaqueToken(item.text)) return false;
      if (looksLikeProtocolLabel(item.text)) return false;
      if (countLettersAndNumbers(item.text) === 0) return false;
      if (/^(cli|true|false|ok)$/i.test(item.text)) return false;
      if (item.text.includes("<user_query>")) return false;
      if (item.text.includes('"role"') || item.text.includes("providerOptions")) return false;
      if (item.text.includes("serverGenReqId")) return false;
      return true;
    })
    .map((item) => {
      const letterNumberCount = countLettersAndNumbers(item.text);
      let score = item.frameIndex * 2 + item.depth;
      if (item.text.includes(" ")) score += 20;
      if (/[.!?。！？]$/.test(item.text)) score += 15;
      score += Math.min(item.text.length, 600);
      score += Math.min(letterNumberCount * 2, 400);
      if (item.text.length <= 3) score -= 50;
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates;
}

function commonSuffixPrefixLength(left, right) {
  const max = Math.min(left.length, right.length);
  for (let size = max; size >= 1; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}

function normalizeComparableText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = 0;
  while (index >= 0) {
    index = haystack.indexOf(needle, index);
    if (index < 0) break;
    count += 1;
    index += Math.max(1, needle.length);
  }
  return count;
}

function isCjkTextChar(value) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u.test(value);
}

function shouldInsertFragmentSpace(output, fragment) {
  if (/\s$/.test(output) || /^\s/.test(fragment)) return false;
  if (/^[,.;:!?)}\]\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a\uff09\u3011\u300d\u300f]/u.test(fragment)) return false;
  const left = Array.from(output).pop() || "";
  const right = Array.from(fragment)[0] || "";
  if (isCjkTextChar(left) || isCjkTextChar(right)) return false;
  return true;
}

function appendAssistantFragment(output, fragment) {
  if (!fragment) return output;
  if (!output) return fragment;
  if (output === fragment || output.endsWith(fragment)) return output;
  if (fragment.startsWith(output)) return fragment;

  const outputComparable = normalizeComparableText(output);
  const fragmentComparable = normalizeComparableText(fragment);
  if (fragmentComparable && outputComparable.includes(fragmentComparable)) return output;
  if (outputComparable && fragmentComparable.startsWith(outputComparable)) return fragment;

  const overlap = commonSuffixPrefixLength(output, fragment);
  if (overlap > 0) return output + fragment.slice(overlap);

  const needsSpace = shouldInsertFragmentSpace(output, fragment);
  return `${output}${needsSpace ? " " : ""}${fragment}`;
}

function appendAssistantFragmentWithDelta(output, fragment) {
  const nextText = appendAssistantFragment(output, fragment);
  if (nextText === output) return { text: output, delta: "" };
  if (!output) return { text: nextText, delta: nextText };
  if (nextText.startsWith(output)) return { text: nextText, delta: nextText.slice(output.length) };
  return { text: nextText, delta: nextText };
}

function pickAssistantText(strings, options = {}) {
  const candidates = getAssistantCandidates(strings, options);
  if (candidates.length === 0) return "";

  const bestByFrame = new Map();
  for (const candidate of candidates) {
    const previous = bestByFrame.get(candidate.frameIndex);
    if (!previous || candidate.score > previous.score) {
      bestByFrame.set(candidate.frameIndex, candidate);
    }
  }

  const ordered = Array.from(bestByFrame.values())
    .sort((a, b) => (a.frameIndex - b.frameIndex) || (a.depth - b.depth) || a.fieldPath.localeCompare(b.fieldPath));

  let merged = "";
  for (const item of ordered) {
    merged = appendAssistantFragment(merged, item.text);
  }

  const bestSingle = candidates[0]?.text || "";
  const mergedComparable = normalizeComparableText(merged);
  const bestComparable = normalizeComparableText(bestSingle);
  if (
    bestSingle.length >= 20 &&
    bestComparable.length >= 12 &&
    countOccurrences(mergedComparable, bestComparable) > 1
  ) {
    return bestSingle;
  }

  return merged.length >= bestSingle.length ? merged : bestSingle;
}

function createAssistantTextAccumulator(options = {}) {
  const state = { text: "", lastFrameIndex: -1 };
  return {
    get text() {
      return state.text;
    },
    pushStrings(strings = []) {
      const textDeltas = strings
        .filter((item) => item?.type === "text_delta" && typeof item.text === "string")
        .sort((a, b) => (
          (a.frameIndex - b.frameIndex)
          || ((a.eventIndex ?? 0) - (b.eventIndex ?? 0))
        ));
      if (textDeltas.length > 0) {
        const deltas = [];
        for (const item of textDeltas) {
          if (item.frameIndex < state.lastFrameIndex) continue;
          state.text += item.text;
          state.lastFrameIndex = Math.max(state.lastFrameIndex, item.frameIndex);
          if (item.text) deltas.push(item.text);
        }
        return deltas;
      }

      const candidates = getAssistantCandidates(strings, options);
      const bestByFrame = new Map();
      for (const candidate of candidates) {
        const previous = bestByFrame.get(candidate.frameIndex);
        if (!previous || candidate.score > previous.score) {
          bestByFrame.set(candidate.frameIndex, candidate);
        }
      }

      const ordered = Array.from(bestByFrame.values())
        .sort((a, b) => (a.frameIndex - b.frameIndex) || (a.depth - b.depth) || a.fieldPath.localeCompare(b.fieldPath));
      const deltas = [];
      for (const item of ordered) {
        if (item.frameIndex < state.lastFrameIndex) continue;
        const next = appendAssistantFragmentWithDelta(state.text, item.text);
        state.text = next.text;
        state.lastFrameIndex = Math.max(state.lastFrameIndex, item.frameIndex);
        if (next.delta) deltas.push(next.delta);
      }
      return deltas;
    },
  };
}

function encodeAgentClientMessage(field, message) {
  const clientMessage = new ProtoWriter();
  clientMessage.writeMessage(field, message);
  return clientMessage.toBuffer();
}

function encodeKvGetBlobResult(event, blobStore = new Map()) {
  const result = new ProtoWriter();
  const key = Buffer.from(event.blobId || Buffer.alloc(0)).toString("hex");
  const blobData = typeof blobStore.get === "function" ? blobStore.get(key) : blobStore[key];
  if (blobData) result.writeBytes(1, blobData);

  const message = new ProtoWriter();
  message.writeInt32(CURSOR_KCM_ID, event.kvId || 0);
  message.writeMessage(CURSOR_KCM_GET_BLOB_RESULT, result);
  return encodeAgentClientMessage(CURSOR_ACM_KV_CLIENT_MESSAGE, message);
}

function encodeKvSetBlobResult(event, blobStore = new Map()) {
  const key = Buffer.from(event.blobId || Buffer.alloc(0)).toString("hex");
  if (key && event.blobData) {
    if (typeof blobStore.set === "function") blobStore.set(key, Buffer.from(event.blobData));
    else blobStore[key] = Buffer.from(event.blobData);
  }

  const message = new ProtoWriter();
  message.writeInt32(CURSOR_KCM_ID, event.kvId || 0);
  message.writeMessage(CURSOR_KCM_SET_BLOB_RESULT, new ProtoWriter());
  return encodeAgentClientMessage(CURSOR_ACM_KV_CLIENT_MESSAGE, message);
}

function encodeExecClientMessage(event, resultField, result) {
  const message = new ProtoWriter();
  message.writeInt32(CURSOR_ECM_ID, event.execMsgId || 0);
  message.writeString(CURSOR_ECM_EXEC_ID, event.execId || "");
  message.writeMessage(resultField, result);
  return encodeAgentClientMessage(CURSOR_ACM_EXEC_CLIENT_MESSAGE, message);
}

function encodeExecRequestContextResult(event) {
  const requestContext = new ProtoWriter();
  const success = new ProtoWriter();
  success.writeMessage(CURSOR_REQUEST_CONTEXT, requestContext);
  const result = new ProtoWriter();
  result.writeMessage(CURSOR_REQUEST_CONTEXT_SUCCESS, success);
  return encodeExecClientMessage(event, CURSOR_ECM_REQUEST_CONTEXT_RESULT, result);
}

function encodePathRejected(event, resultField, rejectedField) {
  const rejected = new ProtoWriter();
  rejected.writeString(CURSOR_PATH, event.path || "");
  rejected.writeString(CURSOR_REASON, CURSOR_EXEC_REJECT_REASON);
  const result = new ProtoWriter();
  result.writeMessage(rejectedField, rejected);
  return encodeExecClientMessage(event, resultField, result);
}

function encodeShellRejected(event, resultField, rejectedField) {
  const rejected = new ProtoWriter();
  rejected.writeString(CURSOR_COMMAND, event.command || "");
  rejected.writeString(CURSOR_WORKING_DIRECTORY, event.workingDirectory || "");
  rejected.writeString(CURSOR_SHELL_REASON, CURSOR_EXEC_REJECT_REASON);
  rejected.writeBool(CURSOR_SHELL_IS_READONLY, true);
  const result = new ProtoWriter();
  result.writeMessage(rejectedField, rejected);
  return encodeExecClientMessage(event, resultField, result);
}

function encodeStringError(event, resultField, errorField, fields = {}) {
  const error = new ProtoWriter();
  for (const [field, value] of Object.entries(fields)) {
    error.writeString(Number(field), value);
  }
  if (!Object.prototype.hasOwnProperty.call(fields, String(CURSOR_ERROR_TEXT))) {
    error.writeString(CURSOR_ERROR_TEXT, CURSOR_EXEC_REJECT_REASON);
  }
  const result = new ProtoWriter();
  result.writeMessage(errorField, error);
  return encodeExecClientMessage(event, resultField, result);
}

function encodeExecMcpError(event) {
  const error = new ProtoWriter();
  error.writeString(CURSOR_ERROR_TEXT, CURSOR_EXEC_REJECT_REASON);
  const result = new ProtoWriter();
  result.writeMessage(CURSOR_MCP_ERROR, error);
  return encodeExecClientMessage(event, CURSOR_ECM_MCP_RESULT, result);
}

function encodeCursorClientMessageForEvent(event, state = {}) {
  if (event?.type === "kv_get_blob") return encodeKvGetBlobResult(event, state.blobStore);
  if (event?.type === "kv_set_blob") return encodeKvSetBlobResult(event, state.blobStore);
  if (event?.type === "exec_request_context") return encodeExecRequestContextResult(event);
  if (event?.type === "exec_mcp_error") return encodeExecMcpError(event);
  if (event?.type === "exec_read_rejected") return encodePathRejected(event, CURSOR_ECM_READ_RESULT, CURSOR_REJECTED_READ);
  if (event?.type === "exec_write_rejected") return encodePathRejected(event, CURSOR_ECM_WRITE_RESULT, CURSOR_REJECTED_WRITE);
  if (event?.type === "exec_delete_rejected") return encodePathRejected(event, CURSOR_ECM_DELETE_RESULT, CURSOR_REJECTED_DELETE);
  if (event?.type === "exec_ls_rejected") return encodePathRejected(event, CURSOR_ECM_LS_RESULT, CURSOR_REJECTED_LS);
  if (event?.type === "exec_grep_error") return encodeStringError(event, CURSOR_ECM_GREP_RESULT, CURSOR_ERROR_GREP);
  if (event?.type === "exec_shell_rejected") return encodeShellRejected(event, CURSOR_ECM_SHELL_RESULT, CURSOR_REJECTED_SHELL);
  if (event?.type === "exec_shell_stream_rejected") return encodeShellRejected(event, CURSOR_ECM_SHELL_STREAM, CURSOR_REJECTED_SHELL);
  if (event?.type === "exec_background_shell_rejected") {
    return encodeShellRejected(event, CURSOR_ECM_BACKGROUND_SHELL_SPAWN_RESULT, CURSOR_REJECTED_BACKGROUND_SHELL);
  }
  if (event?.type === "exec_fetch_error") {
    return encodeStringError(event, CURSOR_ECM_FETCH_RESULT, CURSOR_ERROR_FETCH, {
      [CURSOR_FETCH_URL]: event.url || "",
      [CURSOR_FETCH_ERROR]: CURSOR_EXEC_REJECT_REASON,
    });
  }
  if (event?.type === "exec_diagnostics_result") return encodeExecClientMessage(event, CURSOR_ECM_DIAGNOSTICS_RESULT, new ProtoWriter());
  if (event?.type === "exec_write_shell_stdin_error") {
    return encodeStringError(event, CURSOR_ECM_WRITE_SHELL_STDIN_RESULT, CURSOR_ERROR_WRITE_SHELL_STDIN);
  }
  return null;
}

function createCursorClientResponsesForEvents(events = [], state = {}) {
  const frames = [];
  for (const event of Array.isArray(events) ? events : []) {
    const payload = encodeCursorClientMessageForEvent(event, state);
    if (payload) frames.push(createConnectFrame(payload));
  }
  return frames;
}

function writeCursorClientResponses(events = [], request, state = {}) {
  if (!request || request.destroyed || request.writableEnded) {
    return { count: 0, bytes: 0 };
  }
  let count = 0;
  let bytes = 0;
  for (const frame of createCursorClientResponsesForEvents(events, state)) {
    request.write(frame);
    count += 1;
    bytes += frame.length;
  }
  return { count, bytes };
}

function applyDirectCompletionEvents(events = [], options = {}) {
  const accumulator = options.accumulator || createAssistantTextAccumulator(options);
  const eventList = Array.isArray(events) ? events : [];
  const textEvents = eventList.filter((event) => (
    event?.type === "text_delta" ||
    (!event?.type && typeof event?.text === "string")
  ));
  const deltas = accumulator.pushStrings(textEvents);

  for (const delta of deltas) {
    if (!delta) continue;
    options.onDelta?.(delta, {
      text: accumulator.text,
      ...(options.meta || {}),
    });
  }

  return {
    eventCount: eventList.length,
    textEventCount: textEvents.length,
    deltaCount: deltas.filter(Boolean).length,
    turnEnded: eventList.some((event) => event?.type === "turn_ended"),
    connectEnded: eventList.some((event) => event?.type === "connect_end"),
  };
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function buildPromptFromMessages(messages) {
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = typeof message?.role === "string" ? message.role : "user";
    const content = extractTextContent(message?.content).trim();
    if (!content) continue;
    if (role === "tool") {
      lines.push(`TOOL_RESULT (${message?.tool_call_id || "unknown"}): ${content}`);
    } else {
      lines.push(`${role.toUpperCase()}: ${content}`);
    }
  }
  return lines.join("\n\n").trim() || "Hello";
}

function extractClaudeTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => extractClaudeTextContent(part))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string" || Array.isArray(content.content)) {
      return extractClaudeTextContent(content.content);
    }
    return "";
  }
  if (content == null) return "";
  return String(content);
}

function normalizeClaudeTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool) => tool && typeof tool.name === "string" && tool.name.trim())
    .map((tool) => ({
      name: tool.name.trim(),
      description: typeof tool.description === "string" ? tool.description : "",
      input_schema: tool.input_schema && typeof tool.input_schema === "object"
        ? tool.input_schema
        : { type: "object", properties: {} },
    }));
}

function normalizeClaudeToolChoice(toolChoice) {
  if (!toolChoice || typeof toolChoice !== "object") return null;
  const type = typeof toolChoice.type === "string" ? toolChoice.type : "";
  if (type === "auto" || !type) return { type: "auto" };
  if (type === "none") return { type: "none" };
  if (type === "any") return { type: "any" };
  if (type === "tool" && typeof toolChoice.name === "string" && toolChoice.name.trim()) {
    return { type: "tool", name: toolChoice.name.trim() };
  }
  return null;
}

function buildClaudeToolsPrompt(tools = [], toolChoice = null) {
  const normalizedTools = normalizeClaudeTools(tools);
  const normalizedChoice = normalizeClaudeToolChoice(toolChoice);
  if (normalizedTools.length === 0 || normalizedChoice?.type === "none") return "";
  const choiceLine = normalizedChoice?.type === "tool"
    ? `You must call tool "${normalizedChoice.name}".`
    : normalizedChoice?.type === "any"
      ? "You must call one available tool."
      : "Call a tool when it is needed to answer or perform the user's request.";
  return [
    "CLAUDE_TOOL_USE_CONTRACT:",
    "You are behind a gateway that converts strict JSON into Anthropic tool_use blocks.",
    "You do not execute tools yourself; the gateway executes the listed tool after you emit the JSON call.",
    "Listed tools are available through the gateway even if the upstream model runtime has no native tool API.",
    "Never say a listed tool is unavailable. If a listed tool should be used, emit the JSON call instead.",
    "When calling a tool, reply with only one JSON object and no prose, markdown, or code fences.",
    'The JSON shape is: {"type":"tool_use","name":"<tool name>","input":{...}}',
    "Infer the input object from the conversation and the tool input_schema; use {} only when no arguments can be inferred.",
    choiceLine,
    "Available tools JSON:",
    JSON.stringify(normalizedTools),
  ].join("\n");
}

function formatClaudeMessageForPrompt(message) {
  const role = typeof message?.role === "string" ? message.role : "user";
  const content = message?.content;
  if (Array.isArray(content)) {
    const lines = [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        const text = extractClaudeTextContent(part).trim();
        if (text) lines.push(`${role.toUpperCase()}: ${text}`);
        continue;
      }
      if (part.type === "tool_use") {
        const input = part.input && typeof part.input === "object" ? part.input : {};
        lines.push(`ASSISTANT_TOOL_USE (${part.id || "unknown"}): ${part.name || "unknown"} ${JSON.stringify(input)}`);
        continue;
      }
      if (part.type === "tool_result") {
        const text = extractClaudeTextContent(part.content).trim();
        lines.push(`USER_TOOL_RESULT (${part.tool_use_id || "unknown"}): ${text || ""}`);
        continue;
      }
      const text = extractClaudeTextContent(part).trim();
      if (text) lines.push(`${role.toUpperCase()}: ${text}`);
    }
    return lines;
  }
  const text = extractClaudeTextContent(content).trim();
  return text ? [`${role.toUpperCase()}: ${text}`] : [];
}

function buildPromptFromClaudeMessages(messages, system = undefined, options = {}) {
  const lines = [];
  const systemText = extractClaudeTextContent(system).trim();
  if (systemText) lines.push(`SYSTEM: ${systemText}`);

  const toolsPrompt = buildClaudeToolsPrompt(options.tools, options.toolChoice);
  if (toolsPrompt) lines.push(toolsPrompt);

  for (const message of Array.isArray(messages) ? messages : []) {
    lines.push(...formatClaudeMessageForPrompt(message));
  }

  return lines.join("\n\n").trim() || "Hello";
}

function stripJsonCodeFence(text) {
  const value = String(text || "").trim();
  const fence = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : value;
}

function extractFirstJsonObject(text) {
  const value = stripJsonCodeFence(text);
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to balanced-object scanning
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = inString;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(value.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch {
          // continue scanning
        }
      }
    }
  }
  return null;
}

function normalizeToolUseInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return { input: value };
    }
  }
  return {};
}

function pickToolNameByAliases(tools, aliases) {
  const requestedTools = normalizeClaudeTools(tools);
  const aliasSet = new Set(
    (Array.isArray(aliases) ? aliases : [])
      .map((alias) => String(alias || "").trim().toLowerCase())
      .filter(Boolean),
  );
  for (const tool of requestedTools) {
    if (aliasSet.has(tool.name.toLowerCase())) return tool.name;
  }
  return "";
}

function buildCursorNativeToolInput(event, toolName) {
  const canonical = String(toolName || "").trim().toLowerCase();
  if (canonical === "read") return { file_path: event.path || "" };
  if (canonical === "ls" || canonical === "list") return { path: event.path || "" };
  if (canonical === "bash" || canonical === "shell") {
    const input = { command: event.command || "" };
    if (event.workingDirectory) input.working_directory = event.workingDirectory;
    return input;
  }
  if (canonical === "fetch" || canonical === "webfetch") return { url: event.url || "" };
  return {};
}

function buildCursorNativeToolUse(event, options = {}) {
  if (!event || typeof event !== "object") return null;
  const choice = normalizeClaudeToolChoice(options.toolChoice);
  if (choice?.type === "none") return null;

  let toolName = "";
  if (event.type === "exec_read_rejected") {
    toolName = pickToolNameByAliases(options.tools, ["Read", "read", "read_file", "ReadFile"]);
  } else if (event.type === "exec_ls_rejected") {
    toolName = pickToolNameByAliases(options.tools, ["LS", "List", "ls", "list"]);
  } else if (
    event.type === "exec_shell_rejected" ||
    event.type === "exec_shell_stream_rejected" ||
    event.type === "exec_background_shell_rejected"
  ) {
    toolName = pickToolNameByAliases(options.tools, ["Bash", "Shell", "bash", "shell"]);
  } else if (event.type === "exec_fetch_error") {
    toolName = pickToolNameByAliases(options.tools, ["Fetch", "WebFetch", "fetch", "webfetch"]);
  }

  if (!toolName) return null;
  if (choice?.type === "tool" && toolName !== choice.name) return null;

  return {
    id: `toolu_${randomUUID().replace(/-/g, "")}`,
    name: toolName,
    input: buildCursorNativeToolInput(event, toolName),
    source: "cursor_native",
    eventType: event.type,
  };
}

function findCursorNativeToolUse(events = [], options = {}) {
  for (const event of Array.isArray(events) ? events : []) {
    const toolUse = buildCursorNativeToolUse(event, options);
    if (toolUse) return toolUse;
  }
  return null;
}

function parseClaudeToolUse(text, options = {}) {
  const root = extractFirstJsonObject(text);
  if (!root) return null;
  const candidate = Array.isArray(root.tool_calls) ? root.tool_calls[0] : (root.tool_use || root);
  if (!candidate || typeof candidate !== "object") return null;
  const requestedTools = normalizeClaudeTools(options.tools);
  const toolNames = new Map(requestedTools.map((tool) => [tool.name.toLowerCase(), tool.name]));
  const choice = normalizeClaudeToolChoice(options.toolChoice);
  const rawName = candidate.name || candidate.tool || candidate.tool_name || candidate.function?.name;
  if (typeof rawName !== "string" || !rawName.trim()) return null;
  const canonicalName = toolNames.get(rawName.trim().toLowerCase()) || rawName.trim();
  if (requestedTools.length > 0 && !toolNames.has(canonicalName.toLowerCase())) return null;
  if (choice?.type === "tool" && canonicalName !== choice.name) return null;
  return {
    id: typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `toolu_${randomUUID().replace(/-/g, "")}`,
    name: canonicalName,
    input: normalizeToolUseInput(candidate.input ?? candidate.arguments ?? candidate.args ?? candidate.function?.arguments),
  };
}

function runDirectCompletion(prompt, model, options = {}) {
  return new Promise(async (resolve, reject) => {
    let token;
    try {
      token = options.accessToken || options.account?.accessToken || await getAccessToken();
    } catch (error) {
      reject(error);
      return;
    }

    const started = Date.now();
    const client = http2.connect(`https://${config.agentHost}`);
    const payload = createConnectFrame(buildDirectRunPayload(prompt, model));
    const parser = createConnectFrameParser();
    const accumulator = createAssistantTextAccumulator({ prompt, model });
    let responseBytes = 0;
    let stringCount = 0;
    let deltaCount = 0;
    let status = 0;
    let settled = false;
    let idleTimer = null;
    let hardTimer = null;
    let request = null;
    let emittedContent = false;
    let abortHandler = null;
    const cursorClientState = { blobStore: new Map() };

    const makeError = (message, errorOptions = {}) => {
      const error = new Error(message);
      error.beforeFirstPayload = errorOptions.beforeFirstPayload ?? !emittedContent;
      return error;
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      if (options.signal && abortHandler) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      if (request) {
        try {
          request.close();
          request.destroy();
        } catch {
          // ignore
        }
      }
      try {
        client.close();
        client.destroy();
      } catch {
        // ignore
      }
      fn(value);
    };

    const handleCompletionEvents = (events) => {
      const result = applyDirectCompletionEvents(events, {
        accumulator,
        meta: { status, bytes: responseBytes },
        onDelta: (delta, meta) => {
          emittedContent = true;
          if (typeof options.onDelta === "function") {
            options.onDelta(delta, meta);
          }
        },
      });
      stringCount += result.textEventCount;
      deltaCount += result.deltaCount;
      if (result.turnEnded || result.connectEnded) {
        finishWithCurrentData(result.turnEnded ? "turn-ended" : "connect-end");
      }
    };

    const finishWithCurrentData = (reason = "complete") => {
      const text = accumulator.text;
      if (status && status !== 200) {
        settle(reject, makeError(`Cursor direct HTTP ${status}`));
        return;
      }
      if (!text) {
        const suffix = reason === "hard-timeout" ? " before timeout" : "";
        settle(reject, makeError(`Cursor direct returned no assistant text${suffix} (${responseBytes} bytes)`));
        return;
      }
      settle(resolve, {
        text,
        status,
        durationMs: Date.now() - started,
        bytes: responseBytes,
        stringCount,
        deltaCount,
      });
    };

    if (options.signal?.aborted) {
      settle(reject, makeError("Cursor direct request was cancelled"));
      return;
    }

    if (options.signal) {
      abortHandler = () => {
        settle(reject, makeError("Cursor direct request was cancelled"));
      };
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    hardTimer = setTimeout(() => finishWithCurrentData("hard-timeout"), Math.max(1000, config.hardTimeoutMs));

    request = client.request({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/Run",
      authorization: `Bearer ${token}`,
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "user-agent": "connect-es/1.4.0",
      "x-cursor-checksum": generateChecksum(token),
      "x-cursor-client-type": "cli",
      "x-cursor-client-version": config.clientVersion,
      "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      "x-ghost-mode": "true",
      "x-request-id": randomUUID(),
    });

    request.on("response", (headers) => {
      status = Number(headers[":status"] || 0);
    });
    request.on("data", (chunk) => {
      responseBytes += chunk.length;
      let events = [];
      try {
        events = parser.push(chunk);
      } catch (error) {
        settle(reject, makeError(error instanceof Error ? error.message : String(error)));
        return;
      }
      const nativeToolUse = options.captureNativeToolUse ? findCursorNativeToolUse(events, options) : null;
      if (nativeToolUse) {
        settle(resolve, {
          text: accumulator.text,
          toolUse: nativeToolUse,
          status,
          durationMs: Date.now() - started,
          bytes: responseBytes,
          stringCount,
          deltaCount,
        });
        return;
      }
      writeCursorClientResponses(events, request, cursorClientState);
      handleCompletionEvents(events);
      if (settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finishWithCurrentData();
      }, Math.max(250, Number(options.idleMs || config.idleMs)));
    });
    request.on("end", () => {
      finishWithCurrentData();
    });
    request.on("error", (error) => {
      error.beforeFirstPayload = !emittedContent;
      settle(reject, error);
    });
    client.on("error", (error) => {
      error.beforeFirstPayload = !emittedContent;
      settle(reject, error);
    });
    request.write(payload);
  });
}

async function runDirectCompletionWithRetry(prompt, model, options = {}) {
  const selectAccount = options.selectAccount || selectAndRefreshDirectAccount;
  const runAttempt = options.runAttempt || runDirectCompletion;
  const markResult = options.markResult || markDirectAccountResult;
  const maxAttempts = Math.max(1, Number(options.maxAttempts || (options.accountId ? 1 : 2)));
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const pinnedAccountId = attempt === 0 ? options.accountId : "";
    const selection = await selectAccount({ accountId: pinnedAccountId || "", force: options.force });
    let emittedOnAttempt = false;
    try {
      const result = await runAttempt(prompt, model, {
        accessToken: selection.account.accessToken,
        account: selection.account,
        idleMs: options.idleMs,
        signal: options.signal,
        tools: options.tools,
        toolChoice: options.toolChoice,
        captureNativeToolUse: options.captureNativeToolUse,
        onDelta: (delta, meta) => {
          emittedOnAttempt = emittedOnAttempt || Boolean(delta);
          options.onDelta?.(delta, meta);
        },
      });
      markResult(selection, true, { outputChars: result.text.length });
      return {
        ...result,
        account: summarizeDirectAccount(selection.account),
        accountId: selection.account.id,
      };
    } catch (error) {
      lastError = error;
      markResult(selection, false, { error: error instanceof Error ? error.message : String(error) });
      const beforeFirstPayload = error?.beforeFirstPayload !== false && !emittedOnAttempt;
      const canRetry = !options.accountId && beforeFirstPayload && attempt + 1 < maxAttempts;
      if (!canRetry) throw error;
      log("debug", "retrying cursor direct request before first payload", {
        attempt: attempt + 1,
        accountId: selection.account?.id || "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError || new Error("Cursor direct request failed");
}

async function runDirectCompletionFromPool(prompt, model, options = {}) {
  return runDirectCompletionWithRetry(prompt, model, options);
}

function beginTrackedRequest(model, promptChars, options = {}) {
  const started = Date.now();
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  stats.lastModel = model;
  stats.lastPromptChars = promptChars;
  stats.lastRequestAt = started;
  stats.lastStream = Boolean(options.stream);

  let finished = false;
  return (ok, details = {}) => {
    if (finished) return;
    finished = true;
    const duration = Date.now() - started;
    stats.activeRequests = Math.max(0, stats.activeRequests - 1);
    stats.lastDurationMs = duration;
    if (ok) {
      stats.successRequests += 1;
      stats.totalDurationMs += duration;
      stats.lastOutputChars = Number(details.outputChars) || 0;
      stats.lastUpstreamBytes = Number(details.upstreamBytes) || 0;
      stats.lastStringCount = Number(details.stringCount) || 0;
      stats.lastDeltaCount = Number(details.deltaCount) || 0;
    } else {
      stats.failedRequests += 1;
      stats.lastError = String(details.error || "unknown error").slice(0, 600);
    }
  };
}

function estimateUsage(prompt, output) {
  const promptTokens = Math.max(1, Math.ceil(String(prompt).length / 4));
  const completionTokens = Math.max(1, Math.ceil(String(output).length / 4));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function createChatCompletion(model, content, prompt) {
  return {
    id: `cursor-direct-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: displayModelId(model),
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: estimateUsage(prompt, content),
  };
}

function createChunk(id, model, delta, done = false) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: displayModelId(model),
    choices: [{ index: 0, delta, finish_reason: done ? "stop" : null }],
  };
}

function estimateClaudeUsage(prompt, output) {
  const usage = estimateUsage(prompt, output);
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
  };
}

function createClaudeMessage(model, content, prompt, options = {}) {
  return {
    id: options.id || `msg_cursor_direct_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: options.publicModel || displayModelId(model),
    content: [{ type: "text", text: content }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: estimateClaudeUsage(prompt, content),
  };
}

function createClaudeToolUseMessage(model, toolUse, prompt, options = {}) {
  const normalizedToolUse = {
    type: "tool_use",
    id: toolUse.id || `toolu_${randomUUID().replace(/-/g, "")}`,
    name: toolUse.name,
    input: toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {},
  };
  return {
    id: options.id || `msg_cursor_direct_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: options.publicModel || displayModelId(model),
    content: [normalizedToolUse],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: estimateClaudeUsage(prompt, JSON.stringify(normalizedToolUse.input)),
  };
}

function shouldAttemptClaudeToolUse(options = {}) {
  const tools = normalizeClaudeTools(options.tools);
  const toolChoice = normalizeClaudeToolChoice(options.toolChoice);
  return tools.length > 0 && toolChoice?.type !== "none";
}

function createClaudeMessagesResponse(model, content, prompt, options = {}) {
  const toolUse = options.nativeToolUse
    || (shouldAttemptClaudeToolUse(options) ? parseClaudeToolUse(content, options) : null);
  if (toolUse) {
    return createClaudeToolUseMessage(model, toolUse, prompt, {
      id: options.id,
      publicModel: options.publicModel,
    });
  }
  return createClaudeMessage(model, content, prompt, {
    id: options.id,
    publicModel: options.publicModel,
  });
}

function createClaudeMessageStartPayload(id, model, prompt) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: estimateClaudeUsage(prompt, "").input_tokens,
        output_tokens: 0,
      },
    },
  };
}

function createClaudeStreamEvent(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function createClaudeTokenCount(prompt) {
  return {
    input_tokens: estimateClaudeUsage(prompt, "").input_tokens,
  };
}

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function flushResponse(res) {
  if (typeof res.flushHeaders === "function") {
    try {
      res.flushHeaders();
    } catch {
      // ignore flush errors on already-closed responses
    }
  }
}

function html(status, body) {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password,anthropic-version,anthropic-beta",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    },
    body,
  };
}

function json(status, payload) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password,anthropic-version,anthropic-beta",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function openAiError(status, type, message) {
  return json(status, { error: { message, type } });
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

function isDirectAdminAuthorized(req, adminPassword = config.adminPassword) {
  if (!adminPassword) return false;
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const password = req.headers["x-admin-password"] || "";
  return bearer === adminPassword || password === adminPassword;
}

function isAdminAuthorized(req) {
  return isDirectAdminAuthorized(req);
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim();
}

function parseCookieHeader(value) {
  const cookies = new Map();
  const text = String(value || "");
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const val = trimmed.slice(index + 1).trim();
    if (key) cookies.set(key, val);
  }
  return cookies;
}

function getCodeBuddyOAuthToken(req) {
  return parseCookieHeader(req?.headers?.cookie || "").get("cursor_codebuddy_oauth") || "";
}

function isCodeBuddyOAuthLaunchAuthorized(req) {
  const token = getCodeBuddyOAuthToken(req);
  return Boolean(
    token &&
    codeBuddyOAuthSession.token &&
    token === codeBuddyOAuthSession.token &&
    codeBuddyOAuthSession.id &&
    isCodeBuddyOAuthSessionActive(codeBuddyOAuthSession),
  );
}

function isCodeBuddyProxyPath(routePath) {
  return routePath === "/codebuddy" ||
    routePath.startsWith("/codebuddy/") ||
    routePath === "/login" ||
    routePath.startsWith("/login/") ||
    routePath === "/auth" ||
    routePath.startsWith("/auth/") ||
    routePath === "/oauth" ||
    routePath.startsWith("/oauth/") ||
    routePath === "/assets" ||
    routePath.startsWith("/assets/") ||
    routePath === "/logo.svg" ||
    routePath === "/manifest.webmanifest" ||
    routePath === "/favicon.ico" ||
    routePath === "/favicon.svg" ||
    routePath === "/sw.js" ||
    routePath === "/api/v1" ||
    routePath.startsWith("/api/v1/") ||
    routePath === "/ws" ||
    routePath.startsWith("/ws/");
}

function buildCodeBuddyProxyTargetPath(routePath) {
  if (routePath === "/codebuddy") return "/";
  if (routePath.startsWith("/codebuddy/")) return routePath.slice("/codebuddy".length) || "/";
  return routePath;
}

function buildCodeBuddyProxyTargetUrl(url) {
  const routePath = normalizeApiPath(url.pathname);
  if (!isCodeBuddyProxyPath(routePath)) return null;
  const baseUrl = normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl);
  const target = new URL(baseUrl);
  target.pathname = buildCodeBuddyProxyTargetPath(routePath);
  target.search = url.search;
  target.hash = "";
  return target;
}

function createCodeBuddyProxyRequestHeaders(req, targetUrl) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length" || lower === "connection" || lower === "upgrade" || lower === "proxy-connection") {
      continue;
    }
    if (lower === "x-admin-password") {
      continue;
    }
    if (lower === "authorization" && isDirectAdminAuthorized({ headers: { authorization: value } })) {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

function rewriteCodeBuddyLocationHeader(location, targetUrl, publicOrigin) {
  const text = String(location || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text, targetUrl);
    if (parsed.origin === targetUrl.origin || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "0.0.0.0" || parsed.hostname === "::1") {
      if (parsed.pathname === "/") return "/codebuddy/";
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (publicOrigin) {
      const publicBase = new URL(publicOrigin);
      if (parsed.origin === publicBase.origin) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    }
  } catch {
    return text;
  }
  return text;
}

function createCodeBuddyProxyResponseHeaders(upstreamResponse, targetUrl, publicOrigin) {
  const headers = {};
  upstreamResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "connection" || lower === "keep-alive" || lower === "transfer-encoding" || lower === "content-encoding" || lower === "upgrade") {
      return;
    }
    if (lower === "location") {
      headers.location = rewriteCodeBuddyLocationHeader(value, targetUrl, publicOrigin);
      return;
    }
    if (lower === "set-cookie") return;
    headers[key] = value;
  });
  const setCookies = typeof upstreamResponse.headers.getSetCookie === "function"
    ? upstreamResponse.headers.getSetCookie()
    : [];
  if (setCookies.length > 0) {
    headers["set-cookie"] = setCookies;
  }
  return headers;
}

async function handleCodeBuddyRemoteProxy(req, res, url) {
  if (!isCodeBuddyOAuthLaunchAuthorized(req)) {
    const response = openAiError(401, "authentication_error", "CodeBuddy gateway login session required");
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  const targetUrl = buildCodeBuddyProxyTargetUrl(url);
  if (!targetUrl) {
    const response = openAiError(404, "not_found_error", `Unsupported CodeBuddy proxy path: ${url.pathname}`);
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  const publicOrigin = getPublicOrigin(req);
  const headers = createCodeBuddyProxyRequestHeaders(req, targetUrl);
  const method = String(req.method || "GET").toUpperCase();
  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : req,
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
    redirect: "manual",
  });

  const responseHeaders = createCodeBuddyProxyResponseHeaders(upstream, targetUrl, publicOrigin);
  res.writeHead(upstream.status, responseHeaders);
  if (method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }

  const reader = Readable.fromWeb(upstream.body);
  reader.on("error", (error) => {
    if (!res.writableEnded) res.destroy(error);
  });
  reader.pipe(res);
}

function createCodeBuddyUpgradeHeaders(req, targetUrl) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "x-admin-password") continue;
    if (lower === "authorization" && isDirectAdminAuthorized({ headers: { authorization: value } })) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  headers.host = targetUrl.host;
  headers.connection = headers.connection || "Upgrade";
  headers.upgrade = headers.upgrade || "websocket";
  return headers;
}

function writeUpgradeError(socket, status, message) {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function handleCodeBuddyRemoteUpgrade(req, socket, head) {
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    writeUpgradeError(socket, 400, "Bad Request");
    return;
  }

  const routePath = normalizeApiPath(url.pathname);
  if (!isCodeBuddyProxyPath(routePath)) {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }
  if (!isCodeBuddyOAuthLaunchAuthorized(req)) {
    writeUpgradeError(socket, 401, "Unauthorized");
    return;
  }

  const targetUrl = buildCodeBuddyProxyTargetUrl(url);
  if (!targetUrl || targetUrl.protocol !== "http:") {
    writeUpgradeError(socket, 502, "Bad Gateway");
    return;
  }

  const upstream = net.connect({
    host: targetUrl.hostname,
    port: Number(targetUrl.port || 80),
  });
  const closeBoth = () => {
    if (!socket.destroyed) socket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.once("connect", () => {
    const targetPath = `${targetUrl.pathname}${targetUrl.search}`;
    upstream.write(`${req.method || "GET"} ${targetPath} HTTP/${req.httpVersion || "1.1"}\r\n`);
    for (const [key, value] of Object.entries(createCodeBuddyUpgradeHeaders(req, targetUrl))) {
      upstream.write(`${key}: ${value}\r\n`);
    }
    upstream.write("\r\n");
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.once("error", () => writeUpgradeError(socket, 502, "Bad Gateway"));
  socket.once("error", closeBoth);
  socket.once("close", closeBoth);
  upstream.once("close", closeBoth);
}

async function handleCodeBuddyOAuthCallback(req, res, url) {
  const publicOrigin = getPublicOrigin(req);
  try {
    const result = await waitForCodeBuddyOAuthCompletion(url.toString(), {
      publicOrigin,
      cookieHeader: req.headers.cookie || "",
    });
    const message = result.ok
      ? "CodeBuddy 登录已确认，账号已导入账号池。"
      : result.session?.error || codeBuddyOAuthSession.error || "CodeBuddy 登录尚未完成。";
    const response = buildCodeBuddyOAuthLaunchPage(message, { publicOrigin });
    res.writeHead(result.ok ? 200 : 409, {
      ...response.headers,
      "cache-control": "no-store",
      "set-cookie": `cursor_codebuddy_oauth=${encodeURIComponent(codeBuddyOAuthSession.token || "")}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax`,
    });
    res.end(response.body);
  } catch (error) {
    const response = buildCodeBuddyOAuthLaunchPage(
      `CodeBuddy 登录回调失败：${error instanceof Error ? error.message : String(error)}`,
      { publicOrigin },
    );
    res.writeHead(500, {
      ...response.headers,
      "cache-control": "no-store",
      "set-cookie": `cursor_codebuddy_oauth=${encodeURIComponent(codeBuddyOAuthSession.token || "")}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax`,
    });
    res.end(response.body);
  }
}

function getPublicOrigin(req) {
  const configured = String(config.publicBaseUrl || "").trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      return parsed.origin;
    } catch {
      return configured.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    }
  }

  const headers = req?.headers || {};
  let host = firstHeaderValue(headers["x-forwarded-host"]) || firstHeaderValue(headers.host);
  if (!host) return "";
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, "");
  const proto = firstHeaderValue(headers["x-forwarded-proto"]) || (req?.socket?.encrypted ? "https" : "http");
  const port = firstHeaderValue(headers["x-forwarded-port"]);
  const hasPort = /^\[[^\]]+\]:\d+$/.test(host) || (/:\d+$/.test(host) && !host.includes("]:"));
  const isDefaultPort = (proto === "http" && port === "80") || (proto === "https" && port === "443");
  if (port && !hasPort && !isDefaultPort) host = `${host}:${port}`;
  return `${proto || "http"}://${host}`;
}

function getPublicBaseUrl(req, apiBasePath = "/v1") {
  const configured = String(config.publicBaseUrl || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const origin = getPublicOrigin(req);
  const path = String(apiBasePath || "/v1").startsWith("/") ? String(apiBasePath || "/v1") : `/${apiBasePath}`;
  return origin ? `${origin}${path}` : path;
}

async function handleCodeBuddyOAuthLaunch(req, res, url) {
  const id = compactText(url.searchParams.get("id") || "");
  const token = compactText(url.searchParams.get("token") || "");
  const publicOrigin = getPublicOrigin(req);
  const setCookie = `cursor_codebuddy_oauth=${encodeURIComponent(token)}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax`;
  const deny = () => {
    const response = html(403, buildCodeBuddyOAuthLaunchPage(
      "登录入口已失效或参数不正确，请回到管理台重新生成 CodeBuddy 登录入口。",
      { publicOrigin },
    ).body);
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };

  if (!id || !token || id !== codeBuddyOAuthSession.id || token !== codeBuddyOAuthSession.token) {
    deny();
    return;
  }

  try {
    codeBuddyOAuthSession.launchUrl ||= buildCodeBuddyOAuthLaunchUrl({ publicOrigin, id, token });
    codeBuddyOAuthSession.accessUrl = buildCodeBuddyRemoteUrl({ publicOrigin });
    codeBuddyOAuthSession.callbackUrl ||= buildCodeBuddyOAuthCallbackUrl({ publicOrigin, id, token });
    codeBuddyOAuthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.codeBuddyOAuthSession);

    const authUrl = compactText(codeBuddyOAuthSession.url || codeBuddyOAuthSession.login?.url || "");
    if (authUrl && codeBuddyOAuthSession.status === "waiting") {
      res.writeHead(302, {
        location: authUrl,
        "set-cookie": setCookie,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }

    const response = buildCodeBuddyOAuthLaunchPage(
      codeBuddyOAuthSession.error || "请回到管理台重新发起 CodeBuddy OAuth 登录。",
      { publicOrigin },
    );
    res.writeHead(codeBuddyOAuthSession.status === "failed" ? 500 : 409, {
      ...response.headers,
      "set-cookie": setCookie,
      "cache-control": "no-store",
    });
    res.end(response.body);
  } catch (error) {
    codeBuddyOAuthSession.status = "failed";
    codeBuddyOAuthSession.error = error instanceof Error ? error.message : String(error);
    codeBuddyOAuthSession.updatedAt = Date.now();
    clearMetadataCache(metadataCaches.codeBuddyOAuthSession);
    const response = buildCodeBuddyOAuthLaunchPage(
      `CodeBuddy 登录入口启动失败：${codeBuddyOAuthSession.error}`,
      { publicOrigin },
    );
    res.writeHead(500, {
      ...response.headers,
      "set-cookie": setCookie,
    });
    res.end(response.body);
  }
}

function getMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function getStatusPayload() {
  return {
    ok: true,
    mode: "cursor-direct",
    backend: "agent-service-run",
    authRequired: config.requireApiKey,
    authPath: config.authPath,
    accountsPath: config.accountsPath,
    codeBuddy: {
      accountsPath: config.codeBuddyAccountsPath,
      baseUrl: normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl),
      apiEndpoint: String(config.codeBuddyApiEndpoint || ""),
      chatCompletionsPath: String(config.codeBuddyChatCompletionsPath || DEFAULT_CODEBUDDY_CHAT_COMPLETIONS_PATH),
      internetEnvironment: String(config.codeBuddyInternetEnvironment || ""),
      models: listConfiguredCodeBuddyModels().map((model) => model.id),
    },
    agentHost: config.agentHost,
    clientVersion: config.clientVersion,
    uptimeMs: Date.now() - startedAt,
    stats: {
      ...stats,
      averageDurationMs: stats.successRequests > 0
        ? Math.round(stats.totalDurationMs / stats.successRequests)
        : 0,
    },
  };
}

function buildDirectAdminStatusPayload(options = {}) {
  const status = getStatusPayload();
  const apiKey = options.apiKey ?? config.apiKey;
  const publicBaseUrl = options.publicBaseUrl || config.publicBaseUrl || "";
  return {
    ...status,
    adminPath: "/direct-admin/",
    apiBasePath: "/v1",
    adminPasswordSet: Boolean(config.adminPassword),
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: maskSecret(apiKey, 6),
    publicBaseUrl,
    apiBaseUrl: config.apiBaseUrl,
    codeBuddy: {
      accountsPath: config.codeBuddyAccountsPath,
      baseUrl: normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl),
      apiEndpoint: String(config.codeBuddyApiEndpoint || ""),
      chatCompletionsPath: String(config.codeBuddyChatCompletionsPath || DEFAULT_CODEBUDDY_CHAT_COMPLETIONS_PATH),
      internetEnvironment: String(config.codeBuddyInternetEnvironment || ""),
      models: listConfiguredCodeBuddyModels().map((model) => model.id),
    },
    memory: getMemorySnapshot(),
    config: {
      host: config.host,
      port: config.port,
      authPath: config.authPath,
      accountsPath: config.accountsPath,
      codeBuddyAccountsPath: config.codeBuddyAccountsPath,
      codeBuddyBaseUrl: normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl),
      codeBuddyApiEndpoint: config.codeBuddyApiEndpoint,
      codeBuddyChatCompletionsPath: config.codeBuddyChatCompletionsPath,
      codeBuddyInternetEnvironment: config.codeBuddyInternetEnvironment,
      codeBuddyModels: config.codeBuddyModels,
      agentHost: config.agentHost,
      clientVersion: config.clientVersion,
      publicBaseUrl: config.publicBaseUrl,
      idleMs: config.idleMs,
      hardTimeoutMs: config.hardTimeoutMs,
      streamKeepAliveMs: config.streamKeepAliveMs,
      modelsCacheTtlMs: config.modelsCacheTtlMs,
      authSummaryCacheTtlMs: config.authSummaryCacheTtlMs,
      oauthSessionCacheTtlMs: config.oauthSessionCacheTtlMs,
      parseMaxDepth: config.parseMaxDepth,
      parseMaxFields: config.parseMaxFields,
      parseMaxStrings: config.parseMaxStrings,
      parseMaxStringBytes: config.parseMaxStringBytes,
      parseMaxNestedBytes: config.parseMaxNestedBytes,
      parseMaxFrameBytes: config.parseMaxFrameBytes,
      parseMaxTotalBytes: config.parseMaxTotalBytes,
    },
  };
}

function buildDirectAdminClientConfig(options = {}) {
  const apiKey = options.apiKey ?? config.apiKey;
  const publicBaseUrl = options.publicBaseUrl || config.publicBaseUrl || "";
  return {
    ok: true,
    baseUrl: publicBaseUrl,
    apiBasePath: "/v1",
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: maskSecret(apiKey, 6),
    apiKey: apiKey || "",
  };
}


async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routePath = normalizeApiPath(url.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password,anthropic-version,anthropic-beta",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  if (routePath === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    const response = json(200, getStatusPayload());
    res.writeHead(response.status, response.headers);
    res.end(req.method === "HEAD" ? undefined : response.body);
    return;
  }

  if ((routePath === "/direct-admin-preview" || routePath === "/direct-admin-preview/") && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(301, {
      location: "/direct-admin/",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end();
    return;
  }

  if ((routePath === "/direct-admin" || routePath === "/direct-admin/") && (req.method === "GET" || req.method === "HEAD")) {
    const response = html(200, buildDirectAdminHtml());
    res.writeHead(response.status, response.headers);
    res.end(req.method === "HEAD" ? undefined : response.body);
    return;
  }

  if (routePath === "/direct-admin/codebuddy/oauth/launch" && (req.method === "GET" || req.method === "HEAD")) {
    await handleCodeBuddyOAuthLaunch(req, res, url);
    return;
  }

  if (routePath === "/direct-admin/codebuddy/oauth/callback" && (req.method === "GET" || req.method === "HEAD")) {
    await handleCodeBuddyOAuthCallback(req, res, url);
    return;
  }

  if (
    routePath === "/codebuddy" ||
    routePath.startsWith("/codebuddy/") ||
    routePath.startsWith("/api/v1/") ||
    isCodeBuddyProxyPath(routePath)
  ) {
    await handleCodeBuddyRemoteProxy(req, res, url);
    return;
  }

  if (routePath.startsWith("/direct-admin/api/")) {
    if (!isAdminAuthorized(req)) {
      const response = openAiError(401, "authentication_error", "Invalid or missing admin password");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (routePath === "/direct-admin/api/status" && req.method === "GET") {
      const response = json(200, buildDirectAdminStatusPayload({
        publicBaseUrl: getPublicBaseUrl(req),
      }));
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (routePath === "/direct-admin/api/client-config" && req.method === "GET") {
      const response = json(200, buildDirectAdminClientConfig({
        publicBaseUrl: getPublicBaseUrl(req),
      }));
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/status" && req.method === "GET") {
      try {
        const accounts = summarizeCodeBuddyStore(readCodeBuddyStore());
        const chatEndpoint = config.codeBuddyApiEndpoint
          || `${normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl)}${config.codeBuddyChatCompletionsPath}`;
        const response = json(200, {
          ok: true,
          provider: "codebuddy",
          configured: Boolean(accounts.primary?.hasCredentials),
          baseUrl: normalizeCodeBuddyBaseUrl(config.codeBuddyBaseUrl),
          apiEndpoint: String(config.codeBuddyApiEndpoint || ""),
          chatEndpoint,
          chatCompletionsPath: String(config.codeBuddyChatCompletionsPath || DEFAULT_CODEBUDDY_CHAT_COMPLETIONS_PATH),
          internetEnvironment: String(config.codeBuddyInternetEnvironment || ""),
          accounts,
          models: listConfiguredCodeBuddyModels(),
          modelsSource: "configured_aliases",
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(502, "upstream_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/oauth/session" && req.method === "GET") {
      try {
        const response = json(200, await getCodeBuddyOAuthSessionPayload({
          fresh: url.searchParams.get("fresh") === "1",
          publicOrigin: getPublicOrigin(req),
          cookieHeader: req.headers.cookie || "",
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/oauth/start" && req.method === "POST") {
      try {
        const body = await readRequestBody(req).catch(() => ({}));
        const response = json(200, await startCodeBuddyOAuthSession({
          label: body?.label || "",
          site: body?.site || "global",
          publicOrigin: getPublicOrigin(req),
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/oauth/callback" && req.method === "POST") {
      try {
        const body = await readRequestBody(req).catch(() => ({}));
        const response = json(200, await waitForCodeBuddyOAuthCompletion(body?.callbackUrl || body?.url || "", {
          publicOrigin: getPublicOrigin(req),
          cookieHeader: req.headers.cookie || "",
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/oauth/poll" && req.method === "POST") {
      try {
        const response = json(200, await pollCodeBuddyOAuthSession({
          publicOrigin: getPublicOrigin(req),
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/accounts" && req.method === "GET") {
      try {
        const response = json(200, summarizeCodeBuddyStore(readCodeBuddyStore()));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/accounts/import" && req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const importBody = normalizeCodeBuddyCredentialImportRequest(body);
        const result = importCodeBuddyAccounts(readCodeBuddyStore(), importBody);
        if (result.imported.length === 0) throw new Error("No CodeBuddy accounts found in request body");
        const store = writeCodeBuddyStore(result.store);
        const response = json(200, {
          ok: true,
          imported: result.summaries,
          accounts: summarizeCodeBuddyStore(store),
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    const codeBuddyAccountRoute = routePath.match(/^\/direct-admin\/api\/codebuddy\/accounts\/([^/]+)(?:\/([^/]+))?$/);
    if (codeBuddyAccountRoute) {
      const accountId = decodeURIComponent(codeBuddyAccountRoute[1]);
      const action = codeBuddyAccountRoute[2] || "";
      try {
        if (req.method === "DELETE" && !action) {
          const store = readCodeBuddyStore();
          const nextStore = writeCodeBuddyStore({
            ...store,
            accounts: store.accounts.filter((account) => account.id !== accountId),
            nextIndex: 0,
          });
          const response = json(200, { ok: true, accounts: summarizeCodeBuddyStore(nextStore) });
          res.writeHead(response.status, response.headers);
          res.end(response.body);
          return;
        }

        if (req.method === "POST" && (action === "enable" || action === "disable")) {
          const updated = updateStoredCodeBuddyAccount(accountId, (account) => ({
            ...account,
            enabled: action === "enable",
            updatedAt: Date.now(),
          }));
          if (!updated) throw new Error(`CodeBuddy account not found: ${accountId}`);
          const response = json(200, {
            ok: true,
            account: summarizeCodeBuddyAccount(updated),
            accounts: summarizeCodeBuddyStore(readCodeBuddyStore()),
          });
          res.writeHead(response.status, response.headers);
          res.end(response.body);
          return;
        }

        const response = openAiError(404, "not_found_error", `Unsupported CodeBuddy account action: ${action || req.method}`);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/models" && req.method === "GET") {
      const response = json(200, {
        ok: true,
        provider: "codebuddy",
        models: listConfiguredCodeBuddyModels(),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (routePath === "/direct-admin/api/codebuddy/probe" && req.method === "POST") {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
        res.writeHead(response.status, response.headers);
        res.end(response.body);
        return;
      }

      const providerModel = resolveGatewayProviderModel(body?.model || "codebuddy/auto");
      const prompt = String(body?.prompt || "Reply with EXACTLY CODEBUDDY_DIRECT_OK and no other text.");
      const probeMessages = [
        {
          role: "system",
          content: "You are validating the CodeBuddy API key direct chat path. Reply only with the requested marker.",
        },
        { role: "user", content: prompt },
      ];
      const started = Date.now();
      try {
        const result = await runCodeBuddyCompletionFromPool(probeMessages, {
          accountId: body?.accountId || "",
          model: providerModel.model,
          stream: true,
        });
        const response = json(200, {
          ok: true,
          provider: "codebuddy",
          model: providerModel.publicModel,
          durationMs: Date.now() - started,
          text: result.turn.text,
          toolUses: result.turn.toolUses.map((tool) => ({
            id: tool.id,
            name: tool.name,
            inputKeys: tool.input && typeof tool.input === "object" ? Object.keys(tool.input) : [],
          })),
          account: result.account,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(502, "upstream_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/account" && req.method === "GET") {
      try {
        const response = json(200, await readAndSummarizeAuth());
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/accounts" && req.method === "GET") {
      try {
        const response = json(200, summarizeAccountsStore(readAccountsStore(), {
          legacyAccount: readLegacyDirectAccount() ? summarizeDirectAccount(readLegacyDirectAccount()) : null,
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/accounts/import" && req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const result = importDirectAccounts(readAccountsStore(), body);
        const store = writeAccountsStore(result.store);
        invalidateDirectMetadataCaches();
        const response = json(200, {
          ok: true,
          imported: result.summaries,
          accounts: summarizeAccountsStore(store),
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    const accountRoute = routePath.match(/^\/direct-admin\/api\/accounts\/([^/]+)(?:\/([^/]+))?$/);
    if (accountRoute) {
      const accountId = decodeURIComponent(accountRoute[1]);
      const action = accountRoute[2] || "";
      try {
        if (req.method === "DELETE" && !action) {
          const store = readAccountsStore();
          const nextStore = writeAccountsStore({
            ...store,
            accounts: store.accounts.filter((account) => account.id !== accountId),
            nextIndex: 0,
          });
          invalidateDirectMetadataCaches();
          const response = json(200, { ok: true, accounts: summarizeAccountsStore(nextStore) });
          res.writeHead(response.status, response.headers);
          res.end(response.body);
          return;
        }

        if (req.method === "POST" && (action === "enable" || action === "disable")) {
          const updated = updateStoredDirectAccount(accountId, (account) => ({
            ...account,
            enabled: action === "enable",
            updatedAt: Date.now(),
          }));
          if (!updated) throw new Error(`Cursor direct account not found: ${accountId}`);
          invalidateDirectMetadataCaches();
          const response = json(200, {
            ok: true,
            account: summarizeDirectAccount(updated),
            accounts: summarizeAccountsStore(readAccountsStore()),
          });
          res.writeHead(response.status, response.headers);
          res.end(response.body);
          return;
        }

        if (req.method === "POST" && action === "refresh-token") {
          const store = readAccountsStore();
          const account = store.accounts.find((item) => item.id === accountId);
          if (!account) throw new Error(`Cursor direct account not found: ${accountId}`);
          const refreshed = await refreshDirectAccount(account, { force: true });
          const updated = updateStoredDirectAccount(accountId, () => refreshed);
          invalidateDirectMetadataCaches();
          const response = json(200, {
            ok: true,
            refreshed: Boolean(refreshed.refreshed),
            account: summarizeDirectAccount(updated || refreshed),
            accounts: summarizeAccountsStore(readAccountsStore()),
          });
          res.writeHead(response.status, response.headers);
          res.end(response.body);
          return;
        }

        const response = openAiError(404, "not_found_error", `Unsupported account action: ${action || req.method}`);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/oauth/session" && req.method === "GET") {
      const response = json(200, getOAuthSessionPayload());
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (routePath === "/direct-admin/api/oauth/start" && req.method === "POST") {
      try {
        const result = await startDirectOAuthSession();
        const response = json(200, result);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(500, "internal_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/oauth/callback" && req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const result = await waitForDirectOAuthCompletion(body?.callbackUrl || body?.url || "");
        const response = json(result.ok === false ? 202 : 200, result);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/models" && req.method === "GET") {
      try {
        const models = await listDirectModels({ fresh: url.searchParams.get("fresh") === "1" });
        const response = json(200, { models });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(502, "upstream_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/auth" && req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const result = importDirectAccounts(readAccountsStore(), body);
        if (result.imported.length === 0) throw new Error("No accounts found in request body");
        const store = writeAccountsStore(result.store);
        invalidateDirectMetadataCaches();
        const response = json(200, {
          ok: true,
          account: result.summaries[0],
          accounts: summarizeAccountsStore(store),
          imported: result.summaries,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/refresh-token" && req.method === "POST") {
      try {
        const body = await readRequestBody(req).catch(() => ({}));
        const result = await selectAndRefreshDirectAccount({
          force: true,
          accountId: body?.accountId || body?.id || url.searchParams.get("accountId") || "",
        });
        invalidateDirectMetadataCaches();
        const response = json(200, {
          ok: true,
          refreshed: Boolean(result.account?.refreshed),
          account: summarizeDirectAccount(result.account),
          accounts: summarizeAccountsStore(readAccountsStore()),
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const response = openAiError(502, "upstream_error", error instanceof Error ? error.message : String(error));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/probe" && req.method === "POST") {
      let body = {};
      try {
        body = await readRequestBody(req);
      } catch {
        const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
        res.writeHead(response.status, response.headers);
        res.end(response.body);
        return;
      }

      const model = normalizeDirectModel(body?.model || "composer-2-fast");
      const prompt = "Reply with EXACTLY DIRECT_ADMIN_OK and no other text.";
      const started = Date.now();
      const finishRequest = beginTrackedRequest(model, prompt.length);
      try {
        const result = await runDirectCompletionFromPool(prompt, model, {
          accountId: body?.accountId || "",
          idleMs: Number(process.env.CURSOR_DIRECT_PROBE_IDLE_MS || "1200"),
        });
        const durationMs = Date.now() - started;
        finishRequest(true, { outputChars: result.text.length });
        const response = json(200, {
          ok: true,
          model: displayModelId(model),
          durationMs,
          text: result.text,
          account: result.account,
        });
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishRequest(false, { error: message });
        const response = openAiError(502, "upstream_error", message);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }

    if (routePath === "/direct-admin/api/logout" && req.method === "POST") {
      stopDirectOAuthSession("idle");
      clearAuthFile();
      clearAccountsStore();
      invalidateDirectMetadataCaches();
      const response = json(200, { ok: true, account: await readAndSummarizeAuth() });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    const response = openAiError(404, "not_found_error", `Unsupported direct admin path: ${routePath}`);
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

  if ((routePath === "/v1/models" || routePath === "/models") && req.method === "GET") {
    try {
      const created = Math.floor(Date.now() / 1000);
      let directModels = [];
      try {
        directModels = await listDirectModels();
      } catch (error) {
        log("warn", "direct model list unavailable while building proxy model list", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const codeBuddyModels = listConfiguredCodeBuddyModels();
      const response = json(200, {
        object: "list",
        data: [
          ...directModels.map((model) => ({
          id: model.id,
          object: "model",
          created,
          owned_by: "cursor-direct",
          })),
          ...codeBuddyModels.map((model) => ({
            id: model.id,
            object: "model",
            created,
            owned_by: model.owned_by || "codebuddy",
          })),
        ],
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch (error) {
      const response = openAiError(502, "upstream_error", error instanceof Error ? error.message : String(error));
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    }
    return;
  }

  if ((routePath === "/v1/messages/count_tokens" || routePath === "/messages/count_tokens") && req.method === "POST") {
    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    const prompt = buildPromptFromClaudeMessages(
      Array.isArray(body?.messages) ? body.messages : [],
      body?.system,
      { tools: body?.tools, toolChoice: body?.tool_choice },
    );
    const response = json(200, createClaudeTokenCount(prompt));
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if ((routePath === "/v1/messages" || routePath === "/messages") && req.method === "GET") {
    const response = json(200, {
      ok: true,
      type: "messages_endpoint",
      message: "Use POST /v1/messages for Claude-compatible requests",
    });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  if ((routePath === "/v1/messages" || routePath === "/messages") && req.method === "POST") {
    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const rawRequestedModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "claude-sonnet-4-5";
    const providerModel = resolveGatewayProviderModel(rawRequestedModel);
    if (providerModel.provider === "codebuddy") {
      log("info", "rejected codebuddy claude messages request", {
        model: providerModel.model,
        requestedModel: providerModel.publicModel,
        stream: body?.stream === true,
        messages: messages.length,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
      });
      const response = openAiError(400,
        "invalid_request_error",
        "CodeBuddy models are only available through /v1/chat/completions so gateway prompt shims never touch CodeBuddy requests.",
      );
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }
    const requestedModel = normalizePublicModelName(rawRequestedModel);
    const model = normalizeDirectModel(requestedModel);
    const claudeToolOptions = { tools: body?.tools, toolChoice: body?.tool_choice };
    const prompt = buildPromptFromClaudeMessages(messages, body?.system, claudeToolOptions);
    const shouldBufferToolResponse = shouldAttemptClaudeToolUse(claudeToolOptions);
    const streamRequested = body?.stream === true;
    const finishRequest = beginTrackedRequest(model, prompt.length, { stream: streamRequested });
    log("info", "claude messages request", {
      model: displayModelId(model),
      requestedModel,
      stream: streamRequested,
      messages: messages.length,
      promptChars: prompt.length,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
    });

    if (streamRequested) {
      const id = `msg_cursor_direct_${Date.now()}`;
      const controller = new AbortController();
      let responseStarted = false;
      let responseDone = false;
      let textBlockStarted = false;
      let streamedChars = 0;
      const keepAliveMs = Math.max(0, Number(config.streamKeepAliveMs || 0));

      const writeClaudeEvent = (event, payload) => {
        res.write(createClaudeStreamEvent(event, payload));
      };

      const startMessage = () => {
        if (responseStarted || res.destroyed) return;
        responseStarted = true;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "access-control-allow-origin": "*",
        });
        writeClaudeEvent("message_start", createClaudeMessageStartPayload(id, requestedModel, prompt));
        flushResponse(res);
      };

      const startTextBlock = () => {
        startMessage();
        if (textBlockStarted || res.destroyed) return;
        textBlockStarted = true;
        writeClaudeEvent("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });
        flushResponse(res);
      };

      const finishTextResponse = (result) => {
        startTextBlock();
        if (streamedChars === 0 && result.text) {
          streamedChars += result.text.length;
          writeClaudeEvent("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: result.text },
          });
        }
        writeClaudeEvent("content_block_stop", {
          type: "content_block_stop",
          index: 0,
        });
        writeClaudeEvent("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: estimateClaudeUsage(prompt, result.text).output_tokens },
        });
        writeClaudeEvent("message_stop", { type: "message_stop" });
      };

      const finishToolUseResponse = (toolUse, result) => {
        startMessage();
        writeClaudeEvent("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: toolUse.id,
            name: toolUse.name,
            input: {},
          },
        });
        writeClaudeEvent("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(toolUse.input || {}),
          },
        });
        writeClaudeEvent("content_block_stop", {
          type: "content_block_stop",
          index: 0,
        });
        writeClaudeEvent("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: estimateClaudeUsage(prompt, result.text).output_tokens },
        });
        writeClaudeEvent("message_stop", { type: "message_stop" });
      };

      const keepAliveTimer = keepAliveMs > 0
        ? setInterval(() => {
          if (!responseDone && responseStarted && !res.destroyed) {
            writeClaudeEvent("ping", { type: "ping" });
            flushResponse(res);
          }
        }, keepAliveMs)
        : null;

      const cancelOnClose = () => {
        if (!responseDone) controller.abort();
      };
      res.on("close", cancelOnClose);

      try {
        if (shouldBufferToolResponse) startMessage();
        else startTextBlock();
        const result = await runDirectCompletionFromPool(prompt, model, {
          signal: controller.signal,
          tools: body?.tools,
          toolChoice: body?.tool_choice,
          captureNativeToolUse: shouldBufferToolResponse,
          onDelta: (delta) => {
            if (!delta || res.destroyed) return;
            if (shouldBufferToolResponse) return;
            startTextBlock();
            streamedChars += delta.length;
            writeClaudeEvent("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: delta },
            });
            flushResponse(res);
          },
        });
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        const toolUse = shouldBufferToolResponse
          ? (result.toolUse || parseClaudeToolUse(result.text, claudeToolOptions))
          : null;
        finishRequest(true, {
          outputChars: result.text.length,
          upstreamBytes: result.bytes,
          stringCount: result.stringCount,
          deltaCount: result.deltaCount,
        });
        log("info", "claude messages response", {
          model: displayModelId(model),
          requestedModel,
          stream: true,
          outputChars: result.text.length,
          upstreamBytes: result.bytes,
          stringCount: result.stringCount,
          deltaCount: result.deltaCount,
          durationMs: result.durationMs,
          accountId: result.accountId || "",
        });

        if (toolUse) finishToolUseResponse(toolUse, result);
        else finishTextResponse(result);
        responseDone = true;
        res.end();
      } catch (error) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        const message = error instanceof Error ? error.message : String(error);
        finishRequest(false, { error: message });
        if (res.destroyed) return;
        startMessage();
        writeClaudeEvent("error", {
          type: "error",
          error: { type: "api_error", message },
        });
        responseDone = true;
        res.end();
      } finally {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        res.off("close", cancelOnClose);
      }
      return;
    }

    try {
      const result = await runDirectCompletionFromPool(prompt, model, {
        tools: body?.tools,
        toolChoice: body?.tool_choice,
        captureNativeToolUse: shouldBufferToolResponse,
      });
      finishRequest(true, {
        outputChars: result.text.length,
        upstreamBytes: result.bytes,
        stringCount: result.stringCount,
        deltaCount: result.deltaCount,
      });
      log("info", "claude messages response", {
        model: displayModelId(model),
        requestedModel,
        stream: false,
        outputChars: result.text.length,
        upstreamBytes: result.bytes,
        stringCount: result.stringCount,
        deltaCount: result.deltaCount,
        durationMs: result.durationMs,
        accountId: result.accountId || "",
      });

      const response = json(200, createClaudeMessagesResponse(model, result.text, prompt, {
        publicModel: requestedModel,
        nativeToolUse: result.toolUse,
        tools: body?.tools,
        toolChoice: body?.tool_choice,
      }));
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishRequest(false, { error: message });
      const response = openAiError(502, "upstream_error", message);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    }
    return;
  }

  if ((routePath === "/v1/chat/completions" || routePath === "/chat/completions") && req.method === "POST") {
    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      const response = openAiError(400, "invalid_request_error", "Invalid JSON body");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const providerModel = resolveGatewayProviderModel(body?.model);
    if (providerModel.provider === "codebuddy") {
      const prompt = buildPromptFromMessages(messages);
      const streamRequested = body?.stream === true;
      const finishRequest = beginTrackedRequest(providerModel.publicModel, prompt.length, { stream: streamRequested });
      log("info", "codebuddy chat completion request", {
        model: providerModel.model,
        stream: streamRequested,
        messages: messages.length,
        promptChars: prompt.length,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
      });

      if (streamRequested) {
        const id = `chatcmpl_codebuddy_${Date.now()}`;
        const controller = new AbortController();
        let responseStarted = false;
        let responseDone = false;
        let streamedChars = 0;

        const startStream = () => {
          if (responseStarted || res.destroyed) return;
          responseStarted = true;
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
            "access-control-allow-origin": "*",
          });
          res.write(sse(createOpenAIChatCompletionStreamChunk(id, providerModel.publicModel, { role: "assistant" })));
          flushResponse(res);
        };
        const writeToolCallChunks = (toolUses) => {
          toolUses.forEach((tool, index) => {
            res.write(sse(createOpenAIChatCompletionStreamChunk(id, providerModel.publicModel, {
              tool_calls: [{
                index,
                id: tool.id || `call_${randomUUID().replace(/-/g, "")}`,
                type: "function",
                function: {
                  name: tool.name || "tool",
                  arguments: JSON.stringify(tool.input || {}),
                },
              }],
            })));
          });
        };
        const keepAliveMs = Math.max(0, Number(config.streamKeepAliveMs || 0));
        const keepAliveTimer = keepAliveMs > 0
          ? setInterval(() => {
            if (responseDone || res.destroyed) return;
            startStream();
            res.write(": keep-alive\n\n");
            flushResponse(res);
          }, keepAliveMs)
          : null;
        const cancelOnClose = () => {
          if (!responseDone) controller.abort();
        };
        res.on("close", cancelOnClose);

        try {
          const result = await runCodeBuddyCompletionFromPool(messages, {
            signal: controller.signal,
            model: providerModel.model,
            tools: body?.tools,
            toolChoice: body?.tool_choice,
            onDelta: (delta) => {
              if (!delta || res.destroyed) return;
              startStream();
              streamedChars += delta.length;
              res.write(sse(createOpenAIChatCompletionStreamChunk(id, providerModel.publicModel, { content: delta })));
              flushResponse(res);
            },
          });
          if (keepAliveTimer) clearInterval(keepAliveTimer);
          finishRequest(true, {
            outputChars: result.turn.text.length,
            upstreamBytes: result.bytes,
            stringCount: result.eventCount,
            deltaCount: result.deltaCount,
          });
          if (res.destroyed) return;
          startStream();
          if (streamedChars === 0 && result.turn.text) {
            streamedChars += result.turn.text.length;
            res.write(sse(createOpenAIChatCompletionStreamChunk(id, providerModel.publicModel, { content: result.turn.text })));
          }
          const toolUses = Array.isArray(result.turn.toolUses) ? result.turn.toolUses : [];
          if (toolUses.length > 0) writeToolCallChunks(toolUses);
          res.write(sse(createOpenAIChatCompletionStreamChunk(
            id,
            providerModel.publicModel,
            {},
            toolUses.length > 0 ? "tool_calls" : "stop",
          )));
          res.write("data: [DONE]\n\n");
          responseDone = true;
          res.end();
        } catch (error) {
          if (keepAliveTimer) clearInterval(keepAliveTimer);
          const message = error instanceof Error ? error.message : String(error);
          finishRequest(false, { error: message });
          if (res.destroyed) return;
          if (responseStarted) {
            res.write(sse({ error: { message, type: "upstream_error" } }));
            res.write("data: [DONE]\n\n");
            responseDone = true;
            res.end();
          } else {
            const response = openAiError(502, "upstream_error", message);
            responseDone = true;
            res.writeHead(response.status, response.headers);
            res.end(response.body);
          }
        } finally {
          if (keepAliveTimer) clearInterval(keepAliveTimer);
          res.off("close", cancelOnClose);
        }
        return;
      }

      try {
        const result = await runCodeBuddyCompletionFromPool(messages, {
          model: providerModel.model,
          tools: body?.tools,
          toolChoice: body?.tool_choice,
        });
        finishRequest(true, {
          outputChars: result.turn.text.length,
          upstreamBytes: result.bytes,
          stringCount: result.eventCount,
          deltaCount: result.deltaCount,
        });
        const response = json(200, createOpenAIChatCompletionFromProviderTurn(result.turn, {
          id: `chatcmpl_codebuddy_${Date.now()}`,
          model: providerModel.publicModel,
          prompt,
        }));
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finishRequest(false, { error: message });
        const response = openAiError(502, "upstream_error", message);
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      }
      return;
    }
    const model = normalizeDirectModel(body?.model);
    const prompt = buildPromptFromMessages(messages);
    const streamRequested = body?.stream === true;
    const finishRequest = beginTrackedRequest(model, prompt.length, { stream: streamRequested });
    log("info", "chat completion request", {
      model: displayModelId(model),
      stream: streamRequested,
      messages: messages.length,
      promptChars: prompt.length,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
    });

    if (streamRequested) {
      const id = `cursor-direct-${Date.now()}`;
      const controller = new AbortController();
      let responseStarted = false;
      let responseDone = false;
      let streamedChars = 0;

      const startStream = () => {
        if (responseStarted || res.destroyed) return;
        responseStarted = true;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        res.write(sse(createChunk(id, model, { role: "assistant" })));
        flushResponse(res);
      };

      const keepAliveMs = Math.max(0, config.streamKeepAliveMs);
      const keepAliveTimer = keepAliveMs > 0
        ? setInterval(() => {
          if (responseDone || res.destroyed) return;
          startStream();
          res.write(": keep-alive\n\n");
          flushResponse(res);
        }, keepAliveMs)
        : null;

      const cancelOnClose = () => {
        if (!responseDone) controller.abort();
      };
      res.on("close", cancelOnClose);

      try {
        const result = await runDirectCompletionFromPool(prompt, model, {
          signal: controller.signal,
          onDelta: (delta) => {
            if (!delta || res.destroyed) return;
            startStream();
            streamedChars += delta.length;
            res.write(sse(createChunk(id, model, { content: delta })));
            flushResponse(res);
          },
        });
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        finishRequest(true, {
          outputChars: result.text.length,
          upstreamBytes: result.bytes,
          stringCount: result.stringCount,
          deltaCount: result.deltaCount,
        });
        log("info", "chat completion response", {
          model: displayModelId(model),
          stream: true,
          outputChars: result.text.length,
          upstreamBytes: result.bytes,
          stringCount: result.stringCount,
          deltaCount: result.deltaCount,
          streamedChars,
          durationMs: result.durationMs,
          accountId: result.accountId || "",
        });
        if (res.destroyed) return;
        startStream();
        if (streamedChars === 0 && result.text) {
          streamedChars += result.text.length;
          res.write(sse(createChunk(id, model, { content: result.text })));
        }
        res.write(sse(createChunk(id, model, {}, true)));
        res.write("data: [DONE]\n\n");
        responseDone = true;
        res.end();
      } catch (error) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        const message = error instanceof Error ? error.message : String(error);
        finishRequest(false, { error: message });
        if (res.destroyed) return;
        if (responseStarted) {
          res.write(sse({ error: { message, type: "upstream_error" } }));
          res.write("data: [DONE]\n\n");
          responseDone = true;
          res.end();
        } else {
          const response = openAiError(502, "upstream_error", message);
          responseDone = true;
          res.writeHead(response.status, response.headers);
          res.end(response.body);
        }
      } finally {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        res.off("close", cancelOnClose);
      }
      return;
    }

    try {
      const result = await runDirectCompletionFromPool(prompt, model);
      finishRequest(true, {
        outputChars: result.text.length,
        upstreamBytes: result.bytes,
        stringCount: result.stringCount,
        deltaCount: result.deltaCount,
      });
      log("info", "chat completion response", {
        model: displayModelId(model),
        stream: false,
        outputChars: result.text.length,
        upstreamBytes: result.bytes,
        stringCount: result.stringCount,
        deltaCount: result.deltaCount,
        durationMs: result.durationMs,
        accountId: result.accountId || "",
      });

      const response = json(200, createChatCompletion(model, result.text, prompt));
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishRequest(false, { error: message });
      const response = openAiError(502, "upstream_error", message);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    }
    return;
  }

  const response = openAiError(404, "not_found_error", `Unsupported path: ${routePath}`);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export {
  applyDirectCompletionEvents,
  buildDirectAdminHtml,
  buildDirectAdminClientConfig,
  buildDirectAdminStatusPayload,
  buildClaudeToolsPrompt,
  buildPromptFromClaudeMessages,
  buildPromptFromMessages,
  createLegacyDirectAccount,
  createAssistantTextAccumulator,
  createClaudeMessageStartPayload,
  createClaudeMessagesResponse,
  createClaudeMessage,
  createClaudeStreamEvent,
  createClaudeTokenCount,
  createClaudeToolUseMessage,
  createConnectFrameParser,
  createCursorClientResponsesForEvents,
  createDirectMetadataCaches,
  extractStringsFromProtobuf,
  findCursorNativeToolUse,
  generateChecksum,
  getMetadataCache,
  getPublicBaseUrl,
  importDirectAccounts,
  invalidateDirectMetadataCaches,
  isDirectAdminAuthorized,
  listDirectModels,
  normalizeApiPath,
  normalizeCodeBuddyCredentialImportRequest,
  normalizeDirectModel,
  normalizePublicModelName,
  normalizeCodeBuddyLoginStatus,
  parseClaudeToolUse,
  parseCodeBuddyOAuthCallbackUrl,
  pickAssistantCandidate,
  pickAssistantText,
  resolveGatewayProviderModel,
  runDirectCompletionWithRetry,
  selectDirectAccount,
  setMetadataCache,
  summarizeCursorAuth,
  summarizeDirectAccount,
  runDirectCompletion,
  writeCursorClientResponses,
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
  server.on("upgrade", (req, socket, head) => {
    try {
      handleCodeBuddyRemoteUpgrade(req, socket, head);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "Unhandled upgrade error", { message });
      if (!socket.destroyed) socket.destroy();
    }
  });

  server.listen(config.port, config.host, () => {
    log("info", `listening on http://${config.host}:${config.port}/v1`, {
      auth: config.requireApiKey ? "required" : "disabled",
      authPath: config.authPath,
    });
  });

  const shutdown = () => {
    log("info", "shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
