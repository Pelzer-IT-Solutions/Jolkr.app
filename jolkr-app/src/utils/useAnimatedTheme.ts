import { useRef, useState, useEffect } from 'react'
import type React from 'react'
import type { ServerTheme } from '../types'

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

interface OrbSnap { x: number; y: number; hue: number }

interface ThemeSnap {
  baseHue: number
  intensity: number
  orbs: OrbSnap[]
}

const NEUTRAL_ORBS: OrbSnap[] = [
  { x: 0.22, y: 0.72, hue: 0 },
  { x: 0.74, y: 0.28, hue: 22 },
  { x: 0.12, y: 0.22, hue: 342 },
]

function snap(theme: ServerTheme, fallbackOrbs?: OrbSnap[]): ThemeSnap {
  // Truly theme-less: no preset hue AND no orbs
  if (theme.hue === null && theme.orbs.length === 0) {
    return {
      baseHue: 0,
      intensity: 0,
      orbs: fallbackOrbs ?? NEUTRAL_ORBS.map(o => ({ ...o })),
    }
  }
  // Custom hue (orbs with individual hues but no preset) or preset hue
  return {
    baseHue: theme.hue ?? (theme.orbs[0]?.hue ?? 0),
    intensity: 1,
    orbs: theme.orbs.map(o => ({ x: o.x, y: o.y, hue: o.hue })),
  }
}

function tween(from: ThemeSnap, to: ThemeSnap, t: number): ThemeSnap {
  return {
    baseHue:   lerpHue(from.baseHue, to.baseHue, t),
    intensity: lerp(from.intensity, to.intensity, t),
    orbs: from.orbs.map((f, i) => {
      const tOrb = to.orbs[i] ?? f
      return {
        x:   lerp(f.x, tOrb.x, t),
        y:   lerp(f.y, tOrb.y, t),
        hue: lerpHue(f.hue, tOrb.hue, t),
      }
    }),
  }
}

function buildBg(st: ThemeSnap, dark: boolean): string {
  const baseL = dark ? '11%' : '91.5%'
  if (st.intensity < 0.001) return `oklch(${baseL} 0 0)`

  const orbL  = dark ? '36%' : '83%'
  const orbC  = (dark ? 0.10 : 0.11) * st.intensity
  const orbA  = (dark ? 0.88 : 0.82) * st.intensity
  const baseC = (dark ? 0.018 : 0.021) * st.intensity

  const grads = st.orbs.map(o =>
    `radial-gradient(ellipse 72% 72% at ${(o.x * 100).toFixed(1)}% ${(o.y * 100).toFixed(1)}%, ` +
    `oklch(${orbL} ${orbC.toFixed(4)} ${o.hue.toFixed(1)} / ${orbA.toFixed(4)}) 0%, transparent 100%)`,
  )
  return [...grads, `oklch(${baseL} ${baseC.toFixed(4)} ${st.baseHue.toFixed(1)})`].join(', ')
}

function makeStyle(st: ThemeSnap, dark: boolean): React.CSSProperties {
  const h   = st.baseHue
  const acC = 0.18 * st.intensity
  const atC = 0.14 * st.intensity
  const atL = dark ? 72 : 42 - 4 * st.intensity

  return {
    '--theme-hue':     h,
    '--accent':        `oklch(55% ${acC.toFixed(4)} ${h})`,
    '--accent-muted':  `oklch(55% ${acC.toFixed(4)} ${h} / 0.12)`,
    '--accent-strong': `oklch(55% ${acC.toFixed(4)} ${h} / 0.24)`,
    '--accent-text':   `oklch(${atL.toFixed(1)}% ${atC.toFixed(4)} ${h})`,
    background:        buildBg(st, dark),
  } as React.CSSProperties
}

/**
 * Animates the app-root background + accent tokens when switching servers.
 *
 * - Server switch (serverId changes) → 1200 ms cross-fade of orb positions,
 *   hues, and base tint via requestAnimationFrame.
 * - Theme-picker edits (same server) → instant update (no animation).
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

  const [style, setStyle] = useState<React.CSSProperties>(
    () => makeStyle(current.current, isDark),
  )

  useEffect(() => {
    const switched = prevServerId.current !== serverId
    prevServerId.current = serverId

    if (!switched) {
      cancelAnimationFrame(raf.current)
      current.current = snap(theme)
      setStyle(makeStyle(current.current, isDarkRef.current))
      return
    }

    const from = { ...current.current, orbs: current.current.orbs.map(o => ({ ...o })) }
    const to   = snap(theme, from.orbs)

    cancelAnimationFrame(raf.current)
    let start: number | null = null

    function tick(now: number) {
      if (start === null) start = now
      const p     = Math.min((now - start) / DURATION, 1)
      const eased = easeInOutCubic(p)
      const state = tween(from, to, eased)
      current.current = state
      setStyle(makeStyle(state, isDarkRef.current))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [serverId, theme])

  // Rebuild when dark-mode toggles so colours stay correct mid-animation
  useEffect(() => {
    setStyle(makeStyle(current.current, isDark))
  }, [isDark])

  return style
}
