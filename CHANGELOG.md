# Changelog

All notable changes to mspectr are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-07-02

### Added
- **Launch-screen session choice**: when an autosaved session exists, the start
  screen offers an explicit "Continue Last Session" (with its saved timestamp)
  vs "Start Fresh", instead of silently restoring the last patch.

## [1.2.0] - 2026-07-01

### Added
- **Flipbook replay** for evolving snapshots: performer-controlled `Speed`
  (0 = freeze, negative = reverse), `Position` scrub, and a loop sub-range over
  the captured frame sequence. Position/Speed are XY-assignable.
- **Modulation LFO**: one tempo-syncable sine over morph, flipbook position,
  tilt, blur, formant, or shift — so held notes evolve without hand movement.
- **Velocity → brightness** and **key-tracked formant preservation** (high notes
  no longer "chipmunk").
- **Attack transient shaper**: a per-onset noise chiff plus a bright→settled
  tilt, so notes feel played.
- **Tone ↔ noise balance** (mini-SMS): re-weights the sinusoidal peaks against
  the residual between them.
- **Spectral comb** for hollow/vowel-like grouped-partial colour.
- **Space to freeze**: a one-touch keyboard gesture to freeze/unfreeze the live
  spectrum on the fly.
- **Ableton Link**: the localhost bridge is now wired; its tempo drives the LFO
  sync mode, with a compact Link status in the MIDI panel.
- **Continue last session**: the performance patch autosaves and is restored on
  the next visit when no shared link is present.

### Fixed
- Stopped tracking `.claude/settings.local.json`.

## [1.1.2] - 2026-06-30

### Changed
- All dropdowns now use a custom, fully-accessible `Select` listbox instead of
  native `<select>`, so the open popup looks identical on every browser and OS
  (keyboard nav, `aria-activedescendant`, group headers, typeahead, click-outside).

### Fixed
- Test flake: stub `HTMLCanvasElement.getContext` in the test setup (jsdom throws
  "Not implemented" rather than returning null, which intermittently surfaced as
  an unhandled error from the spectral display's render loop).

## [1.1.1] - 2026-06-30

### Changed
- Source panel: split into two labelled groups — Preset (a complete scene) and
  Input source (built-in sound / file / mic / tab) — to make clear they do
  different things.
- Preset list grouped by section via `<optgroup>` with sections and names in
  alphabetical order; built-in Sound list alphabetized; "FM Bell" label fixed.

## [1.1.0] - 2026-06-30

### Added
- Brand mark: the "Dispersion" logo (a beam refracting through a prism into the
  emission-line spectrum) now renders as an inline SVG in the topbar, replacing
  the placeholder aperture slit.
- Hover tooltips (`title=`) explaining what each control does across the topbar
  tools (Sessions, Share, Record, Settings, Help), the brand tagline, and the
  Source, Capture, and PlayBar controls.

## [1.0.0] - 2026-06-30

### Added
- PWA shell: service worker (`public/sw.js`) with network-first navigations,
  cache-first hashed assets, and stale-while-revalidate for icons/manifest;
  offline support after first visit.
- Web app manifest and a spectral-mark icon set (favicon + 192/512/maskable).
- CI workflow (`npm run check`) on push and pull request.
- GitHub Pages deploy workflow for the custom domain `mspectr.mpump.live`,
  including a CNAME verification gate.
- Project documentation: architecture, DSP, privacy, and QA checklist.

## [0.1.0]

### Added
- Initial project scaffold (Vite + React 19 + TypeScript strict + Vitest) and
  the audio engine contracts.
