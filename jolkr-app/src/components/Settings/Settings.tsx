import { useState, useEffect, useRef } from 'react'
import {
  User, Shield, Link, Palette, Accessibility,
  Mic, Bell, Keyboard, Globe, Camera,
} from 'lucide-react'
import type { ColorPreference } from '../../utils/colorMode'
import type { DmFilter } from '../../api/types'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import { Select } from '../ui/Select'
import { useAuthStore } from '../../stores/auth'
import { useLocaleStore } from '../../stores/locale'
import { useToast } from '../../stores/toast'
import { useLocalStorageBoolean } from '../../hooks/useLocalStorageBoolean'
import * as api from '../../api/client'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n/types'
import { ensureNotificationPermission } from '../../services/notifications'
import { STORAGE_KEYS } from '../../utils/storageKeys'
import {
  voicePrefs, useVoiceMediaDevices, useOutputSinkSupported,
} from '../../voice/voicePrefs'
import s from './Settings.module.css'

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

const NAV: SettingsNavGroup<Section>[] = [
  {
    group: 'User Settings',
    items: [
      { id: 'account',     label: 'My Account',       icon: <User       size={15} strokeWidth={1.5} /> },
      { id: 'privacy',     label: 'Privacy & Safety', icon: <Shield     size={15} strokeWidth={1.5} /> },
      { id: 'connections', label: 'Connections',      icon: <Link       size={15} strokeWidth={1.5} /> },
    ],
  },
  {
    group: 'App Settings',
    items: [
      { id: 'appearance',    label: 'Appearance',    icon: <Palette       size={15} strokeWidth={1.5} /> },
      { id: 'accessibility', label: 'Accessibility', icon: <Accessibility size={15} strokeWidth={1.5} /> },
      { id: 'voice',         label: 'Voice & Video', icon: <Mic           size={15} strokeWidth={1.5} /> },
      { id: 'notifications', label: 'Notifications', icon: <Bell          size={15} strokeWidth={1.5} /> },
      { id: 'keybinds',      label: 'Keybinds',      icon: <Keyboard      size={15} strokeWidth={1.5} /> },
      { id: 'language',      label: 'Language',       icon: <Globe         size={15} strokeWidth={1.5} /> },
    ],
  },
]

