import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from './storageKeys'

export type ColorPreference = 'light' | 'dark' | 'system'

const LS_KEY   = STORAGE_KEYS.COLOR_MODE
const TRANS_MS = 300

/** Latest OS dark-mode value as reported by Tauri's window-theme API.
 *  Set by `setTauriSystemDark` from main.tsx (and on theme-changed
 *  events). Falls back to matchMedia for web — which on Tauri WebView2
 *  may not reflect the Windows OS preference, hence this override. */
let tauriOsDark: boolean | null = null
const listeners = new Set<() => void>()

export function setTauriSystemDark(dark: boolean): void {
  if (tauriOsDark === dark) return
  tauriOsDark = dark
  for (const fn of listeners) fn()
}

function getSystemDark(): boolean {
  if (tauriOsDark !== null) return tauriOsDark
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

  // Follow OS preference when pref === 'system'. Two channels:
  //  - matchMedia for browsers (web build)
  //  - tauriOsDark module-level state for Tauri WebView2 (where matchMedia
  //    doesn't reflect the Windows OS preference reliably). Subscribers
  //    fire whenever main.tsx's Tauri-theme listener pushes a new value.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)

    const tauriListener = () => setSystemDark(getSystemDark())
    listeners.add(tauriListener)

    return () => {
      mq.removeEventListener('change', handler)
      listeners.delete(tauriListener)
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
