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
      className={`
        relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${checked ? 'bg-accent' : 'bg-surface border border-divider'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block size-4.5 rounded-full transition-transform duration-200
          ${checked ? 'translate-x-5.5 bg-white' : 'translate-x-0.5 bg-text-secondary'}
          mt-0.75
        `}
      />
    </button>
  );
}
