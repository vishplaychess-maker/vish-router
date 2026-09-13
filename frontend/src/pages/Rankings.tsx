import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Medal } from 'lucide-react'

import { fetchModels } from '../lib/api'
import { PROVIDER_COLOR, toModelRow, type ModelRow } from '../lib/modelCatalog'
import { WEIGHTS, scoreModels, type ScoredModel } from '../lib/ranking'

/** Route `/rankings` — models ranked by a composite score. */

/** iOS-flavoured medal tints for the podium places. */
const MEDALS: Record<number, { bg: string; name: string }> = {
  1: { bg: 'bg-[#FFB800]', name: 'Gold' },
  2: { bg: 'bg-[#B4B4BB]', name: 'Silver' },
  3: { bg: 'bg-[#CE8946]', name: 'Bronze' },
}

const LEGEND = [
  { key: 'cost', label: 'Cost', weight: WEIGHTS.cost },
  { key: 'popularity', label: 'Popularity', weight: WEIGHTS.popularity },
  { key: 'context', label: 'Context', weight: WEIGHTS.context },
  { key: 'reliability', label: 'Reliability', weight: WEIGHTS.reliability },
]

export default function Rankings() {
  const [rows, setRows] = useState<ModelRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((models) => {
        setRows(models.map(toModelRow))
        setStatus('ready')
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return
        setError(err.message)
        setStatus('error')
      })
    return () => controller.abort()
  }, [])

  const ranked: ScoredModel[] = status === 'ready' ? scoreModels(rows) : []
  const leader = ranked[0]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ios-label">Rankings</h1>
          <p className="mt-1 text-sm text-ios-label-secondary">
            {status === 'ready'
              ? `${ranked.length} models ranked by a composite score`
              : status === 'error'
                ? 'The gateway could not be reached'
                : 'Scoring models…'}
          </p>
        </div>
        {leader && (
          <div className="ios-chip">
            <Medal size={12} className="text-[#FFB800]" />
            Leader: {leader.id}
          </div>
        )}
      </header>

      {/* How the score is built */}
      <div className="ios-card mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <span className="text-[11px] font-semibold tracking-wider text-ios-label-secondary uppercase">
          Score weighting
        </span>
        {LEGEND.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5 text-xs text-ios-label-secondary">
            <span className="font-semibold text-ios-label">{item.label}</span>
            {Math.round(item.weight * 100)}%
          </span>
        ))}
      </div>

      {status === 'loading' && <LoadingTable />}

      {status === 'error' && (
        <div className="ios-card mt-4 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ios-red/10 text-ios-red">
            <AlertCircle size={24} />
          </span>
          <h2 className="text-lg font-bold text-ios-label">Can&apos;t build the leaderboard</h2>
          <p className="max-w-md text-sm text-ios-label-secondary">{error}</p>
          <Link to="/" className="ios-btn-primary mt-1">
            Back to Model Library
          </Link>
        </div>
      )}

      {status === 'ready' && ranked.length > 0 && (
        <div className="ios-card mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ios-separator text-left">
                  {['Rank', 'Model', 'Provider', 'Composite score'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-ios-label-secondary uppercase"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((model) => (
                  <tr
                    key={model.id}
                    className="border-b border-ios-separator transition-colors duration-150 last:border-b-0 hover:bg-ios-fill/60"
                  >
                    <td className="w-16 px-4 py-3">
                      <RankBadge rank={model.rank} />
                    </td>

                    <td className="px-4 py-3">
                      <Link
                        to={`/chat?model=${encodeURIComponent(model.id)}`}
                        className="font-medium text-ios-label transition-colors hover:text-ios-blue"
                      >
                        {model.id}
                      </Link>
                      <div className="mt-0.5 text-xs text-ios-label-secondary">
                        {model.modalities.join(' + ')}
                        {model.tools ? ' · tools' : ' · no tools'}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 text-ios-label">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_COLOR[model.provider]}`}
                          aria-hidden="true"
                        />
                        {model.provider}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-ios-label">
                          {model.score.toFixed(1)}
                        </span>
                        <span
                          className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-ios-fill-strong"
                          role="img"
                          aria-label={`Composite score ${model.score.toFixed(1)} out of 100`}
                        >
                          <span
                            className="block h-full rounded-full bg-ios-blue"
                            style={{ width: `${Math.max(2, Math.min(100, model.score))}%` }}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <p className="mt-3 text-xs text-ios-label-secondary">
          Scores are computed from the sample catalogue data — price, context window, and the
          placeholder uptime and weekly-token figures. They are illustrative, not a benchmark.
        </p>
      )}
    </div>
  )
}

/** Podium medal for ranks 1–3, plain numeral beyond that. */
function RankBadge({ rank }: { rank: number }) {
  const medal = MEDALS[rank]

  if (medal) {
    return (
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white shadow-ios-xs ${medal.bg}`}
        title={`Rank ${rank} — ${medal.name}`}
        aria-label={`Rank ${rank}, ${medal.name} medal`}
      >
        <Medal size={15} />
      </span>
    )
  }

  return (
    <span className="inline-flex h-7 w-7 items-center justify-center text-sm font-semibold tabular-nums text-ios-label-secondary">
      {rank}
    </span>
  )
}

function LoadingTable() {
  return (
    <div className="ios-card mt-4 overflow-hidden" aria-busy="true" aria-label="Scoring models">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 border-b border-ios-separator px-4 py-4 last:border-b-0"
        >
          <div className="h-7 w-7 animate-pulse rounded-full bg-ios-fill" />
          <div className="h-4 flex-1 animate-pulse rounded-full bg-ios-fill" />
          <div className="h-4 w-24 animate-pulse rounded-full bg-ios-fill" />
        </div>
      ))}
    </div>
  )
}
