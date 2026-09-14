# VishRouter Product Requirements Document

**Version:** 2.0  
**Status:** MVP feature-complete; production hardening in progress  
**Product:** Provider-neutral AI inference gateway and control plane

## 1. Vision

VishRouter gives developers one OpenAI-compatible API key and endpoint for multiple AI providers. It separates model selection from provider selection, applies an explicit routing policy, fails over safely, and explains every routing decision.

VishRouter is an independent implementation informed by the product mechanics of multi-provider gateways. It must not copy proprietary code or incorporate source with incompatible licensing.

## 2. Goals

- One stable, OpenAI-compatible API surface.
- Provider-neutral adapters and canonical model identifiers.
- Safe provider failover and explicit model fallback.
- Cost-, latency-, health-, and capability-aware routing.
- Client API keys, quotas, budgets, metering, and auditability.
- Streaming parity with non-streaming requests.
- A developer dashboard for keys, usage, routing traces, and provider health.
- A small high-quality provider set before broad catalogue expansion.

## 3. Non-goals for V1

- Supporting hundreds of providers before the adapter contract is stable.
- Payments, subscriptions, or reseller credits before durable metering exists.
- Training or hosting foundation models.
- Copying OpenRouter or UnoRouter UI, branding, source code, or private behavior.
- Using DeepSeek Harness as a production runtime dependency.

## 4. Target users

- Solo developers who want one endpoint for several providers.
- Small teams that need failover, spend control, and observability.
- AI application teams that want BYOK and deterministic routing policies.
- Platform engineers who need an internal inference control plane.

## 5. Primary journeys

1. A developer creates a VishRouter key and uses it with an OpenAI SDK.
2. The gateway authenticates the key, checks quota, and validates the request.
3. The model router identifies eligible models from required capabilities.
4. The provider router scores healthy upstreams using the selected policy.
5. The request executes; retry and fallback obey an explicit retry budget.
6. Tokens, latency, cost, errors, and the routing trace are recorded.
7. The developer inspects usage and health in the dashboard.

## 6. Functional requirements

### Gateway surface

- `POST /v1/chat/completions`: streaming and non-streaming chat completions.
- `GET /v1/models`: canonical model catalogue.
- `GET /v1/usage`: authenticated usage summary for the calling key.
- `GET /health`: current combined process/provider readiness endpoint.
- Future: `/livez` and `/readyz`, embeddings, responses API, key management.

### Authentication and quotas

- Chat and usage endpoints require a VishRouter bearer key by default.
- Raw client keys must never be returned, logged, or stored in application data.
- Rate limiting is per key. Multi-instance deployments must use a shared store.
- A key will eventually support budgets, scopes, expiry, revocation, and rotation.

### Routing

- Model selection and provider selection are separate decisions.
- Provider eligibility must consider capabilities before cost or latency.
- Failover can only occur before the first streamed response byte.
- Retry decisions must distinguish caller errors from transient upstream errors.
- Every completed request exposes a stable request ID and routing metadata.

### Metering

- Record request result, model, provider, tokens, latency, and fallback state.
- Current in-memory metering is an intentional first slice, not durable billing data.
- Durable metering must be idempotent and keyed by request ID.
- Pricing must come from one versioned registry.

## 7. Non-functional requirements

| Requirement | V1 target |
|---|---:|
| Gateway overhead, P95 excluding upstream | < 50 ms |
| Routing decision time, P95 | < 10 ms |
| Request trace coverage | 100% |
| Auth coverage on inference endpoints | 100% |
| Availability target | 99.9% |
| Duplicate billable usage events | 0 |
| Secret values in logs | 0 |
| Graceful shutdown | Stop admission, drain, then force close |

## 8. Current implementation

Implemented and verified:

- OpenAI-compatible chat completions.
- OpenAI-compatible and Anthropic adapter families.
- Model equivalence and ordered provider fallback.
- SSE translation, backpressure, disconnect aborts, and idle timeouts.
- Request validation, body limits, canonical errors, CORS metadata exposure.
- Client API-key authentication with hashed in-process comparison.
- Per-key fixed-window rate limiting for a single process.
- Stable request IDs.
- Per-key in-memory usage summaries.
- React dashboard with model library, chat, rankings, pricing, and docs.
- Session-only dashboard API-key connection.
- Offline end-to-end smoke suite and frontend CI checks.

Not yet production-complete:

- Durable users, organizations, keys, usage ledger, quotas, and budgets.
- Distributed rate limiting.
- Circuit breakers, retry budgets, backoff, and jitter.
- Canonical capability registry and two-stage smart router.
- Central pricing/cost calculation.
- Persistent routing traces and analytics UI.
- Provider benchmarks and model authenticity verification.

## 9. Acceptance criteria for the production-gateway milestone

- A revoked or invalid key cannot invoke an upstream provider.
- Concurrent gateway instances enforce the same quota and rate-limit state.
- Each request produces one idempotent usage and routing trace record.
- Streaming and non-streaming token accounting reconcile with provider reports.
- Provider outages cannot create unbounded retry amplification.
- The dashboard can create/revoke keys and inspect usage without exposing secrets.
- CI covers authentication, rate limits, disconnects, retries, fallback, and metering.

## 10. Success metrics

- Successful request rate and fallback recovery rate.
- Provider error/429 rate.
- P50/P95 time to first token and total latency.
- Cost per million routed tokens and savings against fixed-provider routing.
- Metering reconciliation error rate.
- Weekly active API keys and retained developers.
