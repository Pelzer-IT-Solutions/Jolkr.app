import { useState, useRef, useCallback, useEffect } from 'react';
import type { MessageEmbed } from '../api/types';
import type { VideoInfo } from '../utils/videoUrl';
import { getYouTubeThumbnail, getPlatformColor, getPlatformName } from '../utils/videoUrl';
import { useNMPlayer } from '../hooks/useNMPlayer';
import { isTauri } from '../platform/detect';

interface Props {
  embed: MessageEmbed;
  videoInfo: VideoInfo;
}

export default function VideoEmbed({ embed, videoInfo }: Props) {
  // Iframe platforms (YouTube, Vimeo, Twitch, TikTok) load the iframe directly
  // so the user only needs one click (the platform's own play button).
  // Direct/HLS videos use a thumbnail preview since NMPlayer auto-plays on expand.
  const isIframePlatform = ['youtube', 'vimeo', 'twitch', 'tiktok'].includes(videoInfo.platform);
  const [expanded, setExpanded] = useState(isIframePlatform);
  const borderColor = getPlatformColor(videoInfo.platform);
  const platformName = embed.site_name || getPlatformName(videoInfo.platform);

  const thumbnailUrl =
    embed.image_url ||
    (videoInfo.platform === 'youtube' && videoInfo.id
      ? getYouTubeThumbnail(videoInfo.id)
      : null);

  return (
    <div
      className="mt-1 max-w-[400px] rounded-md overflow-hidden bg-zinc-800/50 border-l-4"
      style={{ borderLeftColor: borderColor }}
    >
      {/* Header */}
      <div className="px-3 pt-2 pb-1">
        <div className="text-xs text-zinc-400 flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full inline-block shrink-0"
            style={{ backgroundColor: borderColor }}
          />
          {platformName}
        </div>
        {embed.title && (
          <div className="text-sm font-semibold text-blue-400 mt-0.5 line-clamp-1">
            {embed.title}
          </div>
        )}
      </div>

      {/* Player area */}
      {expanded ? (
        <PlayerArea videoInfo={videoInfo} embed={embed} />
      ) : (
        <Thumbnail
          url={thumbnailUrl}
          platform={videoInfo.platform}
          onClick={() => setExpanded(true)}
        />
      )}
    </div>
  );
}

/* ── Thumbnail (collapsed state) ── */