export function Settings({ onClose, isDark, colorPref, onSetColorPref, user, onLogout, onUpdateProfile, onUploadAvatar }: Props) {
  const [section, setSection] = useState<Section>('account')

  return (
    <SettingsShell
      section={section}
      onSection={setSection}
      onClose={onClose}
      navGroups={NAV}
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

/* ─────────────────────────────────────────
   SECTION: My Account
───────────────────────────────────────── */
const BANNER_COLORS = [
  { name: 'Sage', value: 'oklch(60% 0.1 136)' },
  { name: 'Gold', value: 'oklch(65% 0.12 85)' },
  { name: 'Ocean', value: 'oklch(60% 0.12 215)' },
  { name: 'Royal', value: 'oklch(55% 0.18 280)' },
  { name: 'Berry', value: 'oklch(55% 0.18 340)' },
  { name: 'Coral', value: 'oklch(60% 0.15 25)' },
]

function AccountSection({ user, onLogout, onClose, onUpdateProfile, onUploadAvatar }: {
  user?: UserInfo
  onLogout?: () => void
  onClose: () => void
  onUpdateProfile?: (data: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string }) => Promise<void>
  onUploadAvatar?: (file: File) => Promise<string>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [editedProfile, setEditedProfile] = useState({
    display_name: user?.displayName ?? '',
    bio: user?.bio ?? '',
    banner_color: user?.bannerColor ?? user?.avatarColor ?? '',
    avatar_url: user?.avatarUrl ?? null,
  })
  // S3 key from upload — only persisted on Save, discarded on Cancel
  const [pendingAvatarKey, setPendingAvatarKey] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync editedProfile when user prop changes (e.g., after save) — store-prev
  // pattern keeps the reset behavior without triggering set-state-in-effect.
  // Track the user-version + isEditing combo so we resync only when the user
  // actually changed AND we're not in the middle of editing.
  const userKey = `${user?.displayName ?? ''}|${user?.bio ?? ''}|${user?.bannerColor ?? user?.avatarColor ?? ''}|${user?.avatarUrl ?? ''}|${isEditing}`
  const [prevUserKey, setPrevUserKey] = useState(userKey)
  if (userKey !== prevUserKey) {
    setPrevUserKey(userKey)
    if (!isEditing) {
      setEditedProfile({
        display_name: user?.displayName ?? '',
        bio: user?.bio ?? '',
        banner_color: user?.bannerColor ?? user?.avatarColor ?? '',
        avatar_url: user?.avatarUrl ?? null,
      })
      setPendingAvatarKey(null)
    }
  }

  const handleSave = async () => {
    try {
      await onUpdateProfile?.({
        display_name: editedProfile.display_name,
        bio: editedProfile.bio,
        banner_color: editedProfile.banner_color,
        ...(pendingAvatarKey ? { avatar_url: pendingAvatarKey } : {}),
      })
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
    setEditedProfile({
      display_name: user?.displayName ?? '',
      bio: user?.bio ?? '',
      banner_color: user?.bannerColor ?? user?.avatarColor ?? '',
      avatar_url: user?.avatarUrl ?? null,
    })
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
      setEditedProfile(p => ({ ...p, avatar_url: user?.avatarUrl ?? null }))
    }
  }

  const handleBannerColorChange = (color: string) => {
    setEditedProfile(p => ({ ...p, banner_color: color }))
    setShowColorPicker(false)
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>My Account</h2>

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
                title="Change banner color"
              >
                <Palette size={16} strokeWidth={1.5} />
              </button>
              {showColorPicker && (
                <div className={s.colorPickerSwatchesInline}>
                  {BANNER_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`${s.colorPickerSwatch} ${editedProfile.banner_color === c.value ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: c.value }}
                      onClick={() => handleBannerColorChange(c.value)}
                      title={c.name}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit Button */}
          {isEditing ? (
            <div className={s.editActions}>
              <button className={s.cancelEditBtn} onClick={handleCancel}>Cancel</button>
              <button className={s.saveEditBtn} onClick={handleSave}>Save</button>
            </div>
          ) : (
            <button className={s.editProfileBtn} onClick={() => setIsEditing(true)}>
              Edit Profile
            </button>
          )}
        </div>

        {/* Banner */}
        <div className={s.previewBanner} style={{ background: editedProfile.banner_color }} />

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
            <div className={s.previewAvatar} style={{ background: editedProfile.banner_color }}>
              {editedProfile.avatar_url ? (
                <img src={editedProfile.avatar_url} alt="Profile" className={s.previewAvatarImg} />
              ) : (
                editedProfile.display_name.charAt(0).toUpperCase()
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
                  <label className={s.editLabel}>Display Name</label>
                  <input
                    type="text"
                    className={s.editInput}
                    value={editedProfile.display_name}
                    onChange={(e) => setEditedProfile(p => ({ ...p, display_name: e.target.value }))}
                    placeholder="How others see you"
                  />
                </div>
                <div className={s.editFieldGroup}>
                  <label className={s.editLabel}>Username</label>
                  <span className={s.editReadonly}>{user?.username}</span>
                </div>
              </>
            ) : (
              <>
                <h3 className={s.previewDisplayName}>{editedProfile.display_name}</h3>
                <p className={s.previewUsername}>{user?.username}</p>
              </>
            )}

            <div className={s.previewDivider} />

            {isEditing ? (
              <div className={s.editFieldGroup}>
                <label className={s.editLabel}>Bio</label>
                <textarea
                  className={s.editTextarea}
                  value={editedProfile.bio}
                  onChange={(e) => setEditedProfile(p => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell others about yourself..."
                  rows={3}
                  maxLength={500}
                />
              </div>
            ) : (
              <p className={s.previewBio}>{editedProfile.bio || 'No bio set'}</p>
            )}
          </div>

        </div>
      </div>

      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Account Information</h3>
      <div className={s.simpleField}>
        <span className={s.simpleFieldLabel}>Email</span>
        <div className={s.simpleFieldValueWrap}>
          <span className={s.simpleFieldValue}>••••••••••</span>
          <button className={s.simpleFieldEdit}>Edit</button>
        </div>
      </div>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Password & Authentication</h3>
      <p className={`${s.helpText} txt-small`}>Keep your account secure with a strong password and two-factor authentication.</p>
      <div className={s.rowBtns}>
        <OutlineBtn>Change Password</OutlineBtn>
        <OutlineBtn>Enable Two-Factor Auth</OutlineBtn>
      </div>

      <Divider />
      <div className={s.rowBtns}>
        <OutlineBtn onClick={() => { onLogout?.(); onClose() }}>Log Out</OutlineBtn>
      </div>

      <Divider />
      <h3 className={`${s.subTitle} ${s.danger} txt-small txt-semibold`}>Danger Zone</h3>
      <p className={`${s.helpText} txt-small`}>Deleting your account is permanent and cannot be undone.</p>
      <DangerBtn>Delete Account</DangerBtn>
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Privacy & Safety
───────────────────────────────────────── */
function PrivacySection() {
  const user = useAuthStore(s => s.user)
  const updateProfile = useAuthStore(s => s.updateProfile)

  // Defaults match the server's defaults (all / true / true). When the user
  // object hasn't loaded yet we still render — values are corrected on the
  // first render after `user` becomes available.
  const dmFilter: DmFilter = user?.dm_filter ?? 'all'
  const friendReqs = user?.allow_friend_requests ?? true
  const readReceipts = user?.show_read_receipts ?? true
  // TODO: wire up analytics opt-in (telemetry SDK + persistence)
  const [analytics, setAnalytics] = useState(false)

  const setDmFilter = (v: DmFilter) =>
    updateProfile({ dm_filter: v }).catch(console.warn)
  const setFriendReqs = (v: boolean) =>
    updateProfile({ allow_friend_requests: v }).catch(console.warn)
  const setReadReceipts = (v: boolean) =>
    updateProfile({ show_read_receipts: v }).catch(console.warn)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Privacy & Safety</h2>

      <SettingBlock title="Safe Direct Messaging" description="Control who can send you direct messages.">
        <RadioGroup
          value={dmFilter}
          onChange={setDmFilter}
          options={[
            { value: 'all',     label: 'Allow all DMs' },
            { value: 'friends', label: 'Friends only' },
            { value: 'none',    label: 'No one' },
          ]}
        />
      </SettingBlock>

      <Divider />
      <ToggleRow label="Allow friend requests" description="Let others send you friend requests." value={friendReqs} onChange={setFriendReqs} />
      <ToggleRow label="Read receipts"         description="Show when you've read messages in DMs."  value={readReceipts} onChange={setReadReceipts} />

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Data & Privacy</h3>
      <ToggleRow label="Usage analytics" description="Help improve Jolkr by sending anonymous usage data." value={analytics} onChange={setAnalytics} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Connections
───────────────────────────────────────── */
const SERVICES = [
  { name: 'Spotify',  icon: '🎵', desc: 'Music' },
  { name: 'Steam',    icon: '🎮', desc: 'Gaming' },
  { name: 'GitHub',   icon: '💻', desc: 'Development' },
  { name: 'Twitch',   icon: '📺', desc: 'Streaming' },
  { name: 'YouTube',  icon: '▶️', desc: 'Video' },
  { name: 'Twitter',  icon: '🐦', desc: 'Social' },
]
function ConnectionsSection() {
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Connections</h2>
      <p className={`${s.helpText} txt-small`}>Connect your accounts to share your activity and unlock integrations.</p>
      <div className={s.connectionGrid}>
        {SERVICES.map(svc => (
          <button key={svc.name} className={s.connectionTile}>
            <span className={s.connectionIcon}>{svc.icon}</span>
            <span className={`${s.connectionName} txt-small txt-medium`}>{svc.name}</span>
            <span className={`${s.connectionDesc} txt-tiny`}>{svc.desc}</span>
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
  const [display, setDisplay]   = useState<'cozy' | 'compact'>('cozy')
  const [fontSize, setFontSize] = useState(16)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Appearance</h2>

      <SettingBlock title="Color Mode" description="Choose your preferred theme.">
        <div className={s.segmentControl}>
          {(['light', 'system', 'dark'] as ColorPreference[]).map(p => (
            <button
              key={p}
              className={`${s.segment} ${colorPref === p ? s.segmentActive : ''}`}
              onClick={() => onSetColorPref(p)}
            >
              {p === 'light' ? '☀️  Light' : p === 'system' ? '⚙️  System' : '🌙  Dark'}
            </button>
          ))}
        </div>
      </SettingBlock>

      <Divider />
      <SettingBlock title="Message Display" description="Compact mode shows more messages at once.">
        <RadioGroup
          value={display}
          onChange={setDisplay}
          options={[
            { value: 'cozy',    label: 'Cozy — spacious, comfortable reading' },
            { value: 'compact', label: 'Compact — more messages visible at once' },
          ]}
        />
      </SettingBlock>

      <Divider />
      <SettingBlock title={`Chat Font Size — ${fontSize}px`} description="Resize the text in chat messages.">
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
  const [reducedMotion, setReducedMotion] = useState(false)
  const [highContrast,  setHighContrast]  = useState(false)
  const [roleColors,    setRoleColors]    = useState(true)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Accessibility</h2>
      <ToggleRow label="Reduce motion"    description="Minimise animations and transitions throughout the app." value={reducedMotion} onChange={setReducedMotion} />
      <ToggleRow label="High contrast"    description="Increase contrast between text and background." value={highContrast} onChange={setHighContrast} />
      <ToggleRow label="Show role colours" description="Display colour-coded role names in member lists." value={roleColors}    onChange={setRoleColors} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Voice & Video
───────────────────────────────────────── */
function VoiceSection() {
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
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Voice & Video</h2>

      <SettingBlock title="Input Device">
        <Select
          className={s.selectMaxWidth}
          value={prefs.audioInputDeviceId}
          onChange={(e) => set('audioInputDeviceId', e.target.value)}
        >
          <option value="">System default</option>
          {audioInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone (${d.deviceId.slice(0, 6)}…)`}
            </option>
          ))}
        </Select>
      </SettingBlock>
      <SettingBlock title={`Input Volume — ${prefs.inputVolume}%`}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={prefs.inputVolume}
            onChange={(e) => set('inputVolume', +e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <SettingBlock
        title="Output Device"
        description={sinkSupported ? undefined : 'Output device selection is not supported in this browser.'}
      >
        <Select
          className={s.selectMaxWidth}
          value={prefs.audioOutputDeviceId}
          onChange={(e) => set('audioOutputDeviceId', e.target.value)}
          disabled={!sinkSupported}
          title={sinkSupported ? undefined : 'Not supported in this browser'}
        >
          <option value="">System default</option>
          {audioOutputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Speakers (${d.deviceId.slice(0, 6)}…)`}
            </option>
          ))}
        </Select>
      </SettingBlock>
      <SettingBlock title={`Output Volume — ${prefs.outputVolume}%`}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={prefs.outputVolume}
            onChange={(e) => set('outputVolume', +e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Camera</h3>
      <SettingBlock title="Camera Device">
        <Select
          className={s.selectMaxWidth}
          value={prefs.videoInputDeviceId}
          onChange={(e) => set('videoInputDeviceId', e.target.value)}
        >
          <option value="">System default</option>
          {videoInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera (${d.deviceId.slice(0, 6)}…)`}
            </option>
          ))}
        </Select>
        <CameraPreview deviceId={prefs.videoInputDeviceId} />
      </SettingBlock>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Advanced</h3>
      <ToggleRow label="Noise suppression"      description="Filter out background noise during voice calls." value={prefs.noiseSuppression} onChange={(v) => set('noiseSuppression', v)} />
      <ToggleRow label="Echo cancellation"      description="Remove echo from microphone input."              value={prefs.echoCancellation} onChange={(v) => set('echoCancellation', v)} />
      <ToggleRow label="Automatic gain control" description="Automatically adjust microphone sensitivity."     value={prefs.autoGainControl}  onChange={(v) => set('autoGainControl', v)} />
    </div>
  )
}

