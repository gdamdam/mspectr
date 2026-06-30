# mspectr

**Capture a sound. Play what it is made of.**

mspectr is a browser-native spectral resynthesis and performance instrument. It
listens to a sound, analyzes its spectrum in real time, captures it, and lets you
play that spectrum back at note pitches — morphing, shifting, blurring, and
re-coloring it as you perform. It is part of the [mpump](https://github.com/gdamdam)
suite of browser instruments.

Live: **https://mspectr.mpump.live**

## What it is

- A real-time spectral analyzer: a single AudioWorklet runs STFT analysis on any
  source and produces a live spectrum for display and capture.
- A resynthesis instrument: captured spectra become **Snapshots A/B** that you
  play polyphonically via the keyboard, with a chain of spectral operations
  (freeze, morph, shift, formant, blur, tilt, gate, harmonize, phase-motion),
  a stereo + reverb space stage, and a stereo-linked limiter.
- A performance surface: four macros (BODY / MOTION / HARMONY / SPACE) and an XY
  pad resolve to concrete parameters and drive the engine live.
- An installable PWA that works fully offline after the first visit.

## What it is not

- Not a sampler or looper — it stores **spectra** (magnitude + optional phase),
  never raw audio.
- Not a cloud product — there are **no accounts, cookies, ads, or telemetry**, and
  nothing is uploaded. Everything runs locally in your browser.
- Not a DAW — it is a focused instrument, not a multitrack environment.

## Quickstart

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server
npm run test     # run the unit/DSP test suite (Vitest)
npm run build    # type-check and produce a production build in dist/
npm run check    # lint + typecheck + test + build (the full CI gate)
```

## Scripts

| Script              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Vite dev server with hot-module reload.                |
| `npm run build`     | `tsc -b` then `vite build` → `dist/`.                  |
| `npm run typecheck` | Type-check the project without emitting.               |
| `npm run test`      | Run the test suite once (Vitest).                      |
| `npm run test:watch`| Run tests in watch mode.                               |
| `npm run lint`      | Lint with ESLint.                                      |
| `npm run check`     | Lint + typecheck + test + build (run before pushing).  |
| `npm run preview`   | Serve the production build locally.                    |

## Browser support

Targets current evergreen browsers with Web Audio API + AudioWorklet:
**Chrome, Edge, Firefox, and Safari** (desktop and mobile). Some capture sources
are platform-limited — for example, tab/system audio capture is not available on
all browsers (TBD — lead to confirm exact support matrix). See
[`docs/qa-checklist.md`](docs/qa-checklist.md) for the device/browser test matrix.

## Privacy

100% local. Microphone and tab audio are used only on your device, monitoring is
muted by default, and permissions are requested only after an explicit action.
Live-derived snapshots require explicit consent before they can be shared. See
[`docs/privacy.md`](docs/privacy.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system architecture and module layering.
- [`docs/dsp.md`](docs/dsp.md) — the spectral DSP pipeline, quality modes, and latency.
- [`docs/privacy.md`](docs/privacy.md) — the local-only privacy model.
- [`docs/qa-checklist.md`](docs/qa-checklist.md) — release QA matrix.

## Deployment

Deployed to **GitHub Pages** at the custom domain `mspectr.mpump.live` (root
deployment, base `/`). Every push to `main` runs the `Deploy to GitHub Pages`
workflow, which builds the app, verifies `dist/CNAME`, and publishes `dist/`.
The `CNAME` file lives in `public/` so Vite copies it into `dist/` on every build.

## License

[AGPL-3.0-or-later](LICENSE). mspectr is part of, and derives from, the mpump
suite — see [`NOTICE`](NOTICE) for attribution.
