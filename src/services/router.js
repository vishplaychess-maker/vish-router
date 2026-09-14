/**
 * VishRouter — routing and failover.
 *
 * Responsibilities:
 *   1. Resolve the requested `model` to the provider that natively serves it.
 *   2. Build an ordered candidate chain: primary provider first, then the
 *      configured `fallbackOrder`, skipping providers that are unusable
 *      (disabled, unknown adapter, or missing API key).
 *   3. Translate the model name per candidate (native -> equivalence map ->
 *      that provider's defaultModel).
 *   4. Walk the chain until one attempt succeeds, failing over on retryable
 *      errors (429/5xx/timeouts/network) and aborting on client errors (400).
 *
 * The adapters own all wire-format translation; this module owns *decisions*.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAdapter, ProviderError } from './adapters/index.js';
import {
  UPSTREAM_CODES,
  providerErrorFromNetwork,
  providerErrorFromResponse,
  nowSeconds,
} from './adapters/common.js';

const DEFAULT_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config/providers.json'
);

// ----------------------------------------------------------------- config

/**
 * Resolved per call rather than at import time, so a deployment (or a test
 * harness) can point the gateway at another registry via VISHROUTER_CONFIG.
 */
function configPath() {
  return process.env.VISHROUTER_CONFIG
    ? path.resolve(process.env.VISHROUTER_CONFIG)
    : DEFAULT_CONFIG_PATH;
}

let configCache = { path: null, mtimeMs: 0, config: null };

