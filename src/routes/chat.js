/**
 * API endpoints — OpenAI-compatible surface.
 *
 *   POST /v1/chat/completions   unified chat endpoint (routing + failover)
 *   GET  /v1/models             models a client may request
 *
 * Every failure leaves this module as an OpenAI-shaped error envelope:
 *   { "error": { "message", "type", "param", "code" } }
 * so standard OpenAI SDK clients surface it correctly instead of choking on
 * an unexpected HTML or bare-JSON body.
 */

import express from 'express';
import { once } from 'node:events';
import { errorTypeFor, sendError } from '../http/errors.js';
import { ProviderError } from '../services/adapters/index.js';
import {
  routeChatCompletion,
  streamChatCompletion,
  loadConfig,
  knownModels,
} from '../services/router.js';

const router = express.Router();

export { errorTypeFor, sendError } from '../http/errors.js';

// ---------------------------------------------------------- public error text

/**
 * Only errors this gateway constructs itself may carry their message to a
 * client. Anything else — a TypeError, a Node internal, a library error — is
 * replaced with a generic message, so neither internal detail nor upstream
 * text can escape through an unexpected failure.
 *
 * ProviderError messages are safe by construction: `adapters/common.js` builds
 * them exclusively from the provider name, a normalized status and a normalized
 * category, and never from an upstream body.
 */
function publicMessage(error, status) {
  if (error instanceof ProviderError && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return status >= 500 ? 'Internal server error.' : 'Request failed.';
}

// -------------------------------------------------------------- validation

const ALLOWED_ROLES = ['system', 'user', 'assistant', 'tool', 'function', 'developer'];

function checkNumber(errors, body, param, { min, max, integer = false } = {}) {
  const value = body[param];
  if (value === undefined || value === null) return;

  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push({ param, message: `"${param}" must be a number.` });
    return;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push({ param, message: `"${param}" must be an integer.` });
    return;
  }
  if (min !== undefined && value < min) {
    errors.push({ param, message: `"${param}" must be greater than or equal to ${min}.` });
    return;
  }
  if (max !== undefined && value > max) {
    errors.push({ param, message: `"${param}" must be less than or equal to ${max}.` });
  }
}

/**
 * Structural validation only — anything a provider might accept is left to the
 * provider. Numeric ranges mirror OpenAI's documented limits.
 *
 * @returns {Array<{param: string|null, message: string}>} empty when valid
 */
export function validateChatRequest(body) {
  const errors = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ param: null, message: 'Request body must be a JSON object.' }];
  }

  if (typeof body.model !== 'string' || !body.model.trim()) {
    errors.push({ param: 'model', message: '"model" is required and must be a non-empty string.' });
  }

  if (body.messages === undefined) {
    errors.push({ param: 'messages', message: '"messages" is required.' });
  } else if (!Array.isArray(body.messages)) {
    errors.push({ param: 'messages', message: '"messages" must be an array.' });
  } else if (body.messages.length === 0) {
    errors.push({ param: 'messages', message: '"messages" must contain at least one message.' });
  } else {
    body.messages.forEach((message, index) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        errors.push({ param: `messages[${index}]`, message: 'Each message must be an object.' });
        return;
      }
      if (!ALLOWED_ROLES.includes(message.role)) {
        errors.push({
          param: `messages[${index}].role`,
          message: `Unsupported role ${JSON.stringify(message.role)}. Expected one of: ${ALLOWED_ROLES.join(', ')}.`,
        });
      }
      if (message.content === undefined || message.content === null) {
        errors.push({ param: `messages[${index}].content`, message: 'Each message requires "content".' });
      } else if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
        errors.push({
          param: `messages[${index}].content`,
          message: '"content" must be a string or an array of content parts.',
        });
      }
    });
  }

  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    errors.push({ param: 'stream', message: '"stream" must be a boolean.' });
  }

  checkNumber(errors, body, 'temperature', { min: 0, max: 2 });
  checkNumber(errors, body, 'top_p', { min: 0, max: 1 });
  checkNumber(errors, body, 'max_tokens', { min: 1, integer: true });
  checkNumber(errors, body, 'n', { min: 1, integer: true });
  checkNumber(errors, body, 'presence_penalty', { min: -2, max: 2 });
  checkNumber(errors, body, 'frequency_penalty', { min: -2, max: 2 });

  return errors;
}

