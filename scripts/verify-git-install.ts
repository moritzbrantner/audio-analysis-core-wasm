#!/usr/bin/env bun
// Acceptance check for moritzbrantner/audio-analysis#146: a clean consumer installs this package
// from git at a commit and calls captureMetrics in Bun and in a browser bundle.
//
// Usage:
//   bun run verify:git-install                  # github:moritzbrantner/audio-analysis-core-wasm#<HEAD> (HEAD must be pushed)
//   bun run verify:git-install -- --local       # git+file://<this checkout>#<HEAD> (works before pushing)
//   bun run verify:git-install -- --source <spec>   # any bun dependency spec, e.g. github:owner/repo#<sha>
//   VERIFY_GIT_INSTALL_SOURCE=<spec> bun run verify:git-install
//
// Options/env: --keep (keep the temp consumer), CHROME_PATH (Chromium binary; defaults to the newest
// Playwright headless shell or Chromium in ~/.cache/ms-playwright), AUDIO_ANALYSIS_DIR (local
// audio-analysis clone to read the fixture from instead of raw.githubusercontent.com).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

import {
  FIXTURE_PATH,
  PACKAGE_NAME,
  pinnedCommit,
  readManifest,
  repoRoot,
  upstreamFile,
} from "../tests/support/upstream";

const GITHUB_REPOSITORY = "moritzbrantner/audio-analysis-core-wasm";
const BROWSER_TIMEOUT_MS = 120_000;

class VerifyError extends Error {}

function fail(message: string): never {
  throw new VerifyError(message);
}

function step(message: string) {
  console.log(`\n==> ${message}`);
}

function parseArgs(argv: string[]) {
  let source = process.env.VERIFY_GIT_INSTALL_SOURCE;
  let local = false;
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--source") source = argv[++index] ?? fail("--source needs a dependency spec");
    else if (arg.startsWith("--source=")) source = arg.slice("--source=".length);
    else if (arg === "--local") local = true;
    else if (arg === "--keep") keep = true;
    else fail(`unknown argument ${arg}`);
  }
  if (!source) {
    const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
    if (dirty) {
      console.warn(`warning: the checkout has uncommitted changes; verifying committed HEAD ${head} only`);
    }
    source = local ? `git+file://${repoRoot}#${head}` : `github:${GITHUB_REPOSITORY}#${head}`;
  }
  const commit = source.match(/#([0-9a-f]{40})$/)?.[1];
  if (!commit) fail(`source ${source} must pin a full 40-hex commit after '#'`);
  return { source, commit, keep };
}

function run(command: string, args: string[], cwd: string) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    fail(`\`${command} ${args.join(" ")}\` failed in ${cwd} (exit ${result.status ?? result.signal})`);
  }
}

function findChrome(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) fail(`CHROME_PATH ${fromEnv} does not exist`);
    return fromEnv;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), ".cache/ms-playwright");
  const candidates: Array<[number, string]> = [];
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      const revision = Number(dir.match(/-(\d+)$/)?.[1] ?? Number.NaN);
      for (const binary of [
        `${dir}/chrome-headless-shell-linux64/chrome-headless-shell`,
        `${dir}/chrome-linux64/chrome`,
        `${dir}/chrome-linux/chrome`,
      ]) {
        if (dir.startsWith("chromium") && existsSync(join(cache, binary))) {
          candidates.push([revision, join(cache, binary)]);
        }
      }
    }
  }
  // Newest revision first; within a revision prefer the headless shell.
  const shell = (path: string) => Number(path.includes("headless-shell"));
  candidates.sort((a, b) => b[0] - a[0] || shell(b[1]) - shell(a[1]));
  return (
    candidates[0]?.[1] ??
    fail(`no Chromium found in ${cache}; install one (bunx playwright install chromium) or set CHROME_PATH`)
  );
}

