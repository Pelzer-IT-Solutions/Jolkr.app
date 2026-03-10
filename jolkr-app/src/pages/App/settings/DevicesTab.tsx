import { useEffect, useState } from 'react';
import * as api from '../../../api/client';

export default function DevicesTab() {
  const [devices, setDevices] = useState<Array<{ id: string; device_name: string; device_type: string; has_push_token: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api.getDevices()
      .then((data) => { setDevices(data.devices); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (deviceId: string) => {
    setDeleting(deviceId);
    try {
      await api.deleteDevice(deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch {
      // Silently fail — device may already be deleted
    }
    setDeleting(null);
  };

  const deviceIcon = (type: string) => {
    switch (type) {
      case 'web':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        );
      case 'desktop':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
      case 'android':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-text-primary mb-6">Devices</h2>
      <div className="bg-surface rounded-xl p-8">
        {loading && (
          <div className="text-text-muted text-sm text-center py-4">Loading devices...</div>
        )}
        {!loading && error && (
          <div className="text-error/70 text-sm text-center py-4">Failed to load devices</div>
        )}
        {!loading && !error && devices.length === 0 && (
          <div className="text-text-muted text-sm text-center py-4">No devices registered</div>
        )}
        {!loading && !error && devices.length > 0 && (
          <div className="space-y-3">
            {devices.map((device) => (
              <div key={device.id} className="flex items-center gap-3 p-3 rounded bg-bg">
                <div className="text-text-muted shrink-0">
                  {deviceIcon(device.device_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">{device.device_name}</div>
                  <div className="text-text-muted text-xs capitalize">{device.device_type}{device.has_push_token ? ' — push enabled' : ''}</div>
                </div>
                <button
                  onClick={() => handleDelete(device.id)}
                  disabled={deleting === device.id}
                  className="text-error/60 hover:text-error text-xs px-2 py-1 rounded hover:bg-error/10 disabled:opacity-50 shrink-0"
                >
                  {deleting === device.id ? '...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
