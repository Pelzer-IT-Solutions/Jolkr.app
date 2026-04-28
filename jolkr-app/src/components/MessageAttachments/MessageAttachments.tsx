import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import type { Attachment } from '../../api/types'
import { rewriteStorageUrl } from '../../platform/config'
import { formatBytes } from '../../utils/format'
import ImageLightbox, { type LightboxImage } from '../ImageLightbox'
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

export function MessageAttachments({ attachments }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  if (attachments.length === 0) return null

  // Lightbox source is the subset of image attachments. Click handlers map a
  // visible tile back to its index in this filtered list.
  const images: LightboxImage[] = attachments
    .filter(isImage)
    .map((a) => ({
      src: rewriteStorageUrl(a.url) ?? a.url,
      alt: a.filename,
      filename: a.filename,
      sizeBytes: a.size_bytes,
      contentType: a.content_type,
    }))

  return (
    <>
      <div className={s.list}>
        {attachments.map((att) => {
          const url = rewriteStorageUrl(att.url) ?? att.url
          if (isImage(att)) {
            const idx = images.findIndex((i) => i.src === url)
            return (
              <button
                key={att.id}
                className={s.media}
                onClick={() => setLightboxIndex(idx >= 0 ? idx : 0)}
                aria-label={`Open ${att.filename}`}
              >
                <img src={url} alt={att.filename} loading="lazy" draggable={false} />
              </button>
            )
          }
          if (isVideo(att)) {
            return (
              <video
                key={att.id}
                className={s.media}
                src={url}
                controls
                preload="metadata"
              />
            )
          }
          return (
            <a
              key={att.id}
              className={s.file}
              href={url}
              download={att.filename}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span className={s.fileIcon}><FileText size={16} strokeWidth={1.6} /></span>
              <span className={s.fileMeta}>
                <span className={s.fileName}>{att.filename}</span>
                <span className={s.fileSize}>{formatBytes(att.size_bytes)}</span>
              </span>
              <Download size={15} strokeWidth={1.6} className={s.fileDownload} />
            </a>
          )
        })}
      </div>
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
