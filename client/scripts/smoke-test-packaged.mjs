import { spawn } from "node:child_process";
import fs from "node:fs";
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

function resolvePackagedTarget(platform) {
  if (fs.existsSync(platform.binaryPath)) {
    return {
      binaryPath: platform.binaryPath,
      cwd: platform.stageDir,
    };
  }

  if (platform.key === "macos") {
    return {
      binaryPath: path.join(platform.sourceDir, platform.launchExecutable, "Contents", "MacOS", "ConquerorsDominationDemo"),
      cwd: platform.sourceDir,
    };
  }

  return {
    binaryPath: path.join(platform.sourceDir, platform.launchExecutable),
    cwd: platform.sourceDir,
  };
}

const packagedTarget = resolvePackagedTarget(target);

const child = spawn(packagedTarget.binaryPath, [], {
  cwd: packagedTarget.cwd,
  env: {
    ...process.env,
    CI: "1",
    DISABLE_STEAM: "1",
    PORT: portByPlatform[target.key],
    SMOKE_TEST: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let finished = false;
let timedOut = false;

child.on("error", (error) => {
  console.error(`Packaged ${target.label} smoke test failed to launch ${packagedTarget.binaryPath}.`);
  console.error(error.stack || error.message);
  process.exit(1);
});

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const timeout = setTimeout(() => {
  if (!finished) {
    timedOut = true;
    child.kill("SIGTERM");
  }
}, 20000);

child.on("exit", (code, signal) => {
  finished = true;
  clearTimeout(timeout);

  if (timedOut && signal === "SIGTERM") {
    console.log(`Packaged ${target.label} smoke test passed: app launched and remained healthy for 20 seconds.`);
    if (stdout.trim()) {
      console.log(stdout.trim());
    }
    process.exit(0);
  }

  if (signal) {
    console.error(`Packaged smoke test ended by signal ${signal}.`);
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  if (code !== 0) {
    console.error(`Packaged smoke test failed with exit code ${code}.`);
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(code ?? 1);
  }

  console.log(`Packaged ${target.label} smoke test passed.`);
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
});
