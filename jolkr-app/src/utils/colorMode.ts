import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from './storageKeys'

export type ColorPreference = 'light' | 'dark' | 'system'

const LS_KEY   = STORAGE_KEYS.COLOR_MODE
const TRANS_MS = 300

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function getInitialPref(): ColorPreference {
  const stored = localStorage.getItem(LS_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function useColorMode() {
  const [pref,       setPref]       = useState<ColorPreference>(getInitialPref)
  const [systemDark, setSystemDark] = useState(getSystemDark)

  const isDark = pref === 'dark' || (pref === 'system' && systemDark)

  // Apply/remove .dark class on <html>; briefly add transition-enable class.
  // Skip the transition when the class is already in sync with isDark — the
  // inline theme-init script in index.html runs synchronously before React
  // mounts, so on first render the class is usually already correct and
  // re-toggling it would trigger a 300ms cross-fade for nothing (visible as
  // a flash on the login → AppShell handoff).
  useEffect(() => {
    const root = document.documentElement
    const currentlyDark = root.classList.contains('dark')
    if (currentlyDark === isDark) return
    root.classList.add('color-mode-transition')
    if (isDark) root.classList.add('dark')
    else        root.classList.remove('dark')
    const tid = setTimeout(() => root.classList.remove('color-mode-transition'), TRANS_MS)
    return () => clearTimeout(tid)
  }, [isDark])

  // Follow OS preference when pref === 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function setPreference(next: ColorPreference) {
    setPref(next)
    if (next === 'system') localStorage.removeItem(LS_KEY)
    else                   localStorage.setItem(LS_KEY, next)
  }

  /** Quick toggle: light ↔ dark (skips system) */
  function toggle() {
    setPreference(isDark ? 'light' : 'dark')
  }

  return { isDark, pref, setPreference, toggle }
}
