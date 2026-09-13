/** iOS UISwitch. */
export default function IOSToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`ios-switch ${checked ? 'ios-switch-on' : 'ios-switch-off'}`}
    >
      <span
        aria-hidden="true"
        className={`ios-switch-knob ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
      />
    </button>
  )
}
