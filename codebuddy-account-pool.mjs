import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { createCodeBuddyHeaders, normalizeBaseUrl } from "./codebuddy-provider.mjs";

const DEFAULT_CODEBUDDY_ACCOUNTS_PATH = path.join(homedir(), ".codebuddy", "proxy-accounts.json");
const DEFAULT_HELPER_TIMEOUT_MS = 10000;
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024;

function maskSecret(value, visible = 5) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= visible * 2) return `${text.slice(0, Math.max(1, visible))}...`;
  return `${text.slice(0, visible)}...${text.slice(-visible)}`;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function compactString(value) {
  return String(value || "").trim();
}

function normalizeAuthStatus(value) {
  const source = value && typeof value === "object" ? value : {};
  const loggedIn = typeof source.loggedIn === "boolean"
    ? source.loggedIn
    : typeof source.authenticated === "boolean"
      ? source.authenticated
      : null;
  return {
    loggedIn,
    userId: compactString(source.userId || source.user_id || source.id || ""),
    userName: compactString(source.userName || source.username || source.email || source.name || ""),
    userNickname: compactString(source.userNickname || source.nickname || source.displayName || ""),
    authMode: compactString(source.authMode || source.auth_mode || source.mode || ""),
    raw: source.raw && typeof source.raw === "object" ? cloneJson(source.raw) : undefined,
  };
}

function normalizeCodeBuddyAccountAuth(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    authToken: compactString(source.authToken || source.auth_token || source.token || source.accessToken || ""),
    apiKey: compactString(source.apiKey || source.api_key || source.key || ""),
    apiKeyHelper: compactString(source.apiKeyHelper || source.api_key_helper || source.helper || ""),
  };
}

function getCredentialHash(auth) {
  return hashSecret(auth.authToken || auth.apiKey || auth.apiKeyHelper || "");
}

function isDaemonAuthType(value) {
  return ["daemon", "daemon_oauth", "oauth", "codebuddy_daemon"].includes(compactString(value).toLowerCase());
}

function getAuthType(auth) {
  if (auth.authToken) return "auth_token";
  if (auth.apiKeyHelper) return "api_key_helper";
  if (auth.apiKey) return "api_key";
  return "";
}

function hasCodeBuddyCredentials(account) {
  return Boolean(
    account?.authToken ||
    account?.apiKeyHelper ||
    account?.apiKey ||
    isDaemonAuthType(account?.authType) ||
    account?.useDaemonAuth === true,
  );
}

function getCodeBuddyAccountsPath(options = {}) {
  return options.accountsPath || process.env.CODEBUDDY_PROXY_ACCOUNTS_PATH || DEFAULT_CODEBUDDY_ACCOUNTS_PATH;
}

function createEmptyCodeBuddyAccountsStore() {
  return { version: 1, provider: "codebuddy", nextIndex: 0, accounts: [] };
}

function normalizeStoredCodeBuddyAccount(raw) {
  if (!raw || typeof raw !== "object") return null;
  return createCodeBuddyAccount(raw, {
    id: raw.id,
    now: raw.updatedAt || raw.createdAt || Date.now(),
    preserveTimestamps: true,
  });
}

function parseCodeBuddyAccountsImportInput(input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return [];
    return parseCodeBuddyAccountsImportInput(JSON.parse(text));
  }
  if (Array.isArray(input)) return input.flatMap(parseCodeBuddyAccountsImportInput);
  if (!input || typeof input !== "object") return [];
  if (typeof input.authJson === "string") {
    return parseCodeBuddyAccountsImportInput(input.authJson).map((account) => ({
      ...account,
      label: input.label || account.label,
      enabled: typeof input.enabled === "boolean" ? input.enabled : account.enabled,
    }));
  }
  if (Array.isArray(input.accounts)) return input.accounts.flatMap(parseCodeBuddyAccountsImportInput);
  return [input];
}