/**
 * Live preview of the selected camera. Acquires its own MediaStream so it
 * doesn't conflict with an active call, and stops the stream as soon as the
 * Settings dialog closes (component unmount).
 */
function CameraPreview({ deviceId }: { deviceId: string }) {
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
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
      stream = s
      if (node) node.srcObject = s
      setError(null)
    }).catch((e: Error) => {
      if (!cancelled) setError(e.message || 'Camera unavailable')
    })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (node) node.srcObject = null
    }
  }, [deviceId])

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
      showToast('Notification permission denied — enable it in your browser/OS settings.', 'error', 6000)
    } else if (result === 'unsupported') {
      showToast('Desktop notifications are not supported in this environment.', 'info', 4000)
    }
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Notifications</h2>
      <ToggleRow label="Enable desktop notifications" description="Show notifications when the app is in the background." value={desktop}  onChange={onDesktopChange} />
      <ToggleRow label="Notification sounds"          description="Play a sound when you receive a notification." value={sounds}   onChange={setSounds} />

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Notification triggers</h3>
      <ToggleRow label="@mentions"           description="Notify when someone mentions you in a channel." value={mentions} onChange={setMentions} />
      <ToggleRow label="Direct messages"     description="Notify for all new direct messages." value={dms}      onChange={setDms} />
      <ToggleRow label="Unread badge"        description="Show unread count badge on the app icon." value={badge}    onChange={setBadge} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Keybinds
