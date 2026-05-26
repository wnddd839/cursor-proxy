#!/usr/bin/env node
import { createServer } from "node:http";
import http2 from "node:http2";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const DEFAULT_AUTH_PATH = path.join(homedir(), ".config", "cursor", "auth.json");

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
  apiBaseUrl: process.env.CURSOR_DIRECT_API_BASE_URL || "https://api2.cursor.sh",
  agentHost: process.env.CURSOR_DIRECT_AGENT_HOST || "agentn.api5.cursor.sh",
  clientVersion: process.env.CURSOR_DIRECT_CLIENT_VERSION || "cli-2026.05.24-dda726e",
  idleMs: Number(process.env.CURSOR_DIRECT_IDLE_MS || "1200"),
  hardTimeoutMs: Number(process.env.CURSOR_DIRECT_TIMEOUT_MS || "60000"),
  modelsCacheTtlMs: Number(process.env.CURSOR_DIRECT_MODELS_CACHE_TTL_MS || "300000"),
  logLevel: process.env.CURSOR_DIRECT_LOG_LEVEL || "info",
};

const startedAt = Date.now();
const modelCache = { expiresAt: 0, models: [] };
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
};

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
  return refreshAuthIfNeeded(readAuthFile());
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

  writeFileSync(config.authPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return { accessToken: next.accessToken, refreshToken: next.refreshToken, refreshed: true };
}

async function readAndSummarizeAuth() {
  if (!existsSync(config.authPath)) {
    return {
      loggedIn: false,
      authPath: config.authPath,
      email: "",
      subject: "",
      issuedAt: 0,
      accessTokenExpiresAt: 0,
      hasRefreshToken: false,
      accessTokenPreview: "",
      refreshTokenPreview: "",
      missing: true,
    };
  }

  const auth = JSON.parse(readFileSync(config.authPath, "utf8"));
  return summarizeCursorAuth(auth, { authPath: config.authPath });
}

