/** Date formatting helpers shared by chat areas, threads, and search results.
 *  All functions are pure and tolerant of garbage input — invalid ISO strings
 *  return an empty string instead of "Invalid Date".
 */

/** Locale-aware weekday + full-date label used for day separators in message
 *  lists. Deliberately does NOT do "Today" / "Yesterday" — every separator
 *  reads the same way so users can scroll-and-skim by date.
 */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** Cheap stable day key — `YYYY-MM-DD` in local time — used to detect day
 *  boundaries when iterating a message list.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
