import { randomUUID } from "node:crypto";

import { createProviderTurnAccumulator } from "./provider-events.mjs";

function normalizeBaseUrl(value) {
  const text = String(value || "").trim() || "http://127.0.0.1:8080";
  return text.replace(/\/+$/, "");
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => extractTextContent(part))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (content.content != null) {
      return extractTextContent(content.content);
    }
  }
  return "";
}

function normalizeToolInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value));
  }
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

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createCodeBuddySseEventParser() {
  let buffer = "";
  let currentEvent = "message";
  let currentData = [];

  const flush = () => {
    const events = [];
    if (currentData.length === 0) return;
    const dataText = currentData.join("\n").trim();
    currentData = [];
    if (!dataText || dataText === "[DONE]") {
      currentEvent = "message";
      return events;
    }
    const data = parseJsonMaybe(dataText);
    events.push({ event: currentEvent, data });
    currentEvent = "message";
    return events;
  };

  const processLine = (rawLine) => {
    const line = String(rawLine || "").replace(/\r$/, "");
    if (!line.trim()) return flush() || [];
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      return [];
    }
    if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trimStart());
      return [];
    }
    return [];
  };

  return {
    push(chunk) {
      buffer += String(chunk || "");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      const events = [];
      for (const line of lines) events.push(...processLine(line));
      return events;
    },
    finish() {
      const events = [];
      if (buffer) {
        events.push(...processLine(buffer));
        buffer = "";
      }
      events.push(...(flush() || []));
      return events;
    },
  };
}

function extractSseDataLines(raw) {
  const parser = createCodeBuddySseEventParser();
  return [...parser.push(raw), ...parser.finish()];
}

function normalizeCodeBuddyToolName(update) {
  return String(update?.name || update?.title || update?.toolName || update?.tool || "").trim();
}

function normalizeCodeBuddyModels(input = {}) {
  const root = input?.data && typeof input.data === "object" ? input.data : input;
  const rows = Array.isArray(root?.models) ? root.models : Array.isArray(root) ? root : [];
  const allowed = Array.isArray(root?.availableModels)
    ? new Set(root.availableModels.map((value) => String(value || "").trim()).filter(Boolean))
    : null;

  return rows
    .map((row) => ({
      id: String(row?.id || row?.modelId || "").trim(),
      object: "model",
      name: String(row?.name || row?.label || row?.displayName || row?.id || "").trim(),
      owned_by: String(row?.vendor || row?.provider || "codebuddy"),
      supportsTools: Boolean(row?.supportsToolCall || row?.supportsTools),
      supportsImages: Boolean(row?.supportsImages || row?.supportsImage),
    }))
    .filter((row) => row.id)
    .filter((row) => !allowed || allowed.has(row.id));
}

function normalizeOpenAiMessage(message = {}) {
  const source = message && typeof message === "object" ? message : {};
  const normalized = JSON.parse(JSON.stringify(source));
  normalized.role = String(source?.role || "user").trim() || "user";
  normalized.content = normalizeCodeBuddyMessageContent(source?.content);
  return normalized;
}

function normalizeCodeBuddyContentPart(part) {
  if (typeof part === "string") return { type: "text", text: part };
  if (!part || typeof part !== "object") return null;
  if (typeof part.type === "string") {
    const normalized = JSON.parse(JSON.stringify(part));
    if (normalized.type === "text" && typeof normalized.text !== "string") {
      normalized.text = extractTextContent(normalized.content ?? normalized.value ?? "");
    }
    return normalized;
  }
  const text = extractTextContent(part);
  return text ? { type: "text", text } : null;
}

function normalizeCodeBuddyMessageContent(content) {
  if (Array.isArray(content)) {
    return content
      .map(normalizeCodeBuddyContentPart)
      .filter(Boolean);
  }
  const part = normalizeCodeBuddyContentPart(content);
  return part ? [part] : [];
}

function normalizeOpenAiMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeOpenAiMessage)
    .filter((message) => (
      (Array.isArray(message.content) && message.content.length > 0) ||
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
      Boolean(message.tool_call_id || message.name)
    ));
}

function flattenCodeBuddyCloudContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    const text = extractTextContent(content);
    return text;
  }
  const hasStructured = content.some((part) => part && typeof part === "object" && part.type && part.type !== "text");
  if (hasStructured) return content;
  const text = content
    .map((part) => (typeof part === "string" ? part : (part?.type === "text" ? String(part.text || "") : extractTextContent(part))))
    .filter(Boolean)
    .join("");
  return text;
}

