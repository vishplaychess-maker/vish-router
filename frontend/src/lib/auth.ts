/**
 * Mock authentication.
 *
 * There is no real auth anywhere in this project — the gateway does not issue
 * tokens and the dashboard is meant to run locally. Signing in simply records a
 * display name so the navbar can show a profile avatar, and the whole thing is
 * deliberately easy to rip out when real auth arrives.
 */

export const AUTH_STORAGE_KEY = 'vishrouter_user'

/** The name a mock sign-in stores. */
export const MOCK_USER_NAME = 'Vish'

/**
 * localStorage throws in some privacy modes and when storage is disabled, so
 * every access is guarded — a failure here must never break the navbar.
 */
export function readUser(): string | null {
  try {
    const value = window.localStorage.getItem(AUTH_STORAGE_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

export function writeUser(name: string): void {
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, name)
  } catch {
    // Storage unavailable — the session simply will not persist.
  }
}

export function clearUser(): void {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // Nothing to clean up.
  }
}
