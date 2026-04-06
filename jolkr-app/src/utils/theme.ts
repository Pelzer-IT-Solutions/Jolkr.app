import type React from 'react'
import type { ThemeOrb, ServerTheme } from '../types'

/** Default three-orb layout for a given primary hue */
export function orbsForHue(hue: number): ThemeOrb[] {
  return [
    { id: 'a', x: 0.22, y: 0.72, hue, scale: 1 },
    { id: 'b', x: 0.74, y: 0.28, hue: (hue + 22) % 360, scale: 1 },
    { id: 'c', x: 0.12, y: 0.22, hue: (hue - 18 + 360) % 360, scale: 1 },
  ]
}

/** Radially mix the orbs into a CSS background string */
export function buildBackground(theme: ServerTheme, isDark = false): string {
  // Light mode: bright pastel orbs on a soft light base
  // Dark  mode: deep saturated orbs on a near-black base
  const baseL = isDark ? '11%'   : '91.5%'

  // No orbs at all: neutral grey background
  if (theme.orbs.length === 0) {
    return `oklch(${baseL} 0 0)`
  }

  const orbL  = isDark ? '36%'    : '83%'
  const orbC  = isDark ? '0.10'   : '0.11'
  const baseC = isDark ? '0.018'  : '0.021'

  // Build orb gradients with scale support
  // Use increased opacity for better color mixing with blend modes
  const blendOrbA = isDark ? '0.95' : '0.92'
  
  const grads = theme.orbs.map(o => {
    const scale = o.scale ?? 1
    // Use farthest-corner with scale to create circular gradients
    // Scale affects the gradient spread (larger scale = larger orb)
    const spread = 72 * scale
    // Fade from full opacity to 0% of the same color (not transparent black)
    return `radial-gradient(circle farthest-corner at ${(o.x * 100).toFixed(1)}% ${(o.y * 100).toFixed(1)}%, oklch(${orbL} ${orbC} ${o.hue.toFixed(1)} / ${blendOrbA}) 0%, oklch(${orbL} ${orbC} ${o.hue.toFixed(1)} / 0) ${spread.toFixed(1)}%)`
  })

  // Base color: use theme hue if set, otherwise derive from first orb
  const baseHue = theme.hue ?? (theme.orbs[0]?.hue ?? 0)
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

/** Randomise orb positions, keeping their hues and scales */
export function randomiseOrbs(orbs: ThemeOrb[]): ThemeOrb[] {
  return orbs.map(o => ({
    ...o,
    x: 0.08 + Math.random() * 0.84,
    y: 0.08 + Math.random() * 0.84,
  }))
}
