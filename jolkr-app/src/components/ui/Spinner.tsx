type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  colors?: string;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'size-5 border-2',
  md: 'size-6 border-2',
  lg: 'size-10 border-3',
};

export default function Spinner({ size = 'sm', colors = 'border-white/10 border-t-white/40', className }: SpinnerProps) {
  return (
    <div
      className={`${sizeClasses[size]} ${colors} rounded-full animate-spin ${className ?? ''}`}
      role="status"
      aria-label="Loading"
    />
  );
}
