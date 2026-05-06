import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export default function Button({
  ref,
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const composed = [
    s.button,
    s[variant],
    s[size],
    fullWidth ? s.fullWidth : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={composed}
      {...props}
    >
      {loading ? <span className={s.spinner} /> : icon ? icon : null}
      {children}
    </button>
  );
}
