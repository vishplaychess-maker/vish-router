const STORAGE_KEY = 'vishrouter_api_key'

export const API_KEY_CHANGED_EVENT = 'vishrouter-api-key-changed'

export function getApiKey(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setApiKey(value: string): void {
  const key = value.trim()
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private browsing or hardened environments.
  }
  window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT))
}

export function clearApiKey(): void {
  setApiKey('')
}
