import { Users } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { hashColor, toMemberStatus, userToAvatar } from '../../adapters/transforms'
import { useLocaleFormatters } from '../../hooks/useLocaleFormatters'
import { useT } from '../../hooks/useT'
import { useAuthStore } from '../../stores/auth'
import { usePresenceStore } from '../../stores/presence'
import { displayName } from '../../utils/format'
import { Avatar } from '../Avatar/Avatar'
import s from './GroupInfoPopover.module.css'
import type { DMConversation, DMParticipant } from '../../types'

/** Open-state for the group-info popover. Mirrors `ProfileCardState` shape. */
export interface GroupInfoPopoverState {
  x: number
  y: number
  dmId: string
}

/** Status-key map mirrors `ProfileCard.STATUS_KEY` so localized labels stay
 *  consistent between user and group surfaces. */
const STATUS_KEY: Record<string, string> = {
  online: 'userStatus.online',
  idle: 'userStatus.idle',
  dnd: 'userStatus.dnd',
  offline: 'userStatus.offline',
}

export interface GroupInfoPopoverProps {
  state: GroupInfoPopoverState | null
  /** Resolved conversation for `state.dmId`. */
  conv: DMConversation | null
  onClose: () => void
  /** Click on a member row. Forwarded to the parent so it can open the
   *  shared `ProfileCard` popover anchored at the click point. */
  onOpenMemberProfile?: (userId: string, anchor: { x: number; y: number }) => void
}

export function GroupInfoPopover({
  state,
  conv,
  onClose,
  onOpenMemberProfile,
}: GroupInfoPopoverProps) {
  const { t } = useT()
  const fmt = useLocaleFormatters()
  const cardRef = useRef<HTMLDivElement>(null)
  // `participants` excludes self by convention (see `transformDmConversation`),
  // so we build a synthetic "me" row from auth + presence to give the popover
  // a complete member list and an accurate count.
  const me = useAuthStore(st => st.user)
  const selfPresence = usePresenceStore(st => (me ? st.statuses[me.id] : undefined))
  const selfParticipant: DMParticipant | null = useMemo(() => {
    if (!me) return null
    const { color, letter, avatarUrl } = userToAvatar(me)
    return {
      name: displayName(me),
      status: toMemberStatus(selfPresence ?? me.status),
      color,
      letter,
      avatarUrl,
      userId: me.id,
    }
  }, [me, selfPresence])

  // Memoise the anchor primitives so the layout effect doesn't re-fire on
  // every render of the parent.
  const anchor = useMemo(
    () => (state ? { x: state.x, y: state.y } : null),
    [state],
  )

  // Position the card within the viewport — mirrors ProfileCard's recipe.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !anchor) return
    const rect = card.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = anchor.x
    let y = anchor.y
    if (x + rect.width > vw - 16) x = vw - rect.width - 16
    if (x < 16) x = 16
    if (y + rect.height > vh - 16) y = Math.max(16, vh - rect.height - 16)
    if (y < 16) y = 16
    card.style.left = `${x}px`
    card.style.top = `${y}px`
  }, [anchor, conv])

  // Close on Escape — matches every other portal-style popover.
  useEffect(() => {
    if (!state) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, onClose])

  if (!state || !conv) return null

  const groupDisplayName = conv.name ?? conv.participants.map(p => p.name).join(', ')
  // `participants` is "everyone except me" — total group size is one greater.
  const memberCount = conv.participants.length + (selfParticipant ? 1 : 0)
  const bannerColor = hashColor(conv.id)
  const createdLabel = conv.createdAt ? fmt.formatDate(conv.createdAt, 'short') : null

  function handleMemberClick(e: React.MouseEvent<HTMLButtonElement>, p: DMParticipant) {
    if (!onOpenMemberProfile || !p.userId) return
    const rect = e.currentTarget.getBoundingClientRect()
    onOpenMemberProfile(p.userId, { x: rect.right, y: rect.top })
  }

  return createPortal(
    <>
      <div className={s.scrim} onClick={onClose} />
      <div
        ref={cardRef}
        className={s.card}
        role="dialog"
        aria-label={t('groupInfoPopover.ariaGroup', { name: groupDisplayName })}
      >
        <div className={s.banner} style={{ background: bannerColor }} />

        <div className={s.iconWrap} aria-hidden="true">
          <Users size={22} strokeWidth={1.75} />
        </div>

        <div className={s.body}>
          <div className={s.nameBlock}>
            <span className={`${s.displayName} txt-shout txt-bold`}>{groupDisplayName}</span>
            <span className={`${s.subtitle} txt-small`}>
              {t('groupInfoPopover.members', { count: memberCount })}
            </span>
          </div>

          {createdLabel && (
            <>
              <div className={s.divider} />
              <section className={s.section}>
                <h3 className={`${s.sectionLabel} txt-tiny`}>
                  {t('groupInfoPopover.createdOn')}
                </h3>
                <p className={`txt-small ${s.dim}`}>{createdLabel}</p>
              </section>
            </>
          )}

          <div className={s.divider} />

          <section className={s.section}>
            <h3 className={`${s.sectionLabel} txt-tiny`}>
              {t('groupInfoPopover.members', { count: memberCount })}
            </h3>
            <div className={`${s.memberList} scrollbar-thin`}>
              {selfParticipant && (
                <div className={`${s.memberRow} ${s.memberRowSelf}`}>
                  <Avatar
                    url={selfParticipant.avatarUrl}
                    name={selfParticipant.name}
                    size="sm"
                    status={selfParticipant.status}
                    userId={selfParticipant.userId}
                    color={selfParticipant.color}
                  />
                  <div className={s.memberMeta}>
                    <span className={`${s.memberName} txt-small txt-medium txt-truncate`}>
                      {t('groupInfoPopover.you', { name: selfParticipant.name })}
                    </span>
                    <span className={`${s.memberStatus} txt-tiny`}>
                      {STATUS_KEY[selfParticipant.status] ? t(STATUS_KEY[selfParticipant.status]) : selfParticipant.status}
                    </span>
                  </div>
                </div>
              )}
              {conv.participants.map((p, i) => (
                <button
                  key={p.userId ?? `slot-${i}`}
                  type="button"
                  className={s.memberRow}
                  onClick={(e) => handleMemberClick(e, p)}
                  disabled={!p.userId || !onOpenMemberProfile}
                >
                  <Avatar
                    url={p.avatarUrl}
                    name={p.name}
                    size="sm"
                    status={p.status}
                    userId={p.userId}
                    color={p.color}
                  />
                  <div className={s.memberMeta}>
                    <span className={`${s.memberName} txt-small txt-medium txt-truncate`}>
                      {p.name}
                    </span>
                    <span className={`${s.memberStatus} txt-tiny`}>
                      {STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]) : p.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>,
    document.body,
  )
}
