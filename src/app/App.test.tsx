// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { App } from './App'

// jsdom lacks these APIs the App touches on mount; stub them minimally.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App — composition smoke test', () => {
  it('renders the performance screen with a Start audio affordance', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /start audio/i })).toBeInTheDocument()
    // Hero performance surface (the XY pad) is present and labelled for assistive tech.
    expect(screen.getByRole('slider', { name: /performance surface/i })).toBeInTheDocument()
    // The four macros render.
    for (const m of ['BODY', 'MOTION', 'HARMONY', 'SPACE']) {
      expect(screen.getByRole('slider', { name: m })).toBeInTheDocument()
    }
  })

  it('opens the Help dialog and traps it as an accessible modal', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Esc closes it.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('toggling the computer-keyboard switch flips its enabled state', () => {
    render(<App />)
    const toggle = screen.getByRole('checkbox', { name: /playing off|playing enabled/i })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
  })
})
