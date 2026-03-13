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
      <h2 className="text-2xl font-bold text-text-primary">Appearance</h2>
      <div className="rounded-xl bg-surface border border-divider p-6 gap-6 flex flex-col">
        {/* Theme */}
        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-widest">Theme</label>
          <div className="flex">
            <div className="flex rounded-lg border border-divider overflow-hidden">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleTheme(t)}
                  className={`flex-1 py-2.5 px-6 text-sm transition-colors ${theme === t ? 'bg-primary text-bg font-semibold' : 'text-text-secondary font-medium hover:text-text-primary'}`}
                >
                  {t === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Font size */}
        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-widest">Message Font Size</label>
          <div className="flex">
            <div className="flex rounded-lg border border-divider overflow-hidden">
              {(['small', 'normal', 'large'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => handleFontSize(size)}
                  className={`flex-1 py-2.5 px-6 text-sm capitalize transition-colors ${fontSize === size ? 'bg-primary text-bg font-semibold' : 'text-text-secondary font-medium hover:text-text-primary'}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Compact mode */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-widest">Compact Mode</label>
            <p className="text-sm text-text-secondary">Reduce spacing between messages</p>
          </div>
          <button
            role="switch"
            aria-checked={compactMode}
            onClick={() => handleCompactMode(!compactMode)}
            className={`w-11 h-6 rounded-xl transition-colors relative ${compactMode ? 'bg-primary' : 'bg-surface border border-divider'}`}
          >
            <div className={`absolute top-0.5 size-4.5 rounded-full shadow transition-transform ${compactMode ? 'right-0.5 left-auto bg-white' : 'left-0.5 bg-text-secondary'}`} />
          </button>
        </div>
      </div>
    </>
  );
}
