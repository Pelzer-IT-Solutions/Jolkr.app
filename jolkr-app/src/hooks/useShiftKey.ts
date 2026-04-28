import { useEffect, useState } from 'react'

/**
 * Tracks whether Shift is currently held. Used for power-user shortcuts like
 * "Shift+click delete = skip confirmation". Single subscription per component;
 * listeners are torn down on unmount and on window blur to avoid a stuck-true
 * state if focus leaves while Shift is down.
 */
export function useShiftKey(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(true) }
    const onKeyUp   = (e: KeyboardEvent) => { if (e.key === 'Shift') setHeld(false) }
    const onBlur    = () => setHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    window.addEventListener('blur',    onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      window.removeEventListener('blur',    onBlur)
    }
  }, [])

  return held
}
