import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import type { Attachment } from '../../api/types'
import { rewriteStorageUrl } from '../../platform/config'
import { formatBytes } from '../../utils/format'
import { useAuthedFileUrl } from '../../hooks/useAuthedFileUrl'
import ImageLightbox from '../ImageLightbox/ImageLightbox'
import s from './MessageAttachments.module.css'

interface Props {
  attachments: Attachment[]
}

function isImage(att: Attachment): boolean {
  return att.content_type.startsWith('image/')
}
function isVideo(att: Attachment): boolean {
  return att.content_type.startsWith('video/')
}

/** Resolve an attachment URL into something the DOM can consume.
 *  Backend-served `/api/files/:id` requires a Bearer token, so `<img src>` and
 *  `<video src>` would fail. Wrap those in a blob: URL via authed fetch.
 *  Pre-signed S3 URLs (for older / different paths) just go through
 *  rewriteStorageUrl unchanged. */
function resolveAttachmentSrc(rawUrl: string): string {
  if (rawUrl.startsWith('/api/files/') || rawUrl.startsWith('/files/')) return rawUrl
  return rewriteStorageUrl(rawUrl) ?? rawUrl
}

export function MessageAttachments({ attachments }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  if (attachments.length === 0) return null

  // Filter to image attachments for the lightbox set; clicking any image tile
  // jumps the lightbox to that image's index in the filtered list.
  const imageAttachments = attachments.filter(isImage)

  return (
    <>
      <div className={s.list}>
        {attachments.map((att) => {
          if (isImage(att)) {
            const idx = imageAttachments.findIndex((a) => a.id === att.id)
            return (
              <ImageTile
                key={att.id}
                attachment={att}
                onOpen={() => setLightboxIndex(idx >= 0 ? idx : 0)}
              />
            )
          }
          if (isVideo(att)) {
            return <VideoTile key={att.id} attachment={att} />
          }
          return <FileTile key={att.id} attachment={att} />
        })}
      </div>
      {lightboxIndex !== null && imageAttachments.length > 0 && (
        <ImageLightbox
          attachments={imageAttachments}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}

// ── Tile components ───────────────────────────────────────────────────

function ImageTile({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const blobUrl = useAuthedFileUrl(resolveAttachmentSrc(attachment.url))
  return (
    <button
      className={s.media}
      onClick={onOpen}
      aria-label={`Open ${attachment.filename}`}
      disabled={!blobUrl}
    >
      {blobUrl ? (
        <img src={blobUrl} alt={attachment.filename} loading="lazy" draggable={false} />
      ) : (
        <span className={s.loadingTile} />
      )}
    </button>
  )
}

function VideoTile({ attachment }: { attachment: Attachment }) {
  const blobUrl = useAuthedFileUrl(resolveAttachmentSrc(attachment.url))
  if (!blobUrl) return <span className={`${s.media} ${s.loadingTile}`} />
  return (
    <video className={s.media} src={blobUrl} controls preload="metadata" />
  )
}

function FileTile({ attachment }: { attachment: Attachment }) {
  const url = resolveAttachmentSrc(attachment.url)
  const blobUrl = useAuthedFileUrl(url)
  // Anchor click downloads the blob with the original filename. Falls back to
  // a plain link to the proxy URL if the blob fetch is still pending — the
  // browser will trigger the auth challenge in that case.
  return (
    <a
      className={s.file}
      href={blobUrl ?? url}
      download={attachment.filename}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className={s.fileIcon}><FileText size={16} strokeWidth={1.6} /></span>
      <span className={s.fileMeta}>
        <span className={s.fileName}>{attachment.filename}</span>
        <span className={s.fileSize}>{formatBytes(attachment.size_bytes)}</span>
      </span>
      <Download size={15} strokeWidth={1.6} className={s.fileDownload} />
    </a>
  )
}
