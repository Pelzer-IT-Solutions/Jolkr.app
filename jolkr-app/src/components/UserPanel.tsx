import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { usePresenceStore } from '../stores/presence';
import { wsClient } from '../api/ws';
import Avatar from './Avatar';
import VoiceConnectionBar from './VoiceConnectionBar';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online', color: 'bg-online' },
  { value: 'idle', label: 'Idle', color: 'bg-idle' },
  { value: 'dnd', label: 'Do Not Disturb', color: 'bg-dnd' },
  { value: 'offline', label: 'Invisible', color: 'bg-text-muted' },
] as const;

function statusLabel(s: string): string {
  switch (s) {
    case 'online': return 'Online';
    case 'idle': return 'Idle';
    case 'dnd': return 'Do Not Disturb';
    case 'offline': return 'Invisible';
    default: return 'Online';
  }
}

export default function UserPanel() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const userId = user?.id;
  const currentStatus = usePresenceStore((s) => (userId ? s.statuses[userId] : undefined)) ?? 'online';
  const setStatus = usePresenceStore((s) => s.setStatus);
  const [showPicker, setShowPicker] = useState(false);
  const [showCustomStatus, setShowCustomStatus] = useState(false);
  const [customStatusText, setCustomStatusText] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const handleStatusChange = (status: string) => {
    if (user) {
      setStatus(user.id, status);
      wsClient.updatePresence(status);
    }
    setShowPicker(false);
  };

  const handleSetCustomStatus = async () => {
    const text = customStatusText.trim() || null;
    try {
      await updateProfile({ status: text });
      setStatusError(null);
      setShowCustomStatus(false);
      setShowPicker(false);
    } catch (e) {
      console.warn('Failed to set custom status:', e);
      setStatusError((e as Error).message || 'Failed to set status');
    }
  };

  const handleClearCustomStatus = async () => {
    try {
      await updateProfile({ status: null });
      setStatusError(null);
    } catch (e) {
      console.warn('Failed to clear custom status:', e);
      setStatusError((e as Error).message || 'Failed to clear status');
    }
  };

  return (
    <div className="shrink-0">
      <VoiceConnectionBar />
    <div className="h-auto py-3 px-3 flex items-center gap-2 bg-serverbar/80 backdrop-blur-sm border-t border-divider relative">
      <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={36} status={currentStatus} userId={user?.id} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary font-medium truncate">{user?.username ?? 'User'}</div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="text-xs text-text-muted hover:text-text-secondary cursor-pointer"
        >
          {statusLabel(currentStatus)}
        </button>
        {user?.status && (
          <div className="text-xs text-text-muted truncate">{user.status}</div>
        )}
      </div>
      <Link
        to="/settings"
        className="text-text-secondary hover:text-text-primary p-1"
        title="Settings"
        aria-label="Settings"
      >
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </Link>

      {/* Status error */}
      {statusError && (
        <div className="absolute bottom-full left-2 mb-1 bg-error/10 text-error text-[11px] px-2 py-1 rounded z-50 max-w-[200px]">
          {statusError}
        </div>
      )}

      {/* Status picker dropdown */}
      {showPicker && !showCustomStatus && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
          <div className="absolute bottom-full left-2 mb-2 bg-surface border border-divider rounded-xl shadow-float py-1 w-48 z-50">
            <button
              onClick={() => { setCustomStatusText(user?.status ?? ''); setShowCustomStatus(true); }}
              className="w-full px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-white/[0.06] flex items-center gap-2 border-b border-divider mb-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              {user?.status ? 'Edit Custom Status' : 'Set Custom Status'}
            </button>
            {user?.status && (
              <button
                onClick={handleClearCustomStatus}
                className="w-full px-3 py-1.5 text-left text-sm text-error/70 hover:bg-error/10 hover:text-error flex items-center gap-2 border-b border-divider mb-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear Custom Status
              </button>
            )}
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-white/[0.06] ${
                  currentStatus === opt.value ? 'text-text-primary' : 'text-text-secondary'
                }`}
              >
                <div className={`w-3 h-3 rounded-full ${opt.color}`} />
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Custom status input popup */}
      {showCustomStatus && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowCustomStatus(false)} />
          <div className="absolute bottom-full left-2 mb-2 bg-surface border border-divider rounded-xl shadow-float p-3 w-56 z-50">
            <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Custom Status</div>
            <input
              value={customStatusText}
              onChange={(e) => setCustomStatusText(e.target.value)}
              placeholder="What are you up to?"
              className="w-full px-2 py-1.5 bg-input rounded text-text-primary text-sm mb-2"
              maxLength={128}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSetCustomStatus()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCustomStatus(false)} className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button onClick={handleSetCustomStatus} className="px-2 py-1 text-xs btn-primary rounded-lg">
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
