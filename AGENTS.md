# Agent instructions

This repository distributes `@moritzbrantner/audio-analysis-core-wasm` as a commit-pinnable git dependency.

- The Rust source, the WASM bindings and the package's JS API are owned by `moritzbrantner/audio-analysis`. Do not fork or re-implement them here; change them there and move the pinned commit.
- No npm publishing, no GitHub Packages and no repository secrets.
- Consumers install `github:moritzbrantner/audio-analysis-core-wasm#<commit>` and list the package in `trustedDependencies`.
