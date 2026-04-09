import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const bridgeDir = path.join(clientDir, "native", "steam_bridge");
const bridgeManifestPath = path.join(bridgeDir, "Cargo.toml");
const outputDir = path.join(clientDir, "electron", "native");

const bridgeTargets = [
  {
    rustTarget: "aarch64-apple-darwin",
    binaryName: "steam-native-bridge-darwin-arm64",
    runtimeSubdir: "osx",
    runtimeLibraryName: "libsteam_api.dylib",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    binaryName: "steam-native-bridge-darwin-x64",
    runtimeSubdir: "osx",
    runtimeLibraryName: "libsteam_api.dylib",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    binaryName: "steam-native-bridge-win32-x64.exe",
    runtimeSubdir: "win64",
    runtimeLibraryName: "steam_api64.dll",
  },
  {
    rustTarget: "x86_64-pc-windows-gnu",
    binaryName: "steam-native-bridge-win32-x64.exe",
    runtimeSubdir: "win64",
    runtimeLibraryName: "steam_api64.dll",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    binaryName: "steam-native-bridge-linux-x64",
    runtimeSubdir: "linux64",
    runtimeLibraryName: "libsteam_api.so",
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? clientDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }

  return result.stdout?.trim?.() ?? "";
}

function detectHostRustTarget() {
  const rustcOutput = run("rustc", ["-vV"]);
  const hostLine = rustcOutput
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith("host:"));

  if (!hostLine) {
    throw new Error("Unable to detect the Rust host target from rustc -vV.");
  }

  return hostLine.split(":")[1]?.trim() || "";
}

function listInstalledRustTargets() {
  const output = run("rustup", ["target", "list", "--installed"]);
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function resolveSteamworksSysRuntimeRoot() {
  const registryRoot = path.join(os.homedir(), ".cargo", "registry", "src");
  if (!fs.existsSync(registryRoot)) {
    return null;
  }

  for (const scope of fs.readdirSync(registryRoot).sort().reverse()) {
    const scopePath = path.join(registryRoot, scope);
    if (!fs.statSync(scopePath).isDirectory()) {
      continue;
    }

    for (const packageDir of fs.readdirSync(scopePath).filter((entry) => entry.startsWith("steamworks-sys-")).sort().reverse()) {
      const runtimeRoot = path.join(scopePath, packageDir, "lib", "steam", "redistributable_bin");
      if (fs.existsSync(runtimeRoot)) {
        return runtimeRoot;
      }
    }
  }

  return null;
}

function getBridgePlans(hostRustTarget, installedTargets) {
  const hostPlan = bridgeTargets.find((target) => target.rustTarget === hostRustTarget);
  if (!hostPlan) {
    throw new Error(`Unsupported Rust host target for the Steam bridge: ${hostRustTarget}`);
  }

  const selectedPlans = [];
  const seenRustTargets = new Set();

  const addPlan = (plan) => {
    if (!plan || seenRustTargets.has(plan.rustTarget)) {
      return;
    }

    selectedPlans.push(plan);
    seenRustTargets.add(plan.rustTarget);
  };

  addPlan(hostPlan);

  if (process.platform === "darwin") {
    for (const plan of bridgeTargets.filter((target) => target.rustTarget.endsWith("-apple-darwin"))) {
      if (installedTargets.has(plan.rustTarget)) {
        addPlan(plan);
      }
    }
  }

  return selectedPlans;
}

function getCompiledBinaryPath(rustTarget) {
  const binaryBaseName = rustTarget.includes("windows") ? "steam-native-bridge.exe" : "steam-native-bridge";
  return path.join(bridgeDir, "target", rustTarget, "release", binaryBaseName);
}

function cleanOutputDirectory() {
  fs.mkdirSync(outputDir, { recursive: true });

  const knownOutputFiles = new Set(
    bridgeTargets
      .flatMap((target) => [target.binaryName, target.runtimeLibraryName])
  );

  for (const fileName of knownOutputFiles) {
    fs.rmSync(path.join(outputDir, fileName), { force: true });
  }
}

if (!fs.existsSync(bridgeManifestPath)) {
  console.error(`Native Steam bridge manifest is missing at ${bridgeManifestPath}`);
  process.exit(1);
}

const hostRustTarget = detectHostRustTarget();
const installedTargets = listInstalledRustTargets();
const plans = getBridgePlans(hostRustTarget, installedTargets);
const runtimeRoot = resolveSteamworksSysRuntimeRoot();

if (!runtimeRoot) {
  console.error("Unable to locate the steamworks-sys redistributable runtime in the Cargo registry.");
  process.exit(1);
}

cleanOutputDirectory();

const builtPlans = [];
for (const plan of plans) {
  console.log(`Building Steam native bridge for ${plan.rustTarget}...`);
  run(
    "cargo",
    [
      "build",
      "--manifest-path",
      bridgeManifestPath,
      "--release",
      "--target",
      plan.rustTarget,
    ],
    { stdio: "inherit" }
  );

  const compiledBinaryPath = getCompiledBinaryPath(plan.rustTarget);
  if (!fs.existsSync(compiledBinaryPath)) {
    console.error(`Compiled bridge binary is missing at ${compiledBinaryPath}`);
    process.exit(1);
  }

  const stagedBinaryPath = path.join(outputDir, plan.binaryName);
  fs.copyFileSync(compiledBinaryPath, stagedBinaryPath);
  if (!plan.binaryName.endsWith(".exe")) {
    fs.chmodSync(stagedBinaryPath, 0o755);
  }

  const runtimeSourcePath = path.join(runtimeRoot, plan.runtimeSubdir, plan.runtimeLibraryName);
  if (!fs.existsSync(runtimeSourcePath)) {
    console.error(`Steam runtime library is missing at ${runtimeSourcePath}`);
    process.exit(1);
  }

  const runtimeDestinationPath = path.join(outputDir, plan.runtimeLibraryName);
  fs.copyFileSync(runtimeSourcePath, runtimeDestinationPath);
  if (!plan.runtimeLibraryName.endsWith(".dll")) {
    fs.chmodSync(runtimeDestinationPath, 0o755);
  }

  builtPlans.push({
    rustTarget: plan.rustTarget,
    binaryName: plan.binaryName,
    runtimeLibraryName: plan.runtimeLibraryName,
  });
}

console.log("Native Steam bridge staged:");
for (const plan of builtPlans) {
  console.log(`- ${plan.rustTarget}: electron/native/${plan.binaryName}`);
}

const missingOptionalTargets = bridgeTargets
  .filter((target) => target.rustTarget !== hostRustTarget)
  .filter((target) => process.platform === "darwin" ? target.rustTarget.endsWith("-apple-darwin") : false)
  .filter((target) => !builtPlans.some((builtPlan) => builtPlan.rustTarget === target.rustTarget))
  .map((target) => target.rustTarget);

if (missingOptionalTargets.length > 0) {
  console.warn(
    `Skipped additional Steam bridge targets because Rust targets are not installed: ${missingOptionalTargets.join(", ")}`
  );
}
