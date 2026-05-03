import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { STORAGE_KEYS } from './utils/storageKeys';
import { useAuthStore } from './stores/auth';
import { useServersStore } from './stores/servers';
import { getBasename } from './platform/config';
import { isTauri } from './platform/detect';
import { initTokens, getAccessToken } from './api/client';
import * as api from './api/client';
import { useToast } from './stores/toast';
import { requestNotificationPermission } from './services/notifications';
import { startUnreadBadge } from './services/unreadBadge';
import { registerPush } from './services/pushRegistration';
import { initE2EE } from './services/e2ee';
import { checkForUpdate, type UpdateInfo } from './services/updater';
import { onDeepLink, initDeepLinks } from './services/deepLink';
import ErrorBoundary from './components/ErrorBoundary';
import TextContextMenu from './components/TextContextMenu';
import ContextMenu from './components/ContextMenu';
import UpdateNotification from './components/UpdateNotification';
import IncomingCallDialog from './components/CallDialogs/IncomingCallDialog';
import OutgoingCallDialog from './components/CallDialogs/OutgoingCallDialog';
import { useCallEvents } from './hooks/useCallEvents';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import NotFound from './pages/NotFound';
import AppShell from './pages/App/AppShell';
import InviteAccept from './pages/InviteAccept';
import VerifyEmail from './pages/VerifyEmail';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const location = useLocation();

  if (loading) return null; // Splash from index.html covers this
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!user.email_verified) return <Navigate to="/verify-email" replace />;
  return <>{children}</>;
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppInit({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const [ready, setReady] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  // Theme is applied by inline script in index.html (before React mount)
  // and managed by useColorMode() in AppShell.

  // Disable default browser context menu globally — custom TextContextMenu handles input/textarea
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
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
    startUnreadBadge();
    initTokens().then(() => loadUser()).then(() => {
      // Only register push if user is logged in (has access token)
      if (getAccessToken()) {
        requestNotificationPermission().then(() => registerPush()).catch(console.warn);
        // Load E2EE keys from storage (no seed — keys were set during login)
        const deviceId = localStorage.getItem(STORAGE_KEYS.E2EE_DEVICE_ID);
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
    });
  }, [loadUser]);

  if (!ready) {
    return null; // Splash is shown by index.html inline styles — no double loading screen
  }

  return (
    <>
      {updateInfo && <UpdateNotification update={updateInfo} />}
      <CallOverlays />
      <TextContextMenu />
      <ContextMenu />
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

// Per-user-id cooldown so a malicious QR scanned twice in a row can't spam the
// friend-request endpoint. Backend rate-limits anyway; this is just UX polish.
const FRIEND_REQUEST_COOLDOWN_MS = 5_000;
const lastFriendRequestAt = new Map<string, number>();

function DeepLinkHandler() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    onDeepLink(async (path, params) => {
      if (path === 'invite' && params.code) {
        if (!userRef.current) {
          sessionStorage.setItem(STORAGE_KEYS.PENDING_INVITE, params.code);
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

      if (path === 'add' && params.userId) {
        if (!userRef.current) {
          sessionStorage.setItem(STORAGE_KEYS.PENDING_ADD_FRIEND, params.userId);
          navigate('/login');
          return;
        }
        const last = lastFriendRequestAt.get(params.userId) ?? 0;
        if (Date.now() - last < FRIEND_REQUEST_COOLDOWN_MS) return;
        lastFriendRequestAt.set(params.userId, Date.now());
        try {
          await api.sendFriendRequest(params.userId);
          useToast.getState().show('Friend request sent', 'success');
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to send friend request';
          useToast.getState().show(msg, 'error');
        }
      }
    });

    initDeepLinks();
  }, [navigate]); // stable deps only — user read from ref, fetchServers from getState()

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={getBasename()}>
        <AppInit>
          <DeepLinkHandler />
          <Routes>
            <Route path="/login" element={<GuestGuard><Login /></GuestGuard>} />
            <Route path="/register" element={<GuestGuard><Register /></GuestGuard>} />
            <Route path="/forgot-password" element={<GuestGuard><ForgotPassword /></GuestGuard>} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/invite/:code" element={<InviteAccept />} />
            <Route path="/*" element={<AuthGuard><AppShell /></AuthGuard>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppInit>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
