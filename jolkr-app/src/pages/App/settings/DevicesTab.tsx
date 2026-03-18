import { useEffect, useState } from 'react';
import { Globe, Monitor, Smartphone, Cpu } from 'lucide-react';
import * as api from '../../../api/client';

interface Device {
  id: string;
  device_name: string;
  device_type: string;
  has_push_token: boolean;
  last_active_at: string | null;
  created_at: string;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DevicesTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api.getDevices()
      .then((data) => { setDevices(data.devices.filter((d) => d.device_type !== 'e2ee')); setError(false); })
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

  const DeviceIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'web':
        return <Globe className="size-5" />;
      case 'desktop':
        return <Monitor className="size-5" />;
      case 'android':
        return <Smartphone className="size-5" />;
      default:
        return <Cpu className="size-5" />;
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-text-primary">Devices</h2>
      <div className="rounded-xl bg-surface border border-divider overflow-hidden">
        {loading && (
          <div className="text-text-tertiary text-sm text-center px-5 py-4">Loading devices...</div>
        )}
        {!loading && error && (
          <div className="text-danger/70 text-sm text-center px-5 py-4">Failed to load devices</div>
        )}
        {!loading && !error && devices.length === 0 && (
          <div className="text-text-tertiary text-sm text-center px-5 py-4">No devices registered</div>
        )}
        {!loading && !error && devices.length > 0 && (
          <div className="flex flex-col">
            {devices.map((device, idx) => (
              <div
                key={device.id}
                className={`flex items-center gap-3.5 px-5 py-4 ${idx < devices.length - 1 ? 'border-b border-border-subtle' : ''}`}
              >
                <div className="text-text-tertiary shrink-0">
                  <DeviceIcon type={device.device_type} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary truncate">{device.device_name}</div>
                  <div className="text-xs text-text-tertiary capitalize">
                    {device.device_type}
                    {device.has_push_token ? ' — Push Enabled' : ''}
                  </div>
                  <div className="text-xs text-text-tertiary mt-0.5 flex gap-3">
                    <span>Added {new Date(device.created_at).toLocaleDateString()}</span>
                    {device.last_active_at && (
                      <span>Active {formatRelative(device.last_active_at)}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(device.id)}
                  disabled={deleting === device.id}
                  className="text-danger/60 hover:text-danger text-xs px-2 py-1 rounded hover:bg-danger/10 disabled:opacity-50 shrink-0"
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
