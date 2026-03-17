import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import Modal from '../ui/Modal';
import type { Channel, ChannelOverwrite, Role, Webhook } from '../../api/types';
import * as api from '../../api/client';
import { hasPermission, MANAGE_ROLES, MANAGE_WEBHOOKS, CHANNEL_PERMISSION_LABELS } from '../../utils/permissions';
import ConfirmDialog from './ConfirmDialog';
import Input from '../ui/Input';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Webhook as WebhookIcon } from 'lucide-react';

export interface EditChannelDialogProps {
  channel: Channel;
  serverId: string;
  onClose: () => void;
}

type TriState = 'inherit' | 'allow' | 'deny';

export default function EditChannelDialog({ channel, serverId, onClose }: EditChannelDialogProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'general' | 'permissions' | 'webhooks'>('general');
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [categoryId, setCategoryId] = useState(channel.category_id ?? '');
  const [isNsfw, setIsNsfw] = useState(channel.is_nsfw ?? false);
  const [slowmodeSeconds, setSlowmodeSeconds] = useState(channel.slowmode_seconds ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const updateChannel = useServersStore((s) => s.updateChannel);
  const deleteChannel = useServersStore((s) => s.deleteChannel);
  const categories = useServersStore((s) => s.categories);
  const serverCategories = categories[serverId] ?? [];
  const roles = useServersStore((s) => s.roles);
  const serverRoles = roles[serverId] ?? [];
  const permissions = useServersStore((s) => s.permissions);
  const canManageRoles = hasPermission(permissions[serverId] ?? 0, MANAGE_ROLES);
  const canManageWebhooks = hasPermission(permissions[serverId] ?? 0, MANAGE_WEBHOOKS);

  // Permission tab state
  const [overwrites, setOverwrites] = useState<ChannelOverwrite[]>([]);
  const [loadingOverwrites, setLoadingOverwrites] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [savingOverwrite, setSavingOverwrite] = useState<string | null>(null);

  const fetchRoles = useServersStore((s) => s.fetchRoles);

  const [overwriteError, setOverwriteError] = useState<string | null>(null);

  const fetchOverwrites = useCallback(async () => {
    setLoadingOverwrites(true);
    setOverwriteError(null);
    try {
      const data = await api.getChannelOverwrites(channel.id);
      setOverwrites(data);
    } catch (e) {
      setOverwriteError((e as Error).message || 'Failed to load permissions');
    }
    setLoadingOverwrites(false);
  }, [channel.id]);

  // Fetch roles on mount so Permissions tab has data
  useEffect(() => {
    if (canManageRoles && serverRoles.length === 0) {
      fetchRoles(serverId).catch(() => {});
    }
  }, [canManageRoles, serverRoles.length, fetchRoles, serverId]);

  useEffect(() => {
    if (tab === 'permissions' && canManageRoles) {
      fetchOverwrites();
    }
  }, [tab, canManageRoles, fetchOverwrites]);

  const handleSave = async () => {
    const formatted = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    if (!formatted) {
      setError('Channel name is required');
      return;
    }
    setSaving(true);
    try {
      await updateChannel(channel.id, serverId, {
        name: formatted,
        topic: topic.trim() || undefined,
        category_id: categoryId || undefined,
        is_nsfw: isNsfw,
        slowmode_seconds: slowmodeSeconds,
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
      await deleteChannel(channel.id, serverId);
      onClose();
      navigate(`/servers/${serverId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleAddRole = () => {
    if (!selectedRoleId) return;
    // Check if already has an overwrite
    if (overwrites.some((o) => o.target_type === 'role' && o.target_id === selectedRoleId)) {
      setSelectedRoleId('');
      return;
    }
    // Create a new overwrite with 0/0 (all inherit)
    handleSaveOverwrite('role', selectedRoleId, 0, 0);
    setSelectedRoleId('');
  };

  const handleSaveOverwrite = async (targetType: 'role' | 'member', targetId: string, allow: number, deny: number) => {
    setSavingOverwrite(targetId);
    try {
      await api.upsertChannelOverwrite(channel.id, { target_type: targetType, target_id: targetId, allow, deny });
      await fetchOverwrites();
    } catch (e) {
      setError((e as Error).message);
    }
    setSavingOverwrite(null);
  };

  const handleDeleteOverwrite = async (targetType: string, targetId: string) => {
    setSavingOverwrite(targetId);
    try {
      await api.deleteChannelOverwrite(channel.id, targetType, targetId);
      setOverwrites((prev) => prev.filter((o) => !(o.target_type === targetType && o.target_id === targetId)));
    } catch (e) {
      setError((e as Error).message);
    }
    setSavingOverwrite(null);
  };

  // Roles that don't already have an overwrite (for the "Add Role" dropdown)
  const availableRoles = serverRoles.filter(
    (r) => !overwrites.some((o) => o.target_type === 'role' && o.target_id === r.id)
  );

  return (
    <Modal open onClose={onClose} className="p-8 w-130 max-w-[90vw] max-h-[85vh] flex flex-col">
        <h3 className="text-text-primary text-lg font-semibold mb-4">Edit Channel</h3>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-divider">
          <button
            onClick={() => setTab('general')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'general' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            General
          </button>
          {canManageRoles && (
            <button
              onClick={() => setTab('permissions')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'permissions' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Permissions
            </button>
          )}
          {canManageWebhooks && (
            <button
              onClick={() => setTab('webhooks')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === 'webhooks' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Webhooks
            </button>
          )}
        </div>

        {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'general' && (
            <GeneralTab
              name={name}
              setName={setName}
              topic={topic}
              setTopic={setTopic}
              categoryId={categoryId}
              setCategoryId={setCategoryId}
              isNsfw={isNsfw}
              setIsNsfw={setIsNsfw}
              slowmodeSeconds={slowmodeSeconds}
              setSlowmodeSeconds={setSlowmodeSeconds}
              serverCategories={serverCategories}
              saving={saving}
              onSave={handleSave}
              onClose={onClose}
              onDeleteClick={() => setShowDeleteConfirm(true)}
            />
          )}

          {tab === 'permissions' && canManageRoles && (
            <PermissionsTab
              overwrites={overwrites}
              roles={serverRoles}
              availableRoles={availableRoles}
              selectedRoleId={selectedRoleId}
              setSelectedRoleId={setSelectedRoleId}
              onAddRole={handleAddRole}
              onSaveOverwrite={handleSaveOverwrite}
              onDeleteOverwrite={handleDeleteOverwrite}
              loading={loadingOverwrites}
              savingId={savingOverwrite}
              error={overwriteError}
            />
          )}

          {tab === 'webhooks' && canManageWebhooks && (
            <WebhooksTab channelId={channel.id} />
          )}
        </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Channel"
          message={`Are you sure you want to delete #${channel.name}? This cannot be undone.`}
          confirmLabel="Delete Channel"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </Modal>
  );
}

// ── General Tab ──────────────────────────────────────────────────────────

const SLOWMODE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

interface GeneralTabProps {
  name: string;
  setName: (v: string) => void;
  topic: string;
  setTopic: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  isNsfw: boolean;
  setIsNsfw: (v: boolean) => void;
  slowmodeSeconds: number;
  setSlowmodeSeconds: (v: number) => void;
  serverCategories: { id: string; name: string }[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onDeleteClick: () => void;
}

function GeneralTab({ name, setName, topic, setTopic, categoryId, setCategoryId, isNsfw, setIsNsfw, slowmodeSeconds, setSlowmodeSeconds, serverCategories, saving, onSave, onClose, onDeleteClick }: GeneralTabProps) {
  return (
    <>
      <div className="mb-4">
        <Input
          label="Channel Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="channel-name"
          autoFocus
        />
      </div>

      <div className="mb-4">
        <Input
          label="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What's this channel about?"
        />
      </div>

      {serverCategories.length > 0 && (
        <>
          <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full mt-1.5 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
          >
            <option value="">No Category</option>
            {serverCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </>
      )}

      <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Slowmode</label>
      <select
        value={slowmodeSeconds}
        onChange={(e) => setSlowmodeSeconds(Number(e.target.value))}
        className="w-full mt-1.5 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
      >
        {SLOWMODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <label className="flex items-center gap-2 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={isNsfw}
          onChange={(e) => setIsNsfw(e.target.checked)}
          className="w-4 h-4 rounded accent-accent"
        />
        <span className="text-sm text-text-primary">NSFW Channel</span>
        <span className="text-xs text-text-tertiary">— Users must confirm they are 18+</span>
      </label>

      <div className="flex justify-end gap-3 mb-6">
        <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-danger/20 p-5 gap-3 flex flex-col">
        <h4 className="text-base font-bold text-danger">Danger Zone</h4>
        <p className="text-sm text-text-secondary leading-relaxed">
          Deleting a channel is permanent. All messages in this channel will be lost.
        </p>
        <Button variant="danger" onClick={onDeleteClick}>
          Delete Channel
        </Button>
      </div>
    </>
  );
}

// ── Permissions Tab ──────────────────────────────────────────────────────

interface PermissionsTabProps {
  overwrites: ChannelOverwrite[];
  roles: Role[];
  availableRoles: Role[];
  selectedRoleId: string;
  setSelectedRoleId: (v: string) => void;
  onAddRole: () => void;
  onSaveOverwrite: (targetType: 'role' | 'member', targetId: string, allow: number, deny: number) => void;
  onDeleteOverwrite: (targetType: string, targetId: string) => void;
  loading: boolean;
  savingId: string | null;
  error?: string | null;
}

function PermissionsTab({
  overwrites, roles, availableRoles, selectedRoleId, setSelectedRoleId,
  onAddRole, onSaveOverwrite, onDeleteOverwrite, loading, savingId, error,
}: PermissionsTabProps) {
  if (loading) {
    return <div className="text-text-tertiary text-sm py-4">Loading permissions...</div>;
  }
  if (error) {
    return <div className="text-danger text-sm py-4">{error}</div>;
  }

  const roleOverwrites = overwrites.filter((o) => o.target_type === 'role');

  return (
    <div className="space-y-4">
      {/* Add role */}
      {availableRoles.length > 0 && (
        <div className="flex gap-2">
          <select
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value)}
            className="flex-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
          >
            <option value="">Select a role...</option>
            {availableRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <Button onClick={onAddRole} disabled={!selectedRoleId}>
            Add Role
          </Button>
        </div>
      )}

      {roleOverwrites.length === 0 && (
        <p className="text-text-tertiary text-sm">No permission overwrites set. All permissions are inherited from server roles.</p>
      )}

      {roleOverwrites.map((ow) => {
        const role = roles.find((r) => r.id === ow.target_id);
        return (
          <OverwriteEditor
            key={ow.id}
            overwrite={ow}
            label={role?.name ?? 'Unknown Role'}
            color={role?.color}
            saving={savingId === ow.target_id}
            onSave={(allow, deny) => onSaveOverwrite('role', ow.target_id, allow, deny)}
            onDelete={() => onDeleteOverwrite('role', ow.target_id)}
          />
        );
      })}
    </div>
  );
}

// ── Overwrite Editor (tri-state toggles) ─────────────────────────────────

interface OverwriteEditorProps {
  overwrite: ChannelOverwrite;
  label: string;
  color?: number;
  saving: boolean;
  onSave: (allow: number, deny: number) => void;
  onDelete: () => void;
}

function colorToHex(color: number | undefined): string | undefined {
  if (!color) return undefined;
  return '#' + color.toString(16).padStart(6, '0');
}

function OverwriteEditor({ overwrite, label, color, saving, onSave, onDelete }: OverwriteEditorProps) {
  const [allow, setAllow] = useState(overwrite.allow);
  const [deny, setDeny] = useState(overwrite.deny);

  // Sync local state when overwrite prop changes (e.g. after save + refetch)
  useEffect(() => {
    setAllow(overwrite.allow);
    setDeny(overwrite.deny);
  }, [overwrite.allow, overwrite.deny]);

  const dirty = allow !== overwrite.allow || deny !== overwrite.deny;

  const getState = (flag: number): TriState => {
    if ((allow & flag) !== 0) return 'allow';
    if ((deny & flag) !== 0) return 'deny';
    return 'inherit';
  };

  const cycleState = (flag: number) => {
    const current = getState(flag);
    if (current === 'inherit') {
      // → allow
      setAllow((a) => a | flag);
      setDeny((d) => d & ~flag);
    } else if (current === 'allow') {
      // → deny
      setAllow((a) => a & ~flag);
      setDeny((d) => d | flag);
    } else {
      // → inherit
      setAllow((a) => a & ~flag);
      setDeny((d) => d & ~flag);
    }
  };

  // Group permissions by category
  const categories = [...new Set(CHANNEL_PERMISSION_LABELS.map((p) => p.category))];

  return (
    <div className="border border-divider rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-surface/50">
        {color !== undefined && color !== 0 && (
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorToHex(color) }} />
        )}
        <span className="text-text-primary font-medium text-sm flex-1">{label}</span>
        <button
          onClick={onDelete}
          disabled={saving}
          className="text-danger/70 hover:text-danger text-xs disabled:opacity-50"
          title="Remove overwrite"
        >
          Remove
        </button>
      </div>

      {/* Permission toggles */}
      <div className="px-4 py-2 space-y-3">
        {categories.map((cat) => (
          <div key={cat}>
            <div className="text-2xs text-text-tertiary uppercase tracking-wider mb-1">{cat}</div>

            {CHANNEL_PERMISSION_LABELS.filter((p) => p.category === cat).map((perm) => {
              const state = getState(perm.flag);
              return (
                <div key={perm.key} className="flex items-center justify-between py-0.5">
                  <span className="text-sm text-text-secondary">{perm.label}</span>
                  <button
                    onClick={() => cycleState(perm.flag)}
                    className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold transition-colors ${
                      state === 'allow'
                        ? 'bg-green-500/20 text-green-400'
                        : state === 'deny'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-hover text-text-tertiary'
                    }`}
                    title={state === 'inherit' ? 'Inherit' : state === 'allow' ? 'Allowed' : 'Denied'}
                  >
                    {state === 'allow' ? '\u2713' : state === 'deny' ? '\u2715' : '/'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Save button */}
      {dirty && (
        <div className="px-4 py-2 border-t border-divider flex justify-end">
          <button
            onClick={() => {
              setAllow(overwrite.allow);
              setDeny(overwrite.deny);
            }}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary mr-2"
          >
            Reset
          </button>
          <Button onClick={() => onSave(allow, deny)} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Webhooks Tab ──────────────────────────────────────────────────────────

function WebhooksTab({ channelId }: { channelId: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await api.getChannelWebhooks(channelId);
      setWebhooks(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [channelId]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const wh = await api.createWebhook(channelId, { name });
      setWebhooks((prev) => [...prev, wh]);
      setNewName('');
    } catch (e) {
      setError((e as Error).message);
    }
    setCreating(false);
  };

  const handleSaveEdit = async (id: string) => {
    setSavingId(id);
    setError('');
    try {
      const wh = await api.updateWebhook(id, {
        name: editName.trim() || undefined,
        avatar_url: editAvatarUrl.trim() || undefined,
      });
      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, ...wh } : w)));
      setEditingId(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setSavingId(null);
  };

  const handleRegenerate = async (id: string) => {
    setSavingId(id);
    setError('');
    try {
      const wh = await api.regenerateWebhookToken(id);
      setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, token: wh.token } : w)));
    } catch (e) {
      setError((e as Error).message);
    }
    setSavingId(null);
  };

  const handleDelete = async (id: string) => {
    setShowDeleteConfirm(null);
    setSavingId(id);
    try {
      await api.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
    setSavingId(null);
  };

  const copyWebhookUrl = (wh: Webhook) => {
    const url = `https://jolkr.app/api/webhooks/${wh.id}/${wh.token ?? ''}`;
    navigator.clipboard.writeText(url);
    setCopiedId(wh.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return <div className="text-text-tertiary text-sm py-4">Loading webhooks...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg">{error}</div>}

      {/* Create webhook */}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Webhook name"
          className="flex-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </Button>
      </div>

      {webhooks.length === 0 && (
        <EmptyState icon={<WebhookIcon className="size-8" />} title="No webhooks yet." description="Create one to let external services send messages to this channel." />
      )}

      {webhooks.map((wh) => (
        <div key={wh.id} className="border border-divider rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface/50">
            <div className="w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center text-accent text-xs font-bold shrink-0">
              {wh.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-text-primary text-sm font-medium truncate">{wh.name}</div>
              <div className="text-text-tertiary text-xs truncate">ID: {wh.id}</div>
            </div>
            <div className="flex gap-1 shrink-0 flex-wrap justify-end">
              {wh.token && (
                <button
                  onClick={() => copyWebhookUrl(wh)}
                  className="px-2 py-1 text-xs bg-hover hover:bg-hover text-text-secondary rounded"
                  title="Copy webhook URL"
                >
                  {copiedId === wh.id ? 'Copied!' : 'Copy URL'}
                </button>
              )}
              <button
                onClick={() => {
                  setEditingId(editingId === wh.id ? null : wh.id);
                  setEditName(wh.name);
                  setEditAvatarUrl(wh.avatar_url ?? '');
                }}
                className="px-2 py-1 text-xs bg-hover hover:bg-hover text-text-secondary rounded"
              >
                {editingId === wh.id ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={() => handleRegenerate(wh.id)}
                disabled={savingId === wh.id}
                className="px-2 py-1 text-xs bg-hover hover:bg-hover text-text-secondary rounded disabled:opacity-50"
                title="Regenerate token"
              >
                Regen
              </button>
              <button
                onClick={() => setShowDeleteConfirm(wh.id)}
                disabled={savingId === wh.id}
                className="px-2 py-1 text-xs text-danger/70 hover:text-danger bg-hover hover:bg-hover rounded disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Edit form */}
          {editingId === wh.id && (
            <div className="px-4 py-3 border-t border-divider space-y-2">
              <Input
                label="Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <Input
                label="Avatar URL"
                value={editAvatarUrl}
                onChange={(e) => setEditAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
              />
              <div className="flex justify-end">
                <Button onClick={() => handleSaveEdit(wh.id)} disabled={savingId === wh.id}>
                  {savingId === wh.id ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {showDeleteConfirm === wh.id && (
            <div className="px-4 py-3 border-t border-divider bg-danger/5">
              <p className="text-sm text-text-primary mb-2">
                Delete webhook <strong>{wh.name}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <Button variant="danger" onClick={() => handleDelete(wh.id)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
