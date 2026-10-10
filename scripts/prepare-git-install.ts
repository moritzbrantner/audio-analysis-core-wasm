#!/usr/bin/env bun

// The `prepare` script. It only builds when the package sits below node_modules, which is where
// bun places a consumer's commit-pinned git dependency (listed in `trustedDependencies`). In a
// normal checkout it does nothing, so `bun install` stays cheap; run `bun run build` there.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (packageRoot.split(path.sep).includes("node_modules")) {
  execFileSync("bun", [path.join(packageRoot, "scripts", "build.ts")], { cwd: packageRoot, stdio: "inherit" });
}
