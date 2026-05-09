import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import type { Attachment } from '../../api/types'
import { rewriteStorageUrl } from '../../platform/config'
import { formatBytes } from '../../utils/format'
import { useAuthedFileUrl } from '../../hooks/useAuthedFileUrl'
import { useAuthedRedirectUrl } from '../../hooks/useAuthedRedirectUrl'
import { useT } from '../../hooks/useT'
import ImageLightbox from '../ImageLightbox/ImageLightbox'
import NMVideoPlayer from '../NMVideoPlayer/NMVideoPlayer'
import NMMusicPlayer from '../NMMusicPlayer/NMMusicPlayer'
import CodeBlockTile from '../CodeBlockTile/CodeBlockTile'
import s from './MessageAttachments.module.css'

interface Props {
  attachments: Attachment[]
}

// ── Classifier ────────────────────────────────────────────────────────

type AttachmentKind = 'image' | 'video' | 'audio' | 'code' | 'file'

// HLS playlists ride on a handful of MIME spellings; the filename probe covers
// servers that fall back to application/octet-stream for unknown extensions.
const HLS_MIME_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
])
const HLS_EXT_RE = /\.m3u8(\?.*)?$/i

const AUDIO_EXT_RE = /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)(\?.*)?$/i

// Filename suffixes whose content is human-readable code/text. Anything matched
// here is rendered with syntax highlighting (CodeBlockTile) instead of a generic
// file chip. Intentionally narrow — random `text/plain` blobs without a known
// suffix still fall through to the file chip so users can download them
// without us trying to parse mis-typed binaries as source.
const CODE_FILE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|php|rs|go|java|kt|swift|c|h|cpp|hpp|cs|lua|sh|bash|zsh|ps1|sql|graphql|gql|css|scss|less|json|yaml|yml|toml|md|markdown|xml|svg|html|htm|vue|svelte|ini|conf|cfg|env|diff|patch|dockerfile|makefile|log|txt)(\?.*)?$/i

/** Single source of truth for which tile renders an attachment. Order matters:
 *  SVG matches both image/* and CODE_FILE_RE, but the user wants it rendered
 *  as XML source (safer too — no inline-SVG XSS surface), so we check code
 *  before image. HLS is checked before generic audio so audio-only HLS
 *  playlists ride the video player path. */
function classifyAttachment(att: Attachment): AttachmentKind {
  const ct = att.content_type.toLowerCase()
  const name = att.filename

  // SVG → code (XML), explicitly before the image branch.
  if (ct === 'image/svg+xml' || /\.svg(\?.*)?$/i.test(name)) return 'code'

  if (ct.startsWith('image/')) return 'image'

  // HLS — playlist or audio-only ext-flagged HLS goes to the video player.
  if (HLS_MIME_TYPES.has(ct) || HLS_EXT_RE.test(name)) return 'video'

  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('audio/') || AUDIO_EXT_RE.test(name)) return 'audio'

  // Code: anchor on either text/* MIME or our explicit ext whitelist. Stops
  // application/octet-stream blobs (extension-less downloads) from rendering
  // as garbage text.
  if (ct.startsWith('text/') || CODE_FILE_RE.test(name)) return 'code'

  return 'file'
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

  // Tag each attachment with its classification once so the classifier doesn't
  // re-run inside both the lightbox-index pass and the render loop.
  const classified = attachments.map((att) => ({ att, kind: classifyAttachment(att) }))
  const imageAttachments = classified.filter((c) => c.kind === 'image').map((c) => c.att)

  return (
    <>
      <div className={s.list}>
        {classified.map(({ att, kind }) => {
          switch (kind) {
            case 'image': {
              const idx = imageAttachments.findIndex((a) => a.id === att.id)
              return (
                <ImageTile
                  key={att.id}
                  attachment={att}
                  onOpen={() => setLightboxIndex(idx >= 0 ? idx : 0)}
                />
              )
            }
            case 'video':
              return <VideoTile key={att.id} attachment={att} />
            case 'audio':
              return <AudioTile key={att.id} attachment={att} />
            case 'code':
              return <CodeBlockTile key={att.id} attachment={att} src={resolveAttachmentSrc(att.url)} />
            case 'file':
              return <FileTile key={att.id} attachment={att} />
          }
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
  // Resolve the auth-protected `/api/files/:id` URL to a stream-token URL the
  // browser can hit directly with Range requests (progressive playback + seek)
  // instead of buffering the whole file as a blob first.
  const streamUrl = useAuthedRedirectUrl(resolveAttachmentSrc(attachment.url))
  return (
    <div className={s.media}>
      {streamUrl
        ? <NMVideoPlayer
            src={streamUrl}
            title={attachment.filename}
            downloadUrl={streamUrl}
            downloadFilename={attachment.filename}
          />
        : <div className={s.videoSkeleton} />}
    </div>
  )
}

function AudioTile({ attachment }: { attachment: Attachment }) {
  const streamUrl = useAuthedRedirectUrl(resolveAttachmentSrc(attachment.url))
  if (!streamUrl) {
    return (
      <div className={s.audioSkeleton}>
        <span className={s.audioSkeletonName}>{attachment.filename}</span>
      </div>
    )
  }
  return <NMMusicPlayer src={streamUrl} filename={attachment.filename} downloadUrl={streamUrl} />
}

function FileTile({ attachment }: { attachment: Attachment }) {
  // Stream-token URL for the download anchor — clicking triggers a streamed
  // browser download with no client-side memory cost (avoids buffering a
  // 250 MB file into a blob just to allow `download=`). Falls back to the
  // raw proxy URL while the token resolves; the browser will negotiate auth
  // through the normal Bearer challenge in that brief window.
  const rawUrl = resolveAttachmentSrc(attachment.url)
  const streamUrl = useAuthedRedirectUrl(rawUrl)
  return (
    <a
      className={s.file}
      href={streamUrl ?? rawUrl}
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
