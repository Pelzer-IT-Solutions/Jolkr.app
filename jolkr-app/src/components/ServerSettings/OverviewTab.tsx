import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Save, Camera, Palette, Upload } from 'lucide-react'
import type { Server as ApiServer } from '../../api/types'
import * as api from '../../api/client'
import ServerIcon from '../ServerIcon/ServerIcon'
import s from './ServerSettings.module.css'

type Server = ApiServer & { hue?: number | null; discoverable?: boolean }

// Solid colors match Settings.tsx AccountSection (BANNER_COLORS).
const BANNER_COLORS = [
  { name: 'Sage', value: 'oklch(60% 0.1 136)' },
  { name: 'Gold', value: 'oklch(65% 0.12 85)' },
  { name: 'Ocean', value: 'oklch(60% 0.12 215)' },
  { name: 'Royal', value: 'oklch(55% 0.18 280)' },
  { name: 'Berry', value: 'oklch(55% 0.18 340)' },
  { name: 'Coral', value: 'oklch(60% 0.15 25)' },
]

function hueFromOklch(oklch: string): number | null {
  const m = oklch.match(/oklch\([^\s]+\s+[^\s]+\s+(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

const BANNER_PRESETS = {
  gradients: [
    { name: 'Ocean Breeze', value: 'linear-gradient(135deg, oklch(60% 0.12 215), oklch(55% 0.1 180))' },
    { name: 'Sunset Glow', value: 'linear-gradient(135deg, oklch(65% 0.15 45), oklch(55% 0.18 340))' },
    { name: 'Forest Mist', value: 'linear-gradient(135deg, oklch(60% 0.1 136), oklch(55% 0.08 160))' },
    { name: 'Royal Velvet', value: 'linear-gradient(135deg, oklch(55% 0.18 280), oklch(50% 0.15 320))' },
    { name: 'Berry Burst', value: 'linear-gradient(135deg, oklch(55% 0.18 340), oklch(60% 0.12 25))' },
    { name: 'Midnight', value: 'linear-gradient(135deg, oklch(40% 0.05 250), oklch(35% 0.08 280))' },
  ],
}

interface Props {
  server: Server
  editedServer: Partial<Server>
  setEditedServer: Dispatch<SetStateAction<Partial<Server>>>
  hasChanges: boolean
  setHasChanges: (has: boolean) => void
  iconPreviewUrl: string | null
  setIconPreviewUrl: (url: string | null) => void
  iconFileRef: React.RefObject<HTMLInputElement | null>
  onUpdate: (serverId: string, data: Partial<Server>) => void
  onIconUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function OverviewTab({
  server,
  editedServer,
  setEditedServer,
  hasChanges,
  setHasChanges,
  iconPreviewUrl,
  iconFileRef,
  onUpdate,
  onIconUpload,
}: Props) {
  const [showBannerMenu, setShowBannerMenu] = useState(false)
  const [bannerPopoverPos, setBannerPopoverPos] = useState({ top: 0, left: 0 })
  const [bannerUploading, setBannerUploading] = useState(false)
  const bannerMenuBtnRef = useRef<HTMLButtonElement>(null)
  const bannerPopoverRef = useRef<HTMLDivElement>(null)
  const bannerFileInputRef = useRef<HTMLInputElement>(null)
  // Store banner gradient in local state since it's not in Server type
  const [bannerGradient, setBannerGradient] = useState<string | null>(null)

  // Compute current values (edited or original)
  const currentName = editedServer.name ?? server.name
  const currentDescription = editedServer.description ?? server.description ?? ''
  const currentBannerUrl = editedServer.banner_url ?? server.banner_url ?? ''
  const currentDiscoverable = editedServer.discoverable ?? server.discoverable ?? false
  const currentHue =
    editedServer.hue ?? server.hue ?? server.theme?.hue ?? null
  const currentGradient = bannerGradient

  const updateBannerPopoverPosition = useCallback(() => {
    const btn = bannerMenuBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const panelWidth = 320
    const left = Math.max(8, Math.min(r.left, window.innerWidth - panelWidth - 8))
    setBannerPopoverPos({ top: r.bottom + 8, left })
  }, [])

  useLayoutEffect(() => {
    if (!showBannerMenu) return
    updateBannerPopoverPosition()
    const onScrollOrResize = () => updateBannerPopoverPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showBannerMenu, updateBannerPopoverPosition])

  useEffect(() => {
    if (!showBannerMenu) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (bannerPopoverRef.current?.contains(t)) return
      if (bannerMenuBtnRef.current?.contains(t)) return
      setShowBannerMenu(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showBannerMenu])

  // Solid fill: use exact preset string when hue matches Settings palette (same as profile banner)
  const getBannerBackground = () => {
    if (currentBannerUrl) return `url(${currentBannerUrl}) center/cover`
    if (currentGradient) return currentGradient
    if (currentHue != null) {
      const preset = BANNER_COLORS.find(c => hueFromOklch(c.value) === currentHue)
      if (preset) return preset.value
      return `oklch(60% 0.12 ${currentHue})`
    }
    return BANNER_COLORS[2].value
  }

  const isSolidColorActive = (presetValue: string) => {
    if (currentBannerUrl || currentGradient || currentHue == null) return false
    return hueFromOklch(presetValue) === currentHue
  }

  const handleFieldChange = (field: keyof Server, value: unknown) => {
    // Functional update so sequential calls (e.g. hue + banner_url) don't clobber each other
    setEditedServer(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = () => {
    onUpdate(server.id, editedServer)
    setHasChanges(false)
    setEditedServer({})
  }

  const handleBannerColorSelect = (colorValue: string) => {
    const h = hueFromOklch(colorValue)
    if (h != null) {
      handleFieldChange('hue', h)
      setBannerGradient(null)
      handleFieldChange('banner_url', null)
    }
  }

  const handleGradientSelect = (gradientValue: string) => {
    setBannerGradient(gradientValue)
    handleFieldChange('hue', null)
    handleFieldChange('banner_url', null)
    setHasChanges(true)
  }

  const handleImageUrlChange = (url: string) => {
    handleFieldChange('banner_url', url)
    handleFieldChange('hue', null)
    setBannerGradient(null)
  }

  const handleBannerFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBannerUploading(true)
    try {
      const result = await api.uploadFile(file)
      const url = result.url ?? result.key
      handleImageUrlChange(url)
    } catch {
      /* ignore */
    } finally {
      setBannerUploading(false)
    }
  }

  return (
    <div className={s.section}>
      {/* Server Preview Card - Visual Editor */}
      <div className={s.serverPreviewCard}>
        <div className={s.bannerEditorWrap}>
          <div className={s.bannerEditor} style={{ background: getBannerBackground() }} />
          <div className={s.serverPreviewActions}>
            <button
              ref={bannerMenuBtnRef}
              type="button"
              className={`${s.colorPickerBtn} ${showBannerMenu ? s.colorPickerActive : ''}`}
              onClick={() => setShowBannerMenu(v => !v)}
              title="Banner background"
              aria-expanded={showBannerMenu}
              aria-haspopup="dialog"
            >
              <Palette size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {showBannerMenu &&
          createPortal(
            <div
              ref={bannerPopoverRef}
              className={s.bannerPopover}
              style={{ top: bannerPopoverPos.top, left: bannerPopoverPos.left }}
              role="dialog"
              aria-label="Banner background"
            >
              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Solid colors</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`${s.colorPickerSwatch} ${isSolidColorActive(c.value) ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: c.value }}
                      onClick={() => handleBannerColorSelect(c.value)}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Gradients</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_PRESETS.gradients.map(g => (
                    <button
                      key={g.name}
                      type="button"
                      className={`${s.colorPickerSwatch} ${currentGradient === g.value ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: g.value }}
                      onClick={() => handleGradientSelect(g.value)}
                      title={g.name}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Image</span>
                <div className={s.bannerPopoverImageRow}>
                  <input
                    type="text"
                    className={s.bannerPopoverUrlInput}
                    value={currentBannerUrl}
                    onChange={e => handleImageUrlChange(e.target.value)}
                    placeholder="Image URL (https://…)"
                    autoComplete="off"
                  />
                  <input
                    ref={bannerFileInputRef}
                    type="file"
                    accept="image/*"
                    className={s.bannerPopoverFileInput}
                    onChange={handleBannerFileChange}
                  />
                  <button
                    type="button"
                    className={s.bannerPopoverUploadBtn}
                    disabled={bannerUploading}
                    onClick={() => bannerFileInputRef.current?.click()}
                  >
                    <Upload size={14} strokeWidth={1.5} />
                    {bannerUploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {currentBannerUrl ? (
                  <button
                    type="button"
                    className={s.bannerPopoverClearImage}
                    onClick={() => handleImageUrlChange('')}
                  >
                    Remove image banner
                  </button>
                ) : null}
              </div>
            </div>,
            document.body
          )}

        {/* Server Content */}
        <div className={s.previewContent}>
          {/* Server Icon with Upload */}
          <div
            className={s.previewAvatarWrap}
            onClick={() => iconFileRef.current?.click()}
          >
            <input
              ref={iconFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onIconUpload}
            />
            <div className={s.previewAvatar}>
              {iconPreviewUrl ? (
                <img src={iconPreviewUrl} alt="Server Icon" className={s.previewAvatarImg} />
              ) : (
                <ServerIcon name={currentName} iconUrl={server.icon_url} serverId={server.id} size="lg" />
              )}
            </div>
            <div className={s.avatarChangeOverlay}>
              <Camera size={20} strokeWidth={1.5} />
            </div>
          </div>

          {/* Direct Edit Fields */}
          <div className={s.previewInfo}>
            <input
              type="text"
              className={s.inlineNameInput}
              value={currentName}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="Server Name"
              maxLength={100}
            />
            <textarea
              className={s.inlineDescInput}
              value={currentDescription}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="What's your server about?"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
      </div>

      {/* Discoverable Toggle */}
      <div className={s.simpleFieldRow}>
        <div className={s.toggleMeta}>
          <span className={`${s.toggleLabel} txt-small txt-medium`}>Server Discovery</span>
          <span className={`${s.toggleDesc} txt-tiny`}>Make server discoverable in server browser</span>
        </div>
        <button
          className={`${s.toggle} ${currentDiscoverable ? s.toggleOn : ''}`}
          onClick={() => handleFieldChange('discoverable', !currentDiscoverable)}
          role="switch"
          aria-checked={currentDiscoverable}
        >
          <span className={s.toggleThumb} />
        </button>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className={s.saveActions}>
          <button className={s.saveChangesBtn} onClick={handleSave}>
            <Save size={14} strokeWidth={1.5} />
            Save Changes
          </button>
        </div>
      )}
    </div>
  )
}
