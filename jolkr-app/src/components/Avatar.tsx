import { useState, useRef } from 'react';
import { rewriteStorageUrl } from '../platform/config';
import * as api from '../api/client';

interface AvatarProps {
  url?: string | null;
  name: string;
  size?: number;
  status?: string | null;
  /** User ID — enables auto-refresh of expired presigned avatar URLs */
  userId?: string;
}

export default function Avatar({ url, name, size = 40, status, userId }: AvatarProps) {
  const [resolvedUrl, setResolvedUrl] = useState(() => rewriteStorageUrl(url));
  const [imgError, setImgError] = useState(false);
  const retriedRef = useRef(false);
  const prevUrlRef = useRef(url);

  // Reset state when the url prop changes (e.g. parent re-fetched)
  if (url !== prevUrlRef.current) {
    prevUrlRef.current = url;
    const newResolved = rewriteStorageUrl(url);
    setResolvedUrl(newResolved);
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

  const statusColor: Record<string, string> = {
    online: 'bg-online',
    idle: 'bg-idle',
    dnd: 'bg-dnd',
    offline: 'bg-text-muted',
  };

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

  const showImage = resolvedUrl && !imgError;

  return (
    <div className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={name}
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
          loading="lazy"
          onError={handleError}
        />
      ) : (
        <div
          className="rounded-full bg-primary flex items-center justify-center text-bg font-semibold select-none"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          {initials}
        </div>
      )}
      {status && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 z-10 rounded-full border-2 border-bg ${statusColor[status] ?? 'bg-text-muted'}`}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
