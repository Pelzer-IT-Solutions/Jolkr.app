/**
 * Tiny helper for logging best-effort failures so silent `.catch(() => {})`
 * doesn't lose diagnostic information. Use from a `.catch()` chain when the
 * failure is non-fatal but you still want it visible in the console:
 *
 *   somePromise.catch((e) => logErr('GifPicker.loadCategories', e));
 *
 * For user-visible failures, surface a toast instead — `logErr` is for
 * background diagnostics only.
 */
export function logErr(ctx: string, err: unknown): void {
  console.warn(`[${ctx}]`, err instanceof Error ? err.message : err);
}