function formatCodeBuddyCloudMessage(message = {}) {
  const role = String(message?.role || "user").trim() || "user";
  const out = { role };
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    out.tool_calls = message.tool_calls;
  }
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  if (message.name) out.name = message.name;
  const flat = flattenCodeBuddyCloudContent(message.content);
  if (typeof flat === "string") {
    out.content = flat;
  } else if (flat != null) {
    out.content = flat;
  } else {
    out.content = "";
  }
  return out;
}

export function ensureCodeBuddyUpstreamMessages(messages = []) {
  const normalized = normalizeOpenAiMessages(messages).map(formatCodeBuddyCloudMessage);
  return normalized;
}

function resolveCodeBuddyHost(baseUrl) {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).host || "www.codebuddy.ai";
  } catch {
    return "www.codebuddy.ai";
  }
}

/** Headers aligned with Sliverkiss/CodeBuddy2api cloud client (not local daemon). */
export function buildCodeBuddyCloudHeaders(options = {}) {
  const bearerToken = String(options.bearerToken || options.bearer_token || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const legacyToken = !bearerToken && !apiKey ? String(options.token || "").trim() : "";
  const useApiKey = Boolean(
    apiKey ||
    (legacyToken && /^ck[_-]/i.test(legacyToken)),
  );
  const authToken = bearerToken || (useApiKey ? (apiKey || legacyToken) : legacyToken);
  const domain = resolveCodeBuddyHost(options.baseUrl || "https://www.codebuddy.ai");
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    "x-stainless-arch": "x64",
    "x-stainless-lang": "js",
    "x-stainless-os": process.platform === "win32" ? "Windows" : (process.platform === "darwin" ? "MacOS" : "Linux"),
    "x-stainless-package-version": "5.10.1",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-conversation-id": String(options.conversationId || randomUUID()),
    "x-conversation-request-id": String(options.conversationRequestId || randomUUID().replace(/-/g, "")),
    "x-conversation-message-id": String(options.conversationMessageId || randomUUID().replace(/-/g, "")),
    "x-request-id": String(options.requestId || randomUUID().replace(/-/g, "")),
    "x-agent-intent": "craft",
    "x-ide-type": "CLI",
    "x-ide-name": "CLI",
    "x-ide-version": "1.0.7",
    "x-domain": domain,
    "user-agent": "CLI/1.0.7 CodeBuddy/1.0.7",
    "x-product": "SaaS",
    "x-user-id": String(options.userId || "anonymous"),
  };
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
    if (useApiKey) {
      headers["X-API-Key"] = apiKey || legacyToken;
    }
  }
  headers["X-CodeBuddy-Request"] = "1";
  return headers;
}

export function createCodeBuddyHeaders(options = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (options.exemptRequestHeader !== true && options.includeRequestHeader !== false) {
    headers["x-codebuddy-request"] = "1";
  }

  if (options.token) {
    headers.authorization = `Bearer ${String(options.token).trim()}`;
  }

  return headers;
}

function normalizeCodeBuddyChatCompletionsPath(value) {
  const text = String(value || "/v2/chat/completions").trim();
  if (!text) return "/v2/chat/completions";
  return text.startsWith("/") ? text : `/${text}`;
}

function resolveCodeBuddyChatEndpoint(options = {}) {
  const endpoint = String(options.apiEndpoint || options.endpoint || options.chatEndpoint || "").trim();
  if (endpoint) return endpoint.replace(/\/+$/, "");
  return `${normalizeBaseUrl(options.baseUrl)}${normalizeCodeBuddyChatCompletionsPath(
    options.chatCompletionsPath || options.endpointPath,
  )}`;
}