/** Load providers.json, re-reading it whenever the file changes on disk. */
export function loadConfig({ reload = false } = {}) {
  const file = configPath();
  const stat = fs.statSync(file);
  if (
    !reload &&
    configCache.config &&
    configCache.path === file &&
    configCache.mtimeMs === stat.mtimeMs
  ) {
    return configCache.config;
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  configCache = { path: file, mtimeMs: stat.mtimeMs, config };
  return config;
}

const isMetaKey = (key) => key.startsWith('_');

/** Provider names in routing order: fallbackOrder first, then any extras. */
function orderedProviderNames(config) {
  const names = [];
  for (const name of config.fallbackOrder ?? []) {
    if (config.providers?.[name]) names.push(name);
  }
  for (const name of Object.keys(config.providers ?? {})) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function getApiKey(provider) {
  const key = process.env[provider.apiKeyEnv];
  return key && key.trim() ? key.trim() : null;
}

// ---------------------------------------------------------------- matching

/** 'exact' | 'prefix' | null */
function matchesModel(model, provider) {
  if (provider.models?.includes(model)) return 'exact';
  if (provider.modelPrefixes?.some((prefix) => model.startsWith(prefix))) return 'prefix';
  return null;
}

/** Which provider natively serves this model? Exact matches win over prefixes. */
export function matchProvider(model, config) {
  const names = orderedProviderNames(config);
  for (const name of names) {
    if (matchesModel(model, config.providers[name]) === 'exact') return { name, via: 'exact' };
  }
  for (const name of names) {
    if (matchesModel(model, config.providers[name]) === 'prefix') return { name, via: 'prefix' };
  }
  return null;
}

/**
 * What model should we actually send to `providerName`?
 *
 *   1. native            — the provider serves the requested model (exact id)
 *   2. native-prefix     — the provider serves the requested model family
 *   3. equivalence       — the modelEquivalents map names this provider's twin
 *   4. provider-default  — last resort: the provider's own defaultModel
 */
export function resolveModelForProvider({ requestedModel, providerName, provider, config }) {
  const native = matchesModel(requestedModel, provider);
  if (native) return { model: requestedModel, via: native === 'exact' ? 'native' : 'native-prefix' };

  const equivalent = config.modelEquivalents?.[requestedModel]?.[providerName];
  if (typeof equivalent === 'string' && equivalent) return { model: equivalent, via: 'equivalence' };

  return { model: provider.defaultModel, via: 'provider-default' };
}

function isKnownModel(model, config) {
  if (matchProvider(model, config)) return true;
  return Object.keys(config.modelEquivalents ?? {}).some((key) => !isMetaKey(key) && key === model);
}

/**
 * Ordered, *usable* candidates for a request, plus a record of what was
 * skipped and why (surfaced in response metadata for debuggability).
 */
export function buildCandidateChain({ model, config }) {
  const primary = matchProvider(model, config);

  if (!isKnownModel(model, config)) {
    const error = new ProviderError(
      `model "${model}" is not served by any configured provider`,
      { provider: null, status: 404, retryable: false }
    );
    error.code = 'model_not_found';
    error.knownModels = knownModels(config);
    throw error;
  }

  const order = [];
  if (primary) order.push(primary.name);
  for (const name of orderedProviderNames(config)) {
    if (!order.includes(name)) order.push(name);
  }

  const candidates = [];
  const skipped = [];

  for (const name of order) {
    const provider = config.providers[name];
    if (!provider) continue;

    if (provider.enabled === false) {
      skipped.push({ provider: name, reason: 'disabled in config' });
      continue;
    }

    let adapter;
    try {
      adapter = getAdapter(provider.adapter);
    } catch (error) {
      skipped.push({ provider: name, reason: error.message });
      continue;
    }

    const apiKey = getApiKey(provider);
    if (!apiKey) {
      skipped.push({ provider: name, reason: `missing ${provider.apiKeyEnv}` });
      continue;
    }

    const resolved = resolveModelForProvider({
      requestedModel: model,
      providerName: name,
      provider,
      config,
    });

    candidates.push({
      name,
      provider,
      adapter,
      apiKey,
      model: resolved.model,
      modelVia: resolved.via,
    });
  }

  // Strict mode: refuse to silently serve the model from another provider.
  if (primary && config.defaults?.allowCrossProviderFallback === false) {
    const skippedPrimary = skipped.find((entry) => entry.provider === primary.name);
    if (skippedPrimary) {
      const error = new ProviderError(
        `model "${model}" is served by "${primary.name}", which is unavailable (${skippedPrimary.reason})`,
        { provider: primary.name, status: 503, retryable: false }
      );
      error.code = 'provider_unavailable';
      error.skipped = skipped;
      throw error;
    }
  }

  if (candidates.length === 0) {
    const error = new ProviderError(`no provider is available to serve "${model}"`, {
      provider: null,
      status: 503,
      retryable: false,
    });
    error.code = 'no_provider_available';
    error.skipped = skipped;
    throw error;
  }

  return { candidates, skipped, primary: primary?.name ?? null };
}

// ------------------------------------------------------- transport helpers

function requireModel(body) {
  const model = body?.model;
  if (typeof model !== 'string' || !model.trim()) {
    const error = new ProviderError('request body must include a non-empty "model"', {
      provider: null,
      status: 400,
      retryable: false,
    });
    error.code = 'invalid_request';
    throw error;
  }
  return model.trim();
}

function linkAbort(controller, timeoutMs, signal) {
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return () => clearTimeout(timer);
}

/** One non-streaming call against one provider. */
async function callProvider({ candidate, body, signal, config }) {
  const { url, headers, payload } = candidate.adapter.buildRequest({
    provider: candidate.provider,
    model: candidate.model,
    body,
    apiKey: candidate.apiKey,
    stream: false,
    defaults: config.defaults,
  });

  const timeoutMs = candidate.provider.timeoutMs ?? config.defaults?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const clearTimer = linkAbort(controller, timeoutMs, signal);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw providerErrorFromNetwork({ provider: candidate.name, error });
  } finally {
    clearTimer();
  }

  const text = await response.text();

  if (!response.ok) {
    throw providerErrorFromResponse({
      provider: candidate.name,
      status: response.status,
      fallbackOn: config.defaults?.fallbackOn,
    });
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError(`${candidate.name} upstream returned a non-JSON body.`, {
      provider: candidate.name,
      status: response.status,
      code: UPSTREAM_CODES.INVALID_RESPONSE,
      retryable: true,
    });
  }

  return candidate.adapter.parseResponse({
    json,
    model: candidate.model,
    requestedModel: body.model,
  });
}

/**
 * Open a streaming connection. Deliberately resolves only *after* the upstream
 * status is known, so a 429/5xx still fails over cleanly — the caller has not
 * written a single byte yet.
 */
async function openStream({ candidate, body, signal, config }) {
  const { url, headers, payload } = candidate.adapter.buildRequest({
    provider: candidate.provider,
    model: candidate.model,
    body,
    apiKey: candidate.apiKey,
    stream: true,
    defaults: config.defaults,
  });

  // Covers connect + time-to-first-byte. Once headers arrive the timer is
  // cleared and parseSSE applies its own per-chunk idle guard instead.
  const ttfbMs = candidate.provider.timeoutMs ?? config.defaults?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const clearTimer = linkAbort(controller, ttfbMs, signal);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw providerErrorFromNetwork({ provider: candidate.name, error });
  } finally {
    clearTimer();
  }

  if (!response.ok) {
    // Drain the body so the socket can be reused, but never inspect or keep it:
    // upstream text must not reach an error object that a client can read.
    await response.text().catch(() => '');
    throw providerErrorFromResponse({
      provider: candidate.name,
      status: response.status,
      fallbackOn: config.defaults?.fallbackOn,
    });
  }

  return response;
}