function clearAuthFile() {
  if (existsSync(config.authPath)) {
    unlinkSync(config.authPath);
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
  if (!options.fresh && modelCache.models.length > 0 && now < modelCache.expiresAt) {
    return modelCache.models;
  }

  const token = await getAccessToken();
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

  modelCache.expiresAt = now + Math.max(0, config.modelsCacheTtlMs);
  modelCache.models = models;
  return models;
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

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let cursor = pos;
  while (cursor < buf.length) {
    const byte = buf[cursor];
    cursor += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, cursor];
}

function extractStringsFromProtobuf(buf, fieldPath = "", depth = 0) {
  if (!buf || depth > 8) return [];
  const strings = [];
  let pos = 0;

  while (pos < buf.length) {
    const [tag, tagEnd] = readVarint(buf, pos);
    if (tagEnd === pos) break;
    pos = tagEnd;

    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    const currentPath = fieldPath ? `${fieldPath}.${fieldNum}` : String(fieldNum);

    if (wireType === 0) {
      const [, nextPos] = readVarint(buf, pos);
      pos = nextPos;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 2) {
      const [len, dataStart] = readVarint(buf, pos);
      pos = dataStart + len;
      if (len <= 0 || dataStart + len > buf.length) continue;
      const data = buf.subarray(dataStart, dataStart + len);
      strings.push(...extractStringsFromProtobuf(data, currentPath, depth + 1));
      const text = data.toString("utf8");
      if (text && /^[\x09\x0a\x0d\x20-\x7e]+$/.test(text)) {
        strings.push({ text, fieldPath: currentPath, depth, frameIndex: 0 });
      }
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }

  return strings;
}

function parseConnectFrames(data) {
  const strings = [];
  let offset = 0;
  let frameIndex = 0;

  while (offset + 5 <= data.length) {
    const flags = data[offset];
    const length = data.readUInt32BE(offset + 1);
    if (offset + 5 + length > data.length) break;
    let payload = data.subarray(offset + 5, offset + 5 + length);
    if (flags === 1) {
      try {
        payload = zlib.gunzipSync(payload);
      } catch {
        // keep the original payload
      }
    }

    for (const item of extractStringsFromProtobuf(payload)) {
      strings.push({ ...item, frameIndex });
    }
    offset += 5 + length;
    frameIndex += 1;
  }

  return strings;
}

function looksLikeOpaqueToken(text) {
  const value = text.trim();
  if (/^[0-9a-f]{12,}$/i.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  if (/^[A-Za-z0-9_-]{48,}$/.test(value) && !/\s/.test(value)) return true;
  return false;
}

function pickAssistantCandidate(strings, options = {}) {
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
      if (/^(cli|true|false|ok)$/i.test(item.text)) return false;
      if (item.text.includes("<user_query>")) return false;
      if (item.text.includes('"role"') || item.text.includes("providerOptions")) return false;
      if (item.text.includes("serverGenReqId")) return false;
      return true;
    })
    .map((item) => {
      let score = item.frameIndex * 20 + item.depth;
      if (item.text.includes(" ")) score += 20;
      if (/[.!?。！？]$/.test(item.text)) score += 15;
      score += Math.min(item.text.length, 600);
      if (item.text.length <= 3) score += 10;
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.text || "";
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

function runDirectCompletion(prompt, model) {
  return new Promise(async (resolve, reject) => {
    let token;
    try {
      token = await getAccessToken();
    } catch (error) {
      reject(error);
      return;
    }

    const started = Date.now();
    const client = http2.connect(`https://${config.agentHost}`);
    const payload = createConnectFrame(buildDirectRunPayload(prompt, model));
    let responseData = Buffer.alloc(0);
    let status = 0;
    let settled = false;
    let idleTimer = null;
    let request = null;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
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

    const finishWithCurrentData = () => {
      const strings = parseConnectFrames(responseData);
      const text = pickAssistantCandidate(strings, { prompt, model });
      if (status && status !== 200) {
        settle(reject, new Error(`Cursor direct HTTP ${status}`));
        return;
      }
      if (!text) {
        settle(reject, new Error(`Cursor direct returned no assistant text (${responseData.length} bytes)`));
        return;
      }
      settle(resolve, {
        text,
        status,
        durationMs: Date.now() - started,
        bytes: responseData.length,
        stringCount: strings.length,
      });
    };

    const hardTimeout = setTimeout(finishWithCurrentData, Math.max(1000, config.hardTimeoutMs));

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
      responseData = Buffer.concat([responseData, chunk]);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearTimeout(hardTimeout);
        finishWithCurrentData();
      }, Math.max(250, config.idleMs));
    });
    request.on("end", () => {
      clearTimeout(hardTimeout);
      finishWithCurrentData();
    });
    request.on("error", (error) => {
      clearTimeout(hardTimeout);
      settle(reject, error);
    });
    client.on("error", (error) => {
      clearTimeout(hardTimeout);
      settle(reject, error);
    });
    request.end(payload);
  });
}

function beginTrackedRequest(model, promptChars) {
  const started = Date.now();
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  stats.lastModel = model;
  stats.lastPromptChars = promptChars;
  stats.lastRequestAt = started;

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

function html(status, body) {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key,x-admin-password",
      "access-control-allow-methods": "GET,POST,OPTIONS",
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
      "access-control-allow-methods": "GET,POST,OPTIONS",
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

function isAdminAuthorized(req) {
  if (!config.adminPassword) return false;
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const password = req.headers["x-admin-password"] || "";
  return bearer === config.adminPassword || password === config.adminPassword;
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
      agentHost: config.agentHost,
      clientVersion: config.clientVersion,
      idleMs: config.idleMs,
      hardTimeoutMs: config.hardTimeoutMs,
      modelsCacheTtlMs: config.modelsCacheTtlMs,
    },
  };
}

function buildDirectAdminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor Direct Gateway</title>
  <style>
    :root {
      --bg: #0d1110;
      --panel: #151a18;
      --panel-2: #1c2320;
      --line: #2c3833;
      --text: #edf4ef;
      --muted: #a7b4ad;
      --faint: #74837b;
      --accent: #7fd889;
      --accent-2: #67c7d8;
      --warn: #f4c35d;
      --bad: #f07b86;
      --ink: #0b100e;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0; }
    body {
      background:
        linear-gradient(180deg, rgba(127,216,137,.08), transparent 280px),
        linear-gradient(135deg, #0b0f0e 0%, #111816 54%, #0c1212 100%);
    }
    body::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .14;
      background-image: linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    button, input, textarea, select { font: inherit; letter-spacing: 0; }
    button {
      min-height: 38px; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px;
      background: #202822; color: var(--text); cursor: pointer;
    }
    button:hover { border-color: #4a6258; }
    button.primary { background: var(--accent); border-color: #a1efaa; color: var(--ink); font-weight: 800; }
    button.warn { background: #332916; border-color: rgba(244,195,93,.45); color: #ffe4a1; }
    button.danger { background: #321b20; border-color: rgba(240,123,134,.45); color: #ffc2c8; }
    input, textarea, select {
      width: 100%; border: 1px solid var(--line); border-radius: 8px; color: var(--text);
      background: #0f1513; padding: 10px 11px; outline: none;
    }
    textarea { min-height: 170px; resize: vertical; }
    label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 7px; }
    .hidden { display: none !important; }
    .shell { position: relative; max-width: 1420px; margin: 0 auto; padding: 22px; }
    .topbar, .panel, .login, .metric {
      border: 1px solid var(--line); background: rgba(21,26,24,.92); border-radius: 8px;
      box-shadow: 0 18px 45px rgba(0,0,0,.28);
    }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark { width: 40px; height: 40px; border-radius: 8px; background: var(--accent); color: var(--ink); display: grid; place-items: center; font-weight: 900; }
    .title { font-size: 18px; font-weight: 850; line-height: 1.2; }
    .sub { color: var(--muted); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
    .actions, .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; margin-top: 16px; }
    .rail { display: grid; gap: 12px; align-content: start; }
    .panel { padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 15px; line-height: 1.25; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { padding: 14px; min-height: 104px; }
    .metric .label { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .metric .value { margin-top: 9px; font-size: 26px; line-height: 1.05; font-weight: 900; overflow-wrap: anywhere; }
    .metric .hint { margin-top: 8px; color: var(--faint); font-size: 12px; }
    .grid { display: grid; gap: 16px; }
    .split { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 14px; }
    .stack { display: grid; gap: 12px; }
    .mono {
      border: 1px solid var(--line); border-radius: 8px; background: #0f1513; color: var(--muted);
      padding: 12px; white-space: pre-wrap; overflow: auto; min-height: 86px;
    }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .table th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 5px 8px; color: var(--muted); background: #101614; font-size: 12px; }
    .pill.good { color: var(--accent); border-color: rgba(127,216,137,.42); }
    .pill.warn { color: var(--warn); border-color: rgba(244,195,93,.42); }
    .pill.bad { color: var(--bad); border-color: rgba(240,123,134,.42); }
    .copyline { display: flex; gap: 8px; }
    .copyline input { min-width: 0; }
    .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 22px; }
    .login { width: min(560px, 100%); padding: 20px; }
    .login p { color: var(--muted); margin: 10px 0 18px; }
    .toast { color: var(--muted); font-size: 12px; min-height: 18px; }
    @media (max-width: 1100px) {
      .layout, .split { grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .shell { padding: 12px; }
      .topbar { align-items: flex-start; flex-direction: column; }
      .metric-grid { grid-template-columns: 1fr; }
      .copyline { display: grid; }
      .metric .value { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="login-wrap" id="loginView">
    <section class="login">
      <div class="brand">
        <div class="mark">CD</div>
        <div>
          <div class="title">Cursor Direct Gateway</div>
          <div class="sub">直连模式管理台 · /direct-admin/</div>
        </div>
      </div>
      <p>输入直连管理密码后，可以查看账号、导入 auth.json、刷新 token、检测模型和复制 NewAPI 接入地址。</p>
      <label for="adminPassword">管理密码</label>
      <input id="adminPassword" type="password" autocomplete="current-password" placeholder="输入管理密码" />
      <div class="row" style="margin-top: 12px;">
        <button class="primary" id="loginBtn">进入管理台</button>
        <button id="rememberBtn" type="button">记住本浏览器</button>
      </div>
      <div class="toast" id="loginStatus" style="margin-top: 12px;">等待输入管理密码。</div>
    </section>
  </div>

  <main class="shell hidden" id="appView">
    <header class="topbar">
      <div class="brand">
        <div class="mark">CD</div>
        <div>
          <div class="title">Cursor Direct Gateway</div>
          <div class="sub" id="runtimeLine">正在读取运行状态...</div>
        </div>
      </div>
      <div class="actions">
        <button class="primary" id="refreshBtn">刷新</button>
        <button id="copyBaseBtn">复制 Base URL</button>
        <button id="logoutAdminBtn">退出</button>
      </div>
    </header>

    <section class="metric-grid" style="margin-top: 16px;">
      <div class="metric">
        <div class="label">账号</div>
        <div class="value" id="accountValue">-</div>
        <div class="hint" id="accountHint">等待读取</div>
      </div>
      <div class="metric">
        <div class="label">NewAPI Base URL</div>
        <div class="value" id="baseUrlValue">-</div>
        <div class="hint">渠道类型选 OpenAI 兼容</div>
      </div>
      <div class="metric">
        <div class="label">请求</div>
        <div class="value" id="requestsValue">0</div>
        <div class="hint" id="requestsHint">成功 / 失败</div>
      </div>
      <div class="metric">
        <div class="label">延迟</div>
        <div class="value" id="latencyValue">-</div>
        <div class="hint" id="latencyHint">最近 / 平均</div>
      </div>
    </section>

    <div class="layout">
      <aside class="rail">
        <section class="panel">
          <h2>服务概览</h2>
          <div class="stack">
            <span class="pill good" id="healthPill">健康检查中</span>
            <span class="pill" id="authPill">认证状态读取中</span>
            <span class="pill" id="memoryPill">内存读取中</span>
            <span class="pill" id="modelPill">模型读取中</span>
          </div>
        </section>
        <section class="panel">
          <h2>接入地址</h2>
          <div class="copyline">
            <input id="baseUrlInput" readonly />
            <button id="copyBaseInlineBtn">复制</button>
          </div>
          <div class="mono" id="apiBox" style="margin-top: 12px;"></div>
        </section>
      </aside>

      <section class="grid">
        <section class="panel">
          <h2>账号池</h2>
          <table class="table">
            <thead><tr><th>状态</th><th>账号</th><th>Token</th><th>文件</th></tr></thead>
            <tbody id="accountRows"><tr><td colspan="4">正在读取...</td></tr></tbody>
          </table>
        </section>

        <section class="split">
          <div class="panel">
            <h2>导入 / 更新账号</h2>
            <label for="authJson">Cursor auth.json</label>
            <textarea id="authJson" placeholder='粘贴包含 accessToken 和 refreshToken 的 JSON'></textarea>
            <div class="row" style="margin-top: 10px;">
              <button class="primary" id="saveAuthBtn">保存账号</button>
              <button class="warn" id="refreshTokenBtn">强制刷新 Token</button>
              <button class="danger" id="clearAuthBtn">清除账号</button>
            </div>
            <div class="toast" id="authToast" style="margin-top: 10px;"></div>
          </div>
          <div class="panel">
            <h2>运行诊断</h2>
            <label for="probeModel">探针模型</label>
            <select id="probeModel"><option value="composer-2-fast">composer-2-fast</option><option value="auto">auto</option></select>
            <div class="row" style="margin-top: 10px;">
              <button class="primary" id="probeBtn">运行探针</button>
            </div>
            <div class="mono" id="probeBox" style="margin-top: 12px;">还没有运行探针。</div>
          </div>
        </section>

        <section class="panel">
          <h2>模型列表</h2>
          <table class="table">
            <thead><tr><th>模型 ID</th><th>上游 ID</th><th>名称</th></tr></thead>
            <tbody id="modelRows"><tr><td colspan="3">正在读取...</td></tr></tbody>
          </table>
        </section>

        <section class="panel">
          <h2>运行状态</h2>
          <div class="mono" id="statusBox">正在读取...</div>
        </section>
      </section>
    </div>
  </main>

  <script>
    const ADMIN_API = '/direct-admin/api';
    const state = {
      password: localStorage.getItem('cursor_direct_admin_password') || '',
      remember: localStorage.getItem('cursor_direct_admin_remember') === '1',
      status: null,
      account: null,
      models: [],
    };
    const $ = (id) => document.getElementById(id);

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }
    function fmtMs(value) {
      const n = Math.max(0, Math.round(Number(value) || 0));
      if (!n) return '-';
      return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 1 : 2) + 's' : n + 'ms';
    }
    function fmtBytes(bytes) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let n = Number(bytes) || 0;
      let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
      return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
    }
    function fmtTime(ms) {
      if (!ms) return '-';
      return new Date(ms).toLocaleString();
    }
    function setLoginVisible(visible) {
      $('loginView').classList.toggle('hidden', !visible);
      $('appView').classList.toggle('hidden', visible);
    }
    function setToast(id, text) {
      $(id).textContent = text;
    }
    async function api(path, options = {}) {
      const headers = Object.assign({}, options.headers || {}, { 'X-Admin-Password': state.password });
      const response = await fetch(ADMIN_API + path, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (response.status === 401) throw new Error('管理密码不正确');
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : response.statusText;
        throw new Error(message || '请求失败');
      }
      return data;
    }
    function renderAccount(account) {
      const loggedIn = Boolean(account && account.loggedIn);
      const email = loggedIn ? (account.email || account.subject || '已登录') : '未登录';
      $('accountValue').textContent = email;
      $('accountHint').textContent = loggedIn ? 'Token 过期: ' + fmtTime(account.accessTokenExpiresAt) : '等待导入 auth.json';
      $('authPill').className = loggedIn ? 'pill good' : 'pill bad';
      $('authPill').textContent = loggedIn ? 'Cursor 账号已登录' : 'Cursor 账号未登录';
      $('accountRows').innerHTML = '<tr>' +
        '<td>' + (loggedIn ? '<span class="pill good">启用</span>' : '<span class="pill bad">缺失</span>') + '</td>' +
        '<td>' + escapeHtml(email) + '<br><span style="color:var(--faint)">' + escapeHtml(account.subject || '') + '</span></td>' +
        '<td>access: ' + escapeHtml(account.accessTokenPreview || '-') + '<br>refresh: ' + escapeHtml(account.refreshTokenPreview || '-') + '<br>过期: ' + escapeHtml(fmtTime(account.accessTokenExpiresAt)) + '</td>' +
        '<td>' + escapeHtml(account.authPath || '-') + '</td>' +
      '</tr>';
    }
    function renderModels(models) {
      $('modelPill').textContent = String(models.length) + ' 个模型';
      $('modelRows').innerHTML = models.length ? models.map((model) => '<tr><td>' + escapeHtml(model.id) + '</td><td>' + escapeHtml(model.modelId || model.id) + '</td><td>' + escapeHtml(model.displayName || '-') + '</td></tr>').join('') : '<tr><td colspan="3">没有模型返回。</td></tr>';
      const preferred = ['composer-2-fast', 'composer-2.5-fast', 'auto'];
      const ids = Array.from(new Set(preferred.concat(models.map((model) => model.id).filter(Boolean))));
      $('probeModel').innerHTML = ids.map((id) => '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '</option>').join('');
    }
    function renderStatus(status) {
      const baseUrl = window.location.origin + status.apiBasePath;
      $('runtimeLine').textContent = status.backend + ' · ' + status.config.agentHost + ' · ' + status.config.clientVersion;
      $('baseUrlValue').textContent = baseUrl;
      $('baseUrlInput').value = baseUrl;
      $('requestsValue').textContent = String(status.stats.totalRequests || 0);
      $('requestsHint').textContent = '成功 ' + (status.stats.successRequests || 0) + ' / 失败 ' + (status.stats.failedRequests || 0);
      $('latencyValue').textContent = fmtMs(status.stats.lastDurationMs);
      $('latencyHint').textContent = '平均 ' + fmtMs(status.stats.averageDurationMs);
      $('healthPill').className = 'pill good';
      $('healthPill').textContent = 'Direct Gateway 正常';
      $('memoryPill').textContent = 'RSS ' + fmtBytes(status.memory.rss);
      $('apiBox').textContent = [
        'Base URL: ' + baseUrl,
        'Models:   GET  ' + baseUrl + '/models',
        'Chat:     POST ' + baseUrl + '/chat/completions',
        'Health:   GET  ' + window.location.origin + '/health'
      ].join('\\n');
      $('statusBox').textContent = JSON.stringify(status, null, 2);
    }
    function renderAll(payloads) {
      state.status = payloads.status;
      state.account = payloads.account;
      state.models = payloads.models;
      renderStatus(state.status);
      renderAccount(state.account);
      renderModels(state.models);
    }
    async function refresh() {
      const status = await api('/status');
      const account = await api('/account');
      let models = [];
      try {
        const modelPayload = await api('/models');
        models = Array.isArray(modelPayload.models) ? modelPayload.models : [];
      } catch (error) {
        $('modelPill').className = 'pill warn';
        $('modelPill').textContent = '模型读取失败';
        $('modelRows').innerHTML = '<tr><td colspan="3">' + escapeHtml(error.message) + '</td></tr>';
      }
      renderAll({ status, account, models });
    }
    async function login() {
      state.password = $('adminPassword').value.trim();
      if (!state.password) {
        setToast('loginStatus', '请先输入管理密码。');
        return;
      }
      try {
        await api('/status');
        if (state.remember) {
          localStorage.setItem('cursor_direct_admin_password', state.password);
          localStorage.setItem('cursor_direct_admin_remember', '1');
        }
        setLoginVisible(false);
        await refresh();
      } catch (error) {
        setToast('loginStatus', error.message);
      }
    }
    async function saveAuth() {
      setToast('authToast', '正在保存账号...');
      try {
        await api('/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ authJson: $('authJson').value }),
        });
        $('authJson').value = '';
        setToast('authToast', '账号已保存。');
        await refresh();
      } catch (error) {
        setToast('authToast', '保存失败: ' + error.message);
      }
    }
    async function refreshToken() {
      setToast('authToast', '正在强制刷新 token...');
      try {
        const result = await api('/refresh-token', { method: 'POST' });
        setToast('authToast', result.refreshed ? 'Token 已刷新。' : 'Token 未刷新，可能还没到期或上游未返回新 token。');
        await refresh();
      } catch (error) {
        setToast('authToast', '刷新失败: ' + error.message);
      }
    }
    async function clearAuth() {
      if (!confirm('确认清除当前 Cursor auth.json 吗？')) return;
      await api('/logout', { method: 'POST' });
      setToast('authToast', '账号已清除。');
      await refresh();
    }
    async function runProbe() {
      const model = $('probeModel').value || 'composer-2-fast';
      $('probeBox').textContent = '正在请求 ' + model + '...';
      try {
        const result = await api('/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        $('probeBox').textContent = [
          '模型: ' + result.model,
          '耗时: ' + fmtMs(result.durationMs),
          '输出: ' + (result.text || '-')
        ].join('\\n');
        await refresh();
      } catch (error) {
        $('probeBox').textContent = '探针失败: ' + error.message;
      }
    }
    async function copyBaseUrl() {
      const value = $('baseUrlInput').value || (window.location.origin + '/v1');
      await navigator.clipboard.writeText(value).catch(() => {});
    }
    $('loginBtn').addEventListener('click', login);
    $('adminPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
    $('rememberBtn').addEventListener('click', () => {
      state.remember = !state.remember;
      $('rememberBtn').textContent = state.remember ? '已记住本浏览器' : '记住本浏览器';
      if (!state.remember) {
        localStorage.removeItem('cursor_direct_admin_password');
        localStorage.removeItem('cursor_direct_admin_remember');
      }
    });
    $('logoutAdminBtn').addEventListener('click', () => {
      localStorage.removeItem('cursor_direct_admin_password');
      localStorage.removeItem('cursor_direct_admin_remember');
      state.password = '';
      $('adminPassword').value = '';
      setLoginVisible(true);
    });
    $('refreshBtn').addEventListener('click', refresh);
    $('copyBaseBtn').addEventListener('click', copyBaseUrl);
    $('copyBaseInlineBtn').addEventListener('click', copyBaseUrl);
    $('saveAuthBtn').addEventListener('click', saveAuth);
    $('refreshTokenBtn').addEventListener('click', refreshToken);
    $('clearAuthBtn').addEventListener('click', clearAuth);
    $('probeBtn').addEventListener('click', runProbe);
    if (state.remember && state.password) {
      $('adminPassword').value = state.password;
      login();
    }
  </script>
</body>
</html>`;
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

  if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    const response = json(200, getStatusPayload());
    res.writeHead(response.status, response.headers);
    res.end(req.method === "HEAD" ? undefined : response.body);
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
        const auth = typeof body?.authJson === "string" && body.authJson.trim()
          ? JSON.parse(body.authJson)
          : body;
        const accessToken = auth?.accessToken || auth?.access_token;
        const refreshToken = auth?.refreshToken || auth?.refresh_token;
        if (!accessToken || !refreshToken) {
          throw new Error("auth.json must include accessToken and refreshToken");
        }
        const next = { accessToken, refreshToken };
        mkdirSync(path.dirname(config.authPath), { recursive: true });
        writeFileSync(config.authPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        modelCache.expiresAt = 0;
        modelCache.models = [];
        const response = json(200, { ok: true, account: summarizeCursorAuth(next, { authPath: config.authPath }) });
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
        const result = await refreshAuthRecord(readAuthFile(), { force: true });
        const response = json(200, {
          ok: true,
          refreshed: Boolean(result.refreshed),
          account: summarizeCursorAuth(result, { authPath: config.authPath }),
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
        const result = await runDirectCompletion(prompt, model);
        const durationMs = Date.now() - started;
        finishRequest(true, { outputChars: result.text.length });
        const response = json(200, {
          ok: true,
          model: displayModelId(model),
          durationMs,
          text: result.text,
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
      clearAuthFile();
      modelCache.expiresAt = 0;
      modelCache.models = [];
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
    const finishRequest = beginTrackedRequest(model, prompt.length);

    try {
      const result = await runDirectCompletion(prompt, model);
      finishRequest(true, { outputChars: result.text.length });

      if (body?.stream === true) {
        const id = `cursor-direct-${Date.now()}`;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        res.write(sse(createChunk(id, model, { role: "assistant" })));
        res.write(sse(createChunk(id, model, { content: result.text })));
        res.write(sse(createChunk(id, model, {}, true)));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

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
  buildDirectAdminHtml,
  buildDirectAdminStatusPayload,
  buildPromptFromMessages,
  extractStringsFromProtobuf,
  generateChecksum,
  listDirectModels,
  normalizeDirectModel,
  pickAssistantCandidate,
  summarizeCursorAuth,
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
