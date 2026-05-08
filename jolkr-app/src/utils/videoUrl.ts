export type VideoPlatform = 'youtube' | 'vimeo' | 'twitch' | 'tiktok' | 'vidmount' | 'facebook' | 'dailymotion' | 'bitchute' | 'vidyard' | 'spotify' | 'direct' | 'hls';

/** Spotify resource kind — drives iframe height in VideoEmbed (compact for
 *  tracks, taller for collections). */
export type SpotifyKind = 'track' | 'album' | 'playlist' | 'artist' | 'episode' | 'show';

export interface VideoInfo {
  platform: VideoPlatform;
  id?: string;
  src?: string;
  kind?: 'channel' | 'vod' | 'clip' | SpotifyKind;
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
      // Clips: /channel/clip/ClipSlug or /clips.twitch.tv/ClipSlug
      const clipMatch = u.pathname.match(/^\/[a-zA-Z0-9_]+\/clip\/([a-zA-Z0-9_-]+)/);
      if (clipMatch) return { platform: 'twitch', id: clipMatch[1], kind: 'clip' };
      const channelMatch = u.pathname.match(/^\/([a-zA-Z0-9_]+)\/?$/);
      if (channelMatch) return { platform: 'twitch', id: channelMatch[1], kind: 'channel' };
    }
    if (host === 'clips.twitch.tv') {
      const clipId = u.pathname.slice(1).split('/')[0];
      if (clipId) return { platform: 'twitch', id: clipId, kind: 'clip' };
    }

    // TikTok
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const tiktokMatch = u.pathname.match(/\/video\/(\d+)/);
      if (tiktokMatch) return { platform: 'tiktok', id: tiktokMatch[1] };
    }

    // Facebook
    if (host === 'facebook.com' || host === 'fb.watch') {
      const fbVideoMatch = u.pathname.match(/\/(?:watch\/?\?v=|videos\/|reel\/)(\d+)/);
      if (fbVideoMatch) return { platform: 'facebook', id: fbVideoMatch[1], src: url };
      if (host === 'fb.watch') return { platform: 'facebook', id: u.pathname.slice(1), src: url };
    }

    // Dailymotion
    if (host === 'dailymotion.com' || host === 'dai.ly') {
      if (host === 'dai.ly') {
        const id = u.pathname.slice(1).split('/')[0];
        if (id) return { platform: 'dailymotion', id };
      }
      const dmMatch = u.pathname.match(/^\/video\/([a-z0-9]+)/i);
      if (dmMatch) return { platform: 'dailymotion', id: dmMatch[1] };
    }

    // Bitchute
    if (host === 'bitchute.com') {
      const bcMatch = u.pathname.match(/^\/video\/([a-zA-Z0-9_-]+)/);
      if (bcMatch) return { platform: 'bitchute', id: bcMatch[1], src: url };
    }

    // Vidyard
    if (host === 'vidyard.com' || host.endsWith('.vidyard.com')) {
      const vyMatch = u.pathname.match(/^\/watch\/([a-zA-Z0-9_-]+)/);
      if (vyMatch) return { platform: 'vidyard', id: vyMatch[1] };
    }

    // VidMount
    if (host === 'vidmount.com') {
      const watchMatch = u.pathname.match(/^\/watch\/([a-zA-Z0-9_-]+)/);
      if (watchMatch) return { platform: 'vidmount', id: watchMatch[1], src: url };
    }

    // Spotify (track, album, playlist, artist, episode, show)
    if (host === 'open.spotify.com') {
      // Pathname begins with optional locale (`/intl-nl/...`) which we
      // strip; the meaningful prefix is the resource kind. Spotify ids
      // are 22-char base62.
      const stripped = u.pathname.replace(/^\/intl-[a-z]{2}/i, '');
      const m = stripped.match(/^\/(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
      if (m) return { platform: 'spotify', id: m[2], kind: m[1] as SpotifyKind };
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
  vidmount: '#1570ef',
  facebook: '#1877F2',
  dailymotion: '#00AAFF',
  bitchute: '#EF4136',
  vidyard: '#00BF6F',
  spotify: '#1DB954',
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
  vidmount: 'VidMount',
  facebook: 'Facebook',
  dailymotion: 'Dailymotion',
  bitchute: 'BitChute',
  vidyard: 'Vidyard',
  spotify: 'Spotify',
  direct: 'Video',
  hls: 'Live Stream',
};

export function getPlatformName(platform: VideoPlatform): string {
  return PLATFORM_NAMES[platform];
}
