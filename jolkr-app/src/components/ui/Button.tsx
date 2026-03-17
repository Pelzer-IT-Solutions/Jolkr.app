import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-bg font-semibold hover:bg-accent-hover',
  secondary: 'bg-surface text-text-primary font-semibold border border-divider hover:bg-hover',
  danger: 'bg-danger text-white font-semibold hover:opacity-90',
  ghost: 'bg-input text-text-primary font-medium border border-divider hover:bg-hover',
};

export const sizeClasses: Record<ButtonSize, string> = {
  xs: 'py-1 px-2 text-xs gap-1',
  sm: 'py-1.5 px-3 text-xs gap-1.5',
  md: 'py-2.5 px-5 text-sm gap-2',
  lg: 'py-3 px-6 text-base gap-2',
};

export const baseClasses = 'inline-flex items-center justify-center rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', fullWidth, loading, icon, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          ${baseClasses}
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className ?? ''}
        `.trim()}
        {...props}
      >
        {loading ? (
          <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : icon ? (
          icon
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