function Thumbnail({
  url,
  platform,
  onClick,
}: {
  url: string | null;
  platform: string;
  onClick: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button
      onClick={onClick}
      className="relative w-full aspect-video bg-black flex items-center justify-center cursor-pointer group/thumb"
    >
      {url && !imgErr ? (
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgErr(true)}
        />
      ) : (
        <VideoPlaceholder platform={platform} />
      )}
      {/* Play overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/thumb:bg-black/40 transition-colors">
        <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover/thumb:scale-110 transition-transform">
          <svg className="w-7 h-7 text-black ml-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </button>
  );
}

function VideoPlaceholder({ platform }: { platform: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-zinc-500">
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
      <span className="text-xs">{platform}</span>
    </div>
  );
}

/* ── Player Area (expanded state) ── */

function PlayerArea({ videoInfo, embed }: { videoInfo: VideoInfo; embed: MessageEmbed }) {
  const { platform, id, src, kind } = videoInfo;

  if (platform === 'youtube' && id) {
    return (
      <IframePlayer
        src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`}
        title="YouTube video"
      />
    );
  }

  if (platform === 'vimeo' && id) {
    return (
      <IframePlayer
        src={`https://player.vimeo.com/video/${id}`}
        title="Vimeo video"
      />
    );
  }

  if (platform === 'twitch' && id) {
    const twitchUrl = kind === 'vod'
      ? `https://www.twitch.tv/videos/${id}`
      : `https://www.twitch.tv/${id}`;

    // Tauri: iframe embedding fails due to origin mismatch — open in browser
    if (isTauri) {
      return (
        <div className="aspect-video bg-black flex flex-col items-center justify-center gap-3 p-4">
          <svg className="w-10 h-10 text-[#9146FF]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
          </svg>
          <span className="text-zinc-400 text-sm text-center">{embed.title || 'Twitch Stream'}</span>
          <a
            href={twitchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#9146FF] hover:bg-[#7C2BEA] text-white text-sm rounded font-medium no-underline"
          >
            Watch on Twitch
          </a>
        </div>
      );
    }

    // Web: embed normally
    const host = window.location.hostname;
    const twitchSrc = kind === 'vod'
      ? `https://player.twitch.tv/?video=${id}&parent=${host}`
      : `https://player.twitch.tv/?channel=${id}&parent=${host}`;
    return <IframePlayer src={twitchSrc} title="Twitch stream" />;
  }

  if (platform === 'tiktok' && id) {
    return (
      <IframePlayer
        src={`https://www.tiktok.com/embed/v2/${id}`}
        title="TikTok video"
      />
    );
  }

  if ((platform === 'direct' || platform === 'hls') && src) {
    return <NMVideoPlayer src={src} title={embed.title ?? ''} image={embed.image_url ?? ''} />;
  }

  return null;
}

/* ── Iframe player (YouTube / Vimeo / Twitch / TikTok) ── */

function IframePlayer({ src, title }: { src: string; title: string }) {
  return (
    <div className="aspect-video bg-black">
      <iframe
        src={src}
        title={title}
        className="w-full h-full"
        allow="fullscreen; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}

/* ── NoMercy Video Player (direct + HLS) ── */

function NMVideoPlayer({ src, title, image }: { src: string; title: string; image: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const player = useNMPlayer({ src, title, image, autoPlay: true });
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (player.isPlaying) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [player.isPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(frac * player.duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    player.setVolume(parseFloat(e.target.value) * 100);
  };

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  };

  if (player.error) {
    return (
      <div className="aspect-video bg-black flex items-center justify-center text-zinc-400 text-sm">
        {player.error}
      </div>
    );
  }

  const isLive = player.duration > 0 ? false : player.isReady;

  return (
    <div
      ref={wrapperRef}
      className="relative aspect-video bg-black"
      onMouseMove={scheduleHide}
      onMouseLeave={() => { if (player.isPlaying) setShowControls(false); }}
    >
      {/* NMPlayer renders its <video> + overlay inside this div */}
      <div
        ref={player.containerRef}
        className="w-full h-full [&_.nomercyplayer]:!aspect-auto [&_video]:w-full [&_video]:h-full [&_video]:object-contain cursor-pointer"
        onClick={player.togglePlay}
      />

      {/* Buffering spinner */}
      {player.isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Live badge */}
      {isLive && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          LIVE
        </div>
      )}

      {/* Custom controls overlay */}
      <VideoControls
        visible={showControls}
        playing={player.isPlaying}
        currentTime={player.currentTime}
        duration={isLive ? 0 : player.duration}
        volume={player.volume / 100}
        muted={player.isMuted}
        onTogglePlay={player.togglePlay}
        onSeek={isLive ? undefined : handleSeek}
        onVolumeChange={handleVolumeChange}
        onToggleMute={player.toggleMute}
        onToggleFullscreen={toggleFullscreen}
        isLive={isLive}
      />
    </div>
  );
}

/* ── Shared custom controls ── */

interface ControlsProps {
  visible: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onSeek?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  isLive?: boolean;
}

function VideoControls({
  visible,
  playing,
  currentTime,
  duration,
  volume,
  muted,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  isLive,
}: ControlsProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-6 pb-1 px-2 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Progress bar */}
      {!isLive && onSeek && (
        <div
          className="h-1 bg-white/20 rounded-full mb-1.5 cursor-pointer group/seek"
          onClick={onSeek}
        >
          <div
            className="h-full bg-white rounded-full relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full opacity-0 group-hover/seek:opacity-100 transition-opacity" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          className="text-white p-1 hover:text-white/80"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="text-[11px] text-white/80 tabular-nums min-w-0">
          {isLive ? 'LIVE' : `${formatTime(currentTime)} / ${formatTime(duration)}`}
        </span>

        <div className="flex-1" />

        {/* Volume */}
        <div className="flex items-center gap-1 group/vol">
          <button
            onClick={onToggleMute}
            className="text-white p-1 hover:text-white/80"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M14 4l-5 4H5v8h4l5 4V4z" fill="currentColor" />
                <path d="M17 9l4 4m0-4l-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 4l-5 4H5v8h4l5 4V4z" />
                {volume > 0.5 && <path d="M18.5 5.5a10 10 0 010 13" stroke="currentColor" strokeWidth="2" fill="none" />}
                <path d="M15.5 8.5a5 5 0 010 7" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={onVolumeChange}
            className="w-0 group-hover/vol:w-16 transition-all duration-200 accent-white h-1 cursor-pointer"
            aria-label="Volume"
          />
        </div>

        {/* Fullscreen */}
        <button
          onClick={onToggleFullscreen}
          className="text-white p-1 hover:text-white/80"
          aria-label="Fullscreen"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
