import { X, ArrowLeft, FileText, Download } from 'lucide-react'
import { useState, useEffect } from 'react'
import * as api from '../../api/client'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import { useT } from '../../hooks/useT'
import { rewriteStorageUrl } from '../../platform/config'
import { createTtlCache } from '../../utils/cache'
import s from './DMInfoPanel.module.css'
import type { Message, User, Attachment } from '../../api/types'

// Module-level TTL caches so toggling the panel or reopening the same DM
// doesn`t refetch within the window. `pinnedVersion` is baked into the key
// so a pin/unpin event invalidates the prior entry.
const pinnedCache = createTtlCache<string, Message[]>({ ttl: 60_000, maxEntries: 30 })
const filesCache = createTtlCache<string, Attachment[]>({ ttl: 60_000, maxEntries: 30 })
function pinnedKey(dmId: string, version: number): string {
  return `${dmId}:${version}`
}

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
  const { t } = useT()
  const { displayContent, decrypting } = useDecryptedContent(msg.content, msg.nonce, true, dmId)
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? t('common.unknown')

  return (
    <div className={s.pinnedItem}>
      <div className={s.pinnedAuthor}>{authorName}</div>
      <div className={s.pinnedContent} dir="auto">
        {decrypting ? t('dmInfoPanel.decrypting') : (displayContent || '').slice(0, 200)}
      </div>
      {onUnpin && (
        <button className={s.unpinBtn} title={t('dmInfoPanel.unpin')} aria-label={t('dmInfoPanel.unpin')} onClick={() => onUnpin(msg.id)}>
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
      {/* index keys are safe — skeleton placeholders are identical and
          replaced wholesale once the real data arrives. */}
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
  const { t } = useT()
  const isRevealing = useRevealAnimation(0, [open], open, 300)
  const [pinned, setPinned] = useState<Message[]>([])
  const [loadingPins, setLoadingPins] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Reset transient state when the panel's identity changes — state-during-render
  // avoids set-state-in-effect on the synchronous setLoading/setFiles calls.
  // Stale-while-revalidate: when only `pinnedVersion` bumps (pin/unpin event),
  // keep the previously rendered pin list visible while the silent re-fetch
  // resolves so the panel doesn't flash a skeleton between identical states.
  const fetchKey = `${open}|${dmId}|${pinnedVersion ?? 0}`
  const dmKey = `${open}|${dmId}`
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)
  const [prevDmKey, setPrevDmKey] = useState(dmKey)
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey)
    const dmIdentityChanged = dmKey !== prevDmKey
    if (!open || !dmId || dmId.startsWith('draft:')) {
      setFiles([])
    } else {
      // Cache-hit short-circuit: warm pinned/attachment caches paint without
      // a skeleton flash. Cold paths fall through to the effects below.
      const pk = pinnedKey(dmId, pinnedVersion ?? 0)
      const cachedPins = pinnedCache.get(pk)
      if (cachedPins !== undefined) {
        setPinned(cachedPins)
        setLoadingPins(false)
      } else if (dmIdentityChanged) {
        setLoadingPins(true)
      }
      const cachedFiles = filesCache.get(dmId)
      if (cachedFiles !== undefined) {
        setFiles(cachedFiles)
        setLoadingFiles(false)
      } else if (dmIdentityChanged) {
        setLoadingFiles(true)
      }
    }
    if (dmIdentityChanged) setPrevDmKey(dmKey)
  }

  // Fetch pinned messages when panel becomes open or dmId changes. Drafts
  // (`draft:…` ids) only exist locally — skip the fetch. Cache-hits are
  // resolved synchronously in the state-during-render block above.
  useEffect(() => {
    if (!open || !dmId || dmId.startsWith('draft:')) return
    const k = pinnedKey(dmId, pinnedVersion ?? 0)
    if (pinnedCache.get(k) !== undefined) return
    let cancelled = false
    api.getDmPinnedMessages(dmId)
      .then(p => {
        if (cancelled) return
        pinnedCache.set(k, p)
        setPinned(p)
      })
      .catch(() => { if (!cancelled) setPinned([]) })
      .finally(() => { if (!cancelled) setLoadingPins(false) })
    return () => { cancelled = true }
  }, [open, dmId, pinnedVersion])

  // Fetch shared files. Re-runs alongside pinnedVersion bumps so newly-uploaded
  // attachments show up without requiring a panel reopen.
  useEffect(() => {
    if (!open || !dmId || dmId.startsWith('draft:')) return
    if (filesCache.get(dmId) !== undefined) return
    let cancelled = false
    api.getDmAttachments(dmId)
      .then(f => {
        if (cancelled) return
        filesCache.set(dmId, f)
        setFiles(f)
      })
      .catch(() => { if (!cancelled) setFiles([]) })
      .finally(() => { if (!cancelled) setLoadingFiles(false) })
    return () => { cancelled = true }
  }, [open, dmId, pinnedVersion])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setPinned(prev => {
      const next = prev.filter(m => m.id !== msgId)
      pinnedCache.set(pinnedKey(dmId, pinnedVersion ?? 0), next)
      return next
    })
  }

  return (
    <aside className={`${s.panel} ${!open ? s.hidden : ''}`}>
      <div className={s.header}>
        {onMobileClose && (
          <button className={s.backBtn} title={t('dmInfoPanel.backToChat')} aria-label={t('dmInfoPanel.backToChat')} onClick={onMobileClose}>
            <ArrowLeft size={14} strokeWidth={1.5} />
          </button>
        )}
        <span className={`${s.title} txt-tiny txt-semibold`}>{t('dmInfoPanel.info')}</span>
      </div>

      <div className={`${s.scroll} scrollbar-thin`}>
        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          {t('dmInfoPanel.pinnedMessages')}
        </div>
        {loadingPins ? (
          <SkeletonLines count={2} />
        ) : pinned.length === 0 ? (
          <div className={`txt-tiny ${s.emptyHint}`}>{t('dmInfoPanel.noPinned')}</div>
        ) : (
          pinned.map(msg => (
            <PinnedItem key={msg.id} msg={msg} dmId={dmId} onUnpin={onUnpin ? handleUnpin : undefined} users={users} />
          ))
        )}

        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          {t('dmInfoPanel.sharedFiles')}
        </div>
        {loadingFiles ? (
          <SkeletonLines count={2} variant="file" />
        ) : files.length === 0 ? (
          <div className={`txt-tiny ${s.emptyHint}`}>{t('dmInfoPanel.noFiles')}</div>
        ) : (
          files.map(att => <SharedFileRow key={att.id} att={att} />)
        )}
      </div>
    </aside>
  )
}
