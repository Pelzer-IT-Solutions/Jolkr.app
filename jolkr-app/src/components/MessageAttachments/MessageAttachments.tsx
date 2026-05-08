import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import type { Attachment } from '../../api/types'
import { rewriteStorageUrl } from '../../platform/config'
import { formatBytes } from '../../utils/format'
import { useAuthedFileUrl } from '../../hooks/useAuthedFileUrl'
import { useT } from '../../hooks/useT'
import ImageLightbox from '../ImageLightbox/ImageLightbox'
import NMVideoPlayer from '../NMVideoPlayer/NMVideoPlayer'
import NMMusicPlayer from '../NMMusicPlayer/NMMusicPlayer'
import CodeBlockTile from '../CodeBlockTile/CodeBlockTile'
import s from './MessageAttachments.module.css'

interface Props {
  attachments: Attachment[]
}

function isImage(att: Attachment): boolean {
  return att.content_type.startsWith('image/')
}

// HLS playlists ride on a handful of MIME spellings depending on which
// tool produced them; older clients also send the audio variant for
// audio-only streams. The filename probe covers servers that fall back
// to application/octet-stream for unknown extensions.
const HLS_MIME_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
])
function isVideo(att: Attachment): boolean {
  if (att.content_type.startsWith('video/')) return true
  if (HLS_MIME_TYPES.has(att.content_type.toLowerCase())) return true
  return /\.m3u8(\?.*)?$/i.test(att.filename)
}
function isAudio(att: Attachment): boolean {
  if (att.content_type.startsWith('audio/')) return true
  // Servers that fall back to application/octet-stream for unfamiliar
  // codecs still pass through if the filename has a recognised audio
  // extension. mpegurl is intentionally absent — those are HLS playlists
  // and routed to the video player instead.
  return /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)(\?.*)?$/i.test(att.filename)
}

// Filename suffixes whose content is human-readable code/text. Anything
// matched here is rendered with syntax highlighting (CodeBlockTile)
// instead of a generic file chip. The list is intentionally narrow —
// random `text/plain` blobs we didn't recognise still fall through to
// the file chip so users can download them without us trying to parse.
const CODE_FILE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|php|rs|go|java|kt|swift|c|h|cpp|hpp|cs|lua|sh|bash|zsh|ps1|sql|graphql|gql|css|scss|less|json|yaml|yml|toml|md|markdown|xml|svg|html|htm|vue|svelte|ini|conf|cfg|env|diff|patch|dockerfile|makefile|log|txt)(\?.*)?$/i

function isCode(att: Attachment): boolean {
  if (CODE_FILE_RE.test(att.filename)) return true
  // text/* types we trust as code-renderable. Text/html is excluded
  // server-side (forced to attachment download), so this check only sees
  // things like text/plain, text/css, text/markdown, etc.
  return att.content_type.toLowerCase().startsWith('text/')
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
          if (isAudio(att)) {
            return <AudioTile key={att.id} attachment={att} />
          }
          if (isCode(att)) {
            return <CodeBlockTile key={att.id} attachment={att} src={resolveAttachmentSrc(att.url)} />
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
  const { t } = useT()
  const blobUrl = useAuthedFileUrl(resolveAttachmentSrc(attachment.url))
  return (
    <button
      className={s.media}
      onClick={onOpen}
      aria-label={t('attachments.openImage', { filename: attachment.filename })}
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
  // Uploaded videos route through the same NoMercy player as URL-based video
  // embeds so playback UI (controls, fullscreen, buffering, mute) is identical.
  // No autoPlay — chat videos shouldn't start until the user clicks.
  return (
    <div className={s.media}>
      <NMVideoPlayer src={blobUrl} title={attachment.filename} />
    </div>
  )
}

function AudioTile({ attachment }: { attachment: Attachment }) {
  const blobUrl = useAuthedFileUrl(resolveAttachmentSrc(attachment.url))
  if (!blobUrl) return <span className={`${s.audioLoading} ${s.loadingTile}`} />
  return <NMMusicPlayer src={blobUrl} filename={attachment.filename} />
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
