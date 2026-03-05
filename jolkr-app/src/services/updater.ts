import { isTauri } from '../platform/detect';

export interface UpdateInfo {
  version: string;
  notes: string;
  available: boolean;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? '',
    available: true,
  };
}

export async function downloadAndInstallUpdate(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  const update = await check();
  if (!update) return;

  let contentLength = 0;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started' && event.data.contentLength) {
      contentLength = event.data.contentLength;
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      if (contentLength > 0 && onProgress) {
        onProgress(Math.round((downloaded / contentLength) * 100));
      }
    }
  });

  await relaunch();
}
