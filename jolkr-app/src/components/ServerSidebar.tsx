import { useNavigate, useParams } from 'react-router-dom';
import { useServersStore } from '../stores/servers';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import { rewriteStorageUrl } from '../platform/config';
import { hasPermission, MANAGE_CHANNELS, MANAGE_ROLES } from '../utils/permissions';
import { useEffect, useState } from 'react';
import CreateServerDialog from './dialogs/CreateServer';
import JoinServerDialog from './dialogs/JoinServer';
import ServerSettingsDialog from './dialogs/ServerSettingsDialog';
import InviteDialog from './dialogs/InviteDialog';
import ServerDiscovery from './dialogs/ServerDiscovery';

export default function ServerSidebar() {
  const navigate = useNavigate();
  const { serverId } = useParams();
  const servers = useServersStore((s) => s.servers);
  const fetchServers = useServersStore((s) => s.fetchServers);
  const channels = useServersStore((s) => s.channels);
  const myPerms = useServersStore((s) => s.permissions);
  const currentUser = useAuthStore((s) => s.user);
  const unreadCounts = useUnreadStore((s) => s.counts);
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
    <div className="w-[72px] h-full bg-serverbar flex flex-col items-center shrink-0">
      {/* Home button header */}
      <div className="h-14 w-full flex items-center justify-center border-b border-divider shrink-0">
        <button
          onClick={() => navigate('/')}
          onMouseEnter={() => setHovered('home')}
          onMouseLeave={() => setHovered(null)}
          className={`w-10 h-10 flex items-center justify-center transition-all duration-200 ${!serverId
              ? 'bg-primary rounded-2xl'
              : hovered === 'home'
                ? 'bg-primary rounded-2xl'
                : 'bg-surface rounded-3xl'
            }`}
        >
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Home" className="w-7 h-7 rounded" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center py-2 gap-2 overflow-y-auto w-full">
      {/* Server icons */}
      {servers.map((server) => {
        const serverChannelIds = (channels[server.id] ?? []).map((c) => c.id);
        const serverUnread = serverChannelIds.reduce((sum, id) => sum + (unreadCounts[id] ?? 0), 0);

        return (
          <button
            key={server.id}
            onClick={() => navigate(`/servers/${server.id}`)}
            onContextMenu={(e) => handleContextMenu(e, server.id)}
            onMouseEnter={() => setHovered(server.id)}
            onMouseLeave={() => setHovered(null)}
            title={server.name}
            className={`w-12 h-12 flex items-center justify-center transition-all duration-200 relative ${serverId === server.id
                ? 'bg-primary rounded-2xl'
                : hovered === server.id
                  ? 'bg-primary/80 rounded-2xl'
                  : 'bg-surface rounded-3xl'
              }`}
          >
            {server.icon_url ? (
              <img src={rewriteStorageUrl(server.icon_url) ?? server.icon_url} alt={server.name} className="w-full h-full rounded-[inherit] object-cover" />
            ) : (
              <span className="text-white font-semibold text-sm">
                {server.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            {/* Active indicator */}
            {serverId === server.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[22px] w-1 h-10 bg-white rounded-r-full" />
            )}
            {/* Unread badge */}
            {serverUnread > 0 && serverId !== server.id && (
              <div className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] bg-error rounded-full flex items-center justify-center px-1 border-2 border-serverbar">
                <span className="text-[10px] font-bold text-white">{serverUnread > 99 ? '99+' : serverUnread}</span>
              </div>
            )}
          </button>
        );
      })}

      </div>

      {/* Add server button — matches UserPanel height */}
      <div className="min-h-[60px] w-full flex items-center justify-center border-t border-divider shrink-0">
        <button
          onClick={() => setShowAddMenu(true)}
          onMouseEnter={() => setHovered('add')}
          onMouseLeave={() => setHovered(null)}
          aria-label="Add a server"
          className={`w-10 h-10 flex items-center justify-center transition-all duration-200 ${hovered === 'add' ? 'bg-online rounded-2xl' : 'bg-surface rounded-3xl'
            }`}
        >
          <svg className={`w-5 h-5 ${hovered === 'add' ? 'text-white' : 'text-online'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Context menu for server icons */}
      {contextMenu && contextServer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-divider rounded-lg shadow-lg py-1 w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { setContextMenu(null); setInviteServer(contextMenu.serverId); }}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Invite People
            </button>
            {canContextSettings && (
              <button
                onClick={() => { setContextMenu(null); setSettingsServer(contextMenu.serverId); }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Server Settings
              </button>
            )}
          </div>
        </>
      )}

      {/* Add server choice dialog */}
      {showAddMenu && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddMenu(false)}>
          <div className="bg-surface rounded-lg p-6 w-[400px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-2 text-center">Add a Server</h3>
            <p className="text-text-secondary text-sm mb-6 text-center">Create your own or join an existing one</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowAddMenu(false); setShowCreate(true); }}
                className="w-full px-4 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Create a Server
              </button>
              <button
                onClick={() => { setShowAddMenu(false); setShowJoin(true); }}
                className="w-full px-4 py-3 bg-input hover:bg-input/80 text-text-primary rounded-lg text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Join a Server
              </button>
              <button
                onClick={() => { setShowAddMenu(false); setShowDiscover(true); }}
                className="w-full px-4 py-3 bg-input hover:bg-input/80 text-text-primary rounded-lg text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
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