export function buildCodeBuddyRunRequest(messages = [], options = {}) {
  const bearerToken = String(options.bearerToken || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const token = String(options.token || "").trim();
  const baseHeaders = bearerToken || apiKey || token
    ? buildCodeBuddyCloudHeaders({
      bearerToken,
      apiKey,
      token: bearerToken ? "" : token,
      baseUrl: options.baseUrl,
      conversationId: options.conversationId,
      conversationRequestId: options.conversationRequestId,
      conversationMessageId: options.conversationMessageId,
      requestId: options.requestId,
      userId: options.userId,
    })
    : createCodeBuddyHeaders({ token: options.token, includeRequestHeader: options.includeRequestHeader });
  const normalizedMessages = ensureCodeBuddyUpstreamMessages(messages);
  const maxCompletionTokens = Number(options.maxCompletionTokens ?? options.maxTokens ?? 0);
  const stream = options.stream !== false;
  return {
    method: "POST",
    url: resolveCodeBuddyChatEndpoint(options),
    headers: {
      ...baseHeaders,
      ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
    },
    body: {
      model: options.model || "auto",
      messages: normalizedMessages,
      stream,
      ...(maxCompletionTokens > 0 ? { max_completion_tokens: maxCompletionTokens } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    },
  };
}

function createProviderEventFromAcpUpdate(update = {}, sessionId = "") {
  const sessionUpdate = String(update?.sessionUpdate || update?.type || "").trim();
  if (sessionUpdate === "agent_message_chunk") {
    const text = extractTextContent(update.content ?? update.text ?? update.delta ?? "");
    return text ? [{
      type: "text_delta",
      text,
      source: "codebuddy_acp",
      sessionId,
    }] : [];
  }

  if (sessionUpdate === "agent_thought_chunk") {
    const text = extractTextContent(update.content ?? update.text ?? update.delta ?? "");
    return text ? [{
      type: "thinking_delta",
      text,
      source: "codebuddy_acp",
      sessionId,
    }] : [];
  }

  if (sessionUpdate === "tool_call") {
    const toolName = normalizeCodeBuddyToolName(update);
    return [{
      type: "tool_use",
      id: String(update?.toolCallId || update?.tool_call_id || update?.id || `call_${Date.now()}`),
      name: toolName,
      input: normalizeToolInput(update.rawInput ?? update.input ?? update.arguments ?? {}),
      source: "codebuddy_acp",
      status: update?.status || "pending",
    }];
  }

  if (sessionUpdate === "tool_call_update") {
    const content = extractTextContent(update.content ?? update.result ?? update.output ?? "");
    if (content) {
      return [{
        type: "tool_result",
        tool_use_id: String(update?.toolCallId || update?.tool_call_id || update?.id || ""),
        content,
        source: "codebuddy_acp",
        status: update?.status || "",
      }];
    }
    return [{
      type: "tool_call_delta",
      index: 0,
      id: String(update?.toolCallId || update?.tool_call_id || update?.id || ""),
      name: toolNameOrFallback(update),
      input: normalizeToolInput(update.rawInput ?? update.input ?? update.arguments ?? {}),
      source: "codebuddy_acp",
      status: update?.status || "",
    }];
  }

  if (sessionUpdate === "session_end" || sessionUpdate === "agent_message_end") {
    return [{ type: "turn_ended", source: "codebuddy_acp", sessionId }];
  }

  return [];
}

function toolNameOrFallback(update = {}) {
  const name = normalizeCodeBuddyToolName(update);
  return name || "tool";
}

export function mapCodeBuddyAcpMessageToProviderEvents(message = {}) {
  const sessionId = String(message?.params?.sessionId || message?.params?.session_id || "");
  if (String(message?.method || "").trim() === "session/update") {
    const update = message?.params?.update || message?.params?.sessionUpdate || {};
    return createProviderEventFromAcpUpdate(update, sessionId);
  }

  if (message && typeof message === "object" && message.result && typeof message.result === "object") {
    const stopReason = String(message.result.stopReason || message.result.stop_reason || "").trim();
    if (stopReason) {
      return [{ type: "turn_ended", stopReason, source: "codebuddy_acp" }];
    }
  }

  return [];
}

function unwrapCodeBuddyPayload(data) {
  if (!data || typeof data !== "object") return data;
  if (data.jsonrpc || data.method) return data;
  if (data.data && typeof data.data === "object") return unwrapCodeBuddyPayload(data.data);
  if (data.result && typeof data.result === "object") return unwrapCodeBuddyPayload(data.result);
  return data;
}

function firstTextValue(...values) {
  for (const value of values) {
    const text = extractTextContent(value).trim();
    if (text) return text;
  }
  return "";
}

function mapOpenAiLikeDeltaToProviderEvents(payload = {}) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const delta = choices[0]?.delta || choices[0]?.message || {};
  const events = [];
  const text = firstTextValue(delta.content, delta.text);
  if (text) events.push({ type: "text_delta", text, source: "codebuddy_openai" });

  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  for (const toolCall of toolCalls) {
    events.push({
      type: "tool_call_delta",
      index: Number.isInteger(toolCall.index) ? toolCall.index : 0,
      id: typeof toolCall.id === "string" ? toolCall.id : "",
      name: typeof toolCall.function?.name === "string" ? toolCall.function.name : "",
      argumentsDelta: typeof toolCall.function?.arguments === "string" ? toolCall.function.arguments : "",
      source: "codebuddy_openai",
    });
  }

  const finishReason = choices[0]?.finish_reason || choices[0]?.finishReason;
  if (finishReason) events.push({ type: "turn_ended", stopReason: String(finishReason), source: "codebuddy_openai" });
  return events;
}

function mapOpenAiLikeMessageToProviderEvents(payload = {}) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0]?.message || choices[0]?.delta || {};
  const events = [];
  const text = firstTextValue(message.content, message.text, payload.output_text);
  if (text) events.push({ type: "text_delta", text, source: "codebuddy_openai" });

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    events.push({
      type: "tool_use",
      id: typeof toolCall.id === "string" ? toolCall.id : `call_${Date.now()}`,
      name: typeof toolCall.function?.name === "string" ? toolCall.function.name : "",
      input: normalizeToolInput(toolCall.function?.arguments ?? {}),
      source: "codebuddy_openai",
    });
  }

  const finishReason = choices[0]?.finish_reason || choices[0]?.finishReason;
  if (finishReason) events.push({ type: "turn_ended", stopReason: String(finishReason), source: "codebuddy_openai" });
  return events;
}

