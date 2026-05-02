import s from './Spinner.module.css';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export default function Spinner({ size = 'sm', className }: SpinnerProps) {
  const composed = [s.spinner, s[size], className ?? ''].filter(Boolean).join(' ');
  return <div className={composed} role="status" aria-label="Loading" />;
}