// ------------------------------------------------------------ SSE parsing

function splitSSEBlock(block) {
  if (!block.trim()) return null;
  let event = null;
  const dataLines = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }

  if (!event && dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** Async-iterate SSE frames out of a fetch response body, with an idle guard. */
async function* parseSSE(body, idleMs) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readWithIdleGuard = async () => {
    if (!idleMs) return reader.read();
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`stream idle for more than ${idleMs}ms`)),
            idleMs
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      const { done, value } = await readWithIdleGuard();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = findBoundary(buffer)) !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = splitSSEBlock(block);
        if (parsed) yield parsed;
      }
    }
    const tail = splitSSEBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock?.();
  }
}

function findBoundary(buffer) {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

// ------------------------------------------------------------ metadata

function buildMeta({ requestedModel, candidate, attempts, chain, skipped, primary, stream }) {
  return {
    provider: candidate.name,
    providerLabel: candidate.provider.label ?? candidate.name,
    adapter: candidate.provider.adapter,
    requestedModel,
    upstreamModel: candidate.model,
    modelResolvedVia: candidate.modelVia,
    primaryProvider: primary,
    fallbackUsed: attempts.some((attempt) => !attempt.ok),
    attemptCount: attempts.length,
    attempts,
    candidatesConsidered: chain.map((entry) => entry.name),
    skippedProviders: skipped,
    stream,
  };
}

function attachAttempts(error, attempts) {
  error.attempts = attempts;
  return error;
}

/**
 * The public shape of one provider attempt.
 *
 * This object reaches clients — inside `x_vishrouter.attempts` on success and
 * `provider_attempts` on failure — so it may carry only facts VishRouter
 * derives itself. There is deliberately no free-text error field: a previous
 * revision stored `error.message` here, which carried upstream-supplied text
 * into every fallback response.
 */
function publicAttempt({ provider, error = null, durationMs }) {
  if (!error) return { provider, ok: true, durationMs };
  return {
    provider,
    ok: false,
    status: error.status ?? null,
    code: error.code ?? UPSTREAM_CODES.UNKNOWN,
    retryable: Boolean(error.retryable),
    durationMs,
  };
}

function buildExhaustedError({ requestedModel, attempts, lastError }) {
  // Stable and client-safe: the model name is caller-supplied, and nothing
  // from the failed attempts is echoed into the message.
  const error = new ProviderError(
    `All ${attempts.length} provider attempt(s) failed for model "${requestedModel}".`,
    { provider: null, status: lastError?.status ?? 502, retryable: false }
  );
  error.code = 'all_providers_failed';
  error.attempts = attempts;
  return error;
}

// --------------------------------------------------------------- public API

/**
 * Non-streaming completion with failover.
 * @returns {Promise<{ response: object, meta: object }>}
 */
export async function routeChatCompletion({ body, signal, config = loadConfig() }) {
  const requestedModel = requireModel(body);
  const { candidates, skipped, primary } = buildCandidateChain({ model: requestedModel, config });

  const attempts = [];
  let lastError = null;

  for (const candidate of candidates) {
    const startedAt = Date.now();
    try {
      const response = await callProvider({ candidate, body, signal, config });
      attempts.push(publicAttempt({ provider: candidate.name, durationMs: Date.now() - startedAt }));

      return {
        response,
        meta: buildMeta({ requestedModel, candidate, attempts, chain: candidates, skipped, primary, stream: false }),
      };
    } catch (error) {
      attempts.push(
        publicAttempt({ provider: candidate.name, error, durationMs: Date.now() - startedAt })
      );
      lastError = error;

      // A client error (e.g. 400 malformed request) will fail everywhere;
      // only retryable failures are worth another provider's time.
      if (!error.retryable) throw attachAttempts(error, attempts);
    }
  }

  throw buildExhaustedError({ requestedModel, attempts, lastError });
}

/**
 * Streaming completion with failover.
 *
 * Yields `{ type: 'meta', meta }` once a provider is committed, then
 * `{ type: 'chunk', chunk }` for every canonical OpenAI chunk.
 *
 * Failover only happens *before* the first chunk: once an upstream has begun
 * streaming, switching providers would corrupt the response, so a mid-stream
 * failure propagates to the caller instead.
 */
export async function* streamChatCompletion({ body, signal, config = loadConfig() }) {
  const requestedModel = requireModel(body);
  const { candidates, skipped, primary } = buildCandidateChain({ model: requestedModel, config });

  const attempts = [];
  let lastError = null;

  for (const candidate of candidates) {
    const startedAt = Date.now();
    let upstream;

    try {
      upstream = await openStream({ candidate, body, signal, config });
    } catch (error) {
      attempts.push(
        publicAttempt({ provider: candidate.name, error, durationMs: Date.now() - startedAt })
      );
      lastError = error;
      if (!error.retryable) throw attachAttempts(error, attempts);
      continue;
    }

    attempts.push(publicAttempt({ provider: candidate.name, durationMs: Date.now() - startedAt }));
    yield {
      type: 'meta',
      meta: buildMeta({ requestedModel, candidate, attempts, chain: candidates, skipped, primary, stream: true }),
    };

    const state = {
      id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
      created: nowSeconds(),
      upstreamModel: null,
      promptTokens: 0,
      completionTokens: 0,
      finishReason: null,
    };

    const idleMs = candidate.provider.streamTimeoutMs ?? config.defaults?.streamTimeoutMs ?? 120_000;

    try {
      for await (const frame of parseSSE(upstream.body, idleMs)) {
        const translated = candidate.adapter.translateStreamEvent({
          event: frame.event,
          data: frame.data,
          model: candidate.model,
          requestedModel,
          state,
        });

        for (const chunk of translated.chunks) yield { type: 'chunk', chunk };
        if (translated.done) return;
      }
      return; // upstream closed without an explicit terminator
    } catch (error) {
      const wrapped =
        error instanceof ProviderError
          ? error
          : new ProviderError(`${candidate.name} upstream stream ended unexpectedly.`, {
              provider: candidate.name,
              code: UPSTREAM_CODES.STREAM_ERROR,
              retryable: false,
              cause: error,
            });
      throw attachAttempts(wrapped, attempts);
    }
  }

  throw buildExhaustedError({ requestedModel, attempts, lastError });
}

/** Provider inventory for /health and /v1/models. */
export function listProviders(config = loadConfig()) {
  return orderedProviderNames(config).map((name) => {
    const provider = config.providers[name];
    const apiKey = getApiKey(provider);
    return {
      name,
      label: provider.label ?? name,
      adapter: provider.adapter,
      enabled: provider.enabled !== false,
      available: provider.enabled !== false && Boolean(apiKey),
      keyEnv: provider.apiKeyEnv,
      defaultModel: provider.defaultModel,
      models: provider.models ?? [],
      modelPrefixes: provider.modelPrefixes ?? [],
    };
  });
}

/** Every model a client may request. */
export function knownModels(config = loadConfig()) {
  const models = new Set();
  for (const name of orderedProviderNames(config)) {
    for (const model of config.providers[name].models ?? []) models.add(model);
  }
  for (const key of Object.keys(config.modelEquivalents ?? {})) {
    if (!isMetaKey(key)) models.add(key);
  }
  return [...models].sort();
}
