# VishRouter

A lightweight AI gateway. It exposes **one OpenAI-compatible endpoint** and routes each request to
OpenAI, Anthropic, or DeepSeek — translating between wire formats and failing over automatically when
a provider is rate-limited or down.

```
client ──► POST /v1/chat/completions ──► router ──► openai     (primary)
                                                    deepseek   (fallback)
                                                    anthropic  (fallback)
```

## Quick start

```bash
npm install
cp .env.example .env      # then put at least one real API key in .env
npm start
```

The gateway refuses to start only if `config/providers.json` is structurally broken. With no keys it
still boots, warns loudly, and reports `degraded` on `/health`.

```bash
npm run smoke             # full end-to-end test — mock providers, no keys, no network
npm run smoke:live        # test against the real providers you have keys for
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completion (streaming and non-streaming) |
| `GET` | `/v1/models` | Models a client may request |
| `GET` | `/health` | Liveness plus per-provider readiness |

### Request

```json
{
  "model": "gpt-3.5-turbo",
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7,
  "max_tokens": 256,
  "stream": false
}
```

### Non-streaming

```bash
curl -s http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello"}]}'
```

### Streaming (SSE)

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

```
data: {"id":"...","object":"chat.completion.chunk","model":"gpt-3.5-turbo","choices":[{"delta":{"content":"Hi"}}]}

data: [DONE]
```

The exact OpenAI wire format is preserved, so existing SDKs work unchanged — point `baseURL` at this
gateway:

```js
import OpenAI from 'openai';

const client = new OpenAI({ baseURL: 'http://127.0.0.1:3000/v1', apiKey: 'unused' });
const stream = await client.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
```

## Configuration — `config/providers.json`

```jsonc
{
  "defaults": {
    "timeoutMs": 60000,               // connect + time-to-first-byte per attempt
    "streamTimeoutMs": 120000,        // idle guard between stream chunks
    "maxTokensWhenUnspecified": 4096, // Anthropic requires max_tokens
    "allowCrossProviderFallback": true,
    "fallbackOn": {
      "statuses": [408, 409, 429, 500, 502, 503, 504, 529],
      "networkErrors": true,
      "timeouts": true
    }
  },

  "providers": {
    "openai": {
      "enabled": true,
      "label": "OpenAI",
      "adapter": "openai-compatible",  // or "anthropic"
      "baseUrl": "https://api.openai.com/v1",
      "path": "/chat/completions",     // Anthropic uses /messages
      "apiKeyEnv": "OPENAI_API_KEY",   // empty/missing => provider skipped
      "auth": { "type": "bearer" },    // or "x-api-key" for Anthropic
      "headers": {},                   // e.g. anthropic-version
      "defaultModel": "gpt-4o-mini",   // last-resort model on failover
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
      "modelPrefixes": ["gpt-", "o1", "o3"],
      "timeoutMs": 60000
    }
  },

  "modelEquivalents": {
    "gpt-3.5-turbo": {
      "openai": "gpt-3.5-turbo",
      "deepseek": "deepseek-chat",
      "anthropic": "claude-3-5-haiku-20241022"
    }
  },

  "fallbackOrder": ["openai", "deepseek", "anthropic"]
}
```

### How a model is chosen per provider

When the router sends a request to a provider, the model name is resolved in this order:

1. **native** — the provider serves that exact model ID
2. **native-prefix** — the provider serves that model family (`claude-*`, `gpt-*`, …)
3. **equivalence** — `modelEquivalents[requested][provider]` names the capability twin
4. **provider-default** — that provider's `defaultModel`

This is what makes failover actually work: a request for `gpt-3.5-turbo` that falls over to DeepSeek
is sent as `deepseek-chat`, not as a model DeepSeek has never heard of. The client still receives
`"model": "gpt-3.5-turbo"`, so the substitution is invisible.

### Failover policy

An attempt is retried on the next provider when it fails with a configured status (429, 5xx, 408,
409, 529), a network error, or a timeout. **Client errors such as `400` are not retried** — the
request is malformed and would fail everywhere, so the error is returned immediately instead of
burning another provider's latency.

When `allowCrossProviderFallback` is `false`, a request whose native provider is unavailable returns
`503 provider_unavailable` instead of being silently served by a different provider.

## Response metadata

Every response says which provider actually served it, as headers:

| Header | Example |
|---|---|
| `x-vishrouter-provider` | `deepseek` |
| `x-vishrouter-upstream-model` | `deepseek-chat` |
| `x-vishrouter-model-resolved-via` | `equivalence` |
| `x-vishrouter-fallback-used` | `true` |
| `x-vishrouter-attempts` | `2` |

Non-streaming responses additionally carry an `x_vishrouter` object with the same detail plus a
per-attempt record (provider, status, error, retryable, duration).

## Error responses

All failures use the OpenAI envelope, so SDKs surface them correctly:

```json
{
  "error": {
    "message": "\"messages\" must contain at least one message.",
    "type": "invalid_request_error",
    "param": "messages",
    "code": "invalid_request"
  }
}
```

| Situation | Status | `code` |
|---|---|---|
| Validation failure | 400 | `invalid_request` |
| Malformed JSON body | 400 | `invalid_json` |
| Body over `MAX_BODY_SIZE` | 413 | `payload_too_large` |
| Unknown model | 404 | `model_not_found` |
| Unknown endpoint | 404 | `unknown_endpoint` |
| Every provider failed | last upstream status (e.g. 429) | `all_providers_failed` |
| No provider available | 503 | `no_provider_available` |

### Streaming failures

- **Before the first byte** — the response is still uncommitted, so you get a normal JSON error with
  a real status code (e.g. `429`). Failover happens transparently here.
- **After the first byte** — the status line is already sent, so the error travels *inside* the
  stream as an error frame followed by `[DONE]`. No failover is possible at this point.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `127.0.0.1` | Bind address (set `0.0.0.0` in containers) |
| `OPENAI_API_KEY` | — | Enables the OpenAI provider |
| `ANTHROPIC_API_KEY` | — | Enables the Anthropic provider |
| `DEEPSEEK_API_KEY` | — | Enables the DeepSeek provider |
| `LOG_LEVEL` | `info` | `silent` \| `info` \| `debug` (debug logs every request) |
| `MAX_BODY_SIZE` | `1mb` | Request body limit |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Grace period before in-flight requests are force-closed |
| `VISHROUTER_CONFIG` | `config/providers.json` | Alternate registry path |

## Testing

### Offline (default) — no keys, no network

```bash
npm run smoke
```

Boots the real gateway as a child process against throwaway mock providers and covers routing,
equivalence, single and double failover, streaming, mid-stream failure, and every error path.

### Against real providers

1. Put one or more keys in `.env`:
   ```
   DEEPSEEK_API_KEY=sk-...
   ```
2. Run the live check:

```bash
npm run smoke:live
```

It reads `/health`, then sends one minimal request (`max_tokens: 16`) to each provider that has a
key, plus one streaming request, reporting status and latency:

```
  configured providers: openai (no key), deepseek, anthropic (no key)
  PASS  deepseek: deepseek-chat responds
        -> served by deepseek in 812ms: "ok"
  PASS  deepseek: streaming works
