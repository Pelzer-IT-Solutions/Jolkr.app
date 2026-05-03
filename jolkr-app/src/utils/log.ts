/** Tiny logging helper that prefixes every entry with a context tag.
 *  Replaces ad-hoc `console.warn(...)` calls scattered through the codebase
 *  so a future migration to Sentry / a structured logger only has to touch
 *  one file. PII handling, throttling, and remote shipping all hook in here.
 */

type LogCtx = string;

function fmt(ctx: LogCtx): string {
  return `[${ctx}]`;
}

export const log = {
  warn(ctx: LogCtx, ...rest: unknown[]): void {
    console.warn(fmt(ctx), ...rest);
  },
  error(ctx: LogCtx, ...rest: unknown[]): void {
    console.error(fmt(ctx), ...rest);
  },
  info(ctx: LogCtx, ...rest: unknown[]): void {
    console.info(fmt(ctx), ...rest);
  },
};
