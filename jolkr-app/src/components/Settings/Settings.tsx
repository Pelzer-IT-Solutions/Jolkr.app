import {
  User, Shield, Link, Palette, Accessibility,
  Mic, Bell, Keyboard, Globe, Camera,
} from 'lucide-react'
import { useMemo, useState, useEffect, useRef } from 'react'
import * as api from '../../api/client'
import { useLocalStorageBoolean } from '../../hooks/useLocalStorageBoolean'
import { useT } from '../../hooks/useT'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n/types'
import { ensureNotificationPermission } from '../../services/notifications'
import { useAuthStore } from '../../stores/auth'
import { useLocaleStore } from '../../stores/locale'
import { useToast } from '../../stores/toast'
import { STORAGE_KEYS } from '../../utils/storageKeys'
import {
  voicePrefs, useVoiceMediaDevices, useOutputSinkSupported,
} from '../../voice/voicePrefs'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import { Select } from '../ui/Select'
import s from './Settings.module.css'
import type { DmFilter } from '../../api/types'
import type { ColorPreference } from '../../utils/colorMode'

type Section =
  | 'account' | 'privacy' | 'connections'
  | 'appearance' | 'accessibility' | 'voice' | 'notifications' | 'keybinds' | 'language'

interface UserInfo {
  displayName:  string
  username:     string
  email:        string
  avatarLetter: string
  avatarColor:  string
  avatarUrl?:   string | null
  bio?:         string
  bannerColor?: string
}

interface Props {
  onClose:       () => void
  isDark:        boolean
  colorPref:     ColorPreference
  onSetColorPref:(pref: ColorPreference) => void
  user?:         UserInfo
  onLogout?:     () => void
  onUpdateProfile?: (data: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string }) => Promise<void>
  onUploadAvatar?:  (file: File) => Promise<string>
}

export function Settings({ onClose, isDark, colorPref, onSetColorPref, user, onLogout, onUpdateProfile, onUploadAvatar }: Props) {
  const { t } = useT()
  const [section, setSection] = useState<Section>('account')

  const navGroups = useMemo<SettingsNavGroup<Section>[]>(() => [
    {
      group: t('settings.nav.userSettings'),
      items: [
        { id: 'account',     label: t('settings.nav.account'),     icon: <User       size={15} strokeWidth={1.5} /> },
        { id: 'privacy',     label: t('settings.nav.privacy'),     icon: <Shield     size={15} strokeWidth={1.5} /> },
        { id: 'connections', label: t('settings.nav.connections'), icon: <Link       size={15} strokeWidth={1.5} /> },
      ],
    },
    {
      group: t('settings.nav.appSettings'),
      items: [
        { id: 'appearance',    label: t('settings.nav.appearance'),    icon: <Palette       size={15} strokeWidth={1.5} /> },
        { id: 'accessibility', label: t('settings.nav.accessibility'), icon: <Accessibility size={15} strokeWidth={1.5} /> },
        { id: 'voice',         label: t('settings.nav.voice'),         icon: <Mic           size={15} strokeWidth={1.5} /> },
        { id: 'notifications', label: t('settings.nav.notifications'), icon: <Bell          size={15} strokeWidth={1.5} /> },
        { id: 'keybinds',      label: t('settings.nav.keybinds'),      icon: <Keyboard      size={15} strokeWidth={1.5} /> },
        { id: 'language',      label: t('settings.nav.language'),      icon: <Globe         size={15} strokeWidth={1.5} /> },
      ],
    },
  ], [t])

  return (
    <SettingsShell
      section={section}
      onSection={setSection}
      onClose={onClose}
      navGroups={navGroups}
    >
      <SectionContent
        section={section}
        isDark={isDark}
        colorPref={colorPref}
        onSetColorPref={onSetColorPref}
        user={user}
        onLogout={onLogout}
        onClose={onClose}
        onUpdateProfile={onUpdateProfile}
        onUploadAvatar={onUploadAvatar}
      />
    </SettingsShell>
  )
}

