# Changelog

All notable changes to mspectr are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
