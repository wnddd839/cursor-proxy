import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { decodeCodeBuddyJwtPayload } from "./codebuddy-oauth.mjs";
import { buildCodeBuddyCloudHeaders, normalizeBaseUrl } from "./codebuddy-provider.mjs";

const DEFAULT_CODEBUDDY_ACCOUNTS_PATH = path.join(homedir(), ".codebuddy", "proxy-accounts.json");
const CODEBUDDY_SITE_CONFIG = {
  domestic: { site: "domestic", baseUrl: "https://www.codebuddy.cn", internetEnvironment: "domestic" },
  global: { site: "global", baseUrl: "https://www.codebuddy.ai", internetEnvironment: "public" },
};

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

function normalizeCodeBuddyApiEndpoint(value) {
  const text = compactString(value);
  if (!text) return "";
  try {
    return new URL(text).toString().replace(/\/+$/, "");
  } catch {
    return text.replace(/\/+$/, "");
  }
}

function looksLikeCodeBuddySecretValue(value) {
  const text = compactString(value).replace(/^['"]|['"]$/g, "");
  if (!text) return false;
  if (/^\d{10,}$/.test(text)) return false;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) return false;
  if (text.length < 16) return false;
  if (/^eyJ[A-Za-z0-9_-]*\./.test(text)) return true;
  if (/[A-Za-z]/.test(text) && /[A-Za-z0-9]/.test(text)) return true;
  return false;
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
  const bearerToken = compactString(
    source.bearerToken ||
    source.bearer_token ||
    source.accessToken ||
    source.access_token ||
    "",
  );
  const apiKey = compactString(
    source.apiKey || source.api_key || source.xApiKey || source.x_api_key || source["x-api-key"] || "",
  );
  const genericKey = compactString(source.key || "");
  return {
    apiKey: apiKey || (/^ck[_-]/i.test(genericKey) ? genericKey : ""),
    bearerToken: bearerToken || (genericKey.startsWith("eyJ") ? genericKey : ""),
    refreshToken: compactString(source.refreshToken || source.refresh_token || ""),
    tokenExpiresAt: Number(source.tokenExpiresAt || source.token_expires_at || 0),
  };
}

function getCredentialHash(auth) {
  return hashSecret(auth.bearerToken || auth.apiKey || "");
}

function getAuthType(auth) {
  if (auth.bearerToken) return "bearer";
  if (auth.apiKey) return "api_key";
  return "";
}

function normalizeCodeBuddySite(value) {
  const text = compactString(value).toLowerCase();
  if (["domestic", "cn", "china", "internal"].includes(text)) return "domestic";
  return "global";
}

function inferCodeBuddySite(source = {}) {
  if (source.site || source.codeBuddySite || source.codebuddy_site) {
    return normalizeCodeBuddySite(source.site || source.codeBuddySite || source.codebuddy_site);
  }
  const env = compactString(source.internetEnvironment || source.internet_environment || "").toLowerCase();
  if (env === "internal") return "domestic";
  const url = compactString(source.baseUrl || source.url || "").toLowerCase();
  if (url.includes("codebuddy.cn") || url.includes("copilot.tencent.com")) return "domestic";
  return "global";
}

function hasCodeBuddyCredentials(account) {
  return Boolean(compactString(account?.apiKey || account?.bearerToken || ""));
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
  const site = inferCodeBuddySite(source);
  const siteConfig = CODEBUDDY_SITE_CONFIG[site] || CODEBUDDY_SITE_CONFIG.global;
  const baseUrl = normalizeBaseUrl(source.baseUrl || source.url || siteConfig.baseUrl);
  const internetEnvironment = compactString(source.internetEnvironment || source.internet_environment || siteConfig.internetEnvironment);
  const apiEndpoint = normalizeCodeBuddyApiEndpoint(
    source.apiEndpoint || source.api_endpoint || source.chatEndpoint || source.endpoint || "",
  );
  const chatCompletionsPath = compactString(
    source.chatCompletionsPath || source.chat_completions_path || source.endpointPath || source.endpoint_path || "",
  );
  const credentialHash = source.credentialHash || getCredentialHash(auth);
  const identity = authStatus.userId || authStatus.userName || source.subject || source.email || source.label || "";
  const id = compactString(
    options.id ||
    source.id ||
    hashSecret(`${identity}|${credentialHash}|${baseUrl}|${internetEnvironment}|${site}|${apiEndpoint}|${chatCompletionsPath}`),
  );
  const createdAt = Number(source.createdAt || (options.preserveTimestamps ? now : 0) || now);
  const updatedAt = Number(source.updatedAt || now);

  return {
    id,
    provider: "codebuddy",
    label: compactString(source.label || authStatus.userName || authStatus.userId || `CodeBuddy ${id.slice(0, 6)}`),
    enabled: source.enabled !== false && options.enabled !== false,
    source: compactString(options.source || source.source || "pool"),
    site,
    baseUrl,
    internetEnvironment,
    apiEndpoint,
    chatCompletionsPath,
    authType: getAuthType(auth),
    useDaemonAuth: false,
    apiKey: auth.apiKey,
    bearerToken: auth.bearerToken,
    refreshToken: auth.refreshToken,
    tokenExpiresAt: auth.tokenExpiresAt || (
      auth.bearerToken && source.expiresIn
        ? now + Number(source.expiresIn) * 1000
        : 0
    ),
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
    .filter(Boolean)
    .filter(hasCodeBuddyCredentials);
  const rawNext = Number.isInteger(input.nextIndex) ? input.nextIndex : 0;
  const nextIndex = accounts.length > 0 ? ((rawNext % accounts.length) + accounts.length) % accounts.length : 0;
  return { version: 1, provider: "codebuddy", nextIndex, accounts };
}

export function summarizeCodeBuddyAccount(account) {
  const authStatus = normalizeAuthStatus(account?.authStatus || {});
  const loggedIn = hasCodeBuddyCredentials(account)
    ? null
    : (typeof authStatus.loggedIn === "boolean" ? authStatus.loggedIn : false);
  const authType = account?.authType || getAuthType(normalizeCodeBuddyAccountAuth(account));
  return {
    id: account?.id || "",
    provider: "codebuddy",
    label: account?.label || "",
    enabled: account?.enabled !== false,
    source: account?.source || "pool",
    site: account?.site || inferCodeBuddySite(account || {}),
    baseUrl: account?.baseUrl || "",
    internetEnvironment: account?.internetEnvironment || "",
    apiEndpoint: account?.apiEndpoint || "",
    chatCompletionsPath: account?.chatCompletionsPath || "",
    authType,
    hasCredentials: hasCodeBuddyCredentials(account),
    loggedIn,
    userId: authStatus.userId,
    userName: authStatus.userName,
    userNickname: authStatus.userNickname,
    authMode: authStatus.authMode,
    authTokenPreview: "",
    bearerTokenPreview: hasCodeBuddyCredentials(account) ? maskSecret(account?.bearerToken, 6) : "",
    refreshTokenPreview: hasCodeBuddyCredentials(account) ? maskSecret(account?.refreshToken, 4) : "",
    apiKeyPreview: maskSecret(account?.apiKey, 6),
    apiKeyHelperPreview: "",
    cookiePreview: "",
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
    if (!hasCodeBuddyCredentials(account)) continue;
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
  const raw = normalizeCodeBuddyAccountsStore(JSON.parse(readFileSync(accountsPath, "utf8")));
  const parsed = JSON.parse(readFileSync(accountsPath, "utf8"));
  const before = Array.isArray(parsed.accounts) ? parsed.accounts.length : 0;
  if (before !== raw.accounts.length) {
    writeCodeBuddyAccountsStore(raw, { accountsPath });
  }
  return raw;
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

export async function resolveCodeBuddyAccountHeaders(account, options = {}) {
  const normalized = createCodeBuddyAccount(account || {});

  if (normalized.bearerToken) {
    const jwt = decodeCodeBuddyJwtPayload(normalized.bearerToken);
    const userId = String(
      jwt.sub || jwt.email || jwt.preferred_username || normalized.authStatus?.userId || "anonymous",
    ).trim();
    return buildCodeBuddyCloudHeaders({
      bearerToken: normalized.bearerToken,
      baseUrl: normalized.baseUrl || options.baseUrl,
      userId,
    });
  }

  if (normalized.apiKey) {
    return buildCodeBuddyCloudHeaders({
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl || options.baseUrl,
      userId: "anonymous",
    });
  }

  throw new Error(`CodeBuddy account has no credentials: ${normalized.id}`);
}

export {
  createEmptyCodeBuddyAccountsStore,
  getCodeBuddyAccountsPath,
};
