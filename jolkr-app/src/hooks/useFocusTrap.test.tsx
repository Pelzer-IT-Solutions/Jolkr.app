import { describe, it, expect, beforeEach } from 'vitest'
import { useRef } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { useFocusTrap } from './useFocusTrap'

function Trapped({ withFocusables = true }: { withFocusables?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  return (
    <div ref={ref} data-testid="container">
      {withFocusables && (
        <>
          <button data-testid="b1">one</button>
          <button data-testid="b2">two</button>
          <button data-testid="b3">three</button>
        </>
      )}
    </div>
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
  // Establish a "previous focus" element so the cleanup path has somewhere
  // to restore to, mirroring the real-world modal-open scenario.
  const trigger = document.createElement('button')
  trigger.setAttribute('data-testid', 'previous')
  document.body.appendChild(trigger)
  trigger.focus()
})

describe('useFocusTrap', () => {
  it('focuses the first focusable element inside the container on mount', () => {
    const { getByTestId } = render(<Trapped />)
    expect(document.activeElement).toBe(getByTestId('b1'))
  })

  it('wraps Tab from the last element back to the first', () => {
    const { getByTestId } = render(<Trapped />)
    const last = getByTestId('b3')
    last.focus()
    fireEvent.keyDown(getByTestId('container'), { key: 'Tab' })
    expect(document.activeElement).toBe(getByTestId('b1'))
  })

  it('wraps Shift+Tab from the first element back to the last', () => {
    const { getByTestId } = render(<Trapped />)
    const first = getByTestId('b1')
    first.focus()
    fireEvent.keyDown(getByTestId('container'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByTestId('b3'))
  })

  it('does NOT preventDefault for Tab when not on an edge', () => {
    const { getByTestId } = render(<Trapped />)
    const middle = getByTestId('b2')
    middle.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    getByTestId('container').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores non-Tab keys', () => {
    const { getByTestId } = render(<Trapped />)
    const first = getByTestId('b1')
    first.focus()
    fireEvent.keyDown(getByTestId('container'), { key: 'Enter' })
    expect(document.activeElement).toBe(first)
  })

  it('no-ops gracefully when the container has zero focusables', () => {
    const { getByTestId } = render(<Trapped withFocusables={false} />)
    fireEvent.keyDown(getByTestId('container'), { key: 'Tab' })
    // No focusable to land on, but handler must not throw.
    expect(true).toBe(true)
  })

  it('restores focus to the previously-focused element on unmount', () => {
    const previous = document.querySelector<HTMLButtonElement>('[data-testid="previous"]')!
    expect(document.activeElement).toBe(previous)
    const { unmount } = render(<Trapped />)
    unmount()
    expect(document.activeElement).toBe(previous)
  })
})
