import type React from 'react'
import type { ThemeOrb, ServerTheme } from '../types'

/** Default three-orb layout for a given primary hue */
export function orbsForHue(hue: number): ThemeOrb[] {
  return [
    { id: 'a', x: 0.22, y: 0.72, hue },
    { id: 'b', x: 0.74, y: 0.28, hue: (hue + 22) % 360 },
    { id: 'c', x: 0.12, y: 0.22, hue: (hue - 18 + 360) % 360 },
  ]
}

/** Radially mix the orbs into a CSS background string */
export function buildBackground(theme: ServerTheme, isDark = false): string {
  // Light mode: bright pastel orbs on a soft light base
  // Dark  mode: deep saturated orbs on a near-black base
  const baseL = isDark ? '11%'   : '91.5%'

  // Theme-less server with no orbs: neutral grey background
  if (theme.hue === null && theme.orbs.length === 0) {
    return `oklch(${baseL} 0 0)`
  }

  const orbL  = isDark ? '36%'    : '83%'
  const orbC  = isDark ? '0.10'   : '0.11'
  const orbA  = isDark ? '0.88'   : '0.82'
  const baseC = isDark ? '0.018'  : '0.021'

  // Derive base hue from first orb if no preset hue is set (custom hue wheel edit)
  const baseHue = theme.hue ?? (theme.orbs[0]?.hue ?? 0)

  const grads = theme.orbs.map(o => {
    const spread = (72 * (o.scale ?? 1)).toFixed(1)
    return `radial-gradient(ellipse ${spread}% ${spread}% at ${(o.x * 100).toFixed(1)}% ${(o.y * 100).toFixed(1)}%, oklch(${orbL} ${orbC} ${o.hue.toFixed(1)} / ${orbA}) 0%, transparent 100%)`
  })
  const base = `oklch(${baseL} ${baseC} ${baseHue.toFixed(1)})`
  return [...grads, base].join(', ')
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

/** Randomise orb positions, keeping their hues */
export function randomiseOrbs(orbs: ThemeOrb[]): ThemeOrb[] {
  return orbs.map(o => ({
    ...o,
    x: 0.08 + Math.random() * 0.84,
    y: 0.08 + Math.random() * 0.84,
  }))
}
