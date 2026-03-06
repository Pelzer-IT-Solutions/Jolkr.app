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
 * Supports both DM pairwise decryption and channel/group shared-key decryption.
 *
 * @param content - Plaintext content (fallback)
 * @param encryptedContent - Base64-encoded encrypted payload
 * @param nonce - Base64-encoded nonce
 * @param isDm - Whether this is a 1-on-1 DM (pairwise E2EE)
 * @param channelId - Channel ID for channel-key decryption (server channels + group DMs)
 */
export function useDecryptedContent(
  content: string,
  encryptedContent?: string | null,
  nonce?: string | null,
  isDm?: boolean,
  channelId?: string,
): DecryptedState {
  const hasEncrypted = !!(encryptedContent && nonce);
  const [state, setState] = useState<DecryptedState>(() => {
    if (hasEncrypted) {
      return { displayContent: content || '', isEncrypted: true, decrypting: true };
    }
    return { displayContent: content, isEncrypted: false, decrypting: false };
  });
  const retryRef = useRef(0);

  useEffect(() => {
    if (!encryptedContent || !nonce) {
      setState({ displayContent: content, isEncrypted: false, decrypting: false });
      return;
    }

    let cancelled = false;

    const attempt = () => {
      if (!isE2EEReady()) {
        if (retryRef.current < 3) {
          retryRef.current++;
          const timer = setTimeout(attempt, 1000);
          return () => clearTimeout(timer);
        }
        setState({
          displayContent: content || DECRYPT_FAIL_MSG,
          isEncrypted: true,
          decrypting: false,
        });
        return;
      }

      retryRef.current = 0;

      // Choose decryption method:
      // - 1-on-1 DMs use pairwise E2EE (decryptDmMessage)
      // - Server channels and group DMs use shared channel key
      let decryptPromise: Promise<string>;

      if (isDm && channelId) {
        // Could be 1-on-1 DM or group DM — try pairwise first, fall back to channel key
        decryptPromise = decryptDmMessage(encryptedContent, nonce).catch(() => {
          const localKeys = getLocalKeys();
          if (!localKeys) throw new Error('No local keys');
          return decryptChannelMessage(channelId, localKeys, encryptedContent, nonce);
        });
      } else if (isDm) {
        decryptPromise = decryptDmMessage(encryptedContent, nonce);
      } else if (channelId) {
        const localKeys = getLocalKeys();
        if (!localKeys) {
          setState({
            displayContent: content || DECRYPT_FAIL_MSG,
            isEncrypted: true,
            decrypting: false,
          });
          return;
        }
        decryptPromise = decryptChannelMessage(channelId, localKeys, encryptedContent, nonce);
      } else {
        setState({
          displayContent: content || DECRYPT_FAIL_MSG,
          isEncrypted: true,
          decrypting: false,
        });
        return;
      }

      decryptPromise
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

    const cleanup = attempt();

    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [content, encryptedContent, nonce, isDm, channelId]);

  return state;
}
