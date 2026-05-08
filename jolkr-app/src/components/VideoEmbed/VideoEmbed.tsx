import { useState, useEffect, memo } from 'react';
import type { MessageEmbed } from '../../api/types';
import type { VideoInfo } from '../../utils/videoUrl';
import { getYouTubeThumbnail, getPlatformColor, getPlatformName } from '../../utils/videoUrl';
import { getOembed } from '../../api/client';

import { isTauri } from '../../platform/detect';
import { Play, Video } from 'lucide-react';
import NMVideoPlayer from '../NMVideoPlayer/NMVideoPlayer';
import s from './VideoEmbed.module.css';

export interface VideoEmbedProps {
  embed: MessageEmbed;
  videoInfo: VideoInfo;
}

function VideoEmbedInner({ embed, videoInfo }: VideoEmbedProps) {
  const isIframePlatform = ['youtube', 'vimeo', 'twitch', 'tiktok', 'vidmount', 'facebook', 'dailymotion', 'vidyard', 'spotify'].includes(videoInfo.platform);
  const [expanded, setExpanded] = useState(isIframePlatform);
  const borderColor = getPlatformColor(videoInfo.platform);
  const platformName = embed.site_name || getPlatformName(videoInfo.platform);

  const [resolvedTitle, setResolvedTitle] = useState<string | null>(embed.title ?? null);
  useEffect(() => {
    if (embed.title) return;
    let cancelled = false;
    (async () => {
      try {
        // Twitch channels: use channel name directly
        if (videoInfo.platform === 'twitch' && videoInfo.id && videoInfo.kind === 'channel') {
          if (!cancelled) setResolvedTitle(videoInfo.id);
          return;
        }
        // Direct file URLs (mp4/webm/...) and bare HLS streams have no
        // oEmbed provider — skip the lookup so we don't pepper the proxy
        // with guaranteed 404s on URLs like content.jwplatform.com/*.m3u8.
        if (videoInfo.platform === 'direct' || videoInfo.platform === 'hls') return;
        const data = await getOembed(embed.url);
        if (data.title && !cancelled) setResolvedTitle(data.title);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [embed.title, embed.url, videoInfo.platform, videoInfo.id, videoInfo.kind]);

  const thumbnailUrl = embed.image_url || (videoInfo.platform === 'youtube' && videoInfo.id ? getYouTubeThumbnail(videoInfo.id) : null);

  return (
    <div className={s.card} style={{ '--embed-color': borderColor } as React.CSSProperties}>
      <div className={s.header}>
        <div className={s.siteName}>
          <span className={s.dot} style={{ backgroundColor: borderColor }} />
          {platformName}
        </div>
        {resolvedTitle && (
          <a href={embed.url} target="_blank" rel="noopener noreferrer" className={s.title}>
            {resolvedTitle}
          </a>
        )}
      </div>
      {expanded ? (
        <PlayerArea videoInfo={videoInfo} embed={embed} />
      ) : (
        <Thumbnail url={thumbnailUrl} platform={videoInfo.platform} onClick={() => setExpanded(true)} />
      )}
    </div>
  );
}

const VideoEmbed = memo(VideoEmbedInner);
export default VideoEmbed;

/* ── Thumbnail ── */

function Thumbnail({ url, platform, onClick }: { url: string | null; platform: string; onClick: () => void }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button className={s.thumb} onClick={onClick}>
      {url && !imgErr ? (
        <img className={s.thumbImg} src={url} alt="" loading="lazy" onError={() => setImgErr(true)} />
      ) : (
        <div className={s.placeholder}>
          <Video size={40} strokeWidth={1.5} />
          <span>{platform}</span>
        </div>
      )}
      <div className={s.thumbOverlay}>
        <div className={s.playCircle}>
          <Play size={28} color="black" fill="black" style={{ marginLeft: '0.125rem' }} />
        </div>
      </div>
    </button>
  );
}

/* ── Player Area ── */

function PlayerArea({ videoInfo, embed }: { videoInfo: VideoInfo; embed: MessageEmbed }) {
  const { platform, id, src, kind } = videoInfo;

  if (platform === 'youtube' && id)
    return <IframePlayer src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`} title="YouTube video" />;

  if (platform === 'vimeo' && id)
    return <IframePlayer src={`https://player.vimeo.com/video/${id}`} title="Vimeo video" />;

  if (platform === 'twitch' && id) {
    // Twitch's response sets `Content-Security-Policy: frame-ancestors <parent>`
    // where <parent> is whatever the `parent=` query string contains — there's
    // no server-side validation, the browser just enforces frame-ancestors.
    // To make the embed load from Tauri (origin "tauri.localhost") and from
    // web (origin "jolkr.app"), pass both as parents. Twitch supports multiple
    // `parent=` values and concatenates them all into the CSP.
    const parents = isTauri
      ? 'parent=tauri.localhost&parent=jolkr.app'
      : `parent=${window.location.hostname}`;
    // Twitch player/clip embeds default to autoplay=true; force to false so the
    // iframe loads paused (consistent with YouTube/Vimeo/VidMount behavior).
    const twitchSrc = kind === 'clip'
      ? `https://clips.twitch.tv/embed?clip=${id}&${parents}&autoplay=false`
      : kind === 'vod'
        ? `https://player.twitch.tv/?video=${id}&${parents}&autoplay=false`
        : `https://player.twitch.tv/?channel=${id}&${parents}&autoplay=false`;
    return <IframePlayer src={twitchSrc} title={kind === 'clip' ? 'Twitch clip' : 'Twitch stream'} />;
  }

  if (platform === 'tiktok' && id)
    return <IframePlayer src={`https://www.tiktok.com/embed/v2/${id}`} title="TikTok video" />;

  if (platform === 'vidmount' && id)
    return <IframePlayer src={`https://vidmount.com/embed/${id}`} title="VidMount video" />;

  if (platform === 'facebook' && src)
    return <IframePlayer src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(src)}&show_text=false`} title="Facebook video" />;

  if (platform === 'dailymotion' && id)
    return <IframePlayer src={`https://www.dailymotion.com/embed/video/${id}?autoplay=false`} title="Dailymotion video" />;

  if (platform === 'bitchute' && id)
    return <IframePlayer src={`https://www.bitchute.com/embed/${id}/`} title="BitChute video" />;

  if (platform === 'vidyard' && id)
    return <IframePlayer src={`https://play.vidyard.com/${id}`} title="Vidyard video" />;

  if ((platform === 'direct' || platform === 'hls') && src)
    return <NMVideoPlayer src={src} title={embed.title ?? ''} image={embed.image_url ?? ''} autoPlay />;

  if (platform === 'spotify' && id) {
    // Spotify iframe heights are fixed: tracks render compact (152 px),
    // collections render the full card (352 px). Anything else (artist /
    // episode / show) gets the full card too.
    const compact = kind === 'track';
    return <SpotifyEmbed src={`https://open.spotify.com/embed/${kind ?? 'track'}/${id}`} compact={compact} />;
  }

  return null;
}

/* ── Spotify iframe ── */

function SpotifyEmbed({ src, compact }: { src: string; compact: boolean }) {
  return (
    <div className={s.spotifyWrap} style={{ height: compact ? 152 : 352 }}>
      <iframe
        src={src}
        title="Spotify"
        loading="lazy"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/* ── Iframe player ── */

function IframePlayer({ src, title }: { src: string; title: string }) {
  return (
    <div className={s.playerWrap}>
      <iframe
        src={src}
        title={title}
        allow="accelerometer; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
