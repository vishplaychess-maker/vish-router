import { useCallback, useState } from 'react'
import { Activity, Bell, CheckCheck, ShieldCheck, Sparkles, Zap } from 'lucide-react'

import { useDismissable } from '../hooks/useDismissable'

/** Placeholder feed — there is no notification source in the gateway yet. */
const NOTIFICATIONS = [
  {
    id: 'welcome',
    icon: Sparkles,
    tone: 'bg-ios-blue-tint text-ios-blue',
    title: 'Welcome to VishRouter!',
    body: 'Point any OpenAI client at the gateway and it will route for you.',
    time: 'Just now',
  },
  {
    id: 'new-model',
    icon: Zap,
    tone: 'bg-ios-green/10 text-ios-green',
    title: 'New model added: deepseek-chat',
    body: 'DeepSeek is now available as a failover target.',
    time: '12m ago',
  },
  {
    id: 'rate-limit',
    icon: Activity,
    tone: 'bg-ios-orange/10 text-ios-orange',
    title: 'Rate limit updated',
    body: 'OpenAI requests are capped at 60 per minute.',
    time: '1h ago',
  },
  {
    id: 'failover',
    icon: ShieldCheck,
    tone: 'bg-ios-purple/10 text-ios-purple',
    title: 'Failover succeeded',
    body: 'A gpt-3.5-turbo request was served by deepseek-chat.',
    time: 'Yesterday',
  },
]

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  /** Opening the tray clears the bell badge, the way iOS badges behave. */
  const [opened, setOpened] = useState(false)
  const [items, setItems] = useState(() => NOTIFICATIONS.map((item) => ({ ...item, read: false })))

  const close = useCallback(() => setOpen(false), [])
  const ref = useDismissable<HTMLDivElement>(open, close)

  const unreadCount = items.filter((item) => !item.read).length
  const showBadge = unreadCount > 0 && !opened

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) setOpened(true)
  }

  const markAllRead = () => setItems((previous) => previous.map((item) => ({ ...item, read: true })))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={showBadge ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:bg-ios-fill hover:text-ios-label"
      >
        <Bell size={18} />
        {showBadge && (
          <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-ios-red ring-2 ring-ios-surface" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // Below `md` the panel is anchored to the viewport instead of the bell:
          // the bell sits near the right edge on a phone, so a 320px panel
          // pinned to it would hang off the left of the screen. The top offset
          // clears the full header (top row + the mobile nav row).
          className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-ios-lg border border-ios-separator bg-ios-surface shadow-ios-lg max-md:fixed max-md:inset-x-4 max-md:top-[7.5rem] max-md:mt-0 max-md:w-auto max-md:max-w-none"
        >
          <div className="flex items-center justify-between border-b border-ios-separator px-4 py-3">
            <span className="text-sm font-semibold text-ios-label">Notifications</span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="cursor-pointer text-[12px] font-semibold text-ios-blue transition-opacity disabled:cursor-default disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>

          <ul className="max-h-[22rem] divide-y divide-ios-separator overflow-y-auto">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.id} className="flex gap-3 px-4 py-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.tone}`}
                  >
                    <Icon size={15} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-[13px] font-semibold text-ios-label">{item.title}</p>
                      {!item.read && (
                        <span
                          aria-label="Unread"
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ios-blue"
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-ios-label-secondary">
                      {item.body}
                    </p>
                    <p className="mt-1 text-[11px] text-ios-label-tertiary">{item.time}</p>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center gap-1.5 border-t border-ios-separator bg-ios-fill/60 px-4 py-2.5 text-[11px] text-ios-label-secondary">
            <CheckCheck size={12} />
            Placeholder notifications — no notification source is wired up yet.
          </div>
        </div>
      )}
    </div>
  )
}
