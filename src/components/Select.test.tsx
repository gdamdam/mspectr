// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from './Select'
import type { SelectGroup, SelectOption } from './Select'

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
]

const GROUPS: SelectGroup[] = [
  { label: 'Vowels', options: [{ value: 'a', label: 'Ay' }] },
  {
    label: 'Consonants',
    options: [
      { value: 'b', label: 'Bee' },
      { value: 'c', label: 'Cee' },
    ],
  },
]

/** Controlled harness so onChange updates the displayed value like real usage. */
function Harness(props: Partial<React.ComponentProps<typeof Select>> & { onChange?: (v: string) => void }) {
  const [value, setValue] = useState(props.value ?? '')
  return (
    <Select
      ariaLabel="Test select"
      value={value}
      onChange={(v) => {
        setValue(v)
        props.onChange?.(v)
      }}
      options={props.groups ? undefined : (props.options ?? OPTIONS)}
      groups={props.groups}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  )
}

beforeEach(() => cleanup())

describe('Select', () => {
  it('trigger has an accessible name and shows the selected label', () => {
    render(<Harness value="b" />)
    const trigger = screen.getByRole('button', { name: 'Test select' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveTextContent('Bravo')
  })

  it('shows the placeholder when the value is empty or not found', () => {
    render(<Harness value="" placeholder="Pick one…" />)
    expect(screen.getByRole('button', { name: 'Test select' })).toHaveTextContent('Pick one…')
  })

  it('opens the listbox on click', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" />)
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // The current value is marked selected.
    expect(screen.getByRole('option', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens on ArrowDown from the trigger', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" />)
    const trigger = screen.getByRole('button', { name: 'Test select' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('moves the active option with ArrowDown/ArrowUp', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" />)
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    const listbox = screen.getByRole('listbox')
    // Opens with the selected option (Alpha) active.
    expect(listbox).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Alpha/ }).id)
    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Bravo/ }).id)
    await user.keyboard('{ArrowUp}')
    expect(listbox).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Alpha/ }).id)
  })

  it('Home/End jump to the first/last option', async () => {
    const user = userEvent.setup()
    render(<Harness value="b" />)
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    const listbox = screen.getByRole('listbox')
    await user.keyboard('{End}')
    expect(listbox).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Charlie/ }).id)
    await user.keyboard('{Home}')
    expect(listbox).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Alpha/ }).id)
  })

  it('Enter selects the active option, fires onChange, and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness value="a" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Test select' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}') // Bravo
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveTextContent('Bravo')
    expect(trigger).toHaveFocus()
  })

  it('selects an option on pointer click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness value="a" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    await user.click(screen.getByRole('option', { name: /Charlie/ }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape closes without changing the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness value="a" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Test select' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('closes on outside click', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Harness value="a" />
        <button type="button">outside</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders group headers and options in grouped mode', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" groups={GROUPS} />)
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveAttribute('aria-label', 'Vowels')
    expect(groups[1]).toHaveAttribute('aria-label', 'Consonants')
    expect(within(groups[1]).getAllByRole('option')).toHaveLength(2)
    // The visible header text is present.
    expect(screen.getByText('Consonants')).toBeInTheDocument()
  })

  it('does not select a disabled option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Bravo', disabled: true },
          { value: 'c', label: 'Charlie' },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    // Clicking the disabled option does nothing.
    await user.click(screen.getByRole('option', { name: /Bravo/ }))
    expect(onChange).not.toHaveBeenCalled()
    // Keyboard skips it: ArrowDown from Alpha lands on Charlie.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /Charlie/ }).id,
    )
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" disabled />)
    const trigger = screen.getByRole('button', { name: 'Test select' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('typeahead jumps to a matching label', async () => {
    const user = userEvent.setup()
    render(<Harness value="a" />)
    await user.click(screen.getByRole('button', { name: 'Test select' }))
    await user.keyboard('c')
    expect(screen.getByRole('listbox')).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /Charlie/ }).id,
    )
  })
})
