import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { useServersStore } from './stores/servers';
import { getBasename, hasServerUrl, isDevMachine } from './platform/config';
import { isTauri } from './platform/detect';
import { initTokens, getAccessToken } from './api/client';
import * as api from './api/client';
import { initNotifications, requestNotificationPermission } from './services/notifications';
import { registerPush } from './services/pushRegistration';
import { initE2EE } from './services/e2ee';
import { checkForUpdate, type UpdateInfo } from './services/updater';
import { onDeepLink, initDeepLinks } from './services/deepLink';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateNotification from './components/UpdateNotification';
import IncomingCallDialog from './components/IncomingCallDialog';
import OutgoingCallDialog from './components/OutgoingCallDialog';
import { useCallEvents } from './hooks/useCallEvents';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import NotFound from './pages/NotFound';
import Layout from './pages/App/Layout';
import DmLayout from './pages/App/DmLayout';
import Home from './pages/App/Home';
import ServerPage from './pages/App/Server';
import ChannelPage from './pages/App/Channel';
import DmChat from './pages/App/DmChat';
import Friends from './pages/App/Friends';
import Settings from './pages/App/Settings';
import InviteAccept from './pages/InviteAccept';
import ServerSetup from './pages/ServerSetup';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppInit({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const [ready, setReady] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  // Disable default browser context menu globally — custom menus handle their own
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // In Tauri desktop: block browser shortcuts that don't belong in a desktop app
  useEffect(() => {
    if (!isTauri) return;
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Block: Ctrl+R/Shift+R (reload), Ctrl+L (address bar), Ctrl+G (find next),
      // Ctrl+U (view source), Ctrl+P (print), Ctrl+J (downloads), Ctrl+H (history),
      // F5/Shift+F5 (reload), F7 (caret browsing)
      if (ctrl && ['r', 'l', 'g', 'u', 'p', 'j', 'h'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
      }
      if (['F5', 'F7'].includes(e.key)) {
        e.preventDefault();
        return;
      }
      // Block Ctrl+Shift+I (devtools) in release builds
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    initTokens().then(() => loadUser()).then(() => {
      // Only register push if user is logged in (has access token)
      if (getAccessToken()) {
        requestNotificationPermission().then(() => registerPush()).catch(console.warn);
        // Load E2EE keys from storage (no seed — keys were set during login)
        const deviceId = localStorage.getItem('jolkr_e2ee_device_id');
        if (deviceId) {
          initE2EE(deviceId).catch(console.warn);
        }
      }

      // Check for updates after 5s delay (Tauri only)
      if (isTauri) {
        setTimeout(() => {
          checkForUpdate().then(setUpdateInfo).catch(console.warn);
        }, 5000);
      }
    }).finally(() => {
      setReady(true);
      initNotifications();
    });
  }, [loadUser]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <>
      {updateInfo && <UpdateNotification update={updateInfo} />}
      <CallOverlays />
      {children}
    </>
  );
}

function CallOverlays() {
  useCallEvents();
  return (
    <>
      <IncomingCallDialog />
      <OutgoingCallDialog />
    </>
  );
}

function DeepLinkHandler() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    onDeepLink(async (path, params) => {
      if (path === 'invite' && params.code) {
        if (!userRef.current) {
          sessionStorage.setItem('jolkr_pending_invite', params.code);
          navigate('/login');
          return;
        }
        try {
          const invite = await api.useInvite(params.code);
          await useServersStore.getState().fetchServers();
          navigate(`/servers/${invite.server_id}`);
        } catch (e) {
          console.error('Failed to use invite:', e);
        }
      }
    });

    initDeepLinks();
  }, [navigate]); // stable deps only — user read from ref, fetchServers from getState()

  return null;
}

export default function App() {
  const [serverReady, setServerReady] = useState(() => hasServerUrl());

  // Tauri dev machine: show server selection on first launch
  if (isTauri && isDevMachine && !serverReady) {
    return (
      <ErrorBoundary>
        <ServerSetup onComplete={() => setServerReady(true)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <BrowserRouter basename={getBasename()}>
        <AppInit>
          <DeepLinkHandler />
          <Routes>
            <Route path="/login" element={<GuestGuard><Login /></GuestGuard>} />
            <Route path="/register" element={<GuestGuard><Register /></GuestGuard>} />
            <Route path="/forgot-password" element={<GuestGuard><ForgotPassword /></GuestGuard>} />
            <Route path="/invite/:code" element={<InviteAccept />} />
            <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
              {/* DmLayout shares the DM sidebar (DmList + UserPanel) across these routes */}
              <Route element={<DmLayout />}>
                <Route index element={<Home />} />
                <Route path="dm/:dmId" element={<DmChat />} />
                <Route path="friends" element={<Friends />} />
              </Route>
              <Route path="servers/:serverId" element={<ServerPage />} />
              <Route path="servers/:serverId/channels/:channelId" element={<ChannelPage />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppInit>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
