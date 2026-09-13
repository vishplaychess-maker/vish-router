/**
 * VishRouter — entry point.
 *
 * Boots an Express app that exposes one OpenAI-compatible endpoint and routes
 * to OpenAI / Anthropic / DeepSeek with automatic failover.
 *
 *   POST /v1/chat/completions   chat (streaming and non-streaming)
 *   GET  /v1/models             requestable models
 *   GET  /health                liveness + provider readiness
 *
 * Startup fails fast on a broken registry rather than at the first request.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import chatRouter, { sendError } from './routes/chat.js';
import { loadConfig, listProviders, knownModels } from './services/router.js';
import { getAdapter } from './services/adapters/index.js';

dotenv.config({ quiet: true });

// ------------------------------------------------------------------ logging

const LEVELS = { silent: 0, info: 1, debug: 2 };
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const threshold = LEVELS[LOG_LEVEL] ?? LEVELS.info;

const log = {
  info: (message) => threshold >= LEVELS.info && console.log(`[vish-router] ${message}`),
  warn: (message) => threshold >= LEVELS.info && console.warn(`[vish-router] WARN ${message}`),
  error: (message) => threshold >= LEVELS.info && console.error(`[vish-router] ERROR ${message}`),
  debug: (message) => threshold >= LEVELS.debug && console.log(`[vish-router] ${message}`),
};

// ------------------------------------------------------- startup validation

const REQUIRED_PROVIDER_FIELDS = [
  'adapter',
  'baseUrl',
  'path',
  'apiKeyEnv',
  'auth',
  'defaultModel',
  'models',
];

/**
 * Check the registry *before* binding a port.
 *
 * Errors are fatal (the gateway could not work); warnings are not (a provider
 * without a key is simply not a candidate, which is a valid local setup as
 * long as at least one other provider has one).
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateStartupConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { errors: ['providers.json must contain a JSON object'], warnings };
  }

  const providers = config.providers;
  if (!providers || typeof providers !== 'object' || Object.keys(providers).length === 0) {
    return { errors: ['"providers" must define at least one provider'], warnings };
  }

  for (const [name, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') {
      errors.push(`provider "${name}" must be an object`);
      continue;
    }

    const missing = REQUIRED_PROVIDER_FIELDS.filter((field) => provider[field] === undefined);
    if (missing.length > 0) {
      errors.push(`provider "${name}" is missing required field(s): ${missing.join(', ')}`);
      continue;
    }

    try {
      getAdapter(provider.adapter);
    } catch (error) {
      errors.push(`provider "${name}": ${error.message}`);
    }

    if (!/^https?:\/\//.test(String(provider.baseUrl))) {
      errors.push(`provider "${name}": baseUrl must start with http:// or https://`);
    }

    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      errors.push(`provider "${name}": "models" must list at least one model`);
    } else if (!provider.models.includes(provider.defaultModel)) {
      errors.push(
        `provider "${name}": defaultModel "${provider.defaultModel}" is not listed in models[]`
      );
    }

    if (provider.enabled !== false && !String(process.env[provider.apiKeyEnv] ?? '').trim()) {
      warnings.push(
        `provider "${name}" is enabled but ${provider.apiKeyEnv} is empty — it will be skipped`
      );
    }
  }

  if (!Array.isArray(config.fallbackOrder) || config.fallbackOrder.length === 0) {
    errors.push('"fallbackOrder" must be a non-empty array');
  } else {
    for (const name of config.fallbackOrder) {
      if (!providers[name]) {
        errors.push(`fallbackOrder names "${name}", which has no provider definition`);
      }
    }
  }

  // A registry with no usable key is *not* fatal: the process still boots so it
  // can be inspected, /health reports "degraded" with a 503, and the banner
  // names the missing variables. Only structural problems stop the boot.
  if (errors.length === 0) {
    const usable = listProviders(config).filter((provider) => provider.available);
    if (usable.length === 0) {
      warnings.push(
        'no provider has an API key — every request will fail until one is set in .env (/health reports "degraded")'
      );
    }
  }

  return { errors, warnings };
}

// ------------------------------------------------------------------- routes

function healthHandler(req, res) {
  const config = loadConfig();
  const providers = listProviders(config);
  const available = providers.filter((provider) => provider.available);

  // 503 when nothing can be served, so an orchestrator's readiness probe fails
  // even though the process itself is healthy.
  const status = available.length > 0 ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    uptime_seconds: Number(process.uptime().toFixed(1)),
    available_providers: available.length,
    total_providers: providers.length,
    known_models: knownModels(config).length,
    fallback_order: config.fallbackOrder ?? [],
    providers: providers.map((provider) => ({
      name: provider.name,
      available: provider.available,
      adapter: provider.adapter,
      key_env: provider.keyEnv,
      default_model: provider.defaultModel,
      models: provider.models.length,
    })),
  });
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    log.debug(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
}

function notFoundHandler(req, res) {
  sendError(res, {
    status: 404,
    message: `Unknown endpoint: ${req.method} ${req.path}`,
    code: 'unknown_endpoint',
  });
}

/**
 * Terminal error handler. Express only routes here when nothing upstream
 * responded, so `headersSent` means a stream died partway and we can only
 * close the socket.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    log.error(`error after response started on ${req.method} ${req.originalUrl}: ${error?.message}`);
    return res.end();
  }

  // body-parser failures carry a `type`; surface them as proper 400/413s.
  if (error?.type === 'entity.parse.failed') {
    return sendError(res, {
      status: 400,
      message: `Invalid JSON in request body: ${error.message}`,
      code: 'invalid_json',
    });
  }

  if (error?.type === 'entity.too.large') {
    return sendError(res, {
      status: 413,
      message: 'Request body is too large.',
      code: 'payload_too_large',
    });
  }

  const status = error?.status ?? error?.statusCode ?? 500;
  if (status >= 500) log.error(`unhandled error on ${req.method} ${req.originalUrl}: ${error?.stack ?? error}`);

  return sendError(res, {
    status,
    // Never leak internals on a 5xx.
    message: status >= 500 ? 'Internal server error.' : error?.message ?? 'Request failed.',
    code: error?.code ?? 'internal_error',
  });
}

/**
 * Origins allowed to call the gateway from a browser. Defaults cover the Vite
 * dev server; override with a comma-separated CORS_ORIGIN for anything else.
 */
