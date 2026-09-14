# VishRouter Security Baseline

## Current controls

- Client bearer authentication is required by default.
- Client secrets are hashed before comparison and compared with constant-time primitives.
- Provider secrets are read from environment variables and are never returned to clients.
- Inference rate limits are isolated by VishRouter key ID.
- Invalid/missing keys are rejected before JSON body parsing or upstream calls.
- Request bodies have a configurable size limit.
- Internal stacks are not returned on server errors.
- CORS is treated as browser policy, not authentication.
- Request IDs are generated server-side and are safe to use as future ledger keys.
- Dashboard keys use `sessionStorage`; they are not embedded at build time or placed in `localStorage`.

## Configuration

Production-safe defaults:

```dotenv
VISHROUTER_AUTH_MODE=required
VISHROUTER_API_KEYS=local:<at-least-24-character-random-secret>
RATE_LIMIT_REQUESTS_PER_MINUTE=60
```

Generate a development key with `openssl rand -hex 32`. Multiple entries use `id:key,id2:key2`. Never commit `.env`.

`VISHROUTER_AUTH_MODE=disabled` is only for isolated local debugging. The process emits a warning; it must not be exposed to a network.

## Threats and required mitigations

| Threat | Current state | Required production control |
|---|---|---|
| Stolen client key | Manual env rotation | Hashed DB records, prefix lookup, expiry, revoke, scopes |
| Upstream cost abuse | Per-process request limit | Distributed token/request limits and hard budgets |
| Retry amplification | Ordered fallback | Retry budget, `Retry-After`, backoff, jitter, circuit breakers |
| Slow/long streams | Abort + idle timeout | Concurrent-stream quotas and proxy timeout policy |
| Metering loss | In-memory totals | Durable idempotent usage ledger and reconciliation |
| Secret leakage | Env + error sanitization | Secret manager, log redaction tests, restricted admin access |
| Cross-tenant access | One key ID boundary | Organization authorization and row-level policies |
| Malicious payload | Structural validation + size limit | Full schemas, content-part limits, tool/schema depth limits |
| SSRF by provider config | Static trusted config | Admin validation and outbound allowlist |

## Key storage rules

- Display a newly created raw key exactly once.
- Store only a keyed hash or strong password-style verifier plus a non-secret lookup prefix.
- Never log authorization headers, raw provider credentials, or raw client keys.
- Rotation must allow short overlap without changing usage ownership.
- BYOK credentials require envelope encryption with a managed key.

## Disclosure

Until a dedicated security contact exists, report vulnerabilities privately to the repository owner. Do not open a public issue containing a secret, exploit, or customer data.
