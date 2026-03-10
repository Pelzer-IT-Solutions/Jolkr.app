import { useRef } from 'react';
import { useCallStore } from '../stores/call';
import { stopRingSound } from '../hooks/useCallEvents';
import { useFocusTrap } from '../hooks/useFocusTrap';

export default function IncomingCallDialog() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const acceptIncoming = useCallStore((s) => s.acceptIncoming);
  const rejectIncoming = useCallStore((s) => s.rejectIncoming);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div ref={dialogRef} className="bg-sidebar rounded-2xl border border-divider shadow-popup p-6 w-[320px] flex flex-col items-center gap-4">
        {/* Avatar placeholder */}
        <div className="w-16 h-16 rounded-full bg-primary/30 flex items-center justify-center animate-pulse">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>

        <div className="text-center">
          <div className="text-text-primary font-semibold text-lg">{incomingCall.callerUsername}</div>
          <div className="text-text-muted text-sm mt-1">is calling you...</div>
        </div>

        {/* Pulsing ring animation */}
        <div className="relative w-10 h-10 my-1">
          <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
          <div className="absolute inset-0 rounded-full bg-green-500/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={() => { stopRingSound(); acceptIncoming(); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-green-600 hover:bg-green-500 text-white font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Accept
          </button>
          <button
            onClick={() => { stopRingSound(); rejectIncoming(); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          >
            <svg className="w-4 h-4 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
