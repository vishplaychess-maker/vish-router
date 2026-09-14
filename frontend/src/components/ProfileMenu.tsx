import { useCallback, useState } from 'react'
import { LogOut } from 'lucide-react'

import { useDismissable } from '../hooks/useDismissable'

/** Circular avatar with the account's initial, and a Log Out popover. */
export default function ProfileMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismissable<HTMLDivElement>(open, close)

  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-ios-blue text-[13px] font-semibold text-white shadow-ios-sm transition-transform duration-150 ease-ios hover:brightness-110 active:scale-95"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-ios-lg border border-ios-separator bg-ios-surface shadow-ios-lg"
        >
          <div className="border-b border-ios-separator px-4 py-3">
            <p className="text-sm font-semibold text-ios-label">{name}</p>
            <p className="mt-0.5 text-xs text-ios-label-secondary">Signed in (mock)</p>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-ios-red transition-colors hover:bg-ios-fill"
          >
            <LogOut size={15} />
            Log Out
          </button>
        </div>
      )}
    </div>
  )
}
