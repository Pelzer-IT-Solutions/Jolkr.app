import { useState } from 'react';
import type { MessageEmbed } from '../api/types';
import s from './LinkEmbed.module.css';

interface LinkEmbedProps {
  embed: MessageEmbed;
}

export default function LinkEmbed({ embed }: LinkEmbedProps) {
  const borderColor = (embed.color && /^#[0-9a-fA-F]{3,6}$/.test(embed.color)) ? embed.color : '#5865F2';
  const [imgErrored, setImgErrored] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const safeUrl = /^https?:\/\//i.test(embed.url) ? embed.url : '#';

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
      {embed.image_url && !imgErrored && (
        <div className={s.imageWrap}>
          {!imgLoaded && <div className={s.imagePlaceholder} />}
          <img
            className={s.image}
            src={embed.image_url}
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
