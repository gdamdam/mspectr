// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../audio/contracts'
import { AdvancedPanel } from './AdvancedPanel'

describe('AdvancedPanel seed editing', () => {
  it('allows a temporary blank and commits only a valid value', () => {
    const onSeed = vi.fn()
    render(
      <AdvancedPanel
        open
        onToggle={() => {}}
        params={DEFAULT_PARAMS}
        quality="normal"
        seed={123}
        onParam={() => {}}
        onQuality={() => {}}
        onSeed={onSeed}
      />,
    )
    const input = screen.getByRole('spinbutton', { name: /deterministic seed/i })
    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue(null)
    expect(onSeed).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input).toHaveValue(123)
    fireEvent.change(input, { target: { value: '456' } })
    fireEvent.blur(input)
    expect(onSeed).toHaveBeenCalledWith(456)
  })
})
