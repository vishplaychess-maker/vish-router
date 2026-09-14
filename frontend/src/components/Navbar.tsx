import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { KeyRound, LogOut, RotateCw, X } from 'lucide-react'

import LoginModal from './LoginModal'
import NotificationBell from './NotificationBell'
import ProfileMenu from './ProfileMenu'
import {
  API_KEY_CHANGED_EVENT,
  clearApiKey,
  getApiKey,
  setApiKey,
} from '../lib/apiKey'
import { clearUser, readUser, writeUser } from '../lib/auth'

/**
 * Top navigation (PRD §4.1).
 *
 * The mock dashboard account and the VishRouter client API key are deliberately
 * separate controls. Provider credentials remain server-side environment values.
 */

const NAV_ITEMS = [
  { label: 'MODELS', to: '/', end: true },
  { label: 'RANKINGS', to: '/rankings', end: false },
  { label: 'PRICING', to: '/pricing', end: false },
  { label: 'CHAT', to: '/chat', end: false },
  { label: 'DOCS', to: '/docs', end: false },
] as const

function navLinkClasses({ isActive }: { isActive: boolean }): string {
  return isActive ? 'ios-nav-link ios-nav-link-active' : 'ios-nav-link'
}

function ApiKeyModal({ onClose }: { onClose: () => void }) {
  const [draftKey, setDraftKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const saveKey = (event: FormEvent) => {
    event.preventDefault()
    if (!draftKey.trim()) return
    setApiKey(draftKey)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/25 backdrop-blur-sm"
      />
      <form
        onSubmit={saveKey}
        className="ios-card relative w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-title"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="api-key-title" className="text-xl font-bold text-ios-label">
              Connect API key
            </h2>
            <p className="mt-1 text-sm text-ios-label-secondary">Used only for this browser tab.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ios-fill"
          >
            <X size={18} />
          </button>
        </div>
        <label className="mt-5 block text-sm font-semibold text-ios-label" htmlFor="gateway-api-key">
          VishRouter API key
        </label>
        <input
          ref={inputRef}
          id="gateway-api-key"
          type="password"
          autoComplete="off"
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          placeholder="vr_live_…"
          className="ios-input mt-2 font-mono"
        />
        <p className="mt-2 text-xs text-ios-label-secondary">
          The key is kept in sessionStorage and is cleared when the tab session ends.
        </p>
        <button type="submit" disabled={!draftKey.trim()} className="ios-btn-primary mt-5 w-full">
          Connect
        </button>
      </form>
    </div>
  )
}

export default function Navbar() {
  const [user, setUser] = useState<string | null>(() => readUser())
  const [loginOpen, setLoginOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(getApiKey()))
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)

  useEffect(() => {
    const syncKeyState = () => setHasApiKey(Boolean(getApiKey()))
    window.addEventListener(API_KEY_CHANGED_EVENT, syncKeyState)
    return () => window.removeEventListener(API_KEY_CHANGED_EVENT, syncKeyState)
  }, [])

  const closeLogin = useCallback(() => setLoginOpen(false), [])
  const closeKeyDialog = useCallback(() => setKeyDialogOpen(false), [])

  const handleLogin = useCallback((name: string) => {
    writeUser(name)
    setUser(name)
    setLoginOpen(false)
  }, [])

  const handleLogout = useCallback(() => {
    clearUser()
    setUser(null)
  }, [])

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-ios-separator bg-ios-surface/90 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-3 sm:px-6">
          <div className="flex h-14 items-center gap-4">
            <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="VishRouter home">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ios-blue text-white shadow-ios-sm">
                <RotateCw size={17} strokeWidth={2.6} />
              </span>
              <span className="text-[15px] font-bold tracking-tight text-ios-label">VishRouter</span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClasses}>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />

              {hasApiKey ? (
                <button
                  type="button"
                  onClick={clearApiKey}
                  aria-label="Disconnect VishRouter API key"
                  title="Forget the API key from this browser tab"
                  className="ios-btn-secondary h-9 px-3 text-[13px]"
                >
                  <LogOut size={14} />
                  <span className="hidden lg:inline">DISCONNECT</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setKeyDialogOpen(true)}
                  aria-label="Connect VishRouter API key"
                  className="ios-btn-secondary h-9 px-3 text-[13px]"
                >
                  <KeyRound size={14} />
                  <span className="hidden lg:inline">API KEY</span>
                </button>
              )}

              {user ? (
                <ProfileMenu name={user} onLogout={handleLogout} />
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginOpen(true)}
                  className="ios-btn-primary px-3 py-1.5 text-[13px] sm:px-4"
                >
                  LOG IN
                </button>
              )}
            </div>
          </div>

          <nav
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-2 md:hidden"
            aria-label="Primary mobile"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `${navLinkClasses({ isActive })} inline-flex min-h-11 shrink-0 items-center whitespace-nowrap`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {keyDialogOpen && <ApiKeyModal onClose={closeKeyDialog} />}
      {loginOpen && <LoginModal onClose={closeLogin} onLogin={handleLogin} />}
    </>
  )
}
