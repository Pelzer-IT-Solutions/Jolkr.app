import { type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import s from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  helper?: string;
  icon?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export default function Input({ ref, label, error, helper, icon, className, id, ...props }: InputProps) {
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
