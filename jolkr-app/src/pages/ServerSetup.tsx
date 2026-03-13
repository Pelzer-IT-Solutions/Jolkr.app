import { useState } from 'react';
import { isValidServerUrl } from '../platform/config';

export interface ServerSetupProps {
  onComplete: (url: string) => void;
}

const PRESETS = [
  { label: 'Jolkr Cloud', url: 'https://jolkr.app' },
  { label: 'Localhost (development)', url: 'http://localhost:8080' },
];

export default function ServerSetup({ onComplete }: ServerSetupProps) {
  const [selected, setSelected] = useState(PRESETS[0].url);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const serverUrl = useCustom ? custom.trim().replace(/\/+$/, '') : selected;

  const handleConnect = async () => {
    if (!serverUrl) {
      setError('Enter a server URL');
      return;
    }

    if (useCustom && !isValidServerUrl(serverUrl)) {
      setError('URL must use HTTPS (or HTTP for localhost only)');
      return;
    }

    setTesting(true);
    setError('');

    try {
      const res = await fetch(`${serverUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('timeout') || msg.includes('abort')) {
        setError(`Could not reach ${serverUrl} — connection timed out`);
      } else {
        setError(`Could not connect to ${serverUrl} — ${msg}`);
      }
      setTesting(false);
      return;
    }

    localStorage.setItem('jolkr_server_url', serverUrl);
    setTesting(false);
    onComplete(serverUrl);
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-lg p-8 w-105 max-w-[90vw]">
        <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Connect to Server</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">
          Choose which Jolkr server to connect to.
        </p>

        {error && <div className="bg-danger/10 text-danger text-sm p-3 rounded mb-4">{error}</div>}

        <div className="space-y-2 mb-4">
          {PRESETS.map((preset) => (
            <label
              key={preset.url}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                !useCustom && selected === preset.url
                  ? 'border-accent bg-accent/10'
                  : 'border-divider hover:border-text-tertiary'
              }`}
            >
              <input
                type="radio"
                name="server"
                checked={!useCustom && selected === preset.url}
                onChange={() => {
                  setUseCustom(false);
                  setSelected(preset.url);
                  setError('');
                }}
                className="accent-accent"
              />
              <div>
                <div className="text-text-primary text-sm font-medium">{preset.label}</div>
                <div className="text-text-tertiary text-xs">{preset.url}</div>
              </div>
            </label>
          ))}

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              useCustom
                ? 'border-accent bg-accent/10'
                : 'border-divider hover:border-text-tertiary'
            }`}
          >
            <input
              type="radio"
              name="server"
              checked={useCustom}
              onChange={() => {
                setUseCustom(true);
                setError('');
              }}
              className="accent-accent mt-1"
            />
            <div className="flex-1">
              <div className="text-text-primary text-sm font-medium mb-1">Custom server</div>
              {useCustom && (
                <input
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setError('');
                  }}
                  placeholder="https://your-server.com"
                  className="w-full px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm"
                  autoFocus
                />
              )}
            </div>
          </label>
        </div>

        <button
          onClick={handleConnect}
          disabled={testing || (!useCustom ? !selected : !custom.trim())}
          className="w-full py-2.5 btn-primary font-medium rounded-lg disabled:opacity-50"
        >
          {testing ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
