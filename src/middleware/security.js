import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { sendError } from '../http/errors.js';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MIN_KEY_LENGTH = 24;

const hashKey = (value) => createHash('sha256').update(value).digest();

/**
 * Parse `VISHROUTER_API_KEYS=id:key,id2:key2` without retaining raw keys.
 * The returned map is keyed by a SHA-256 digest and only stores key IDs.
 */
export function parseApiKeys(value = process.env.VISHROUTER_API_KEYS ?? '') {
  const keys = new Map();
  const errors = [];

  for (const rawEntry of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = rawEntry.indexOf(':');
    const id = separator === -1 ? '' : rawEntry.slice(0, separator).trim();
    const key = separator === -1 ? '' : rawEntry.slice(separator + 1).trim();

    if (!KEY_ID_PATTERN.test(id)) {
      errors.push(`invalid API key id ${JSON.stringify(id)}; use 1-64 letters, digits, _ or -`);
      continue;
    }
    if (key.length < MIN_KEY_LENGTH) {
      errors.push(`API key "${id}" must be at least ${MIN_KEY_LENGTH} characters`);
      continue;
    }

    const digest = hashKey(key).toString('hex');
    if (keys.has(digest)) {
      errors.push(`API key "${id}" duplicates another configured secret`);
      continue;
    }
    keys.set(digest, id);
  }

  return { keys, errors };
}

export function securityConfig(env = process.env) {
  const authMode = (env.VISHROUTER_AUTH_MODE ?? 'required').toLowerCase();
  const parsed = parseApiKeys(env.VISHROUTER_API_KEYS ?? '');
  const rateLimit = Number(env.RATE_LIMIT_REQUESTS_PER_MINUTE ?? 60);

  return { authMode, rateLimit, ...parsed };
}

export function validateSecurityConfig(env = process.env) {
  const config = securityConfig(env);
  const errors = [...config.errors];
  const warnings = [];

  if (!['required', 'disabled'].includes(config.authMode)) {
    errors.push('VISHROUTER_AUTH_MODE must be "required" or "disabled"');
  }
  if (config.authMode === 'required' && config.keys.size === 0) {
    errors.push('VISHROUTER_AUTH_MODE is required but VISHROUTER_API_KEYS has no valid keys');
  }
  if (config.authMode === 'disabled') {
    warnings.push('client API-key authentication is disabled; do not expose this process publicly');
  }
  if (!Number.isInteger(config.rateLimit) || config.rateLimit < 0) {
    errors.push('RATE_LIMIT_REQUESTS_PER_MINUTE must be a non-negative integer');
  }
  if (config.rateLimit === 0) {
    warnings.push('per-key rate limiting is disabled');
  }

  return { ...config, errors, warnings };
}

export function createRequestContextMiddleware() {
  return (req, res, next) => {
    // Server-generated IDs remain globally unique and safe for future
    // idempotent usage records; caller IDs are not trusted as ledger keys.
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  };
}

export function createAuthMiddleware(config = securityConfig()) {
  return (req, res, next) => {
    if (config.authMode === 'disabled') {
      req.auth = { keyId: 'anonymous' };
      return next();
    }

    const authorization = req.get('authorization') ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const candidate = match?.[1]?.trim();

    if (!candidate) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="VishRouter"');
      return sendError(res, {
        status: 401,
        message: 'Missing VishRouter API key. Use Authorization: Bearer <key>.',
        code: 'invalid_api_key',
      });
    }

    const candidateHash = hashKey(candidate);
    let keyId = null;
    for (const [digest, id] of config.keys) {
      const configuredHash = Buffer.from(digest, 'hex');
      if (
        configuredHash.length === candidateHash.length &&
        timingSafeEqual(configuredHash, candidateHash)
      ) {
        keyId = id;
      }
    }

    if (!keyId) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="VishRouter"');
      return sendError(res, {
        status: 401,
        message: 'The supplied VishRouter API key is invalid.',
        code: 'invalid_api_key',
      });
    }

    req.auth = { keyId };
    return next();
  };
}

export function createRateLimitMiddleware({ limit = 60, windowMs = 60_000 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    if (limit === 0) return next();

    const now = Date.now();
    const keyId = req.auth?.keyId ?? 'anonymous';
    let bucket = buckets.get(keyId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(keyId, bucket);
    }

    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('x-ratelimit-limit-requests', String(limit));
    res.setHeader('x-ratelimit-reset-requests', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= limit) {
      res.setHeader('x-ratelimit-remaining-requests', '0');
      res.setHeader('Retry-After', String(resetSeconds));
      return sendError(res, {
        status: 429,
        message: `Rate limit exceeded. Retry in ${resetSeconds} seconds.`,
        code: 'rate_limit_exceeded',
      });
    }

    bucket.count += 1;
    res.setHeader('x-ratelimit-remaining-requests', String(Math.max(0, limit - bucket.count)));
    return next();
  };
}
