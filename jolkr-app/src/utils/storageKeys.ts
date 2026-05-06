/**
 * Centralised storage keys for both `localStorage` / `sessionStorage` and
 * the secure-storage abstraction (`platform/storage.ts`, which routes to
 * Stronghold on Tauri desktop).
 *
 * Keys without a `jolkr_` prefix are accessed via `platform/storage`
 * (Stronghold-aware); keys with a `jolkr_` prefix are plain web storage.
 */
export const STORAGE_KEYS = {
  // ── Auth flags (localStorage) ────────────────────────────────────
  LOGGED_OUT_FLAG: 'jolkr_logged_out',

  // ── E2EE ─────────────────────────────────────────────────────────
  E2EE_DEVICE_ID: 'jolkr_e2ee_device_id',           // localStorage
  E2EE_SEED: 'e2ee_seed',                           // via platform/storage (Stronghold on Tauri)
  E2EE_KEYS_UPLOADED: 'e2ee_keys_uploaded',         // via platform/storage
  E2EE_SEED_LEGACY: 'jolkr_e2ee_seed',              // legacy plain-localStorage; migration only

  // ── Sound & notifications (localStorage) ─────────────────────────
  RINGTONE: 'jolkr_ringtone',
  SOUND_ENABLED: 'jolkr_sound',
  DESKTOP_NOTIF: 'jolkr_desktop_notif',
  MENTION_NOTIF: 'jolkr_mention_notif',
  DM_NOTIF: 'jolkr_dm_notif',
  UNREAD_BADGE: 'jolkr_unread_badge',

  // ── Voice & video (localStorage, per-device) ─────────────────────
  AUDIO_INPUT_DEVICE:  'jolkr_audio_input_device',
  AUDIO_OUTPUT_DEVICE: 'jolkr_audio_output_device',
  VIDEO_INPUT_DEVICE:  'jolkr_video_input_device',
  INPUT_VOLUME:        'jolkr_input_volume',
  OUTPUT_VOLUME:       'jolkr_output_volume',
  NOISE_SUPPRESSION:   'jolkr_noise_suppression',
  ECHO_CANCELLATION:   'jolkr_echo_cancellation',
  AUTO_GAIN_CONTROL:   'jolkr_auto_gain_control',

  // ── Push (localStorage) ──────────────────────────────────────────
  PUSH_DEVICE_ID: 'jolkr_push_device_id',

  // ── Unread (localStorage) ────────────────────────────────────────
  LAST_SEEN: 'jolkr_last_seen',

  // ── Theme & UI (localStorage) ────────────────────────────────────
  COLOR_MODE: 'jolkr_color_mode',                   // migrated from 'jolkr-color-mode'
  CALL_PIP_LAYOUT: 'jolkr_call_pip_layout',         // migrated from 'call.pip.layout'

  // ── sessionStorage (transient / cross-page) ──────────────────────
  PENDING_INVITE: 'jolkr_pending_invite',
  PENDING_ADD_FRIEND: 'jolkr_pending_add_friend',

  // ── Internal — Stronghold vault password (sessionStorage on web) ─
  VAULT_PASSWORD: 'jolkr_vault_key',

  // ── Internal — vault rotation marker (SEC-011, 2026-05-04) ───────
  // Presence of this key signals the legacy `'io.jolkr.app'` snapshot
  // has been deleted and a fresh per-install vault has been opened.
  // Set once after a successful first-init; checked in `_init()` to
  // gate the one-shot delete.
  VAULT_MIGRATION_V2: 'jolkr_vault_migration_v2',
} as const;

/** Legacy storage-key migrations applied once at app boot. */
const LEGACY_KEY_MIGRATIONS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'jolkr-color-mode', to: STORAGE_KEYS.COLOR_MODE },
  { from: 'call.pip.layout', to: STORAGE_KEYS.CALL_PIP_LAYOUT },
];

/**
 * Migrate legacy storage keys (kebab/dotted naming) to canonical
 * `jolkr_snake_case` names. Idempotent and best-effort: silently skips
 * if `localStorage` is unavailable (private mode etc.).
 */
export function migrateLegacyStorageKeys(): void {
  try {
    for (const { from, to } of LEGACY_KEY_MIGRATIONS) {
      const old = localStorage.getItem(from);
      if (old !== null && localStorage.getItem(to) === null) {
        localStorage.setItem(to, old);
      }
      localStorage.removeItem(from);
    }
  } catch {
    /* localStorage disabled — migration is best-effort */
  }
}
