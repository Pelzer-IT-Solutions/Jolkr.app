import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import s from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  helper?: string;
  icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, icon, className, id, ...props }, ref) => {
    const wrapClass = error ? `${s.wrap} ${s.invalid}` : s.wrap;
    const inputClass = [
      s.input,
      icon ? s.withIcon : '',
      className ?? '',
    ].filter(Boolean).join(' ');

    return (
      <div className={s.field}>
        {label && (
          <label htmlFor={id} className={s.label}>
            {label}
          </label>
        )}
        <div className={wrapClass}>
          {icon && <div className={s.icon}>{icon}</div>}
          <input ref={ref} id={id} className={inputClass} {...props} />
        </div>
        {error && <span className={s.error}>{error}</span>}
        {helper && !error && <span className={s.helper}>{helper}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
