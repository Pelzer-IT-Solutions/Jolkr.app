import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
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
      <h2 className="text-2xl font-bold text-text-primary">My Account</h2>

      {/* Profile card */}
      <div className="rounded-xl bg-surface border border-divider p-6 gap-5 flex flex-col">
        <div className="flex items-center gap-4">
          <div
            role="button"
            tabIndex={0}
            className="relative group cursor-pointer shrink-0"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }}}
            aria-label="Upload avatar"
          >
            <Avatar url={displayAvatarUrl} name={user?.username ?? '?'} size="2xl" status="online" />
            <div className={`absolute inset-0 size-14 rounded-full bg-black/50 flex items-center justify-center transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
              {avatarUploading ? (
                <div className="text-white text-xs font-medium animate-pulse">Uploading</div>
              ) : (
                <Camera className="size-5 text-white" />
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
            <div className="text-xl font-bold text-text-primary">{user?.username}</div>
            <div className="text-sm text-text-secondary">{user?.email}</div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="settings-username" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Username</label>
            <input
              id="settings-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="settings-displayname" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Display Name</label>
            <input
              id="settings-displayname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
              placeholder="How others see you (optional)"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="settings-bio" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Bio</label>
            <textarea
              id="settings-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary resize-none h-20"
              placeholder="Tell us about yourself"
            />
          </div>
          {saveError && <div className="bg-danger/10 text-danger text-sm p-2 rounded">{saveError}</div>}
          <div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl bg-surface border border-divider p-6 gap-3 flex flex-col">
        <h3 className="text-base font-bold text-danger">Log Out</h3>
        <p className="text-sm text-text-secondary">This will disconnect you from all servers.</p>
        <div>
          <button
            onClick={onLogout}
            className="btn-danger"
          >
            Log Out
          </button>
        </div>
      </div>
    </>
  );
}
