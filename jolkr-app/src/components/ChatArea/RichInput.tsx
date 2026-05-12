import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react'
import s from './RichInput.module.css'
import {
  getPlainText,
  getTextBeforeCursor,
  createEmojiImg,
  convertEmojisInElement,
  getPlainTextOffset,
  setCursorToOffset,
} from './richInputHelpers'

export interface RichInputHandle {
  focus: () => void
  getPlainText: () => string
  getTextBeforeCursor: () => string | null
  insertEmojiAtCursor: (emoji: string) => void
  insertTextAtCursor: (text: string) => void
  clear: () => void
  replaceBeforeCursor: (charCount: number, replacement: string | HTMLImageElement) => void
}

interface Props {
  placeholder?: string
  onInput?: (plainText: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onSelectionChange?: () => void
}

export const RichInput = forwardRef<RichInputHandle, Props>(function RichInput(
  { placeholder = '', onInput, onKeyDown, onSelectionChange },
  ref,
) {
  const divRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)

  // ── helpers ──────────────────────────────────────────────────────────────

  const updateEmpty = useCallback(() => {
    const el = divRef.current
    if (!el) return
    if (el.textContent === '' && !el.querySelector('img')) {
      el.setAttribute('data-empty', '')
    } else {
      el.removeAttribute('data-empty')
    }
  }, [])

  const restoreCursor = useCallback(() => {
    const el = divRef.current
    if (!el) return
    el.focus()
    if (!savedRange.current) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }, [])

  const saveRange = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    savedRange.current = sel.getRangeAt(0).cloneRange()
  }, [])

  // ── imperative handle ─────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    focus() {
      restoreCursor()
    },

    getPlainText() {
      const el = divRef.current
      if (!el) return ''
      return getPlainText(el)
    },

    getTextBeforeCursor() {
      const el = divRef.current
      if (!el) return null
      return getTextBeforeCursor(el)
    },

    insertEmojiAtCursor(emoji: string) {
      const el = divRef.current
      if (!el) return
      restoreCursor()
      const img = createEmojiImg(emoji)
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(img)
        // Move cursor after the inserted img
        range.setStartAfter(img)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        el.appendChild(img)
      }
      saveRange()
      updateEmpty()
      onInput?.(getPlainText(el))
    },

    insertTextAtCursor(text: string) {
      const el = divRef.current
      if (!el) return
      restoreCursor()
      document.execCommand('insertText', false, text)
      saveRange()
      updateEmpty()
      onInput?.(getPlainText(el))
    },

    clear() {
      const el = divRef.current
      if (!el) return
      el.innerHTML = ''
      el.style.height = ''
      savedRange.current = null
      el.setAttribute('data-empty', '')
    },

    replaceBeforeCursor(charCount: number, replacement: string | HTMLImageElement) {
      const el = divRef.current
      if (!el) return
      restoreCursor()
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return

      const range = sel.getRangeAt(0)
      // Walk backwards charCount characters from the cursor
      let node: Node | null = range.startContainer
      let offset = range.startOffset
      let remaining = charCount

      // Collect the nodes/ranges to delete
      const rangeToDel = document.createRange()
      rangeToDel.setStart(range.startContainer, range.startOffset)
      rangeToDel.setEnd(range.startContainer, range.startOffset)

      while (remaining > 0 && node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const take = Math.min(offset, remaining)
          if (take > 0) {
            rangeToDel.setStart(node, offset - take)
            remaining -= take
            offset -= take
          }
          if (remaining > 0) {
            const prevSib: Node | null = node.previousSibling
            if (prevSib) {
              node = prevSib
              offset = prevSib.nodeType === Node.TEXT_NODE ? (prevSib.textContent?.length ?? 0) : 0
            } else {
              const parentNode: Node | null = node.parentNode
              if (parentNode && parentNode !== el) {
                node = parentNode.previousSibling ?? null
                offset = node?.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0
              } else {
                break
              }
            }
          }
        } else if ((node as Element).tagName === 'IMG') {
          rangeToDel.setStartBefore(node)
          remaining -= 1
          const prevSib: Node | null = node.previousSibling
          if (prevSib) {
            node = prevSib
            offset = prevSib.nodeType === Node.TEXT_NODE ? (prevSib.textContent?.length ?? 0) : 0
          } else {
            break
          }
        } else {
          break
        }
      }

      rangeToDel.deleteContents()

      // Insert replacement
      if (typeof replacement === 'string') {
        const textNode = document.createTextNode(replacement)
        rangeToDel.insertNode(textNode)
        rangeToDel.setStartAfter(textNode)
      } else {
        rangeToDel.insertNode(replacement)
        // Insert a space after the img
        const space = document.createTextNode(' ')
        rangeToDel.setStartAfter(replacement)
        rangeToDel.insertNode(space)
        rangeToDel.setStartAfter(space)
      }
      rangeToDel.collapse(true)
      sel.removeAllRanges()
      sel.addRange(rangeToDel)

      saveRange()
      updateEmpty()
      onInput?.(getPlainText(el))
    },
  }), [restoreCursor, saveRange, updateEmpty, onInput])

  // ── event handlers ────────────────────────────────────────────────────────

  const handleInput = useCallback(() => {
    const el = divRef.current
    if (!el) return

    // Snapshot cursor offset in plain-text space before mutation
    const sel = window.getSelection()
    let plainOffset: number | null = null
    if (sel && sel.rangeCount > 0) {
      plainOffset = getPlainTextOffset(el)
    }

    convertEmojisInElement(el)

    // Restore cursor after emoji conversion
    if (plainOffset !== null) {
      setCursorToOffset(el, plainOffset)
      saveRange()
    }

    // Auto-resize
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'

    updateEmpty()
    onInput?.(getPlainText(el))
  }, [saveRange, updateEmpty, onInput])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      document.execCommand('insertHTML', false, '<br>')
      return
    }
    onKeyDown?.(e)
  }, [onKeyDown])

  const handleBlur = useCallback(() => {
    saveRange()
  }, [saveRange])

  const handleSelect = useCallback(() => {
    onSelectionChange?.()
  }, [onSelectionChange])

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      className={s.richInput}
      data-empty=""
      data-placeholder={placeholder}
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onSelect={handleSelect}
    />
  )
})