// The checks run in the consumer, importing the installed package by its name.
const BUN_CHECK = `
import * as api from "${PACKAGE_NAME}";
import fixtures from "./fixture.json";

const failures = [];
for (const name of ["init", "packageSurface", "runOperation", "captureMetrics"]) {
  if (typeof api[name] !== "function") failures.push(\`missing export \${name}\`);
}
if (failures.length === 0) {
  await api.init();
  const surface = await api.packageSurface();
  if (surface?.library !== "moenarch-audio-analysis-core" || !Array.isArray(surface.operations)) {
    failures.push(\`unexpected packageSurface(): \${JSON.stringify(surface)?.slice(0, 200)}\`);
  }
  const operation = surface?.operations?.find((candidate) => candidate.id !== "describe");
  if (operation) {
    const response = await api.runOperation({ operation: operation.id, input: operation.exampleRequest });
    if (response?.operation !== operation.id) failures.push(\`runOperation(\${operation.id}) answered \${response?.operation}\`);
  }
  for (const fixture of fixtures.cases) {
    const metrics = await api.captureMetrics(
      Float32Array.from(fixture.samples), fixture.sampleRate, fixture.channels, fixture.options);
    for (const [key, want] of Object.entries(fixture.expected)) {
      const got = metrics?.[key];
      if (typeof got !== "number" || !(Math.abs(got - want) <= fixtures.tolerance)) {
        failures.push(\`\${fixture.name}: \${key} expected \${want}, got \${got}\`);
      }
    }
  }
  try {
    await api.captureMetrics([], 0, 1);
    failures.push("captureMetrics accepted sampleRate 0");
  } catch (error) {
    if (!(error instanceof RangeError)) failures.push(\`sampleRate 0 threw \${error}, not RangeError\`);
  }
}
if (failures.length > 0) {
  console.error(failures.join("\\n"));
  process.exit(1);
}
console.log(\`bun: captureMetrics matched \${fixtures.cases.length} fixture cases\`);
`;

const BROWSER_ENTRY = `
import { captureMetrics, init } from "${PACKAGE_NAME}";
import fixtures from "./fixture.json";

async function report(body) {
  await fetch("/result", { method: "POST", body: JSON.stringify(body) });
}
window.addEventListener("error", (event) => report({ ok: false, failures: [\`page error: \${event.message}\`] }));
window.addEventListener("unhandledrejection", (event) =>
  report({ ok: false, failures: [\`unhandled rejection: \${event.reason}\`] }));

try {
  await init();
  const failures = [];
  for (const fixture of fixtures.cases) {
    const metrics = await captureMetrics(
      Float32Array.from(fixture.samples), fixture.sampleRate, fixture.channels, fixture.options);
    for (const [key, want] of Object.entries(fixture.expected)) {
      const got = metrics?.[key];
      if (typeof got !== "number" || !(Math.abs(got - want) <= fixtures.tolerance)) {
        failures.push(\`\${fixture.name}: \${key} expected \${want}, got \${got}\`);
      }
    }
  }
  await report({ ok: failures.length === 0, cases: fixtures.cases.length, failures });
} catch (error) {
  await report({ ok: false, failures: [\`\${error?.stack ?? error}\`] });
}
`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".map": "application/json",
};

