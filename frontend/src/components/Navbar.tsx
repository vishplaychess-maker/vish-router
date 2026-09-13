import { Link, NavLink } from 'react-router-dom'
import { Bell, RotateCw } from 'lucide-react'

/**
 * Top navigation (PRD §4.1).
 *
 * White surface, hairline bottom border, iOS-blue pill for the active route.
 * On narrow screens the links drop to their own scrollable row rather than
 * disappearing, so every route stays reachable on a phone.
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

export default function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-ios-separator bg-ios-surface/90 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-14 items-center gap-4">
          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="VishRouter home">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ios-blue text-white shadow-ios-sm">
              <RotateCw size={17} strokeWidth={2.6} />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ios-label">VishRouter</span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClasses}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-ios-label"
            >
              <Bell size={18} />
              {/* iOS-style unread dot. No notification source yet. */}
              <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-ios-red ring-2 ring-ios-surface" />
            </button>
            <button type="button" className="ios-btn-primary px-4 py-1.5 text-[13px]">
              LOG IN
            </button>
          </div>
        </div>

        {/* Mobile navigation */}
        <nav
          className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-2 md:hidden"
          aria-label="Primary mobile"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              // min-h-11 (44px) keeps the tap target at Apple's HIG minimum on
              // touch screens, where the desktop pill's 32px would be cramped.
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
  )
}