/* ── Section renderer ── */
function SectionContent({ section, isDark, colorPref, onSetColorPref, user, onLogout, onClose, onUpdateProfile, onUploadAvatar }: {
  section:        Section
  isDark:         boolean
  colorPref:      ColorPreference
  onSetColorPref: (pref: ColorPreference) => void
  user?:          UserInfo
  onLogout?:      () => void
  onClose:        () => void
  onUpdateProfile?: (data: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string }) => Promise<void>
  onUploadAvatar?:  (file: File) => Promise<string>
}) {
  switch (section) {
    case 'account':     return <AccountSection user={user} onLogout={onLogout} onClose={onClose} onUpdateProfile={onUpdateProfile} onUploadAvatar={onUploadAvatar} />
    case 'privacy':     return <PrivacySection />
    case 'connections': return <ConnectionsSection />
    case 'appearance':  return <AppearanceSection isDark={isDark} colorPref={colorPref} onSetColorPref={onSetColorPref} />
    case 'accessibility':return <AccessibilitySection />
    case 'voice':       return <VoiceSection />
    case 'notifications':return <NotificationsSection />
    case 'keybinds':    return <KeybindsSection />
    case 'language':    return <LanguageSection />
  }
}

// `nameKey` resolves through `settings.bannerColors.*` so the swatch tooltip is locale-aware; `value` is OKLCH and stays language-neutral.
const BANNER_COLORS = [
  { nameKey: 'sage',  value: 'oklch(60% 0.1 136)' },
  { nameKey: 'gold',  value: 'oklch(65% 0.12 85)' },
  { nameKey: 'ocean', value: 'oklch(60% 0.12 215)' },
  { nameKey: 'royal', value: 'oklch(55% 0.18 280)' },
  { nameKey: 'berry', value: 'oklch(55% 0.18 340)' },
  { nameKey: 'coral', value: 'oklch(60% 0.15 25)' },
] as const

