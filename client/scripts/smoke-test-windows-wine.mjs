import os from "node:os";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { platforms } from "./release-config.mjs";

const rendererReadyPatterns = [
  "[SmokeTest] Renderer loaded. Closing app shortly.",
  "[SmokeTest] DOM probe:",
  "[SmokeTest] Renderer screenshot saved:",
];

const rendererFailurePatterns = [
  "[Electron] Failed to load Production file:",
  "[Electron] Failed to load Dev URL:",
  "did-fail-load",
  "ERR_FAILED",
  "render-process-gone",
];

const timeoutMs = 45000;
const pollMs = 500;
const artifactsDir = path.join(os.tmpdir(), "conquerors-wine-smoke");
const runLabel = new Date().toISOString().replaceAll(/[:.]/g, "-");
const fallbackMainLogCandidates = [
  path.join(os.tmpdir(), "conquerors-domination-demo-main.log"),
  path.join(
    os.homedir(),
    ".wine",
    "drive_c",
    "users",
    os.userInfo().username,
    "AppData",
    "Local",
    "Temp",
    "conquerors-domination-demo-main.log"
  ),
];

function commandPath(name) {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function resolveWineBinary() {
  const homeDir = os.homedir();
  const candidates = [
    process.env.WINE_BIN,
    "/Applications/Wine Devel.app/Contents/MacOS/wine",
    "/Applications/Wine Stable.app/Contents/MacOS/wine",
    path.join(homeDir, "Downloads", "Wine Devel.app", "Contents", "MacOS", "wine"),
    path.join(homeDir, "Downloads", "Wine Stable.app", "Contents", "MacOS", "wine"),
    commandPath("wine64"),
    commandPath("wine"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function artifactPath(name, ext) {
  return path.join(artifactsDir, `${runLabel}-${name}.${ext}`);
}

function captureDesktopScreenshot(name) {
  if (process.platform !== "darwin") {
    return null;
  }

  const screenshotPath = artifactPath(name, "png");
  const result = spawnSync("screencapture", ["-x", screenshotPath], { stdio: "ignore" });
  if (result.status !== 0 || !fs.existsSync(screenshotPath)) {
    return null;
  }
  return screenshotPath;
}

function findWineGameWindowId() {
  if (process.platform !== "darwin") {
    return null;
  }

  const scriptPath = artifactPath("window-scan", "swift");
  const swift = `import CoreGraphics
import Foundation

let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for info in windows {
  let owner = ((info[kCGWindowOwnerName as String] as? String) ?? "").lowercased()
  let name = ((info[kCGWindowName as String] as? String) ?? "").lowercased()
  let layer = info[kCGWindowLayer as String] as? Int ?? 0
  guard layer == 0 else { continue }

  let titleLooksRight = name.contains("conquerors") || name.contains("domination") || name.contains("dominion")
  let ownerLooksRight = owner.contains("wine") || owner.contains("conquerors")
  guard titleLooksRight || ownerLooksRight else { continue }

  if let windowId = info[kCGWindowNumber as String] as? Int {
    print(windowId)
    exit(0)
  }
}

exit(1)
`;

  try {
    fs.writeFileSync(scriptPath, swift);
    const result = spawnSync("swift", [scriptPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (result.status !== 0) {
      return null;
    }
    const parsed = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
}

function captureWindowScreenshot(name, windowId) {
  if (process.platform !== "darwin" || !windowId) {
    return null;
  }

  const screenshotPath = artifactPath(name, "png");
  const result = spawnSync("screencapture", ["-x", "-l", String(windowId), screenshotPath], { stdio: "ignore" });
  if (result.status !== 0 || !fs.existsSync(screenshotPath)) {
    return null;
  }
  return screenshotPath;
}

function inspectOutput(text, state) {
  for (const pattern of rendererReadyPatterns) {
    if (text.includes(pattern)) {
      state.sawRendererReady = true;
    }
  }

  for (const pattern of rendererFailurePatterns) {
    if (text.includes(pattern)) {
      state.failurePattern = state.failurePattern || pattern;
    }
  }
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readMergedMainLogs() {
  const chunks = [];
  for (const candidate of fallbackMainLogCandidates) {
    const content = readFileIfPresent(candidate);
    if (content.trim()) {
      chunks.push(content.trim());
    }
  }
  return chunks.join("\n");
}

function failWithDiagnostics(message, state) {
  const lines = [message];

  if (state.stdout.trim()) {
    lines.push("---- stdout ----");
    lines.push(state.stdout.trim());
  }

  if (state.stderr.trim()) {
    lines.push("---- stderr ----");
    lines.push(state.stderr.trim());
  }

  if (state.mainLog.trim()) {
    lines.push("---- main.log ----");
    lines.push(state.mainLog.trim());
  }

  lines.push("---- screenshots ----");
  if (state.desktopBefore) lines.push(state.desktopBefore);
  if (state.desktopDuring) lines.push(state.desktopDuring);
  if (state.windowDuring) lines.push(state.windowDuring);
  if (state.desktopFinal) lines.push(state.desktopFinal);
  lines.push(state.rendererShotPath);

  console.error(lines.join("\n"));
  process.exit(1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
console.log(`Using Wine binary: ${wineBin}`);

fs.mkdirSync(artifactsDir, { recursive: true });
for (const candidate of fallbackMainLogCandidates) {
  fs.rmSync(candidate, { force: true });
}

const state = {
  stdout: "",
  stderr: "",
  mainLog: "",
  sawRendererReady: false,
  failurePattern: null,
  desktopBefore: null,
  desktopDuring: null,
  windowDuring: null,
  wineWindowId: null,
  desktopFinal: null,
  rendererShotPath: artifactPath("renderer", "png"),
};

state.desktopBefore = captureDesktopScreenshot("desktop-before");

const child = spawn(wineBin, [windows.binaryPath], {
  cwd: windows.stageDir,
  env: {
    ...process.env,
    DISABLE_STEAM: "1",
    AG_DISABLE_GPU: "1",
    SMOKE_TEST: "1",
    SMOKE_CAPTURE_PATH: state.rendererShotPath,
    PORT: "3921",
    WINEDEBUG: process.env.WINEDEBUG || "-all",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let exited = false;
let exitCode = null;
let exitSignal = null;
let timedOut = false;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  state.stdout += text;
  inspectOutput(text, state);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  state.stderr += text;
  inspectOutput(text, state);
});

child.on("exit", (code, signal) => {
  exited = true;
  exitCode = code;
  exitSignal = signal;
});

const start = Date.now();
while (!exited && Date.now() - start < timeoutMs) {
  await wait(pollMs);
  state.mainLog = readMergedMainLogs();
  inspectOutput(state.mainLog, state);
  if (state.sawRendererReady && !state.desktopDuring) {
    await wait(350);
    state.desktopDuring = captureDesktopScreenshot("desktop-active");
  }
  if (state.sawRendererReady && !state.wineWindowId) {
    state.wineWindowId = findWineGameWindowId();
    if (state.wineWindowId && !state.windowDuring) {
      state.windowDuring = captureWindowScreenshot("window-active", state.wineWindowId);
    }
  }
}

if (!exited) {
  timedOut = true;
  child.kill("SIGTERM");
  await wait(1000);
}

if (exitCode === 0 && !state.sawRendererReady) {
  const graceStart = Date.now();
  while (Date.now() - graceStart < 15000 && !state.sawRendererReady) {
    await wait(pollMs);
    state.mainLog = readMergedMainLogs();
    inspectOutput(state.mainLog, state);
    if (fs.existsSync(state.rendererShotPath)) {
      break;
    }
  }
}

if (!state.desktopDuring && (state.sawRendererReady || fs.existsSync(state.rendererShotPath))) {
  state.desktopDuring = captureDesktopScreenshot("desktop-active");
}
if (!state.windowDuring && state.wineWindowId) {
  state.windowDuring = captureWindowScreenshot("window-active", state.wineWindowId);
}

state.desktopFinal = captureDesktopScreenshot("desktop-final");

if (process.platform === "darwin") {
  spawnSync("pkill", ["-f", "ConquerorsDominationDemo.exe"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "wineserver"], { stdio: "ignore" });
}

if (timedOut) {
  failWithDiagnostics(`Packaged Windows smoke test timed out after ${timeoutMs}ms.`, state);
}

if (exitSignal) {
  failWithDiagnostics(`Packaged Windows smoke test ended by signal ${exitSignal}.`, state);
}

if (exitCode !== 0) {
  failWithDiagnostics(`Packaged Windows smoke test failed with exit code ${exitCode}.`, state);
}

if (state.failurePattern) {
  failWithDiagnostics(
    `Packaged Windows smoke test detected renderer load failure (${state.failurePattern}).`,
    state
  );
}

const hasRendererScreenshot = fs.existsSync(state.rendererShotPath);

if (!state.sawRendererReady && !hasRendererScreenshot) {
  failWithDiagnostics(
    "Packaged Windows smoke test exited cleanly without renderer readiness markers or screenshot.",
    state
  );
}

if (!hasRendererScreenshot) {
  failWithDiagnostics(
    "Packaged Windows smoke test did not produce a renderer screenshot.",
    state
  );
}

const rendererShotSize = fs.statSync(state.rendererShotPath).size;
if (rendererShotSize < 12_000) {
  failWithDiagnostics(
    `Packaged Windows smoke test renderer screenshot looks invalid (size=${rendererShotSize} bytes).`,
    state
  );
}

console.log(`Packaged Windows smoke test passed via ${path.basename(wineBin)}.`);
console.log("Smoke screenshots:");
if (state.desktopBefore) console.log(state.desktopBefore);
if (state.desktopDuring) console.log(state.desktopDuring);
if (state.windowDuring) console.log(state.windowDuring);
if (state.desktopFinal) console.log(state.desktopFinal);
console.log(state.rendererShotPath);
process.exit(0);
