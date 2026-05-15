import { clearStreamUrlCache } from '../hooks/useAuthedRedirectUrl';
import { invalidateFriendsCache } from '../services/friendshipCache';
import { resetPushRegistration } from '../services/pushRegistration';
import { useCallStore } from './call';
import { useContextMenuStore } from './context-menu';
import { useDmReadsStore } from './dm-reads';
import { useGifFavoritesStore } from './gif-favorites';
import { useMessagesStore } from './messages';
import { useNotificationSettingsStore } from './notification-settings';
import { usePresenceStore } from './presence';
import { useServersStore } from './servers';
import { useThreadsStore } from './threads';
import { useToast } from './toast';
import { useTypingStore } from './typing';
import { useUnreadStore } from './unread';
import { useUploadProgressStore } from './uploadProgress';
import { useUsersStore } from './users';
import { useVoiceStore } from './voice';

/** Reset all stores to initial state — call on logout to prevent stale data on re-login */
export function resetAllStores() {
  usePresenceStore.getState().clearAll();
  useServersStore.getState().reset();
  useMessagesStore.getState().reset();
  useThreadsStore.getState().reset();
  useUnreadStore.getState().reset();
  useCallStore.getState().reset();
  useDmReadsStore.getState().reset();
  useTypingStore.getState().reset();
  useVoiceStore.getState().reset();
  useGifFavoritesStore.getState().reset();
  useNotificationSettingsStore.getState().reset();
  useContextMenuStore.getState().reset();
  useUsersStore.getState().reset();
  useUploadProgressStore.getState().reset();
  clearStreamUrlCache();
  useToast.getState().clear();
  resetPushRegistration();
  invalidateFriendsCache();
}
