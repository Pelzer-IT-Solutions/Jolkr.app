import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useContextMenuStore, type ContextMenuEntry } from './context-menu'

beforeEach(() => {
  useContextMenuStore.getState().close()
})

describe('useContextMenuStore.open', () => {
  it('marks the menu open and stores the position + items', () => {
    const items: ContextMenuEntry[] = [
      { label: 'Edit', onClick: vi.fn() },
      { divider: true },
      { label: 'Delete', onClick: vi.fn(), variant: 'danger' },
    ]
    useContextMenuStore.getState().open(120, 240, items)
    const s = useContextMenuStore.getState()
    expect(s.isOpen).toBe(true)
    expect(s.x).toBe(120)
    expect(s.y).toBe(240)
    expect(s.items).toBe(items)
  })

  it('replaces previous items when reopened with new ones', () => {
    useContextMenuStore.getState().open(0, 0, [{ label: 'A', onClick: vi.fn() }])
    useContextMenuStore.getState().open(50, 60, [{ label: 'B', onClick: vi.fn() }])
    const s = useContextMenuStore.getState()
    expect(s.items).toHaveLength(1)
    const item = s.items[0]
    expect('label' in item ? item.label : null).toBe('B')
  })
})

describe('useContextMenuStore.close', () => {
  it('marks the menu closed and clears items (but keeps the last x/y)', () => {
    useContextMenuStore.getState().open(80, 90, [{ label: 'Copy', onClick: vi.fn() }])
    useContextMenuStore.getState().close()
    const s = useContextMenuStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.items).toEqual([])
    expect(s.x).toBe(80)
    expect(s.y).toBe(90)
  })
})
