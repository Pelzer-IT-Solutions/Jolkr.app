import { useState, useEffect, useRef } from 'react';
import { decryptDmMessage, isE2EEReady, getLocalKeys } from '../services/e2ee';
import { decryptChannelMessage } from '../crypto/channelKeys';

interface DecryptedState {
  displayContent: string;
  isEncrypted: boolean;
  decrypting: boolean;
}

const DECRYPT_FAIL_MSG = '[Encrypted message — keys unavailable]';

/**
 * Hook that decrypts encrypted message content when available.
 *
 * Two decryption models:
 * - **Channel key model** (new): `content` is null, `encrypted_content` exists.
 *   Both sender and recipient decrypt via shared symmetric key.
 * - **Legacy direct model**: `content` (plaintext) exists alongside `encrypted_content`.
 *   Sender sees plaintext, recipient decrypts with their private key.
 *
 * Old messages with plaintext `content` are always displayed as-is for backward compat.
 */
export function useDecryptedContent(
  content: string,
  encryptedContent?: string | null,
  nonce?: string | null,
  isDm?: boolean,
  isOwnMessage?: boolean,
  channelId?: string,
): DecryptedState {
  const [state, setState] = useState<DecryptedState>(() => {
    if (encryptedContent && nonce && isDm) {
      // Channel key model (no plaintext) — need to decrypt for everyone
      if (!content) {
        return { displayContent: '', isEncrypted: true, decrypting: true };
      }
      // Legacy model: own messages show plaintext, recipient messages show placeholder while decrypting
      if (isOwnMessage) {
        return { displayContent: content, isEncrypted: true, decrypting: false };
      }
      return { displayContent: content, isEncrypted: true, decrypting: true };
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

    // Determine decryption model based on whether plaintext content exists
    const useChannelKey = !content && !!channelId;

    // Legacy model: own messages show plaintext (encrypted with recipient's key, not ours)
    if (!useChannelKey && isOwnMessage) {
      setState({ displayContent: content || '', isEncrypted: true, decrypting: false });
      return;
    }

    // Legacy model with plaintext fallback: show content directly for old messages
    if (!useChannelKey && content) {
      setState({ displayContent: content, isEncrypted: true, decrypting: false });
      return;
    }

    let cancelled = false;

    const attempt = () => {
      if (!isE2EEReady()) {
        if (retryRef.current < 3) {
          retryRef.current++;
          retryTimerRef.current = setTimeout(attempt, 1000);
          return;
        }
        setState({
          displayContent: content || DECRYPT_FAIL_MSG,
          isEncrypted: true,
          decrypting: false,
        });
        return;
      }

      retryRef.current = 0;
      const localKeys = getLocalKeys();

      // Channel key model: decrypt via shared symmetric key (works for both sender and recipient)
      if (useChannelKey && localKeys) {
        decryptChannelMessage(channelId!, localKeys, encryptedContent, nonce, true)
          .then((plaintext) => {
            if (!cancelled) {
              setState({ displayContent: plaintext, isEncrypted: true, decrypting: false });
            }
          })
          .catch((err) => {
            if (!cancelled) {
              console.warn('E2EE: Failed to decrypt channel-key message:', err);
              setState({
                displayContent: DECRYPT_FAIL_MSG,
                isEncrypted: true,
                decrypting: false,
              });
            }
          });
        return;
      }

      // Legacy direct model: decrypt with recipient's private key
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
  }, [content, encryptedContent, nonce, isDm, isOwnMessage, channelId]);

  return state;
}
