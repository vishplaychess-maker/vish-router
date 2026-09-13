import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronRight, Search } from 'lucide-react'

import ModelFilters, { EMPTY_FILTERS, type FilterState } from '../components/ModelFilters'
import SegmentedControl from '../components/SegmentedControl'
import { fetchModels } from '../lib/api'
import {
  PROVIDER_COLOR,
  formatContext,
  formatPrice,
  formatTokens,
  tierOf,
  toModelRow,
  type Modality,
  type ModelRow,
} from '../lib/modelCatalog'

type Status = 'loading' | 'ready' | 'error'

const TAB_OPTIONS = ['All', 'Text', 'Image'] as const
type Tab = (typeof TAB_OPTIONS)[number]

/**
 * The segmented control and the sidebar's "Input modalities" checkboxes are two
 * views of the same state, so the active tab is *derived* from the modality
 * selection rather than stored separately. That keeps them from disagreeing.
 */
function tabFromModalities(modalities: Modality[]): Tab {
  const hasText = modalities.includes('text')
  const hasImage = modalities.includes('image')
  if (hasText && !hasImage) return 'Text'
  if (hasImage && !hasText) return 'Image'
  return 'All'
}

function modalitiesFromTab(tab: Tab): Modality[] {
  if (tab === 'Text') return ['text']
  if (tab === 'Image') return ['image']
  return ['text', 'image']
}

/** Route `/` — the Model Library (PRD §4.2). */
export default function ModelLibrary() {
  const navigate = useNavigate()

  const [rows, setRows] = useState<ModelRow[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')

    fetchModels(controller.signal)
      .then((models) => {
        setRows(models.map(toModelRow))
        setStatus('ready')
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return // unmounted / superseded
        setError(err.message)
        setStatus('error')
      })

    return () => controller.abort()
  }, [attempt])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (
        needle &&
        !row.id.toLowerCase().includes(needle) &&
        !row.provider.toLowerCase().includes(needle)
      ) {
        return false
      }
      if (filters.modalities.length > 0 && !filters.modalities.some((m) => row.modalities.includes(m))) {
        return false
      }
      if (filters.toolsOnly && !row.tools) return false
      if (filters.tiers.length > 0 && !filters.tiers.includes(tierOf(row.inputPrice))) return false
      return true
    })
  }, [rows, query, filters])

  const isDirty =
    query !== '' ||
    filters.toolsOnly ||
    filters.tiers.length > 0 ||
    (filters.modalities.length > 0 && filters.modalities.length < 2)

  const reset = () => {
    setQuery('')
    setFilters(EMPTY_FILTERS)
  }

  const openInChat = (modelId: string) =>
    navigate(`/chat?model=${encodeURIComponent(modelId)}`)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ios-label">Model Library</h1>
          <p className="mt-1 text-sm text-ios-label-secondary">
            {status === 'ready'
              ? `${filtered.length} of ${rows.length} models available for routing`
              : status === 'error'
                ? 'The gateway could not be reached'
                : 'Loading models…'}
          </p>
        </div>
      </div>

      {/* Spotlight-style search */}
      <div className="relative mt-5 max-w-md">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ios-label-secondary"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="ios-search"
          placeholder="Search models or providers"
          aria-label="Search models"
        />
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside className="lg:w-64 lg:shrink-0">
          <ModelFilters
            models={rows}
            value={filters}
            onChange={setFilters}
            onReset={reset}
            dirty={isDirty}
          />
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              options={TAB_OPTIONS}
              value={tabFromModalities(filters.modalities)}
              onChange={(tab) => setFilters({ ...filters, modalities: modalitiesFromTab(tab) })}
              ariaLabel="Filter by input modality"
            />
            <span className="text-sm text-ios-label-secondary">
              {filtered.length} {filtered.length === 1 ? 'model' : 'models'}
            </span>
          </div>

          {status === 'loading' && <LoadingTable />}

          {status === 'error' && (
            <div className="ios-card mt-4 flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ios-red/10 text-ios-red">
                <AlertCircle size={24} />
              </span>
              <h2 className="text-lg font-bold text-ios-label">Can&apos;t load models</h2>
              <p className="max-w-md text-sm text-ios-label-secondary">{error}</p>
              <button
                type="button"
                className="ios-btn-primary mt-1"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}

          {status === 'ready' && filtered.length === 0 && (
            <div className="ios-card mt-4 flex flex-col items-center gap-2 px-6 py-12 text-center">
              <h2 className="text-lg font-bold text-ios-label">No matching models</h2>
              <p className="text-sm text-ios-label-secondary">
                Nothing matches the current search and filters.
              </p>
              <button type="button" className="ios-btn-secondary mt-1" onClick={reset}>
                Clear filters
              </button>
            </div>
          )}

          {status === 'ready' && filtered.length > 0 && (
            <ModelTable rows={filtered} onSelect={openInChat} />
          )}

          {status === 'ready' && (
            <p className="mt-3 text-xs text-ios-label-secondary">
              The gateway&apos;s <code className="font-mono">/v1/models</code> returns model ids only —
              pricing, context length and activity figures are sample catalogue data.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelTable({ rows, onSelect }: { rows: ModelRow[]; onSelect: (id: string) => void }) {
  return (
    <div className="ios-card mt-4 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ios-separator text-left">
              {['Model', 'Provider', 'Context', 'Input / 1M', 'Output / 1M', 'Activity', ''].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-ios-label-secondary uppercase"
                  >
                    {heading}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className="group cursor-pointer border-b border-ios-separator transition-colors duration-150 last:border-b-0 hover:bg-ios-fill/60"
              >
                <td className="px-4 py-3">
                  {/* Link keeps the row keyboard-reachable; the row click is the convenience. */}
                  <Link
                    to={`/chat?model=${encodeURIComponent(row.id)}`}
                    className="font-medium text-ios-label transition-colors group-hover:text-ios-blue"
                  >
                    {row.id}
                  </Link>
                  <div className="mt-0.5 text-xs text-ios-label-secondary">
                    {row.modalities.join(' + ')}
                    {row.tools ? ' · tools' : ' · no tools'}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 text-ios-label">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_COLOR[row.provider]}`}
                      aria-hidden="true"
                    />
                    {row.provider}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label">
                  {formatContext(row.contextLength)}
                </td>
                <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label">
                  {formatPrice(row.inputPrice)}
                </td>
                <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label">
                  {formatPrice(row.outputPrice)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="ios-chip">
                      <span className="h-1.5 w-1.5 rounded-full bg-ios-green" aria-hidden="true" />
                      {row.uptime}%
                    </span>
                    <span className="ios-chip">{formatTokens(row.weeklyTokens)}</span>
                  </div>
                </td>
                <td className="pr-4 pl-1 py-3 text-ios-label-tertiary">
                  <ChevronRight size={16} className="transition-colors group-hover:text-ios-blue" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LoadingTable() {
  return (
    <div className="ios-card mt-4 overflow-hidden" aria-busy="true" aria-label="Loading models">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 border-b border-ios-separator px-4 py-4 last:border-b-0"
        >
          <div className="h-4 flex-1 animate-pulse rounded-full bg-ios-fill" />
          <div className="h-4 w-24 animate-pulse rounded-full bg-ios-fill" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-ios-fill" />
          <div className="h-4 w-20 animate-pulse rounded-full bg-ios-fill" />
        </div>
      ))}
    </div>
  )
}
