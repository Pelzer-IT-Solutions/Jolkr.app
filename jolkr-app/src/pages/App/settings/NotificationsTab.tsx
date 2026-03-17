import { useEffect, useRef, useState } from 'react';
import type { User } from '../../../api/types';
import { isTauri, isWeb } from '../../../platform/detect';
import { getServerUrl, isDevMachine, isValidServerUrl } from '../../../platform/config';
import { registerPush, unregisterPush } from '../../../services/pushRegistration';
import { getRingtoneType } from '../../../hooks/useCallEvents';
import Toggle from '../../../components/ui/Toggle';
import Button from '../../../components/ui/Button';

export interface NotificationsTabProps {
  user: User | null;
  onProfileUpdate: (body: { show_read_receipts?: boolean }) => Promise<void>;
}

export default function NotificationsTab({ user, onProfileUpdate }: NotificationsTabProps) {
  const [desktopNotif, setDesktopNotif] = useState(() => localStorage.getItem('jolkr_desktop_notif') !== 'false');
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('jolkr_sound') !== 'false');
  const [ringtone, setRingtone] = useState(() => getRingtoneType());
  const [previewingRingtone, setPreviewingRingtone] = useState(false);
  const [saveError, setSaveError] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-start (Tauri desktop only)
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  // Push notifications (web only)
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);

  useEffect(() => {
    if (!isTauri) { setAutoStartLoading(false); return; }
    import('@tauri-apps/plugin-autostart').then(({ isEnabled }) => {
      isEnabled().then((enabled) => {
        setAutoStart(enabled);
        setAutoStartLoading(false);
      }).catch(() => setAutoStartLoading(false));
    }).catch(() => setAutoStartLoading(false));
  }, []);

  useEffect(() => {
    if (!isWeb || !('PushManager' in window)) { setPushLoading(false); return; }
    navigator.serviceWorker?.getRegistration('/app/').then((reg) => {
      if (reg) {
        reg.pushManager.getSubscription().then((sub) => {
          setPushEnabled(!!sub);
          setPushLoading(false);
        }).catch(() => setPushLoading(false));
      } else {
        setPushLoading(false);
      }
    }).catch(() => setPushLoading(false));
  }, []);

  // Cleanup ringtone preview on unmount
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current.currentTime = 0; }
    };
  }, []);

  const handleDesktopNotif = async (enabled: boolean) => {
    if (enabled && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }
    setDesktopNotif(enabled);
    localStorage.setItem('jolkr_desktop_notif', String(enabled));
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem('jolkr_sound', String(enabled));
  };

  const handleAutoStart = async (enabled: boolean) => {
    const prev = autoStart;
    setAutoStart(enabled);
    try {
      const { enable, disable } = await import('@tauri-apps/plugin-autostart');
      if (enabled) { await enable(); } else { await disable(); }
    } catch (e) {
      console.error('Failed to toggle autostart:', e);
      setAutoStart(prev);
    }
  };

  const handlePushToggle = async (enabled: boolean) => {
    const prev = pushEnabled;
    setPushLoading(true);
    try {
      if (enabled) {
        await registerPush();
        setPushEnabled(true);
      } else {
        await unregisterPush();
        setPushEnabled(false);
      }
    } catch (e) {
      console.error('Failed to toggle push notifications:', e);
      setPushEnabled(prev);
    }
    setPushLoading(false);
  };

  const stopPreviewRingtone = () => {
    setPreviewingRingtone(false);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
  };

  const handleRingtoneChange = (type: string) => {
    setRingtone(type);
    localStorage.setItem('jolkr_ringtone', type);
    stopPreviewRingtone();
  };

  const previewRingtone = () => {
    if (previewingRingtone) { stopPreviewRingtone(); return; }
    setPreviewingRingtone(true);
    const type = localStorage.getItem('jolkr_ringtone') ?? 'classic';
    if (type === 'classic') {
      if (!previewAudioRef.current) previewAudioRef.current = new Audio(`${import.meta.env.BASE_URL}ringtone.ogg`);
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current.play().catch(() => { });
      previewTimeoutRef.current = setTimeout(stopPreviewRingtone, 4000);
    } else {
      if (!previewCtxRef.current) previewCtxRef.current = new AudioContext();
      const ctx = previewCtxRef.current;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + 0.35);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      gain.gain.setValueAtTime(0, now + 0.6);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.65);
      gain.gain.setValueAtTime(0.08, now + 0.95);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(440, now); o1.connect(gain); o1.start(now); o1.stop(now + 1.0);
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(480, now); o2.connect(gain); o2.start(now); o2.stop(now + 1.0);
      previewTimeoutRef.current = setTimeout(stopPreviewRingtone, 1500);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-text-primary">Notifications</h2>
      <div className="rounded-xl bg-surface border border-divider flex flex-col">
        {/* Desktop notifications */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Desktop Notifications</label>
            <p className="text-sm text-text-secondary">Show desktop notifications for new messages</p>
          </div>
          <Toggle checked={desktopNotif} onChange={handleDesktopNotif} />
        </div>

        {/* Sound */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Message Sounds</label>
            <p className="text-sm text-text-secondary">Play a sound when new messages arrive</p>
          </div>
          <Toggle checked={soundEnabled} onChange={handleSoundToggle} />
        </div>

        {/* Read Receipts */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Read Receipts</label>
            <p className="text-sm text-text-secondary">When disabled, others won't see when you've read their messages</p>
          </div>
          <Toggle
            checked={user?.show_read_receipts ?? true}
            onChange={async (v) => {
              try {
                await onProfileUpdate({ show_read_receipts: v });
              } catch (e) {
                setSaveError((e as Error).message || 'Failed to update read receipts');
              }
            }}
          />
        </div>

        {saveError && <div className="bg-danger/10 text-danger text-sm px-6 py-2">{saveError}</div>}

        {/* Call ringtone */}
        <div className="flex flex-col gap-2.5 px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Call Ringtone</label>
              <p className="text-sm text-text-secondary">Sound played for incoming DM calls</p>
            </div>
            <button onClick={previewRingtone} className="text-sm font-medium text-accent hover:text-accent-hover transition-colors">
              {previewingRingtone ? 'Stop' : 'Preview'}
            </button>
          </div>
          <div className="flex rounded-lg border border-divider overflow-hidden w-fit">
            {[
              { id: 'classic', label: 'Classic' },
              { id: 'tone', label: 'Tone' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleRingtoneChange(opt.id)}
                className={`py-2 px-5 text-sm transition-colors ${ringtone === opt.id ? 'bg-accent text-bg font-semibold' : 'text-text-secondary font-medium hover:text-text-primary'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Push notifications (web only) */}
        {isWeb && 'PushManager' in window && (
          <div className={`flex items-center justify-between px-6 py-4 ${isTauri ? 'border-b border-border-subtle' : ''}`}>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Push Notifications</label>
              <p className="text-sm text-text-secondary">Receive notifications even when the tab is closed</p>
            </div>
            <Toggle checked={pushEnabled} onChange={handlePushToggle} disabled={pushLoading} />
          </div>
        )}

        {/* Auto-start (Tauri desktop only) */}
        {isTauri && (
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Start with Windows</label>
              <p className="text-sm text-text-secondary">Automatically start Jolkr when you log in</p>
            </div>
            <Toggle checked={autoStart} onChange={handleAutoStart} disabled={autoStartLoading} />
          </div>
        )}

        {/* Server URL (dev machine only) */}
        {isTauri && isDevMachine && (
          <div className="px-6 py-4 border-t border-border-subtle">
            <ServerUrlSetting />
          </div>
        )}
      </div>
    </>
  );
}

function ServerUrlSetting() {
  const current = getServerUrl();
  const [url, setUrl] = useState(current);
  const [saved, setSaved] = useState(false);
  const dirty = url.trim().replace(/\/+$/, '') !== current;

  const [urlError, setUrlError] = useState('');

  const handleSave = () => {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned) return;
    if (!isValidServerUrl(cleaned)) {
      setUrlError('URL must use HTTPS (or HTTP for localhost only)');
      return;
    }
    setUrlError('');
    localStorage.setItem('jolkr_server_url', cleaned);
    setSaved(true);
    setTimeout(() => window.location.reload(), 500);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Server URL</label>
        <p className="text-sm text-text-secondary">The Jolkr server this app connects to. Changing this will reload the app.</p>
      </div>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); setUrlError(''); }}
          className="flex-1 rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
        />
        {urlError && <span className="text-danger text-xs self-center">{urlError}</span>}
        {dirty && (
          <Button onClick={handleSave}>
            {saved ? 'Saved!' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}
