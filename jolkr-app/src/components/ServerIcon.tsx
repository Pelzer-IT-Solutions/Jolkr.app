import { useState, useRef } from 'react';
import { rewriteStorageUrl } from '../platform/config';

interface ServerIconProps {
  name: string;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: { container: 'size-10', font: 'text-sm', radius: 'rounded-xl' },
  md: { container: 'size-12', font: 'text-lg', radius: 'rounded-2xl' },
  lg: { container: 'size-14', font: 'text-xl', radius: 'rounded-2xl' },
};

export default function ServerIcon({ name, iconUrl, size = 'md', className }: ServerIconProps) {
  const resolved = rewriteStorageUrl(iconUrl);
  const [imgError, setImgError] = useState(false);
  const prevUrl = useRef(iconUrl);

  if (iconUrl !== prevUrl.current) {
    prevUrl.current = iconUrl;
    setImgError(false);
  }

  const s = sizeMap[size];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (resolved && !imgError) {
    return (
      <img
        src={resolved}
        alt={name}
        className={`${s.container} ${s.radius} object-cover shrink-0 ${className ?? ''}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={`${s.container} ${s.radius} bg-panel flex items-center justify-center shrink-0 ${className ?? ''}`}>
      <span className={`${s.font} font-bold text-text-primary select-none`}>{initial}</span>
    </div>
  );
}
