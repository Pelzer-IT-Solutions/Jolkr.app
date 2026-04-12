import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import type { User } from '../../../api/types';
import * as api from '../../../api/client';
import Avatar from '../../../components/Avatar';
import { hashColor } from '../../../adapters/transforms';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import { rewriteStorageUrl } from '../../../platform/config';

export interface AccountTabProps {
  user: User | null;
  onProfileUpdate: (body: { username?: string; display_name?: string; bio?: string; avatar_url?: string }) => Promise<void>;
  onLogout: () => void;
}

function ChangePasswordBlock() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const canSave = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword && !saving;

  const handleSave = async () => {
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      const msg = (e as Error).message || 'Failed to change password';
      setError(msg.includes('Unauthorized') ? 'Current password is incorrect' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface border border-divider p-6 gap-4 flex flex-col">
      <h3 className="text-base font-bold text-text-primary">Password</h3>
      <div className="flex flex-col gap-4">
        <Input
          id="settings-current-pw"
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Input
          id="settings-new-pw"
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="Min. 8 characters, uppercase, lowercase, digit"
        />
        <Input
          id="settings-confirm-pw"
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          error={confirmPassword.length > 0 && newPassword !== confirmPassword ? 'Passwords do not match' : undefined}
        />
        {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded">{error}</div>}
        {success && <div className="bg-accent/10 text-accent text-sm p-2 rounded">Password changed successfully!</div>}
        <div>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Changing...' : 'Change Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AccountTab({ user, onProfileUpdate, onLogout }: AccountTabProps) {
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
            <Avatar url={displayAvatarUrl} name={user?.username ?? '?'} size="2xl" status="online" color={user ? hashColor(user.id) : undefined} />
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
          <Input
            id="settings-username"
            label="Username"
            value={user?.username ?? ''}
            disabled
          />
          <Input
            id="settings-displayname"
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How others see you (optional)"
          />
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
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <ChangePasswordBlock />

      {/* Danger zone */}
      <div className="rounded-xl bg-surface border border-divider p-6 gap-3 flex flex-col">
        <h3 className="text-base font-bold text-danger">Log Out</h3>
        <p className="text-sm text-text-secondary">This will disconnect you from all servers.</p>
        <div>
          <Button variant="danger" onClick={onLogout}>
            Log Out
          </Button>
        </div>
      </div>
    </>
  );
}
