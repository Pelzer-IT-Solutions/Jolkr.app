import { useRef } from 'react';
import { useCallStore } from '../stores/call';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { User, PhoneOff } from 'lucide-react';

export default function OutgoingCallDialog() {
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const cancelOutgoing = useCallStore((s) => s.cancelOutgoing);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  if (!outgoingCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div ref={dialogRef} className="bg-sidebar rounded-3xl border border-divider shadow-popup p-6 w-80 flex flex-col items-center gap-4 animate-modal-scale">
        {/* Avatar placeholder */}
        <div className="w-16 h-16 rounded-full bg-accent/30 flex items-center justify-center">
          <User className="w-8 h-8 text-accent" />
        </div>

        <div className="text-center">
          <div className="text-text-primary font-semibold text-lg">{outgoingCall.recipientName}</div>
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
      </div>
    </div>
  );
}
