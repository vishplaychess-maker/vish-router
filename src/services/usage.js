/**
 * Single-process usage ledger for the production-gateway first slice.
 * A persistent Postgres implementation can replace this service without
 * changing the route contract.
 */
export class UsageMeter {
  constructor() {
    this.byKey = new Map();
  }

  record({
    keyId,
    ok,
    model = null,
    provider = null,
    promptTokens = 0,
    completionTokens = 0,
    durationMs = 0,
    fallbackUsed = false,
  }) {
    const current = this.byKey.get(keyId) ?? {
      requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      fallback_requests: 0,
      total_duration_ms: 0,
      models: {},
      providers: {},
      last_request_at: null,
    };

    current.requests += 1;
    current.successful_requests += ok ? 1 : 0;
    current.failed_requests += ok ? 0 : 1;
    current.prompt_tokens += Number(promptTokens) || 0;
    current.completion_tokens += Number(completionTokens) || 0;
    current.total_tokens += (Number(promptTokens) || 0) + (Number(completionTokens) || 0);
    current.fallback_requests += fallbackUsed ? 1 : 0;
    current.total_duration_ms += Math.max(0, Number(durationMs) || 0);
    if (model) current.models[model] = (current.models[model] ?? 0) + 1;
    if (provider) current.providers[provider] = (current.providers[provider] ?? 0) + 1;
    current.last_request_at = new Date().toISOString();

    this.byKey.set(keyId, current);
  }

  snapshot(keyId) {
    const current = this.byKey.get(keyId) ?? {
      requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      fallback_requests: 0,
      total_duration_ms: 0,
      models: {},
      providers: {},
      last_request_at: null,
    };

    return {
      key_id: keyId,
      ...structuredClone(current),
      average_duration_ms:
        current.requests === 0 ? 0 : Math.round(current.total_duration_ms / current.requests),
      persistence: 'memory',
    };
  }
}
