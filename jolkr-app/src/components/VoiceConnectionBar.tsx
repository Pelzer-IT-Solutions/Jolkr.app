import { useVoiceStore } from '../stores/voice';

export default function VoiceConnectionBar() {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const channelName = useVoiceStore((s) => s.channelName);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const error = useVoiceStore((s) => s.error);
  const clearError = useVoiceStore((s) => s.clearError);

  if (connectionState === 'disconnected' && !error) return null;

  return (
    <div className="bg-serverbar border-t border-divider px-3 py-2">
      {/* Status row */}
      <div className="flex items-center gap-2 mb-1.5">
        {error ? (
          <div className="w-2 h-2 rounded-full bg-error shrink-0" />
        ) : connectionState === 'connected' ? (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-online animate-ping opacity-75" />
            <div className="relative w-2 h-2 rounded-full bg-online" />
          </div>
        ) : (
          <div className="w-2 h-2 rounded-full bg-idle shrink-0 animate-pulse" />
        )}
        {error ? (
          <span className="text-[13px] text-error font-medium truncate">{error}</span>
        ) : (
          <>
            <span className="text-[13px] text-online font-medium">
              {connectionState === 'connected' ? 'Voice Connected' : 'Connecting...'}
            </span>
            {channelName && (
              <span className="text-[11px] text-text-muted truncate">/ {channelName}</span>
            )}
          </>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-1">
        {/* Mic toggle */}
        <button
          onClick={toggleMute}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
            isMuted ? 'text-error' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        {/* Headphone toggle */}
        <button
          onClick={toggleDeafen}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
            isDeafened ? 'text-error' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
          aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M9 9a3 3 0 100 6h1V9H9zm6 0v6h1a3 3 0 100-6h-1z" />
              <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M9 9a3 3 0 100 6h1V9H9zm6 0v6h1a3 3 0 100-6h-1z" />
            </svg>
          )}
        </button>

        <div className="flex-1" />

        {/* Disconnect / Dismiss */}
        <button
          onClick={connectionState === 'disconnected' ? clearError : leaveChannel}
          className="p-1.5 rounded bg-error/20 text-error hover:bg-error/30 transition-colors"
          title={connectionState === 'disconnected' ? 'Dismiss' : 'Disconnect'}
          aria-label={connectionState === 'disconnected' ? 'Dismiss' : 'Disconnect'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