```

Without any key it explains what to add and exits non-zero. Note the live check spends a small
amount of real credit.

### Manual check against a real key

```bash
npm start
curl -s http://127.0.0.1:3000/health | jq
curl -s http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Say ok"}]}' | jq
```

## Project structure

```
src/
  index.js                    entry point: app, error handling, health, shutdown
  routes/chat.js              POST /v1/chat/completions, GET /v1/models
  services/router.js          model matching, equivalence, failover loop
  services/adapters/
    index.js                  adapter registry
    common.js                 ProviderError, retryability policy
    openai.js                 OpenAI + DeepSeek (shared wire format)
    anthropic.js              Anthropic Messages API translation
config/providers.json         provider registry
test/smoke.mjs                end-to-end smoke test
.env                          API keys (git-ignored)
```

## Notes and limitations

- **Anthropic translation**: system messages are lifted to the top-level `system` field, consecutive
  same-role turns are coalesced, `stop` becomes `stop_sequences`, `max_tokens` is defaulted, and
  OpenAI-only parameters (`presence_penalty`, `frequency_penalty`, `seed`, `n`, `response_format`)
  are dropped because Anthropic rejects them. `usage.input_tokens/output_tokens` are mapped to
  `prompt_tokens/completion_tokens`.
- **Multimodal content** (content arrays) is flattened to text; image parts are not forwarded.
- **Usage chunks** are always requested upstream (`stream_options.include_usage`) and forwarded even
  if the client did not ask for them.
- **Retries are per-provider, not per-error**: each provider is attempted once per request, with no
  backoff. A `429` moves straight to the next provider rather than waiting.
- **No response caching, auth, or rate limiting** — this is the routing core, not a full proxy.
