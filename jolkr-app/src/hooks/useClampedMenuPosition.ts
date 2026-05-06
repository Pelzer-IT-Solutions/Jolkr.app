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

  // Read primitives off `preferred` so the effect's deps are stable even when
  // callers pass a fresh `{ x, y }` literal each render — declaring the object
  // itself in deps would re-fire the effect on every parent render and
  // (combined with setPos creating a new {left,top}) loops the renderer.
  const px = preferred?.x ?? null
  const py = preferred?.y ?? null

  useLayoutEffect(() => {
    if (px === null || py === null || !ref.current) {
      // Defer setState past the effect body to satisfy set-state-in-effect.
      // Equality-guard so we don't trigger a render when pos is already null.
      queueMicrotask(() => setPos((prev) => (prev === null ? prev : null)))
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
    let left = px - w
    if (left < pad) left = px
    if (left + w > vw - pad) left = Math.max(pad, vw - w - pad)

    // Vertical: prefer DOWN from the click. Flip UP if it would overflow the
    // bottom; clamp to the top edge if even the flipped position doesn't fit.
    let top = py
    if (top + h > vh - pad) top = py - h
    if (top < pad) top = pad

    // Equality-guard: avoid emitting a new {left,top} object on every effect
    // run when the values haven't changed — prevents a render cascade because
    // useState compares references (Object.is).
    queueMicrotask(() =>
      setPos((prev) =>
        prev && prev.left === left && prev.top === top ? prev : { left, top },
      ),
    )
  }, [px, py, ref, pad])

  return pos
}
