import { useRef } from 'react';
import { useCallStore } from '../stores/call';
import { useFocusTrap } from '../hooks/useFocusTrap';

export default function OutgoingCallDialog() {
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const cancelOutgoing = useCallStore((s) => s.cancelOutgoing);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  if (!outgoingCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div ref={dialogRef} className="bg-sidebar rounded-2xl border border-divider shadow-popup p-6 w-[320px] flex flex-col items-center gap-4">
        {/* Avatar placeholder */}
        <div className="w-16 h-16 rounded-full bg-primary/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>

        <div className="text-center">
          <div className="text-text-primary font-semibold text-lg">{outgoingCall.recipientName}</div>
          <div className="text-text-muted text-sm mt-1">Calling...</div>
        </div>

        {/* Pulsing animation */}
        <div className="flex gap-1.5 my-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-typing-dot" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-typing-dot" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-typing-dot" style={{ animationDelay: '300ms' }} />
        </div>

        {/* Cancel button */}
        <button
          onClick={cancelOutgoing}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
        >
          <svg className="w-4 h-4 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          Cancel
        </button>
      </div>
    </div>
  );
}
