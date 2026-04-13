import { useState, useRef } from 'react'
import { getApiBaseUrl } from '../platform/config'
import { useAuthStore } from '../stores/auth'
import s from './Avatar.module.css'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

interface AvatarProps {
  url?: string | null
  name: string
  size?: AvatarSize | number
  status?: string | null
  userId?: string
  className?: string
  color?: string
}

function avatarEndpoint(userId: string, versionHint?: string | null): string {
  const base = getApiBaseUrl()
  if (!versionHint) return `${base}/avatars/${userId}`
  // Append cache-buster so the browser fetches the new image when the
  // avatar changes (the endpoint responds with max-age=86400).
  // Accept both ?v=<id> query params and S3 key paths (uploads/UUID.webp).
  const vParam = versionHint.match(/[?&]v=([^&]+)/)?.[1]
  if (vParam) return `${base}/avatars/${userId}?v=${vParam}`
  const v = versionHint.split('/').pop()?.split('.')[0]
  return v ? `${base}/avatars/${userId}?v=${v}` : `${base}/avatars/${userId}`
}

function resolveSize(size: AvatarSize | number): AvatarSize {
  if (typeof size === 'string') return size
  if (size <= 24) return 'xs'
  if (size <= 32) return 'sm'
  if (size <= 36) return 'md'
  if (size <= 40) return 'lg'
  if (size <= 48) return 'xl'
  return '2xl'
}

const sizeClass: Record<AvatarSize, string> = {
  xs: s.xs, sm: s.sm, md: s.md, lg: s.lg, xl: s.xl, '2xl': s.xxl,
}
const fontClass: Record<AvatarSize, string> = {
  xs: s.fontXs, sm: s.fontSm, md: s.fontMd, lg: s.fontLg, xl: s.fontXl, '2xl': s.fontXxl,
}
const statusSizeClass: Record<AvatarSize, string> = {
  xs: s.statusXs, sm: s.statusSm, md: s.statusMd, lg: s.statusLg, xl: s.statusXl, '2xl': s.statusXxl,
}
const statusColorClass: Record<string, string> = {
  online: s.online, idle: s.idle, dnd: s.dnd, offline: s.offline,
}

export default function Avatar({ url, name, size = 'lg', status, userId, className, color }: AvatarProps) {
  // For the current user, always use the auth store's avatar_url as version
  // hint so ALL Avatar instances refresh immediately after an avatar change,
  // regardless of whether the caller's data (member list, DM list, etc.) is stale.
  const currentUser = useAuthStore(s => s.user)
  const versionHint = (userId && currentUser && userId === currentUser.id)
    ? currentUser.avatar_url
    : url
  const imgSrc = userId && (url || versionHint) ? avatarEndpoint(userId, versionHint) : (url ?? undefined)
  const [imgError, setImgError] = useState(false)
  const prevKeyRef = useRef(userId ?? url)

  const currentKey = userId ?? url
  if (currentKey !== prevKeyRef.current) {
    prevKeyRef.current = currentKey
    setImgError(false)
  }

  const initials = (name.trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()) || '?'

  const resolved = resolveSize(size)
  const showImage = imgSrc && !imgError

  return (
    <div className={`${s.wrap} ${sizeClass[resolved]} ${className ?? ''}`}>
      {showImage ? (
        <img
          src={imgSrc}
          alt={name}
          className={s.img}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`${s.fallback} ${fontClass[resolved]}`} style={color ? { background: color } : undefined}>
          {initials}
        </div>
      )}
      {status && (
        <div
          className={`${s.statusDot} ${resolved === 'xs' ? s.statusBorderThin : ''} ${statusSizeClass[resolved]} ${statusColorClass[status] ?? s.offline}`}
        />
      )}
    </div>
  )
}
