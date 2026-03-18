import { useState } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';
import { Link } from 'react-router-dom';
import { Settings, Pencil, X } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { usePresenceStore } from '../stores/presence';
import { wsClient } from '../api/ws';
import Avatar from './Avatar';
import VoiceConnectionBar from './VoiceConnectionBar';
import Input from './ui/Input';
import Button from './ui/Button';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online', color: 'bg-online' },
  { value: 'idle', label: 'Idle', color: 'bg-idle' },
  { value: 'dnd', label: 'Do Not Disturb', color: 'bg-dnd' },
  { value: 'offline', label: 'Invisible', color: 'bg-offline' },
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
  const pickerRef = useClickOutside<HTMLDivElement>(() => setShowPicker(false), showPicker && !showCustomStatus);
  const customStatusRef = useClickOutside<HTMLDivElement>(() => setShowCustomStatus(false), showCustomStatus);
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
      <div ref={pickerRef} className="bg-bg px-4 py-3 relative">
        <div className='min-h-12 gap-2.5 flex items-center shrink-0'>
          <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size="sm" status={currentStatus} userId={user?.id} />
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-0">
            <div className="text-sm font-semibold text-text-primary truncate">{user?.username ?? 'User'}</div>
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-xs text-left text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              {statusLabel(currentStatus)}
            </button>
            {user?.status && (
              <div className="text-xs text-left text-text-tertiary truncate">{user.status}</div>
            )}
          </div>
          <Link
            to="/settings"
            className="text-text-tertiary hover:text-text-primary p-1"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="size-5" />
          </Link>
        </div>

        {/* Status error */}
        {statusError && (
          <div className="absolute bottom-full left-2 mb-1 bg-danger/10 text-danger text-xs px-2 py-1 rounded z-50 max-w-50">
            {statusError}
          </div>
        )}

        {/* Status picker dropdown */}
        {showPicker && !showCustomStatus && (
          <>
            <div className="absolute bottom-full left-2 mb-2 bg-surface border border-divider rounded-xl shadow-float py-1 w-48 z-50">
              <button
                onClick={() => { setCustomStatusText(user?.status ?? ''); setShowCustomStatus(true); }}
                className="w-full px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-hover flex items-center gap-2 border-b border-divider mb-1"
              >
                <Pencil className="w-3.5 h-3.5" />
                {user?.status ? 'Edit Custom Status' : 'Set Custom Status'}
              </button>
              {user?.status && (
                <button
                  onClick={handleClearCustomStatus}
                  className="w-full px-3 py-1.5 text-left text-sm text-danger/70 hover:bg-danger/10 hover:text-danger flex items-center gap-2 border-b border-divider mb-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear Custom Status
                </button>
              )}
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-hover ${currentStatus === opt.value ? 'text-text-primary' : 'text-text-secondary'
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
            <div ref={customStatusRef} className="absolute bottom-full left-2 mb-2 bg-surface border border-divider rounded-xl shadow-float p-3 w-56 z-50">
              <div className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">Custom Status</div>
              <div className="mb-2">
                <Input
                  value={customStatusText}
                  onChange={(e) => setCustomStatusText(e.target.value)}
                  placeholder="What are you up to?"
                  maxLength={128}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSetCustomStatus()}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCustomStatus(false)} className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary">
                  Cancel
                </button>
                <Button onClick={handleSetCustomStatus} size="xs">
                  Save
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
