interface SectionHeaderProps {
  children: string;
  count?: number;
}

export default function SectionHeader({ children, count }: SectionHeaderProps) {
  return (
    <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider px-2 py-1.5">
      {children}
      {count !== undefined && (
        <span className="ml-1">&mdash; {count}</span>
      )}
    </h3>
  );
}
