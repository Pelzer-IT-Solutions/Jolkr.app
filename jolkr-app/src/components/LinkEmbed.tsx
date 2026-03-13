import { useState } from 'react';
import type { MessageEmbed } from '../api/types';

interface LinkEmbedProps {
  embed: MessageEmbed;
}

export default function LinkEmbed({ embed }: LinkEmbedProps) {
  const borderColor = embed.color || '#5865F2';
  const [imgErrored, setImgErrored] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const safeUrl = /^https?:\/\//i.test(embed.url) ? embed.url : '#';

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-1 max-w-100 rounded-md overflow-hidden bg-zinc-800/50 border-l-4 hover:bg-zinc-800/80 transition-colors"
      style={{ borderLeftColor: borderColor }}
    >
      <div className="p-3">
        {embed.site_name && (
          <div className="text-xs text-zinc-400 mb-1">{embed.site_name}</div>
        )}
        {embed.title && (
          <div className="text-sm font-semibold text-blue-400 hover:underline line-clamp-2">
            {embed.title}
          </div>
        )}
        {embed.description && (
          <div className="text-xs text-zinc-300 mt-1 line-clamp-3">
            {embed.description}
          </div>
        )}
      </div>
      {embed.image_url && !imgErrored && (
        <div className="relative aspect-video max-h-50 overflow-hidden">
          {!imgLoaded && (
            <div className="absolute inset-0 bg-hover animate-pulse" />
          )}
          <img
            src={embed.image_url}
            alt=""
            className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgErrored(true)}
          />
        </div>
      )}
    </a>
  );
}
