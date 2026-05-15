import { ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import { useT } from '../../hooks/useT'
import { revealDelay } from '../../utils/animations'
import s from './SettingsShell.module.css'

/** A single nav item rendered in the shell's left rail. */
export interface SettingsNavItem<TSection extends string> {
  /** Stable id used for selection comparison. */
  id: TSection
  label: string
  icon: ReactNode
  /** Optional badge shown after the label. Hidden when 0 or undefined. */
  count?: number
  /** Visual variant — `danger` highlights destructive sections like Delete Server. */
  variant?: 'default' | 'danger'
}

export interface SettingsNavGroup<TSection extends string> {
  /** Group heading (e.g. "Server Settings"). */
  group: string
  items: SettingsNavItem<TSection>[]
}

export interface SettingsShellProps<TSection extends string> {
  /** Which section is currently selected. */
  section: TSection
  onSection: (section: TSection) => void
  /** Click outside, Escape, or close button. */
  onClose: () => void
  /** Nav groups rendered in the left rail. */
  navGroups: SettingsNavGroup<TSection>[]
  /** Optional element rendered above the nav groups (e.g. server icon + name). */
  navHeader?: ReactNode
  /** Optional element rendered at the bottom of the nav (e.g. Leave Server button). */
  navFooter?: ReactNode
  /** Drop the default content padding — useful for sections that own their own scroll layout (e.g. Roles). */
  scrollNoPadding?: boolean
  /** Section content. */
  children: ReactNode
}

/**
 * Shared chrome for user / server / channel settings dialogs.
 *
 * Owns:
 * - Portal-rendered overlay + centered card modal
 * - Escape-to-close + click-outside-to-close
 * - Left nav with grouped items, badges, danger variant, active chevron
 * - Reveal animation on first paint
 *
 * Each consumer provides its own `navGroups`, current `section`, optional
 * `navHeader` / `navFooter`, and the content for the selected section as `children`.
 */
export function SettingsShell<TSection extends string>({
  section,
  onSection,
  onClose,
  navGroups,
  navHeader,
  navFooter,
  scrollNoPadding,
  children,
}: SettingsShellProps<TSection>) {
  const { t } = useT()
  // One animation tick per group + per item, plus 1 for the optional header.
  const navTotal = useMemo(
    () => navGroups.reduce((sum, g) => sum + 1 + g.items.length, 0) + (navHeader ? 1 : 0),
    [navGroups, navHeader],
  )
  const isRevealing = useRevealAnimation(navTotal, [navTotal])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  let navIdx = 0
  const headerStaggerIdx = navHeader ? navIdx++ : -1

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        <button className={s.closeBtnOverlay} onClick={onClose} aria-label={t('common.close')}>
          <X size={18} strokeWidth={1.5} />
        </button>

        <aside className={s.nav}>
          <div className={`${s.navScroll} scrollbar-thin`}>
            {navHeader && (
              <>
                <div
                  className={`${s.navHeader} ${isRevealing ? 'revealing' : ''}`}
                  style={isRevealing ? { '--reveal-delay': `${revealDelay(headerStaggerIdx)}ms` } as React.CSSProperties : undefined}
                >
                  {navHeader}
                </div>
                <div className={s.navDivider} />
              </>
            )}
            {navGroups.map(group => {
              const groupIdx = navIdx++
              return (
                <div key={group.group} className={s.navGroup}>
                  <span
                    className={`${s.navGroupLabel} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
                    style={isRevealing ? { '--reveal-delay': `${revealDelay(groupIdx)}ms` } as React.CSSProperties : undefined}
                  >
                    {group.group}
                  </span>
                  {group.items.map(item => {
                    const itemIdx = navIdx++
                    const isActive = section === item.id
                    const isDanger = item.variant === 'danger'
                    return (
                      <button
                        key={item.id}
                        className={[
                          s.navItem,
                          isActive ? s.navItemActive : '',
                          isDanger ? s.navItemDanger : '',
                          isRevealing ? 'revealing' : '',
                        ].filter(Boolean).join(' ')}
                        style={isRevealing ? { '--reveal-delay': `${revealDelay(itemIdx)}ms` } as React.CSSProperties : undefined}
                        onClick={() => onSection(item.id)}
                      >
                        <span className={s.navIcon}>{item.icon}</span>
                        <span className={`${s.navLabel} txt-small txt-medium`}>{item.label}</span>
                        {item.count !== undefined && item.count > 0 && (
                          <span className={s.navBadge}>{item.count}</span>
                        )}
                        <span className={s.navSpacer} />
                        {isActive && <ChevronRight size={12} strokeWidth={2} className={s.navChevron} />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {navFooter && (
            <div className={s.navFooter}>{navFooter}</div>
          )}
        </aside>

        <main className={s.content}>
          <div className={`${scrollNoPadding ? `${s.scroll} ${s.scrollNoPadding}` : s.scroll} scrollbar-thin`}>
            {children}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  )
}
