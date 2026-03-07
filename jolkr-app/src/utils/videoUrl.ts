export type VideoPlatform = 'youtube' | 'vimeo' | 'twitch' | 'tiktok' | 'direct' | 'hls';

export interface VideoInfo {
  platform: VideoPlatform;
  id?: string;
  src?: string;
  kind?: 'channel' | 'vod';
}

const DIRECT_VIDEO_EXTS = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
const HLS_EXT = /\.m3u8(\?.*)?$/i;

export function parseVideoUrl(url: string): VideoInfo | null {
  if (!url) return null;

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');

    // YouTube
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      // /watch?v=ID
      const v = u.searchParams.get('v');
      if (v) return { platform: 'youtube', id: v };
      // /shorts/ID, /live/ID, /embed/ID
      const shortMatch = u.pathname.match(/^\/(shorts|live|embed)\/([^/?]+)/);
      if (shortMatch) return { platform: 'youtube', id: shortMatch[2] };
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return { platform: 'youtube', id };
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const vimeoMatch = u.pathname.match(/^\/(\d+)/);
      if (vimeoMatch) return { platform: 'vimeo', id: vimeoMatch[1] };
    }

    // Twitch
    if (host === 'twitch.tv') {
      const vodMatch = u.pathname.match(/^\/videos\/(\d+)/);
      if (vodMatch) return { platform: 'twitch', id: vodMatch[1], kind: 'vod' };
      const channelMatch = u.pathname.match(/^\/([a-zA-Z0-9_]+)\/?$/);
      if (channelMatch) return { platform: 'twitch', id: channelMatch[1], kind: 'channel' };
    }

    // TikTok
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const tiktokMatch = u.pathname.match(/\/video\/(\d+)/);
      if (tiktokMatch) return { platform: 'tiktok', id: tiktokMatch[1] };
    }

    // HLS
    if (HLS_EXT.test(u.pathname)) {
      return { platform: 'hls', src: url };
    }

    // Direct video
    if (DIRECT_VIDEO_EXTS.test(u.pathname)) {
      return { platform: 'direct', src: url };
    }
  } catch {
    // Invalid URL
  }

  return null;
}

export function isVideoUrl(url: string): boolean {
  return parseVideoUrl(url) !== null;
}

export function getYouTubeThumbnail(id: string): string {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

const PLATFORM_COLORS: Record<VideoPlatform, string> = {
  youtube: '#FF0000',
  vimeo: '#1AB7EA',
  twitch: '#9146FF',
  tiktok: '#EE1D52',
  direct: '#5865F2',
  hls: '#00E5A0',
};

export function getPlatformColor(platform: VideoPlatform): string {
  return PLATFORM_COLORS[platform];
}

const PLATFORM_NAMES: Record<VideoPlatform, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
  tiktok: 'TikTok',
  direct: 'Video',
  hls: 'Live Stream',
};

export function getPlatformName(platform: VideoPlatform): string {
  return PLATFORM_NAMES[platform];
}
