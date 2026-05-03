import { useState, useEffect, useRef } from 'react';
import { isE2EEReady, getLocalKeys } from '../services/e2ee';
import { decryptChannelMessage } from '../crypto/channelKeys';

interface DecryptedState {
  displayContent: string;
  isEncrypted: boolean;
  decrypting: boolean;
}

const DECRYPT_FAIL_MSG = '[Encrypted message — keys unavailable]';

/**
 * Hook that decrypts message content.
 * All messages are encrypted: content contains ciphertext, nonce indicates encryption.
 * Decryption uses the channel's shared symmetric key.
 */
export function useDecryptedContent(
  content: string,
  nonce?: string | null,
  isDm?: boolean,
  channelId?: string,
): DecryptedState {
  const [state, setState] = useState<DecryptedState>(() => {
    if (!nonce) {
      // No nonce = plain text (shouldn't happen, but handle gracefully)
      return { displayContent: content, isEncrypted: false, decrypting: false };
    }
    if (!channelId) {
      return { displayContent: DECRYPT_FAIL_MSG, isEncrypted: true, decrypting: false };
    }
    return { displayContent: '', isEncrypted: true, decrypting: true };
  });
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the visible state with the inputs synchronously: a content/nonce/key
  // swap should reset to the right placeholder immediately rather than
  // flashing the previous decryption.
  const inputKey = `${content}|${nonce ?? ''}|${channelId ?? ''}|${isDm ? '1' : '0'}`;
  const [prevInputKey, setPrevInputKey] = useState(inputKey);
  if (prevInputKey !== inputKey) {
    setPrevInputKey(inputKey);
    if (!nonce) {
      setState({ displayContent: content, isEncrypted: false, decrypting: false });
    } else if (!channelId) {
      setState({ displayContent: DECRYPT_FAIL_MSG, isEncrypted: true, decrypting: false });
    } else {
      setState({ displayContent: '', isEncrypted: true, decrypting: true });
    }
  }

  useEffect(() => {
    if (!nonce || !channelId) return;

    let cancelled = false;

    const attempt = () => {
      if (cancelled) return;
      if (!isE2EEReady()) {
        if (retryRef.current < 5) {
          retryRef.current++;
          retryTimerRef.current = setTimeout(attempt, 1000);
          return;
        }
        if (!cancelled) setState({ displayContent: DECRYPT_FAIL_MSG, isEncrypted: true, decrypting: false });
        return;
      }

      retryRef.current = 0;
      const localKeys = getLocalKeys();
      if (!localKeys) {
        if (!cancelled) setState({ displayContent: DECRYPT_FAIL_MSG, isEncrypted: true, decrypting: false });
        return;
      }

      decryptChannelMessage(channelId, localKeys, content, nonce, isDm)
        .then((plaintext) => {
          if (!cancelled) {
            setState({ displayContent: plaintext, isEncrypted: true, decrypting: false });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('E2EE: Failed to decrypt message:', err);
            setState({ displayContent: DECRYPT_FAIL_MSG, isEncrypted: true, decrypting: false });
          }
        });
    };

    attempt();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [content, nonce, isDm, channelId]);

  return state;
}
