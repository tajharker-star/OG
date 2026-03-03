import os from "node:os";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { platforms } from "./release-config.mjs";

function commandPath(name) {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function resolveWineBinary() {
  const homeDir = os.homedir();
  const candidates = [
    process.env.WINE_BIN,
    commandPath("wine64"),
    commandPath("wine"),
    "/Applications/Wine Devel.app/Contents/MacOS/wine",
    "/Applications/Wine Stable.app/Contents/MacOS/wine",
    path.join(homeDir, "Downloads", "Wine Devel.app", "Contents", "MacOS", "wine"),
    path.join(homeDir, "Downloads", "Wine Stable.app", "Contents", "MacOS", "wine"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const windows = platforms.find((platform) => platform.key === "windows");

if (!windows) {
  console.error("Windows platform configuration is missing.");
  process.exit(1);
}

const wineBin = resolveWineBinary();

if (!wineBin) {
  console.log("Packaged Windows smoke test skipped: no Wine binary found on PATH and WINE_BIN is unset.");
  process.exit(0);
}

const timeoutMs = 25000;
const child = spawn(wineBin, [windows.binaryPath], {
  cwd: windows.stageDir,
  env: {
    ...process.env,
    DISABLE_STEAM: "1",
    PORT: "3921",
    SMOKE_TEST: "1",
    WINEDEBUG: process.env.WINEDEBUG || "-all",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let timedOut = false;

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timeout);

  if (timedOut) {
    console.error(`Packaged Windows smoke test timed out after ${timeoutMs}ms.`);
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  if (signal) {
    console.error(`Packaged Windows smoke test ended by signal ${signal}.`);
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  if (code !== 0) {
    console.error(`Packaged Windows smoke test failed with exit code ${code}.`);
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(code ?? 1);
  }

  console.log(`Packaged Windows smoke test passed via ${path.basename(wineBin)}.`);
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
});
