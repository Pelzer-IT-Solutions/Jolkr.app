import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuthStore } from '../stores/auth';
import * as api from '../api/client';
import type { User } from '../api/types';
import Modal from './ui/Modal';
import Avatar from './Avatar';
import Button from './ui/Button';
import { Camera, AlertCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onFriendRequestSent: () => void;
}

function parseJolkrUserId(text: string): string | null {
  // https://jolkr.app/add/{uuid} or jolkr://add/{uuid}
  const webMatch = text.match(/jolkr\.app\/(?:app\/)?add\/([0-9a-f-]{36})/i);
  if (webMatch) return webMatch[1];
  const deepMatch = text.match(/jolkr:\/\/add\/([0-9a-f-]{36})/i);
  if (deepMatch) return deepMatch[1];
  return null;
}

export default function QrCodeScanner({ open, onClose, onFriendRequestSent }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState('');
  const [scannedUser, setScannedUser] = useState<User | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const processingRef = useRef(false);

  const cleanup = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2 /* SCANNING */) {
          await scannerRef.current.stop();
        }
      } catch { /* ignore */ }
      scannerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    cleanup();
    setError('');
    setScannedUser(null);
    setSending(false);
    setSent(false);
    processingRef.current = false;
    onClose();
  }, [cleanup, onClose]);

  useEffect(() => {
    if (!open) return;

    // Reset state
    setError('');
    setScannedUser(null);
    setSending(false);
    setSent(false);
    processingRef.current = false;

    const viewfinderId = 'qr-scanner-viewfinder';
    let mounted = true;

    const startScanner = async () => {
      // Wait for DOM element
      await new Promise((r) => setTimeout(r, 100));
      if (!mounted) return;

      const el = document.getElementById(viewfinderId);
      if (!el) return;

      try {
        const scanner = new Html5Qrcode(viewfinderId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            if (processingRef.current) return;
            processingRef.current = true;

            const userId = parseJolkrUserId(decodedText);
            if (!userId) {
              setError('This is not a valid Jolkr QR code');
              processingRef.current = false;
              return;
            }

            if (userId === currentUser?.id) {
              setError("You can't add yourself as a friend");
              processingRef.current = false;
              return;
            }

            try {
              await scanner.stop();
            } catch { /* ignore */ }

            try {
              const u = await api.getUser(userId);
              if (mounted) setScannedUser(u);
            } catch {
              if (mounted) setError('User not found');
              processingRef.current = false;
            }
          },
          () => { /* ignore scan errors (no QR in frame) */ }
        );
      } catch (e) {
        if (mounted) {
          const msg = (e as Error).message || String(e);
          if (msg.includes('Permission') || msg.includes('NotAllowed')) {
            setError('Camera access denied. Please allow camera permissions and try again.');
          } else if (msg.includes('NotFound') || msg.includes('no camera')) {
            setError('No camera found. Use the search method to add friends instead.');
          } else {
            setError('Could not start camera: ' + msg);
          }
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      cleanup();
    };
  }, [open, currentUser?.id, cleanup]);

  const handleSendRequest = async () => {
    if (!scannedUser) return;
    setSending(true);
    try {
      await api.sendFriendRequest(scannedUser.id);
      setSent(true);
      onFriendRequestSent();
      setTimeout(handleClose, 1500);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} className="w-[360px]">
      <div className="p-6 flex flex-col items-center gap-4">
        <h2 className="text-lg font-bold text-text-primary">Scan QR Code</h2>

        {error && (
          <div className="flex items-center gap-2 bg-danger/10 text-danger text-sm p-3 rounded-lg w-full">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {scannedUser ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <Avatar url={scannedUser.avatar_url} name={scannedUser.username} size={64} userId={scannedUser.id} />
            <span className="text-base font-semibold text-text-primary">{scannedUser.username}</span>
            {sent ? (
              <p className="text-sm text-online font-medium">Friend request sent!</p>
            ) : (
              <Button onClick={handleSendRequest} loading={sending} fullWidth>
                Send Friend Request
              </Button>
            )}
          </div>
        ) : (
          <>
            <div
              id="qr-scanner-viewfinder"
              className="w-full aspect-square rounded-xl overflow-hidden bg-black"
            />
            <div className="flex items-center gap-2 text-text-tertiary">
              <Camera className="size-4" />
              <p className="text-xs">Point your camera at a Jolkr QR code</p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