───────────────────────────────────────── */
const KEYBINDS = [
  { action: 'Open Quick Switcher',   keys: ['⌘', 'K'] },
  { action: 'Toggle Mute',           keys: ['⌘', 'Shift', 'M'] },
  { action: 'Toggle Deafen',         keys: ['⌘', 'Shift', 'D'] },
  { action: 'Mark Server as Read',   keys: ['Escape'] },
  { action: 'Jump to Oldest Unread', keys: ['⌘', 'Shift', 'U'] },
  { action: 'Upload a File',         keys: ['⌘', 'Shift', 'F'] },
  { action: 'Search',                keys: ['⌘', 'F'] },
  { action: 'Focus Chat Input',      keys: ['⌘', 'L'] },
  { action: 'Edit Last Message',     keys: ['↑'] },
  { action: 'Reply to Message',      keys: ['R'] },
  { action: 'Toggle Settings',       keys: ['⌘', ','] },
]
function KeybindsSection() {
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Keybinds</h2>
      <p className={`${s.helpText} txt-small`}>Default keyboard shortcuts. Custom keybinds coming soon.</p>
      <div className={s.keybindList}>
        {KEYBINDS.map(kb => (
          <div key={kb.action} className={s.keybindRow}>
            <span className={`${s.keybindAction} txt-small`}>{kb.action}</span>
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
      showToast('Failed to save language preference', 'error')
    }
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Language</h2>
      <SettingBlock title="Display Language" description="Choose the language used throughout the app.">
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
