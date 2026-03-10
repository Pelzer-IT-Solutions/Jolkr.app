import { useEffect, useRef, useState } from 'react';
import * as api from '../../../api/client';
import { rewriteStorageUrl } from '../../../platform/config';
import type { Server, ServerEmoji, User } from '../../../api/types';

export interface EmojisTabProps {
  server: Server;
}

const MAX_EMOJIS = 50;

export default function EmojisTab({ server }: EmojisTabProps) {
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [emojiUsers, setEmojiUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getServerEmojis(server.id).then((data) => {
      if (cancelled) return;
      setEmojis(data);
      const userIds = new Set<string>();
      for (const e of data) userIds.add(e.uploader_id);
      userIds.forEach((id) => {
        if (!fetchedIdsRef.current.has(id)) {
          fetchedIdsRef.current.add(id);
          api.getUser(id).then((u) => {
            if (!cancelled) setEmojiUsers((prev) => ({ ...prev, [u.id]: u }));
          }).catch(() => {});
        }
      });
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [server.id]);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !name.trim()) return;
    if (!/^[a-zA-Z0-9_]+$/.test(name.trim())) {
      setError('Emoji name can only contain letters, numbers, and underscores');
      return;
    }
    if (emojis.length >= MAX_EMOJIS) {
      setError(`Maximum of ${MAX_EMOJIS} emojis per server`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const emoji = await api.uploadEmoji(server.id, name.trim(), file);
      setEmojis((prev) => [...prev, emoji]);
      setName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!fetchedIdsRef.current.has(emoji.uploader_id)) {
        fetchedIdsRef.current.add(emoji.uploader_id);
        api.getUser(emoji.uploader_id).then((u) => {
          setEmojiUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (emojiId: string) => {
    setDeleting(emojiId);
    setError('');
    try {
      await api.deleteEmoji(emojiId);
      setEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return <div className="text-text-muted text-sm py-4">Loading emojis...</div>;
  }

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg mb-3">{error}</div>}

      <div className="text-text-secondary text-xs mb-3">
        {emojis.length} / {MAX_EMOJIS} emojis
      </div>

      {/* Upload form */}
      <div className="flex items-end gap-2 mb-4 p-3 bg-input rounded-lg">
        <div className="flex-1">
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Emoji Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_emoji"
            className="w-full mt-1 px-3 py-2 bg-surface rounded-lg text-text-primary text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Image</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="w-full mt-1 text-text-primary text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-surface file:text-text-secondary file:cursor-pointer"
          />
        </div>
        <button
          onClick={handleUpload}
          disabled={uploading || !name.trim()}
          className="btn-primary px-5 py-2.5 text-sm rounded-lg disabled:opacity-50 shrink-0"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {/* Emoji list */}
      {emojis.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No custom emojis yet.</div>
      ) : (
        <div className="space-y-1">
          {emojis.map((emoji) => {
            const uploader = emojiUsers[emoji.uploader_id];
            return (
              <div key={emoji.id} className="flex items-center gap-3 p-2 rounded hover:bg-white/5">
                <img
                  src={rewriteStorageUrl(emoji.image_url) ?? emoji.image_url}
                  alt={emoji.name}
                  className="w-8 h-8 object-contain shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">:{emoji.name}:</div>
                  <div className="text-text-muted text-xs">
                    Uploaded by {uploader?.username ?? 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(emoji.id)}
                  disabled={deleting === emoji.id}
                  className="px-3 py-1 text-xs text-error hover:text-error/80 bg-white/5 hover:bg-white/10 rounded shrink-0 disabled:opacity-50"
                >
                  {deleting === emoji.id ? '...' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
