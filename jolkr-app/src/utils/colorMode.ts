import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from './storageKeys'

export type ColorPreference = 'light' | 'dark' | 'system'

const LS_KEY   = STORAGE_KEYS.COLOR_MODE
const TRANS_MS = 300

function getSystemDark() {
  const tauri = (window as unknown as { __TAURI_OS_DARK?: boolean }).__TAURI_OS_DARK
  if (typeof tauri === 'boolean') return tauri
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

  // Apply/remove .dark class on <html>; briefly add transition-enable class
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('color-mode-transition')
    if (isDark) root.classList.add('dark')
    else        root.classList.remove('dark')
    const tid = setTimeout(() => root.classList.remove('color-mode-transition'), TRANS_MS)
    return () => clearTimeout(tid)
  }, [isDark])

  // Follow OS preference when pref === 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const mqHandler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    const tauriHandler = () => setSystemDark(getSystemDark())
    mq.addEventListener('change', mqHandler)
    window.addEventListener('jolkr-tauri-theme-change', tauriHandler)
    return () => {
      mq.removeEventListener('change', mqHandler)
      window.removeEventListener('jolkr-tauri-theme-change', tauriHandler)
    }
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
