type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'size-4 border-2',
  md: 'size-6 border-2',
  lg: 'size-8 border-3',
};

export default function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      className={`
        ${sizeClasses[size]}
        border-text-tertiary border-t-accent rounded-full animate-spin
        ${className ?? ''}
      `}
      role="status"
      aria-label="Loading"
    />
  );
}
