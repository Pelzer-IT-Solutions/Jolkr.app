import { usePresenceStore } from './presence';
import { useServersStore } from './servers';
import { useMessagesStore } from './messages';
import { useUnreadStore } from './unread';
import { useCallStore } from './call';
import { useDmReadsStore } from './dm-reads';
import { useTypingStore } from './typing';
import { useGifFavoritesStore } from './gif-favorites';
import { useVoiceStore } from './voice';
import { useContextMenuStore } from './context-menu';
import { useToast } from '../components/Toast';
import { invalidateFriendsCache } from '../services/friendshipCache';

/** Reset all stores to initial state — call on logout to prevent stale data on re-login */
export function resetAllStores() {
  usePresenceStore.getState().clearAll();
  useServersStore.getState().reset();
  useMessagesStore.getState().reset();
  useUnreadStore.getState().reset();
  useCallStore.getState().reset();
  useDmReadsStore.getState().reset();
  useTypingStore.getState().reset();
  useVoiceStore.getState().reset();
  useGifFavoritesStore.setState({ ids: new Set(), loaded: false });
  useContextMenuStore.getState().close();
  useToast.getState().clear();
  invalidateFriendsCache();
}
