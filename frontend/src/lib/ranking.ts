import type { ModelRow } from './modelCatalog'

/**
 * Composite scoring for the Rankings leaderboard.
 *
 * The formula is deliberately explicit and shown in the UI, because a ranking
 * nobody can explain is worse than no ranking. Every input comes from the local
 * catalogue (price, context window) or the sample activity figures, so the
 * result is illustrative rather than authoritative.
 */

export const WEIGHTS = {
  cost: 0.35,
  popularity: 0.3,
  context: 0.2,
  reliability: 0.15,
} as const

export interface ScoreBreakdown {
  cost: number
  popularity: number
  context: number
  reliability: number
}

export interface ScoredModel extends ModelRow {
  score: number
  rank: number
  breakdown: ScoreBreakdown
  /** Cost axis could not be evaluated (no catalogue price) — scored neutrally. */
  costUnknown: boolean
}

/** Linear normalisation to 0–100; `invert` makes smaller values score higher. */
function normalize(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 100 // every model ties at the best value on this axis
  const t = (value - min) / (max - min)
  return (invert ? 1 - t : t) * 100
}

/**
 * Log normalisation. Prices and context windows span orders of magnitude, and
 * on a linear scale every cheap model would collapse into an indistinguishable
 * cluster near 100.
 */
function normalizeLog(value: number, min: number, max: number, invert = false): number {
  const safe = (n: number) => Math.log(Math.max(n, Number.EPSILON))
  const lo = safe(min)
  const hi = safe(max)
  if (hi === lo) return 100
  const t = (safe(value) - lo) / (hi - lo)
  return (invert ? 1 - t : t) * 100
}

/**
 * Blended token cost. Output tokens dominate real spend, so they carry more
 * weight than input tokens.
 */
export function blendedCost(row: ModelRow): number {
  return row.inputPrice * 0.3 + row.outputPrice * 0.7
}

export function scoreModels(rows: ModelRow[]): ScoredModel[] {
  if (rows.length === 0) return []

  const costs = rows.map(blendedCost).filter((cost) => cost > 0)
  const contexts = rows.map((row) => row.contextLength).filter((value) => value > 0)
  const tokens = rows.map((row) => row.weeklyTokens)
  const uptimes = rows.map((row) => Number.parseFloat(row.uptime))

  const scored = rows.map((row) => {
    const cost = blendedCost(row)
    // A model with no catalogue price (0/0) must not win the cost axis by
    // accident, so it scores neutral instead of "free".
    const costUnknown = cost <= 0
    const costScore = costUnknown
      ? 50
      : normalizeLog(cost, Math.min(...costs), Math.max(...costs), true)

    const breakdown: ScoreBreakdown = {
      cost: costScore,
      popularity: normalize(row.weeklyTokens, Math.min(...tokens), Math.max(...tokens)),
      context:
        row.contextLength > 0
          ? normalizeLog(row.contextLength, Math.min(...contexts), Math.max(...contexts))
          : 50,
      reliability: normalize(
        Number.parseFloat(row.uptime),
        Math.min(...uptimes),
        Math.max(...uptimes)
      ),
    }

    const score =
      breakdown.cost * WEIGHTS.cost +
      breakdown.popularity * WEIGHTS.popularity +
      breakdown.context * WEIGHTS.context +
      breakdown.reliability * WEIGHTS.reliability

    return { ...row, score: Math.round(score * 10) / 10, rank: 0, breakdown, costUnknown }
  })

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  scored.forEach((entry, index) => {
    entry.rank = index + 1
  })

  return scored
}
