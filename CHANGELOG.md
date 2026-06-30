# Changelog

All notable changes to mspectr are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
