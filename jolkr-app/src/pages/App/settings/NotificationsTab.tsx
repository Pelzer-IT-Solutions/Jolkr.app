import { useEffect, useRef, useState } from 'react';
import type { User } from '../../../api/types';
import { isTauri, isWeb } from '../../../platform/detect';
import { getServerUrl, isDevMachine, isValidServerUrl } from '../../../platform/config';
import { registerPush, unregisterPush } from '../../../services/pushRegistration';
import { getRingtoneType } from '../../../hooks/useCallEvents';

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
      <h2 className="text-2xl font-bold text-text-primary mb-6">Notifications</h2>
      <div className="bg-surface rounded-xl p-8 space-y-6">
        {/* Desktop notifications */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Desktop Notifications</label>
            <p className="text-text-muted text-xs mt-1">Show desktop notifications for new messages</p>
          </div>
          <button
            role="switch"
            aria-checked={desktopNotif}
            onClick={() => handleDesktopNotif(!desktopNotif)}
            className={`w-11 h-6 rounded-full transition-colors relative ${desktopNotif ? 'bg-primary' : 'bg-input'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${desktopNotif ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Sound */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Message Sounds</label>
            <p className="text-text-muted text-xs mt-1">Play a sound when new messages arrive</p>
          </div>
          <button
            role="switch"
            aria-checked={soundEnabled}
            onClick={() => handleSoundToggle(!soundEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${soundEnabled ? 'bg-primary' : 'bg-input'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${soundEnabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Read Receipts */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Read Receipts</label>
            <p className="text-text-muted text-xs mt-1">When disabled, others won't see when you've read their messages</p>
          </div>
          <button
            role="switch"
            aria-checked={user?.show_read_receipts ?? true}
            onClick={async () => {
              const newValue = !(user?.show_read_receipts ?? true);
              try {
                await onProfileUpdate({ show_read_receipts: newValue });
              } catch (e) {
                setSaveError((e as Error).message || 'Failed to update read receipts');
              }
            }}
            className={`w-11 h-6 rounded-full transition-colors relative ${(user?.show_read_receipts ?? true) ? 'bg-primary' : 'bg-input'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${(user?.show_read_receipts ?? true) ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        {saveError && <div className="bg-error/10 text-error text-sm p-2 rounded">{saveError}</div>}

        {/* Call ringtone */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Call Ringtone</label>
              <p className="text-text-muted text-xs mt-1">Sound played for incoming DM calls</p>
            </div>
            <button
              onClick={previewRingtone}
              className="px-3 py-1.5 text-xs rounded bg-input text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors"
            >
              {previewingRingtone ? 'Stop' : 'Preview'}
            </button>
          </div>
          <div className="flex gap-2">
            {[
              { id: 'classic', label: 'Classic' },
              { id: 'tone', label: 'Tone' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleRingtoneChange(opt.id)}
                className={`px-4 py-2 rounded text-sm ${ringtone === opt.id ? 'bg-primary text-white' : 'bg-input text-text-secondary hover:text-text-primary'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Push notifications (web only) */}
        {isWeb && 'PushManager' in window && (
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Push Notifications</label>
              <p className="text-text-muted text-xs mt-1">Receive notifications even when the tab is closed</p>
            </div>
            <button
              role="switch"
              aria-checked={pushEnabled}
              onClick={() => handlePushToggle(!pushEnabled)}
              disabled={pushLoading}
              className={`w-11 h-6 rounded-full transition-colors relative ${pushEnabled ? 'bg-primary' : 'bg-input'} ${pushLoading ? 'opacity-50' : ''}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${pushEnabled ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        )}

        {/* Auto-start (Tauri desktop only) */}
        {isTauri && (
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Start with Windows</label>
              <p className="text-text-muted text-xs mt-1">Automatically start Jolkr when you log in</p>
            </div>
            <button
              role="switch"
              aria-checked={autoStart}
              onClick={() => handleAutoStart(!autoStart)}
              disabled={autoStartLoading}
              className={`w-11 h-6 rounded-full transition-colors relative ${autoStart ? 'bg-primary' : 'bg-input'} ${autoStartLoading ? 'opacity-50' : ''}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoStart ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        )}

        {/* Server URL (dev machine only) */}
        {isTauri && isDevMachine && (
          <ServerUrlSetting />
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
    <div>
      <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Server URL</label>
      <p className="text-text-muted text-xs mt-1 mb-2">The Jolkr server this app connects to. Changing this will reload the app.</p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); setUrlError(''); }}
          className="flex-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
        />
        {urlError && <span className="text-error text-xs self-center">{urlError}</span>}
        {dirty && (
          <button
            onClick={handleSave}
            className="px-4 py-2 btn-primary text-sm rounded-lg"
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}
