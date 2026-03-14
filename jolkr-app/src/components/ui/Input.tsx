import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, icon, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className={`relative rounded-lg border bg-input focus-within:border-border-accent transition-colors ${error ? 'border-danger' : 'border-divider'}`}>
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full bg-transparent text-text-primary text-sm rounded-lg
              py-3 px-4 placeholder:text-text-tertiary
              focus:outline-none
              disabled:opacity-50 disabled:cursor-not-allowed
              ${icon ? 'pl-10' : ''}
              ${className ?? ''}
            `.trim()}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-danger">{error}</span>}
        {helper && !error && <span className="text-xs text-text-tertiary">{helper}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
