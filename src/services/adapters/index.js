/**
 * Adapter registry.
 *
 * A provider's `adapter` field in config/providers.json selects one of these.
 * Adding a new provider family (Gemini, Mistral, ...) means adding a module
 * here and naming it in the config — the router never changes.
 */

import * as openaiCompatible from './openai.js';
import * as anthropic from './anthropic.js';

const REGISTRY = {
  'openai-compatible': openaiCompatible,
  anthropic,
};

export const adapterNames = Object.keys(REGISTRY);

/** Resolve an adapter by name, failing loudly on a config typo. */
export function getAdapter(adapterName) {
  const adapter = REGISTRY[adapterName];
  if (!adapter) {
    throw new Error(
      `Unknown adapter "${adapterName}". Known adapters: ${adapterNames.join(', ')}`
    );
  }
  return adapter;
}

export { ProviderError } from './common.js';