// ---------------------------------------------------------------- streaming

const DONE_FRAME = 'data: [DONE]\n\n';

/** Write one SSE frame, honouring backpressure so long streams don't balloon memory. */
async function writeFrame(res, payload) {
  const frame = typeof payload === 'string' ? payload : `data: ${JSON.stringify(payload)}\n\n`;
  if (res.write(frame)) return;
  await once(res, 'drain');
}

/**
 * The SSE response headers. Applied *lazily*, only once a provider has
 * actually committed, so a failure before that point leaves the response free
 * to be a normal JSON error with a meaningful status code.
 */
function setStreamingHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // ask intermediaries not to buffer SSE
}

/**
 * Server-Sent Events streaming.
 *
 * Frames are `data: <json>\n\n` followed by a final `data: [DONE]`, exactly as
 * the OpenAI API emits them, so existing SDK stream parsers work unchanged.
 *
 * Nothing is written or flushed until the first chunk arrives. Until then the
 * response can still choose its status line, so a request that fails across
 * every provider returns a real 429/404/400 JSON error rather than a 200
 * stream carrying an error object.
 */
async function handleStreaming(req, res, body) {
  const startedAt = Date.now();
  const controller = new AbortController();
  let meta = null;
  let usage = null;
  let recorded = false;
  const onResponseClose = () => {
    if (!res.writableFinished) controller.abort(new Error('client disconnected'));
  };
  res.on('close', onResponseClose);

  try {
    for await (const event of streamChatCompletion({ body, signal: controller.signal })) {
      // Routing metadata always arrives before the first chunk, so the
      // response is still uncommitted when these headers are set.
      if (event.type === 'meta') {
        meta = { ...event.meta, requestId: req.requestId };
        setStreamingHeaders(res);
        res.setHeader('x-vishrouter-provider', meta.provider);
        res.setHeader('x-vishrouter-upstream-model', meta.upstreamModel);
        res.setHeader('x-vishrouter-model-resolved-via', meta.modelResolvedVia);
        res.setHeader('x-vishrouter-fallback-used', String(meta.fallbackUsed));
        res.setHeader('x-vishrouter-attempts', String(meta.attemptCount));
        continue;
      }

      if (event.type === 'chunk') {
        // Defensive: a chunk should never precede its meta event.
        if (!res.headersSent) setStreamingHeaders(res);
        await writeFrame(res, event.chunk);
        if (event.chunk?.usage) usage = event.chunk.usage;
      }
    }

    // The router ends the generator on the upstream terminator; the client
    // still gets exactly one [DONE] regardless of provider dialect.
    await writeFrame(res, DONE_FRAME);
    res.end();
    req.app.locals.usageMeter.record({
      keyId: req.auth.keyId,
      ok: true,
      model: body.model,
      provider: meta?.provider,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      durationMs: Date.now() - startedAt,
      fallbackUsed: meta?.fallbackUsed,
    });
    recorded = true;
  } catch (error) {
    req.app.locals.usageMeter.record({
      keyId: req.auth.keyId,
      ok: false,
      model: body.model,
      provider: meta?.provider,
      durationMs: Date.now() - startedAt,
      fallbackUsed: meta?.fallbackUsed,
    });
    recorded = true;
    // Client already gone — there is no stream left to write to.
    if (res.destroyed || res.writableEnded) return;

    // Nothing written yet: a clean HTTP error is still possible.
    if (!res.headersSent) {
      const extra = {};
      if (error.attempts) extra.provider_attempts = error.attempts;
      sendError(res, {
        status: error.status ?? 502,
        message: publicMessage(error, error.status ?? 502),
        code: error.code ?? null,
        extra,
      });
      return;
    }

    // Mid-stream failure. The status line and earlier frames are already on the
    // wire, so the error has to travel *inside* the stream — and no failover is
    // possible here, because the router only fails over before a provider commits.
    res.write(
      `data: ${JSON.stringify({
        error: {
          // Stable and generic: once bytes are on the wire the client cannot be
          // failed over, and no upstream detail may be attached to the frame.
          message: 'The upstream stream failed before it completed.',
          type: errorTypeFor(error.status ?? 502),
          code: 'upstream_stream_error',
          param: null,
        },
      })}\n\n`
    );
    res.write(DONE_FRAME);
    res.end();
  } finally {
    if (!recorded && !res.writableFinished) {
      req.app.locals.usageMeter.record({
        keyId: req.auth.keyId,
        ok: false,
        model: body.model,
        provider: meta?.provider,
        durationMs: Date.now() - startedAt,
        fallbackUsed: meta?.fallbackUsed,
      });
    }
    res.off('close', onResponseClose);
  }
}

