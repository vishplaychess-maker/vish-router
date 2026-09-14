/**
 * Shared helpers for provider adapters.
 *
 * Upstream responses are untrusted input. An upstream error body — and every
 * message string inside it — is internal data that must never reach a
 * VishRouter client. Only facts VishRouter derives for itself may appear in a
 * public error: the provider name, a normalized HTTP status, a normalized
 * category, whether the failure is retryable, and timing.
 *
 * Two rules keep that true by construction:
 *
 *   1. `ProviderError.message` is always assembled from those derived facts.
 *      Upstream text is never interpolated into it.
 *   2. Raw upstream bodies are not accepted or stored on the error object, so
 *      they cannot be serialized into a response or a log line by accident.
 */

/**
 * Stable, client-safe categories for upstream failures. These are the only
 * error identifiers clients ever see for upstream problems; they are a pure
 * function of the transport outcome, never of the untrusted response body.
 */
export const UPSTREAM_CODES = {
  RATE_LIMITED: 'upstream_rate_limited',
  UNAVAILABLE: 'upstream_unavailable',
  TIMEOUT: 'upstream_timeout',
  UNREACHABLE: 'upstream_unreachable',
  AUTH_FAILED: 'upstream_auth_failed',
  NOT_FOUND: 'upstream_not_found',
  REJECTED: 'upstream_rejected_request',
  INVALID_RESPONSE: 'upstream_invalid_response',
  STREAM_ERROR: 'upstream_stream_error',
  UNKNOWN: 'upstream_error',
};

/**
 * Map a transport/HTTP outcome onto a stable category.
 *
 * `transport` marks a failure with no HTTP status at all (DNS failure, refused
 * connection, abort). `timedOut` distinguishes a timeout from a plain
 * unreachable. Deliberately ignores any upstream-supplied `type` or `code`
 * field so an untrusted body cannot steer this value.
 */
export function normalizeUpstreamCode(status, { transport = false, timedOut = false } = {}) {
  if (timedOut) return UPSTREAM_CODES.TIMEOUT;
  if (transport || status === null || status === undefined) return UPSTREAM_CODES.UNREACHABLE;
  if (status === 401 || status === 403) return UPSTREAM_CODES.AUTH_FAILED;
  if (status === 404) return UPSTREAM_CODES.NOT_FOUND;
  if (status === 408) return UPSTREAM_CODES.TIMEOUT;
  if (status === 429) return UPSTREAM_CODES.RATE_LIMITED;
  if (status >= 500) return UPSTREAM_CODES.UNAVAILABLE;
  if (status >= 400) return UPSTREAM_CODES.REJECTED;
  return UPSTREAM_CODES.UNKNOWN;
}

/**
 * Normalized error every adapter throws, carrying only derived facts.
 *
 * Every field here is safe to expose to a client except `cause`, which holds
 * the original internal error for debugging and is never serialized.
 */
export class ProviderError extends Error {
  constructor(
    message,
    { provider = null, status = null, code = null, retryable = false, cause = null } = {}
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status; // HTTP status, or null for transport failures
    this.code = code; // stable category, safe to expose
    this.retryable = retryable; // should the router try the next provider?
    if (cause) this.cause = cause; // internal only; never serialized
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

/**
 * Build a ProviderError from a non-2xx HTTP response.
 *
 * Note the signature: the response body is deliberately *not* a parameter. The
 * caller may have to read it to drain the socket, but handing it to this
 * helper is what previously allowed upstream text into public errors.
 */
export function providerErrorFromResponse({ provider, status, fallbackOn }) {
  const code = normalizeUpstreamCode(status);
  return new ProviderError(`${provider} upstream returned HTTP ${status}.`, {
    provider,
    status,
    code,
    retryable: isRetryableStatus(status, fallbackOn),
  });
}

/**
 * Build a ProviderError from a thrown fetch/timeout failure.
 *
 * The underlying transport message is internal (it can name hosts, sockets, or
 * internals), so it is classified rather than echoed. It stays attached as
 * `cause` for server-side debugging.
 */
export function providerErrorFromNetwork({ provider, error }) {
  const message = String(error?.message ?? '');
  const timedOut = /timeout|timed out|abort/i.test(message);
  const code = normalizeUpstreamCode(null, { transport: true, timedOut });

  return new ProviderError(
    timedOut ? `${provider} upstream timed out.` : `${provider} upstream was unreachable.`,
    { provider, status: null, code, retryable: true, cause: error }
  );
}
