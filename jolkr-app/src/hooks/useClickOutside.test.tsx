import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRef } from 'react'
import { renderHook, render, fireEvent } from '@testing-library/react'
import { useClickOutside } from './useClickOutside'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('useClickOutside', () => {
  it('does NOT call onClose for clicks inside the referenced element', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(onClose))

    const inside = document.createElement('div')
    document.body.appendChild(inside)
    result.current.current = inside

    fireEvent.mouseDown(inside)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on a mousedown elsewhere in the document', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(onClose))

    const inside  = document.createElement('div')
    const outside = document.createElement('button')
    document.body.appendChild(inside)
    document.body.appendChild(outside)
    result.current.current = inside

    fireEvent.mouseDown(outside)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('also fires on touchstart (mobile path)', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(onClose))
    const inside = document.createElement('div')
    document.body.appendChild(inside)
    result.current.current = inside

    fireEvent.touchStart(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('treats the optional anchor element as "inside" so toggling stays stable', () => {
    const onClose = vi.fn()

    function Wrapper() {
      const anchorRef = useRef<HTMLButtonElement>(null)
      useClickOutside(onClose, true, anchorRef)
      return <button ref={anchorRef}>toggle</button>
    }

    const { getByRole } = render(<Wrapper />)
    fireEvent.mouseDown(getByRole('button'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does nothing when active is false', () => {
    const onClose = vi.fn()
    renderHook(() => useClickOutside<HTMLDivElement>(onClose, false))

    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes the document listeners on unmount (no late callbacks)', () => {
    const onClose = vi.fn()
    const { result, unmount } = renderHook(() => useClickOutside<HTMLDivElement>(onClose))
    const inside = document.createElement('div')
    document.body.appendChild(inside)
    result.current.current = inside

    unmount()
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})
