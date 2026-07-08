# Architecture

mspectr is a browser-native spectral freeze & performance instrument:
*capture a sound's spectral identity, then play, morph, and shift it.* It stores
and plays spectral snapshots — a frozen frame, or an average of eight — not
time-varying partial tracks. This document describes how the
system is layered. For the DSP itself see [`dsp.md`](dsp.md); for the local-only
data model see [`privacy.md`](privacy.md).

## Layering principle

The audio engine is the seam. The UI, sources, recording, and persistence layers
depend only on a single interface (`src/audio/engineApi.ts`) — never on the
concrete engine or the AudioWorklet — so they build and test independently of the
DSP implementation. The shared data shapes that cross every module boundary live
in `src/audio/contracts.ts` (plain data + pure helpers, no React/DOM/worklet
imports), which makes them safe to import even from inside the worklet.

The main thread never owns audio-rate scheduling. All sample-accurate work runs
in the AudioWorklet; the main thread only resolves performance controls into
concrete parameters and sends them across.

## Components

### Audio engine (AudioWorklet)

A single AudioWorklet runs STFT analysis on the input source, continuously
producing a live spectrum used for both on-screen display and capture. Pressing
keys triggers resynthesis of the `morph(A, B)` spectrum at note pitches via
overlap-add, after the spectral operation chain (see `dsp.md`). The worklet
consumes fully-resolved `SpectralParams` and stays "dumb" about the performance
controls above it.

### Sources

Any source `AudioNode` can be routed into the analysis input: generated buffers,
audio files, microphone, tab/system audio, or a USB audio interface. The engine
connects the node but does not own its lifecycle; passing `null` disconnects.

### Pure DSP core

`src/audio/dsp` is a pure, framework-free DSP core: a custom radix-2 FFT, Hann
windowing, overlap-add, and the spectral operations. It has no React, DOM, or
worklet imports, so it is directly unit-testable in Node (Vitest runs DSP tests
in the `node` environment).

### Performance layer (macros + XY)

Four macros (BODY / MOTION / HARMONY / SPACE) and an XY surface live on the main
thread. They resolve to concrete params before being sent to the worklet,
following the **mgrains macro-takeover model**: hand-edited values remain
authoritative when a macro is unlinked. Resolution happens on the main thread
(e.g. `performance/macros.ts`) so the worklet never has to know about macros.

### Snapshots A/B

A captured spectrum is stored as a `SpectralSnapshot` — derived magnitude (+
optional phase), never the original waveform. Two slots, **A** and **B**, feed
the morph stage. Live-derived snapshots carry a flag so sharing can require
explicit consent.

### Persistence and sharing

- **Persistence:** a versioned IndexedDB store for instruments and snapshots,
  with JSON export/import. Schema versions live in `contracts.ts`.
- **Sharing:** patch-only links by default; opt-in embedded-snapshot links show
  the encoded size, enforce a strict size limit, and are validated on decode.
- **Safety:** every value that can be persisted, shared, or received over
  `postMessage` passes through a sanitizer that clamps ranges and rejects
  non-finite numbers, so malformed input can never reach the DSP loop or allocate
  unbounded buffers.

### PWA shell

- `public/manifest.webmanifest` — installable-app metadata.
- `public/sw.js` — service worker: network-first navigations (offline fallback
  to cached `index.html`), cache-first for hashed `/assets/*`,
  stale-while-revalidate for other same-origin resources (icons, manifest), and
  a bypass for `version.json` and cross-origin requests. On install it precaches
  `index.html` plus the hashed assets listed in `precache-manifest.json` (emitted
  by the Vite build). It uses `skipWaiting` + `clients.claim` and a versioned
  cache name (`mspectr-shell-v1`). The worker is registered from `src/main.tsx`
  on window `load`, in production builds only (`import.meta.env.PROD`); failures
  are non-fatal so the app still works online without offline support.

## Build & deploy

- Vite + React 19 + TypeScript (strict) + Vitest.
- `base: '/'` — root-domain deployment at `mspectr.mpump.live`.
- The Vite build emits `precache-manifest.json` (the content-hashed asset list)
  for the service worker.
- CI runs `npm run check` (lint + typecheck + test + build) on push and PR.
- Deploy publishes `dist/` to GitHub Pages on push to `main`, verifying
  `dist/CNAME` first. See the README deployment section.

## Data-flow summary

```
source AudioNode ─▶ AudioWorklet (STFT analysis) ─▶ live spectrum ─▶ display
                                              └────▶ capture ─▶ Snapshot A/B
macros + XY (main thread) ─▶ resolve ─▶ SpectralParams ─▶ worklet
keyboard ─▶ resynthesis( morph(A,B) ▷ ops chain ▷ space ▷ limiter ) ─▶ output
```
