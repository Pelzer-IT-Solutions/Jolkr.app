import { Sun, Moon, Monitor } from 'lucide-react'
import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import { useMenuPosition } from '../../utils/position'
import { buildBackground, orbsForHue } from '../../utils/theme'
import s from './ThemePicker.module.css'
import type { ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'

const BASE_ORB_SIZE = 32 // px diameter for all orbs (before scale)
const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const SCALE_STEP = 0.1

const PRESETS: { hue: number; labelKey: string }[] = [
  { hue: 350, labelKey: 'themePicker.presets.rose' },
  { hue: 15,  labelKey: 'themePicker.presets.coral' },
  { hue: 35,  labelKey: 'themePicker.presets.orange' },
  { hue: 65,  labelKey: 'themePicker.presets.amber' },
  { hue: 100, labelKey: 'themePicker.presets.lime' },
  { hue: 136, labelKey: 'themePicker.presets.jolkr' },
  { hue: 165, labelKey: 'themePicker.presets.emerald' },
  { hue: 195, labelKey: 'themePicker.presets.cyan' },
  { hue: 220, labelKey: 'themePicker.presets.sky' },
  { hue: 250, labelKey: 'themePicker.presets.indigo' },
  { hue: 280, labelKey: 'themePicker.presets.purple' },
  { hue: 310, labelKey: 'themePicker.presets.fuchsia' },
]

interface Props {
  theme:             ServerTheme
  onChange:          (theme: ServerTheme) => void
  isDark:            boolean
  colorPref:         ColorPreference
  onSetColorPref:    (pref: ColorPreference) => void
}

export function ThemePicker({ theme, onChange, isDark, colorPref, onSetColorPref }: Props) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  // Raw trigger position from the click; clamped to the viewport via
  // useMenuPosition so the picker can't open partially off-screen on small
  // viewports or when the trigger sits near a screen edge.
  const [triggerPos, setTriggerPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedOrbId, setSelectedOrbId] = useState<string | null>(null)
  const [isDraggingHue, setIsDraggingHue] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerRef  = useRef<HTMLDivElement>(null)
  const canvasRef  = useRef<HTMLDivElement>(null)
  const hueWheelRef = useRef<HTMLDivElement>(null)
  const pos = useMenuPosition(triggerPos, pickerRef, open)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (
        pickerRef.current  && !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Clear selection when closing — store-prev pattern.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setSelectedOrbId(null)
  }

  // Global mouse up handler for hue dragging
  useEffect(() => {
    if (!isDraggingHue) return
    function handleMouseUp() {
      setIsDraggingHue(false)
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [isDraggingHue])

  // Calculate hue from wheel position
  const hueFromWheelPoint = useCallback((centerX: number, centerY: number, clientX: number, clientY: number): number => {
    const dx = clientX - centerX
    const dy = clientY - centerY
    const angle = Math.atan2(dy, dx)
    let hue = (angle * 180 / Math.PI + 90) % 360
    if (hue < 0) hue += 360
    return Math.round(hue)
  }, [])

  const handleHueWheelMove = useCallback((e: MouseEvent) => {
    if (!selectedOrbId || !hueWheelRef.current) return

    const rect = hueWheelRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const newHue = hueFromWheelPoint(centerX, centerY, e.clientX, e.clientY)

    onChange({
      ...theme,
      hue: null,
      orbs: theme.orbs.map(o => o.id === selectedOrbId ? { ...o, hue: newHue } : o),
    })
  }, [selectedOrbId, theme, onChange, hueFromWheelPoint])

  // Global mouse move handler for hue dragging
  useEffect(() => {
    if (!isDraggingHue || !selectedOrbId || !hueWheelRef.current) return
    function handleMouseMove(e: MouseEvent) {
      handleHueWheelMove(e)
    }
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [isDraggingHue, selectedOrbId, handleHueWheelMove])

  function openPicker() {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setTriggerPos({ x: r.left, y: r.bottom + 8 })
    }
    setOpen(v => !v)
  }

  const activePresetHue = theme.hue

  function handleOrbClick(orbId: string) {
    setSelectedOrbId(orbId)
  }

  // Drag an orb
  function handleOrbDown(e: React.MouseEvent, orbId: string) {
    e.preventDefault()
    e.stopPropagation()

    setSelectedOrbId(orbId)

    const canvas = canvasRef.current!
    const rect   = canvas.getBoundingClientRect()

    function clamp(v: number) { return Math.max(0.02, Math.min(0.98, v)) }

    function onMove(ev: MouseEvent) {
      const x = clamp((ev.clientX - rect.left)  / rect.width)
      const y = clamp((ev.clientY - rect.top)   / rect.height)
      onChange({
        ...theme,
        orbs: theme.orbs.map(o => o.id === orbId ? { ...o, x, y } : o),
      })
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  // Handle hue wheel click/drag
  function handleHueWheelDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedOrbId || !hueWheelRef.current) return

    setIsDraggingHue(true)
    handleHueWheelMove(e.nativeEvent)
  }

  // Handle scroll for orb sizing
  function handleCanvasScroll(e: React.WheelEvent) {
    if (!selectedOrbId) return

    e.preventDefault()
    e.stopPropagation()

    const orb = theme.orbs.find(o => o.id === selectedOrbId)
    if (!orb) return

    const currentScale = orb.scale ?? 1
    const direction = e.deltaY < 0 ? 1 : -1
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale + direction * SCALE_STEP))

    onChange({
      ...theme,
      orbs: theme.orbs.map(o => o.id === selectedOrbId ? { ...o, scale: newScale } : o),
    })
  }

  function handlePresetClick(presetHue: number) {
    onChange({ hue: presetHue, orbs: orbsForHue(presetHue) })
    setSelectedOrbId(null)
  }

  function handleNoneClick() {
    onChange({ hue: null, orbs: [] })
    setSelectedOrbId(null)
  }

  function getHueWheelSelectorPosition(orbHue: number): { x: number; y: number } {
    const angle = ((orbHue - 90) * Math.PI) / 180
    const radius = 42
    const x = 50 + radius * Math.cos(angle)
    const y = 50 + radius * Math.sin(angle)
    return { x, y }
  }

  const canvasBg = buildBackground(theme, isDark)

  return (
    <>
      <button
        ref={triggerRef}
        className={s.trigger}
        title={t('themePicker.title')}
        onClick={openPicker}
      >
        <SunIcon />
      </button>

      {open && createPortal(
        <div ref={pickerRef} className={s.picker} style={{ top: pos.y, left: pos.x }}>

          {/* ── Color canvas ── */}
          <div
            ref={canvasRef}
            className={s.canvas}
            style={{ background: canvasBg }}
            onWheel={handleCanvasScroll}
          >
            {/* Dot grid overlay */}
            <div className={s.dotGrid} />

            {/* Size indicator when orb selected */}
            {selectedOrbId && (
              <div className={s.sizeHint}>
                {t('themePicker.scrollToResize')}
              </div>
            )}

            {/* Draggable orb handles */}
            {theme.orbs.map((orb) => {
              const scale = orb.scale ?? 1
              const size = BASE_ORB_SIZE * scale
              const isSelected = selectedOrbId === orb.id

              return (
                <div
                  key={orb.id}
                  className={`${s.orbHandle} ${isSelected ? s.orbHandleSelected : ''}`}
                  style={{
                    left:        `${(orb.x * 100).toFixed(2)}%`,
                    top:         `${(orb.y * 100).toFixed(2)}%`,
                    width:       size,
                    height:      size,
                    borderWidth: isSelected ? 3 : 2.5,
                  }}
                  onMouseDown={e => handleOrbDown(e, orb.id)}
                  onClick={() => handleOrbClick(orb.id)}
                />
              )
            })}

            {/* Hue wheel around selected orb */}
            {selectedOrbId && (() => {
              const orb = theme.orbs.find(o => o.id === selectedOrbId)
              if (!orb) return null

              const scale = orb.scale ?? 1
              const orbSize = BASE_ORB_SIZE * scale
              const wheelSize = Math.max(80, orbSize + 48)

              const selectorPos = getHueWheelSelectorPosition(orb.hue)

              return (
                <div
                  ref={hueWheelRef}
                  className={s.hueWheel}
                  style={{
                    left: `${(orb.x * 100).toFixed(2)}%`,
                    top: `${(orb.y * 100).toFixed(2)}%`,
                    width: wheelSize,
                    height: wheelSize,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onMouseDown={handleHueWheelDown}
                >
                  <div className={s.hueWheelRing} />
                  <div
                    className={s.hueWheelSelector}
                    style={{
                      left: `${selectorPos.x}%`,
                      top: `${selectorPos.y}%`,
                    }}
                  />
                </div>
              )
            })()}
          </div>

          {/* ── Presets ── */}
          <div className={`${s.presets} scrollbar-none scroll-view-x`}>
            <button
              className={`${s.preset} ${s.presetNone} ${theme.hue === null && theme.orbs.length === 0 ? s.presetActive : ''}`}
              title={t('themePicker.noneLabel')}
              onClick={handleNoneClick}
            />

            {PRESETS.map(p => {
              const isActive = activePresetHue !== null && Math.abs(((activePresetHue - p.hue + 540) % 360) - 180) < 10
              return (
                <button
                  key={p.hue}
                  className={`${s.preset} ${isActive ? s.presetActive : ''}`}
                  style={{ background: `oklch(72% 0.18 ${p.hue})` }}
                  title={t(p.labelKey)}
                  onClick={() => handlePresetClick(p.hue)}
                />
              )
            })}
          </div>

          {/* ── Light / Auto / Dark mode selector ── */}
          <div className={s.modeFooter}>
            <div className={s.modeSegment}>
              {([
                { value: 'light',  labelKey: 'themePicker.modeLight', icon: <SegSunIcon /> },
                { value: 'system', labelKey: 'themePicker.modeAuto',  icon: <SegAutoIcon /> },
                { value: 'dark',   labelKey: 'themePicker.modeDark',  icon: <SegMoonIcon /> },
              ] as const).map(({ value, labelKey, icon }) => (
                <button
                  key={value}
                  className={`${s.modeBtn} ${colorPref === value ? s.modeBtnActive : ''}`}
                  onClick={() => onSetColorPref(value)}
                >
                  {icon}
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/* ─── Icons ─── */
function SegSunIcon()  { return <Sun     size={11} strokeWidth={1.75} /> }
function SegAutoIcon() { return <Monitor size={11} strokeWidth={1.75} /> }
function SegMoonIcon() { return <Moon    size={11} strokeWidth={1.75} /> }
function SunIcon()     { return <Sun     size={14} strokeWidth={1.5} /> }
