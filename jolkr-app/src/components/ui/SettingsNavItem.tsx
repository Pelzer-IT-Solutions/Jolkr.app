import type { ReactNode } from 'react';

interface SettingsNavItemProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
}

export default function SettingsNavItem({ label, icon, active, onClick, danger }: SettingsNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-2 rounded-lg py-2.5 px-4 text-sm font-medium text-left transition-colors
        ${danger
          ? 'text-danger hover:bg-danger-muted'
          : active
            ? 'bg-active text-text-primary'
            : 'text-text-secondary hover:bg-hover hover:text-text-primary'
        }
      `}
    >
      {icon && <span className="size-4 shrink-0">{icon}</span>}
      {label}
    </button>
  );
}
