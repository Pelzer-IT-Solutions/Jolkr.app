/** Tiny logging helper that prefixes every entry with a context tag.
 *  Replaces ad-hoc `console.warn(...)` calls scattered through the codebase
 *  so a future migration to Sentry / a structured logger only has to touch
 *  one file. PII handling, throttling, and remote shipping all hook in here.
 *
 *  Policy (audit SEC-032):
 *  - `log.debug` is a no-op in production builds. Use it for verbose
 *    diagnostics (state machines, key-rotation paths, retry decisions)
 *    that are useful in dev/devtools but should not surface in user
 *    devtools on a packaged release.
 *  - `log.info/warn/error` always run, but call sites must NOT pass raw
 *    secret material — vault passwords, private-key bytes, raw access
 *    tokens, request bodies, JWT payloads. Pass IDs and short status
 *    strings only. Caught Error objects are fine because their message
 *    rarely embeds payloads, but if you catch a fetch/network error and
 *    the body is interesting, strip the body before logging.
 *  - When a future Sentry adapter is wired up, it replaces the bodies
 *    of these methods. Call sites do not change.
 */

type LogCtx = string;

const IS_PROD = import.meta.env.PROD;

function fmt(ctx: LogCtx): string {
  return `[${ctx}]`;
}

export const log = {
  debug(ctx: LogCtx, ...rest: unknown[]): void {
    if (IS_PROD) return;
    console.debug(fmt(ctx), ...rest);
  },
  info(ctx: LogCtx, ...rest: unknown[]): void {
    console.info(fmt(ctx), ...rest);
  },
  warn(ctx: LogCtx, ...rest: unknown[]): void {
    console.warn(fmt(ctx), ...rest);
  },
  error(ctx: LogCtx, ...rest: unknown[]): void {
    console.error(fmt(ctx), ...rest);
  },
};
