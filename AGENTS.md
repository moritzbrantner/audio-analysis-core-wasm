# Agent instructions

This repository distributes `@moritzbrantner/audio-analysis-core-wasm` as a commit-pinnable git dependency.

- The Rust source, the WASM bindings, the JS API and `index.d.ts` are owned by `moritzbrantner/audio-analysis`. `index.js` here only mirrors the upstream wrapper with static imports for bundlers; do not add behavior. Change upstream, then move `audioAnalysis.commit` (see README).
- No npm publishing, no GitHub Packages and no repository secrets.
- Consumers install `github:moritzbrantner/audio-analysis-core-wasm#<commit>` and list the package in `trustedDependencies`.
