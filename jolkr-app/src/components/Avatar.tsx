import { useState, useRef } from 'react';
import { rewriteStorageUrl } from '../platform/config';
import * as api from '../api/client';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface AvatarProps {
  url?: string | null;
  name: string;
  size?: AvatarSize | number;
  status?: string | null;
  userId?: string;
  className?: string;
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
  const [resolvedUrl, setResolvedUrl] = useState(() => rewriteStorageUrl(url));
  const [imgError, setImgError] = useState(false);
  const retriedRef = useRef(false);
  const prevUrlRef = useRef(url);

  if (url !== prevUrlRef.current) {
    prevUrlRef.current = url;
    setResolvedUrl(rewriteStorageUrl(url));
    setImgError(false);
    retriedRef.current = false;
  }

  const initials = (name.trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()) || '?';

  const handleError = async () => {
    if (!retriedRef.current && userId) {
      retriedRef.current = true;
      try {
        const freshUser = await api.getUser(userId);
        const freshUrl = rewriteStorageUrl(freshUser.avatar_url);
        if (freshUrl) {
          setResolvedUrl(freshUrl);
          return;
        }
      } catch { /* fall through */ }
    }
    setImgError(true);
  };

  const resolved = resolveSize(size);
  const s = sizeMap[resolved];
  const showImage = resolvedUrl && !imgError;

  return (
    <div className={`relative inline-block shrink-0 ${s.container} ${className ?? ''}`}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={name}
          className={`${s.container} rounded-full object-cover`}
          loading="lazy"
          onError={handleError}
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