async function verifyBrowser(consumer: string) {
  const dist = join(consumer, "dist");
  run("bun", ["build", "./browser-entry.js", "--target", "browser", "--outdir", "./dist"], consumer);
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>verify</title><script type="module" src="./browser-entry.js"></script>\n',
  );

  const missing: string[] = [];
  let settle!: (value: { ok: boolean; cases?: number; failures: string[] }) => void;
  const result = new Promise<{ ok: boolean; cases?: number; failures: string[] }>((resolveResult) => {
    settle = resolveResult;
  });
  // Serves only the bundle output: everything the page needs must be emitted by the bundler.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/result" && request.method === "POST") {
        settle(JSON.parse(await request.text()));
        return new Response("ok");
      }
      const path = resolve(dist, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
      if (!path.startsWith(dist + sep) || !existsSync(path)) {
        if (url.pathname !== "/favicon.ico") missing.push(url.pathname);
        return new Response("not found", { status: 404 });
      }
      return new Response(Bun.file(path), {
        headers: { "content-type": MIME[extname(path)] ?? "application/octet-stream" },
      });
    },
  });

  const chrome = findChrome();
  const pageUrl = `http://127.0.0.1:${server.port}/`;
  console.log(`$ ${chrome} --headless ${pageUrl}`);
  const browser = spawn(
    chrome,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      pageUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  browser.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const exited = new Promise<never>((_, reject) =>
    browser.on("exit", (code) => reject(new VerifyError(`Chromium exited early (${code}):\n${stderr}`))),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new VerifyError(
            `browser page reported nothing within ${BROWSER_TIMEOUT_MS / 1000}s` +
              (missing.length ? `; missing files: ${missing.join(", ")}` : ""),
          ),
        ),
      BROWSER_TIMEOUT_MS,
    );
  });
  try {
    const outcome = await Promise.race([result, exited, timeout]);
    const failures = [...outcome.failures];
    if (missing.length) failures.push(`bundle requested files it did not emit: ${missing.join(", ")}`);
    if (!outcome.ok || failures.length) fail(`browser bundle check failed:\n  ${failures.join("\n  ")}`);
    console.log(`browser: captureMetrics matched ${outcome.cases} fixture cases`);
  } finally {
    clearTimeout(timer);
    browser.removeAllListeners("exit");
    browser.kill("SIGKILL");
    server.stop(true);
  }
}

async function main() {
  const { source, commit, keep } = parseArgs(process.argv.slice(2));
  const consumer = mkdtempSync(join(tmpdir(), "aacw-consumer-"));
  if (consumer.startsWith(repoRoot + sep)) fail("the consumer must live outside this repository");
  console.log(`source: ${source}\nconsumer: ${consumer}`);
  try {
    step("Create a clean consumer and install the package from git");
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify(
        { name: "aacw-clean-consumer", private: true, type: "module", trustedDependencies: [PACKAGE_NAME] },
        null,
        2,
      )}\n`,
    );
    run("bun", ["add", source], consumer);

    const installedDir = join(consumer, "node_modules", ...PACKAGE_NAME.split("/"));
    if (!existsSync(join(installedDir, "package.json"))) fail(`${PACKAGE_NAME} is not in node_modules`);
    const installed = readManifest(installedDir);
    if (installed.name !== PACKAGE_NAME) fail(`installed package is named ${installed.name}`);
    const consumerManifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
    const recorded: string = consumerManifest.dependencies?.[PACKAGE_NAME] ?? "";
    if (!recorded.endsWith(`#${commit}`)) {
      fail(`consumer package.json records ${JSON.stringify(recorded)}, not a pin to ${commit}`);
    }
    const lock = readFileSync(join(consumer, "bun.lock"), "utf8");
    if (!lock.includes(commit)) fail(`consumer bun.lock does not pin ${commit}`);

    const pinned = pinnedCommit(installed);
    step(`Fetch ${FIXTURE_PATH} at the pinned audio-analysis commit ${pinned}`);
    writeFileSync(join(consumer, "fixture.json"), await upstreamFile(pinned, FIXTURE_PATH));

    step("Call captureMetrics from Bun");
    writeFileSync(join(consumer, "bun-check.js"), BUN_CHECK);
    run("bun", ["run", "./bun-check.js"], consumer);

    step("Bundle for the browser and call captureMetrics in headless Chromium");
    writeFileSync(join(consumer, "browser-entry.js"), BROWSER_ENTRY);
    await verifyBrowser(consumer);

    console.log(`\nverify:git-install passed for ${source} (audio-analysis ${pinned})`);
  } finally {
    if (keep) console.log(`kept consumer at ${consumer}`);
    else rmSync(consumer, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nverify:git-install FAILED: ${error instanceof VerifyError ? error.message : error}`);
  process.exit(1);
}
