import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { platforms } from "./release-config.mjs";

const hostPlatformMap = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};

const hostKey = hostPlatformMap[process.platform];

if (!hostKey) {
  console.log(`Packaged smoke test skipped on unsupported host ${process.platform}.`);
  process.exit(0);
}

const target = platforms.find((platform) => platform.key === hostKey);

if (!target) {
  console.error(`Packaged smoke test configuration is missing the ${hostKey} target.`);
  process.exit(1);
}

const portByPlatform = {
  macos: "3901",
  linux: "3902",
  windows: "3903",
};

const rendererReadyPatterns = [
  "[Electron] Renderer finished loading.",
  "[SmokeTest] Renderer loaded. Closing app shortly.",
];

const rendererFailurePatterns = [
  "[Electron] Failed to load Production file:",
  "[Electron] Failed to load Dev URL:",
  "did-fail-load",
  "ERR_FAILED",
];

const mainLogPath = path.join(os.tmpdir(), "conquerors-domination-demo-main.log");

function resolvePackagedTarget(platform) {
  if (platform.key === "macos") {
    const bundlePath = fs.existsSync(platform.bundlePath)
      ? platform.bundlePath
      : path.join(platform.sourceDir, platform.launchExecutable);

    return {
      bundlePath,
      binaryPath: path.join(bundlePath, "Contents", "MacOS", "ConquerorsDominationDemo"),
      cwd: path.dirname(bundlePath),
    };
  }

  if (fs.existsSync(platform.binaryPath)) {
    return {
      binaryPath: platform.binaryPath,
      cwd: platform.stageDir,
    };
  }

  return {
    binaryPath: path.join(platform.sourceDir, platform.launchExecutable),
    cwd: platform.sourceDir,
  };
}

