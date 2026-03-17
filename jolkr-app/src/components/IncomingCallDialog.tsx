import { useCallStore } from '../stores/call';
import { stopRingSound } from '../hooks/useCallEvents';
import { User, Phone, PhoneOff } from 'lucide-react';
import Modal from './ui/Modal';

export default function IncomingCallDialog() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const acceptIncoming = useCallStore((s) => s.acceptIncoming);
  const rejectIncoming = useCallStore((s) => s.rejectIncoming);

  return (
    <Modal open={!!incomingCall} className="p-6 w-80 flex flex-col items-center gap-4">
      {/* Avatar placeholder */}
      <div className="w-16 h-16 rounded-full bg-accent/30 flex items-center justify-center animate-pulse">
        <User className="w-8 h-8 text-accent" />
      </div>

      <div className="text-center">
        <div className="text-text-primary font-semibold text-lg">{incomingCall?.callerUsername}</div>
        <div className="text-text-tertiary text-sm mt-1">is calling you...</div>
      </div>

      {/* Pulsing ring animation */}
      <div className="relative w-10 h-10 my-1">
        <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
        <div className="absolute inset-0 rounded-full bg-green-500/30 flex items-center justify-center">
          <Phone className="w-5 h-5 text-green-400" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => { stopRingSound(); acceptIncoming(); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-medium transition-colors"
        >
          <Phone className="w-4 h-4" />
          Accept
        </button>
        <button
          onClick={() => { stopRingSound(); rejectIncoming(); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
        >
          <PhoneOff className="w-4 h-4" />
          Reject
        </button>
      </div>
    </Modal>
  );
}
