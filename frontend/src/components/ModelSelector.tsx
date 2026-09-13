import { ChevronDown } from 'lucide-react'

/**
 * Rounded model picker. A native `<select>` styled with the iOS input tokens —
 * it keeps keyboard navigation, type-ahead and mobile pickers for free, which
 * a hand-rolled listbox would have to reimplement.
 */
export default function ModelSelector({
  models,
  value,
  onChange,
  disabled,
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label="Model"
        className="ios-input max-w-[17rem] cursor-pointer appearance-none truncate pr-9 font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ios-label-secondary"
      />
    </div>
  )
}
