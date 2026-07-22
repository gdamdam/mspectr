# Changelog

All notable changes to mspectr are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-07-22

### Changed
- **Source monitoring off by default**: generated-source monitoring previously
  defaulted on, mixing the raw generator into the output at −3 dB and bypassing
  every spectral preset — which made presets sound alike. A new user now hears
  the processed instrument; a persisted monitor preference is still honoured, and
  microphone/tab feedback protections are unchanged.
- **Presets span all fourteen generated sources**: the 23 factory presets were
  redistributed from four generators to all fourteen (glass-harmonica, singing-bowl,
  brass-swell, vowel-voice, reed-organ, fm-bell, gong, bowed-metal, tanpura, air-pad,
  plus the original harmonic-string, breath-choir, metallic-strike, and noise-reed).
  Each preset's source now matches its name, hint, group, envelope, and intended
  character; `calibrationDb` trims were retuned so presets stay level-matched.

### Fixed
- **Preset selection no longer keeps stale spectra**: selecting a factory preset
  now clears both A and B snapshots — UI metadata, the cached snapshot data, and
  the worklet slot state (plus any in-flight audition) — so the preset's own live
  source is actually heard. Choosing a standalone built-in sound preserves
  snapshots, and loading a saved session/instrument restores its snapshots as
  before. Engine slots are cleared imperatively before the source swap is posted,
  avoiding a race between React state and worklet commands.
- **Capture stays explicit**: a preset's `captureStrategy` only preselects the
  capture mode; nothing is captured until the player presses Capture. Copy and a
  preset hint that implied an evolving capture was already present were corrected,
  and evolving controls remain functional after a capture.

### Tests
- Preset-diversity validation now compares the EFFECTIVE resolved parameters
  (`resolveParams(patch, xyMapping)`, after linked macros + XY takeover), asserts
  no two presets share an identical effective signature, reports the closest pair
  for review, and requires all fourteen generators to be represented. Added
  lightweight rendered-audio feature checks (zero-crossing brightness, autocorrelation
  tonality, transient/steady ratio) confirming the preset sources are acoustically
  diverse, integration tests for the snapshot-clearing semantics, and a
  monitor-default test.

## [1.3.0] - 2026-07-22

### Added
- **Honest session source recall**: saved sessions and the last-session autosave
  now persist the active source's identity. Generated sources are reacquired by
  id on load so the audio graph matches the label; microphone/tab/file sources
  (which browsers cannot reacquire after a reload) surface a clear "reselect an
  input" prompt instead of silently showing a stale label, while their captured
  snapshots stay playable. Legacy records are migrated by inferring the generated
  source behind the patch's preset.
- **Recorder auto-completion**: hitting the recording duration cap now finalizes
  exactly once, clears the recording state, downloads the WAV, and shows a
  limit-reached notice — no more UI stuck in "recording" with a buffered file.

### Fixed
- **Real overload detection**: the spectral worklet now reports measured render
  load (render time vs the real-time deadline, accumulated per telemetry window)
  with EMA smoothing and hysteresis, emitting overload only on transitions —
  replacing the `activeVoices / 8` placeholder that never reflected real cost.
- **Worklet input validation**: parameters are re-sanitized at the worklet
  boundary and snapshots are validated (FFT/bin/frame bounds, array lengths,
  non-finite coercion) before the engine indexes or resamples them; malformed
  messages are ignored.
- **Preset fields applied**: selecting a preset now applies its `captureStrategy`
  (seeding the capture mode) and its `calibrationDb` loudness trim on a dedicated
  instrument-bus gain, kept separate from the patch's output trim.
- **Snapshot copy provenance**: copying a snapshot A→B now preserves `capturedAt`.
- **Recorder worklet traffic**: audio chunks are batched (~2048-frame windows)
  instead of one message + allocation per render quantum.

### Changed
- **Live-buffer telemetry**: `liveBufferSeconds` now reports the true retained
  analysis window (one FFT frame) instead of a fabricated 4-second constant.
- **Privacy wording**: snapshot documentation no longer claims the source "cannot
  be reconstructed" — it describes snapshots as lossy derived spectral data from
  which approximate, potentially recognizable reconstruction is possible.
- **Docs**: corrected the generated-source (14), preset (23), and test counts;
  a test now guards the source/preset counts against future drift.

## [1.2.7] - 2026-07-13

### Fixed
- **Mic acquisition cancellation**: switching source (or tearing down) while a
  microphone request was still pending no longer leaves the resolved stream hot
  and orphaned (mic indicator stuck on, device locked). A superseded in-flight
  acquisition now stops the stream's tracks immediately and resolves as a
  cancellation instead of surfacing a false "microphone denied" error.

## [1.2.3] - 2026-07-08

### Fixed
- **Keyboard a11y**: pressing Space while a button or select is focused now
  activates/opens that control natively instead of toggling spectral freeze.

## [1.2.2] - 2026-07-07

### Changed
- Docs: README polish — corrected the passing-test count and version badge.

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
