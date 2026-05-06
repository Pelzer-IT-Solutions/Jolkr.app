import { useRef, useState, useEffect } from 'react'
import type React from 'react'
import type { ServerTheme } from '../types'
import { buildOrbBackground } from './theme'

const DURATION = 1200

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpHue(a: number, b: number, t: number): number {
  let d = b - a
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return ((a + d * t) % 360 + 360) % 360
}

interface OrbSnap { x: number; y: number; hue: number; scale: number }

interface ThemeSnap {
  baseHue: number
  intensity: number
  orbs: OrbSnap[]
}

const NEUTRAL_ORBS: OrbSnap[] = [
  { x: 0.22, y: 0.72, hue: 182, scale: 1 },
  { x: 0.74, y: 0.28, hue: 204, scale: 1 },
  { x: 0.12, y: 0.22, hue: 164, scale: 1 },
]

// Default hue for the neutral (DM / no-server) theme. This drives --theme-hue
// for CSS variables that always carry a small chroma (e.g. --jolkr-base-heavy
// at 0.066, --jolkr-neutral-light at 0.011). Must match the :root fallback in
// tokens.css so a hard refresh on DMs doesn't tint the UI red (hue 0).
const NEUTRAL_BASE_HUE = 182

function getNeutralOrbPosition(x: number, y: number): { x: number; y: number } {
  const toLeft = x < 0.5
  const toTop = y < 0.5

  return {
    x: toLeft ? -2 : 3,
    y: toTop ? -2 : 3,
  }
}

function snap(theme: ServerTheme, fallbackOrbs?: OrbSnap[]): ThemeSnap {
  // Truly theme-less: no preset hue AND no orbs
  if (theme.hue === null && theme.orbs.length === 0) {
    // Move orbs off-screen for neutral themes
    const neutralOrbs = fallbackOrbs
      ? fallbackOrbs.map(o => {
          const pos = getNeutralOrbPosition(o.x, o.y)
          return { ...o, x: pos.x, y: pos.y }
        })
      : NEUTRAL_ORBS.map(o => {
          const pos = getNeutralOrbPosition(o.x, o.y)
          return { ...o, x: pos.x, y: pos.y }
        })

    return {
      baseHue: NEUTRAL_BASE_HUE,
      intensity: 0,
      orbs: neutralOrbs,
    }
  }
  // Custom hue (orbs with individual hues but no preset) or preset hue
  return {
    baseHue: theme.hue ?? (theme.orbs[0]?.hue ?? 0),
    intensity: 1,
    orbs: theme.orbs.map(o => ({ x: o.x, y: o.y, hue: o.hue, scale: o.scale ?? 1 })),
  }
}

function tween(from: ThemeSnap, to: ThemeSnap, t: number): ThemeSnap {
  return {
    baseHue:   lerpHue(from.baseHue, to.baseHue, t),
    intensity: lerp(from.intensity, to.intensity, t),
    orbs: from.orbs.map((f, i) => {
      const tOrb = to.orbs[i] ?? f
      return {
        x:     lerp(f.x, tOrb.x, t),
        y:     lerp(f.y, tOrb.y, t),
        hue:   lerpHue(f.hue, tOrb.hue, t),
        scale: lerp(f.scale, tOrb.scale, t),
      }
    }),
  }
}

function buildBg(st: ThemeSnap, dark: boolean): string {
  return buildOrbBackground(st.orbs, { baseHue: st.baseHue, intensity: st.intensity, isDark: dark })
}

/* ── Token computation + :root sync ── */

const ROOT_KEYS = [
  '--theme-hue',
  '--accent',
  '--accent-muted',
  '--accent-strong',
  '--accent-text',
] as const

/**
 * Compute accent tokens. When targetHue is provided, the accent uses that hue
 * with the current intensity as chroma — so the transition is gray → target
 * color with no intermediate hues.
 */
