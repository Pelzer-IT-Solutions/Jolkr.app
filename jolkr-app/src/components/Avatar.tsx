import { useState, useRef } from 'react';
import { getApiBaseUrl } from '../platform/config';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface AvatarProps {
  /** Presigned S3 URL (legacy) or ignored when userId is set */
  url?: string | null;
  name: string;
  size?: AvatarSize | number;
  status?: string | null;
  /** When set, avatar is loaded via /api/avatars/:userId (cached, no presign) */
  userId?: string;
  className?: string;
}

/** Build a direct avatar URL that the backend serves with cache headers. */
function avatarEndpoint(userId: string): string {
  const base = getApiBaseUrl()  // "/api" for web, "https://jolkr.app/api" for Tauri
  return `${base}/avatars/${userId}`
}

/** Map legacy numeric sizes to named variants */
function resolveSize(size: AvatarSize | number): AvatarSize {
  if (typeof size === 'string') return size;
  if (size <= 24) return 'xs';
  if (size <= 32) return 'sm';
  if (size <= 36) return 'md';
  if (size <= 40) return 'lg';
  if (size <= 48) return 'xl';
  return '2xl';
}

const sizeMap: Record<AvatarSize, { container: string; font: string; status: string; statusBorder: string }> = {
  xs:  { container: 'size-6',  font: 'text-2xs', status: 'size-2',   statusBorder: 'border' },
  sm:  { container: 'size-8',  font: 'text-xs',  status: 'size-2.5', statusBorder: 'border-2' },
  md:  { container: 'size-9',  font: 'text-sm',  status: 'size-3',   statusBorder: 'border-2' },
  lg:  { container: 'size-10', font: 'text-base', status: 'size-3',   statusBorder: 'border-2' },
  xl:  { container: 'size-12', font: 'text-lg',  status: 'size-3.5', statusBorder: 'border-2' },
  '2xl': { container: 'size-14', font: 'text-xl',  status: 'size-4',   statusBorder: 'border-2' },
};

const statusColors: Record<string, string> = {
  online: 'bg-online',
  idle: 'bg-idle',
  dnd: 'bg-dnd',
  offline: 'bg-offline',
};

export default function Avatar({ url, name, size = 'lg', status, userId, className }: AvatarProps) {
  // Prefer the dedicated avatar endpoint when we have a userId
  const imgSrc = userId ? avatarEndpoint(userId) : (url ?? undefined);
  const [imgError, setImgError] = useState(false);
  const prevKeyRef = useRef(userId ?? url);

  // Reset error state when the identity changes
  const currentKey = userId ?? url;
  if (currentKey !== prevKeyRef.current) {
    prevKeyRef.current = currentKey;
    setImgError(false);
  }

  const initials = (name.trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()) || '?';

  const resolved = resolveSize(size);
  const s = sizeMap[resolved];
  const showImage = imgSrc && !imgError;

  return (
    <div className={`relative inline-block shrink-0 ${s.container} ${className ?? ''}`}>
      {showImage ? (
        <img
          src={imgSrc}
          alt={name}
          className={`${s.container} rounded-full object-cover`}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`${s.container} rounded-full bg-accent flex items-center justify-center text-bg font-semibold select-none ${s.font}`}>
          {initials}
        </div>
      )}
      {status && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 z-10 rounded-full ${s.statusBorder} border-sidebar ${s.status} ${statusColors[status] ?? 'bg-offline'}`}
        />
      )}
    </div>
  );
}
