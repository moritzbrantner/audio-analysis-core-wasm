// Acceptance (moritzbrantner/audio-analysis#146): the repository root is the git-installable
// package, pinned to an audio-analysis commit, built by `prepare`, with no npm publishing and no
// repository secrets.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { PACKAGE_NAME, UPSTREAM_REPOSITORY, readManifest, repoRoot } from "./support/upstream";

const manifest = readManifest();

test("the repository root is the @moritzbrantner/audio-analysis-core-wasm ES module package", () => {
  expect(manifest.name).toBe(PACKAGE_NAME);
  expect(manifest.type).toBe("module");
});

test("the package is installable by consumers: not private, no publish config or registry", () => {
  expect(manifest.private).not.toBe(true);
  expect(manifest.publishConfig).toBeUndefined();
  expect(JSON.stringify(manifest)).not.toMatch(/registry|npm\.pkg\.github\.com/i);
});

test("package.json pins the audio-analysis source by a full commit SHA", () => {
  expect(manifest.audioAnalysis?.repository).toBe(UPSTREAM_REPOSITORY);
  expect(manifest.audioAnalysis?.commit).toMatch(/^[0-9a-f]{40}$/);
});

test("a git install builds the package through a prepare script and `bun run build`", () => {
  expect(typeof manifest.scripts?.prepare).toBe("string");
  expect(manifest.scripts!.prepare!.trim()).not.toBe("");
  expect(typeof manifest.scripts?.build).toBe("string");
  expect(manifest.scripts!.build!.trim()).not.toBe("");
});

test('the "." export declares types and an import entry, both shipped by `files`', () => {
  const dot = (manifest.exports as Record<string, unknown> | undefined)?.["."] as
    | Record<string, string>
    | undefined;
  expect(dot, 'package.json exports["."]').toBeDefined();
  expect(typeof dot!.types).toBe("string");
  expect(typeof (dot!.import ?? dot!.default)).toBe("string");
  if (manifest.files !== undefined) {
    const shipped = (target: string) =>
      manifest.files!.some((entry) => {
        const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
        const path = target.replace(/^\.\//, "");
        return path === normalized || path.startsWith(`${normalized}/`);
      });
    for (const target of [dot!.types!, (dot!.import ?? dot!.default)!]) {
      expect(shipped(target), `files covers ${target}`).toBe(true);
    }
  }
});

const trackedFiles = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "" && !path.startsWith("tests/") && existsSync(join(repoRoot, path)));

function textOf(path: string): string | undefined {
  const buffer = readFileSync(join(repoRoot, path));
  return buffer.includes(0) ? undefined : buffer.toString("utf8");
}

test("no tracked file needs repository secrets or registry tokens", () => {
  const offenders: string[] = [];
  for (const path of trackedFiles) {
    const text = textOf(path);
    if (text === undefined) continue;
    const match = text.match(
      /\$\{\{\s*secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|GH_PACKAGES_TOKEN|_authToken/,
    );
    if (match) offenders.push(`${path}: ${match[0]}`);
  }
  expect(offenders).toEqual([]);
});

test("nothing publishes the package to a registry", () => {
  const publish = /\b(?:npm|bun|pnpm|yarn)\s+publish\b|changeset\s+publish|wasm-pack\s+publish/;
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    expect(command, `script ${name}`).not.toMatch(publish);
  }
  expect(Object.keys(manifest.scripts ?? {})).not.toContain("publish");
  const offenders = trackedFiles
    .filter((path) => path.startsWith(".github/") || path.startsWith("scripts/"))
    .filter((path) => publish.test(textOf(path) ?? ""));
  expect(offenders).toEqual([]);
});
