import type { ThemeOrb, ServerTheme } from '../types'
import type React from 'react'

/** Default three-orb layout for a given primary hue */
export function orbsForHue(hue: number): ThemeOrb[] {
  return [
    { id: 'a', x: 0.22, y: 0.72, hue, scale: 1 },
    { id: 'b', x: 0.74, y: 0.28, hue: (hue + 22) % 360, scale: 1 },
    { id: 'c', x: 0.12, y: 0.22, hue: (hue - 18 + 360) % 360, scale: 1 },
  ]
}

/** Per-orb shape used by `buildOrbBackground` — strips the optional `id`
 *  field so animated snapshots don't have to ferry it around. */
export interface OrbInput {
  x: number
  y: number
  hue: number
  scale: number
}

export interface OrbBackgroundOpts {
  /** Hue of the base oklch fill below the orbs. */
  baseHue: number
  /** 0..1 — animation pulse. <0.001 collapses to a neutral-grey base. */
  intensity: number
  /** Selects the dark or light palette branch. */
  isDark: boolean
}

/**
 * Single source of truth for the radial-gradient background. Used by both
 * the static `buildBackground()` (renders ServerTheme directly) and the
 * RAF-animated `useAnimatedTheme()` (renders an interpolated snapshot).
 */
export function buildOrbBackground(orbs: OrbInput[], opts: OrbBackgroundOpts): string {
  const { baseHue, intensity, isDark } = opts
  // Light mode: bright pastel orbs on a soft light base.
  // Dark  mode: deep saturated orbs on a near-black base.
  const baseL = isDark ? '11%' : '91.5%'

  // Neutral grey when there's nothing to render or intensity has faded out.
  if (intensity < 0.001 || orbs.length === 0) {
    return `oklch(${baseL} 0 0)`
  }

  const orbL      = isDark ? '36%'  : '83%'
  const orbC      = (isDark ? 0.10  : 0.11)  * intensity
  const blendOrbA = (isDark ? 0.95  : 0.92)  * intensity
  const baseC     = (isDark ? 0.018 : 0.021) * intensity

  const grads = orbs.map(o => {
    // farthest-corner + scale yields circular gradients whose radius scales
    // with the orb size (scale=1 → 72%, scale=1.5 → 108%, …).
    const spread = 72 * o.scale
    // Fade from full opacity to 0% of the same color so adjacent orbs blend
    // into each other instead of into transparent black.
    return `radial-gradient(circle farthest-corner at ${(o.x * 100).toFixed(1)}% ${(o.y * 100).toFixed(1)}%, oklch(${orbL} ${orbC.toFixed(4)} ${o.hue.toFixed(1)} / ${blendOrbA.toFixed(4)}) 0%, oklch(${orbL} ${orbC.toFixed(4)} ${o.hue.toFixed(1)} / 0) ${spread.toFixed(1)}%)`
  })
  return [...grads, `oklch(${baseL} ${baseC.toFixed(4)} ${baseHue.toFixed(1)})`].join(', ')
}

/** Radially mix the orbs into a CSS background string (static, intensity=1). */
export function buildBackground(theme: ServerTheme, isDark = false): string {
  // Base hue: explicit preset if set, otherwise the first orb's hue.
  const baseHue = theme.hue ?? (theme.orbs[0]?.hue ?? 0)
  const orbs: OrbInput[] = theme.orbs.map(o => ({
    x: o.x,
    y: o.y,
    hue: o.hue,
    scale: o.scale ?? 1,
  }))
  return buildOrbBackground(orbs, { baseHue, intensity: 1, isDark })
}

/**
 * Build the inline style object for the app root.
 * Explicitly computes every hue-dependent token so browsers never have to
 * re-evaluate `var(--theme-hue)` inside an inherited custom property value —
 * a case where some engines fall back to the :root definition instead.
 */
export function buildThemeStyle(
  hue: number | null,
  isDark: boolean,
  background: string,
): React.CSSProperties {
  const h = hue ?? 0
  // hasHue is true when there's a preset OR custom orb hues are in use
  const hasHue = hue !== null

  return {
    '--theme-hue':    h,
    '--accent':       hasHue ? `oklch(55% 0.18 ${h})` : 'oklch(55% 0 0)',
    '--accent-muted': hasHue ? `oklch(55% 0.18 ${h} / 0.12)` : 'oklch(55% 0 0 / 0.12)',
    '--accent-strong':hasHue ? `oklch(55% 0.18 ${h} / 0.24)` : 'oklch(55% 0 0 / 0.24)',
    '--accent-text':  hasHue
      ? (isDark ? `oklch(72% 0.14 ${h})` : `oklch(38% 0.14 ${h})`)
      : (isDark ? 'oklch(72% 0 0)'       : 'oklch(42% 0 0)'),
    background,
  } as React.CSSProperties
}

/** Randomise orb positions, keeping their hues and scales */
export function randomiseOrbs(orbs: ThemeOrb[]): ThemeOrb[] {
  return orbs.map(o => ({
    ...o,
    x: 0.08 + Math.random() * 0.84,
    y: 0.08 + Math.random() * 0.84,
  }))
}
