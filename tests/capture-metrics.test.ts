// Acceptance (moritzbrantner/audio-analysis#146): the built package runs the WASM of the pinned
// audio-analysis commit and reproduces that commit's shared capture-metrics fixtures.
// Unlike the upstream test this does not skip without a build: a missing build is a failure.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";

import {
  assertMatchesFixture,
  captureMetricsFixtures,
  entryPath,
  pinnedCommit,
} from "./support/upstream";

const commit = pinnedCommit();

interface Api {
  init: () => Promise<unknown>;
  packageSurface: () => Promise<{ library: string; operations: Array<Record<string, unknown>> }>;
  runOperation: (request: { operation: string; input: unknown }) => Promise<{ operation: string }>;
  captureMetrics: (...args: unknown[]) => Promise<Record<string, unknown>>;
}

async function loadEntry(): Promise<Api> {
  const path = entryPath();
  if (!existsSync(path)) {
    throw new Error(`package entry ${path} is missing; run \`bun run build\` first`);
  }
  const api = (await import(pathToFileURL(path).href)) as Api;
  await api.init();
  return api;
}

test("captureMetrics reproduces the shared fixtures of the pinned audio-analysis commit", async () => {
  const { captureMetrics } = await loadEntry();
  const fixtures = await captureMetricsFixtures(commit);
  const failures: string[] = [];
  for (const fixture of fixtures.cases) {
    const metrics = await captureMetrics(
      Float32Array.from(fixture.samples),
      fixture.sampleRate,
      fixture.channels,
      fixture.options,
    );
    failures.push(...assertMatchesFixture(fixture.name, metrics, fixture.expected, fixtures.tolerance));
    // Plain arrays are accepted as well as Float32Array.
    const fromArray = await captureMetrics(
      fixture.samples,
      fixture.sampleRate,
      fixture.channels,
      fixture.options,
    );
    failures.push(
      ...assertMatchesFixture(`${fixture.name} (array)`, fromArray, fixture.expected, fixtures.tolerance),
    );
  }
  expect(failures).toEqual([]);
});

test("captureMetrics rejects unknown options and invalid audio", async () => {
  const { captureMetrics } = await loadEntry();
  await expect(captureMetrics([0], 16_000, 1, { clipLvl: 1 })).rejects.toThrow();
  await expect(captureMetrics([0, 0, 0], 16_000, 2)).rejects.toThrow();
  await expect(captureMetrics([Number.NaN], 16_000, 1)).rejects.toThrow();
});

test("packageSurface and runOperation reach the audio-analysis-core surface", async () => {
  const { packageSurface, runOperation } = await loadEntry();
  const surface = await packageSurface();
  expect(surface.library).toBe("moenarch-audio-analysis-core");
  expect(Array.isArray(surface.operations)).toBe(true);
  const ids = surface.operations.map((operation) => operation.id);
  expect(ids).toContain("audio.captureMetrics");
  const operation = surface.operations.find((candidate) => candidate.id !== "describe")!;
  const response = await runOperation({
    operation: operation.id as string,
    input: operation.exampleRequest,
  });
  expect(response.operation).toBe(operation.id as string);
  await expect(runOperation({ operation: "no.such.operation", input: {} })).rejects.toThrow();
});
