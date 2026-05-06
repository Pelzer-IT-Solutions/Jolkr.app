import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Compute a screen position for a floating menu that stays inside the viewport.
 *
 * Anchors the menu to the click point, preferring to extend LEFT and DOWN from
 * the click (matching context-menu convention). Flips to the opposite side if
 * there isn't room, and clamps to keep at least `pad` px of breathing room from
 * each edge. Returns `null` until the menu has mounted and been measured.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null)
 *   const pos = useClampedMenuPosition({ x, y }, ref)
 *   <div ref={ref} style={pos ? { position: 'fixed', left: pos.left, top: pos.top, visibility: 'visible' }
 *                                : { position: 'fixed', visibility: 'hidden' }}>
 */
export function useClampedMenuPosition(
  preferred: { x: number; y: number } | null,
  ref: RefObject<HTMLElement | null>,
  pad = 8,
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!preferred || !ref.current) {
      // Defer setState past the effect body to satisfy set-state-in-effect.
      queueMicrotask(() => setPos(null))
      return
    }
    const el = ref.current
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal: prefer placing the menu so its RIGHT edge is at the click
    // point (matches the existing context-menu convention). If that pushes the
    // left edge off-screen, fall back to placing the LEFT edge at the click.
    let left = preferred.x - w
    if (left < pad) left = preferred.x
    if (left + w > vw - pad) left = Math.max(pad, vw - w - pad)

    // Vertical: prefer DOWN from the click. Flip UP if it would overflow the
    // bottom; clamp to the top edge if even the flipped position doesn't fit.
    let top = preferred.y
    if (top + h > vh - pad) top = preferred.y - h
    if (top < pad) top = pad

    queueMicrotask(() => setPos({ left, top }))
  }, [preferred, preferred?.x, preferred?.y, ref, pad])

  return pos
}
