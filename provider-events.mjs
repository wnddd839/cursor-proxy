import { randomUUID } from "node:crypto";

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string" || Array.isArray(value.content)) {
      return extractText(value.content);
    }
  }
  return "";
}

function normalizeToolInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cloneJson(value);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return { input: value };
    }
  }
  return {};
}

function normalizeToolName(value) {
  return String(value || "").trim();
}

function stringifyToolInput(value) {
  return JSON.stringify(normalizeToolInput(value));
}

function estimateUsage(prompt, output) {
  const promptTokens = Math.max(1, Math.ceil(String(prompt || "").length / 4));
  const completionTokens = Math.max(1, Math.ceil(String(output || "").length / 4));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function estimateClaudeUsage(prompt, output) {
  const usage = estimateUsage(prompt, output);
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
  };
}

function providerTurnToClaudeUsage(turn, options = {}) {
  const usage = turn?.usage;
  if (usage && typeof usage === "object") {
    return {
      input_tokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
    };
  }
  return estimateClaudeUsage(options.prompt || "", String(turn?.text || ""));
}

function createToolUseFromFragment(fragment, existing = {}) {
  const next = {
    id: existing.id || "",
    name: existing.name || "",
    inputText: existing.inputText || "",
    input: existing.input || {},
    source: "provider_delta",
  };

  if (typeof fragment.id === "string" && fragment.id.trim()) {
    next.id = fragment.id.trim();
  }
  if (typeof fragment.idDelta === "string") {
    next.id += fragment.idDelta;
  }
  if (typeof fragment.name === "string" && fragment.name.trim()) {
    next.name = fragment.name.trim();
  }
  if (typeof fragment.nameDelta === "string") {
    next.name += fragment.nameDelta;
  }
  if (fragment.input && typeof fragment.input === "object" && !Array.isArray(fragment.input)) {
    next.input = normalizeToolInput(fragment.input);
  }
  if (typeof fragment.inputText === "string") {
    next.inputText += fragment.inputText;
  }
  if (typeof fragment.arguments === "string") {
    next.inputText += fragment.arguments;
  }
  if (typeof fragment.argumentsDelta === "string") {
    next.inputText += fragment.argumentsDelta;
  }
  if (typeof fragment.partial_json === "string") {
    next.inputText += fragment.partial_json;
  }

  return next;
}

function finalizeToolUse(fragment, fallbackId = "") {
  const normalizedName = normalizeToolName(fragment.name);
  const input = Object.keys(fragment.input || {}).length > 0
    ? cloneJson(fragment.input)
    : normalizeToolInput(fragment.inputText);

  return {
    id: fragment.id || fallbackId || `toolu_${randomUUID().replace(/-/g, "")}`,
    name: normalizedName,
    input,
    source: fragment.source || "provider_delta",
  };
}

export function createProviderTurnAccumulator() {
  const state = {
    text: "",
    thinking: "",
    toolFragments: new Map(),
    toolUses: [],
    toolResults: [],
    errors: [],
    turnEnded: false,
    stopReason: "",
  };

  const pushToolFragment = (event) => {
    const key = String(event.index ?? event.id ?? state.toolFragments.size);
    const fragment = createToolUseFromFragment(event, state.toolFragments.get(key));
    state.toolFragments.set(key, fragment);
  };

  return {
    push(event) {
      if (!event || typeof event !== "object") return;
      if (event.type === "text_delta") {
        state.text += extractText(event.text ?? event.delta ?? "");
        return;
      }
      if (event.type === "thinking_delta") {
        state.thinking += extractText(event.text ?? event.delta ?? "");
        return;
      }
      if (event.type === "tool_use") {
        state.toolUses.push({
          id: String(event.id || `toolu_${randomUUID().replace(/-/g, "")}`),
          name: normalizeToolName(event.name),
          input: normalizeToolInput(event.input),
          source: event.source || "provider_delta",
        });
        return;
      }
      if (event.type === "tool_call_delta") {
        pushToolFragment(event);
        return;
      }
      if (event.type === "tool_call") {
        state.toolUses.push({
          id: String(event.id || event.toolCallId || `toolu_${randomUUID().replace(/-/g, "")}`),
          name: normalizeToolName(event.name || event.title || event.toolName),
          input: normalizeToolInput(event.input ?? event.rawInput ?? event.arguments),
          source: event.source || "provider_delta",
        });
        return;
      }
      if (event.type === "tool_result") {
        state.toolResults.push({
          tool_use_id: String(event.tool_use_id || event.toolUseId || event.toolCallId || event.id || ""),
          content: extractText(event.content ?? event.result ?? event.output ?? ""),
          source: event.source || "provider_delta",
          status: String(event.status || ""),
        });
        return;
      }
      if (event.type === "upstream_error") {
        state.errors.push(String(event.message || event.error || "upstream error"));
        state.stopReason = "error";
        return;
      }
      if (event.type === "turn_ended") {
        state.turnEnded = true;
        if (event.stopReason) state.stopReason = String(event.stopReason);
      }
    },
    snapshot(options = {}) {
      const finalizedFragments = [];
      for (const [key, fragment] of state.toolFragments.entries()) {
        finalizedFragments.push(finalizeToolUse(fragment, key));
      }

      const toolUses = [...state.toolUses, ...finalizedFragments]
        .filter((tool, index, list) => tool.name || tool.id || tool.input)
        .filter((tool, index, list) => list.findIndex((item) => item.id === tool.id && item.name === tool.name) === index);

      const stopReason =
        state.stopReason ||
        (state.errors.length > 0 ? "error" : "") ||
        (toolUses.length > 0 ? "tool_use" : "end_turn");

      return {
        text: state.text,
        thinking: state.thinking,
        toolUses,
        toolResults: cloneJson(state.toolResults),
        errors: [...state.errors],
        turnEnded: state.turnEnded,
        stopReason,
        usage: estimateUsage(options.prompt || "", state.text),
      };
    },
  };
}

