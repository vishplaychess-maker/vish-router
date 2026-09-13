/**
 * Local model metadata.
 *
 * The gateway's `GET /v1/models` is deliberately minimal — it returns only
 * `{ id, object, created, owned_by }` — because the routing core does not need
 * pricing or context windows. Everything the Model Library displays beyond the
 * id therefore comes from this catalogue.
 *
 * IMPORTANT: the prices and context windows below are representative
 * published figures kept as *sample* data so the table has something to show.
 * They are not fetched from any provider. The UI labels them as sample data.
 */

export type Modality = 'text' | 'image'
export type Provider = 'OpenAI' | 'Anthropic' | 'DeepSeek' | 'Unknown'
export type PricingTier = 'budget' | 'standard' | 'premium'

export interface ModelMeta {
  provider: Provider
  contextLength: number
  /** USD per 1M input tokens. */
  inputPrice: number
  /** USD per 1M output tokens. */
  outputPrice: number
  modalities: Modality[]
  tools: boolean
}

/** Row rendered by the table: API fields + catalogue metadata + sample stats. */
export interface ModelRow extends ModelMeta {
  id: string
  created: number
  /** Sample values — no uptime or usage telemetry source exists yet. */
  uptime: string
  weeklyTokens: number
}

const CATALOGUE: Record<string, ModelMeta> = {
  'gpt-4o': { provider: 'OpenAI', contextLength: 128_000, inputPrice: 2.5, outputPrice: 10, modalities: ['text', 'image'], tools: true },
  'gpt-4o-mini': { provider: 'OpenAI', contextLength: 128_000, inputPrice: 0.15, outputPrice: 0.6, modalities: ['text', 'image'], tools: true },
  'gpt-4-turbo': { provider: 'OpenAI', contextLength: 128_000, inputPrice: 10, outputPrice: 30, modalities: ['text', 'image'], tools: true },
  'gpt-3.5-turbo': { provider: 'OpenAI', contextLength: 16_385, inputPrice: 0.5, outputPrice: 1.5, modalities: ['text'], tools: true },

  'claude-3-5-sonnet-20241022': { provider: 'Anthropic', contextLength: 200_000, inputPrice: 3, outputPrice: 15, modalities: ['text', 'image'], tools: true },
  'claude-3-5-haiku-20241022': { provider: 'Anthropic', contextLength: 200_000, inputPrice: 0.8, outputPrice: 4, modalities: ['text', 'image'], tools: true },
  'claude-3-opus-20240229': { provider: 'Anthropic', contextLength: 200_000, inputPrice: 15, outputPrice: 75, modalities: ['text', 'image'], tools: true },

  'deepseek-chat': { provider: 'DeepSeek', contextLength: 64_000, inputPrice: 0.27, outputPrice: 1.1, modalities: ['text'], tools: true },
  'deepseek-reasoner': { provider: 'DeepSeek', contextLength: 64_000, inputPrice: 0.55, outputPrice: 2.19, modalities: ['text'], tools: false },
}

/**
 * Fallback for a model the catalogue has never heard of, so adding a provider
 * to `config/providers.json` degrades gracefully instead of rendering blank
 * cells. Inference is by id prefix, which mirrors the gateway's own routing.
 */
function inferMeta(id: string): ModelMeta {
  const lower = id.toLowerCase()
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) {
    return { provider: 'OpenAI', contextLength: 128_000, inputPrice: 0, outputPrice: 0, modalities: ['text'], tools: true }
  }
  if (lower.startsWith('claude-')) {
    return { provider: 'Anthropic', contextLength: 200_000, inputPrice: 0, outputPrice: 0, modalities: ['text', 'image'], tools: true }
  }
  if (lower.startsWith('deepseek-')) {
    return { provider: 'DeepSeek', contextLength: 64_000, inputPrice: 0, outputPrice: 0, modalities: ['text'], tools: true }
  }
  return { provider: 'Unknown', contextLength: 0, inputPrice: 0, outputPrice: 0, modalities: ['text'], tools: false }
}

export function getMeta(id: string): { meta: ModelMeta; known: boolean } {
  const known = CATALOGUE[id]
  return known ? { meta: known, known: true } : { meta: inferMeta(id), known: false }
}

/** Stable pseudo-random hash so sample figures never jitter between renders. */
function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Placeholder activity figures — there is no telemetry behind these yet. */
function sampleActivity(id: string): { uptime: string; weeklyTokens: number } {
  const h = hash(id)
  return {
    uptime: (99 + (h % 100) / 100).toFixed(2),
    weeklyTokens: ((h >>> 8) % 900 + 100) * 1_000_000,
  }
}

export function toModelRow(model: { id: string; created: number }): ModelRow {
  const { meta } = getMeta(model.id)
  return { id: model.id, created: model.created, ...meta, ...sampleActivity(model.id) }
}

export function tierOf(inputPrice: number): PricingTier {
  if (inputPrice < 1) return 'budget'
  if (inputPrice <= 5) return 'standard'
  return 'premium'
}

export function formatContext(tokens: number): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(tokens / 1000)}K`
}

export function formatPrice(price: number): string {
  return price === 0 ? '—' : `$${price.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  return `${(tokens / 1_000_000).toFixed(0)}M`
}

/** iOS system colour per provider, used for the table's provider dot. */
export const PROVIDER_COLOR: Record<Provider, string> = {
  OpenAI: 'bg-ios-green',
  Anthropic: 'bg-ios-orange',
  DeepSeek: 'bg-ios-blue',
  Unknown: 'bg-ios-label-tertiary',
}
