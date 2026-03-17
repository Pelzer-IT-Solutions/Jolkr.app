interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export default function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-xl duration-150 transition-colors relative shrink-0 border ${checked ? 'bg-accent border-none' : 'bg-surface border-divider'} ${disabled ? 'opacity-50' : ''}`}
    >
      <div className={`absolute top-1/2 -translate-y-1/2 duration-150 size-4.5 rounded-full shadow transition-all ${checked ? 'right-0.5 bg-white' : 'left-0.5 bg-text-secondary'}`} />
    </button>
  );
}
