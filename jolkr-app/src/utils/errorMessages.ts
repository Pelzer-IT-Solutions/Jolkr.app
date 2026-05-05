/** Map backend error messages / codes to user-facing copy.
 *  Goals:
 *  - Don't leak backend schema (e.g. "User not found", "Constraint violation")
 *    into the toast. The backend message is still logged for debugging via
 *    `log.warn`.
 *  - Provide a stable, translatable surface for common failures.
 */

const FRIENDLY: Array<{ match: RegExp; user: string }> = [
  { match: /not found/i,          user: 'That account is no longer available.' },
  { match: /already.*friend/i,    user: 'You are already friends with this user.' },
  { match: /already.*pending/i,   user: 'A friend request is already pending.' },
  { match: /blocked/i,            user: 'You can’t send a request to this user.' },
  { match: /rate.?limit/i,        user: 'You’re doing that too quickly. Try again in a moment.' },
  { match: /unauthor/i,           user: 'You need to be signed in to do that.' },
  { match: /forbidden/i,          user: 'You don’t have permission to do that.' },
  { match: /timeout/i,            user: 'That took too long. Please try again.' },
  { match: /network/i,            user: 'Network problem — check your connection.' },
];

/** Convert a thrown error or backend response message into a generic
 *  user-facing string. Returns `fallback` (default: "Something went wrong.")
 *  when no rule matches.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong.'): string {
  const raw = err instanceof Error ? err.message
            : typeof err === 'string' ? err
            : '';
  if (!raw) return fallback;
  for (const rule of FRIENDLY) {
    if (rule.match.test(raw)) return rule.user;
  }
  return fallback;
}
