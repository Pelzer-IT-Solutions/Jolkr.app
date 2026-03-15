import { useState, useEffect, useRef } from 'react';
import { decryptDmMessage, isE2EEReady } from '../services/e2ee';

interface DecryptedState {
  displayContent: string;
  isEncrypted: boolean;
  decrypting: boolean;
}

const DECRYPT_FAIL_MSG = '[Encrypted message — keys unavailable]';

/**
 * Hook that decrypts encrypted message content when available.
 * Falls back to plaintext content if no encryption or decryption fails.
 * Skips decryption for own messages (encrypted with recipient's key, not sender's).
 */
export function useDecryptedContent(
  content: string,
  encryptedContent?: string | null,
  nonce?: string | null,
  isDm?: boolean,
  isOwnMessage?: boolean,
): DecryptedState {
  const [state, setState] = useState<DecryptedState>(() => {
    // Own messages: show plaintext, mark as encrypted (for lock icon) but don't attempt decrypt
    if (isOwnMessage && encryptedContent && nonce && isDm) {
      return { displayContent: content || '', isEncrypted: true, decrypting: false };
    }
    if (encryptedContent && nonce && isDm) {
      return { displayContent: content || '', isEncrypted: true, decrypting: true };
    }
    return { displayContent: content, isEncrypted: false, decrypting: false };
  });
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!encryptedContent || !nonce || !isDm) {
      setState({ displayContent: content, isEncrypted: false, decrypting: false });
      return;
    }

    // Skip decryption for own messages — they were encrypted for the recipient's key
    if (isOwnMessage) {
      setState({ displayContent: content || '', isEncrypted: true, decrypting: false });
      return;
    }

    let cancelled = false;

    const attempt = () => {
      if (!isE2EEReady()) {
        // E2EE keys not yet loaded — retry a few times (init may still be running)
        if (retryRef.current < 3) {
          retryRef.current++;
          retryTimerRef.current = setTimeout(attempt, 1000);
          return;
        }
        // Give up — show plaintext fallback or error
        setState({
          displayContent: content || DECRYPT_FAIL_MSG,
          isEncrypted: true,
          decrypting: false,
        });
        return;
      }

      retryRef.current = 0;

      decryptDmMessage(encryptedContent, nonce)
        .then((plaintext) => {
          if (!cancelled) {
            setState({ displayContent: plaintext, isEncrypted: true, decrypting: false });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('E2EE: Failed to decrypt message:', err);
            setState({
              displayContent: content || DECRYPT_FAIL_MSG,
              isEncrypted: true,
              decrypting: false,
            });
          }
        });
    };

    attempt();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [content, encryptedContent, nonce, isDm, isOwnMessage]);

  return state;
}
