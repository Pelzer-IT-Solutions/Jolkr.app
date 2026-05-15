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

  // Recalculate safe position once the menu is mounted so it can be measured.
  // useLayoutEffect is the textbook fit for measure-then-adjust patterns —
  // it runs synchronously after DOM mutation but before paint, so the user
  // never sees the unadjusted position. setState here is intentional: the
  // adjusted value depends on a DOM measurement that's only available after
  // mount, so it cannot be derived in render.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || disableAutoPosition) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- measure-then-adjust pattern; see comment above
      setSafePos(position)
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    setSafePos(getSafePosition(position, { width: rect.width, height: rect.height }))
  }, [open, position, disableAutoPosition])

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
