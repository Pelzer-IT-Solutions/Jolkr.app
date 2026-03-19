import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../stores/auth';
import Modal from './ui/Modal';
import Avatar from './Avatar';
import Button from './ui/Button';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function QrCodeDisplay({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const url = `https://jolkr.app/app/add/${user.id}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={onClose} className="w-[320px]">
      <div className="p-6 flex flex-col items-center gap-4">
        <h2 className="text-lg font-bold text-text-primary">Your QR Code</h2>
        <Avatar url={user.avatar_url} name={user.username} size={56} userId={user.id} />
        <span className="text-sm font-semibold text-text-primary">{user.username}</span>
        <div className="bg-white p-4 rounded-2xl">
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
        <p className="text-xs text-text-tertiary text-center">
          Friends can scan this code to add you
        </p>
        <Button variant="secondary" size="sm" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy Link'}
        </Button>
      </div>
    </Modal>
  );
}
