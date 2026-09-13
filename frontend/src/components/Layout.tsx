import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import { API_BASE_URL } from '../lib/config'

/**
 * Application shell: sticky navbar, routed content, quiet footer.
 *
 * Rendered as the parent route so every page inherits the same chrome and the
 * navbar is never remounted during navigation.
 */
export default function Layout() {
  const { pathname } = useLocation()

  // iOS pushes a new screen rather than restoring the previous scroll offset.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="flex min-h-screen flex-col bg-ios-bg">
      <Navbar />

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-ios-separator bg-ios-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-4">
          <span className="text-xs text-ios-label-secondary">
            VishRouter — one OpenAI-compatible gateway for OpenAI, Anthropic and DeepSeek
          </span>
          <span className="font-mono text-xs text-ios-label-secondary">{API_BASE_URL}</span>
        </div>
      </footer>
    </div>
  )
}