export function createCodeBuddyAccount(raw = {}, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const now = Number(options.now || Date.now());
  const auth = normalizeCodeBuddyAccountAuth(source);
  const authStatus = normalizeAuthStatus(source.authStatus || source.status || {});
  const daemonAuth = source.useDaemonAuth === true ||
    isDaemonAuthType(source.authType || source.auth_type || source.authMode || authStatus.authMode);
  const baseUrl = normalizeBaseUrl(source.baseUrl || source.url || "");
  const credentialHash = source.credentialHash || (daemonAuth
    ? hashSecret(`daemon|${baseUrl}|${source.internetEnvironment || source.internet_environment || ""}`)
    : getCredentialHash(auth));
  const identity = authStatus.userId || authStatus.userName || source.subject || source.email || source.label || "";
  const id = compactString(
    options.id ||
    source.id ||
    hashSecret(`${identity}|${credentialHash}|${baseUrl}|${source.internetEnvironment || ""}`),
  );
  const createdAt = Number(source.createdAt || (options.preserveTimestamps ? now : 0) || now);
  const updatedAt = Number(source.updatedAt || now);

  return {
    id,
    provider: "codebuddy",
    label: compactString(source.label || authStatus.userName || authStatus.userId || `CodeBuddy ${id.slice(0, 6)}`),
    enabled: source.enabled !== false && options.enabled !== false,
    source: compactString(options.source || source.source || "pool"),
    baseUrl,
    internetEnvironment: compactString(source.internetEnvironment || source.internet_environment || ""),
    authType: daemonAuth ? "daemon" : getAuthType(auth),
    useDaemonAuth: daemonAuth,
    authToken: auth.authToken,
    apiKey: auth.apiKey,
    apiKeyHelper: auth.apiKeyHelper,
    credentialHash,
    authStatus,
    createdAt,
    updatedAt,
    lastUsedAt: Number(source.lastUsedAt || 0),
    lastSelectedAt: Number(source.lastSelectedAt || 0),
    successRequests: Number(source.successRequests || 0),
    failedRequests: Number(source.failedRequests || 0),
    lastError: compactString(source.lastError || ""),
  };
}

export function normalizeCodeBuddyAccountsStore(store) {
  const input = store && typeof store === "object" ? store : createEmptyCodeBuddyAccountsStore();
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .map(normalizeStoredCodeBuddyAccount)
    .filter(Boolean);
  const rawNext = Number.isInteger(input.nextIndex) ? input.nextIndex : 0;
  const nextIndex = accounts.length > 0 ? ((rawNext % accounts.length) + accounts.length) % accounts.length : 0;
  return { version: 1, provider: "codebuddy", nextIndex, accounts };
}

export function summarizeCodeBuddyAccount(account) {
  const authStatus = normalizeAuthStatus(account?.authStatus || {});
  const loggedIn = typeof authStatus.loggedIn === "boolean"
    ? authStatus.loggedIn
    : hasCodeBuddyCredentials(account);
  const authType = account?.authType || getAuthType(normalizeCodeBuddyAccountAuth(account));
  return {
    id: account?.id || "",
    provider: "codebuddy",
    label: account?.label || "",
    enabled: account?.enabled !== false,
    source: account?.source || "pool",
    baseUrl: account?.baseUrl || "",
    internetEnvironment: account?.internetEnvironment || "",
    authType,
    hasCredentials: hasCodeBuddyCredentials(account),
    loggedIn,
    userId: authStatus.userId,
    userName: authStatus.userName,
    userNickname: authStatus.userNickname,
    authMode: authStatus.authMode,
    authTokenPreview: maskSecret(account?.authToken, 6),
    apiKeyPreview: maskSecret(account?.apiKey, 6),
    apiKeyHelperPreview: maskSecret(account?.apiKeyHelper, 6),
    createdAt: Number(account?.createdAt || 0),
    updatedAt: Number(account?.updatedAt || 0),
    lastUsedAt: Number(account?.lastUsedAt || 0),
    lastSelectedAt: Number(account?.lastSelectedAt || 0),
    successRequests: Number(account?.successRequests || 0),
    failedRequests: Number(account?.failedRequests || 0),
    lastError: compactString(account?.lastError || ""),
  };
}

export function summarizeCodeBuddyAccountsStore(store, options = {}) {
  const normalized = normalizeCodeBuddyAccountsStore(store);
  const accounts = normalized.accounts.map(summarizeCodeBuddyAccount);
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const primary = enabledAccounts.find((account) => account.hasCredentials) || enabledAccounts[0] || accounts[0] || null;
  return {
    ok: true,
    provider: "codebuddy",
    version: normalized.version,
    nextIndex: normalized.nextIndex,
    accountsPath: getCodeBuddyAccountsPath(options),
    count: accounts.length,
    enabledCount: enabledAccounts.length,
    disabledCount: accounts.length - enabledAccounts.length,
    loggedIn: Boolean(primary?.loggedIn),
    primary,
    accounts,
  };
}

