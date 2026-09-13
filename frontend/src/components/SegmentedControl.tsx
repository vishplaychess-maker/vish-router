import { useEffect, useRef, useState } from 'react'

/**
 * iOS UISegmentedControl.
 *
 * The blue selection is a single absolutely-positioned pill measured from the
 * active button, so switching segments animates the pill *sliding* between
 * options rather than each button painting its own background.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const active = containerRef.current?.querySelector<HTMLButtonElement>(
        `[data-value="${CSS.escape(value)}"]`
      )
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, options])

  return (
    <div ref={containerRef} role="tablist" aria-label={ariaLabel} className="ios-segment relative">
      {indicator && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-[10px] bg-ios-blue shadow-ios-sm transition-all duration-300 ease-ios"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}

      {options.map((option) => {
        const selected = option === value
        return (
          <button
            key={option}
            type="button"
            role="tab"
            data-value={option}
            aria-selected={selected}
            onClick={() => onChange(option)}
            className={`relative z-10 cursor-pointer rounded-[10px] px-4 py-1.5 text-sm font-medium transition-colors duration-200 ease-ios ${
              selected ? 'text-white' : 'text-ios-label-secondary hover:text-ios-label'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
