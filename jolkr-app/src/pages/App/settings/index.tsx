import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../stores/auth';
import { useMobileNav } from '../../../hooks/useMobileNav';

const AccountTab = lazy(() => import('./AccountTab'));
const AppearanceTab = lazy(() => import('./AppearanceTab'));
const NotificationsTab = lazy(() => import('./NotificationsTab'));
const DevicesTab = lazy(() => import('./DevicesTab'));

const TAB_FALLBACK = <div className="p-8 text-center text-text-muted">Loading...</div>;

type Tab = 'account' | 'appearance' | 'notifications' | 'devices';

const TAB_LABELS: Record<Tab, string> = {
  account: 'My Account',
  appearance: 'Appearance',
  notifications: 'Notifications',
  devices: 'Devices',
};

const MOBILE_TAB_LABELS: Record<Tab, string> = {
  account: 'Account',
  appearance: 'Appearance',
  notifications: 'Notifications',
  devices: 'Devices',
};

const TABS: Tab[] = ['account', 'appearance', 'notifications', 'devices'];

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const logout = useAuthStore((s) => s.logout);
  const [activeTab, setActiveTab] = useState<Tab>('account');
  const { isMobile, setShowSidebar } = useMobileNav();

  // Hide ServerSidebar on mobile — Settings uses full width
  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile, setShowSidebar]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.warn('Logout error:', e);
    } finally {
      navigate('/login');
    }
  };

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-bg">
      {/* Settings sidebar — hidden on mobile, replaced by horizontal tabs */}
      {!isMobile && (
        <div className="w-[260px] bg-sidebar flex flex-col shrink-0 border-r border-divider h-full overflow-hidden">
          <div className="h-16 px-4 flex items-center border-b border-divider shrink-0">
            <h2 className="text-text-primary font-semibold text-[15px]">User Settings</h2>
          </div>
          <div className="px-2 pt-2">
            <div className="space-y-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`w-full text-left px-4 py-2 rounded text-sm ${activeTab === tab
                    ? 'bg-white/10 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                    }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-auto p-4">
            <button
              onClick={() => navigate(-1)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded border border-divider text-text-secondary hover:text-text-primary text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Go Back
            </button>
          </div>
        </div>
      )}

      {/* Settings content */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Mobile: horizontal tabs + back button */}
        {isMobile && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-divider shrink-0 overflow-x-auto">
            <button
              onClick={() => { setShowSidebar(true); navigate(-1); }}
              className="text-text-secondary hover:text-text-primary shrink-0 mr-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap shrink-0 ${activeTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:text-text-primary'
                  }`}
              >
                {MOBILE_TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        )}

        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8 max-w-[740px]'}`}>
          <Suspense fallback={TAB_FALLBACK}>
            {activeTab === 'account' && (
              <AccountTab user={user} onProfileUpdate={updateProfile} onLogout={handleLogout} />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab user={user} onProfileUpdate={updateProfile} />
            )}
            {activeTab === 'devices' && (
              <DevicesTab />
            )}
          </Suspense>

          {/* Build version + health link */}
          <div className="mt-auto pt-8 pb-4 flex items-center justify-between text-text-muted text-xs">
            <span>Jolkr v{__APP_VERSION__}</span>
            <a
              href="/health"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              Service Status
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