function AccountSection({ user, onLogout, onClose, onUpdateProfile, onUploadAvatar }: {
  user?: UserInfo
  onLogout?: () => void
  onClose: () => void
  onUpdateProfile?: (data: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string }) => Promise<void>
  onUploadAvatar?: (file: File) => Promise<string>
}) {
  const { t } = useT()
  const [isEditing, setIsEditing] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  // Overlay-shaped edits. Render reads `editedProfile.X ?? user.X` so the
  // panel always shows the freshest server prop until the user touches a
  // field. Save/Cancel just clear the overlay — no userKey-prev mirror needed.
  const [editedProfile, setEditedProfile] = useState<Partial<{
    display_name: string
    bio:          string
    banner_color: string
    avatar_url:   string | null
  }>>({})
  // S3 key from upload — only persisted on Save, discarded on Cancel
  const [pendingAvatarKey, setPendingAvatarKey] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Render values: overlay → prop fallback.
  const displayName = editedProfile.display_name ?? user?.displayName ?? ''
  const bio         = editedProfile.bio          ?? user?.bio          ?? ''
  const bannerColor = editedProfile.banner_color ?? user?.bannerColor ?? user?.avatarColor ?? ''
  const avatarUrl   = editedProfile.avatar_url !== undefined
    ? editedProfile.avatar_url
    : (user?.avatarUrl ?? null)

  const handleSave = async () => {
    try {
      const payload: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string } = {}
      if (editedProfile.display_name !== undefined) payload.display_name = editedProfile.display_name
      if (editedProfile.bio !== undefined) payload.bio = editedProfile.bio
      if (editedProfile.banner_color !== undefined) payload.banner_color = editedProfile.banner_color
      if (pendingAvatarKey) payload.avatar_url = pendingAvatarKey
      await onUpdateProfile?.(payload)
      setEditedProfile({})
      setPendingAvatarKey(null)
      setIsEditing(false)
      setShowColorPicker(false)
    } catch (e) {
      console.error('Failed to update profile:', e)
    }
  }

  const handleCancel = () => {
    // Discard pending avatar — it was only uploaded to S3, not saved to profile
    setPendingAvatarKey(null)
    setEditedProfile({})
    setIsEditing(false)
    setShowColorPicker(false)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file)
    setEditedProfile(p => ({ ...p, avatar_url: previewUrl }))
    try {
      const key = await onUploadAvatar?.(file)
      if (key) setPendingAvatarKey(key)
    } catch (err) {
      console.error('Avatar upload failed:', err)
      URL.revokeObjectURL(previewUrl)
      setPendingAvatarKey(null)
      // Drop the avatar overlay so render falls back to the user prop.
      setEditedProfile(p => {
        const { avatar_url: _, ...rest } = p
        return rest
      })
    }
  }

  const handleBannerColorChange = (color: string) => {
    setEditedProfile(p => ({ ...p, banner_color: color }))
    setShowColorPicker(false)
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.account.title')}</h2>

      {/* Enhanced Profile Preview Card */}
      <div className={s.profilePreviewCard}>
        {/* Actions Bar */}
        <div className={s.profileActions}>
          {/* Color Picker - Only visible when editing */}
          {isEditing && (
            <div className={s.colorPickerInline}>
              <button
                className={`${s.colorPickerBtn} ${showColorPicker ? s.colorPickerActive : ''}`}
                onClick={() => setShowColorPicker(!showColorPicker)}
                title={t('settings.account.changeBannerColor')}
              >
                <Palette size={16} strokeWidth={1.5} />
              </button>
              {showColorPicker && (
                <div className={s.colorPickerSwatchesInline}>
                  {BANNER_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`${s.colorPickerSwatch} ${bannerColor === c.value ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: c.value }}
                      onClick={() => handleBannerColorChange(c.value)}
                      title={t(`settings.bannerColors.${c.nameKey}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit Button */}
          {isEditing ? (
            <div className={s.editActions}>
              <button className={s.cancelEditBtn} onClick={handleCancel}>{t('common.cancel')}</button>
              <button className={s.saveEditBtn} onClick={handleSave}>{t('common.save')}</button>
            </div>
          ) : (
            <button className={s.editProfileBtn} onClick={() => setIsEditing(true)}>
              {t('settings.account.editProfile')}
            </button>
          )}
        </div>

        {/* Banner */}
        <div className={s.previewBanner} style={{ background: bannerColor }} />

        {/* Profile Content */}
        <div className={s.previewContent}>
          {/* Avatar - Click to change only when editing */}
          <div className={s.previewAvatarWrap} onClick={isEditing ? () => fileInputRef.current?.click() : undefined} style={isEditing ? { cursor: 'pointer' } : undefined}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
            <div className={s.previewAvatar} style={{ background: bannerColor }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={t('settings.account.profileAlt')} className={s.previewAvatarImg} />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            {isEditing && (
              <div className={s.avatarChangeOverlay}>
                <Camera size={20} strokeWidth={1.5} />
              </div>
            )}
          </div>

          {/* Profile Info */}
          <div className={s.previewInfo}>
            {isEditing ? (
              <>
                <div className={s.editFieldGroup}>
                  <label className={s.editLabel}>{t('settings.account.displayName')}</label>
                  <input
                    type="text"
                    className={s.editInput}
                    value={displayName}
                    onChange={(e) => setEditedProfile(p => ({ ...p, display_name: e.target.value }))}
                    placeholder={t('settings.account.displayNamePlaceholder')}
                  />
                </div>
                <div className={s.editFieldGroup}>
                  <label className={s.editLabel}>{t('settings.account.username')}</label>
                  <span className={s.editReadonly}>{user?.username}</span>
                </div>
              </>
            ) : (
              <>
                <h3 className={s.previewDisplayName}>{displayName}</h3>
                <p className={s.previewUsername}>{user?.username}</p>
              </>
            )}

            <div className={s.previewDivider} />

            {isEditing ? (
              <div className={s.editFieldGroup}>
                <label className={s.editLabel}>{t('settings.account.bio')}</label>
                <textarea
                  className={s.editTextarea}
                  value={bio}
                  onChange={(e) => setEditedProfile(p => ({ ...p, bio: e.target.value }))}
                  placeholder={t('settings.account.bioPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
            ) : (
              <p className={s.previewBio}>{bio || t('settings.account.noBio')}</p>
            )}
          </div>

        </div>
      </div>

      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.account.accountInfo')}</h3>
      <div className={s.simpleField}>
        <span className={s.simpleFieldLabel}>{t('settings.account.emailLabel')}</span>
        <div className={s.simpleFieldValueWrap}>
          <span className={s.simpleFieldValue}>{t('settings.account.emailMasked')}</span>
          <button className={s.simpleFieldEdit}>{t('common.edit')}</button>
        </div>
      </div>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.account.passwordSection')}</h3>
      <p className={`${s.helpText} txt-small`}>{t('settings.account.passwordHelp')}</p>
      <div className={s.rowBtns}>
        <OutlineBtn>{t('settings.account.changePassword')}</OutlineBtn>
        <OutlineBtn>{t('settings.account.enable2FA')}</OutlineBtn>
      </div>

      <Divider />
      <div className={s.rowBtns}>
        <OutlineBtn onClick={() => { onLogout?.(); onClose() }}>{t('settings.account.logOut')}</OutlineBtn>
      </div>

      <Divider />
      <h3 className={`${s.subTitle} ${s.danger} txt-small txt-semibold`}>{t('settings.account.dangerZone')}</h3>
      <p className={`${s.helpText} txt-small`}>{t('settings.account.deleteHelp')}</p>
      <DangerBtn>{t('settings.account.deleteAccount')}</DangerBtn>
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Privacy & Safety
───────────────────────────────────────── */
function PrivacySection() {
  const { t } = useT()
  const user = useAuthStore(s => s.user)
  const updateProfile = useAuthStore(s => s.updateProfile)

  // Defaults match the server's defaults (all / true / true). When the user
  // object hasn't loaded yet we still render — values are corrected on the
  // first render after `user` becomes available.
  const dmFilter: DmFilter = user?.dm_filter ?? 'all'
  const friendReqs = user?.allow_friend_requests ?? true
  const readReceipts = user?.show_read_receipts ?? true
  // Local-only until a telemetry SDK ships; toggle is wired but persists nothing.
  const [analytics, setAnalytics] = useState(false)

  const setDmFilter = (v: DmFilter) =>
    updateProfile({ dm_filter: v }).catch(console.warn)
  const setFriendReqs = (v: boolean) =>
    updateProfile({ allow_friend_requests: v }).catch(console.warn)
  const setReadReceipts = (v: boolean) =>
    updateProfile({ show_read_receipts: v }).catch(console.warn)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.privacy.title')}</h2>

      <SettingBlock title={t('settings.privacy.dmFilterTitle')} description={t('settings.privacy.dmFilterDesc')}>
        <RadioGroup
          value={dmFilter}
          onChange={setDmFilter}
          options={[
            { value: 'all',     label: t('settings.privacy.dmAll') },
            { value: 'friends', label: t('settings.privacy.dmFriends') },
            { value: 'none',    label: t('settings.privacy.dmNone') },
          ]}
        />
      </SettingBlock>

      <Divider />
      <ToggleRow label={t('settings.privacy.allowFriendReqsLabel')} description={t('settings.privacy.allowFriendReqsDesc')} value={friendReqs} onChange={setFriendReqs} />
      <ToggleRow label={t('settings.privacy.readReceiptsLabel')}    description={t('settings.privacy.readReceiptsDesc')}  value={readReceipts} onChange={setReadReceipts} />

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.privacy.dataPrivacy')}</h3>
      <ToggleRow label={t('settings.privacy.analyticsLabel')} description={t('settings.privacy.analyticsDesc')} value={analytics} onChange={setAnalytics} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Connections
───────────────────────────────────────── */
// Service `name` is a brand and stays untranslated; `descKey` looks up the
// category label under `settings.connections.*`.
const SERVICES = [
  { name: 'Spotify',  icon: '🎵', descKey: 'music' },
  { name: 'Steam',    icon: '🎮', descKey: 'gaming' },
  { name: 'GitHub',   icon: '💻', descKey: 'development' },
  { name: 'Twitch',   icon: '📺', descKey: 'streaming' },
  { name: 'YouTube',  icon: '▶️', descKey: 'video' },
  { name: 'Twitter',  icon: '🐦', descKey: 'social' },
] as const

function ConnectionsSection() {
  const { t } = useT()
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.connections.title')}</h2>
      <p className={`${s.helpText} txt-small`}>{t('settings.connections.intro')}</p>
      <div className={s.connectionGrid}>
        {SERVICES.map(svc => (
          <button key={svc.name} className={s.connectionTile}>
            <span className={s.connectionIcon}>{svc.icon}</span>
            <span className={`${s.connectionName} txt-small txt-medium`}>{svc.name}</span>
            <span className={`${s.connectionDesc} txt-tiny`}>{t(`settings.connections.${svc.descKey}`)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Appearance
───────────────────────────────────────── */
function AppearanceSection({ isDark: _isDark, colorPref, onSetColorPref }: {
  isDark: boolean; colorPref: ColorPreference; onSetColorPref: (p: ColorPreference) => void
}) {
  const { t } = useT()
  const [display, setDisplay]   = useState<'cozy' | 'compact'>('cozy')
  const [fontSize, setFontSize] = useState(16)

  const colorModeLabel = (p: ColorPreference) =>
    p === 'light'  ? `☀️  ${t('settings.appearance.colorModeLight')}`
    : p === 'system' ? `⚙️  ${t('settings.appearance.colorModeSystem')}`
    : `🌙  ${t('settings.appearance.colorModeDark')}`

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.appearance.title')}</h2>

      <SettingBlock title={t('settings.appearance.colorModeTitle')} description={t('settings.appearance.colorModeDesc')}>
        <div className={s.segmentControl}>
          {(['light', 'system', 'dark'] as ColorPreference[]).map(p => (
            <button
              key={p}
              className={`${s.segment} ${colorPref === p ? s.segmentActive : ''}`}
              onClick={() => onSetColorPref(p)}
            >
              {colorModeLabel(p)}
            </button>
          ))}
        </div>
      </SettingBlock>

      <Divider />
      <SettingBlock title={t('settings.appearance.messageDisplayTitle')} description={t('settings.appearance.messageDisplayDesc')}>
        <RadioGroup
          value={display}
          onChange={setDisplay}
          options={[
            { value: 'cozy',    label: t('settings.appearance.displayCozy') },
            { value: 'compact', label: t('settings.appearance.displayCompact') },
          ]}
        />
      </SettingBlock>

      <Divider />
      <SettingBlock title={t('settings.appearance.fontSizeTitle', { size: fontSize })} description={t('settings.appearance.fontSizeDesc')}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>12</span>
          <input type="range" min={12} max={20} step={1} value={fontSize}
            onChange={e => setFontSize(+e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>20</span>
        </div>
      </SettingBlock>
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Accessibility
───────────────────────────────────────── */
function AccessibilitySection() {
  const { t } = useT()
  const [reducedMotion, setReducedMotion] = useState(false)
  const [highContrast,  setHighContrast]  = useState(false)
  const [roleColors,    setRoleColors]    = useState(true)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.accessibility.title')}</h2>
      <ToggleRow label={t('settings.accessibility.reducedMotionLabel')} description={t('settings.accessibility.reducedMotionDesc')} value={reducedMotion} onChange={setReducedMotion} />
      <ToggleRow label={t('settings.accessibility.highContrastLabel')}  description={t('settings.accessibility.highContrastDesc')}  value={highContrast}  onChange={setHighContrast} />
      <ToggleRow label={t('settings.accessibility.roleColorsLabel')}    description={t('settings.accessibility.roleColorsDesc')}    value={roleColors}    onChange={setRoleColors} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Voice & Video
───────────────────────────────────────── */
function VoiceSection() {
  const { t } = useT()
  const { audioInputs, audioOutputs, videoInputs } = useVoiceMediaDevices()
  const sinkSupported = useOutputSinkSupported()

  // Read once into local state and write back through the helper so changes
  // are persisted AND broadcast to an active call via voicePrefs.
  const [prefs, setPrefs] = useState(() => voicePrefs.get())
  useEffect(() => voicePrefs.subscribe(setPrefs), [])

  const set = <K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) =>
    voicePrefs.set(key, value)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.voice.title')}</h2>

      <SettingBlock title={t('settings.voice.inputDevice')}>
        <Select
          className={s.selectMaxWidth}
          value={prefs.audioInputDeviceId}
          onChange={(e) => set('audioInputDeviceId', e.target.value)}
        >
          <option value="">{t('settings.voice.systemDefault')}</option>
          {audioInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settings.voice.microphoneFallback', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </Select>
      </SettingBlock>
      <SettingBlock title={t('settings.voice.inputVolume', { volume: prefs.inputVolume })}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={prefs.inputVolume}
            onChange={(e) => set('inputVolume', +e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <SettingBlock
        title={t('settings.voice.outputDevice')}
        description={sinkSupported ? undefined : t('settings.voice.outputUnsupported')}
      >
        <Select
          className={s.selectMaxWidth}
          value={prefs.audioOutputDeviceId}
          onChange={(e) => set('audioOutputDeviceId', e.target.value)}
          disabled={!sinkSupported}
          title={sinkSupported ? undefined : t('settings.voice.outputUnsupportedTitle')}
        >
          <option value="">{t('settings.voice.systemDefault')}</option>
          {audioOutputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settings.voice.speakersFallback', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </Select>
      </SettingBlock>
      <SettingBlock title={t('settings.voice.outputVolume', { volume: prefs.outputVolume })}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={prefs.outputVolume}
            onChange={(e) => set('outputVolume', +e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.voice.cameraSection')}</h3>
      <SettingBlock title={t('settings.voice.cameraDevice')}>
        <Select
          className={s.selectMaxWidth}
          value={prefs.videoInputDeviceId}
          onChange={(e) => set('videoInputDeviceId', e.target.value)}
        >
          <option value="">{t('settings.voice.systemDefault')}</option>
          {videoInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('settings.voice.cameraFallback', { id: d.deviceId.slice(0, 6) })}
            </option>
          ))}
        </Select>
        <CameraPreview deviceId={prefs.videoInputDeviceId} />
      </SettingBlock>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.voice.advancedSection')}</h3>
      <ToggleRow label={t('settings.voice.noiseSuppressionLabel')} description={t('settings.voice.noiseSuppressionDesc')} value={prefs.noiseSuppression} onChange={(v) => set('noiseSuppression', v)} />
      <ToggleRow label={t('settings.voice.echoCancellationLabel')} description={t('settings.voice.echoCancellationDesc')} value={prefs.echoCancellation} onChange={(v) => set('echoCancellation', v)} />
      <ToggleRow label={t('settings.voice.autoGainLabel')}         description={t('settings.voice.autoGainDesc')}         value={prefs.autoGainControl}  onChange={(v) => set('autoGainControl', v)} />
    </div>
  )
}

/**
 * Live preview of the selected camera. Acquires its own MediaStream so it
 * doesn't conflict with an active call, and stops the stream as soon as the
 * Settings dialog closes (component unmount).
 */
function CameraPreview({ deviceId }: { deviceId: string }) {
  const { t } = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    // Capture the videoRef DOM node at effect-setup time so the cleanup uses
    // the same node it attached to, even if the ref points elsewhere later.
    const node = videoRef.current

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
    }).then((stm) => {
      if (cancelled) { stm.getTracks().forEach((t) => t.stop()); return }
      stream = stm
      if (node) node.srcObject = stm
      setError(null)
    }).catch((e: Error) => {
      if (!cancelled) setError(e.message || t('settings.voice.cameraUnavailable'))
    })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (node) node.srcObject = null
    }
  }, [deviceId, t])

  return (
    <div className={s.cameraPreview}>
      {error
        ? <div className={s.cameraPreviewError}>{error}</div>
        : <video ref={videoRef} className={s.cameraPreviewVideo} autoPlay playsInline muted />
      }
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Notifications
───────────────────────────────────────── */
function NotificationsSection() {
  const { t } = useT()
  const showToast = useToast(s => s.show)
  const [desktop,  setDesktop]  = useLocalStorageBoolean(STORAGE_KEYS.DESKTOP_NOTIF, true)
  const [sounds,   setSounds]   = useLocalStorageBoolean(STORAGE_KEYS.SOUND_ENABLED, true)
  const [mentions, setMentions] = useLocalStorageBoolean(STORAGE_KEYS.MENTION_NOTIF, true)
  const [dms,      setDms]      = useLocalStorageBoolean(STORAGE_KEYS.DM_NOTIF, true)
  const [badge,    setBadge]    = useLocalStorageBoolean(STORAGE_KEYS.UNREAD_BADGE, true)

  const onDesktopChange = async (v: boolean) => {
    setDesktop(v)
    if (!v) return
    const result = await ensureNotificationPermission()
    if (result === 'denied') {
      showToast(t('settings.notifications.permissionDeniedToast'), 'error', 6000)
    } else if (result === 'unsupported') {
      showToast(t('settings.notifications.unsupportedToast'), 'info', 4000)
    }
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.notifications.title')}</h2>
      <ToggleRow label={t('settings.notifications.desktopLabel')} description={t('settings.notifications.desktopDesc')} value={desktop}  onChange={onDesktopChange} />
      <ToggleRow label={t('settings.notifications.soundsLabel')}  description={t('settings.notifications.soundsDesc')}  value={sounds}   onChange={setSounds} />

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>{t('settings.notifications.triggers')}</h3>
      <ToggleRow label={t('settings.notifications.mentionsLabel')} description={t('settings.notifications.mentionsDesc')} value={mentions} onChange={setMentions} />
      <ToggleRow label={t('settings.notifications.dmsLabel')}      description={t('settings.notifications.dmsDesc')}      value={dms}      onChange={setDms} />
      <ToggleRow label={t('settings.notifications.badgeLabel')}    description={t('settings.notifications.badgeDesc')}    value={badge}    onChange={setBadge} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Keybinds
───────────────────────────────────────── */
// `actionKey` looks up the localised label under `settings.keybinds.*`; the
// key glyphs (⌘/Shift/Escape/etc.) are platform-conventional and stay literal.
const KEYBINDS = [
  { actionKey: 'openSwitcher',   keys: ['⌘', 'K'] },
  { actionKey: 'toggleMute',     keys: ['⌘', 'Shift', 'M'] },
  { actionKey: 'toggleDeafen',   keys: ['⌘', 'Shift', 'D'] },
  { actionKey: 'markRead',       keys: ['Escape'] },
  { actionKey: 'jumpUnread',     keys: ['⌘', 'Shift', 'U'] },
  { actionKey: 'uploadFile',     keys: ['⌘', 'Shift', 'F'] },
  { actionKey: 'search',         keys: ['⌘', 'F'] },
  { actionKey: 'focusInput',     keys: ['⌘', 'L'] },
  { actionKey: 'editLast',       keys: ['↑'] },
  { actionKey: 'replyMessage',   keys: ['R'] },
  { actionKey: 'toggleSettings', keys: ['⌘', ','] },
] as const

function KeybindsSection() {
  const { t } = useT()
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.keybinds.title')}</h2>
      <p className={`${s.helpText} txt-small`}>{t('settings.keybinds.intro')}</p>
      <div className={s.keybindList}>
        {KEYBINDS.map(kb => (
          <div key={kb.actionKey} className={s.keybindRow}>
            <span className={`${s.keybindAction} txt-small`}>{t(`settings.keybinds.${kb.actionKey}`)}</span>
            <div className={s.keybindKeys}>
              {/* index keys are safe — KEYBINDS is a compile-time constant. */}
              {kb.keys.map((k, i) => <kbd key={i} className={s.key}>{k}</kbd>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Language
───────────────────────────────────────── */
function LanguageSection() {
  const { t } = useT()
  const code = useLocaleStore(s => s.code)
  const setLocale = useLocaleStore(s => s.setLocale)
  const showToast = useToast(s => s.show)

  // Optimistic switch — flip the FE locale immediately, then PATCH /users/@me
  // so it syncs across devices via the WS UserUpdate fan-out. PATCH errors
  // surface as a toast but the local choice stays (per design — "rollback
  // would feel broken"); the next successful save reconciles.
  const handleChange = async (next: LocaleCode) => {
    if (next === code) return
    await setLocale(next)
    try {
      await api.updateMe({ preferred_language: next })
    } catch (e) {
      console.warn('Failed to persist preferred_language:', e)
      showToast(t('settings.language.saveError'), 'error')
    }
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>{t('settings.language.title')}</h2>
      <SettingBlock title={t('settings.language.displayTitle')} description={t('settings.language.displayDesc')}>
        <Select
          className={s.selectMaxWidth}
          value={code}
          onChange={e => handleChange(e.target.value as LocaleCode)}
        >
          {SUPPORTED_LOCALES.map(c => (
            <option key={c} value={c}>{LOCALE_LABELS[c]}</option>
          ))}
        </Select>
      </SettingBlock>
    </div>
  )
}

/* ─────────────────────────────────────────
   Shared UI primitives
───────────────────────────────────────── */
function Divider() { return <div className={s.divider} /> }

function SettingBlock({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className={s.settingBlock}>
      <div className={s.settingBlockHeader}>
        <span className={`${s.settingBlockTitle} txt-small txt-semibold`}>{title}</span>
        {description && <p className={`${s.settingBlockDesc} txt-small`}>{description}</p>}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className={s.toggleRow}>
      <div className={s.toggleMeta}>
        <span className={`${s.toggleLabel} txt-small txt-medium`}>{label}</span>
        {description && <p className={`${s.toggleDesc} txt-tiny`}>{description}</p>}
      </div>
      <button
        className={`${s.toggle} ${value ? s.toggleOn : ''}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      >
        <span className={s.toggleThumb} />
      </button>
    </div>
  )
}

function RadioGroup<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return (
    <div className={s.radioGroup}>
      {options.map(opt => (
        <label key={opt.value} className={s.radioLabel}>
          <input
            type="radio"
            name="radio"
            className={s.radioInput}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className={s.radioCircle} />
          <span className={`${s.radioText} txt-small`}>{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

function OutlineBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button className={s.outlineBtn} onClick={onClick}>{children}</button>
}

function DangerBtn({ children }: { children: React.ReactNode }) {
  return <button className={s.dangerBtn}>{children}</button>
}
