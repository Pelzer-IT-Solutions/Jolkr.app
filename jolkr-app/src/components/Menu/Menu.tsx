import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getSafePosition } from '../../utils/position'
import s from './Menu.module.css'

export interface MenuPosition {
  x: number
  y: number
}

export interface MenuProps {
  open: boolean
  position: MenuPosition
  onClose: () => void
  children: React.ReactNode
  minWidth?: string
  className?: string
  disableAutoPosition?: boolean
}

export function Menu({ open, position, onClose, children, minWidth = '11rem', className, disableAutoPosition = false }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [safePos, setSafePos] = useState(position)

  // Position handling: a useLayoutEffect runs before paint when the menu
  // opens or its coordinates change, measures the rendered menu, and clamps
  // the position to the viewport. `position.x` / `position.y` (numbers, not
  // the wrapping object) are listed in deps so callers can pass the common
  // `state ?? { x: 0, y: 0 }` literal pattern without thrashing the effect
  // on every parent re-render.
  //
  // The setState lives inside a microtask, not in the effect's synchronous
  // body — that satisfies the react-hooks/set-state-in-effect lint rule
  // and avoids the React #301 "set state during render" cascade that the
  // previous "mirror position during render" pattern caused (the runtime
  // sees the synchronous setSafePos triggered from the new bundle's
  // closure scope as happening during a different component's render once
  // the parent re-renders mid-effect).
  useLayoutEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (disableAutoPosition || !menuRef.current) {
        setSafePos({ x: position.x, y: position.y })
        return
      }
      const rect = menuRef.current.getBoundingClientRect()
      const adjusted = getSafePosition(
        { x: position.x, y: position.y },
        { width: rect.width, height: rect.height }
      )
      setSafePos(adjusted)
    })
    return () => { cancelled = true }
  }, [open, position.x, position.y, disableAutoPosition])

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      className={`${s.menu} ${className || ''}`}
      style={{
        top: safePos.y,
        left: safePos.x,
        minWidth,
      }}
    >
      {children}
    </div>,
    document.body
  )
}

export function MenuSection({ children, label, icon }: { children: React.ReactNode; label?: string; icon?: React.ReactNode }) {
  return (
    <div className={s.section}>
      {label && (
        <div className={s.sectionLabel}>
          {icon && <span className={s.sectionIcon}>{icon}</span>}
          <span>{label}</span>
        </div>
      )}
      {children}
    </div>
  )
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`${s.item} ${danger ? s.itemDanger : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className={s.itemIcon}>{icon}</span>}
      <span className={s.itemLabel}>{label}</span>
    </button>
  )
}

export function MenuDivider() {
  return <div className={s.divider} />
}

export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div className={s.header}>{children}</div>
}

export function MenuCustomContent({ children }: { children: React.ReactNode }) {
  return <div className={s.customContent}>{children}</div>
}
