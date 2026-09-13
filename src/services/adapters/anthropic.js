/**
 * Adapter: "anthropic"
 *
 * Anthropic's Messages API is *not* OpenAI-compatible, so this adapter does
 * real translation in both directions:
 *
 *   request  : system messages are lifted out of `messages` into a top-level
 *              `system` field, `max_tokens` is mandatory, `stop` becomes
 *              `stop_sequences`, and OpenAI-only knobs are dropped.
 *   response : content blocks are flattened to a single assistant string and
 *              `usage.input_tokens/output_tokens` become prompt/completion.
 */

import { ProviderError, nowSeconds, trimSlash } from './common.js';

export const name = 'anthropic';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

/** Anthropic stop reasons -> OpenAI finish reasons. */
const STOP_REASON_MAP = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  pause_turn: 'stop',
  refusal: 'content_filter',
};

/** Flatten an OpenAI message content (string or multimodal parts) to text. */
function contentToText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return String(content);
}

/**
 * Lift system messages out and coalesce consecutive same-role turns:
 * Anthropic rejects both a top-level system role and non-alternating turns.
 */
function splitSystemMessages(messages = []) {
  const systemParts = [];
  const turns = [];

  for (const message of messages) {
    const text = contentToText(message?.content);
    if (message?.role === 'system') {
      if (text.trim()) systemParts.push(text);
      continue;
    }
    if (message?.role !== 'user' && message?.role !== 'assistant') continue;
    if (!text.trim()) continue;

    const previous = turns[turns.length - 1];
    if (previous && previous.role === message.role) previous.content += `\n\n${text}`;
    else turns.push({ role: message.role, content: text });
  }

  return { system: systemParts.join('\n\n'), messages: turns };
}

/** Unified request -> Anthropic Messages wire request. */
export function buildRequest({ provider, model, body, apiKey, stream = false, defaults = {} }) {
  const url = `${trimSlash(provider.baseUrl)}${provider.path}`;
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': provider.headers?.['anthropic-version'] ?? DEFAULT_ANTHROPIC_VERSION,
    ...(provider.headers ?? {}),
  };

  if (provider.auth?.type === 'bearer') headers.authorization = `Bearer ${apiKey}`;
  else headers['x-api-key'] = apiKey;

  const { system, messages } = splitSystemMessages(body.messages);

  const payload = {
    model,
    // Required by Anthropic; fall back through provider then global defaults.
    max_tokens: body.max_tokens ?? provider.maxTokensWhenUnspecified ?? defaults.maxTokensWhenUnspecified ?? DEFAULT_MAX_TOKENS,
    messages,
  };

  if (system) payload.system = system;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop !== undefined) payload.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (stream) payload.stream = true;

  // Deliberately dropped — Anthropic rejects these OpenAI-only parameters:
  //   presence_penalty, frequency_penalty, n, seed, response_format,
  //   logprobs, top_logprobs, user

  return { url, headers, payload };
}

/** Anthropic Messages response -> canonical OpenAI response. */
export function parseResponse({ json, model, requestedModel }) {
  if (!json || !Array.isArray(json.content)) {
    throw new ProviderError('anthropic returned a response without a content array', {
      provider: name,
      retryable: true,
    });
  }

  const text = json.content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  const promptTokens = json.usage?.input_tokens ?? 0;
  const completionTokens = json.usage?.output_tokens ?? 0;

  return {
    id: json.id ?? `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    object: 'chat.completion',
    created: nowSeconds(), // Anthropic omits `created`
    model: requestedModel ?? model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: STOP_REASON_MAP[json.stop_reason] ?? 'stop',
      },
    ],
    usage: json.usage
      ? {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        }
      : null,
  };
}

function safeParse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * One Anthropic SSE event -> zero or more canonical stream chunks.
 *
 * Anthropic's stream is a typed event sequence:
 *   message_start -> content_block_start -> content_block_delta* ->
 *   content_block_stop -> message_delta -> message_stop
 * OpenAI clients instead expect a flat run of `chat.completion.chunk` objects,
 * so the events are collapsed into that shape here.
 */
export function translateStreamEvent({ event, data, model, requestedModel, state }) {
  const trimmed = (data ?? '').trim();
  if (trimmed === '[DONE]') return { chunks: [], done: true };
  if (!trimmed) return { chunks: [], done: false };

  const payload = safeParse(trimmed);
  if (!payload) return { chunks: [], done: false };

  const chunkModel = requestedModel ?? model;
  const makeChunk = (delta, finishReason = null, extra = {}) => ({
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: chunkModel,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });

  switch (event) {
    case 'message_start':
      state.id = payload.message?.id ?? state.id;
      state.upstreamModel = payload.message?.model ?? state.upstreamModel;
      state.promptTokens = payload.message?.usage?.input_tokens ?? 0;
      // OpenAI's first chunk carries the assistant role.
      return { chunks: [makeChunk({ role: 'assistant', content: '' })], done: false };

    case 'content_block_delta': {
      const text = payload.delta?.type === 'text_delta' ? payload.delta.text ?? '' : '';
      if (!text) return { chunks: [], done: false };
      return { chunks: [makeChunk({ content: text })], done: false };
    }

    case 'message_delta':
      // Carries the authoritative stop_reason and output token count.
      state.finishReason = STOP_REASON_MAP[payload.delta?.stop_reason] ?? state.finishReason;
      state.completionTokens = payload.usage?.output_tokens ?? state.completionTokens;
      return { chunks: [], done: false };

    case 'message_stop': {
      const promptTokens = state.promptTokens ?? 0;
      const completionTokens = state.completionTokens ?? 0;
      return {
        chunks: [
          makeChunk({}, state.finishReason ?? 'stop', {
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          }),
        ],
        done: true,
      };
    }

    case 'error':
      throw new ProviderError(`anthropic stream error — ${payload.error?.message ?? 'unknown'}`, {
        provider: name,
        retryable: false,
        upstream: trimmed.slice(0, 2000),
      });

    default:
      // ping, content_block_start, content_block_stop — nothing to forward.
      return { chunks: [], done: false };
  }
}
