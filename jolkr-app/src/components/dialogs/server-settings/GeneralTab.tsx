import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useServersStore } from '../../../stores/servers';
import * as api from '../../../api/client';
import { rewriteStorageUrl } from '../../../platform/config';
import type { Server } from '../../../api/types';
import ConfirmDialog from '../ConfirmDialog';

export interface GeneralTabProps {
  server: Server;
  onClose: () => void;
  isOwner: boolean;
}

export default function GeneralTab({ server, onClose, isOwner }: GeneralTabProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? '');
  const [iconUrl, setIconUrl] = useState(server.icon_url ?? '');
  const [iconKey, setIconKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateServer = useServersStore((s) => s.updateServer);
  const deleteServer = useServersStore((s) => s.deleteServer);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadFile(file, 'icon');
      setIconKey(result.key);
      setIconUrl(result.url);
    } catch { setError('Failed to upload icon'); }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }
    setSaving(true);
    try {
      await updateServer(server.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        icon_url: iconKey || undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteServer(server.id);
      onClose();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

      {/* Server icon */}
      <div className="flex items-center gap-4 mb-4">
        <div
          role="button"
          tabIndex={0}
          className="size-18 rounded-full bg-panel border-2 border-divider flex items-center justify-center relative group cursor-pointer shrink-0 overflow-hidden"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }}}
          aria-label="Upload server icon"
        >
          {iconUrl ? (
            <img src={rewriteStorageUrl(iconUrl) ?? iconUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-text-tertiary text-lg font-bold">{name.slice(0, 2).toUpperCase()}</span>
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {uploading ? (
              <span className="text-white text-2xs">...</span>
            ) : (
              <Camera className="size-6 text-text-tertiary" />
            )}
          </div>
        </div>
        <div className="text-xs text-text-tertiary">
          Click to upload server icon<br />Recommended: 128x128px
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Server Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary resize-none h-20"
          placeholder="What's this server about?"
        />
      </div>

      <div className="flex justify-end gap-3 mb-6">
        <span onClick={onClose} className="text-sm font-medium text-text-secondary cursor-pointer flex items-center">
          Cancel
        </span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-5 py-2.5 text-sm rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Danger zone — only owner can delete */}
      {isOwner && (
        <div className="rounded-xl border border-danger/20 p-5 flex flex-col gap-3">
          <h4 className="text-base font-bold text-danger">Danger Zone</h4>
          <p className="text-sm text-text-secondary leading-relaxed">
            Deleting a server is permanent and cannot be undone. All channels and messages will be lost.
          </p>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="btn-danger self-start"
          >
            Delete Server
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Server"
          message={`Are you sure you want to delete "${server.name}"? This action is permanent and cannot be undone.`}
          confirmLabel="Delete Server"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
