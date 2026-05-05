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

  // Clear stored position when the menu transitions from open → closed so a
  // stale coordinate doesn't paint at the wrong spot during the next open.
  // Tracks a boolean (open vs closed) rather than the `preferred` reference:
  // callers commonly pass `state ? { x: state.x, y: state.y } : null`, which
  // yields a brand-new object every render while the menu is open. Comparing
  // by reference here used to fire a setState every render, and combined
  // with the useLayoutEffect below — which kept `preferred` in its deps and
  // queued a setPos via microtask — produced an infinite update loop that
  // hit React's max update depth (#301) the moment the menu opened.
  const isOpen = preferred !== null
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen)
    if (!isOpen) setPos(null)
  }

  // Capture the coordinates as primitives so the effect deps stay stable
  // across the fresh-object-per-render call pattern from consumers.
  const px = preferred?.x ?? null
  const py = preferred?.y ?? null

  useLayoutEffect(() => {
    if (px === null || py === null || !ref.current) return
    const el = ref.current

    // Defer the measure into a microtask so the setState lives in an async
    // callback rather than the effect's synchronous body. Microtasks still
    // resolve before browser paint, so the menu's first visible frame is at
    // its clamped position — no flicker.
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Horizontal: prefer placing the menu so its RIGHT edge is at the click
      // point (matches the existing context-menu convention). If that pushes
      // the left edge off-screen, fall back to placing the LEFT edge at the
      // click.
      let left = px - w
      if (left < pad) left = px
      if (left + w > vw - pad) left = Math.max(pad, vw - w - pad)

      // Vertical: prefer DOWN from the click. Flip UP if it would overflow
      // the bottom; clamp to the top edge if even the flipped position
      // doesn't fit.
      let top = py
      if (top + h > vh - pad) top = py - h
      if (top < pad) top = pad

      setPos({ left, top })
    })
    return () => { cancelled = true }
  }, [px, py, ref, pad])

  return pos
}
