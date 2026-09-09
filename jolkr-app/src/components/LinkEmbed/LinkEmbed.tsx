import { useState } from 'react';
import { resolveContentUrl, isAppOriginUrl } from '../../utils/appOrigin';
import s from './LinkEmbed.module.css';
import type { MessageEmbed } from '../../api/types';

interface LinkEmbedProps {
  embed: MessageEmbed;
}

export function LinkEmbed({ embed }: LinkEmbedProps) {
  const borderColor = (embed.color && /^#[0-9a-fA-F]{3,6}$/.test(embed.color)) ? embed.color : '#5865F2';
  const [imgErrored, setImgErrored] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const safeUrl = /^https?:\/\//i.test(embed.url) ? embed.url : '#';
  // Only render the thumbnail if it is served from our own origin. An external
  // OG image URL would leak the viewer's IP / act as a tracking pixel, so it is
  // simply dropped — the embed's text + link still render.
  const showImage = embed.image_url && isAppOriginUrl(embed.image_url) && !imgErrored;

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={s.card}
      style={{ '--embed-color': borderColor } as React.CSSProperties}
    >
      <div className={s.body}>
        {embed.site_name && <div className={s.siteName}>{embed.site_name}</div>}
        {embed.title && <div className={s.title}>{embed.title}</div>}
        {embed.description && <div className={s.description}>{embed.description}</div>}
      </div>
      {showImage && (
        <div className={s.imageWrap}>
          {!imgLoaded && <div className={s.imagePlaceholder} />}
          <img
            className={s.image}
            src={resolveContentUrl(embed.image_url!)}
            alt=""
            style={{ opacity: imgLoaded ? 1 : 0 }}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgErrored(true)}
          />
        </div>
      )}
    </a>
  );
}
