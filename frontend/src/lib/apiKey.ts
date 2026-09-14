const STORAGE_KEY = 'vishrouter_api_key'

export const API_KEY_CHANGED_EVENT = 'vishrouter-api-key-changed'

export function getApiKey(): string {
  return sessionStorage.getItem(STORAGE_KEY) ?? ''
}

export function setApiKey(value: string): void {
  const key = value.trim()
  if (key) sessionStorage.setItem(STORAGE_KEY, key)
  else sessionStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT))
}

export function clearApiKey(): void {
  setApiKey('')
}
