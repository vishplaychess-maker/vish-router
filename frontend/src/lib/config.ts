/**
 * Runtime configuration for the dashboard.
 *
 * The gateway defaults to the local backend; override it in `.env.local` with
 * `VITE_API_BASE_URL=https://gateway.example.com` without touching code.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000'
).replace(/\/+$/, '')

/** Response headers the gateway publishes about how a request was routed. */
export const ROUTING_HEADERS = {
  provider: 'x-vishrouter-provider',
  upstreamModel: 'x-vishrouter-upstream-model',
  modelResolvedVia: 'x-vishrouter-model-resolved-via',
  fallbackUsed: 'x-vishrouter-fallback-used',
  attempts: 'x-vishrouter-attempts',
} as const
