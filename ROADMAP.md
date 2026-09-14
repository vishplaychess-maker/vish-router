# VishRouter Roadmap

## Phase 0 — Baseline and contracts

Status: **complete**

- Repository audit and verified baseline.
- Master PRD, architecture, security baseline, roadmap, and agent rules.
- MVP labeled accurately as feature-complete, not production-complete.

## Phase 1A — Single-instance production gateway

Status: **complete**

- Client API-key admission.
- Per-key request rate limits.
- Request IDs.
- Per-key in-memory usage summary.
- Dashboard session-only API-key connection.
- End-to-end security and quota tests.

## Phase 1B — Durable control plane

Status: **next**

- Postgres schema for users, organizations, memberships, keys, and policies.
- Store key verifiers, prefixes, scopes, expiry, last-use time, and revocation.
- Durable idempotent usage and provider-attempt ledger.
- Distributed request/token rate limits.
- Monthly budgets and atomic budget reservation/release.
- Key create/list/revoke API and dashboard.

Exit gate: two gateway instances enforce identical auth, quota, and usage state.

## Phase 2 — Resilient provider execution

- Circuit breaker per provider/model/region.
- Retry budgets, exponential backoff, jitter, and `Retry-After` support.
- Separate `/livez` and `/readyz`.
- Structured JSON logs and persistent request traces.
- Maximum concurrent streams per key.

Exit gate: outage load tests show bounded upstream amplification.

## Phase 3 — Canonical model and capability registry

- Provider-qualified model IDs.
- Capability metadata for text, vision, tools, JSON, reasoning, and streaming.
- Context limits, pricing versions, status, and deprecation dates.
- Compatibility aliases without ambiguous primary prefix matching.

Exit gate: incapable providers are never selected for a request.

## Phase 4 — Smart Router v1

- Virtual models: auto, cheap, fast, best, coding, and reasoning.
- Separate model and provider selection.
- Health gates and normalized price/latency/reliability scores.
- Deterministic policy version recorded on each trace.

Exit gate: replay tests reproduce the same routing decision from the same snapshot.

## Phase 5 — Analytics and provider intelligence

- Requests, tokens, spend, success, fallback, TTFT, P50/P95 latency.
- Health scores from real traffic plus synthetic probes.
- Cost/model/provider dashboards and budget alerts.
- Provider comparison and routing-policy simulator.

## Phase 6 — VishVerify

- Identity and response-shape probes.
- Tool, JSON, structured-output, context, streaming, and accounting checks.
- Verified, partially verified, degraded, and unverified states.

## Deferred until metering is trusted

- Central credits, subscriptions, payments, and reseller billing.
- Hundreds of providers/models.
- Enterprise SSO and complex team administration.