// ----------------------------------------------------------------- routes

router.post('/v1/chat/completions', async (req, res) => {
  const body = req.body ?? {};
  const startedAt = Date.now();

  // 1. Validate before touching any provider.
  const validationErrors = validateChatRequest(body);
  if (validationErrors.length > 0) {
    const [first, ...rest] = validationErrors;
    req.app.locals.usageMeter.record({
      keyId: req.auth.keyId,
      ok: false,
      model: typeof body.model === 'string' ? body.model : null,
      durationMs: Date.now() - startedAt,
    });
    return sendError(res, {
      status: 400,
      message: first.message,
      param: first.param,
      code: 'invalid_request',
      ...(rest.length ? { extra: { additional_errors: rest } } : {}),
    });
  }

  // 2. Streaming clients take the SSE path.
  if (body.stream === true) {
    return handleStreaming(req, res, body);
  }

  // 3. Abort the upstream call if the client goes away.
  //
  // Note: listen on the *response*, not the request. `req.on('close')` fires as
  // soon as the request body has been fully received — which is immediately
  // after body parsing here — so it would abort every upstream call the moment
  // it started. `res.on('close')` fires when the response finishes (normal
  // completion, writableFinished === true) or when the socket dies early.
  const controller = new AbortController();
  const onResponseClose = () => {
    if (!res.writableFinished) controller.abort(new Error('client disconnected'));
  };
  res.on('close', onResponseClose);

  try {
    const { response, meta: routerMeta } = await routeChatCompletion({ body, signal: controller.signal });
    const meta = { ...routerMeta, requestId: req.requestId };

    res.setHeader('x-vishrouter-provider', meta.provider);
    res.setHeader('x-vishrouter-upstream-model', meta.upstreamModel);
    res.setHeader('x-vishrouter-model-resolved-via', meta.modelResolvedVia);
    res.setHeader('x-vishrouter-fallback-used', String(meta.fallbackUsed));
    res.setHeader('x-vishrouter-attempts', String(meta.attemptCount));

    res.json({ ...response, x_vishrouter: meta });
    req.app.locals.usageMeter.record({
      keyId: req.auth.keyId,
      ok: true,
      model: body.model,
      provider: meta.provider,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      durationMs: Date.now() - startedAt,
      fallbackUsed: meta.fallbackUsed,
    });
  } catch (error) {
    // Router errors already carry a status and a stable `code`; anything
    // unexpected degrades to a 502 rather than leaking a stack trace.
    const extra = {};
    if (error.attempts) extra.provider_attempts = error.attempts;
    if (error.knownModels) extra.known_models = error.knownModels;

    sendError(res, {
      status: error.status ?? 502,
      message: publicMessage(error, error.status ?? 502),
      code: error.code ?? null,
      extra,
    });
    req.app.locals.usageMeter.record({
      keyId: req.auth.keyId,
      ok: false,
      model: body.model,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    res.off('close', onResponseClose);
  }
});

router.get('/v1/usage', (req, res) => {
  res.json({
    object: 'usage.summary',
    data: req.app.locals.usageMeter.snapshot(req.auth.keyId),
  });
});

router.get('/v1/models', (req, res) => {
  const config = loadConfig();
  const created = Math.floor(Date.now() / 1000);

  res.json({
    object: 'list',
    data: knownModels(config).map((id) => ({
      id,
      object: 'model',
      created,
      owned_by: 'vish-router',
    })),
  });
});

export default router;
