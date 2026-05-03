/** Application-wide numeric constants.
 *  Keep limits/timeouts/sizes in one place so a value change is grep-able and
 *  doesn't require hunting through component code.
 */

/** Maximum upload size per attachment (25 MB) — matches the server-side cap.
 *  Updating this here without the matching server cap will produce silent
 *  upload failures, so keep them aligned.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Minimum interval between TypingStart WS notifications for the same user.
 *  Prevents spamming the gateway while the user is mid-keystroke.
 */
export const TYPING_THROTTLE_MS = 3_000;

/** How long voiceService waits for the SFU to confirm before giving up. */
export const VOICE_CONNECT_TIMEOUT_MS = 15_000;
