import * as api from '../../api/client'
import type { Poll } from '../../api/types'
import s from './PollDisplay.module.css'

interface Props {
  poll: Poll
}

/**
 * Inline poll renderer attached to a message. The store keeps `poll` fresh
 * via `PollUpdate` WS events (see stores/messages.ts) — this component only
 * reads the prop and fires off vote/unvote API calls; it does no optimistic
 * mutation.
 */
export function PollDisplay({ poll }: Props) {
  const expired = poll.expires_at ? new Date(poll.expires_at).getTime() < Date.now() : false
  const myVotes = new Set(poll.my_votes ?? [])
  const totalVotes = poll.total_votes ?? 0

  async function onVote(optionId: string) {
    if (expired) return
    try {
      if (myVotes.has(optionId)) {
        await api.unvotePoll(poll.id, optionId)
      } else {
        // Backend handles "switch vote" automatically for single-select polls.
        await api.votePoll(poll.id, optionId)
      }
    } catch (err) {
      console.warn('Failed to update poll vote:', err)
    }
    // No local mutation — wait for PollUpdate WS event to refresh.
  }

  return (
    <div className={s.poll} onClick={(e) => e.stopPropagation()}>
      <div className={s.header}>
        <span className={`${s.question} txt-body txt-semibold`}>{poll.question}</span>
        {expired && <span className={`${s.closedBadge} txt-tiny txt-semibold`}>Closed</span>}
      </div>
      <div className={s.options}>
        {poll.options.map((opt) => {
          const count = poll.votes?.[opt.id] ?? 0
          const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0
          const voted = myVotes.has(opt.id)
          return (
            <button
              key={opt.id}
              type="button"
              className={`${s.option} ${voted ? s.voted : ''}`}
              onClick={() => onVote(opt.id)}
              disabled={expired}
            >
              <div className={s.bar} style={{ width: `${pct}%` }} aria-hidden />
              <span className={`${s.optionText} txt-small`}>{opt.text}</span>
              <span className={`${s.optionCount} txt-tiny txt-medium`}>{count}</span>
            </button>
          )
        })}
      </div>
      <div className={`${s.footer} txt-tiny`}>
        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        {poll.multi_select && <span className={s.footerMeta}> · multiple choice</span>}
        {poll.anonymous && <span className={s.footerMeta}> · anonymous</span>}
      </div>
    </div>
  )
}
