import { useState } from 'react';

export default function AppearanceTab() {
  const [theme, setTheme] = useState(() => localStorage.getItem('jolkr_theme') ?? 'dark');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('jolkr_font_size') ?? 'normal');
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('jolkr_compact') === 'true');

  const handleTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem('jolkr_theme', t);
    document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event('storage'));
  };

  const handleFontSize = (size: string) => {
    setFontSize(size);
    localStorage.setItem('jolkr_font_size', size);
    window.dispatchEvent(new Event('storage'));
  };

  const handleCompactMode = (enabled: boolean) => {
    setCompactMode(enabled);
    localStorage.setItem('jolkr_compact', String(enabled));
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-text-primary mb-6">Appearance</h2>
      <div className="bg-surface rounded-xl p-8 space-y-6">
        {/* Theme */}
        <div>
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Theme</label>
          <div className="mt-2 flex gap-2">
            {['dark', 'light'].map((t) => (
              <button
                key={t}
                onClick={() => handleTheme(t)}
                className={`px-4 py-2 rounded text-sm capitalize ${theme === t ? 'bg-primary text-white' : 'bg-input text-text-secondary hover:text-text-primary'}`}
              >
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>

        {/* Font size */}
        <div>
          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Message Font Size</label>
          <div className="mt-2 flex gap-2">
            {['small', 'normal', 'large'].map((size) => (
              <button
                key={size}
                onClick={() => handleFontSize(size)}
                className={`px-4 py-2 rounded text-sm capitalize ${fontSize === size ? 'bg-primary text-white' : 'bg-input text-text-secondary hover:text-text-primary'
                  }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Compact mode */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Compact Mode</label>
            <p className="text-text-muted text-xs mt-1">Reduce spacing between messages</p>
          </div>
          <button
            role="switch"
            aria-checked={compactMode}
            onClick={() => handleCompactMode(!compactMode)}
            className={`w-11 h-6 rounded-full transition-colors relative ${compactMode ? 'bg-primary' : 'bg-input'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${compactMode ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    </>
  );
}
