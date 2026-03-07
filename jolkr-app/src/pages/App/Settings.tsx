import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import * as api from '../../api/client';
import Avatar from '../../components/Avatar';
import { isTauri, isWeb } from '../../platform/detect';
import { getServerUrl, isDevMachine } from '../../platform/config';
import { useMobileNav } from '../../hooks/useMobileNav';
import { registerPush, unregisterPush } from '../../services/pushRegistration';
import { getRingtoneType } from '../../hooks/useCallEvents';

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const logout = useAuthStore((s) => s.logout);
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState<'account' | 'appearance' | 'notifications' | 'devices'>('account');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { isMobile, setShowSidebar } = useMobileNav();

  // Hide ServerSidebar on mobile — Settings uses full width
  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile, setShowSidebar]);

  // Cleanup saved timer + ringtone preview on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current.currentTime = 0; }
    };
  }, []);

  // Appearance settings
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('jolkr_font_size') ?? 'normal');
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('jolkr_compact') === 'true');

  // Notification settings
  const [desktopNotif, setDesktopNotif] = useState(() => localStorage.getItem('jolkr_desktop_notif') !== 'false');
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('jolkr_sound') !== 'false');
  const [ringtone, setRingtone] = useState(() => getRingtoneType());
  const [previewingRingtone, setPreviewingRingtone] = useState(false);
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

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await updateProfile({
        username: username.trim(),
        display_name: displayName.trim() || undefined,
        bio: bio.trim(),
      });
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to save changes');
    }
    finally { setSaving(false); }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.warn('Logout error:', e);
    } finally {
      navigate('/login');
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const result = await api.uploadFile(file);
      // Store the S3 key (not the presigned URL) so the backend can re-presign on each fetch
      await updateProfile({ avatar_url: result.key });
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to upload avatar');
    }
    setAvatarUploading(false);
  };

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

  const handleRingtoneChange = (type: string) => {
    setRingtone(type);
    localStorage.setItem('jolkr_ringtone', type);
    stopPreviewRingtone();
  };

  const stopPreviewRingtone = () => {
    setPreviewingRingtone(false);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
  };

  const previewRingtone = () => {
    if (previewingRingtone) { stopPreviewRingtone(); return; }
    setPreviewingRingtone(true);
    const type = localStorage.getItem('jolkr_ringtone') ?? 'classic';
    if (type === 'classic') {
      if (!previewAudioRef.current) previewAudioRef.current = new Audio(`${import.meta.env.BASE_URL}ringtone.ogg`);
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current.play().catch(() => {});
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

  const handleFontSize = (size: string) => {
    setFontSize(size);
    localStorage.setItem('jolkr_font_size', size);
    window.dispatchEvent(new Event('storage'));
  };

  const handleCompactMode = (enabled: boolean) => {
    setCompactMode(enabled);
    localStorage.setItem('jolkr_compact', String(enabled));
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-bg">
      {/* Settings sidebar — hidden on mobile, replaced by horizontal tabs */}
      {!isMobile && (
        <div className="w-[240px] bg-sidebar flex flex-col shrink-0 border-r border-divider">
          <div className="h-14 px-4 flex items-center border-b border-divider shrink-0">
            <h2 className="text-text-primary font-semibold text-[15px]">User Settings</h2>
          </div>
          <div className="p-4">
            <div className="space-y-0.5">
              {(['account', 'appearance', 'notifications', 'devices'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm ${
                    activeTab === tab
                      ? 'bg-white/10 text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                  }`}
                >
                  {tab === 'account' ? 'My Account' : tab === 'appearance' ? 'Appearance' : tab === 'notifications' ? 'Notifications' : 'Devices'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-auto p-4">
            <button
              onClick={() => navigate(-1)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded border border-divider text-text-secondary hover:text-text-primary text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Go Back
            </button>
          </div>
        </div>
      )}

      {/* Settings content */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Mobile: horizontal tabs + back button */}
        {isMobile && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-divider shrink-0 overflow-x-auto">
            <button
              onClick={() => { setShowSidebar(true); navigate(-1); }}
              className="text-text-secondary hover:text-text-primary shrink-0 mr-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {(['account', 'appearance', 'notifications', 'devices'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap shrink-0 ${
                  activeTab === tab
                    ? 'bg-primary text-white'
                    : 'bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab === 'account' ? 'Account' : tab === 'appearance' ? 'Appearance' : tab === 'notifications' ? 'Notifications' : 'Devices'}
              </button>
            ))}
          </div>
        )}

        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8 max-w-[740px]'}`}>
          {activeTab === 'account' && (
            <>
              <h2 className="text-xl font-bold text-text-primary mb-6">My Account</h2>

              {/* Profile card */}
              <div className="bg-surface rounded-lg p-6 mb-6">
                <div className="flex items-center gap-4 mb-6">
                  <div
                    className="relative group cursor-pointer shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={80} status="online" />
                    <div className={`absolute top-0 left-0 w-20 h-20 rounded-full bg-black/50 flex items-center justify-center transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      {avatarUploading ? (
                        <div className="text-white text-xs font-medium animate-pulse">Uploading</div>
                      ) : (
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-text-primary">{user?.username}</div>
                    <div className="text-sm text-text-secondary">{user?.email}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="settings-username" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Username</label>
                    <input
                      id="settings-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-displayname" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Display Name</label>
                    <input
                      id="settings-displayname"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
                      placeholder="How others see you (optional)"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-bio" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Bio</label>
                    <textarea
                      id="settings-bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm resize-none"
                      rows={3}
                      placeholder="Tell us about yourself"
                    />
                  </div>
                  {saveError && <div className="bg-error/10 text-error text-sm p-2 rounded">{saveError}</div>}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Danger zone */}
              <div className="border border-error/30 rounded-lg p-6">
                <h3 className="text-error font-semibold mb-2">Log Out</h3>
                <p className="text-text-secondary text-sm mb-4">This will disconnect you from all servers.</p>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-error hover:bg-error/80 text-white text-sm rounded"
                >
                  Log Out
                </button>
              </div>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <h2 className="text-xl font-bold text-text-primary mb-6">Appearance</h2>
              <div className="bg-surface rounded-lg p-6 space-y-6">
                {/* Theme */}
                <div>
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Theme</label>
                  <div className="mt-2 flex gap-2">
                    <div className="px-4 py-2 rounded bg-primary text-white text-sm">Dark</div>
                    <div className="px-4 py-2 rounded bg-input text-text-muted text-sm cursor-not-allowed" title="Coming soon">Light</div>
                  </div>
                </div>

                {/* Font size */}
                <div>
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Message Font Size</label>
                  <div className="mt-2 flex gap-2">
                    {['small', 'normal', 'large'].map((size) => (
                      <button
                        key={size}
                        onClick={() => handleFontSize(size)}
                        className={`px-4 py-2 rounded text-sm capitalize ${
                          fontSize === size ? 'bg-primary text-white' : 'bg-input text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Compact mode */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Compact Mode</label>
                    <p className="text-text-muted text-xs mt-1">Reduce spacing between messages</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={compactMode}
                    onClick={() => handleCompactMode(!compactMode)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${compactMode ? 'bg-primary' : 'bg-input'}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${compactMode ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <h2 className="text-xl font-bold text-text-primary mb-6">Notifications</h2>
              <div className="bg-surface rounded-lg p-6 space-y-6">
                {/* Desktop notifications */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Desktop Notifications</label>
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
                    <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Message Sounds</label>
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
                    <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Read Receipts</label>
                    <p className="text-text-muted text-xs mt-1">When disabled, others won't see when you've read their messages</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={user?.show_read_receipts ?? true}
                    onClick={async () => {
                      const newValue = !(user?.show_read_receipts ?? true);
                      try {
                        await updateProfile({ show_read_receipts: newValue });
                      } catch (e) {
                        setSaveError((e as Error).message || 'Failed to update read receipts');
                      }
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative ${(user?.show_read_receipts ?? true) ? 'bg-primary' : 'bg-input'}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${(user?.show_read_receipts ?? true) ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>

                {/* Call ringtone */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Call Ringtone</label>
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
                        className={`px-4 py-2 rounded text-sm ${
                          ringtone === opt.id ? 'bg-primary text-white' : 'bg-input text-text-secondary hover:text-text-primary'
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
                      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Push Notifications</label>
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
                      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Start with Windows</label>
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
          )}

          {activeTab === 'devices' && (
            <DevicesTab />
          )}

          {/* Build version + health link */}
          <div className="mt-auto pt-8 pb-4 flex items-center justify-between text-text-muted text-xs">
            <span>Jolkr v{__APP_VERSION__}</span>
            <a
              href="/health"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              Service Status
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function DevicesTab() {
  const [devices, setDevices] = useState<Array<{ id: string; device_name: string; device_type: string; has_push_token: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api.getDevices()
      .then((data) => { setDevices(data.devices); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (deviceId: string) => {
    setDeleting(deviceId);
    try {
      await api.deleteDevice(deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch {
      // Silently fail — device may already be deleted
    }
    setDeleting(null);
  };

  const deviceIcon = (type: string) => {
    switch (type) {
      case 'web':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        );
      case 'desktop':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
      case 'android':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-text-primary mb-6">Devices</h2>
      <div className="bg-surface rounded-lg p-6">
        {loading && (
          <div className="text-text-muted text-sm text-center py-4">Loading devices...</div>
        )}
        {!loading && error && (
          <div className="text-error/70 text-sm text-center py-4">Failed to load devices</div>
        )}
        {!loading && !error && devices.length === 0 && (
          <div className="text-text-muted text-sm text-center py-4">No devices registered</div>
        )}
        {!loading && !error && devices.length > 0 && (
          <div className="space-y-3">
            {devices.map((device) => (
              <div key={device.id} className="flex items-center gap-3 p-3 rounded bg-bg">
                <div className="text-text-muted shrink-0">
                  {deviceIcon(device.device_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">{device.device_name}</div>
                  <div className="text-text-muted text-xs capitalize">{device.device_type}{device.has_push_token ? ' — push enabled' : ''}</div>
                </div>
                <button
                  onClick={() => handleDelete(device.id)}
                  disabled={deleting === device.id}
                  className="text-error/60 hover:text-error text-xs px-2 py-1 rounded hover:bg-error/10 disabled:opacity-50 shrink-0"
                >
                  {deleting === device.id ? '...' : 'Remove'}
                </button>
              </div>
            ))}
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

  const handleSave = () => {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned) return;
    localStorage.setItem('jolkr_server_url', cleaned);
    setSaved(true);
    setTimeout(() => window.location.reload(), 500);
  };

  return (
    <div>
      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Server URL</label>
      <p className="text-text-muted text-xs mt-1 mb-2">The Jolkr server this app connects to. Changing this will reload the app.</p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
          className="flex-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
        />
        {dirty && (
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded"
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}
