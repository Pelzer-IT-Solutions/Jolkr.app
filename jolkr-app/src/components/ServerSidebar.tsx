import { Link, useParams } from 'react-router-dom';
import { useServersStore } from '../stores/servers';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import { rewriteStorageUrl } from '../platform/config';
import { hasPermission, MANAGE_CHANNELS, MANAGE_ROLES } from '../utils/permissions';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import * as api from '../api/client';
import CreateServerDialog from './dialogs/CreateServer';
import JoinServerDialog from './dialogs/JoinServer';
import ServerSettingsDialog from './dialogs/ServerSettingsDialog';
import InviteDialog from './dialogs/InviteDialog';
import ServerDiscovery from './dialogs/ServerDiscovery';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DragEndEvent } from '@dnd-kit/core';
import { Plus, UserPlus, Settings, LogIn, Search } from 'lucide-react';

/** Server icon with auto-retry on presigned URL expiry */
function ServerIconImg({ serverId, url, name }: { serverId: string; url: string; name: string }) {
  const [src, setSrc] = useState(() => rewriteStorageUrl(url) ?? url);
  const retriedRef = useRef(false);
  const [errored, setErrored] = useState(false);
  const prevUrlRef = useRef(url);

  if (url !== prevUrlRef.current) {
    prevUrlRef.current = url;
    setSrc(rewriteStorageUrl(url) ?? url);
    setErrored(false);
    retriedRef.current = false;
  }

  const handleError = async () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      try {
        const servers = await api.getServers();
        const fresh = servers.find((s) => s.id === serverId);
        if (fresh?.icon_url) {
          setSrc(rewriteStorageUrl(fresh.icon_url) ?? fresh.icon_url);
          return;
        }
      } catch { /* fall through */ }
    }
    setErrored(true);
  };

  if (errored) {
    return <span className="text-text-primary font-semibold text-sm">{name.slice(0, 2).toUpperCase()}</span>;
  }

  return <img src={src} alt={name} className="w-full h-full rounded-2xl object-cover" onError={handleError} />;
}

function SortableServerItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function ServerSidebar() {
  const { serverId } = useParams();
  const servers = useServersStore((s) => s.servers);
  const fetchServers = useServersStore((s) => s.fetchServers);
  const reorderServers = useServersStore((s) => s.reorderServers);
  const channels = useServersStore((s) => s.channels);
  const myPerms = useServersStore((s) => s.permissions);
  const currentUser = useAuthStore((s) => s.user);
  const unreadCounts = useUnreadStore((s) => s.counts);

  // Drag lock ref — replaces former module-level mutable state
  const dragLockRef = useRef(false);

  const [hovered, setHovered] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
  const [settingsServer, setSettingsServer] = useState<string | null>(null);
  const [inviteServer, setInviteServer] = useState<string | null>(null);
  const [showDiscover, setShowDiscover] = useState(false);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const serverIds = useMemo(() => servers.map((s) => s.id), [servers]);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    dragLockRef.current = true;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = servers.findIndex((s) => s.id === active.id);
    const newIndex = servers.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(servers, oldIndex, newIndex);
    reorderServers(reordered.map((s) => s.id));
  }, [servers, reorderServers]);

  const handleContextMenu = (e: React.MouseEvent, sId: string) => {
    e.preventDefault();
    setContextMenu({ serverId: sId, x: e.clientX, y: e.clientY });
  };

  const contextServer = contextMenu ? servers.find((s) => s.id === contextMenu.serverId) : null;
  const isContextOwner = contextServer && currentUser?.id === contextServer.owner_id;
  const contextPerms = contextMenu ? (myPerms[contextMenu.serverId] ?? 0) : 0;
  const canContextSettings = isContextOwner || hasPermission(contextPerms, MANAGE_CHANNELS) || hasPermission(contextPerms, MANAGE_ROLES);
  const settingsServerObj = settingsServer ? servers.find((s) => s.id === settingsServer) : null;

  return (
    <div className="w-18 h-full bg-bg py-3 gap-2 flex flex-col items-center shrink-0">
      {/* Home button header */}
      <div className="w-full flex items-center justify-center shrink-0 relative">
        <Link
          to={sessionStorage.getItem('jolkr_last_dm') ? `/dm/${sessionStorage.getItem('jolkr_last_dm')}` : '/'}
          onMouseEnter={() => setHovered('home')}
          onMouseLeave={() => setHovered(null)}
          className={`size-12 flex items-center justify-center transition-all duration-200 no-underline`}
        >
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Home" className="w-full h-full" />
        </Link>
      </div>
      <div className="w-8 h-0.5 bg-divider rounded-full shrink-0" />

      <div className="flex-1 flex flex-col items-center py-2 gap-2 overflow-y-auto w-full">
        {/* Server icons */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={serverIds} strategy={verticalListSortingStrategy}>
            {servers.map((server) => {
              const serverChannelIds = (channels[server.id] ?? []).map((c) => c.id);
              const serverUnread = serverChannelIds.reduce((sum, id) => sum + (unreadCounts[id] ?? 0), 0);

              return (
                <SortableServerItem key={server.id} id={server.id}>
                  <Link
                    to={`/servers/${server.id}`}
                    onClick={(e) => { if (dragLockRef.current) { dragLockRef.current = false; e.preventDefault(); } }}
                    onContextMenu={(e) => handleContextMenu(e, server.id)}
                    onMouseEnter={() => setHovered(server.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={server.name}
                    className={`size-12 rounded-2xl flex items-center justify-center transition-all duration-200 relative no-underline ${serverId === server.id
                      ? 'bg-elevated border-2 border-accent'
                      : hovered === server.id
                        ? 'bg-hover'
                        : 'bg-panel'
                      }`}
                  >
                    {server.icon_url ? (
                      <ServerIconImg serverId={server.id} url={server.icon_url} name={server.name} />
                    ) : (
                      <span className={`${serverId === server.id || hovered === server.id ? 'text-white' : 'text-text-primary'} font-bold text-lg`}>
                        {server.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {/* Active indicator */}
                    {serverId === server.id && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5.5 w-1 h-8 bg-text-primary rounded-r-full" />
                    )}
                    {/* Unread badge */}
                    {serverUnread > 0 && serverId !== server.id && (
                      <div className="absolute -bottom-0.5 -right-0.5 min-w-4.5 h-4.5 bg-danger rounded-full flex items-center justify-center px-1 border-2 border-bg">
                        <span className="text-2xs font-bold text-white">{serverUnread > 99 ? '99+' : serverUnread}</span>
                      </div>
                    )}
                  </Link>
                </SortableServerItem>
              );
            })}
          </SortableContext>
        </DndContext>

      </div>

      {/* Add server button — matches UserPanel height */}
      <div className="py-4 w-full flex items-center justify-center shrink-0">
        <button
          onClick={() => setShowAddMenu(true)}
          onMouseEnter={() => setHovered('add')}
          onMouseLeave={() => setHovered(null)}
          aria-label="Add a server"
          className={`size-12 rounded-2xl border-2 border-dashed border-divider flex items-center justify-center transition-all duration-200 ${hovered === 'add' ? 'bg-online border-online' : ''
            }`}
        >
          <Plus className={`size-5 ${hovered === 'add' ? 'text-white' : 'text-text-tertiary'}`} />
        </button>
      </div>

      {/* Context menu for server icons */}
      {contextMenu && contextServer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-divider rounded-xl shadow-float py-1 w-45"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { setContextMenu(null); setInviteServer(contextMenu.serverId); }}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
            >
              <UserPlus className="size-4" />
              Invite People
            </button>
            {canContextSettings && (
              <button
                onClick={() => { setContextMenu(null); setSettingsServer(contextMenu.serverId); }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
              >
                <Settings className="size-4" />
                Server Settings
              </button>
            )}
          </div>
        </>
      )}

      {/* Add server choice dialog */}
      {showAddMenu && (
        <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50" onClick={() => setShowAddMenu(false)}>
          <div className="bg-surface rounded-2xl border border-divider shadow-popup p-6 animate-modal-scale w-100 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-2 text-center">Add a Server</h3>
            <p className="text-text-secondary text-sm mb-6 text-center">Create your own or join an existing one</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowAddMenu(false); setShowCreate(true); }}
                className="w-full px-4 py-3 btn-primary text-sm rounded-lg flex items-center justify-center gap-2"
              >
                <Plus className="size-5" />
                Create a Server
              </button>
              <button
                onClick={() => { setShowAddMenu(false); setShowJoin(true); }}
                className="w-full px-4 py-3 btn-ghost text-sm rounded-lg flex items-center justify-center gap-2"
              >
                <LogIn className="size-5" />
                Join a Server
              </button>
              <button
                onClick={() => { setShowAddMenu(false); setShowDiscover(true); }}
                className="w-full px-4 py-3 btn-ghost text-sm rounded-lg flex items-center justify-center gap-2"
              >
                <Search className="size-5" />
                Discover Public Servers
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && <CreateServerDialog onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinServerDialog onClose={() => setShowJoin(false)} />}
      {settingsServerObj && <ServerSettingsDialog server={settingsServerObj} onClose={() => setSettingsServer(null)} />}
      {inviteServer && <InviteDialog serverId={inviteServer} onClose={() => setInviteServer(null)} />}
      {showDiscover && <ServerDiscovery onClose={() => setShowDiscover(false)} />}
    </div>
  );
}