export function accumulateProviderEvents(events = [], options = {}) {
  const accumulator = options.accumulator || createProviderTurnAccumulator();
  for (const event of Array.isArray(events) ? events : []) {
    accumulator.push(event);
  }
  return accumulator.snapshot(options);
}

export function createOpenAIChatCompletionFromProviderTurn(turn, options = {}) {
  const text = String(turn?.text || "");
  const toolCalls = Array.isArray(turn?.toolUses)
    ? turn.toolUses.map((tool) => ({
      id: tool.id || `call_${randomUUID().replace(/-/g, "")}`,
      type: "function",
      function: {
        name: tool.name || "tool",
        arguments: stringifyToolInput(tool.input),
      },
    }))
    : [];

  return {
    id: options.id || `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: options.model || "provider-neutral",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: turn?.usage || estimateUsage(options.prompt || "", text),
  };
}

export function createOpenAIChatCompletionStreamChunk(id, model, delta = {}, finishReason = null) {
  return {
    id: id || `chatcmpl_${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "provider-neutral",
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
    }],
  };
}

export function createOpenAIChatCompletionStreamChunksFromProviderTurn(turn, options = {}) {
  const id = options.id || `chatcmpl_${Date.now()}`;
  const model = options.model || "provider-neutral";
  const chunks = [createOpenAIChatCompletionStreamChunk(id, model, { role: "assistant" })];
  const text = String(turn?.text || "");
  if (text) {
    chunks.push(createOpenAIChatCompletionStreamChunk(id, model, { content: text }));
  }

  const toolUses = Array.isArray(turn?.toolUses) ? turn.toolUses : [];
  toolUses.forEach((tool, index) => {
    chunks.push(createOpenAIChatCompletionStreamChunk(id, model, {
      tool_calls: [{
        index,
        id: tool.id || `call_${randomUUID().replace(/-/g, "")}`,
        type: "function",
        function: {
          name: tool.name || "tool",
          arguments: stringifyToolInput(tool.input),
        },
      }],
    }));
  });

  chunks.push(createOpenAIChatCompletionStreamChunk(
    id,
    model,
    {},
    toolUses.length > 0 ? "tool_calls" : "stop",
  ));
  return chunks;
}

export function createClaudeMessageFromProviderTurn(turn, options = {}) {
  const content = [];
  if (String(turn?.text || "")) {
    content.push({ type: "text", text: String(turn.text || "") });
  }
  for (const tool of Array.isArray(turn?.toolUses) ? turn.toolUses : []) {
    content.push({
      type: "tool_use",
      id: tool.id || `toolu_${randomUUID().replace(/-/g, "")}`,
      name: tool.name || "tool",
      input: cloneJson(tool.input || {}),
    });
  }

  return {
    id: options.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: options.model || "provider-neutral",
    content,
    stop_reason: content.some((part) => part.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: providerTurnToClaudeUsage(turn, options),
  };
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
        input_tokens: providerTurnToClaudeUsage(null, { prompt }).input_tokens,
        output_tokens: 0,
      },
    },
  };
}

export function createClaudeMessageStreamEventsFromProviderTurn(turn, options = {}) {
  const id = options.id || `msg_${Date.now()}`;
  const model = options.model || "provider-neutral";
  const prompt = options.prompt || "";
  const events = [{
    event: "message_start",
    payload: createClaudeMessageStartPayload(id, model, prompt),
  }];

  let index = 0;
  const text = String(turn?.text || "");
  if (text) {
    events.push({
      event: "content_block_start",
      payload: {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      },
    });
    events.push({
      event: "content_block_delta",
      payload: {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
      },
    });
    events.push({
      event: "content_block_stop",
      payload: { type: "content_block_stop", index },
    });
    index += 1;
  }

  const toolUses = Array.isArray(turn?.toolUses) ? turn.toolUses : [];
  for (const tool of toolUses) {
    events.push({
      event: "content_block_start",
      payload: {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: tool.id || `toolu_${randomUUID().replace(/-/g, "")}`,
          name: tool.name || "tool",
          input: {},
        },
      },
    });
    events.push({
      event: "content_block_delta",
      payload: {
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: stringifyToolInput(tool.input),
        },
      },
    });
    events.push({
      event: "content_block_stop",
      payload: { type: "content_block_stop", index },
    });
    index += 1;
  }

  const stopReason = toolUses.length > 0 ? "tool_use" : "end_turn";
  events.push({
    event: "message_delta",
    payload: {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: providerTurnToClaudeUsage(turn, { prompt }),
    },
  });
  events.push({
    event: "message_stop",
    payload: { type: "message_stop" },
  });
  return events;
}
