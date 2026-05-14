import { create } from 'zustand'
import { getNotificationSettings, updateNotificationSetting } from '../api/client'
import { wsClient } from '../api/ws'
import type { NotificationSetting } from '../api/types'

type TargetType = 'server' | 'channel'

interface NotificationSettingsState {
  settings: NotificationSetting[]
  isLoaded: boolean
  load: () => Promise<void>
  applyUpdate: (targetType: TargetType, targetId: string, setting: NotificationSetting | null) => void
  setMuted: (targetType: TargetType, targetId: string, muted: boolean) => void
  reset: () => void
}

function upsertOrDrop(
  settings: NotificationSetting[],
  targetType: TargetType,
  targetId: string,
  next: NotificationSetting | null,
): NotificationSetting[] {
  const without = settings.filter(s => !(s.target_type === targetType && s.target_id === targetId))
  if (!next) return without
  if (!next.muted && !next.suppress_everyone) return without
  return [...without, next]
}

export const useNotificationSettingsStore = create<NotificationSettingsState>((set, get) => ({
  settings: [],
  isLoaded: false,

  reset: () => set({ settings: [], isLoaded: false }),

  load: async () => {
    if (get().isLoaded) return
    try {
      const settings = await getNotificationSettings()
      set({ settings, isLoaded: true })
    } catch {
      set({ isLoaded: true })
    }
  },

  applyUpdate: (targetType, targetId, setting) => {
    set(state => ({ settings: upsertOrDrop(state.settings, targetType, targetId, setting) }))
  },

  setMuted: (targetType, targetId, muted) => {
    const { settings } = get()
    const prev = settings.find(s => s.target_type === targetType && s.target_id === targetId) ?? null
    const optimistic: NotificationSetting = {
      target_type: targetType,
      target_id: targetId,
      muted,
      mute_until: prev?.mute_until ?? null,
      suppress_everyone: prev?.suppress_everyone ?? false,
    }
    set({ settings: upsertOrDrop(settings, targetType, targetId, optimistic) })
    updateNotificationSetting(targetType, targetId, {
      muted,
      mute_until: optimistic.mute_until,
      suppress_everyone: optimistic.suppress_everyone,
    })
      .then(server => {
        set(state => ({ settings: upsertOrDrop(state.settings, targetType, targetId, server) }))
      })
      .catch(() => {
        set(state => ({ settings: upsertOrDrop(state.settings, targetType, targetId, prev) }))
      })
  },
}))

/** Selector — array of server ids the current user has muted. Stable across
 *  renders only if you wrap with `useShallow`; raw use returns a fresh array. */
export function selectMutedServerIds(state: NotificationSettingsState): string[] {
  return state.settings
    .filter(s => s.target_type === 'server' && s.muted)
    .map(s => s.target_id)
}

// Module-level WS bridge — keeps the store fresh when another session of the
// same user toggles a setting. `setting` absent means the BE deleted the row
// (defaults restored).
wsClient.on(ev => {
  if (ev.op !== 'NotificationSettingUpdate') return
  const { target_type, target_id, setting } = ev.d
  if (target_type !== 'server' && target_type !== 'channel') return
  useNotificationSettingsStore.getState().applyUpdate(
    target_type,
    target_id,
    setting
      ? { target_type, target_id, muted: setting.muted, mute_until: setting.mute_until, suppress_everyone: setting.suppress_everyone }
      : null,
  )
})
