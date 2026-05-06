import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { searchEmojis } from '../../utils/emoji'
import { createEmojiImg } from './richInputHelpers'
import type { RichInputHandle } from './RichInput'
import type { MentionableUser } from './ChatArea'

const SCAN_DEBOUNCE_MS = 100

export interface AutocompleteState {
  /** Emoji query — non-null means the picker is open. */
  emojiQuery: string | null
  emojiIndex: number
  emojiMatches: ReturnType<typeof searchEmojis>
  /** Mention query — non-null means the picker is open. */
  mentionQuery: string | null
  mentionIndex: number
  mentionMatches: MentionableUser[]
}

export interface AutocompleteHandlers {
  /** Call from RichInput's onChange — debounced; sets queries based on
   *  text-before-cursor heuristics for `:foo` and `@foo` patterns. */
  syncContent: (plainText: string) => void
  /** Run on every keydown — returns true if the event has been handled
   *  (Arrow up/down navigation, Tab/Enter to insert, Escape to dismiss). */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  /** Replace the in-progress :colon: token with the chosen emoji image. */
  insertEmoji: (emoji: string) => void
  /** Replace the in-progress @at token with `@username `. */
  insertMention: (username: string) => void
  /** Manually dismiss both pickers (e.g. when the input loses focus). */
  reset: () => void
  /** Set the highlighted index inside whichever picker is open — used by
   *  hover handlers in the rendered list. */
  setEmojiIndex: (i: number) => void
  setMentionIndex: (i: number) => void
}

/**
 * Composer autocomplete: emoji `:colon:` triggers + `@username` mentions.
 *
 * Owns the four pieces of UI state previously held inline in ChatArea
 * (`emojiQuery`/`emojiIndex` and `mentionQuery`/`mentionIndex`) plus the
 * debounce timer ref so all the regex-and-filter work lives in one place.
 *
 * The keyboard handler returns `true` when it intercepted the event — the
 * composer's own `Enter`/`Escape` handling should bail in that case.
 */
export function useAutocomplete(
  inputRef: RefObject<RichInputHandle | null>,
  mentionableUsers: ReadonlyArray<MentionableUser>,
  onTyping?: () => void,
): AutocompleteState & AutocompleteHandlers {
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiIndex, setEmojiIndex] = useState(0)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const emojiMatches = useMemo(() => {
    if (emojiQuery === null) return []
    return searchEmojis(emojiQuery, 8)
  }, [emojiQuery])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || mentionableUsers.length === 0) return []
    const q = mentionQuery.toLowerCase()
    return mentionableUsers.filter(u => u.username.toLowerCase().includes(q)).slice(0, 8)
  }, [mentionQuery, mentionableUsers])

  const reset = useCallback(() => {
    setEmojiQuery(null); setEmojiIndex(0)
    setMentionQuery(null); setMentionIndex(0)
  }, [])

  const insertEmoji = useCallback((emoji: string) => {
    const handle = inputRef.current
    if (!handle) return
    const text = handle.getTextBeforeCursor()
    if (!text) return
    const lastColon = text.lastIndexOf(':')
    if (lastColon === -1) return
    const charCount = text.length - lastColon
    handle.replaceBeforeCursor(charCount, createEmojiImg(emoji))
    setEmojiQuery(null); setEmojiIndex(0)
  }, [inputRef])

  const insertMention = useCallback((username: string) => {
    const handle = inputRef.current
    if (!handle) return
    const text = handle.getTextBeforeCursor()
    if (!text) return
    const lastAt = text.lastIndexOf('@')
    if (lastAt === -1) return
    const charCount = text.length - lastAt
    handle.replaceBeforeCursor(charCount, `@${username} `)
    setMentionQuery(null); setMentionIndex(0)
  }, [inputRef])

  const syncContent = useCallback((_plainText: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Keeps suggestions instant for ordinary typing while skipping the
    // regex+filter work for in-burst keystrokes. Ref-based timer ensures
    // only the latest scan runs.
    debounceRef.current = setTimeout(() => {
      const text = inputRef.current?.getTextBeforeCursor() ?? null
      if (!text) {
        setEmojiQuery(null); setMentionQuery(null)
        return
      }
      const lastColon = text.lastIndexOf(':')
      if (lastColon !== -1 && (lastColon === 0 || /\s/.test(text[lastColon - 1]))) {
        const query = text.slice(lastColon + 1)
        if (query.length >= 2 && /^[a-zA-Z0-9_]+$/.test(query)) {
          setEmojiQuery(query); setEmojiIndex(0)
        } else {
          setEmojiQuery(null)
        }
      } else {
        setEmojiQuery(null)
      }

      const lastAt = text.lastIndexOf('@')
      if (lastAt !== -1 && (lastAt === 0 || /\s/.test(text[lastAt - 1]))) {
        const mQuery = text.slice(lastAt + 1)
        if (!/\s/.test(mQuery)) {
          setMentionQuery(mQuery); setMentionIndex(0)
        } else {
          setMentionQuery(null)
        }
      } else {
        setMentionQuery(null)
      }
    }, SCAN_DEBOUNCE_MS)
    onTyping?.()
  }, [inputRef, onTyping])

  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (emojiQuery !== null && emojiMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiIndex(i => (i + 1) % emojiMatches.length); return true }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setEmojiIndex(i => (i - 1 + emojiMatches.length) % emojiMatches.length); return true }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault(); insertEmoji(emojiMatches[emojiIndex].emoji); return true
      }
      if (e.key === 'Escape') { setEmojiQuery(null); setEmojiIndex(0); return true }
    }
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionMatches.length); return true }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return true }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault(); insertMention(mentionMatches[mentionIndex].username); return true
      }
      if (e.key === 'Escape') { setMentionQuery(null); setMentionIndex(0); return true }
    }
    return false
  }, [emojiQuery, emojiMatches, emojiIndex, insertEmoji, mentionQuery, mentionMatches, mentionIndex, insertMention])

  return {
    emojiQuery, emojiIndex, emojiMatches,
    mentionQuery, mentionIndex, mentionMatches,
    syncContent, handleKeyDown, insertEmoji, insertMention, reset,
    setEmojiIndex, setMentionIndex,
  }
}
