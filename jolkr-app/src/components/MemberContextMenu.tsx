import { useCallback, useEffect, useRef, useState } from 'react';
import type { Role } from '../api/types';
import * as api from '../api/client';
import ConfirmDialog from './dialogs/ConfirmDialog';

export interface MemberContextMenuProps {
  userId: string;
  serverId: string;
  username: string;
  position: { x: number; y: number };
  canKick: boolean;
  canBan: boolean;
  canManageNicknames: boolean;
  canTimeout: boolean;
  canManageRoles: boolean;
  isTargetOwner: boolean;
  isSelf: boolean;
  roles: Role[];
  memberRoleIds: string[];
  memberNickname?: string | null;
  memberTimeoutUntil?: string | null;
  onClose: () => void;
  onMembersChanged: () => void;
  onError: (msg: string) => void;
}

export default function MemberContextMenu({
  userId,
  serverId,
  username,
  position,
  canKick,
  canBan,
  canManageNicknames,
  canTimeout,
  canManageRoles,
  memberNickname,
  memberTimeoutUntil,
  onClose,
  onMembersChanged,
  onError,
  roles,
  memberRoleIds,
}: MemberContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const banDialogRef = useRef<HTMLDivElement>(null);
  const nicknameDialogRef = useRef<HTMLDivElement>(null);

  const [showKickConfirm, setShowKickConfirm] = useState(false);
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [nicknameValue, setNicknameValue] = useState('');
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);
  const [rolePopover, setRolePopover] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(true);

  const isTimedOut = memberTimeoutUntil != null && new Date(memberTimeoutUntil) > new Date();
  const assignableRoles = roles.filter((r) => !r.is_default);

  // Close context menu on click outside + keyboard navigation
  useEffect(() => {
    if (!menuVisible) return;
    // Focus the first menu item when opened
    requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      items?.[0]?.focus();
    });
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (!items || items.length === 0) return;
        const current = document.activeElement as HTMLElement;
        const idx = Array.from(items).indexOf(current);
        let next = 0;
        if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0;
        else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        items[next]?.focus();
      }
      if (e.key === 'Tab') { e.preventDefault(); close(); }
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuVisible, onClose]);

  // Escape key handler for ban dialog
  useEffect(() => {
    if (!showBanDialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowBanDialog(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBanDialog]);

  // Escape key handler for nickname dialog
  useEffect(() => {
    if (!showNicknameDialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNicknameDialog(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNicknameDialog]);

  const handleKick = async () => {
    setShowKickConfirm(false);
    onError('');
    setActionLoading(true);
    try {
      await api.kickMember(serverId, userId);
      onMembersChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async () => {
    setShowBanDialog(false);
    onError('');
    setActionLoading(true);
    try {
      await api.banMember(serverId, userId, banReason.trim() || undefined);
      setBanReason('');
      onMembersChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetNickname = async () => {
    setShowNicknameDialog(false);
    onError('');
    setActionLoading(true);
    try {
      await api.setNickname(serverId, userId, nicknameValue.trim() || undefined);
      setNicknameValue('');
      onMembersChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRole = useCallback(async (roleId: string, hasRole: boolean) => {
    setRoleSaving(true);
    onError('');
    try {
      if (hasRole) {
        await api.removeRole(serverId, roleId, userId);
      } else {
        await api.assignRole(serverId, roleId, userId);
      }
      onMembersChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRoleSaving(false);
    }
  }, [serverId, userId, onMembersChanged, onError]);

  const handleTimeout = async (seconds: number) => {
    setShowTimeoutDialog(false);
    onError('');
    setActionLoading(true);
    try {
      const until = new Date(Date.now() + seconds * 1000).toISOString();
      await api.timeoutMember(serverId, userId, until);
      onMembersChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveTimeout = async () => {
    setShowTimeoutDialog(false);
    onError('');
    setActionLoading(true);
    try {
      await api.removeTimeout(serverId, userId);
      onMembersChanged();
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const closeMenuAndOpen = (setter: (v: boolean) => void) => {
    setMenuVisible(false);
    setter(true);
  };

  return (
    <>
      {/* Context menu */}
      {menuVisible && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 bg-surface border border-divider rounded-lg shadow-float py-1 min-w-40"
          style={{ left: position.x, top: position.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {canManageRoles && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left"
              onClick={(e) => {
                e.stopPropagation();
                closeMenuAndOpen(setRolePopover);
              }}
            >
              Manage Roles
            </button>
          )}
          {canManageNicknames && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left"
              onClick={() => {
                setNicknameValue(memberNickname ?? '');
                closeMenuAndOpen(setShowNicknameDialog);
              }}
            >
              Change Nickname
            </button>
          )}
          {canTimeout && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left"
              onClick={() => closeMenuAndOpen(setShowTimeoutDialog)}
            >
              {isTimedOut ? 'Remove Timeout' : 'Timeout'}
            </button>
          )}
          {canKick && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-warning hover:bg-warning/10 text-left"
              onClick={() => closeMenuAndOpen(setShowKickConfirm)}
            >
              Kick
            </button>
          )}
          {canBan && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-danger hover:bg-danger/10 text-left"
              onClick={() => {
                setBanReason('');
                closeMenuAndOpen(setShowBanDialog);
              }}
            >
              Ban
            </button>
          )}
        </div>
      )}

      {/* Kick confirm */}
      {showKickConfirm && (
        <ConfirmDialog
          title="Kick Member"
          message={`Are you sure you want to kick ${username} from the server?`}
          confirmLabel="Kick"
          danger
          onConfirm={handleKick}
          onCancel={() => { setShowKickConfirm(false); onClose(); }}
        />
      )}

      {/* Ban dialog */}
      {showBanDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowBanDialog(false); onClose(); }}>
          <div ref={banDialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-100 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-1">Ban Member</h3>
            <p className="text-text-tertiary text-sm mb-3">
              Ban <span className="text-text-primary font-medium">{username}</span> from the server? They will be removed and unable to rejoin.
            </p>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Reason (Optional)
            </label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Reason for ban..."
              className="w-full mt-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm resize-none mb-4"
              rows={2}
              maxLength={512}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowBanDialog(false); onClose(); }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={handleBan}
                disabled={actionLoading}
                className="px-4 py-2 bg-danger hover:bg-danger/80 text-white text-sm rounded disabled:opacity-50"
              >
                {actionLoading ? 'Banning...' : 'Ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role popover */}
      {rolePopover && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setRolePopover(false); onClose(); }}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-4 w-70 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-text-primary text-sm font-semibold mb-2">
              Manage Roles — {username}
            </h4>
            <div className="space-y-0.5 max-h-62 overflow-y-auto">
              {assignableRoles.length === 0 && (
                <div className="text-text-tertiary text-xs py-2">No roles available</div>
              )}
              {assignableRoles.map((role) => {
                const has = memberRoleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(role.id, has)}
                    disabled={roleSaving}
                    className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-hover rounded disabled:opacity-50"
                  >
                    <input type="checkbox" checked={has} readOnly className="w-3.5 h-3.5 rounded accent-primary pointer-events-none" />
                    {role.color !== 0 && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }} />
                    )}
                    <span className="text-text-secondary truncate">{role.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={() => { setRolePopover(false); onClose(); }} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeout dialog */}
      {showTimeoutDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowTimeoutDialog(false); onClose(); }}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-3">
              {isTimedOut ? 'Remove Timeout' : 'Timeout Member'}
            </h3>
            <p className="text-text-tertiary text-sm mb-4">
              {isTimedOut
                ? `${username} is timed out until ${new Date(memberTimeoutUntil!).toLocaleString()}`
                : `Timeout ${username} — they won't be able to send messages or react.`
              }
            </p>
            {isTimedOut ? (
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowTimeoutDialog(false); onClose(); }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                <button onClick={handleRemoveTimeout} disabled={actionLoading} className="px-4 py-2 btn-primary text-sm rounded-lg disabled:opacity-50">
                  Remove Timeout
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {[
                  { label: '60 seconds', seconds: 60 },
                  { label: '5 minutes', seconds: 300 },
                  { label: '10 minutes', seconds: 600 },
                  { label: '1 hour', seconds: 3600 },
                  { label: '1 day', seconds: 86400 },
                  { label: '1 week', seconds: 604800 },
                ].map(({ label, seconds }) => (
                  <button
                    key={seconds}
                    onClick={() => handleTimeout(seconds)}
                    disabled={actionLoading}
                    className="w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left rounded disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
                <div className="flex justify-end mt-2">
                  <button onClick={() => { setShowTimeoutDialog(false); onClose(); }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nickname dialog */}
      {showNicknameDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowNicknameDialog(false); onClose(); }}>
          <div ref={nicknameDialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-100 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-3">Change Nickname</h3>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Nickname
            </label>
            <input
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              placeholder="Leave empty to reset"
              className="w-full mt-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
              maxLength={32}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && !actionLoading && handleSetNickname()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowNicknameDialog(false); onClose(); }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={handleSetNickname}
                disabled={actionLoading}
                className="px-4 py-2 btn-primary text-sm rounded-lg disabled:opacity-50"
              >
                {actionLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
