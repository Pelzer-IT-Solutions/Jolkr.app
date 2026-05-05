// Applies the saved color preference BEFORE the React bundle loads, so the
// background is correct on first paint and we don't get a white flash on dark
// theme. Loaded synchronously from index.html — keep it tiny and side-effect
// only. Persisted preference key matches utils/storageKeys.ts COLOR_MODE
// (`jolkr_color_mode`); the legacy `jolkr-color-mode` is checked as a
// fallback for installs that haven't booted post-migration yet.
(function () {
  try {
    var p =
      localStorage.getItem('jolkr_color_mode') ||
      localStorage.getItem('jolkr-color-mode') ||
      'system';
    var dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (_) {
    // localStorage may be disabled (private mode, sandbox); fall through to
    // system default — React will fix on mount.
  }
})();
