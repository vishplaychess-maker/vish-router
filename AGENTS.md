# Agent Instructions for VishRouter

These rules apply to Codex, DeepSeek Harness, and other coding agents working in this repository.

## Mission

Build VishRouter as an independently implemented, provider-neutral AI inference control plane. DeepSeek Harness is a development tool only and must never become a production runtime dependency.

## Required workflow

1. Read `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, and `ROADMAP.md` before changing code.
2. Inspect the current code and tests; do not trust status claims without verification.
3. Work on one roadmap slice at a time with explicit acceptance criteria.
4. Reuse existing routing, adapter, error, streaming, and test primitives.
5. Add or update tests in the same change as behavior.
6. Run `npm test` and `cd frontend && npm run lint && npm run build` before handoff.
7. Report files changed, tests run, limitations, and the next gated slice.

## Architectural constraints

- Keep model routing separate from provider routing.
- Keep provider wire translation inside adapters.
- Do not add provider-specific conditionals to generic routing code.
- Never fail over after the first downstream stream byte.
- Every billable request must have a stable request ID.
- Durable usage writes must be idempotent.
- Default to denying requests when auth, budget, or tenant identity is ambiguous.
- Do not add billing before durable metering and reconciliation exist.

## Security constraints

- Never print, commit, return, or persist raw client/provider secrets.
- Do not weaken authentication or rate limits to make tests pass.
- CORS is not an authentication control.
- Validate configuration at startup and fail closed on unsafe production settings.
- Public error envelopes must not expose stacks, secrets, or raw upstream payloads.

## Scope and quality

- Do not attempt an entire OpenRouter clone in one task.
- Prefer five production-quality providers and a small verified model catalogue.
- Treat OpenRouter and UnoRouter as behavior references, not code sources.
- Before copying any external code, verify its license and compatibility.
- Avoid migrations or public API changes without an explicit rollback path.

## Completion format

Return:

1. `READY FOR USER REVIEW` or a precise blocker.
2. Roadmap slice completed.
3. Behavior and security changes.
4. Tests and exact results.
5. Remaining limitations and next recommended slice.
