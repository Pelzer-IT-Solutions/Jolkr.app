import type { MessageEmbed } from '../api/types';

interface LinkEmbedProps {
  embed: MessageEmbed;
}

export default function LinkEmbed({ embed }: LinkEmbedProps) {
  const borderColor = embed.color || '#5865F2';

  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-1 max-w-[400px] rounded-md overflow-hidden bg-zinc-800/50 border-l-4 hover:bg-zinc-800/80 transition-colors"
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
      {embed.image_url && (
        <img
          src={embed.image_url}
          alt=""
          className="w-full max-h-[200px] object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
    </a>
  );
}