export function mapCodeBuddySseEventToProviderEvents(sseEvent = {}) {
  const data = unwrapCodeBuddyPayload(sseEvent.data);
  if (!data || typeof data !== "object") {
    const text = firstTextValue(data);
    return text ? [{ type: "text_delta", text, source: "codebuddy_sse" }] : [];
  }

  const acpEvents = mapCodeBuddyAcpMessageToProviderEvents(data);
  if (acpEvents.length > 0) return acpEvents;

  if (Array.isArray(data.choices)) return mapOpenAiLikeDeltaToProviderEvents(data);

  const kind = String(data.sessionUpdate || data.type || data.event || sseEvent.event || "").trim();
  if (kind === "agent_message_chunk" || kind === "message" || kind === "text_delta" || kind === "delta") {
    const text = firstTextValue(data.content, data.text, data.delta, data.message);
    return text ? [{ type: "text_delta", text, source: "codebuddy_sse" }] : [];
  }
  if (kind === "agent_thought_chunk" || kind === "thinking_delta") {
    const text = firstTextValue(data.content, data.text, data.delta, data.thought);
    return text ? [{ type: "thinking_delta", text, source: "codebuddy_sse" }] : [];
  }
  if (kind === "tool_call" || kind === "tool_use") {
    return [{
      type: "tool_use",
      id: String(data.toolCallId || data.tool_call_id || data.id || `call_${Date.now()}`),
      name: normalizeCodeBuddyToolName(data),
      input: normalizeToolInput(data.rawInput ?? data.input ?? data.arguments ?? data.args ?? {}),
      source: "codebuddy_sse",
    }];
  }
  if (kind === "tool_call_delta") {
    return [{
      type: "tool_call_delta",
      index: Number.isInteger(data.index) ? data.index : 0,
      id: String(data.toolCallId || data.tool_call_id || data.id || ""),
      name: normalizeCodeBuddyToolName(data),
      argumentsDelta: typeof data.argumentsDelta === "string" ? data.argumentsDelta : "",
      input: normalizeToolInput(data.input ?? data.rawInput ?? {}),
      source: "codebuddy_sse",
    }];
  }
  if (kind === "tool_result") {
    return [{
      type: "tool_result",
      tool_use_id: String(data.toolCallId || data.tool_call_id || data.tool_use_id || data.id || ""),
      content: firstTextValue(data.content, data.result, data.output),
      source: "codebuddy_sse",
      status: String(data.status || ""),
    }];
  }
  if (kind === "session_end" || kind === "done" || kind === "completed" || kind === "agent_message_end") {
    return [{ type: "turn_ended", source: "codebuddy_sse" }];
  }
  if (data.error || kind === "error") {
    const error = data.error && typeof data.error === "object" ? data.error : data;
    return [{
      type: "upstream_error",
      message: String(error.message || error.error || "CodeBuddy upstream error"),
      source: "codebuddy_sse",
    }];
  }

  return [];
}

