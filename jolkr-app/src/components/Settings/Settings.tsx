import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, User, Shield, Link, Palette, Accessibility,
  Mic, Bell, Keyboard, Globe, ChevronRight, Camera,
} from 'lucide-react'
import type { ColorPreference } from '../../utils/colorMode'
import { revealDelay, revealWindowMs } from '../../utils/animations'
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

const NAV: { group: string; items: { id: Section; label: string; icon: React.ReactNode }[] }[] = [
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

  // Settings mounts fresh on every open, so start revealing immediately.
  const navTotal = NAV.reduce((sum, g) => sum + 1 + g.items.length, 0)
  const [isRevealing, setIsRevealing] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(navTotal))
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Compute flat stagger indices across all nav groups and their items
  let navIdx = 0

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        {/* ── Left nav ── */}
        <aside className={s.nav}>
          <div className={`${s.navScroll} scrollbar-thin scroll-view-y`}>
            {NAV.map(group => {
              const groupIdx = navIdx++
              return (
              <div key={group.group} className={s.navGroup}>
                <span
                  className={`${s.navGroupLabel} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
                  style={isRevealing ? { '--reveal-delay': `${revealDelay(groupIdx)}ms` } as React.CSSProperties : undefined}
                >
                  {group.group}
                </span>
                {group.items.map(item => {
                  const itemIdx = navIdx++
                  return (
                  <button
                    key={item.id}
                    className={`${s.navItem} ${section === item.id ? s.navItemActive : ''} ${isRevealing ? 'revealing' : ''}`}
                    style={isRevealing ? { '--reveal-delay': `${revealDelay(itemIdx)}ms` } as React.CSSProperties : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <span className={s.navIcon}>{item.icon}</span>
                    <span className={`${s.navLabel} txt-small txt-medium`}>{item.label}</span>
                    {section === item.id && <ChevronRight size={12} strokeWidth={2} className={s.navChevron} />}
                  </button>
                  )
                })}
              </div>
              )
            })}
          </div>
        </aside>

        {/* ── Content ── */}
        <div className={s.content}>
          <div className={`${s.contentScroll} scrollbar-thin scroll-view-y`}>
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
          </div>
          <button className={s.closeBtn} onClick={onClose} title="Close (Esc)">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>,
    document.body
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

  // Sync editedProfile when user prop changes (e.g., after save)
  useEffect(() => {
    if (!isEditing) {
      setEditedProfile({
        display_name: user?.displayName ?? '',
        bio: user?.bio ?? '',
        banner_color: user?.bannerColor ?? user?.avatarColor ?? '',
        avatar_url: user?.avatarUrl ?? null,
      })
      setPendingAvatarKey(null)
    }
  }, [user, isEditing])

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
  const [dmFilter,    setDmFilter]    = useState<'all' | 'friends' | 'none'>('friends')
  const [friendReqs,  setFriendReqs]  = useState(true)
  const [readReceipts,setReadReceipts]= useState(true)
  const [analytics,   setAnalytics]   = useState(false)

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
  const [inputVol,  setInputVol]  = useState(80)
  const [outputVol, setOutputVol] = useState(100)
  const [noiseSup,  setNoiseSup]  = useState(true)
  const [echoCan,   setEchoCan]   = useState(true)
  const [autoGain,  setAutoGain]  = useState(false)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Voice & Video</h2>

      <SettingBlock title="Input Device">
        <select className={s.select}><option>Default — Microphone</option></select>
      </SettingBlock>
      <SettingBlock title={`Input Volume — ${inputVol}%`}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={inputVol}
            onChange={e => setInputVol(+e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <SettingBlock title="Output Device">
        <select className={s.select}><option>Default — Speakers</option></select>
      </SettingBlock>
      <SettingBlock title={`Output Volume — ${outputVol}%`}>
        <div className={s.sliderRow}>
          <span className={s.sliderLabel}>0</span>
          <input type="range" min={0} max={100} value={outputVol}
            onChange={e => setOutputVol(+e.target.value)} className={s.slider} />
          <span className={s.sliderLabel}>100</span>
        </div>
      </SettingBlock>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Advanced</h3>
      <ToggleRow label="Noise suppression"    description="Filter out background noise during voice calls." value={noiseSup} onChange={setNoiseSup} />
      <ToggleRow label="Echo cancellation"    description="Remove echo from microphone input." value={echoCan}  onChange={setEchoCan} />
      <ToggleRow label="Automatic gain control" description="Automatically adjust microphone sensitivity." value={autoGain} onChange={setAutoGain} />
    </div>
  )
}

/* ─────────────────────────────────────────
   SECTION: Notifications
───────────────────────────────────────── */
function NotificationsSection() {
  const [desktop,   setDesktop]   = useState(true)
  const [sounds,    setSounds]    = useState(true)
  const [mentions,  setMentions]  = useState(true)
  const [dms,       setDms]       = useState(true)
  const [badge,     setBadge]     = useState(true)

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Notifications</h2>
      <ToggleRow label="Enable desktop notifications" description="Show notifications when the app is in the background." value={desktop}  onChange={setDesktop} />
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
const LANGUAGES = ['English (US)', 'English (UK)', 'Français', 'Deutsch', 'Español', 'Italiano', '日本語', '한국어', '中文 (简体)']
function LanguageSection() {
  const [lang, setLang] = useState('English (US)')
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Language</h2>
      <SettingBlock title="Display Language" description="Choose the language used throughout the app.">
        <select className={s.select} value={lang} onChange={e => setLang(e.target.value)}>
          {LANGUAGES.map(l => <option key={l}>{l}</option>)}
        </select>
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
