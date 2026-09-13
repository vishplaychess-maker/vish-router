/**
 * Adapter: "openai-compatible"
 *
 * Used by OpenAI and DeepSeek, which share the OpenAI Chat Completions wire
 * format. Translation is therefore mostly *sanitisation*: forward only the
 * fields both providers understand, and normalise the response so the client
 * always sees the model name it asked for (even after a failover).
 */

import { ProviderError, nowSeconds, trimSlash } from './common.js';

export const name = 'openai-compatible';

/** Request fields forwarded verbatim to an OpenAI-compatible endpoint. */
const PASSTHROUGH_FIELDS = [
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'n',
  'stop',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'response_format',
  'logprobs',
  'top_logprobs',
  'user',
];

/**
 * Unified request -> OpenAI-compatible wire request.
 * `model` is resolved by the router (it may differ from the client's model
 * when we have fallen back to another provider).
 */
export function buildRequest({ provider, model, body, apiKey, stream = false }) {
  const url = `${trimSlash(provider.baseUrl)}${provider.path}`;
  const headers = { 'content-type': 'application/json', ...(provider.headers ?? {}) };

  if (provider.auth?.type === 'x-api-key') headers['x-api-key'] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  const payload = { model, messages: body.messages };
  for (const field of PASSTHROUGH_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (stream) {
    payload.stream = true;
    // Ask for a final usage-only chunk so token accounting survives failover.
    payload.stream_options = { include_usage: true };
  }

  return { url, headers, payload };
}

/** Anthropic-style `x-api-key` is handled above; this adapter needs no special auth. */

/**
 * OpenAI-compatible response -> canonical OpenAI response.
 * `requestedModel` (the client's model) wins over the upstream `model` so a
 * failover is transparent to the caller.
 */
export function parseResponse({ json, model, requestedModel }) {
  if (!json || !Array.isArray(json.choices) || json.choices.length === 0) {
    throw new ProviderError('upstream returned a response with no choices', {
      provider: name,
      retryable: true,
    });
  }

  return {
    id: json.id ?? `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    object: 'chat.completion',
    created: json.created ?? nowSeconds(),
    model: requestedModel ?? model,
    choices: json.choices.map((choice, index) => ({
      index: choice.index ?? index,
      message: {
        role: choice.message?.role ?? 'assistant',
        content: choice.message?.content ?? '',
        // DeepSeek's reasoner exposes its chain of thought here; keep it.
        ...(choice.message?.reasoning_content !== undefined
          ? { reasoning_content: choice.message.reasoning_content }
          : {}),
      },
      finish_reason: choice.finish_reason ?? 'stop',
    })),
    usage: json.usage ?? null,
  };
}

/**
 * One upstream SSE `data:` payload -> zero or more canonical stream chunks.
 *
 * Contract (shared by every adapter):
 *   in : { data, model, requestedModel, state }
 *   out: { chunks: [...], done: boolean }
 */
export function translateStreamEvent({ data, model, requestedModel, state }) {
  const trimmed = (data ?? '').trim();

  if (trimmed === '[DONE]') return { chunks: [], done: true };
  if (!trimmed) return { chunks: [], done: false };

  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // A partial/garbled frame is not fatal — skip it rather than killing the stream.
    return { chunks: [], done: false };
  }

  const chunks = [];

  if (json.id) state.id = json.id;
  if (json.model) state.upstreamModel = json.model;

  // Usage-only chunk (stream_options.include_usage) — forward as-is.
  if (Array.isArray(json.choices) && json.choices.length === 0 && json.usage) {
    return {
      chunks: [{ id: state.id, object: 'chat.completion.chunk', created: json.created ?? state.created, model: requestedModel ?? model, choices: [], usage: json.usage }],
      done: false,
    };
  }

  for (const choice of json.choices ?? []) {
    chunks.push({
      id: json.id ?? state.id,
      object: 'chat.completion.chunk',
      created: json.created ?? state.created,
      model: requestedModel ?? model,
      choices: [
        {
          index: choice.index ?? 0,
          delta: choice.delta ?? {},
          finish_reason: choice.finish_reason ?? null,
        },
      ],
      ...(json.usage ? { usage: json.usage } : {}),
    });
  }

  return { chunks, done: false };
}
