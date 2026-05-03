import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { X, Camera, AlertCircle } from 'lucide-react'
import type { User } from '../../api/types'
import * as api from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import { invalidateFriendsCache } from '../../services/friendshipCache'
import { useToast } from '../../stores/toast'
import Avatar from '../Avatar/Avatar'
import s from './QrCodeScanner.module.css'

interface Props {
  open: boolean
  onClose: () => void
  /** Fired after a friend request is successfully sent so the parent can refresh. */
  onFriendRequestSent?: () => void
}

const VIEWFINDER_ID = 'jolkr-qr-scanner-viewfinder'

// QR payload formats accepted (both written by QrCodeDisplay):
//   https://jolkr.app/app/add/<uuid>  (web share)
//   jolkr://add/<uuid>                (Tauri deep-link)
// UUID v4 shape enforced so 36-char garbage doesn't slip through to the
// backend with a confusing 404.
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
function parseJolkrUserId(text: string): string | null {
  const web = text.match(new RegExp(`jolkr\\.app/(?:app/)?add/(${UUID_RE})`, 'i'))
  if (web) return web[1]
  const deep = text.match(new RegExp(`jolkr://add/(${UUID_RE})`, 'i'))
  if (deep) return deep[1]
  return null
}

export function QrCodeScanner({ open, onClose, onFriendRequestSent }: Props) {
  const myId = useAuthStore(st => st.user?.id)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const processingRef = useRef(false)
  const [error, setError] = useState('')
  const [scannedUser, setScannedUser] = useState<User | null>(null)
  const [sending, setSending] = useState(false)

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      // getState() === 2 means SCANNING; calling stop() in any other state throws.
      if (scanner.getState() === 2) await scanner.stop()
    } catch {
      // Camera teardown is best-effort; ignore.
    }
    scannerRef.current = null
  }, [])

  const handleClose = useCallback(() => {
    void stopScanner()
    setError('')
    setScannedUser(null)
    setSending(false)
    processingRef.current = false
    onClose()
  }, [stopScanner, onClose])

  // Reset transient state synchronously when the modal opens so a stale
  // error or scanned-user from a previous open doesn't briefly flash. The
  // processingRef reset lives in the start-scanner effect since refs may
  // only be mutated outside of render.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setError('')
      setScannedUser(null)
      setSending(false)
    }
  }

  // Start the scanner whenever the modal opens. The viewfinder div is
  // rendered conditionally, so we defer one tick to let it mount before
  // html5-qrcode tries to attach to it.
  useEffect(() => {
    if (!open) return

    processingRef.current = false
    let cancelled = false

    async function start() {
      // Defer one frame so the viewfinder div exists in the DOM.
      await new Promise(r => requestAnimationFrame(() => r(null)))
      if (cancelled) return
      if (!document.getElementById(VIEWFINDER_ID)) return

      try {
        const scanner = new Html5Qrcode(VIEWFINDER_ID)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async decoded => {
            if (processingRef.current) return
            processingRef.current = true

            const userId = parseJolkrUserId(decoded)
            if (!userId) {
              setError('Not a valid Jolkr QR code')
              processingRef.current = false
              return
            }
            if (userId === myId) {
              setError("You can't add yourself as a friend")
              processingRef.current = false
              return
            }

            // Stop the camera before fetching so the preview freezes on the
            // last good frame instead of continuing to scan during the modal
            // confirmation step.
            await stopScanner()

            try {
              const u = await api.getUser(userId)
              if (!cancelled) setScannedUser(u)
            } catch {
              if (!cancelled) setError('User not found')
              processingRef.current = false
            }
          },
          () => { /* no QR in frame — ignore */ },
        )
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        if (/permission|NotAllowed/i.test(msg)) {
          setError('Camera access denied. Allow camera permissions and try again.')
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('No camera found on this device.')
        } else {
          setError(`Could not start camera: ${msg}`)
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      void stopScanner()
    }
  }, [open, myId, stopScanner])

  async function handleSendRequest() {
    if (!scannedUser) return
    setSending(true)
    try {
      await api.sendFriendRequest(scannedUser.id)
      invalidateFriendsCache()
      useToast.getState().show(`Friend request sent to ${scannedUser.username}`, 'success')
      onFriendRequestSent?.()
      handleClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send friend request'
      setError(msg)
      setSending(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleClose()
  }

  if (!open) return null

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={`${s.title} txt-medium`}>Scan QR Code</span>
          <button className={s.closeBtn} onClick={handleClose} aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.body}>
          {error && (
            <div className={`${s.error} txt-small`}>
              <AlertCircle size={14} strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}

          {scannedUser ? (
            <div className={s.confirm}>
              <Avatar
                url={scannedUser.avatar_url}
                name={scannedUser.display_name ?? scannedUser.username}
                size="2xl"
                userId={scannedUser.id}
              />
              <span className={`${s.username} txt-small txt-semibold`}>{scannedUser.username}</span>
              <button
                className={`${s.sendBtn} txt-small txt-medium`}
                onClick={handleSendRequest}
                disabled={sending}
              >
                {sending ? 'Sending…' : 'Send Friend Request'}
              </button>
            </div>
          ) : (
            <>
              <div id={VIEWFINDER_ID} className={s.viewfinder} />
              <div className={`${s.hint} txt-tiny`}>
                <Camera size={12} strokeWidth={1.5} />
                <span>Point your camera at a Jolkr QR code</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
