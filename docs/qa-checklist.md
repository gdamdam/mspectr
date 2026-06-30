# QA checklist

Manual release QA for mspectr. Run this matrix on real devices before tagging a
release — the audio path, permissions, and PWA behavior cannot be fully covered
by unit tests. Check each item per browser/platform.

## Browser / platform matrix

Run the functional checks below on each cell:

| Browser  | Desktop | Mobile |
| -------- | :-----: | :----: |
| Chrome   |   ☐     |   ☐    |
| Safari   |   ☐     |   ☐    |
| Firefox  |   ☐     |   ☐    |
| Edge     |   ☐     |   ☐    |

(Note: tab/system-audio capture and some MIDI features are not available on every
browser — record N/A where unsupported. TBD — lead to confirm the supported-cell
list.)

## Sources

- [ ] Generated source (internal test tone / buffer) analyzes and displays.
- [ ] Audio **file** load → analyzes and displays a live spectrum.
- [ ] **Microphone** source (after permission grant) analyzes and displays.
- [ ] **USB audio interface** input selected and analyzed.
- [ ] **Tab / system audio** capture (where supported) analyzes and displays.
- [ ] Switching sources mid-session does not glitch or leak the previous source.

## Permissions & devices

- [ ] Permission is requested only **after an explicit action**, never on load.
- [ ] **Permission denial** is handled gracefully (clear message, no crash, app
      remains usable with other sources).
- [ ] **Device disconnect** (unplug mic/interface mid-use) is handled gracefully.
- [ ] Re-granting / reconnecting recovers without a reload.

## Monitoring & safety

- [ ] Monitoring is **muted by default** when a live input is enabled.
- [ ] **Headphone/monitor safety:** no sudden loud output on enable, capture, or
      first note; limiter ceiling (−1 dBFS) holds.
- [ ] No runaway feedback when mic + monitoring are both on through speakers.

## Capture, morph & performance

- [ ] **Snapshot capture** to slot A and slot B works from each source type.
- [ ] **A/B morph** sweeps smoothly between snapshots.
- [ ] Spectral operations (freeze, shift, formant, blur, tilt, gate, harmonize,
      phase-motion) each audibly affect the sound.
- [ ] Macros (BODY / MOTION / HARMONY / SPACE) and the XY surface drive params
      live; macro-takeover behaves correctly when a macro is unlinked.
- [ ] **Polyphonic keyboard** — multiple simultaneous notes sound correctly up to
      the mode's voice limit.
- [ ] **Latency** is acceptable for live play in each quality mode (ECO/NORMAL/HIGH).

## MIDI

- [ ] **Physical MIDI** keyboard plays notes.
- [ ] **Sustain** pedal works.
- [ ] **Pitch bend** works.
- [ ] **Ableton Link** tempo sync (if enabled) stays in sync. (TBD — lead to
      confirm Link is in scope for this release.)

## Recording & sharing

- [ ] **Recording** the output captures the performance correctly.
- [ ] Export / import of patches (JSON) round-trips.
- [ ] Patch-only share link round-trips; embedded-snapshot link shows size,
      enforces the size limit, and validates on decode.
- [ ] Live-derived snapshot sharing requires explicit consent.

## PWA / offline

- [ ] App is **installable** (manifest + icons resolve; install prompt appears).
- [ ] App loads **offline** after the first visit.
- [ ] **Service-worker update**: deploying a new build updates the app (no stale
      blank page; navigations are network-first).
- [ ] Maskable icon renders correctly within platform masks (no clipping).

## Stability & performance

- [ ] **CPU overload** behavior is graceful (overload indicator fires; no audio
      thread crash) under maximum polyphony in HIGH mode.
- [ ] **Long-session stability** — run for an extended period; no memory growth,
      audio dropouts, or degradation over time.
- [ ] No console errors during a normal session.
