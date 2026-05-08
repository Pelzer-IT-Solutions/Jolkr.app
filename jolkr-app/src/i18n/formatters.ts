/**
 * Locale-aware date / time / number formatting wrappers.
 *
 * Thin facade over `Intl.*` so callers don't have to thread the active
 * locale through every component. Each helper accepts an explicit
 * `locale` so it works in both React (via `useLocaleFormatters`) and
 * non-React contexts (`adapters/transforms.ts`, store actions).
 *
 * `Intl.*` constructors are cheap (~µs) but we cache the most-used ones
 * keyed by `${locale}|${variant}` so hot paths (message timestamps in
 * the chat list) don't allocate per render.
 */

type DateVariant = 'short' | 'long';

const dateCache = new Map<string, Intl.DateTimeFormat>();
const timeCache = new Map<string, Intl.DateTimeFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

function dateFormatter(locale: string, variant: DateVariant): Intl.DateTimeFormat {
  const key = `${locale}|${variant}`;
  let f = dateCache.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = variant === 'short'
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' };
    f = new Intl.DateTimeFormat(locale, opts);
    dateCache.set(key, f);
  }
  return f;
}

function timeFormatter(locale: string): Intl.DateTimeFormat {
  let f = timeCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    timeCache.set(locale, f);
  }
  return f;
}

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let f = relativeCache.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeCache.set(locale, f);
  }
  return f;
}

function numberFormatter(locale: string): Intl.NumberFormat {
  let f = numberCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale);
    numberCache.set(locale, f);
  }
  return f;
}

/** ISO/Date → date-only string (e.g. `"May 7"` or `"7 mai"`). */
export function formatDate(iso: string | Date, locale: string, variant: DateVariant = 'short'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dateFormatter(locale, variant).format(d);
}

/** ISO/Date → time-only string (`"3:45 PM"` or `"15:45"`). */
export function formatTime(iso: string | Date, locale: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return timeFormatter(locale).format(d);
}

/** ISO/Date → relative string (`"5 minutes ago"`, `"il y a 5 minutes"`).
 *  Picks the largest unit that yields ≥1 (minutes for <1h, hours for <1d, …). */
export function formatRelativeTime(iso: string | Date, locale: string, now: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const f = relativeFormatter(locale);
  if (abs < 60)        return f.format(diffSec, 'second');
  if (abs < 3600)      return f.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400)    return f.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2_592_000) return f.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 31_536_000) return f.format(Math.round(diffSec / 2_592_000), 'month');
  return f.format(Math.round(diffSec / 31_536_000), 'year');
}

/** Number → locale-aware string (`"1,234"` vs `"1 234"` vs `"1.234"`). */
export function formatNumber(n: number, locale: string): string {
  return numberFormatter(locale).format(n);
}
