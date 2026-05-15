/**
 * Central LIFO queue for message-decryption jobs.
 *
 * The chat view is inverted-scroll — the most recent message lives at the
 * bottom and is the one the user actually wants to read first. Per-message
 * `useDecryptedContent` hooks each kick off their own async decrypt, but the
 * browser effectively serialises them in DOM-mount order (top to bottom), so
 * the bottom row clears last. This module serialises decryption through a
 * single worker that pops the newest-enqueued job first, so the bottom of
 * the channel resolves before older history.
 *
 * Jobs handle their own success / failure setState; the queue only owns
 * ordering and concurrency. Cancellation (returned closure) marks the entry
 * so it never runs even if it's still in the stack.
 */

type Job = () => Promise<void>;

interface Entry { job: Job; cancelled: boolean }

const stack: Entry[] = [];
let running = false;

async function worker(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry || entry.cancelled) continue;
      try {
        await entry.job();
      } catch (e) {
        console.warn('decryptQueue: job threw:', e);
      }
    }
  } finally {
    running = false;
  }
}

/** Enqueue a decryption job. Newest jobs are picked up first (LIFO).
 *  Returns a cancel function the caller MUST invoke on unmount. */
export function enqueueDecrypt(job: Job): () => void {
  const entry: Entry = { job, cancelled: false };
  stack.push(entry);
  void worker();
  return () => { entry.cancelled = true; };
}
