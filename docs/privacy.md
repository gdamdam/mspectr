# Privacy

mspectr is **100% local**. It is designed so that your audio and your patches
never leave your device unless you explicitly choose to share them.

## What we do not do

- **No accounts.** There is nothing to sign up for or log into.
- **No cookies.** No tracking or session cookies are set.
- **No ads.**
- **No telemetry or analytics.** We do not record usage, errors, or metrics.
- **No uploads.** Audio is never sent to a server. There is no server.

## Audio and permissions

- Microphone and tab/system audio are used **only locally**, on your device, for
  real-time analysis.
- **Monitoring is muted by default**, so enabling a live input does not
  immediately route it to your speakers/headphones (headphone-safety default).
- Permissions (microphone, tab audio) are requested **only after an explicit
  action** — never on page load.
- When you stop using a source, its capture is released.

## Snapshots and sharing

- A snapshot stores **derived spectral data** (magnitude + optional phase),
  **never the original waveform**. You cannot reconstruct the source recording
  from a snapshot.
- Snapshots derived from a **live input** are flagged. Sharing a live-derived
  snapshot requires **explicit consent** before it can be embedded in a link.
- **Patch-only links** are the default share format — they contain instrument
  parameters, not audio data.
- **Embedded-snapshot links** are opt-in: the UI shows the encoded size, enforces
  a strict size limit, and validates the payload on decode so a malformed or
  oversized link can never be loaded.

## Persistence

- Patches and snapshots are stored **locally** in your browser via a versioned
  IndexedDB database.
- You can **export and import** your data as JSON to move it between devices
  yourself — this is a manual, user-initiated transfer, not a sync service.
- Clearing your browser's site data for mspectr removes this local store.

## Offline / installable

mspectr is an installable PWA and works **offline after the first visit**. The
service worker caches the app shell and assets locally; it does not phone home.
The only network requests are for loading and updating the app itself.

> Note: this document describes the intended privacy behavior of the instrument.
> Exact UI copy and consent flows are finalized in the app (TBD — lead to
> confirm final wording).