export function parseCodeBuddySseEvents(text = "") {
  return extractSseDataLines(text);
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readJsonResponse(response) {
  const text = await readResponseText(response);
  if (!text.trim()) return {};
  const parsed = parseJsonMaybe(text);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function getCodeBuddyErrorHint(payload = {}, status = 0) {
  const code = payload?.code;
  if (code === 11140 || /request illegal/i.test(String(payload?.msg || ""))) {
    return "请确认 API Key 来自 Profile Keys（国际站 codebuddy.ai/profile/keys），且账号已开通云端聊天；站点需与 Key 一致。";
  }
  if (status === 401 || /invalid_secret/i.test(String(payload?.message || ""))) {
    return "认证失败：勿同时发送重复的 x-api-key 头；仅使用 Bearer 与 X-API-Key 各一份。";
  }
  return "";
}

function getCodeBuddyErrorMessage(payload = {}, fallback = "CodeBuddy upstream error", status = 0) {
  let message = fallback;
  if (payload?.error && typeof payload.error === "object") {
    message = String(payload.error.message || payload.error.code || fallback);
  } else if (typeof payload?.error === "string") {
    message = payload.error;
  } else if (typeof payload?.message === "string") {
    message = payload.message;
  } else if (payload?.code != null && payload?.msg) {
    message = `${payload.msg} (code ${payload.code})`;
  }
  const hint = getCodeBuddyErrorHint(payload, status);
  return hint ? `${message} — ${hint}` : message;
}

function extractCodeBuddyRunId(payload = {}) {
  const root = unwrapCodeBuddyPayload(payload);
  return String(
    root?.runId ||
    root?.run_id ||
    root?.id ||
    root?.run?.id ||
    root?.run?.runId ||
    "",
  ).trim();
}

function extractCodeBuddyStreamUrl(payload = {}, options = {}) {
  const root = unwrapCodeBuddyPayload(payload);
  const url = String(root?.streamUrl || root?.stream_url || root?.urls?.stream || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${normalizeBaseUrl(options.baseUrl)}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function readCodeBuddyStreamResponse(response, options = {}) {
  const parser = createCodeBuddySseEventParser();
  const accumulator = options.accumulator || createProviderTurnAccumulator();
  const started = Date.now();
  let bytes = 0;
  let eventCount = 0;
  let deltaCount = 0;
  const pushText = (text) => {
    if (!text) return;
    deltaCount += 1;
    options.onDelta?.(text);
  };
  const pushProviderEvents = (providerEvents) => {
    for (const event of providerEvents) {
      accumulator.push(event);
      options.onEvent?.(event);
      if (event.type === "text_delta") pushText(event.text ?? event.delta ?? "");
    }
  };
  const pushSseEvents = (sseEvents) => {
    for (const sseEvent of sseEvents) {
      eventCount += 1;
      pushProviderEvents(mapCodeBuddySseEventToProviderEvents(sseEvent));
    }
  };

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await readResponseText(response);
    bytes += Buffer.byteLength(text, "utf8");
    pushSseEvents(parser.push(text));
    pushSseEvents(parser.finish());
    return { turn: accumulator.snapshot(options), durationMs: Date.now() - started, bytes, eventCount, deltaCount };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value?.byteLength || 0;
    pushSseEvents(parser.push(decoder.decode(value, { stream: true })));
  }
  const trailing = decoder.decode();
  if (trailing) pushSseEvents(parser.push(trailing));
  pushSseEvents(parser.finish());

  return { turn: accumulator.snapshot(options), durationMs: Date.now() - started, bytes, eventCount, deltaCount };
}

export async function runCodeBuddyCompletion(messages = [], options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available for CodeBuddy provider");

  const started = Date.now();
  const request = buildCodeBuddyRunRequest(messages, options);
  const stream = request.body.stream === true;
  const runResponse = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal,
  });

  if (!runResponse.ok) {
    const errorText = await readResponseText(runResponse);
    let errorPayload = {};
    try {
      errorPayload = errorText ? JSON.parse(errorText) : {};
    } catch {
      errorPayload = {};
    }
    throw new Error(`CodeBuddy chat completion failed with ${runResponse.status}: ${getCodeBuddyErrorMessage(errorPayload, errorText, runResponse.status).slice(0, 400)}`);
  }

  if (!stream) {
    const payload = await readJsonResponse(runResponse);
    const accumulator = createProviderTurnAccumulator();
    let eventCount = 0;
    let deltaCount = 0;
    for (const event of mapOpenAiLikeMessageToProviderEvents(payload)) {
      eventCount += 1;
      accumulator.push(event);
      options.onEvent?.(event);
      if (event.type === "text_delta") {
        deltaCount += 1;
        options.onDelta?.(event.text ?? "");
      }
    }
    return {
      turn: accumulator.snapshot({ prompt: JSON.stringify(request.body.messages) }),
      durationMs: Date.now() - started,
      bytes: 0,
      eventCount,
      deltaCount,
      status: runResponse.status,
      model: request.body.model,
    };
  }

  const streamResult = await readCodeBuddyStreamResponse(runResponse, {
    prompt: JSON.stringify(request.body.messages),
    onDelta: options.onDelta,
    onEvent: options.onEvent,
  });
  if (streamResult.turn.errors.length > 0) {
    throw new Error(streamResult.turn.errors[0]);
  }
  return {
    ...streamResult,
    status: runResponse.status,
    model: request.body.model,
  };
}

export {
  normalizeCodeBuddyModels,
  normalizeBaseUrl,
};
