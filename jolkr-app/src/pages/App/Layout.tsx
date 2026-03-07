import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import ServerSidebar from '../../components/ServerSidebar';
import Toast from '../../components/Toast';
import { MobileNavProvider, useMobileNav } from '../../hooks/useMobileNav';
import { wsClient } from '../../api/ws';

const FONT_SIZES: Record<string, string> = {
  small: '13px',
  normal: '15px',
  large: '17px',
};

function LayoutInner() {
  const { showSidebar, isMobile } = useMobileNav();
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const unsub = wsClient.on((op) => {
      if (op === 'Disconnected') setDisconnected(true);
      if (op === 'Ready') setDisconnected(false);
    });
    return unsub;
  }, []);

  return (
    <>
      {disconnected && (
        <div role="alert" aria-live="assertive" className="fixed top-0 left-0 right-0 z-[100] bg-error text-white text-center text-sm py-1.5 px-4">
          Connection lost. <button onClick={() => { setDisconnected(false); wsClient.connect(); }} className="underline font-medium ml-1">Reconnect</button>
        </div>
      )}
      <div className={isMobile && !showSidebar ? 'hidden' : ''}>
        <ServerSidebar />
      </div>
      <Outlet />
      <Toast />
    </>
  );
}

export default function Layout() {
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('jolkr_font_size') ?? 'normal');
  const [compact, setCompact] = useState(() => localStorage.getItem('jolkr_compact') === 'true');

  // Listen for settings changes from Settings page
  useEffect(() => {
    const handler = () => {
      setFontSize(localStorage.getItem('jolkr_font_size') ?? 'normal');
      setCompact(localStorage.getItem('jolkr_compact') === 'true');
    };
    window.addEventListener('storage', handler);
    // Also check on focus (for same-tab changes)
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);

  return (
    <div
      className={`h-full flex${compact ? ' compact-mode' : ''}`}
      style={{ fontSize: FONT_SIZES[fontSize] ?? '15px' }}
    >
      <MobileNavProvider>
        <LayoutInner />
      </MobileNavProvider>
    </div>
  );
}
