/**
 * Locale-bound formatter helpers. Wraps `i18n/formatters.ts` so callers
 * don't have to thread the active locale through every site:
 *
 *   const { formatDate, formatTime, formatRelativeTime } = useLocaleFormatters()
 *   <span>{formatDate(message.created_at, 'short')}</span>
 *
 * Memoised on `code` so swapping the locale re-binds (and the
 * `Intl.*` cache in `formatters.ts` keeps a hot entry per code).
 */

import { useMemo } from 'react';
import {
  formatDate as fmtDate,
  formatTime as fmtTime,
  formatRelativeTime as fmtRelative,
  formatNumber as fmtNumber,
} from '../i18n/formatters';
import { useLocaleStore } from '../stores/locale';

export interface LocaleFormatters {
  formatDate: (iso: string | Date, variant?: 'short' | 'long') => string;
  formatTime: (iso: string | Date) => string;
  formatRelativeTime: (iso: string | Date, now?: Date) => string;
  formatNumber: (n: number) => string;
}

export function useLocaleFormatters(): LocaleFormatters {
  const code = useLocaleStore((s) => s.code);
  return useMemo<LocaleFormatters>(() => ({
    formatDate:         (iso, variant = 'short') => fmtDate(iso, code, variant),
    formatTime:         (iso) => fmtTime(iso, code),
    formatRelativeTime: (iso, now) => fmtRelative(iso, code, now),
    formatNumber:       (n) => fmtNumber(n, code),
  }), [code]);
}
