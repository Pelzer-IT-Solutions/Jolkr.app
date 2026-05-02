import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', fullWidth, loading, icon, className, children, disabled, ...props }, ref) => {
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
);

Button.displayName = 'Button';
export default Button;
