import { useState, useEffect, useRef } from 'react';
import { decryptChannelMessage } from '../crypto/channelKeys';
import { enqueueDecrypt } from '../services/decryptQueue';
import { isE2EEReady, getLocalKeys } from '../services/e2ee';
import { tStatic } from './useT';

interface DecryptedState {
  displayContent: string;
  isEncrypted: boolean;
  decrypting: boolean;
}

/** Resolve the localised "decryption failed" label on every read so a
 *  locale switch picks it up without remounting every cached message. */
function failMsg(): string {
  return tStatic('message.decrypt.failed');
}

/**
 * Hook that decrypts message content.
 * All messages are encrypted: content contains ciphertext, nonce indicates encryption.
 * Decryption uses the channel's shared symmetric key.
 *
 * Jobs are funnelled through a single LIFO queue (services/decryptQueue) so
 * the bottom of an inverted-scroll chat clears before older history.
 */
export function useDecryptedContent(
  content: string | null,
  nonce?: string | null,
  isDm?: boolean,
  channelId?: string,
): DecryptedState {
  const [state, setState] = useState<DecryptedState>(() => {
    if (!nonce) {
      // No nonce = plain text (shouldn't happen, but handle gracefully).
      // `content` may legitimately be null for encrypted-only messages that
      // arrive without a nonce due to a backend bug — coerce to '' so the
      // renderer doesn't blow up on String methods.
      return { displayContent: content ?? '', isEncrypted: false, decrypting: false };
    }
    return { displayContent: '', isEncrypted: true, decrypting: true };
  });
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!nonce) {
      // Defer setState past the effect body to satisfy set-state-in-effect.
      queueMicrotask(() => setState({ displayContent: content ?? '', isEncrypted: false, decrypting: false }));
      return;
    }

    if (!channelId) {
      queueMicrotask(() => setState({ displayContent: failMsg(), isEncrypted: true, decrypting: false }));
      return;
    }

    let cancelled = false;
    // Reset the retry counter at effect entry so a fresh input (channel
    // switch / new message) doesn't inherit the prior message's retry budget
    // — otherwise a second message arriving while the first is mid-backoff
    // can land on `retryRef >= 5` and skip straight to failMsg().
    retryRef.current = 0;
    let cancelJob: (() => void) | null = null;

    const runDecrypt = async (): Promise<void> => {
      if (cancelled) return;

      if (!isE2EEReady()) {
        if (retryRef.current < 5) {
          retryRef.current++;
          retryTimerRef.current = setTimeout(() => {
            if (cancelled) return;
            cancelJob = enqueueDecrypt(runDecrypt);
          }, 1000);
          return;
        }
        setState({ displayContent: failMsg(), isEncrypted: true, decrypting: false });
        return;
      }

      retryRef.current = 0;
      const localKeys = getLocalKeys();
      if (!localKeys) {
        setState({ displayContent: failMsg(), isEncrypted: true, decrypting: false });
        return;
      }

      // `content` IS the ciphertext when `nonce` is set — null here means a
      // malformed encrypted message (nonce without ciphertext). Bail out
      // instead of passing null to the decrypter.
      if (content == null) {
        setState({ displayContent: failMsg(), isEncrypted: true, decrypting: false });
        return;
      }

      try {
        const plaintext = await decryptChannelMessage(channelId, localKeys, content, nonce, isDm);
        if (!cancelled) {
          setState({ displayContent: plaintext, isEncrypted: true, decrypting: false });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('E2EE: Failed to decrypt message:', err);
          setState({ displayContent: failMsg(), isEncrypted: true, decrypting: false });
        }
      }
    };

    cancelJob = enqueueDecrypt(runDecrypt);

    return () => {
      cancelled = true;
      cancelJob?.();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [content, nonce, isDm, channelId]);

  return state;
}
