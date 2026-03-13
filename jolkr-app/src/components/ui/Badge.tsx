interface BadgeProps {
  count: number;
  max?: number;
}

export default function Badge({ count, max = 99 }: BadgeProps) {
  if (count <= 0) return null;

  const display = count > max ? `${max}+` : String(count);

  return (
    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-xs font-bold">
      {display}
    </span>
  );
}
