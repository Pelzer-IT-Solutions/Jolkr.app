import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/client'
import { decryptChannelMessage } from '../../crypto/channelKeys'
import { useT } from '../../hooks/useT'
import { enqueueDecrypt } from '../../services/decryptQueue'
import { getLocalKeys, isE2EEReady } from '../../services/e2ee'
import s from './PollDisplay.module.css'
import type { Poll } from '../../api/types'

interface Props {
  poll: Poll
}

/** Decrypted poll texts: `q` is the question, `opts` the option texts by position. */
interface PollTexts {
  q: string
  opts: string[]
}

/** Parse + shape-check the decrypted `{ q, opts }` payload. */
function parsePollPayload(plaintext: string): PollTexts | null {
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const { q, opts } = parsed as { q?: unknown; opts?: unknown }
    if (typeof q !== 'string') return null
    if (!Array.isArray(opts) || !opts.every((o): o is string => typeof o === 'string')) return null
    return { q, opts }
  } catch {
    return null
  }
}

/**
 * Inline poll renderer attached to a message. The store keeps `poll` fresh
 * via `PollUpdate` WS events (see stores/messages.ts) — this component only
 * reads the prop and fires off vote/unvote API calls; it does no optimistic
 * mutation.
 *
 * E2EE polls carry the question + option texts in a single encrypted
 * `{ q, opts }` payload (channel key, same scheme as messages). We decrypt it
 * once via the shared decrypt queue and map option position → text. Legacy
 * polls (no `encrypted_payload`) render the plaintext fields as before.
 */
export function PollDisplay({ poll }: Props) {
  const { t, tn } = useT()
  // `Date.now()` is impure — capture it in state and refresh once the
  // expiry passes so the "Closed" badge appears without a manual reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!poll.expires_at) return
    const remaining = new Date(poll.expires_at).getTime() - Date.now()
    if (remaining <= 0) return
    const t = setTimeout(() => setNow(Date.now()), remaining)
    return () => clearTimeout(t)
  }, [poll.expires_at])
  const expired = poll.expires_at ? new Date(poll.expires_at).getTime() < now : false
  const myVotes = new Set(poll.my_votes ?? [])
  const totalVotes = poll.total_votes ?? 0

  // ── E2EE payload decryption ──
  // Deps are the payload strings (stable across PollUpdate refreshes, which
  // only change vote counts), so the decrypt runs once per poll.
  const encryptedPayload = poll.encrypted_payload ?? null
  const payloadNonce = poll.nonce ?? null
  const channelId = poll.channel_id
  const isEncrypted = encryptedPayload !== null && payloadNonce !== null
  const [texts, setTexts] = useState<PollTexts | null>(null)
  const [decryptFailed, setDecryptFailed] = useState(false)
  const retryRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!encryptedPayload || !payloadNonce) return

    let cancelled = false
    let cancelJob: (() => void) | null = null
    // Fresh input → fresh retry budget (mirrors useDecryptedContent).
    retryRef.current = 0

    const runDecrypt = async (): Promise<void> => {
      if (cancelled) return

      if (!isE2EEReady()) {
        if (retryRef.current < 5) {
          retryRef.current++
          retryTimerRef.current = setTimeout(() => {
            if (cancelled) return
            cancelJob = enqueueDecrypt(runDecrypt)
          }, 1000)
          return
        }
        setDecryptFailed(true)
        return
      }

      retryRef.current = 0
      const localKeys = getLocalKeys()
      if (!localKeys) {
        setDecryptFailed(true)
        return
      }

      try {
        const plaintext = await decryptChannelMessage(channelId, localKeys, encryptedPayload, payloadNonce)
        if (cancelled) return
        const parsed = parsePollPayload(plaintext)
        if (!parsed) {
          console.warn('E2EE: Poll payload decrypted but had an unexpected shape')
          setDecryptFailed(true)
          return
        }
        setTexts(parsed)
      } catch (err) {
        if (!cancelled) {
          console.warn('E2EE: Failed to decrypt poll:', err)
          setDecryptFailed(true)
        }
      }
    }

    cancelJob = enqueueDecrypt(runDecrypt)

    return () => {
      cancelled = true
      cancelJob?.()
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [encryptedPayload, payloadNonce, channelId])

  // Legacy fallback: polls created before E2EE keep their plaintext fields.
  const question = isEncrypted
    ? texts?.q ?? t(decryptFailed ? 'message.decrypt.failed' : 'message.decrypt.decrypting')
    : poll.question
  const optionText = (position: number, plaintext: string): string =>
    isEncrypted ? texts?.opts[position] ?? (decryptFailed ? t('message.decrypt.decryptingShort') : '') : plaintext

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
        <span className={`${s.question} txt-body txt-semibold`} dir="auto">{question}</span>
        {expired && <span className={`${s.closedBadge} txt-tiny txt-semibold`}>{t('poll.display.closed')}</span>}
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
              <span className={`${s.optionText} txt-small`} dir="auto">{optionText(opt.position, opt.text)}</span>
              <span className={`${s.optionCount} txt-tiny txt-medium`}>{count}</span>
            </button>
          )
        })}
      </div>
      <div className={`${s.footer} txt-tiny`}>
        {tn('poll.display.voteCount', totalVotes)}
        {poll.multi_select && <span className={s.footerMeta}> · {t('poll.display.multipleChoice')}</span>}
        {poll.anonymous && <span className={s.footerMeta}> · {t('poll.display.anonymous')}</span>}
      </div>
    </div>
  )
}
