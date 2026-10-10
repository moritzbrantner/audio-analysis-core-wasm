// Distribution entry of @moritzbrantner/audio-analysis-core-wasm. The API mirrors
// packages/audio-analysis-core-wasm/index.js of the pinned audio-analysis commit; `bun run build`
// generates ./pkg (wasm-bindgen glue plus the inlined .wasm bytes) and ./index.d.ts from there.
// The glue and the bytes are imported statically so that bundlers include them: a browser bundle
// needs no separately served .wasm file.
import initWasm, * as bindings from "./pkg/moenarch_audio_analysis_core_wasm.js";
import wasmBytes from "./pkg/wasm-bytes.js";

let wasmModulePromise;

export async function init() {
  wasmModulePromise ??= initWasm({ module_or_path: wasmBytes }).then(() => bindings);
  return wasmModulePromise;
}

export async function packageSurface() {
  const module = await init();
  return module.packageSurface();
}

export async function runOperation(request) {
  const module = await init();
  return module.runOperation(request);
}

export async function captureMetrics(samples, sampleRate, channels = 1, options) {
  // wasm-bindgen wraps out-of-range numbers into u32/u16 instead of rejecting them.
  requireInteger("sampleRate", sampleRate, 1, 0xffff_ffff);
  requireInteger("channels", channels, 1, 0xffff);
  const module = await init();
  const pcm = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  return module.captureMetrics(pcm, sampleRate, channels, options);
}

function requireInteger(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
}