function computeTokens(st: ThemeSnap, dark: boolean, targetHue?: number): Record<string, string> {
  const h   = targetHue ?? st.baseHue
  const acC = 0.18 * st.intensity
  const atC = 0.14 * st.intensity
  const atL = dark ? 72 : 42 - 4 * st.intensity

  return {
    '--theme-hue':     String(h),
    '--accent':        `oklch(55% ${acC.toFixed(4)} ${h})`,
    '--accent-muted':  `oklch(55% ${acC.toFixed(4)} ${h} / 0.12)`,
    '--accent-strong': `oklch(55% ${acC.toFixed(4)} ${h} / 0.24)`,
    '--accent-text':   `oklch(${atL.toFixed(1)}% ${atC.toFixed(4)} ${h})`,
  }
}

/** Sync tokens to :root so portals (createPortal) inherit them */
function syncToRoot(tokens: Record<string, string>) {
  const rs = document.documentElement.style
  for (const key of ROOT_KEYS) rs.setProperty(key, tokens[key])
}

function makeStyle(tokens: Record<string, string>, bg: string): React.CSSProperties {
  return { ...tokens, background: bg } as React.CSSProperties
}

/**
 * Animates the app-root background when switching servers.
 *
 * - Server switch → 1200 ms cross-fade of background orbs.
 *   Accent tokens jump instantly to the target (no colour-flash).
 * - Theme-picker edits (same server) → instant update.
 * - Tokens are synced to :root so createPortal modals pick them up.
 */
export function useAnimatedTheme(
  serverId: string,
  theme: ServerTheme,
  isDark: boolean,
): React.CSSProperties {
  const isDarkRef    = useRef(isDark)
  isDarkRef.current  = isDark

  const current      = useRef<ThemeSnap>(snap(theme))
  const raf          = useRef(0)
  const prevServerId = useRef(serverId)

  const [style, setStyle] = useState<React.CSSProperties>(() => {
    const tokens = computeTokens(current.current, isDark)
    syncToRoot(tokens)
    return makeStyle(tokens, buildBg(current.current, isDark))
  })

  // Stable content key — prevents infinite re-render when theme is a new
  // object reference with identical content (e.g. inline { hue: null, orbs: [] }).
  const themeKey = `${theme.hue}|${theme.orbs.map(o => `${o.x},${o.y},${o.hue},${o.scale ?? 1}`).join(';')}`

  useEffect(() => {
    const prev = prevServerId.current
    const switched = prev !== serverId
    prevServerId.current = serverId

    // Same server — instant update (theme picker, etc.)
    if (!switched) {
      cancelAnimationFrame(raf.current)
      current.current = snap(theme)
      const tokens = computeTokens(current.current, isDarkRef.current)
      syncToRoot(tokens)
      setStyle(makeStyle(tokens, buildBg(current.current, isDarkRef.current)))
      return
    }

    const to = snap(theme, current.current.orbs)

    // Animate everything (accent + background) from current state to target
    const from = { ...current.current, orbs: current.current.orbs.map(o => ({ ...o })) }

    cancelAnimationFrame(raf.current)
    let start: number | null = null

    // Pick the hue from whichever side has color (intensity > 0).
    // Fading TO neutral: keep the source hue → [color] → faint [color] → gray.
    // Fading FROM neutral: use the target hue → gray → faint [color] → [color].
    // Both have color: use target hue.
    const accentHue = to.intensity > 0 ? to.baseHue : from.baseHue

    function tick(now: number) {
      if (start === null) start = now
      const p     = Math.min((now - start) / DURATION, 1)
      const eased = easeInOutCubic(p)
      const state = tween(from, to, eased)
      current.current = state
      const tokens = computeTokens(state, isDarkRef.current, accentHue)
      syncToRoot(tokens)
      setStyle(makeStyle(tokens, buildBg(state, isDarkRef.current)))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, themeKey])

  // Rebuild when dark-mode toggles
  useEffect(() => {
    const tokens = computeTokens(current.current, isDark)
    syncToRoot(tokens)
    setStyle(makeStyle(tokens, buildBg(current.current, isDark)))
  }, [isDark])

  return style
}
