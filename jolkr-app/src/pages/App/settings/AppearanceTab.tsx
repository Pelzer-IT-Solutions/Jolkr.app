import { useState } from 'react';
import Toggle from '../../../components/ui/Toggle';

export default function AppearanceTab() {
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('jolkr_font_size') ?? 'normal');
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('jolkr_compact') === 'true');

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
        {/* Font size */}
        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Message Font Size</label>
          <div className="flex">
            <div className="flex rounded-lg border border-divider overflow-hidden">
              {(['small', 'normal', 'large'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => handleFontSize(size)}
                  className={`flex-1 py-2.5 px-6 text-sm capitalize transition-colors ${fontSize === size ? 'bg-accent text-bg font-semibold' : 'text-text-secondary font-medium hover:text-text-primary'}`}
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
            <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Compact Mode</label>
            <p className="text-sm text-text-secondary">Reduce spacing between messages</p>
          </div>
          <Toggle checked={compactMode} onChange={handleCompactMode} label="Compact Mode" />
        </div>
      </div>
    </>
  );
}
