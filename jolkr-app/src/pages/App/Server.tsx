import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore, selectServerMembers } from '../../stores/servers';
import ChannelList from '../../components/ChannelList';
import UserPanel from '../../components/UserPanel';
import InviteDialog from '../../components/dialogs/InviteDialog';
import ServerSettingsDialog from '../../components/dialogs/ServerSettingsDialog';
import { useMobileNav } from '../../hooks/useMobileNav';
import { rewriteStorageUrl } from '../../platform/config';
import { UserPlus, ChevronLeft, Hash, Settings } from 'lucide-react';

export default function ServerPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const servers = useServersStore((s) => s.servers);
  const serversLoading = useServersStore((s) => s.loading);
  const server = servers.find((s) => s.id === serverId);
  const members = useServersStore(selectServerMembers(serverId ?? ''));
  const [showInvites, setShowInvites] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fetchAttempted, setFetchAttempted] = useState(false);
  const { showSidebar, setShowSidebar, isMobile } = useMobileNav();
  const memberCount = server ? (server.member_count ?? members.length ?? 0) : 0;

  // On mobile, server landing = show sidebar (channel list)
  useEffect(() => {
    if (isMobile) setShowSidebar(true);
  }, [serverId, isMobile, setShowSidebar]);

  useEffect(() => {
    if (!server && serverId && !fetchAttempted) {
      setFetchAttempted(true);
      useServersStore.getState().fetchServers();
    }
  }, [server, serverId, fetchAttempted]);

  // Reset fetch attempted when serverId changes
  useEffect(() => { setFetchAttempted(false); }, [serverId]);

  if (!server) {
    if (!fetchAttempted || (serversLoading && servers.length === 0)) {
      return (
        <div className="flex-1 flex items-center justify-center bg-panel">
          <p className="text-text-tertiary">Loading server...</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center bg-panel">
        <div className="text-center">
          <p className="text-text-tertiary text-lg mb-2">Server not found</p>
          <p className="text-text-tertiary text-sm">This server may have been deleted, or you don't have access.</p>
        </div>
      </div>
    );
  }

  const serverIconUrl = rewriteStorageUrl(server.icon_url);
  const serverInitials = server.name.trim().split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Channel list sidebar */}
      {isMobile ? (
        <div className={`w-full bg-sidebar flex flex-col shrink-0 h-full overflow-hidden${!showSidebar ? ' hidden' : ''}`}>
          {/* Mobile server header — Pencil design */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-border-subtle shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Server icon: 36px, rounded 10px */}
              <div className="size-9 rounded-lg overflow-hidden shrink-0 bg-accent/20 flex items-center justify-center">
                {serverIconUrl ? (
                  <img src={serverIconUrl} alt={server.name} className="size-9 object-cover" />
                ) : (
                  <span className="text-base font-bold text-accent">{serverInitials}</span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary truncate">{server.name}</h2>
                {memberCount > 0 && (
                  <p className="text-xs text-text-secondary">{memberCount} {memberCount === 1 ? 'member' : 'members'}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="shrink-0 p-1"
              aria-label="Server settings"
            >
              <Settings className="size-5 text-text-secondary" />
            </button>
          </div>

          {/* Channel list with mobile overrides — hide ChannelList built-in header */}
          <div className="flex-1 flex flex-col min-h-0">
            <ChannelList server={server} onChannelSelect={() => setShowSidebar(false)} />
          </div>

          {/* Invite + User panel */}
          <div className="border-t border-border-subtle">
            <button
              onClick={() => setShowInvites(true)}
              className="w-full px-4 py-2 text-left text-sm text-accent hover:bg-hover flex items-center gap-2"
            >
              <UserPlus className="size-4" />
              Invite People
            </button>
          </div>

          <UserPanel />
        </div>
      ) : (
        <div className="w-65 bg-sidebar flex flex-col shrink-0 h-full overflow-hidden">
          <ChannelList server={server} />

          {/* Invite + User panel */}
          <div className="border-t border-border-subtle">
            <button
              onClick={() => setShowInvites(true)}
              className="w-full px-4 py-2 text-left text-sm text-accent hover:bg-hover flex items-center gap-2"
            >
              <UserPlus className="size-4" />
              Invite People
            </button>
          </div>

          <UserPanel />
        </div>
      )}

      {/* Main content - no channel selected */}
        <div className={`flex-1 flex flex-col bg-panel min-h-0${isMobile && showSidebar ? ' hidden' : ''}`}>
          <div className="px-5 py-3 flex justify-between items-center border-b border-border-subtle shrink-0">
            {isMobile && (
              <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-3">
                <ChevronLeft className="size-5" />
              </button>
            )}
            <span className="text-base font-semibold text-text-primary">{server.name}</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="size-18 rounded-full bg-accent-muted flex items-center justify-center">
              <Hash className="size-8 text-accent" />
            </div>
            <h2 className="text-xl font-bold text-text-primary">Select a channel</h2>
            <p className="text-text-secondary text-sm">Pick a text channel from the sidebar to start chatting</p>
          </div>
        </div>

      {showInvites && <InviteDialog serverId={server.id} onClose={() => setShowInvites(false)} />}
      {showSettings && <ServerSettingsDialog server={server} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
