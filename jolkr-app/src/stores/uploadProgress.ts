import { create } from 'zustand'

/**
 * Tracks per-message attachment upload progress so the UI can show a
 * progress bar / "Uploading X.mp4 — 45%" placeholder while bytes are still
 * in flight. Cleared once the backend confirms the attachment (the real
 * attachment then arrives via the WS MessageUpdate event).
 */
export interface PendingUpload {
  /** Stable key — file.name is good enough since we serialize uploads per
   *  message and don't allow two files with the same name in one go. */
  fileName: string
  size: number
  /** Bytes uploaded so far (0..size). */
  loaded: number
  /** Error message if the upload failed. When set, the row stays visible
   *  briefly so the user sees what went wrong, then gets cleared. */
  error?: string
}

interface UploadProgressState {
  byMessageId: Record<string, PendingUpload[]>
  startUpload: (messageId: string, fileName: string, size: number) => void
  updateProgress: (messageId: string, fileName: string, loaded: number) => void
  finishUpload: (messageId: string, fileName: string) => void
  failUpload: (messageId: string, fileName: string, error: string) => void
  clearMessage: (messageId: string) => void
  reset: () => void
}

export const useUploadProgressStore = create<UploadProgressState>((set) => ({
  byMessageId: {},

  startUpload: (messageId, fileName, size) =>
    set((s) => ({
      byMessageId: {
        ...s.byMessageId,
        [messageId]: [
          ...(s.byMessageId[messageId] ?? []).filter((u) => u.fileName !== fileName),
          { fileName, size, loaded: 0 },
        ],
      },
    })),

  updateProgress: (messageId, fileName, loaded) =>
    set((s) => {
      const list = s.byMessageId[messageId]
      if (!list) return s
      return {
        byMessageId: {
          ...s.byMessageId,
          [messageId]: list.map((u) =>
            u.fileName === fileName ? { ...u, loaded } : u,
          ),
        },
      }
    }),

  finishUpload: (messageId, fileName) =>
    set((s) => {
      const remaining = (s.byMessageId[messageId] ?? []).filter(
        (u) => u.fileName !== fileName,
      )
      const next = { ...s.byMessageId }
      if (remaining.length === 0) delete next[messageId]
      else next[messageId] = remaining
      return { byMessageId: next }
    }),

  failUpload: (messageId, fileName, error) =>
    set((s) => {
      const list = s.byMessageId[messageId]
      if (!list) return s
      return {
        byMessageId: {
          ...s.byMessageId,
          [messageId]: list.map((u) =>
            u.fileName === fileName ? { ...u, error } : u,
          ),
        },
      }
    }),

  clearMessage: (messageId) =>
    set((s) => {
      const next = { ...s.byMessageId }
      delete next[messageId]
      return { byMessageId: next }
    }),

  reset: () => set({ byMessageId: {} }),
}))
