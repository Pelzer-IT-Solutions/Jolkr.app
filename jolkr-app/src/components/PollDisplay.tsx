import { useState, useEffect, useCallback, memo } from 'react';
import type { Poll } from '../api/types';
import * as api from '../api/client';
import { useToast } from './Toast';

export interface PollDisplayProps {
  pollId: string;
  initialPoll?: Poll;
}

function PollDisplayInner({ pollId, initialPoll }: PollDisplayProps) {
  const [poll, setPoll] = useState<Poll | null>(initialPoll ?? null);
  const [loading, setLoading] = useState(!initialPoll);
  const [voting, setVoting] = useState(false);
  const showToast = useToast((s) => s.show);

  useEffect(() => {
    if (!initialPoll) {
      api.getPoll(pollId).then(setPoll).catch(() => {}).finally(() => setLoading(false));
    }
  }, [pollId, initialPoll]);

  // Listen for PollUpdate WS events — handled externally, poll prop updates
  useEffect(() => {
    if (initialPoll) setPoll(initialPoll);
  }, [initialPoll]);

  const handleVote = useCallback(async (optionId: string) => {
    if (!poll || voting) return;
    setVoting(true);
    try {
      const isVoted = (poll.my_votes ?? []).includes(optionId);
      const updated = isVoted
        ? await api.unvotePoll(poll.id, optionId)
        : await api.votePoll(poll.id, optionId);
      setPoll(updated);
    } catch {
      showToast('Failed to submit vote', 'error');
    } finally {
      setVoting(false);
    }
  }, [poll, voting]);

  if (loading) return (
    <div className="mt-2 bg-panel rounded-lg p-3 border border-divider max-w-100 animate-pulse">
      <div className="h-4 bg-hover rounded w-2/3 mb-2" />
      <div className="space-y-1.5">
        <div className="rounded-lg px-4 py-2 border border-divider h-8 bg-hover" />
        <div className="rounded-lg px-4 py-2 border border-divider h-8 bg-hover" />
      </div>
      <div className="h-3 bg-hover rounded w-1/4 mt-2" />
    </div>
  );
  if (!poll) return null;

  const isExpired = poll.expires_at && new Date(poll.expires_at) < new Date();
  const myVotes = poll.my_votes ?? [];
  const total = poll.total_votes || 0;

  return (
    <div className="mt-2 bg-panel rounded-lg p-3 border border-divider max-w-100">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-primary text-sm font-medium">{poll.question}</span>
        {isExpired && (
          <span className="px-1.5 py-0.5 text-2xs bg-offline/20 text-text-tertiary rounded font-bold uppercase">
            Ended
          </span>
        )}
      </div>
      {poll.multi_select && (
        <div className="text-2xs text-text-tertiary mb-1.5">Multiple choice</div>
      )}
      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const count = poll.votes[opt.id] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const isMyVote = myVotes.includes(opt.id);

          return (
            <button
              key={opt.id}
              onClick={() => !isExpired && handleVote(opt.id)}
              disabled={!!isExpired || voting}
              className={`w-full relative rounded-lg overflow-hidden text-left text-sm px-4 py-2 border transition-colors ${
                isMyVote
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-divider bg-panel hover:bg-hover'
              } disabled:cursor-default`}
            >
              {/* Progress bar */}
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                  isMyVote ? 'bg-accent-muted' : 'bg-hover'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between min-w-0">
                <span className={`truncate min-w-0 ${isMyVote ? 'text-accent' : 'text-text-secondary'}`}>
                  {opt.text}
                </span>
                <span className="text-text-tertiary text-xs ml-2 shrink-0">
                  {count} ({pct}%)
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="text-2xs text-text-tertiary mt-2">
        {total} vote{total !== 1 ? 's' : ''}
        {poll.expires_at && !isExpired && (
          <span> · Ends {new Date(poll.expires_at).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}

const PollDisplay = memo(PollDisplayInner);
export default PollDisplay;
