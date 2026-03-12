import { useEffect, useRef } from 'react';
import { useMessagesStore } from '../stores/messages';
import { useServersStore } from '../stores/servers';
import { useAuthStore } from '../stores/auth';

/** Interval at which presigned S3 URLs are refreshed (3 hours). */
const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Periodically re-fetches data with presigned S3 URLs to prevent
 * expired URLs from breaking images and attachments.
 *
 * Refreshes: current channel messages, servers (icons), user profile (avatar).
 */
export function usePresignRefresh(currentChannelId: string | undefined, isDm: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      // Refresh current channel messages (fresh attachment URLs)
      const channelId = currentChannelId;
      if (channelId) {
        useMessagesStore.getState().fetchMessages(channelId, isDm);
      }

      // Refresh servers (fresh icon URLs)
      useServersStore.getState().fetchServers();

      // Refresh own user profile (fresh avatar URL)
      useAuthStore.getState().loadUser();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentChannelId, isDm]);
}
