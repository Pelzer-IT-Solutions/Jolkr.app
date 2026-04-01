import { useState, useLayoutEffect } from 'react'
import s from './DMInfoPanel.module.css'

interface Props {
  visible: boolean
}

export function DMInfoPanel({ visible }: Props) {
  const [isRevealing, setIsRevealing] = useState(() => visible)

  useLayoutEffect(() => {
    if (!visible) return
    setIsRevealing(true)
    const timer = setTimeout(() => setIsRevealing(false), 300)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <aside className={`${s.panel} ${!visible ? s.hidden : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-tiny txt-semibold`}>Info</span>
      </div>

      <div className={`${s.scroll} scrollbar-thin`}>
        <div
          className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
        >
          Pinned Messages
        </div>
        <div className={`txt-tiny ${s.emptyHint}`} style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>
          No pinned messages yet
        </div>

        <div
          className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
        >
          Shared Files
        </div>
        <div className={`txt-tiny`} style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>
          No shared files yet
        </div>
      </div>
    </aside>
  )
}
