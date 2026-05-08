import { useState } from 'react';
import { type UpdateInfo, downloadAndInstallUpdate } from '../services/updater';
import { useT } from '../hooks/useT';
import Button from './ui/Button';
import s from './UpdateNotification.module.css';

export interface UpdateNotificationProps {
  update: UpdateInfo;
}

export default function UpdateNotification({ update }: UpdateNotificationProps) {
  const { tx, t } = useT();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleUpdate = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadAndInstallUpdate(setProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('update.errorGeneric'));
      setDownloading(false);
    }
  };

  return (
    <div className={s.banner}>
      <span className={s.label}>
        {tx('update.available', { version: <strong key="v">v{update.version}</strong> })}
      </span>
      {update.notes && (
        <span className={s.notes}>
          — {update.notes}
        </span>
      )}
      <div className={s.actions}>
        {error && <span className={s.error}>{error}</span>}
        {downloading ? (
          <div className={s.progress}>
            <div className={s.progressBar}>
              <div
                className={s.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={s.progressText}>{progress}%</span>
          </div>
        ) : (
          <Button onClick={handleUpdate} size="xs">
            {t('update.updateNow')}
          </Button>
        )}
      </div>
    </div>
  );
}
