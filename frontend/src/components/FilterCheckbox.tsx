import { Check } from 'lucide-react'

/**
 * iOS-style checkbox: a rounded square that fills iOS blue with a white tick.
 * The real input is visually hidden so keyboard and screen-reader behaviour
 * stays native.
 */
export default function FilterCheckbox({
  label,
  checked,
  onChange,
  count,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  count?: number
}) {
  return (
    <label className="-mx-2 flex cursor-pointer items-center gap-2.5 rounded-ios px-2 py-1.5 transition-colors duration-150 hover:bg-ios-fill">
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border transition-all duration-200 ease-ios ${
          checked
            ? 'border-ios-blue bg-ios-blue text-white'
            : 'border-ios-label-tertiary bg-ios-surface text-transparent'
        }`}
      >
        <Check size={14} strokeWidth={3} />
      </span>
      <span className="flex-1 text-sm text-ios-label">{label}</span>
      {count !== undefined && (
        <span className="text-xs tabular-nums text-ios-label-secondary">{count}</span>
      )}
    </label>
  )
}
