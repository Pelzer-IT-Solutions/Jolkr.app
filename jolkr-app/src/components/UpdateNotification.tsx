import { useState } from 'react';
import { type UpdateInfo, downloadAndInstallUpdate } from '../services/updater';
import Button from './ui/Button';

export interface UpdateNotificationProps {
  update: UpdateInfo;
}

export default function UpdateNotification({ update }: UpdateNotificationProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleUpdate = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadAndInstallUpdate(setProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm shrink-0">
      <span className="text-text-primary">
        Update <strong>v{update.version}</strong> available
      </span>
      {update.notes && (
        <span className="text-text-tertiary hidden sm:inline truncate max-w-75">
          — {update.notes}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {error && <span className="text-red-400 text-xs">{error}</span>}
        {downloading ? (
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 bg-active rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-text-tertiary text-xs w-8">{progress}%</span>
          </div>
        ) : (
          <Button onClick={handleUpdate} size="xs">
            Update Now
          </Button>
        )}
      </div>
    </div>
  );
}
