import { type SelectHTMLAttributes, type Ref } from 'react'
import s from './Select.module.css'

/**
 * Themed dropdown wrapping the native `<select>` so behaviour, keyboard
 * navigation and accessibility stay free, while the visual is consistent
 * with the rest of the app (custom chevron, design-token colors, fixed
 * 32px height to align with `<Button>` and the TabBar action buttons).
 *
 * Use this anywhere a dropdown is needed — don't reach for a raw `<select>`
 * in feature code.
 */
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  ref?: Ref<HTMLSelectElement>
}

export function Select({ className, ref, ...rest }: SelectProps) {
  return (
    <select
      ref={ref}
      className={`${s.select} ${className ?? ''}`}
      {...rest}
    />
  )
}

export default Select
