/**
 * Shared helpers for provider adapters.
 *
 * Everything here is provider-neutral: error typing, URL/time helpers and the
 * retryability policy that the router (Task 4) consults when deciding whether
 * to fall back to the next provider.
 */

/** Normalized error every adapter throws, carrying the facts the router needs. */
export class ProviderError extends Error {
  constructor(message, { provider = null, status = null, retryable = false, upstream = null, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;       // HTTP status, or null for network/timeout failures
    this.retryable = retryable; // should the router try the next provider?
    this.upstream = upstream;   // truncated raw upstream body, for debugging
    if (cause) this.cause = cause;
  }
}

/** Unix seconds — the `created` field used across OpenAI-compatible payloads. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Strip trailing slashes so `baseUrl + path` never produces a double slash. */
export const trimSlash = (value = '') => value.replace(/\/+$/, '');

/**
 * Fallback policy. A missing status means a transport-level failure
 * (DNS, refused connection, abort/timeout) — governed by `networkErrors`.
 * Any 5xx is retryable regardless of the configured list; other statuses
 * (429, 408, 529, ...) follow `fallbackOn.statuses` from providers.json.
 */
export function isRetryableStatus(status, fallbackOn) {
  if (status === null || status === undefined) return fallbackOn?.networkErrors !== false;
  if (status >= 500) return true;
  return (fallbackOn?.statuses ?? []).includes(status);
}

/** Pull a human-readable message out of an arbitrary upstream error body. */
export function extractErrorMessage(bodyText) {
  if (!bodyText) return null;
  try {
    const json = JSON.parse(bodyText);
    return json?.error?.message ?? json?.error?.type ?? json?.message ?? json?.detail ?? null;
  } catch {
    return bodyText.slice(0, 300);
  }
}

/** Build a ProviderError from a non-2xx HTTP response. */
export function providerErrorFromResponse({ provider, status, bodyText, fallbackOn }) {
  const detail = extractErrorMessage(bodyText) ?? `HTTP ${status}`;
  return new ProviderError(`${provider}: upstream returned ${status} — ${detail}`, {
    provider,
    status,
    retryable: isRetryableStatus(status, fallbackOn),
    upstream: bodyText ? bodyText.slice(0, 2000) : null,
  });
}

/** Build a ProviderError from a thrown fetch/timeout failure. */
export function providerErrorFromNetwork({ provider, error }) {
  return new ProviderError(`${provider}: network or timeout failure — ${error?.message ?? error}`, {
    provider,
    status: null,
    retryable: true,
    cause: error,
  });
}
