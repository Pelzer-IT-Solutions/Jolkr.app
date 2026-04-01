import { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon, Monitor, Dices } from 'lucide-react'
import type { ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'
import { buildBackground, orbsForHue, randomiseOrbs } from '../../utils/theme'
import s from './ThemePicker.module.css'

const ORB_SIZES = [38, 28, 20] // px diameter per orb index

const PRESETS: { hue: number; label: string }[] = [
  { hue: 350, label: 'Rose' },
  { hue: 15,  label: 'Coral' },
  { hue: 35,  label: 'Orange' },
  { hue: 65,  label: 'Amber' },
  { hue: 100, label: 'Lime' },
  { hue: 136, label: 'Jolkr' },
  { hue: 165, label: 'Emerald' },
  { hue: 195, label: 'Cyan' },
  { hue: 220, label: 'Sky' },
  { hue: 250, label: 'Indigo' },
  { hue: 280, label: 'Purple' },
  { hue: 310, label: 'Fuchsia' },
]

interface Props {
  theme:             ServerTheme
  onChange:          (theme: ServerTheme) => void
  isDark:            boolean
  colorPref:         ColorPreference
  onSetColorPref:    (pref: ColorPreference) => void
}

export function ThemePicker({ theme, onChange, isDark, colorPref, onSetColorPref }: Props) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerRef  = useRef<HTMLDivElement>(null)
  const canvasRef  = useRef<HTMLDivElement>(null)

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

  function openPicker() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      // Align left edge of picker with trigger, just below it
      setPos({ top: r.bottom + 8, left: r.left })
    }
    setOpen(v => !v)
  }

  // Drag an orb
  function handleOrbDown(e: React.MouseEvent, orbId: string) {
    e.preventDefault()
    e.stopPropagation()
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

  const canvasBg = buildBackground(theme, isDark)

  return (
    <>
      <button
        ref={triggerRef}
        className={s.trigger}
        title="Server theme"
        onClick={openPicker}
      >
        <SunIcon />
      </button>

      {open && createPortal(
        <div ref={pickerRef} className={s.picker} style={{ top: pos.top, left: pos.left }}>

          {/* ── Color canvas ── */}
          <div
            ref={canvasRef}
            className={s.canvas}
            style={{ background: canvasBg }}
          >
            {/* Dot grid overlay */}
            <div className={s.dotGrid} />

            {/* Top-right: randomise button */}
            <button
              className={s.canvasBtn}
              style={{ top: '0.5rem', right: '0.5rem' }}
              title="Randomise"
              onClick={() => onChange({ ...theme, orbs: randomiseOrbs(theme.orbs) })}
            >
              <DiceIcon />
            </button>

            {/* Draggable orb handles */}
            {theme.orbs.map((orb, i) => {
              const size = ORB_SIZES[i] ?? 20
              return (
                <div
                  key={orb.id}
                  className={s.orbHandle}
                  style={{
                    left:        `${(orb.x * 100).toFixed(2)}%`,
                    top:         `${(orb.y * 100).toFixed(2)}%`,
                    width:       size,
                    height:      size,
                    borderWidth: i === 0 ? 3 : 2.5,
                  }}
                  onMouseDown={e => handleOrbDown(e, orb.id)}
                />
              )
            })}
          </div>

          {/* ── Presets ── */}
          <div className={`${s.presets} scrollbar-none`}>
            {/* Neutral / theme-less option */}
            <button
              className={`${s.preset} ${s.presetNone} ${theme.hue === null ? s.presetActive : ''}`}
              title="None"
              onClick={() => onChange({ hue: null, orbs: [] })}
            />

            {PRESETS.map(p => {
              const isActive = theme.hue !== null && Math.abs(((theme.hue - p.hue + 540) % 360) - 180) < 10
              return (
                <button
                  key={p.hue}
                  className={`${s.preset} ${isActive ? s.presetActive : ''}`}
                  style={{ background: `oklch(72% 0.18 ${p.hue})` }}
                  title={p.label}
                  onClick={() => onChange({ hue: p.hue, orbs: orbsForHue(p.hue) })}
                />
              )
            })}
          </div>

          {/* ── Light / Auto / Dark mode selector ── */}
          <div className={s.modeFooter}>
            <div className={s.modeSegment}>
              {([
                { value: 'light',  label: 'Light',  icon: <SegSunIcon /> },
                { value: 'system', label: 'Auto',   icon: <SegAutoIcon /> },
                { value: 'dark',   label: 'Dark',   icon: <SegMoonIcon /> },
              ] as const).map(({ value, label, icon }) => (
                <button
                  key={value}
                  className={`${s.modeBtn} ${colorPref === value ? s.modeBtnActive : ''}`}
                  onClick={() => onSetColorPref(value)}
                >
                  {icon}
                  <span>{label}</span>
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
function DiceIcon()    { return <Dices   size={14} strokeWidth={1.5} /> }
