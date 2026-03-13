import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import DmList from '../../components/DmList';
import UserPanel from '../../components/UserPanel';
import { useMobileNav } from '../../hooks/useMobileNav';
import { SquarePen, MessageCircle, Users, Compass, User } from 'lucide-react';

export default function DmLayout() {
  const { showSidebar, setShowSidebar, isMobile } = useMobileNav();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from current route
  const activeTab = (() => {
    if (location.pathname === '/friends') return 'friends';
    if (location.pathname === '/settings') return 'profile';
    if (location.pathname.startsWith('/servers')) return 'servers';
    return 'messages';
  })();

  if (isMobile) {
    return (
      <div className="flex flex-1 h-full overflow-hidden flex-col">
        {/* Mobile sidebar view */}
        <div className={`flex-1 flex flex-col min-h-0 bg-sidebar${!showSidebar ? ' hidden' : ''}`}>
          {/* Header: "Messages" title + new message icon */}
          <div className="px-4 pt-2 pb-4 flex items-center justify-between shrink-0">
            <h1 className="text-2xl font-bold text-text-primary">Messages</h1>
            <button
              aria-label="New message"
              className="text-primary"
              onClick={() => {
                /* Navigate to home / open new DM flow */
                navigate('/');
              }}
            >
              <SquarePen className="size-5.5" />
            </button>
          </div>

          {/* DmList provides search, nav, and conversation list */}
          <DmList onDmSelect={() => setShowSidebar(false)} />
        </div>

        {/* Page content — rendered via Outlet */}
        <div className={`flex-1 min-w-0 flex flex-col h-full${showSidebar ? ' hidden' : ''}`}>
          <Outlet />
        </div>

        {/* Bottom tab bar */}
        <div className="bg-sidebar border-t border-border-subtle shrink-0">
          <div className="h-14 px-4 py-1 flex">
            <button
              onClick={() => { navigate('/'); setShowSidebar(true); }}
              className="flex-1 flex flex-col gap-1 items-center justify-center"
            >
              <MessageCircle className={`size-5.5 ${activeTab === 'messages' ? 'text-primary' : 'text-text-muted'}`} />
              <span className={`text-2xs font-semibold ${activeTab === 'messages' ? 'text-primary' : 'text-text-muted'}`}>Messages</span>
            </button>
            <button
              onClick={() => { navigate('/friends'); setShowSidebar(false); }}
              className="flex-1 flex flex-col gap-1 items-center justify-center"
            >
              <Users className={`size-5.5 ${activeTab === 'friends' ? 'text-primary' : 'text-text-muted'}`} />
              <span className={`text-2xs font-semibold ${activeTab === 'friends' ? 'text-primary' : 'text-text-muted'}`}>Friends</span>
            </button>
            <button
              onClick={() => {
                /* Navigate to first server if available, or stay */
                navigate('/');
              }}
              className="flex-1 flex flex-col gap-1 items-center justify-center"
            >
              <Compass className={`size-5.5 ${activeTab === 'servers' ? 'text-primary' : 'text-text-muted'}`} />
              <span className={`text-2xs font-semibold ${activeTab === 'servers' ? 'text-primary' : 'text-text-muted'}`}>Servers</span>
            </button>
            <button
              onClick={() => { navigate('/settings'); }}
              className="flex-1 flex flex-col gap-1 items-center justify-center"
            >
              <User className={`size-5.5 ${activeTab === 'profile' ? 'text-primary' : 'text-text-muted'}`} />
              <span className={`text-2xs font-semibold ${activeTab === 'profile' ? 'text-primary' : 'text-text-muted'}`}>Profile</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Shared DM sidebar — persists across Home, DmChat, Friends */}
      <div className="w-65 bg-sidebar border-l border-r border-divider flex flex-col shrink-0 h-full overflow-hidden">
        <DmList />
        <UserPanel />
      </div>

      {/* Page content — rendered via Outlet */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <Outlet />
      </div>
    </div>
  );
}
