import { useState } from 'react';
import { getApiBaseUrl } from '../../platform/config';
import css from './ServerIcon.module.css';

interface ServerIconProps {
  name: string;
  iconUrl?: string | null;
  serverId?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

function iconEndpoint(serverId: string): string {
  return `${getApiBaseUrl()}/icons/${serverId}`;
}

const sizeClass: Record<string, string> = {
  xs: css.xs, sm: css.sm, md: css.md, lg: css.lg,
};
const fontClass: Record<string, string> = {
  xs: css.fontXs, sm: css.fontSm, md: css.fontMd, lg: css.fontLg,
};

export function ServerIcon({ name, iconUrl, serverId, size = 'md', className }: ServerIconProps) {
  const imgSrc = serverId && iconUrl ? iconEndpoint(serverId) : (iconUrl ?? undefined);
  const [imgError, setImgError] = useState(false);
  // Reset img-error when the underlying identity changes — store-prev-value pattern.
  const currentKey = serverId ?? iconUrl;
  const [prevKey, setPrevKey] = useState(currentKey);
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setImgError(false);
  }

  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const showImage = imgSrc && !imgError;

  if (showImage) {
    return (
      <div className={`${css.wrap} ${sizeClass[size]} ${className ?? ''}`}>
        <img
          src={imgSrc}
          alt={name}
          className={css.img}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div className={`${css.wrap} ${sizeClass[size]} ${className ?? ''}`}>
      <div className={`${css.fallback} ${fontClass[size]}`}>{initial}</div>
    </div>
  );
}
