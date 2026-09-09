/**
 * Reset :root tokens for auth/public pages — logo olive accent, grayscale chrome wash.
 *
 * The accent is the olive from the Jolkr mark, #697B4B, which is also what the
 * landing page and the error pages use. These pages previously sat on teal
 * (hue 182), a colour that appears nowhere in the brand.
 *
 * White on this olive measures 4.63:1, so the primary button clears WCAG AA
 * for normal text. Pick a lighter olive and it stops clearing.
 */
export function resetAuthTheme() {
  // #697B4B expressed in oklch.
  const h = 125.4
  const c = 0.073
  // useAnimatedTheme sets these same custom properties inline, so every one of
  // them has to be written back here — anything left unset keeps the value the
  // in-app theme was last animated to.
  const rs = document.documentElement.style
  rs.setProperty('--theme-hue', String(h))
  rs.setProperty('--theme-neutral-c', '0')
  rs.setProperty('--theme-intensity', '0')
  rs.setProperty('--accent', `oklch(55.6% ${c} ${h})`)
  rs.setProperty('--accent-muted', `oklch(55.6% ${c} ${h} / 0.12)`)
  rs.setProperty('--accent-strong', `oklch(55.6% ${c} ${h} / 0.24)`)
  // Accent text has to clear its background, which differs per colour mode —
  // the same 72/42 split useAnimatedTheme applies. Writing one fixed value here
  // (it used to be 72% in both) leaves light mode with unreadably pale text.
  const dark = document.documentElement.classList.contains('dark')
  rs.setProperty('--accent-text', `oklch(${dark ? 72 : 42}% ${c} ${h})`)
}
