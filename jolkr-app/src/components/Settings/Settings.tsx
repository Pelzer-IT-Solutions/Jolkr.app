import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, User, Shield, Link, Palette, Accessibility,
  Mic, Bell, Keyboard, Globe, ChevronRight,
} from 'lucide-react'
import type { ColorPreference } from '../../utils/colorMode'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import s from './Settings.module.css'

type Section =
  | 'account' | 'profiles' | 'privacy' | 'connections'
  | 'appearance' | 'accessibility' | 'voice' | 'notifications' | 'keybinds' | 'language'

interface UserInfo {
  displayName:  string
  username:     string
  email:        string
  avatarLetter: string
  avatarColor:  string
  avatarUrl?:   string | null
}

interface Props {
  onClose:       () => void
  isDark:        boolean
  colorPref:     ColorPreference
  onSetColorPref:(pref: ColorPreference) => void
  user?:         UserInfo
  onLogout?:     () => void
  onUpdateProfile?: (data: { display_name?: string; username?: string }) => Promise<void>
  onUploadAvatar?:  (file: File) => Promise<void>
  onChangePassword?:(current: string, newPw: string) => Promise<void>
}

const NAV: { group: string; items: { id: Section; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: 'User Settings',
    items: [
      { id: 'account',     label: 'My Account',      icon: <User       size={15} strokeWidth={1.5} /> },
      { id: 'profiles',    label: 'Profiles',         icon: <User       size={15} strokeWidth={1.5} /> },
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

export function Settings({ onClose, isDark, colorPref, onSetColorPref, user, onLogout, onUpdateProfile, onUploadAvatar, onChangePassword }: Props) {
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
              onChangePassword={onChangePassword}
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
function SectionContent({ section, isDark, colorPref, onSetColorPref, user, onLogout, onClose, onUpdateProfile, onUploadAvatar, onChangePassword }: {
  section:        Section
  isDark:         boolean
  colorPref:      ColorPreference
  onSetColorPref: (pref: ColorPreference) => void
  user?:          UserInfo
  onLogout?:      () => void
  onClose:        () => void
  onUpdateProfile?: (data: { display_name?: string; username?: string }) => Promise<void>
  onUploadAvatar?:  (file: File) => Promise<void>
  onChangePassword?:(current: string, newPw: string) => Promise<void>
}) {
  switch (section) {
    case 'account':     return <AccountSection user={user} onLogout={onLogout} onClose={onClose} onUpdateProfile={onUpdateProfile} onUploadAvatar={onUploadAvatar} onChangePassword={onChangePassword} />
    case 'profiles':    return <ProfilesSection />
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
function AccountSection({ user, onLogout, onClose, onUpdateProfile, onUploadAvatar, onChangePassword }: {
  user?: UserInfo
  onLogout?: () => void
  onClose: () => void
  onUpdateProfile?: (data: { display_name?: string; username?: string }) => Promise<void>
  onUploadAvatar?: (file: File) => Promise<void>
  onChangePassword?: (current: string, newPw: string) => Promise<void>
}) {
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [pwMode, setPwMode] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwError, setPwError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSaveField() {
    if (!editField || !editValue.trim()) return
    setSaving(true)
    try {
      await onUpdateProfile?.({ [editField === 'Display Name' ? 'display_name' : 'username']: editValue.trim() })
      setEditField(null)
    } catch (e) {
      console.error('Failed to update:', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword() {
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters'); return }
    setSaving(true)
    setPwError('')
    try {
      await onChangePassword?.(currentPw, newPw)
      setPwMode(false)
      setCurrentPw('')
      setNewPw('')
    } catch (e) {
      setPwError((e as Error).message || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await onUploadAvatar?.(file)
    } catch (err) {
      console.error('Avatar upload failed:', err)
    }
  }

  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>My Account</h2>

      {/* Profile card */}
      <div className={s.profileCard}>
        <div className={s.profileBanner} style={user?.avatarColor ? { background: user.avatarColor } : undefined} />
        <div className={s.profileCardBody}>
          <div className={s.profileAvatarWrap} onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }} title="Change avatar">
            <div className={s.profileAvatar} style={!user?.avatarUrl && user?.avatarColor ? { background: user.avatarColor } : undefined}>
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : (user?.avatarLetter ?? '?')}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
          </div>
          <button className={s.editProfileBtn} onClick={() => fileInputRef.current?.click()}>Change Avatar</button>
        </div>
        <div className={s.profileFields}>
          {editField === 'Display Name' ? (
            <div className={s.field}>
              <span className={`${s.fieldLabel} txt-tiny txt-semibold`}>Display Name</span>
              <input
                className={`${s.fieldValue} txt-small`}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveField(); if (e.key === 'Escape') setEditField(null) }}
                autoFocus
                style={{ background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', color: 'var(--text-default)', outline: 'none' }}
              />
              <button className={s.fieldEdit} onClick={handleSaveField} disabled={saving}>{saving ? '...' : 'Save'}</button>
            </div>
          ) : (
            <Field label="Display Name" value={user?.displayName ?? ''} onEdit={() => { setEditField('Display Name'); setEditValue(user?.displayName ?? '') }} />
          )}
          {editField === 'Username' ? (
            <div className={s.field}>
              <span className={`${s.fieldLabel} txt-tiny txt-semibold`}>Username</span>
              <input
                className={`${s.fieldValue} txt-small`}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveField(); if (e.key === 'Escape') setEditField(null) }}
                autoFocus
                style={{ background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', color: 'var(--text-default)', outline: 'none' }}
              />
              <button className={s.fieldEdit} onClick={handleSaveField} disabled={saving}>{saving ? '...' : 'Save'}</button>
            </div>
          ) : (
            <Field label="Username" value={user?.username ?? ''} onEdit={() => { setEditField('Username'); setEditValue(user?.username ?? '') }} />
          )}
          <Field label="Email" value={user?.email ?? ''} masked />
        </div>
      </div>

      <Divider />
      <h3 className={`${s.subTitle} txt-small txt-semibold`}>Password & Authentication</h3>
      <p className={`${s.helpText} txt-small`}>Keep your account secure with a strong password and two-factor authentication.</p>
      {pwMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '20rem' }}>
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            style={{ background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.375rem', padding: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-default)', outline: 'none' }}
          />
          <input
            type="password"
            placeholder="New password (min 6 chars)"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            style={{ background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.375rem', padding: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-default)', outline: 'none' }}
          />
          {pwError && <span style={{ color: 'oklch(55% 0.2 25)', fontSize: '0.75rem' }}>{pwError}</span>}
          <div className={s.rowBtns}>
            <OutlineBtn onClick={handleChangePassword}>{saving ? 'Saving...' : 'Save'}</OutlineBtn>
            <OutlineBtn onClick={() => { setPwMode(false); setPwError('') }}>Cancel</OutlineBtn>
          </div>
        </div>
      ) : (
        <div className={s.rowBtns}>
          <OutlineBtn onClick={() => setPwMode(true)}>Change Password</OutlineBtn>
        </div>
      )}

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
   SECTION: Profiles
───────────────────────────────────────── */
function ProfilesSection() {
  return (
    <div className={s.section}>
      <h2 className={`${s.sectionTitle} txt-body txt-semibold`}>Profiles</h2>

      <SettingBlock title="About Me" description="Tell others a little about yourself.">
        <textarea className={s.textarea} placeholder="Add a bio…" rows={4} />
      </SettingBlock>

      <Divider />
      <SettingBlock title="Profile Banner Colour">
        <div className={s.colorSwatches}>
          {['oklch(48% 0.15 136)', '#7c3aed', '#4338ca', '#0284c7', '#9333ea', '#dc2626'].map(c => (
            <button key={c} className={s.swatch} style={{ background: c }} />
          ))}
        </div>
      </SettingBlock>
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
  { action: 'Upload a File',         keys: ['⌘', 'Shift', 'U'] },
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

function Field({ label, value, masked, onEdit }: { label: string; value: string; masked?: boolean; onEdit?: () => void }) {
  return (
    <div className={s.field}>
      <span className={`${s.fieldLabel} txt-tiny txt-semibold`}>{label}</span>
      <span className={`${s.fieldValue} txt-small`}>{masked ? '••••••••••' : value}</span>
      {onEdit && <button className={s.fieldEdit} onClick={onEdit}>Edit</button>}
    </div>
  )
}

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
