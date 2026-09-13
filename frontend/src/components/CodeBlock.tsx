import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Documentation code sample with a copy-to-clipboard affordance. */
export default function CodeBlock({ code, label = 'shell' }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is unavailable outside a secure context — nothing to do.
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-ios border border-ios-separator">
      <div className="flex items-center justify-between border-b border-ios-separator bg-ios-surface px-4 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-ios-label-secondary uppercase">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-ios-label-secondary transition-colors hover:text-ios-blue"
        >
          {copied ? <Check size={14} className="text-ios-green" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="overflow-x-auto bg-ios-fill px-4 py-3.5">
        <code className="font-mono text-[12.5px] leading-relaxed text-ios-label">{code}</code>
      </pre>
    </div>
  )
}
