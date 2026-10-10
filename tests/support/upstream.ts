// Acceptance helpers: read this package's manifest and fetch files from the pinned
// moritzbrantner/audio-analysis revision, which owns the Rust source, the JS API and the fixtures.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PACKAGE_NAME = "@moritzbrantner/audio-analysis-core-wasm";
export const UPSTREAM_REPOSITORY = "https://github.com/moritzbrantner/audio-analysis";
export const FIXTURE_PATH = "crates/audio/audio-analysis-core/tests/fixtures/capture-metrics.json";
export const UPSTREAM_PACKAGE_DIR = "packages/audio-analysis-core-wasm";

export const repoRoot = resolve(import.meta.dir, "../..");

export interface Manifest {
  name?: string;
  private?: unknown;
  type?: string;
  main?: string;
  types?: string;
  files?: string[];
  exports?: unknown;
  scripts?: Record<string, string>;
  publishConfig?: unknown;
  audioAnalysis?: { repository?: string; commit?: string };
  [key: string]: unknown;
}

export function readManifest(dir = repoRoot): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
}

export function pinnedCommit(manifest: Manifest = readManifest()): string {
  const commit = manifest.audioAnalysis?.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `package.json audioAnalysis.commit must be a 40-hex audio-analysis commit, got ${JSON.stringify(commit)}`,
    );
  }
  return commit;
}

const cache = new Map<string, string>();

/**
 * Reads `path` from moritzbrantner/audio-analysis at `commit`. Uses a local clone when
 * AUDIO_ANALYSIS_DIR is set (offline runs), otherwise raw.githubusercontent.com (public repo).
 */
export async function upstreamFile(commit: string, path: string): Promise<string> {
  const key = `${commit}:${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let text: string;
  const localClone = process.env.AUDIO_ANALYSIS_DIR;
  if (localClone && existsSync(localClone)) {
    text = execFileSync("git", ["-C", localClone, "show", `${commit}:${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } else {
    const url = `https://raw.githubusercontent.com/moritzbrantner/audio-analysis/${commit}/${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`fetching ${url} failed: HTTP ${response.status}`);
    }
    text = await response.text();
  }
  cache.set(key, text);
  return text;
}

export interface CaptureMetricsFixtures {
  tolerance: number;
  cases: Array<{
    name: string;
    sampleRate: number;
    channels: number;
    samples: number[];
    options?: Record<string, number>;
    expected: Record<string, number>;
  }>;
}

export async function captureMetricsFixtures(commit: string): Promise<CaptureMetricsFixtures> {
  const fixtures = JSON.parse(await upstreamFile(commit, FIXTURE_PATH)) as CaptureMetricsFixtures;
  if (!(fixtures.tolerance > 0) || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
    throw new Error(`fixture ${FIXTURE_PATH} at ${commit} has no cases or tolerance`);
  }
  return fixtures;
}

/** Names exported by an ES module source (`export [async] function|const|let|class NAME`). */
export function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

/** Resolves the import target of the package's "." export (or `main`) to an absolute path. */
export function entryPath(manifest: Manifest = readManifest(), dir = repoRoot): string {
  const target = exportTarget(manifest.exports, ["import", "default"]) ?? manifest.main;
  if (typeof target !== "string") {
    throw new Error('package.json has no "." export import target and no main');
  }
  return join(dir, target);
}

/** Resolves the types target of the package's "." export (or `types`) to an absolute path. */
export function typesPath(manifest: Manifest = readManifest(), dir = repoRoot): string {
  const target = exportTarget(manifest.exports, ["types"]) ?? manifest.types;
  if (typeof target !== "string") {
    throw new Error('package.json has no "." export types target and no types');
  }
  return join(dir, target);
}

function exportTarget(exports: unknown, conditions: string[]): string | undefined {
  if (typeof exports === "string") return conditions.includes("types") ? undefined : exports;
  if (!exports || typeof exports !== "object") return undefined;
  const record = exports as Record<string, unknown>;
  const dot = "." in record ? record["."] : record;
  if (typeof dot === "string") return conditions.includes("types") ? undefined : dot;
  if (!dot || typeof dot !== "object") return undefined;
  for (const condition of conditions) {
    const value = (dot as Record<string, unknown>)[condition];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function assertMatchesFixture(
  fixtureName: string,
  metrics: Record<string, unknown>,
  expected: Record<string, number>,
  tolerance: number,
): string[] {
  const failures: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = metrics?.[key];
    if (typeof got !== "number" || !(Math.abs(got - want) <= tolerance)) {
      failures.push(`${fixtureName}: ${key} expected ${want} (±${tolerance}), got ${String(got)}`);
    }
  }
  return failures;
}
