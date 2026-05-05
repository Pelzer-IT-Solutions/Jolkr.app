import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={s.empty}>
      {icon && <div className={s.icon}>{icon}</div>}
      <div className={s.text}>
        <h3 className={s.title}>{title}</h3>
        {description && <p className={s.description}>{description}</p>}
      </div>
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
