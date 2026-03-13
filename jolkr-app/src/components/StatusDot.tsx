type StatusType = 'online' | 'idle' | 'dnd' | 'offline';

interface StatusDotProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
  border?: boolean;
  className?: string;
}

const statusColors: Record<string, string> = {
  online: 'bg-online',
  idle: 'bg-idle',
  dnd: 'bg-dnd',
  offline: 'bg-offline',
};

const sizeClasses: Record<string, string> = {
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3',
};

export default function StatusDot({ status, size = 'lg', border = true, className }: StatusDotProps) {
  return (
    <span
      className={`
        inline-block rounded-full
        ${sizeClasses[size]}
        ${statusColors[status] ?? 'bg-offline'}
        ${border ? 'border-2 border-sidebar' : ''}
        ${className ?? ''}
      `}
    />
  );
}

export const statusLabel: Record<StatusType, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
};
