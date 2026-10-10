# audio-analysis-core-wasm

Git-installable distribution of `@moritzbrantner/audio-analysis-core-wasm`, the WASM package for
`audio-analysis-core` from [moritzbrantner/audio-analysis](https://github.com/moritzbrantner/audio-analysis).
The repository root is the package. It is never published to npm and needs no secrets
(owner decision on moritzbrantner/audio-analysis#146).

## Install

```bash
bun add "github:moritzbrantner/audio-analysis-core-wasm#<commit>"
```

and list the package in the consumer's `package.json`:

```json
{ "trustedDependencies": ["@moritzbrantner/audio-analysis-core-wasm"] }
```

`prepare` then builds the package on install. That needs `git`, `rustup` (the pinned Rust toolchain
and the `wasm32-unknown-unknown` target are installed on first use) and `wasm-pack`. When `wasm-pack`
is not on `PATH`, it is installed once into `~/.cache/audio-analysis-core-wasm` with
`cargo install --locked`.

```js
import { captureMetrics } from "@moritzbrantner/audio-analysis-core-wasm";

const metrics = await captureMetrics(samples, 16_000, 1);
```

The API (`init`, `packageSurface`, `runOperation`, `captureMetrics`) and `index.d.ts` are those of
`packages/audio-analysis-core-wasm` at the pinned audio-analysis commit. See its README for the
`captureMetrics` semantics. The `.wasm` is inlined into the JS module, so browser bundlers need no
extra asset handling.

## Pin and update flow

`package.json` `audioAnalysis.commit` names the exact audio-analysis revision that is built:

1. Change the API, Rust source or fixtures in moritzbrantner/audio-analysis and merge there.
2. In this repository, set `audioAnalysis.commit` to that merged commit and open a PR. If the
   upstream wrapper `index.js` changed, mirror the change in `index.js`; the tests compare export
   names and `index.d.ts` with the pinned commit.
3. After it merges, consumers move their `#<commit>` pin to this repository's new commit.

## Development

```bash
bun run build              # fetch the pinned commit and build pkg/ and index.d.ts
bun run test               # package tests against the shared Rust fixtures
bun run verify:git-install -- --local  # clean consumer: git install, Bun and headless-browser bundle
```

`bun run verify:git-install` without `--local` installs the pushed `HEAD` from GitHub.
