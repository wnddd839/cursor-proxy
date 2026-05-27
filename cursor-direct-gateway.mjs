#!/usr/bin/env node
import { createServer } from "node:http";
import http2 from "node:http2";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { buildDirectAdminHtml } from "./direct-admin-page.mjs";

const DEFAULT_AUTH_PATH = path.join(homedir(), ".config", "cursor", "auth.json");
const DEFAULT_DIRECT_PARSE_LIMITS = {
  maxDepth: 8,
  maxFields: 6000,
  maxStrings: 3000,
  maxStringBytes: 32000,
  maxNestedBytes: 256000,
  maxFrameBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
};

const config = {
  host: process.env.CURSOR_DIRECT_HOST || "127.0.0.1",
  port: Number(process.env.CURSOR_DIRECT_PORT || "32126"),
  apiKey: process.env.CURSOR_DIRECT_API_KEY || process.env.CURSOR_GATEWAY_API_KEY || "",
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
const CURSOR_IU_TEXT_DELTA = 1;
const CURSOR_IU_THINKING_DELTA = 4;
const CURSOR_IU_THINKING_COMPLETED = 5;
const CURSOR_IU_TOKEN_DELTA = 8;
const CURSOR_IU_HEARTBEAT = 13;
const CURSOR_IU_TURN_ENDED = 14;
const CURSOR_TEXT_DELTA_TEXT = 1;
const CURSOR_THINKING_DELTA_TEXT = 1;
const CURSOR_TOKEN_DELTA_VALUE = 1;
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
}

function log(level, message, meta = undefined) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] ?? 20) < (order[config.logLevel] ?? 20)) return;
  const line = `[cursor-direct] ${level.toUpperCase()} ${message}`;
  if (meta) console.error(line, JSON.stringify(meta));
  else console.error(line);
}

function normalizeDirectModel(model) {
  const raw = typeof model === "string" && model.trim() ? model.trim() : "auto";
  const cleaned = raw
    .replace(/^cursor-acp\//, "")
    .replace(/^cursor\//, "")
    .replace(/^cursor-/, "");
  return cleaned === "auto" ? "default" : cleaned;
}

function displayModelId(model) {
  return model === "default" ? "auto" : model;
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
      events.push({ type: "kv_server_message", bytes: Buffer.from(data) });
    } else if (fieldNum === CURSOR_ASM_EXEC_SERVER_MESSAGE) {
      events.push({ type: "exec_server_message", bytes: Buffer.from(data) });
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
          } else if (event.type === "turn_ended") {
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
      try {
        handleCompletionEvents(parser.push(chunk));
      } catch (error) {
        settle(reject, makeError(error instanceof Error ? error.message : String(error)));
        return;
      }
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
    request.end(payload);
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
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
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
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
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

function buildDirectAdminStatusPayload() {
  const status = getStatusPayload();
  return {
    ...status,
    adminPath: "/direct-admin/",
    apiBasePath: "/v1",
    adminPasswordSet: Boolean(config.adminPassword),
    apiKeyConfigured: Boolean(config.apiKey),
    apiBaseUrl: config.apiBaseUrl,
    memory: getMemorySnapshot(),
    config: {
      host: config.host,
      port: config.port,
      authPath: config.authPath,
      accountsPath: config.accountsPath,
      agentHost: config.agentHost,
      clientVersion: config.clientVersion,
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


async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    const response = json(200, getStatusPayload());
    res.writeHead(response.status, response.headers);
    res.end(req.method === "HEAD" ? undefined : response.body);
    return;
  }

  if ((url.pathname === "/direct-admin-preview" || url.pathname === "/direct-admin-preview/") && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(301, {
      location: "/direct-admin/",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end();
    return;
  }

  if ((url.pathname === "/direct-admin" || url.pathname === "/direct-admin/") && (req.method === "GET" || req.method === "HEAD")) {
    const response = html(200, buildDirectAdminHtml());
    res.writeHead(response.status, response.headers);
    res.end(req.method === "HEAD" ? undefined : response.body);
    return;
  }

  if (url.pathname.startsWith("/direct-admin/api/")) {
    if (!isAdminAuthorized(req)) {
      const response = openAiError(401, "authentication_error", "Invalid or missing admin password");
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/direct-admin/api/status" && req.method === "GET") {
      const response = json(200, buildDirectAdminStatusPayload());
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/direct-admin/api/account" && req.method === "GET") {
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

    if (url.pathname === "/direct-admin/api/accounts" && req.method === "GET") {
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

    if (url.pathname === "/direct-admin/api/accounts/import" && req.method === "POST") {
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

    const accountRoute = url.pathname.match(/^\/direct-admin\/api\/accounts\/([^/]+)(?:\/([^/]+))?$/);
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

    if (url.pathname === "/direct-admin/api/oauth/session" && req.method === "GET") {
      const response = json(200, getOAuthSessionPayload());
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    if (url.pathname === "/direct-admin/api/oauth/start" && req.method === "POST") {
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

    if (url.pathname === "/direct-admin/api/oauth/callback" && req.method === "POST") {
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

    if (url.pathname === "/direct-admin/api/models" && req.method === "GET") {
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

    if (url.pathname === "/direct-admin/api/auth" && req.method === "POST") {
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

    if (url.pathname === "/direct-admin/api/refresh-token" && req.method === "POST") {
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

    if (url.pathname === "/direct-admin/api/probe" && req.method === "POST") {
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

    if (url.pathname === "/direct-admin/api/logout" && req.method === "POST") {
      stopDirectOAuthSession("idle");
      clearAuthFile();
      clearAccountsStore();
      invalidateDirectMetadataCaches();
      const response = json(200, { ok: true, account: await readAndSummarizeAuth() });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    const response = openAiError(404, "not_found_error", `Unsupported direct admin path: ${url.pathname}`);
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
    try {
      const created = Math.floor(Date.now() / 1000);
      const models = await listDirectModels();
      const response = json(200, {
        object: "list",
        data: models.map((model) => ({
          id: model.id,
          object: "model",
          created,
          owned_by: "cursor-direct",
        })),
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

    const messages = Array.isArray(body?.messages) ? body.messages : [];
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

  const response = openAiError(404, "not_found_error", `Unsupported path: ${url.pathname}`);
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export {
  applyDirectCompletionEvents,
  buildDirectAdminHtml,
  buildDirectAdminStatusPayload,
  buildPromptFromMessages,
  createLegacyDirectAccount,
  createAssistantTextAccumulator,
  createConnectFrameParser,
  createDirectMetadataCaches,
  extractStringsFromProtobuf,
  generateChecksum,
  getMetadataCache,
  importDirectAccounts,
  invalidateDirectMetadataCaches,
  isDirectAdminAuthorized,
  listDirectModels,
  normalizeDirectModel,
  pickAssistantCandidate,
  pickAssistantText,
  runDirectCompletionWithRetry,
  selectDirectAccount,
  setMetadataCache,
  summarizeCursorAuth,
  summarizeDirectAccount,
  runDirectCompletion,
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