function inspectOutput(chunk, state) {
  for (const pattern of rendererReadyPatterns) {
    if (chunk.includes(pattern)) {
      state.sawRendererReady = true;
    }
  }

  for (const pattern of rendererFailurePatterns) {
    if (chunk.includes(pattern)) {
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

function terminateMacApp(binaryPath) {
  spawnSync("pkill", ["-f", binaryPath], { stdio: "ignore" });
}

function findMacAppPid(binaryPath) {
  const result = spawnSync("pgrep", ["-f", binaryPath], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }

  const pid = Number.parseInt(result.stdout.split(/\s+/).find(Boolean) ?? "", 10);
  return Number.isFinite(pid) ? pid : null;
}

function getMacVisibleWindowCount(pid) {
  const scriptPath = path.join(os.tmpdir(), `conquerors-window-check-${pid}.swift`);
  const script = `import CoreGraphics
import Foundation

let pid = ${pid}
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as NSArray? as? [[String: Any]] ?? []
let visibleWindows = windows.filter { info in
    let ownerPid = info[kCGWindowOwnerPID as String] as? Int ?? -1
    let layer = info[kCGWindowLayer as String] as? Int ?? -1
    let bounds = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] as? Double ?? 0
    let height = bounds["Height"] as? Double ?? 0
    return ownerPid == pid && layer == 0 && width >= 200 && height >= 200
}
print(visibleWindows.count)
`;

  fs.writeFileSync(scriptPath, script);
  const result = spawnSync("swift", [scriptPath], { encoding: "utf8" });
  fs.rmSync(scriptPath, { force: true });

  if (result.status !== 0) {
    return 0;
  }

  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function failWithOutput(message, stdout, stderr, extraLog = "") {
  console.error(message);
  if (stdout.trim()) console.error(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  if (extraLog.trim()) console.error(extraLog.trim());
  process.exit(1);
}

async function runMacSmokeTest(packagedTarget) {
  fs.rmSync(mainLogPath, { force: true });
  terminateMacApp(packagedTarget.binaryPath);

  const launcher = spawn("open", ["-na", packagedTarget.bundlePath, "--args"], {
    cwd: packagedTarget.cwd,
    env: {
      ...process.env,
      CI: "1",
      DISABLE_STEAM: "1",
      PORT: portByPlatform[target.key],
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  launcher.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  launcher.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  launcher.on("error", (error) => {
    failWithOutput(
      `Packaged ${target.label} smoke test failed to launch ${packagedTarget.bundlePath}.`,
      stdout,
      `${stderr}\n${error.stack || error.message}`
    );
  });

  const start = Date.now();
  while (Date.now() - start < 45000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const mainLog = readFileIfPresent(mainLogPath);
    const pid = findMacAppPid(packagedTarget.binaryPath);

    for (const pattern of rendererFailurePatterns) {
      if (mainLog.includes(pattern)) {
        terminateMacApp(packagedTarget.binaryPath);
        failWithOutput(
          `Packaged ${target.label} smoke test detected renderer load failure (${pattern}).`,
          stdout,
          stderr,
          mainLog
        );
      }
    }

    if (pid && getMacVisibleWindowCount(pid) > 0) {
      terminateMacApp(packagedTarget.binaryPath);
      console.log(`Packaged ${target.label} smoke test passed.`);
      return;
    }
  }

  terminateMacApp(packagedTarget.binaryPath);
  failWithOutput(
    `Packaged ${target.label} smoke test timed out before the renderer confirmed it finished loading.`,
    stdout,
    stderr,
    readFileIfPresent(mainLogPath)
  );
}

async function runDirectSmokeTest(packagedTarget) {
  const isLinuxTarget = target.key === "linux";
  const launchArgs = isLinuxTarget
    ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
    : [];
  const smokeCapturePath = path.join(os.tmpdir(), `conquerors-${target.key}-packaged-smoke.png`);
  fs.rmSync(smokeCapturePath, { force: true });

  const child = spawn(packagedTarget.binaryPath, launchArgs, {
    cwd: packagedTarget.cwd,
    env: {
      ...process.env,
      CI: "1",
      DISABLE_STEAM: "1",
      AG_DISABLE_GPU: isLinuxTarget ? "1" : process.env.AG_DISABLE_GPU,
      ELECTRON_DISABLE_SANDBOX: isLinuxTarget ? "1" : process.env.ELECTRON_DISABLE_SANDBOX,
      PORT: portByPlatform[target.key],
      SMOKE_TEST: "1",
      SMOKE_CAPTURE_PATH: smokeCapturePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = {
    sawRendererReady: false,
    failurePattern: null,
  };

  let stdout = "";
  let stderr = "";

  child.on("error", (error) => {
    failWithOutput(
      `Packaged ${target.label} smoke test failed to launch ${packagedTarget.binaryPath}.`,
      stdout,
      `${stderr}\n${error.stack || error.message}`
    );
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    inspectOutput(text, state);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    inspectOutput(text, state);
  });

  const result = await new Promise((resolve) => {
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 20000);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, timedOut });
    });
  });

  if (state.failurePattern) {
    failWithOutput(
      `Packaged ${target.label} smoke test detected renderer load failure (${state.failurePattern}).`,
      stdout,
      stderr
    );
  }

  if (result.timedOut) {
    failWithOutput(
      `Packaged ${target.label} smoke test timed out before the renderer confirmed it finished loading.`,
      stdout,
      stderr
    );
  }

  if (result.signal) {
    failWithOutput(`Packaged smoke test ended by signal ${result.signal}.`, stdout, stderr);
  }

  if (result.code !== 0) {
    failWithOutput(`Packaged smoke test failed with exit code ${result.code}.`, stdout, stderr);
  }

  if (!state.sawRendererReady) {
    failWithOutput(
      `Packaged ${target.label} smoke test exited cleanly without confirming renderer readiness.`,
      stdout,
      stderr
    );
  }

  if (!fs.existsSync(smokeCapturePath)) {
    failWithOutput(
      `Packaged ${target.label} smoke test did not produce a renderer screenshot at ${smokeCapturePath}.`,
      stdout,
      stderr
    );
  }

  const screenshotSize = fs.statSync(smokeCapturePath).size;
  if (screenshotSize < 6_000) {
    failWithOutput(
      `Packaged ${target.label} smoke screenshot looks invalid (size=${screenshotSize} bytes).`,
      stdout,
      stderr
    );
  }

  console.log(`Packaged ${target.label} smoke test passed.`);
  console.log(`Smoke screenshot: ${smokeCapturePath}`);
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
}

const packagedTarget = resolvePackagedTarget(target);

if (target.key === "macos") {
  await runMacSmokeTest(packagedTarget);
} else {
  await runDirectSmokeTest(packagedTarget);
}
