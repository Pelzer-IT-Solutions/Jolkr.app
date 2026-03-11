import { useRef, useState } from 'react';
import type { User } from '../../../api/types';
import * as api from '../../../api/client';
import Avatar from '../../../components/Avatar';
import { rewriteStorageUrl } from '../../../platform/config';

export interface AccountTabProps {
  user: User | null;
  onProfileUpdate: (body: { username?: string; display_name?: string; bio?: string; avatar_url?: string }) => Promise<void>;
  onLogout: () => void;
}

export default function AccountTab({ user, onProfileUpdate, onLogout }: AccountTabProps) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [avatarKey, setAvatarKey] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onProfileUpdate({
        username: username.trim(),
        display_name: displayName.trim() || undefined,
        bio: bio.trim(),
        avatar_url: avatarKey || undefined,
      });
      setAvatarKey('');
      setAvatarPreviewUrl('');
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to save changes');
    }
    finally { setSaving(false); }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const result = await api.uploadFile(file, 'avatar');
      setAvatarKey(result.key);
      setAvatarPreviewUrl(result.url);
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to upload avatar');
    }
    setAvatarUploading(false);
  };

  // Show preview from new upload, otherwise existing avatar
  const displayAvatarUrl = avatarPreviewUrl
    ? rewriteStorageUrl(avatarPreviewUrl)
    : user?.avatar_url;

  return (
    <>
      <h2 className="text-2xl font-bold text-text-primary mb-6">My Account</h2>

      {/* Profile card */}
      <div className="bg-surface rounded-xl p-8 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div
            role="button"
            tabIndex={0}
            className="relative group cursor-pointer shrink-0"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }}}
            aria-label="Upload avatar"
          >
            <Avatar url={displayAvatarUrl} name={user?.username ?? '?'} size={80} status="online" />
            <div className={`absolute top-0 left-0 w-20 h-20 rounded-full bg-black/50 flex items-center justify-center transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
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
            <label htmlFor="settings-username" className="text-xs font-bold text-text-secondary uppercase tracking-wider">Username</label>
            <input
              id="settings-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="settings-displayname" className="text-xs font-bold text-text-secondary uppercase tracking-wider">Display Name</label>
            <input
              id="settings-displayname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
              placeholder="How others see you (optional)"
            />
          </div>
          <div>
            <label htmlFor="settings-bio" className="text-xs font-bold text-text-secondary uppercase tracking-wider">Bio</label>
            <textarea
              id="settings-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm resize-none"
              rows={3}
              placeholder="Tell us about yourself"
            />
          </div>
          {saveError && <div className="bg-error/10 text-error text-sm p-2 rounded">{saveError}</div>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 btn-primary text-sm rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="border border-error/30 rounded-xl p-8">
        <h3 className="text-error font-semibold mb-2">Log Out</h3>
        <p className="text-text-secondary text-sm mb-4">This will disconnect you from all servers.</p>
        <button
          onClick={onLogout}
          className="px-4 py-2 bg-error hover:bg-error/80 text-white text-sm rounded"
        >
          Log Out
        </button>
      </div>
    </>
  );
}
