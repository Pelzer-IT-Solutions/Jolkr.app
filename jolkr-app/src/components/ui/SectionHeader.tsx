interface SectionHeaderProps {
  children: string;
  count?: number;
  className?: string;
}

export default function SectionHeader({ children, count, className }: SectionHeaderProps) {
  return (
    <div className={`text-xs font-semibold text-text-tertiary uppercase tracking-wider ${className ?? ''}`}>
      {children}
      {count !== undefined && (
        <span className="ml-1">&mdash; {count}</span>
      )}
    </div>
  );
}
