/**
 * Select — an accessible listbox dropdown that replaces native `<select>`.
 *
 * Native `<select>` popups are drawn by the OS and cannot be styled, so the OPEN
 * menu looks different on every browser/OS. This component renders its own popup
 * (a `role="listbox"`) positioned under a trigger button, so the open state is
 * identical everywhere and carries the Emission Lines identity. It follows the
 * WAI-ARIA "Select-Only Combobox" / listbox pattern for keyboard + screen readers.
 *
 * UI-only: it emits `onChange(value)` exactly like the field it replaces.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}
export interface SelectGroup {
  label: string
  options: SelectOption[]
}
export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
  ariaLabel?: string
  id?: string
  disabled?: boolean
  className?: string
}

/** Flatten groups/options into a single ordered list for keyboard traversal. */
function flatten(options?: SelectOption[], groups?: SelectGroup[]): SelectOption[] {
  if (groups) return groups.flatMap((g) => g.options)
  return options ?? []
}

/** Index of the first non-disabled option, or -1 if none. */
function firstEnabled(list: SelectOption[]): number {
  return list.findIndex((o) => !o.disabled)
}
/** Index of the last non-disabled option, or -1 if none. */
function lastEnabled(list: SelectOption[]): number {
  for (let i = list.length - 1; i >= 0; i--) if (!list[i].disabled) return i
  return -1
}
/** Next non-disabled index from `from` in `dir` (+1/-1), wrapping around. */
function step(list: SelectOption[], from: number, dir: 1 | -1): number {
  if (list.length === 0) return -1
  let i = from
  for (let n = 0; n < list.length; n++) {
    i = (i + dir + list.length) % list.length
    if (!list[i].disabled) return i
  }
  return from
}

