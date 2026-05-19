/** Reset :root tokens for auth/public pages — brand teal accents, grayscale chrome wash. */
export function resetAuthTheme() {
  const h = 182
  const rs = document.documentElement.style
  rs.setProperty('--theme-hue', String(h))
  rs.setProperty('--theme-neutral-c', '0')
  rs.setProperty('--theme-intensity', '0')
  rs.setProperty('--accent', `oklch(55% 0.18 ${h})`)
  rs.setProperty('--accent-muted', `oklch(55% 0.18 ${h} / 0.12)`)
  rs.setProperty('--accent-strong', `oklch(55% 0.18 ${h} / 0.24)`)
  rs.setProperty('--accent-text', `oklch(72% 0.14 ${h})`)
}
