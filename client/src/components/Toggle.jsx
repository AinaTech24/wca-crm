// Accessible on/off switch used in place of checkboxes across settings screens.
export default function Toggle({ checked, onChange, disabled, label, id }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={!!checked}
      aria-label={label}
      className={'switch' + (checked ? ' on' : '')}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}
