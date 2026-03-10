import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useServersStore } from '../../../stores/servers';
import { useAuthStore } from '../../../stores/auth';
import type { Server } from '../../../api/types';
import { hasPermission, BAN_MEMBERS, MANAGE_ROLES, MANAGE_SERVER } from '../../../utils/permissions';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

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

const TabFallback = <div className="p-8 text-center text-text-muted">Loading...</div>;

export default function ServerSettingsDialog({ server, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === server.owner_id;
  const myPermsRaw = useServersStore((s) => s.permissions[server.id]);
  const myPerms = myPermsRaw ?? 0;
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        {/* Tabs */}
        <div className="flex border-b border-divider shrink-0">
          <div className="flex-1 flex overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  tab === t
                    ? 'text-text-primary border-b-2 border-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t === 'audit-log' ? 'Audit Log' : t}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="px-3 py-3 text-text-muted hover:text-text-primary shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
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
