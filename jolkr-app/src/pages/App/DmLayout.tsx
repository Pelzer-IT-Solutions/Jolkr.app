import { Outlet } from 'react-router-dom';
import DmList from '../../components/DmList';
import UserPanel from '../../components/UserPanel';
import { useMobileNav } from '../../hooks/useMobileNav';

export default function DmLayout() {
  const { showSidebar, setShowSidebar, isMobile } = useMobileNav();

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Shared DM sidebar — persists across Home, DmChat, Friends */}
      <div className={`${isMobile ? 'w-full' : 'w-[260px]'} glass flex flex-col shrink-0 h-full !border-t-0 !border-b-0 overflow-hidden${isMobile && !showSidebar ? ' hidden' : ''}`}>
        <DmList onDmSelect={isMobile ? () => setShowSidebar(false) : undefined} />
        <UserPanel />
      </div>

      {/* Page content — rendered via Outlet */}
      <div className={`flex-1 min-w-0 flex flex-col h-full${isMobile && showSidebar ? ' hidden' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
}
