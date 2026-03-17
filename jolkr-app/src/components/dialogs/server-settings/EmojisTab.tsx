import { useEffect, useRef, useState } from 'react';
import { Trash2, ImageIcon } from 'lucide-react';
import * as api from '../../../api/client';
import { rewriteStorageUrl } from '../../../platform/config';
import Input from '../../ui/Input';
import Button from '../../ui/Button';
import EmptyState from '../../ui/EmptyState';
import { Smile } from 'lucide-react';
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
    return <div className="text-text-tertiary text-sm py-4">Loading emojis...</div>;
  }

  return (
    <div className="flex flex-col gap-5 min-h-full">
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg">{error}</div>}

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-tertiary">{emojis.length} / {MAX_EMOJIS} emojis</span>
      </div>

      {/* Upload form */}
      <div className="flex items-center gap-3 rounded-lg bg-panel border border-divider px-4 py-3 shrink-0">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Image</label>
          <div className="flex items-center gap-2 rounded-lg bg-bg border border-divider px-3.5 py-2.5">
            <ImageIcon className="size-4 text-text-tertiary shrink-0" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="text-sm text-text-tertiary flex-1 min-w-0 file:mr-2 file:py-0 file:px-0 file:border-0 file:text-sm file:bg-transparent file:text-text-tertiary file:cursor-pointer"
            />
          </div>
        </div>
        <div className="w-36 shrink-0">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_emoji"
          />
        </div>
        <Button onClick={handleUpload} disabled={uploading || !name.trim()} className="shrink-0 self-end">
          {uploading ? 'Uploading...' : 'Upload'}
        </Button>
      </div>

      {/* Emoji list / empty state */}
      {emojis.length === 0 ? (
        <EmptyState icon={<Smile className="size-8" />} title="No custom emojis yet" />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {emojis.map((emoji) => {
            const uploader = emojiUsers[emoji.uploader_id];
            return (
              <div key={emoji.id} className="flex items-center gap-3 px-1 py-3 border-b border-border-subtle">
                <img
                  src={rewriteStorageUrl(emoji.image_url) ?? emoji.image_url}
                  alt={emoji.name}
                  className="size-8 object-contain shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">:{emoji.name}:</div>
                  <div className="text-text-tertiary text-xs">
                    Uploaded by {uploader?.username ?? 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(emoji.id)}
                  disabled={deleting === emoji.id}
                  className="p-1.5 text-text-tertiary hover:text-danger rounded shrink-0 disabled:opacity-50 transition-colors"
                  aria-label={`Delete :${emoji.name}: emoji`}
                >
                  {deleting === emoji.id ? (
                    <span className="text-xs">...</span>
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
