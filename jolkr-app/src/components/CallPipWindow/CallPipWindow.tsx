import { useEffect, useRef, useState } from 'react';
import { Maximize2, PhoneOff } from 'lucide-react';
import { VideoTile } from '../VideoTile/VideoTile';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { useT } from '../../hooks/useT';
import s from './CallPipWindow.module.css';

const STORAGE_KEY = STORAGE_KEYS.CALL_PIP_LAYOUT;
const DEFAULT_W = 320;
const DEFAULT_H = 180;
const MIN_W = 240;
const MIN_H = 135;
const MAX_W = 640;
const MAX_H = 360;
const SNAP = 16;
const MARGIN = 16;

interface Layout { x: number; y: number; w: number; h: number; }

interface CallPipWindowProps {
  remoteStream: MediaStream | null;
  remoteName: string;
  remoteUserId: string;
  remoteIsMuted: boolean;
  remoteIsCameraOn: boolean;
  remoteIsSpeaking: boolean;
  onExpand: () => void;
  onHangup: () => void;
}

function loadLayout(): Layout {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.x === 'number' && typeof parsed.y === 'number' &&
        typeof parsed.w === 'number' && typeof parsed.h === 'number'
      ) {
        return clampLayout(parsed);
      }
    }
  } catch { /* ignore */ }
  // Default: bottom-right corner
  const w = DEFAULT_W;
  const h = DEFAULT_H;
  return {
    w, h,
    x: window.innerWidth  - w - MARGIN,
    y: window.innerHeight - h - MARGIN,
  };
}

function clampLayout(l: Layout): Layout {
  const w = Math.max(MIN_W, Math.min(MAX_W, l.w));
  const h = Math.max(MIN_H, Math.min(MAX_H, l.h));
  const maxX = Math.max(0, window.innerWidth  - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return {
    w, h,
    x: Math.max(0, Math.min(maxX, l.x)),
    y: Math.max(0, Math.min(maxY, l.y)),
  };
}

function snapToEdges(l: Layout): Layout {
  const out = { ...l };
  if (out.x < SNAP) out.x = MARGIN;
  if (out.y < SNAP) out.y = MARGIN;
  const rightEdge  = window.innerWidth  - out.w - MARGIN;
  const bottomEdge = window.innerHeight - out.h - MARGIN;
  if (Math.abs(window.innerWidth  - (out.x + out.w)) < SNAP) out.x = rightEdge;
  if (Math.abs(window.innerHeight - (out.y + out.h)) < SNAP) out.y = bottomEdge;
  return out;
}

export function CallPipWindow({
  remoteStream,
  remoteName,
  remoteUserId,
  remoteIsMuted,
  remoteIsCameraOn,
  remoteIsSpeaking,
  onExpand,
  onHangup,
}: CallPipWindowProps) {
  const { t } = useT();
  const [layout, setLayout] = useState<Layout>(() => loadLayout());
  const dragStateRef = useRef<{ kind: 'drag' | 'resize'; startX: number; startY: number; orig: Layout } | null>(null);

  // Persist layout changes (debounced via requestAnimationFrame coalescing).
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); }
    catch { /* ignore (storage full / disabled) */ }
  }, [layout]);

  // Re-clamp on window resize so the PiP doesn't drift off-screen.
  useEffect(() => {
    const onResize = () => setLayout((l) => clampLayout(l));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function onDragStart(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      kind: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layout },
    };
  }

  function onResizeStart(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      kind: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layout },
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const st = dragStateRef.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (st.kind === 'drag') {
      setLayout(clampLayout({ ...st.orig, x: st.orig.x + dx, y: st.orig.y + dy }));
    } else {
      // Resize keeps 16:9 aspect, anchor top-left, drives by larger delta
      const proposedW = st.orig.w + dx;
      const proposedH = st.orig.h + dy;
      // Pick the dimension whose proportional change is bigger
      const scaleW = proposedW / st.orig.w;
      const scaleH = proposedH / st.orig.h;
      const scale  = Math.max(scaleW, scaleH);
      let w = Math.round(st.orig.w * scale);
      let h = Math.round((w * 9) / 16);
      w = Math.max(MIN_W, Math.min(MAX_W, w));
      h = Math.max(MIN_H, Math.min(MAX_H, h));
      // Maintain aspect after clamping
      if (w / h > 16 / 9) w = Math.round((h * 16) / 9);
      else h = Math.round((w * 9) / 16);
      setLayout(clampLayout({ x: st.orig.x, y: st.orig.y, w, h }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragStateRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (dragStateRef.current.kind === 'drag') {
      setLayout((l) => snapToEdges(l));
    }
    dragStateRef.current = null;
  }

  return (
    <div
      className={s.pip}
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h }}
      role="dialog"
      aria-label={t('call.pip.aria')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={s.dragHandle} onPointerDown={onDragStart} />

      <VideoTile
        stream={remoteStream}
        userId={remoteUserId}
        username={remoteName}
        isMuted={remoteIsMuted}
        isCameraOn={remoteIsCameraOn}
        isSpeaking={remoteIsSpeaking}
        className={s.tile}
      />

      <div className={s.controls}>
        <button
          className={s.ctrlBtn}
          onClick={onExpand}
          title={t('call.pip.expand')}
          aria-label={t('call.pip.expandAria')}
        >
          <Maximize2 size={14} strokeWidth={2} />
        </button>
        <button
          className={s.hangupBtn}
          onClick={onHangup}
          title={t('call.pip.endCall')}
          aria-label={t('call.pip.endCall')}
        >
          <PhoneOff size={14} strokeWidth={2} />
        </button>
      </div>

      <div
        className={s.resizeHandle}
        onPointerDown={onResizeStart}
        aria-hidden
      />
    </div>
  );
}
