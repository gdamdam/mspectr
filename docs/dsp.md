# DSP pipeline

This document describes the spectral signal processing in mspectr. The DSP core
(`src/audio/dsp`) is pure and framework-free, so each stage is unit-testable in
isolation. See [`architecture.md`](architecture.md) for how the DSP sits relative
to the engine and UI.

## Analysis: STFT

The engine runs a Short-Time Fourier Transform on the input source:

- **FFT** — a custom radix-2 FFT.
- **Window** — Hann window.
- **Overlap** — 75% overlap-add, i.e. the hop is `fftSize / 4`. A Hann window at
  75% overlap satisfies the constant-overlap-add (COLA) condition, so analysis
  and resynthesis reconstruct cleanly.

Analysis runs continuously, producing a live magnitude spectrum used both for the
on-screen display and for capture into snapshots. The display is downsampled to a
fixed bin count for rendering.

## Capture: Snapshots

A captured frame is stored as a `SpectralSnapshot`: derived **magnitude** plus
**optional phase** — never the original waveform. Two slots, **A** and **B**,
feed the morph stage of resynthesis.

## Resynthesis and the operation chain

Pressing keys resynthesizes the `morph(A, B)` spectrum at the requested note
pitches via overlap-add. Before output, the spectrum passes through a fixed chain
of spectral operations:

1. **FREEZE** — hold a captured spectrum; phase is either *locked* (reuse the
   captured phase each frame — stable, can sound static) or *animated*.
2. **MORPH** — interpolate between Snapshot A and Snapshot B.
3. **SHIFT** — frequency shift / transpose of the spectrum.
4. **FORMANT** — independent shaping of the spectral envelope.
5. **BLUR** — smear energy across frequency and/or time.
6. **TILT** — spectral tilt (brighten/darken the balance of high vs. low bins).
7. **GATE** — spectral gating / thresholding of bins.
8. **HARMONIZE** — add harmonically related spectral content.
9. **PHASE-MOTION** — animate phase for movement and de-correlation.

After the chain:

- **SPACE** — a stereo + reverb stage.
- **Limiter** — a stereo-linked limiter with a ceiling of **−1 dBFS**.

(The exact per-operation parameter ranges live in `src/audio/contracts.ts`; this
document describes intent rather than restating every clamp.)

## Quality modes

Three quality modes trade time resolution against frequency resolution and CPU.
The hop is always `fftSize / 4` (75% overlap):

| Mode    | FFT size | Hop  |
| ------- | -------- | ---- |
| ECO     | 1024     | 256  |
| NORMAL  | 2048     | 512  |
| HIGH    | 4096     | 1024 |

Higher FFT sizes give finer **frequency** resolution (narrower bins) at the cost
of coarser **time** resolution (longer analysis window) and more CPU per frame —
the classic STFT time/frequency tradeoff. The mode configs also scale the maximum
simultaneous voices and the UI display refresh rate.

## Latency

Two contributions dominate the analysis-to-output latency:

- the **analysis window**, on the order of `fftSize / sampleRate`, and
- the **hop**, an additional `hopSize / sampleRate` between successive frames.

At a 48 kHz sample rate this gives roughly:

| Mode    | FFT / hop  | ~window (fftSize/sr) | ~hop (hopSize/sr) |
| ------- | ---------- | -------------------- | ----------------- |
| ECO     | 1024 / 256 | ~21 ms               | ~5 ms             |
| NORMAL  | 2048 / 512 | ~43 ms               | ~11 ms            |
| HIGH    | 4096 / 1024| ~85 ms               | ~21 ms            |

So ECO favors responsiveness (lowest latency, coarsest frequency detail) and HIGH
favors spectral detail (finest frequency resolution, highest latency and CPU),
with NORMAL in between. Actual latency also includes the browser's own audio
output buffering, which is platform-dependent (TBD — lead to confirm measured
end-to-end figures per platform).
