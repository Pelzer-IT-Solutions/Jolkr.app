import type { ReactNode } from 'react';
import s from './SettingsNavItem.module.css';

interface SettingsNavItemProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
}

export default function SettingsNavItem({ label, icon, active, onClick, danger }: SettingsNavItemProps) {
  const composed = [
    s.item,
    danger ? s.danger : '',
    active && !danger ? s.active : '',
  ].filter(Boolean).join(' ');

  return (
    <button onClick={onClick} className={composed}>
      {icon && <span className={s.icon}>{icon}</span>}
      {label}
    </button>
  );
}
