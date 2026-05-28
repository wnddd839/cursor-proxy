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

export function createCodeBuddyHeaders(options = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (!options.exemptRequestHeader) {
    headers["x-codebuddy-request"] = "1";
  }

  if (options.token) {
    headers.authorization = `Bearer ${String(options.token).trim()}`;
  }

  return headers;
}

export function buildCodeBuddyRunRequest(messages = [], options = {}) {
  const baseHeaders = createCodeBuddyHeaders({
    token: options.token,
    exemptRequestHeader: options.exemptRequestHeader,
  });
  return {
    method: "POST",
    url: `${normalizeBaseUrl(options.baseUrl)}/api/v1/runs`,
    headers: {
      ...baseHeaders,
      ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
    },
    body: {
      text: Array.isArray(messages)
        ? messages
          .map((message) => {
            const role = String(message?.role || "user").toUpperCase();
            const content = extractTextContent(message?.content).trim();
            return content ? `${role}: ${content}` : "";
          })
          .filter(Boolean)
          .join("\n\n")
        : "",
      sender: options.sender || { id: "cursor-proxy", name: "Cursor Proxy" },
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

  const request = buildCodeBuddyRunRequest(messages, options);
  const runResponse = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify({
      ...request.body,
      ...(options.model ? { model: options.model } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    }),
    signal: options.signal,
  });

  if (!runResponse.ok) {
    throw new Error(`CodeBuddy run failed with ${runResponse.status}: ${(await readResponseText(runResponse)).slice(0, 300)}`);
  }

  const runPayload = await readJsonResponse(runResponse);
  const runId = extractCodeBuddyRunId(runPayload);
  if (!runId) throw new Error("CodeBuddy run response did not include runId");
  const streamUrl = extractCodeBuddyStreamUrl(runPayload, options)
    || `${normalizeBaseUrl(options.baseUrl)}/api/v1/runs/${encodeURIComponent(runId)}/stream`;

  const streamResponse = await fetchImpl(streamUrl, {
    method: "GET",
    headers: request.headers,
    signal: options.signal,
  });

  if (!streamResponse.ok) {
    throw new Error(`CodeBuddy stream failed with ${streamResponse.status}: ${(await readResponseText(streamResponse)).slice(0, 300)}`);
  }

  const streamResult = await readCodeBuddyStreamResponse(streamResponse, {
    prompt: request.body.text,
    onDelta: options.onDelta,
    onEvent: options.onEvent,
  });
  if (streamResult.turn.errors.length > 0) {
    throw new Error(streamResult.turn.errors[0]);
  }
  return {
    ...streamResult,
    runId,
    status: runResponse.status,
    model: options.model || "default",
  };
}

export {
  normalizeCodeBuddyModels,
  normalizeBaseUrl,
};
