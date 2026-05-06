import { useState, useEffect } from 'react'
import { X, ArrowLeft, FileText, Download } from 'lucide-react'
import * as api from '../../api/client'
import type { Message, User, Attachment } from '../../api/types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import { rewriteStorageUrl } from '../../platform/config'
import s from './DMInfoPanel.module.css'

interface Props {
  open: boolean
  dmId: string
  onUnpin?: (messageId: string) => void
  users?: Map<string, User>
  pinnedVersion?: number
  onMobileClose?: () => void
}

function PinnedItem({ msg, dmId, onUnpin, users }: {
  msg: Message; dmId: string; onUnpin?: (id: string) => void; users?: Map<string, User>
}) {
  const { displayContent, decrypting } = useDecryptedContent(msg.content, msg.nonce, true, dmId)
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? 'Unknown'

  return (
    <div className={s.pinnedItem}>
      <div className={s.pinnedAuthor}>{authorName}</div>
      <div className={s.pinnedContent}>
        {decrypting ? 'Decrypting…' : (displayContent || '').slice(0, 200)}
      </div>
      {onUnpin && (
        <button className={s.unpinBtn} title="Unpin" aria-label="Unpin" onClick={() => onUnpin(msg.id)}>
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

/** Format byte size for the shared-files row. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function SharedFileRow({ att }: { att: Attachment }) {
  const href = rewriteStorageUrl(att.url) ?? att.url
  return (
    <a className={s.fileItem} href={href} target="_blank" rel="noopener noreferrer" download={att.filename}>
      <FileText size={16} strokeWidth={1.5} className={s.fileIcon} />
      <div className={s.fileMeta}>
        <span className={`${s.fileName} txt-tiny txt-medium txt-truncate`}>{att.filename}</span>
        <span className={`${s.fileSize} txt-tiny`}>{formatSize(att.size_bytes)}</span>
      </div>
      <Download size={12} strokeWidth={1.5} className={s.fileDownload} />
    </a>
  )
}

/** Animated skeleton row used while pinned messages or shared files load. */
function SkeletonLines({ count, variant = 'pinned' }: { count: number; variant?: 'pinned' | 'file' }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={variant === 'file' ? s.fileSkeleton : s.pinnedSkeleton}
          aria-hidden="true"
        >
          <div className={`${s.skeletonBar} ${s.skeletonBarShort}`} />
          <div className={s.skeletonBar} />
        </div>
      ))}
    </>
  )
}

export function DMInfoPanel({ open, dmId, onUnpin, users, pinnedVersion, onMobileClose }: Props) {
  const isRevealing = useRevealAnimation(0, [open], open, 300)
  const [pinned, setPinned] = useState<Message[]>([])
  const [loadingPins, setLoadingPins] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Reset transient state when the panel's identity changes — state-during-render
  // avoids set-state-in-effect on the synchronous setLoading/setFiles calls.
  const fetchKey = `${open}|${dmId}|${pinnedVersion ?? 0}`
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey)
    if (!open || !dmId || dmId.startsWith('draft:')) {
      setFiles([])
    } else {
      setLoadingPins(true)
      setLoadingFiles(true)
    }
  }

  // Fetch pinned messages when panel becomes open or dmId changes. Drafts
  // (`draft:…` ids) only exist locally — skip the fetch.
  useEffect(() => {
    if (!open || !dmId || dmId.startsWith('draft:')) return
    api.getDmPinnedMessages(dmId).then(msgs => {
      const normalized = msgs.map(m => ({
        ...m,
        channel_id: m.channel_id ?? (m as unknown as { dm_channel_id?: string }).dm_channel_id ?? dmId,
      }))
      setPinned(normalized)
    }).catch(() => setPinned([])).finally(() => setLoadingPins(false))
  }, [open, dmId, pinnedVersion])

  // Fetch shared files. Re-runs alongside pinnedVersion bumps so newly-uploaded
  // attachments show up without requiring a panel reopen.
  useEffect(() => {
    if (!open || !dmId || dmId.startsWith('draft:')) return
    api.getDmAttachments(dmId)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [open, dmId, pinnedVersion])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setPinned(prev => prev.filter(m => m.id !== msgId))
  }

  return (
    <aside className={`${s.panel} ${!open ? s.hidden : ''}`}>
      <div className={s.header}>
        {onMobileClose && (
          <button className={s.backBtn} title="Back to chat" aria-label="Back to chat" onClick={onMobileClose}>
            <ArrowLeft size={14} strokeWidth={1.5} />
          </button>
        )}
        <span className={`${s.title} txt-tiny txt-semibold`}>Info</span>
      </div>

      <div className={`${s.scroll} scrollbar-thin`}>
        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          Pinned Messages
        </div>
        {loadingPins ? (
          <SkeletonLines count={2} />
        ) : pinned.length === 0 ? (
          <div className={`txt-tiny ${s.emptyHint}`}>No pinned messages yet</div>
        ) : (
          pinned.map(msg => (
            <PinnedItem key={msg.id} msg={msg} dmId={dmId} onUnpin={onUnpin ? handleUnpin : undefined} users={users} />
          ))
        )}

        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          Shared Files
        </div>
        {loadingFiles ? (
          <SkeletonLines count={2} variant="file" />
        ) : files.length === 0 ? (
          <div className={`txt-tiny ${s.emptyHint}`}>No shared files yet</div>
        ) : (
          files.map(att => <SharedFileRow key={att.id} att={att} />)
        )}
      </div>
    </aside>
  )
}
