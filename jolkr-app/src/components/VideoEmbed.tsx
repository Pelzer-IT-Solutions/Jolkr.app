import { useState, useRef, useCallback, useEffect, memo } from 'react';
import type { MessageEmbed } from '../api/types';
import type { VideoInfo } from '../utils/videoUrl';
import { getYouTubeThumbnail, getPlatformColor, getPlatformName } from '../utils/videoUrl';
import { getApiBaseUrl } from '../platform/config';
import { useNMPlayer } from '../hooks/useNMPlayer';

const apiBase = getApiBaseUrl().replace(/\/api$/, '');
import Spinner from './ui/Spinner';
import { isTauri } from '../platform/detect';
import { Play, Pause, Volume2, VolumeX, Maximize, Video } from 'lucide-react';
import s from './VideoEmbed.module.css';

export interface VideoEmbedProps {
  embed: MessageEmbed;
  videoInfo: VideoInfo;
}

function VideoEmbedInner({ embed, videoInfo }: VideoEmbedProps) {
  const isIframePlatform = ['youtube', 'vimeo', 'twitch', 'tiktok', 'vidmount', 'facebook', 'dailymotion', 'vidyard'].includes(videoInfo.platform);
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
        // All platforms: fetch title via our oEmbed proxy
        const res = await fetch(`${apiBase}/api/oembed?url=${encodeURIComponent(embed.url)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.title && !cancelled) setResolvedTitle(data.title);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [embed.title, videoInfo.platform, videoInfo.id, videoInfo.kind]);

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
    // Twitch's embed validates the `parent` param against a registered domain.
    // In Tauri/web-localhost the `window.location.hostname` is `tauri.localhost`
    // or `localhost`, which Twitch rejects — fall back to the public app domain.
    const rawHost = isTauri ? 'jolkr.app' : window.location.hostname;
    const host = rawHost === 'localhost' || rawHost === 'tauri.localhost' ? 'jolkr.app' : rawHost;
    const twitchSrc = kind === 'clip' ? `https://clips.twitch.tv/embed?clip=${id}&parent=${host}` : kind === 'vod' ? `https://player.twitch.tv/?video=${id}&parent=${host}` : `https://player.twitch.tv/?channel=${id}&parent=${host}`;
    return <IframePlayer src={twitchSrc} title={kind === 'clip' ? 'Twitch clip' : 'Twitch stream'} />;
  }

  if (platform === 'tiktok' && id)
    return <IframePlayer src={`https://www.tiktok.com/embed/v2/${id}`} title="TikTok video" />;

  if (platform === 'vidmount' && id)
    return <IframePlayer src={`https://vidmount.com/embed/${id}`} title="VidMount video" />;

  if (platform === 'facebook' && src)
    return <IframePlayer src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(src)}&show_text=false`} title="Facebook video" />;

  if (platform === 'dailymotion' && id)
    return <IframePlayer src={`https://www.dailymotion.com/embed/video/${id}`} title="Dailymotion video" />;

  if (platform === 'bitchute' && id)
    return <IframePlayer src={`https://www.bitchute.com/embed/${id}/`} title="BitChute video" />;

  if (platform === 'vidyard' && id)
    return <IframePlayer src={`https://play.vidyard.com/${id}`} title="Vidyard video" />;

  if ((platform === 'direct' || platform === 'hls') && src)
    return <NMVideoPlayer src={src} title={embed.title ?? ''} image={embed.image_url ?? ''} />;

  return null;
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

/* ── NoMercy Video Player ── */

function NMVideoPlayer({ src, title, image }: { src: string; title: string; image: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const player = useNMPlayer({ src, title, image, autoPlay: true });
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { return () => clearTimeout(hideTimerRef.current); }, []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (player.isPlaying) hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, [player.isPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    player.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * player.duration);
  };

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => { });
  };

  if (player.error) return <div className={s.errorMsg}>{player.error}</div>;

  const isLive = player.duration > 0 ? false : player.isReady;

  return (
    <div ref={wrapperRef} className={s.nmWrap} onMouseMove={scheduleHide} onMouseLeave={() => { if (player.isPlaying) setShowControls(false); }}>
      <div ref={player.containerRef} className={s.nmContainer} onClick={player.togglePlay} />
      {player.isBuffering && <div className={s.bufferOverlay}><Spinner size="lg" /></div>}
      {isLive && <div className={s.liveBadge}><span className={s.liveDot} />LIVE</div>}
      <div className={s.controls} data-hidden={!showControls}>
        {!isLive && (
          <div className={s.progressBar} onClick={handleSeek}>
            <div className={s.progressFill} style={{ width: `${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%` }} />
          </div>
        )}
        <div className={s.controlsRow}>
          <button className={s.controlBtn} onClick={player.togglePlay}>{player.isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          <span className={s.timeLabel}>{isLive ? 'LIVE' : `${fmt(player.currentTime)} / ${fmt(player.duration)}`}</span>
          <div className={s.spacer} />
          <button className={s.controlBtn} onClick={player.toggleMute}>{player.isMuted || player.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          <button className={s.controlBtn} onClick={toggleFullscreen}><Maximize size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}