export function importCodeBuddyAccounts(store, input, options = {}) {
  const now = Number(options.now || Date.now());
  const nextStore = normalizeCodeBuddyAccountsStore(store);
  const imported = [];

  for (const raw of parseCodeBuddyAccountsImportInput(input)) {
    const account = createCodeBuddyAccount(raw, { now });
    const existingIndex = nextStore.accounts.findIndex((item) => (
      item.id === account.id ||
      (account.credentialHash && item.credentialHash === account.credentialHash) ||
      (account.authStatus.userId && item.authStatus?.userId === account.authStatus.userId)
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
    store: normalizeCodeBuddyAccountsStore(nextStore),
    imported,
    summaries: imported.map(summarizeCodeBuddyAccount),
  };
}

export function selectCodeBuddyAccount(store, options = {}) {
  const normalized = normalizeCodeBuddyAccountsStore(store);
  const now = Number(options.now || Date.now());
  const accountId = compactString(options.accountId || "");

  if (accountId) {
    const selectedIndex = normalized.accounts.findIndex((account) => account.id === accountId);
    if (selectedIndex < 0) throw new Error(`CodeBuddy account not found: ${accountId}`);
    const selected = normalized.accounts[selectedIndex];
    if (selected.enabled === false) throw new Error(`CodeBuddy account is disabled: ${accountId}`);
    if (!hasCodeBuddyCredentials(selected)) throw new Error(`CodeBuddy account has no credentials: ${accountId}`);
    const accounts = normalized.accounts.slice();
    accounts[selectedIndex] = { ...selected, lastSelectedAt: now };
    return {
      source: "pool",
      account: accounts[selectedIndex],
      index: selectedIndex,
      store: { ...normalized, accounts },
    };
  }

  for (let offset = 0; offset < normalized.accounts.length; offset += 1) {
    const selectedIndex = (normalized.nextIndex + offset) % normalized.accounts.length;
    const selected = normalized.accounts[selectedIndex];
    if (!selected || selected.enabled === false || !hasCodeBuddyCredentials(selected)) continue;
    const accounts = normalized.accounts.slice();
    accounts[selectedIndex] = { ...selected, lastSelectedAt: now };
    return {
      source: "pool",
      account: accounts[selectedIndex],
      index: selectedIndex,
      store: {
        ...normalized,
        nextIndex: (selectedIndex + 1) % normalized.accounts.length,
        accounts,
      },
    };
  }

  throw new Error("No enabled CodeBuddy accounts with credentials available");
}

export function readCodeBuddyAccountsStore(options = {}) {
  const accountsPath = getCodeBuddyAccountsPath(options);
  if (!existsSync(accountsPath)) return createEmptyCodeBuddyAccountsStore();
  return normalizeCodeBuddyAccountsStore(JSON.parse(readFileSync(accountsPath, "utf8")));
}

export function writeCodeBuddyAccountsStore(store, options = {}) {
  const accountsPath = getCodeBuddyAccountsPath(options);
  const normalized = normalizeCodeBuddyAccountsStore(store);
  mkdirSync(path.dirname(accountsPath), { recursive: true });
  writeFileSync(accountsPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

export function markCodeBuddyAccountResult(selection, ok, options = {}) {
  if (!selection || selection.source !== "pool" || !selection.account?.id) return;
  const accountsPath = getCodeBuddyAccountsPath(options);
  const store = readCodeBuddyAccountsStore({ accountsPath });
  const accounts = store.accounts.map((account) => {
    if (account.id !== selection.account.id) return account;
    return {
      ...account,
      lastUsedAt: Date.now(),
      successRequests: Number(account.successRequests || 0) + (ok ? 1 : 0),
      failedRequests: Number(account.failedRequests || 0) + (ok ? 0 : 1),
      lastError: ok ? "" : compactString(options.error || "unknown error").slice(0, 600),
    };
  });
  writeCodeBuddyAccountsStore({ ...store, accounts }, { accountsPath });
}

function runApiKeyHelper(command, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_HELPER_TIMEOUT_MS));
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      reject(new Error("CodeBuddy apiKeyHelper timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_HELPER_OUTPUT_BYTES) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        reject(new Error("CodeBuddy apiKeyHelper output exceeded limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CodeBuddy apiKeyHelper exited with code ${String(code)}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function firstNonEmptyLine(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

export async function resolveCodeBuddyAccountHeaders(account, options = {}) {
  const normalized = createCodeBuddyAccount(account || {});
  const baseHeaders = createCodeBuddyHeaders({
    exemptRequestHeader: options.exemptRequestHeader,
  });

  if (normalized.authToken) {
    return {
      ...baseHeaders,
      authorization: `Bearer ${normalized.authToken}`,
    };
  }

  if (normalized.apiKeyHelper) {
    const helperRunner = options.helperRunner || runApiKeyHelper;
    const value = firstNonEmptyLine(await helperRunner(normalized.apiKeyHelper, {
      account: normalized,
      timeoutMs: options.helperTimeoutMs,
      env: options.env,
    }));
    if (!value) throw new Error("CodeBuddy apiKeyHelper returned empty credentials");
    return {
      ...baseHeaders,
      "x-api-key": value,
      authorization: `Bearer ${value}`,
    };
  }

  if (normalized.apiKey) {
    return {
      ...baseHeaders,
      "x-api-key": normalized.apiKey,
      authorization: `Bearer ${normalized.apiKey}`,
    };
  }

  if (isDaemonAuthType(normalized.authType)) {
    return baseHeaders;
  }

  throw new Error(`CodeBuddy account has no credentials: ${normalized.id}`);
}

export {
  createEmptyCodeBuddyAccountsStore,
  getCodeBuddyAccountsPath,
};