function allowedOrigins() {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    cors({
      origin: allowedOrigins(),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      // Without this the browser hides our routing metadata from frontend JS —
      // the dashboard reads these to show which provider served a message.
      exposedHeaders: [
        'x-vishrouter-provider',
        'x-vishrouter-upstream-model',
        'x-vishrouter-model-resolved-via',
        'x-vishrouter-fallback-used',
        'x-vishrouter-attempts',
      ],
      maxAge: 86_400,
    })
  );

  app.use(express.json({ limit: process.env.MAX_BODY_SIZE ?? '1mb' }));

  if (threshold >= LEVELS.debug) app.use(requestLogger);

  app.get('/health', healthHandler);
  app.use(chatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// -------------------------------------------------------- graceful shutdown

/**
 * Close the server on SIGINT/SIGTERM: stop accepting connections, let
 * in-flight requests finish, then force-destroy anything still open.
 *
 * `exit` is injectable so the shutdown path can be exercised in-process by a
 * test (on Windows a real SIGTERM cannot be delivered to a handler).
 */
export function installShutdownHandlers(server, { exit = (code) => process.exit(code) } = {}) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return; // a second Ctrl+C must not re-enter
    shuttingDown = true;

    const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
    log.info(`${signal} received — draining in-flight requests (timeout ${timeoutMs}ms)`);

    // Idle keep-alive sockets would otherwise hold the server open.
    server.closeIdleConnections?.();

    const forceTimer = setTimeout(() => {
      log.warn(`in-flight requests did not finish within ${timeoutMs}ms — forcing close`);
      for (const socket of sockets) socket.destroy();
      exit(0);
    }, timeoutMs);
    forceTimer.unref();

    server.close((error) => {
      clearTimeout(forceTimer);
      if (error) {
        log.error(`shutdown failed: ${error.message}`);
        return exit(1);
      }
      log.info('shutdown complete');
      return exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason?.stack ?? reason}`);
  });

  process.on('uncaughtException', (error) => {
    log.error(`uncaught exception: ${error?.stack ?? error}`);
    exit(1);
  });

  return shutdown;
}

// ---------------------------------------------------------------------- boot

export function start() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    log.error(`could not read providers.json: ${error.message}`);
    process.exit(1);
  }

  const { errors, warnings } = validateStartupConfig(config);
  for (const warning of warnings) log.warn(warning);

  if (errors.length > 0) {
    for (const error of errors) log.error(error);
    log.error('refusing to start — fix config/providers.json');
    process.exit(1);
  }

  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';

  const server = app.listen(port, host, () => {
    const providers = listProviders(config);
    // Report the bound port rather than the requested one, so PORT=0 (or any
    // other OS-assigned port) logs a URL that is actually reachable.
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    log.info(`listening on http://${host}:${boundPort}`);
    log.info(
      `providers: ${providers
        .map((provider) => `${provider.name}${provider.available ? '' : ' (no key)'}`)
        .join(', ')}`
    );
    log.info(
      `${knownModels(config).length} known models | failover: ${
        (config.fallbackOrder ?? []).join(' -> ')
      }`
    );
    log.info('endpoints: POST /v1/chat/completions, GET /v1/models, GET /health');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') log.error(`port ${port} is already in use`);
    else log.error(`server error: ${error.message}`);
    process.exit(1);
  });

  installShutdownHandlers(server);
  return server;
}

// Only boot when executed directly, so importing this module (tests, tooling)
// has no side effects.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) start();
