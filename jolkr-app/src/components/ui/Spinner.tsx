import { useT } from '../../hooks/useT';
import s from './Spinner.module.css';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export default function Spinner({ size = 'sm', className }: SpinnerProps) {
  const { t } = useT();
  const composed = [s.spinner, s[size], className ?? ''].filter(Boolean).join(' ');
  return <div className={composed} role="status" aria-label={t('common.loading')} />;
}
