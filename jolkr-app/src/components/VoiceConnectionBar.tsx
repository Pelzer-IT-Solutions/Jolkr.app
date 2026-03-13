import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff } from 'lucide-react';
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
          <div className="w-2 h-2 rounded-full bg-danger shrink-0" />
        ) : connectionState === 'connected' ? (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-online animate-ping opacity-75" />
            <div className="relative w-2 h-2 rounded-full bg-online" />
          </div>
        ) : (
          <div className="w-2 h-2 rounded-full bg-idle shrink-0 animate-pulse" />
        )}
        {error ? (
          <span className="text-sm text-danger font-medium truncate">{error}</span>
        ) : (
          <>
            <span className="text-sm text-online font-medium">
              {connectionState === 'connected' ? 'Voice Connected' : 'Connecting...'}
            </span>
            {channelName && (
              <span className="text-xs text-text-tertiary truncate">/ {channelName}</span>
            )}
          </>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-1">
        {/* Mic toggle */}
        <button
          onClick={toggleMute}
          className={`p-1.5 rounded hover:bg-hover transition-colors ${
            isMuted ? 'text-danger' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        {/* Headphone toggle */}
        <button
          onClick={toggleDeafen}
          className={`p-1.5 rounded hover:bg-hover transition-colors ${
            isDeafened ? 'text-danger' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
          aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? (
            <HeadphoneOff className="w-4 h-4" />
          ) : (
            <Headphones className="w-4 h-4" />
          )}
        </button>

        <div className="flex-1" />

        {/* Disconnect / Dismiss */}
        <button
          onClick={connectionState === 'disconnected' ? clearError : leaveChannel}
          className="p-1.5 rounded bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
          title={connectionState === 'disconnected' ? 'Dismiss' : 'Disconnect'}
          aria-label={connectionState === 'disconnected' ? 'Dismiss' : 'Disconnect'}
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
