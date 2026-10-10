// Acceptance (moritzbrantner/audio-analysis#146): after `bun run build`, the package entry exposes
// exactly the JS API of packages/audio-analysis-core-wasm at the pinned audio-analysis commit.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";

import {
  UPSTREAM_PACKAGE_DIR,
  entryPath,
  exportedNames,
  pinnedCommit,
  typesPath,
  upstreamFile,
} from "./support/upstream";

const commit = pinnedCommit();

async function loadEntry(): Promise<Record<string, unknown>> {
  const path = entryPath();
  if (!existsSync(path)) {
    throw new Error(`package entry ${path} is missing; run \`bun run build\` first`);
  }
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

test("the entry exports init, packageSurface, runOperation and captureMetrics", async () => {
  const entry = await loadEntry();
  for (const name of ["init", "packageSurface", "runOperation", "captureMetrics"]) {
    expect(typeof entry[name], name).toBe("function");
  }
});

test("the entry exports the same names as the upstream package at the pinned commit", async () => {
  const entry = await loadEntry();
  const upstream = exportedNames(await upstreamFile(commit, `${UPSTREAM_PACKAGE_DIR}/index.js`));
  expect(upstream).toContain("captureMetrics");
  expect(Object.keys(entry).filter((name) => name !== "default").sort()).toEqual(upstream);
});

test("the shipped type declarations equal the upstream index.d.ts at the pinned commit", async () => {
  const path = typesPath();
  expect(existsSync(path), `${path} exists`).toBe(true);
  const upstream = await upstreamFile(commit, `${UPSTREAM_PACKAGE_DIR}/index.d.ts`);
  expect(readFileSync(path, "utf8")).toBe(upstream);
});

test("captureMetrics rejects sample rates and channel counts the WASM types would wrap", async () => {
  const { captureMetrics } = (await loadEntry()) as {
    captureMetrics: (...args: unknown[]) => Promise<unknown>;
  };
  await expect(captureMetrics([], -1, 1)).rejects.toThrow(RangeError);
  await expect(captureMetrics([], 2 ** 32, 1)).rejects.toThrow(RangeError);
  await expect(captureMetrics([], 16_000.5, 1)).rejects.toThrow(RangeError);
  await expect(captureMetrics([], 16_000, 65_537)).rejects.toThrow(RangeError);
  await expect(captureMetrics([], 16_000, 0)).rejects.toThrow(RangeError);
});
