import type { Modality, PricingTier } from './modelCatalog'

/**
 * Shared filter state for the Model Library.
 *
 * These live outside `components/ModelFilters.tsx` so that file exports only a
 * component — otherwise React Fast Refresh degrades to a full reload whenever
 * the module changes.
 */
export interface FilterState {
  modalities: Modality[]
  toolsOnly: boolean
  tiers: PricingTier[]
}

/** Empty selection means "no restriction" on every axis. */
export const EMPTY_FILTERS: FilterState = { modalities: [], toolsOnly: false, tiers: [] }
