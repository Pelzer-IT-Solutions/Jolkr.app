import { useCallStore } from '../stores/call';
import { User, PhoneOff } from 'lucide-react';
import Modal from './ui/Modal';

export default function OutgoingCallDialog() {
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const cancelOutgoing = useCallStore((s) => s.cancelOutgoing);

  return (
    <Modal open={!!outgoingCall} className="p-6 w-80 flex flex-col items-center gap-4">
      {/* Avatar placeholder */}
      <div className="w-16 h-16 rounded-full bg-accent/30 flex items-center justify-center">
        <User className="w-8 h-8 text-accent" />
      </div>

      <div className="text-center">
        <div className="text-text-primary font-semibold text-lg">{outgoingCall?.recipientName}</div>
        <div className="text-text-tertiary text-sm mt-1">Calling...</div>
      </div>

      {/* Pulsing animation */}
      <div className="flex gap-1.5 my-2">
        <div className="w-2 h-2 rounded-full bg-accent animate-typing-dot" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-accent animate-typing-dot" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-accent animate-typing-dot" style={{ animationDelay: '300ms' }} />
      </div>

      {/* Cancel button */}
      <button
        onClick={cancelOutgoing}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
      >
        <PhoneOff className="w-4 h-4" />
        Cancel
      </button>
    </Modal>
  );
}
