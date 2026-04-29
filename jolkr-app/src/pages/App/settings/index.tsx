import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../stores/auth';
import { useMobileNav } from '../../../hooks/useMobileNav';
import Avatar from '../../../components/Avatar';
import { hashColor } from '../../../adapters/transforms';
import { displayName } from '../../../utils/format';
import SettingsNavItem from '../../../components/ui/SettingsNavItem';
import { ArrowLeft, ChevronLeft, ChevronRight, User, Palette, Bell, Monitor, LogOut } from 'lucide-react';

const AccountTab = lazy(() => import('./AccountTab'));
const AppearanceTab = lazy(() => import('./AppearanceTab'));
const NotificationsTab = lazy(() => import('./NotificationsTab'));
const DevicesTab = lazy(() => import('./DevicesTab'));

const TAB_FALLBACK = <div className="p-8 text-center text-text-tertiary">Loading...</div>;

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

const TAB_ICONS: Record<Tab, typeof User> = {
  account: User,
  appearance: Palette,
  notifications: Bell,
  devices: Monitor,
};

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

  // Mobile: track which tab is "open" (null = show settings menu, non-null = show tab content)
  const [mobileOpenTab, setMobileOpenTab] = useState<Tab | null>(null);

  const handleMobileTabOpen = (tab: Tab) => {
    setActiveTab(tab);
    setMobileOpenTab(tab);
  };

  const handleMobileBack = () => {
    if (mobileOpenTab) {
      // Go back from tab content to settings menu
      setMobileOpenTab(null);
    } else {
      // Go back from settings to previous page
      setShowSidebar(true);
      navigate(-1);
    }
  };

  if (isMobile) {
    return (
      <div className="flex flex-1 h-full overflow-hidden bg-bg">
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Mobile: tab content view */}
          {mobileOpenTab ? (
            <>
              {/* Header with back + tab name — single row per Pencil */}
              <div className="px-4 pt-2 pb-4 flex items-center gap-2 shrink-0">
                <button
                  onClick={handleMobileBack}
                  className="text-text-secondary hover:text-text-primary shrink-0"
                  aria-label="Back to Settings"
                >
                  <ChevronLeft className="size-5.5" />
                </button>
                <h1 className="text-2xl font-bold text-text-primary">
                  {MOBILE_TAB_LABELS[mobileOpenTab]}
                </h1>
              </div>
              <div className="flex-1 flex flex-col gap-5 px-4 pb-4">
                <Suspense fallback={TAB_FALLBACK}>
                  {mobileOpenTab === 'account' && (
                    <AccountTab user={user} onProfileUpdate={updateProfile} onLogout={handleLogout} />
                  )}
                  {mobileOpenTab === 'appearance' && <AppearanceTab />}
                  {mobileOpenTab === 'notifications' && (
                    <NotificationsTab user={user} onProfileUpdate={updateProfile} />
                  )}
                  {mobileOpenTab === 'devices' && <DevicesTab />}
                </Suspense>
              </div>
            </>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 pt-2 pb-4 shrink-0">
                <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col gap-5 px-4 pb-4">
                {/* Profile card */}
                <button
                  onClick={() => handleMobileTabOpen('account')}
                  className="rounded-xl bg-panel gap-3.5 p-4 flex items-center text-left"
                >
                  <Avatar
                    url={user?.avatar_url}
                    name={displayName(user)}
                    size={52}
                    userId={user?.id}
                    color={user ? hashColor(user.id) : undefined}
                  />
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <span className="text-lg font-bold text-text-primary truncate">
                      {displayName(user)}
                    </span>
                    <span className="text-sm text-accent truncate">
                      @{user?.username || 'unknown'}
                    </span>
                  </div>
                  <ChevronRight className="size-5 text-text-tertiary shrink-0" />
                </button>

                {/* Settings groups */}
                <div className="rounded-xl bg-panel overflow-hidden">
                  {TABS.map((tab, i) => {
                    const Icon = TAB_ICONS[tab];
                    return (
                      <button
                        key={tab}
                        onClick={() => handleMobileTabOpen(tab)}
                        className={`w-full px-4 py-3.5 flex items-center gap-3 text-left ${
                          i < TABS.length - 1 ? 'border-b border-border-subtle' : ''
                        }`}
                      >
                        <Icon className="size-5 text-text-secondary shrink-0" />
                        <span className="text-base font-medium text-text-primary flex-1">
                          {MOBILE_TAB_LABELS[tab]}
                        </span>
                        <ChevronRight className="size-4.5 text-text-tertiary shrink-0" />
                      </button>
                    );
                  })}
                </div>

                {/* Logout group */}
                <div className="rounded-xl bg-panel overflow-hidden">
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
                  >
                    <LogOut className="size-5 text-danger shrink-0" />
                    <span className="text-base font-medium text-danger flex-1">Log Out</span>
                  </button>
                </div>

                {/* Version */}
                <div className="text-xs text-text-tertiary text-center pt-2">
                  Jolkr v{__APP_VERSION__}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-bg">
      {/* Settings sidebar — desktop only */}
      <div className="w-65 bg-sidebar flex flex-col shrink-0 h-full overflow-hidden">
        <div className="p-5 flex items-center">
          <h2 className="text-base font-bold text-text-primary">User Settings</h2>
        </div>
        <div className="px-3 py-2">
          <div className="space-y-0.5">
            {TABS.map((tab) => (
              <SettingsNavItem
                key={tab}
                label={TAB_LABELS[tab]}
                active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              />
            ))}
          </div>
        </div>
        <div className="bg-bg px-5 py-3.5 gap-2 flex items-center mt-auto">
          <button
            onClick={() => navigate(-1)}
            className="min-h-12 w-full flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm font-medium"
          >
            <ArrowLeft className="size-4" />
            Go Back
          </button>
        </div>
      </div>

      {/* Settings content — desktop */}
      <div className="flex-1 bg-panel flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col gap-6 px-12 py-8">
          <Suspense fallback={TAB_FALLBACK}>
            {activeTab === 'account' && (
              <AccountTab user={user} onProfileUpdate={updateProfile} onLogout={handleLogout} />
            )}
            {activeTab === 'appearance' && <AppearanceTab />}
            {activeTab === 'notifications' && (
              <NotificationsTab user={user} onProfileUpdate={updateProfile} />
            )}
            {activeTab === 'devices' && <DevicesTab />}
          </Suspense>

          {/* Build version + health link */}
          <div className="mt-auto pt-8 pb-4 flex items-center justify-between text-text-tertiary text-xs">
            <span>Jolkr v{__APP_VERSION__}</span>
            <a
              href="/health"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              Service Status
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
