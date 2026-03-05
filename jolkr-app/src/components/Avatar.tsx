import { rewriteStorageUrl } from '../platform/config';

interface AvatarProps {
  url?: string | null;
  name: string;
  size?: number;
  status?: string | null;
}

export default function Avatar({ url, name, size = 40, status }: AvatarProps) {
  const resolvedUrl = rewriteStorageUrl(url);
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

  return (
    <div className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="rounded-full bg-primary flex items-center justify-center text-white font-semibold select-none"
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
