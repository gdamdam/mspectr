import { describe, it, expect } from 'vitest'
// Import the README as a raw string via Vite (the app deliberately excludes
// @types/node, so we avoid node:fs). `?raw` is typed by vite/client.
import README from '../../README.md?raw'
import { GENERATED_SOURCE_IDS } from '../audio/contracts'
import { PRESETS } from '../performance/presets'

// Guards README counts against drift: adding a generated source or preset must
// be reflected in the docs, or this test fails.

describe('README count references stay in sync with source', () => {
  it('mentions the generated source count', () => {
    const count = GENERATED_SOURCE_IDS.length
    expect(README).toContain(String(count))
  })

  it('mentions the preset count', () => {
    const count = PRESETS.length
    expect(README).toContain(String(count))
  })
})
