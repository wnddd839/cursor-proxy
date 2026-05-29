import { randomBytes, randomUUID } from "node:crypto";

import { normalizeBaseUrl } from "./codebuddy-provider.mjs";

const PLUGIN_AUTH_STATE_PATH = "/v2/plugin/auth/state";
const PLUGIN_AUTH_TOKEN_PATH = "/v2/plugin/auth/token";

const SITE_PLUGIN_BASE = {
  global: "https://www.codebuddy.ai",
  domestic: "https://www.codebuddy.cn",
};

export function resolveCodeBuddyPluginBaseUrl(site = "global") {
  const normalized = String(site || "global").toLowerCase();
  if (["domestic", "cn", "china", "internal"].includes(normalized)) {
    return SITE_PLUGIN_BASE.domestic;
  }
  return SITE_PLUGIN_BASE.global;
}

function buildPluginAuthStartHeaders(baseUrl) {
  const domain = new URL(baseUrl).host;
  const requestId = randomUUID().replace(/-/g, "");
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "cache-control": "no-cache",
    pragma: "no-cache",
    connection: "close",
    "x-requested-with": "XMLHttpRequest",
    "x-domain": domain,
    "x-no-authorization": "true",
    "x-no-user-id": "true",
    "x-no-enterprise-id": "true",
    "x-no-department-info": "true",
    "user-agent": "CLI/1.0.8 CodeBuddy/1.0.8",
    "x-product": "SaaS",
    "x-request-id": requestId,
  };
}

function buildPluginAuthPollHeaders(baseUrl) {
  const domain = new URL(baseUrl).host;
  const requestId = randomUUID().replace(/-/g, "");
  const spanId = randomBytes(4).toString("hex");
  return {
    accept: "application/json, text/plain, */*",
    "cache-control": "no-cache",
    pragma: "no-cache",
    connection: "close",
    "x-requested-with": "XMLHttpRequest",
    "x-request-id": requestId,
    b3: `${requestId}-${spanId}-1-`,
    "x-b3-traceid": requestId,
    "x-b3-parentspanid": "",
    "x-b3-spanid": spanId,
    "x-b3-sampled": "1",
    "x-no-authorization": "true",
    "x-no-user-id": "true",
    "x-no-enterprise-id": "true",
    "x-no-department-info": "true",
    "x-domain": domain,
    "user-agent": "CLI/1.0.8 CodeBuddy/1.0.8",
    "x-product": "SaaS",
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function startCodeBuddyPluginAuth(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl || resolveCodeBuddyPluginBaseUrl(options.site));
  const nonce = randomBytes(8).toString("hex");
  const url = `${baseUrl}${PLUGIN_AUTH_STATE_PATH}?platform=CLI&nonce=${nonce}`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: buildPluginAuthStartHeaders(baseUrl),
    body: JSON.stringify({ nonce }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`CodeBuddy auth/state failed with ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  if (payload?.code !== 0 || !payload?.data) {
    throw new Error(payload?.msg || `CodeBuddy auth/state error (code ${payload?.code ?? "unknown"})`);
  }
  const authState = String(payload.data.state || "").trim();
  const authUrl = String(payload.data.authUrl || "").trim();
  if (!authState || !authUrl) {
    throw new Error("CodeBuddy auth/state returned empty state or authUrl");
  }
  return {
    ok: true,
    baseUrl,
    site: options.site || "global",
    authState,
    authUrl,
    tokenEndpoint: `${baseUrl}${PLUGIN_AUTH_TOKEN_PATH}?state=${encodeURIComponent(authState)}`,
    expiresIn: 1800,
    pollIntervalMs: 5000,
  };
}

export async function pollCodeBuddyPluginAuth(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const authState = String(options.authState || "").trim();
  if (!authState) {
    return { status: "error", message: "missing auth state" };
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl || resolveCodeBuddyPluginBaseUrl(options.site));
  const url = `${baseUrl}${PLUGIN_AUTH_TOKEN_PATH}?state=${encodeURIComponent(authState)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: buildPluginAuthPollHeaders(baseUrl),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    return {
      status: "error",
      message: `token poll HTTP ${response.status}`,
      payload,
    };
  }
  if (payload?.code === 11217) {
    return {
      status: "pending",
      message: String(payload.msg || "waiting for login"),
      code: payload.code,
    };
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const accessToken = String(data.accessToken || data.access_token || "").trim();
  if (payload?.code === 0 && accessToken) {
    return {
      status: "success",
      message: "authenticated",
      tokenData: {
        bearerToken: accessToken,
        accessToken,
        tokenType: data.tokenType || data.token_type || "Bearer",
        expiresIn: Number(data.expiresIn || data.expires_in || 0),
        refreshToken: String(data.refreshToken || data.refresh_token || "").trim(),
        sessionState: String(data.sessionState || data.session_state || "").trim(),
        scope: String(data.scope || "").trim(),
        domain: String(data.domain || "").trim(),
      },
      payload,
    };
  }
  return {
    status: "unknown",
    message: String(payload?.msg || "unknown auth status"),
    code: payload?.code,
    payload,
  };
}

export function decodeCodeBuddyJwtPayload(token = "") {
  const text = String(token || "").trim();
  const parts = text.split(".");
  if (parts.length < 2) return {};
  let payloadPart = parts[1];
  const pad = payloadPart.length % 4;
  if (pad) payloadPart += "=".repeat(4 - pad);
  try {
    const json = Buffer.from(payloadPart.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function buildCodeBuddyOAuthAccountFromTokenData(tokenData = {}, options = {}) {
  const bearerToken = String(
    tokenData.bearerToken || tokenData.accessToken || tokenData.access_token || "",
  ).trim();
  if (!bearerToken) {
    throw new Error("CodeBuddy OAuth returned empty access token");
  }
  const jwt = decodeCodeBuddyJwtPayload(bearerToken);
  const userId = String(
    jwt.email || jwt.preferred_username || jwt.sub || tokenData.userId || "",
  ).trim();
  const userName = String(jwt.name || jwt.preferred_username || jwt.email || userId || "").trim();
  const site = options.site || "global";
  const expiresIn = Number(tokenData.expiresIn || tokenData.expires_in || 0);
  const createdAt = Date.now();
  return {
    label: compactText(options.label || userName || userId || "CodeBuddy OAuth"),
    site,
    bearerToken,
    refreshToken: String(tokenData.refreshToken || tokenData.refresh_token || "").trim(),
    tokenExpiresAt: expiresIn > 0 ? createdAt + expiresIn * 1000 : 0,
    source: "oauth",
    authStatus: {
      loggedIn: true,
      authenticated: true,
      userId,
      userName,
      userNickname: String(jwt.nickname || jwt.name || "").trim(),
      authMode: "oauth",
    },
  };
}

function compactText(value) {
  return String(value || "").trim();
}
