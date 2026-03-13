import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import * as api from '../../api/client';
import type { User } from '../../api/types';
import Avatar from '../Avatar';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { X } from 'lucide-react';

export interface CreateGroupDmDialogProps {
  onClose: () => void;
}

const MAX_MEMBERS = 10;

export default function CreateGroupDmDialog({ onClose }: CreateGroupDmDialogProps) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const maxOthers = MAX_MEMBERS - 1; // minus the caller

  // Clean up search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(() => {
      api.searchUsers(value.trim())
        .then((results) => setSearchResults(
          results.filter((u) => u.id !== currentUser?.id),
        ))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [currentUser?.id]);

  const addUser = (user: User) => {
    if (selectedUsers.find((u) => u.id === user.id)) return;
    if (selectedUsers.length >= maxOthers) return;
    setSelectedUsers((prev) => [...prev, user]);
    setSearch('');
    setSearchResults([]);
  };

  const removeUser = (userId: string) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleCreate = async () => {
    if (selectedUsers.length < 2) {
      setError('Select at least 2 other users');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const dm = await api.createGroupDm(
        selectedUsers.map((u) => u.id),
        name.trim() || undefined,
      );
      onClose();
      navigate(`/dm/${dm.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const totalMembers = selectedUsers.length + 1; // +1 for caller

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-sidebar rounded-3xl border border-divider shadow-popup p-8 w-120 max-w-[90vw] max-h-[80vh] flex flex-col animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-1">Create Group DM</h3>
        <p className="text-text-tertiary text-xs mb-4">{totalMembers}/{MAX_MEMBERS} members</p>

        {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

        {/* Group name */}
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          Group Name (Optional)
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Group Chat"
          maxLength={100}
          className="w-full mt-1 mb-3 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm outline-none"
        />

        {/* Selected users as chips */}
        {selectedUsers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {selectedUsers.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1 bg-accent-muted text-accent rounded-full px-2.5 py-1 text-xs"
              >
                {u.username}
                <button
                  onClick={() => removeUser(u.id)}
                  className="hover:text-danger ml-0.5"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* User search */}
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          Add Members
        </label>
        <input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search users..."
          className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm outline-none"
          disabled={selectedUsers.length >= maxOthers}
        />

        {/* Search results */}
        <div className="flex-1 overflow-y-auto mt-2 max-h-50">
          {searching && (
            <div className="text-text-tertiary text-xs px-2 py-1">Searching...</div>
          )}
          {searchResults
            .filter((u) => !selectedUsers.find((s) => s.id === u.id))
            .slice(0, 10)
            .map((u) => (
              <button
                key={u.id}
                onClick={() => addUser(u)}
                className="w-full px-2 py-1.5 rounded flex items-center gap-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
              >
                <Avatar url={u.avatar_url} name={u.username} size={28} userId={u.id} />
                <span className="truncate">{u.username}</span>
              </button>
            ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-divider">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || selectedUsers.length < 2}
            className="btn-primary px-5 py-2.5 text-sm rounded-lg disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Group DM'}
          </button>
        </div>
      </div>
    </div>
  );
}
