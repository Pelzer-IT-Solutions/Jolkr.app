/** Reset :root accent tokens to Jolkr brand teal (hue 182 ≈ #2DD4BF). */
export function resetAuthTheme() {
  const h = 182
  const rs = document.documentElement.style
  rs.setProperty('--theme-hue', String(h))
  rs.setProperty('--accent', `oklch(55% 0.18 ${h})`)
  rs.setProperty('--accent-muted', `oklch(55% 0.18 ${h} / 0.12)`)
  rs.setProperty('--accent-strong', `oklch(55% 0.18 ${h} / 0.24)`)
  rs.setProperty('--accent-text', `oklch(72% 0.14 ${h})`)
}