export function Select({
  value,
  onChange,
  options,
  groups,
  placeholder,
  ariaLabel,
  id,
  disabled,
  className,
}: SelectProps): React.JSX.Element {
  const reactId = useId()
  const baseId = id ?? reactId
  const listboxId = `${baseId}-listbox`
  const optionId = (i: number) => `${baseId}-opt-${i}`

  const flat = useMemo(() => flatten(options, groups), [options, groups])
  const selectedIndex = useMemo(() => flat.findIndex((o) => o.value === value), [flat, value])
  const selected = selectedIndex >= 0 ? flat[selectedIndex] : undefined

  const [open, setOpen] = useState(false)
  // Index into `flat` for the keyboard-active (aria-activedescendant) option.
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const optionRefs = useRef<(HTMLLIElement | null)[]>([])
  // Typeahead buffer + its reset timer.
  const typeahead = useRef<{ query: string; timer: number | null }>({ query: '', timer: null })

  const openMenu = useCallback(
    (preferEnd = false) => {
      if (disabled) return
      const start = selectedIndex >= 0 ? selectedIndex : preferEnd ? lastEnabled(flat) : firstEnabled(flat)
      setActiveIndex(start)
      setOpen(true)
    },
    [disabled, flat, selectedIndex],
  )

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const selectAt = useCallback(
    (index: number) => {
      const opt = flat[index]
      if (!opt || opt.disabled) return
      // Emit only on an actual change to match native <select> semantics.
      if (opt.value !== value) onChange(opt.value)
      closeMenu()
    },
    [flat, value, onChange, closeMenu],
  )

  // Close on outside pointerdown. Listener lives only while open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, closeMenu])

  // Keep the active option scrolled into view (also on open). Guarded because
  // jsdom (tests) does not implement scrollIntoView.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  // Clear any pending typeahead timer on unmount.
  useEffect(
    () => () => {
      if (typeahead.current.timer != null) window.clearTimeout(typeahead.current.timer)
    },
    [],
  )

  const runTypeahead = useCallback(
    (char: string) => {
      const t = typeahead.current
      if (t.timer != null) window.clearTimeout(t.timer)
      t.query += char.toLowerCase()
      t.timer = window.setTimeout(() => {
        t.query = ''
        t.timer = null
      }, 500)
      // Search from just after the active option so repeated keys cycle matches.
      const from = activeIndex >= 0 ? activeIndex : 0
      for (let n = 1; n <= flat.length; n++) {
        const i = (from + n) % flat.length
        const o = flat[i]
        if (!o.disabled && o.label.toLowerCase().startsWith(t.query)) {
          setActiveIndex(i)
          return
        }
      }
      // Single repeated char also matches the current one; ignore otherwise.
    },
    [activeIndex, flat],
  )

  // Focus stays on the trigger the whole time (WAI-ARIA select-only combobox
  // pattern): the trigger owns aria-activedescendant and all keyboard handling,
  // so there is no focus juggling between button and list. When closed, keys
  // open the menu; when open, they navigate/select.
  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      switch (e.key) {
        case 'ArrowDown':
        case 'Enter':
        case ' ':
          e.preventDefault()
          openMenu()
          break
        case 'ArrowUp':
          e.preventDefault()
          openMenu(true)
          break
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => step(flat, i < 0 ? -1 : i, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => step(flat, i < 0 ? 0 : i, -1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(firstEnabled(flat))
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(lastEnabled(flat))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (activeIndex >= 0) selectAt(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
      case 'Tab':
        // Let focus leave naturally; just close the popup.
        closeMenu(false)
        break
      default:
        if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          runTypeahead(e.key)
        }
    }
  }

  // Close when focus leaves the whole widget (e.g. Tab, programmatic blur).
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!open) return
    const next = e.relatedTarget as Node | null
    if (next && wrapRef.current?.contains(next)) return
    closeMenu(false)
  }

  const triggerLabelId = `${baseId}-label`
  const hasSelection = Boolean(selected)
  const triggerText = selected?.label ?? placeholder ?? ''

  // Assign option DOM ids sequentially across (grouped or flat) rendering.
  let cursor = -1
  const renderOption = (opt: SelectOption) => {
    cursor += 1
    const i = cursor
    const isSelected = opt.value === value
    const isActive = i === activeIndex
    return (
      <li
        key={`${opt.value}-${i}`}
        ref={(el) => {
          optionRefs.current[i] = el
        }}
        id={optionId(i)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={opt.disabled || undefined}
        className="select-menu__option"
        data-active={isActive || undefined}
        data-selected={isSelected || undefined}
        data-disabled={opt.disabled || undefined}
        // pointerdown (not click) so selection wins the race with the
        // outside-pointerdown close handler and blur.
        onPointerDown={(e) => {
          e.preventDefault()
          if (!opt.disabled) selectAt(i)
        }}
        onMouseEnter={() => {
          if (!opt.disabled) setActiveIndex(i)
        }}
      >
        <span className="select-menu__check" aria-hidden="true">
          {isSelected ? '›' : ''}
        </span>
        <span className="select-menu__optlabel">{opt.label}</span>
      </li>
    )
  }

  return (
    <div className="select-menu" ref={wrapRef} onBlur={onBlur}>
      <button
        type="button"
        ref={triggerRef}
        id={baseId}
        className={className ? `select ${className}` : 'select'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : triggerLabelId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          id={triggerLabelId}
          className={hasSelection ? 'select-menu__value' : 'select-menu__value select-menu__value--placeholder'}
        >
          {triggerText}
        </span>
        <span className="select-menu__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="select-menu__panel"
          aria-label={ariaLabel}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        >
          {groups
            ? groups.map((g) => (
                <li key={g.label} role="group" aria-label={g.label} className="select-menu__group">
                  <span className="select-menu__grouplabel" aria-hidden="true">
                    {g.label}
                  </span>
                  <ul className="select-menu__grouplist" role="presentation">
                    {g.options.map(renderOption)}
                  </ul>
                </li>
              ))
            : flat.map(renderOption)}
        </ul>
      ) : null}
    </div>
  )
}
