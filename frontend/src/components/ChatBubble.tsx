import type { ReactNode } from 'react'
import type { RoutingMeta } from '../lib/chat'

/**
 * iMessage bubble. The "tail" is the squared corner nearest the speaker,
 * applied by `.ios-bubble-user` / `.ios-bubble-ai` in index.css.
 */
export function ChatBubble({ role, children }: { role: 'user' | 'assistant'; children: ReactNode }) {
  return (
    <div className={role === 'user' ? 'ios-bubble-user self-end' : 'ios-bubble-ai self-start'}>
      {children}
    </div>
  )
}

/**
 * Routing badge shown above an assistant reply, e.g.
 * `Provider: DeepSeek | Model: deepseek-chat | Fallback: No`.
 * The dot turns orange when the gateway had to fail over.
 */
export function RoutingBadge({ meta }: { meta: RoutingMeta }) {
  return (
    <div className="ios-chip self-start">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${meta.fallbackUsed ? 'bg-ios-orange' : 'bg-ios-green'}`}
      />
      <span>
        Provider: {meta.provider ?? 'unknown'}
        {' | '}
        Model: {meta.upstreamModel ?? '—'}
        {' | '}
        Fallback: {meta.fallbackUsed ? 'Yes' : 'No'}
      </span>
    </div>
  )
}

/** Three-dot "assistant is thinking" indicator. */
export function TypingBubble() {
  return (
    <div className="ios-bubble-ai flex items-center gap-1 self-start py-3.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-2 w-2 animate-bounce rounded-full bg-ios-label-tertiary"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  )
}
