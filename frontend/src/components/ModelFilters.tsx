import type { ReactNode } from 'react'
import FilterCheckbox from './FilterCheckbox'
import { tierOf, type Modality, type ModelRow, type PricingTier } from '../lib/modelCatalog'

export interface FilterState {
  modalities: Modality[]
  toolsOnly: boolean
  tiers: PricingTier[]
}

export const EMPTY_FILTERS: FilterState = { modalities: [], toolsOnly: false, tiers: [] }

const MODALITY_LABELS: Record<Modality, string> = { text: 'Text', image: 'Image' }
const TIER_OPTIONS: { tier: PricingTier; label: string }[] = [
  { tier: 'budget', label: 'Budget · under $1' },
  { tier: 'standard', label: 'Standard · $1–$5' },
  { tier: 'premium', label: 'Premium · over $5' },
]

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-ios-separator px-4 py-4 last:border-b-0">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ios-label-secondary uppercase">
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

/** Left-hand filter rail (PRD §4.2). */
export default function ModelFilters({
  models,
  value,
  onChange,
  onReset,
  dirty,
}: {
  models: ModelRow[]
  value: FilterState
  onChange: (next: FilterState) => void
  onReset: () => void
  dirty: boolean
}) {
  const modalityCount = (modality: Modality) =>
    models.filter((model) => model.modalities.includes(modality)).length
  const tierCount = (tier: PricingTier) =>
    models.filter((model) => tierOf(model.inputPrice) === tier).length

  return (
    <div className="ios-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ios-separator px-4 py-3">
        <h2 className="text-sm font-semibold text-ios-label">Filters</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty}
          className="cursor-pointer text-[13px] font-semibold text-ios-blue transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      <Group title="Input modalities">
        {(Object.keys(MODALITY_LABELS) as Modality[]).map((modality) => (
          <FilterCheckbox
            key={modality}
            label={MODALITY_LABELS[modality]}
            count={modalityCount(modality)}
            checked={value.modalities.includes(modality)}
            onChange={() => onChange({ ...value, modalities: toggle(value.modalities, modality) })}
          />
        ))}
      </Group>

      <Group title="Tools">
        <FilterCheckbox
          label="Supports function calling"
          count={models.filter((model) => model.tools).length}
          checked={value.toolsOnly}
          onChange={(checked) => onChange({ ...value, toolsOnly: checked })}
        />
      </Group>

      <Group title="Pricing">
        {TIER_OPTIONS.map(({ tier, label }) => (
          <FilterCheckbox
            key={tier}
            label={label}
            count={tierCount(tier)}
            checked={value.tiers.includes(tier)}
            onChange={() => onChange({ ...value, tiers: toggle(value.tiers, tier) })}
          />
        ))}
      </Group>
    </div>
  )
}
