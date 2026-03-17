import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useServersStore, selectMyPermissions } from '../../../stores/servers';
import { useAuthStore } from '../../../stores/auth';
import type { Server } from '../../../api/types';
import { hasPermission, BAN_MEMBERS, MANAGE_ROLES, MANAGE_SERVER } from '../../../utils/permissions';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { X } from 'lucide-react';

const GeneralTab = lazy(() => import('./GeneralTab'));
const RolesTab = lazy(() => import('./RolesTab'));
const MembersTab = lazy(() => import('./MembersTab'));
const BansTab = lazy(() => import('./BansTab'));
const EmojisTab = lazy(() => import('./EmojisTab'));
const AuditLogTab = lazy(() => import('./AuditLogTab'));

interface Props {
  server: Server;
  onClose: () => void;
}

type Tab = 'general' | 'roles' | 'members' | 'bans' | 'emojis' | 'audit-log';

const TabFallback = <div className="p-8 text-center text-text-tertiary">Loading...</div>;

export default function ServerSettingsDialog({ server, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === server.owner_id;
  const myPerms = useServersStore(selectMyPermissions(server.id));
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  // Owner always has full access; for non-owners, derive from loaded permissions
  const canBan = isOwner || hasPermission(myPerms, BAN_MEMBERS);
  const canManageRoles = isOwner || hasPermission(myPerms, MANAGE_ROLES);
  const canManageServer = isOwner || hasPermission(myPerms, MANAGE_SERVER);

  useEffect(() => {
    fetchPermissions(server.id);
  }, [server.id, fetchPermissions]);

  // Escape key handler for dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: Tab[] = ['general', 'roles'];
  if (canManageRoles) tabs.push('members');
  if (canBan) tabs.push('bans');
  if (canManageServer) tabs.push('emojis');
  if (canManageServer) tabs.push('audit-log');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-sidebar rounded-3xl border border-divider shadow-popup w-135 h-157 max-w-[95vw] max-h-[85vh] flex flex-col animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        {/* Tabs */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <div className="flex items-center gap-5 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`capitalize transition-colors whitespace-nowrap shrink-0 ${
                  tab === t
                    ? 'flex flex-col gap-1'
                    : 'text-sm font-medium text-text-tertiary hover:text-text-primary'
                }`}
              >
                <span className={tab === t ? 'text-sm font-semibold text-text-primary' : ''}>
                  {t === 'audit-log' ? 'Audit Log' : t}
                </span>
                {tab === t && <span className="h-0.5 bg-accent rounded-full" />}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="size-5 text-text-tertiary hover:text-text-primary shrink-0">
            <X className="size-5" />
          </button>
        </div>

        <div className={`flex-1 min-h-0 flex flex-col ${tab === 'roles' ? '' : 'overflow-y-auto px-6 py-4'}`}>
          <Suspense fallback={TabFallback}>
            {tab === 'general' && <GeneralTab server={server} onClose={onClose} isOwner={isOwner} />}
            {tab === 'roles' && <RolesTab server={server} />}
            {tab === 'members' && <MembersTab server={server} />}
            {tab === 'bans' && <BansTab server={server} />}
            {tab === 'emojis' && <EmojisTab server={server} />}
            {tab === 'audit-log' && <AuditLogTab server={server} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
