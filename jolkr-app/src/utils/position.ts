import { useState, useEffect } from 'react'

export interface Position { x: number; y: number }
export interface Rect { width: number; height: number }

/**
 * Calculates a safe position for a popup/menu to ensure it stays within viewport.
 * @param triggerPos - The position where the menu was triggered (e.g., mouse click)
 * @param menuSize - The width and height of the menu
 * @param viewportSize - The width and height of the viewport (defaults to window.innerWidth/Height)
 * @param padding - Padding from viewport edges (default: 8px)
 * @returns Safe x, y coordinates for the menu
 */
export function getSafePosition(
  triggerPos: Position,
  menuSize: Rect,
  viewportSize: Rect = { width: window.innerWidth, height: window.innerHeight },
  padding: number = 8
): Position {
  let x = triggerPos.x
  let y = triggerPos.y

  // Check right edge - if menu would overflow, position it to the left of cursor
  if (x + menuSize.width + padding > viewportSize.width) {
    x = triggerPos.x - menuSize.width
    // If still overflowing left edge, align to left edge with padding
    if (x < padding) {
      x = padding
    }
  }

  // Check bottom edge - if menu would overflow, position it above cursor
  if (y + menuSize.height + padding > viewportSize.height) {
    y = triggerPos.y - menuSize.height
    // If still overflowing top edge, align to top edge with padding
    if (y < padding) {
      y = padding
    }
  }

  // Ensure minimum padding from top and left edges
  x = Math.max(padding, x)
  y = Math.max(padding, y)

  return { x, y }
}

/**
 * Hook-friendly version that uses refs to measure menu and calculate position
 */
export function useMenuPosition(
  triggerPos: Position | null,
  menuRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
): Position {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })

  useEffect(() => {
    if (!isOpen || !triggerPos || !menuRef.current) return

    const menuRect = menuRef.current.getBoundingClientRect()
    const safePos = getSafePosition(
      triggerPos,
      { width: menuRect.width, height: menuRect.height }
    )
    setPosition(safePos)
  }, [isOpen, triggerPos, menuRef])

  return position
}
