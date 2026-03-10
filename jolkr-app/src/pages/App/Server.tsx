import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import ChannelList from '../../components/ChannelList';
import UserPanel from '../../components/UserPanel';
import InviteDialog from '../../components/dialogs/InviteDialog';
import { useMobileNav } from '../../hooks/useMobileNav';

export default function ServerPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const servers = useServersStore((s) => s.servers);
  const serversLoading = useServersStore((s) => s.loading);
  const server = servers.find((s) => s.id === serverId);
  const [showInvites, setShowInvites] = useState(false);
  const [fetchAttempted, setFetchAttempted] = useState(false);
  const { showSidebar, setShowSidebar, isMobile } = useMobileNav();

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
    if (serversLoading || !fetchAttempted) {
      return (
        <div className="flex-1 flex items-center justify-center bg-bg">
          <p className="text-text-muted">Loading server...</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <div className="text-center">
          <p className="text-text-muted text-lg mb-2">Server not found</p>
          <p className="text-text-muted text-sm">This server may have been deleted, or you don't have access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Channel list sidebar */}
        <div className={`${isMobile ? 'w-full' : 'w-[260px]'} bg-sidebar flex flex-col shrink-0 h-full overflow-hidden${isMobile && !showSidebar ? ' hidden' : ''}`}>
          <ChannelList server={server} onChannelSelect={isMobile ? () => setShowSidebar(false) : undefined} />

          {/* Invite + User panel */}
          <div className="border-t border-divider">
            <button
              onClick={() => setShowInvites(true)}
              className="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Invite People
            </button>
          </div>

          <UserPanel />
        </div>

      {/* Main content - no channel selected */}
        <div className={`flex-1 flex flex-col bg-bg min-h-0${isMobile && showSidebar ? ' hidden' : ''}`}>
          <div className="h-16 px-4 flex items-center border-b border-divider shrink-0">
            {isMobile && (
              <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-3">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <span className="text-text-primary font-semibold">{server.name}</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/15 flex items-center justify-center">
                <span className="text-primary text-2xl font-bold">#</span>
              </div>
              <h2 className="text-xl font-semibold text-text-primary mb-2">Select a channel</h2>
              <p className="text-text-secondary text-sm">Pick a text channel from the sidebar to start chatting</p>
            </div>
          </div>
        </div>

      {showInvites && <InviteDialog serverId={server.id} onClose={() => setShowInvites(false)} />}
    </div>
  );
}
