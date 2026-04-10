import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installFolder, platforms } from "./release-config.mjs";

const appId = "4432220";
const homeDir = os.homedir();
const defaultSteamAppsDir =
  process.platform === "darwin"
    ? path.join(homeDir, "Library", "Application Support", "Steam", "steamapps")
    : process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files (x86)", "Steam", "steamapps")
      : path.join(homeDir, ".steam", "steam", "steamapps");

const steamAppsDir = process.env.STEAM_APPS_DIR
  ? path.resolve(process.env.STEAM_APPS_DIR)
  : defaultSteamAppsDir;

const platformKeyByHost = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
};

const platformKey = platformKeyByHost[process.platform];

if (!platformKey) {
  console.error(`Unsupported host platform: ${process.platform}`);
  process.exit(1);
}

const platform = platforms.find((entry) => entry.key === platformKey);

if (!platform) {
  console.error(`Missing release config for host platform: ${platformKey}`);
  process.exit(1);
}

const appManifestPath = path.join(steamAppsDir, `appmanifest_${appId}.acf`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function acfValue(contents, key) {
  const match = contents.match(new RegExp(`"${key}"\\s+"([^"]+)"`));
  return match ? match[1] : null;
}

function parseInstalledDepots(contents) {
  const blockMatch = contents.match(/"InstalledDepots"\s*\{([\s\S]*?)\n\t\}/);
  if (!blockMatch) {
    return [];
  }

  const depotIds = [];
  for (const match of blockMatch[1].matchAll(/"(\d+)"\s*\{/g)) {
    depotIds.push(match[1]);
  }
  return depotIds;
}

if (!fs.existsSync(appManifestPath)) {
  fail(`Missing Steam app manifest at ${appManifestPath}. Install the demo through Steam first.`);
}

const appManifest = fs.readFileSync(appManifestPath, "utf8");
const installedDirName = acfValue(appManifest, "installdir");
const buildId = acfValue(appManifest, "buildid");
const installedDepots = parseInstalledDepots(appManifest).sort();
const requiredDepots = new Set([platform.depotId]);
const optionalDepots = new Set(["4432221"]);
const unexpectedDepots = installedDepots.filter(
  (depotId) => !requiredDepots.has(depotId) && !optionalDepots.has(depotId)
);

if (installedDirName !== installFolder) {
  fail(`Steam install folder mismatch. Expected ${JSON.stringify(installFolder)}, found ${JSON.stringify(installedDirName)}.`);
}

const installRoot = path.join(steamAppsDir, "common", installFolder);
const launchTargetPath = path.join(installRoot, platform.launchExecutable);

if (!fs.existsSync(installRoot)) {
  fail(`Missing Steam install root at ${installRoot}.`);
}

if (!installedDepots.includes(platform.depotId) || unexpectedDepots.length > 0) {
  fail(
    [
      `Wrong depots installed for ${platform.label}.`,
      `Expected required: ${[...requiredDepots].join(", ") || "(none)"}`,
      `Allowed optional: ${[...optionalDepots].join(", ") || "(none)"}`,
      `Found: ${installedDepots.join(", ") || "(none)"}`,
      `Unexpected: ${unexpectedDepots.join(", ") || "(none)"}`,
      `Install root: ${installRoot}`,
      `BuildID: ${buildId ?? "unknown"}`,
    ].join("\n")
  );
}

if (!fs.existsSync(launchTargetPath)) {
  fail(`Missing platform launch target at ${launchTargetPath}.`);
}

if (platform.key === "macos") {
  const macBinaryPath = path.join(
    launchTargetPath,
    "Contents",
    "MacOS",
    path.basename(platform.launchExecutable, ".app")
  );
  const macResourcesPath = path.join(launchTargetPath, "Contents", "Resources");
  const macNativeRuntimePaths = [
    path.join(macResourcesPath, "app.asar.unpacked", "electron", "native", "steam-native-bridge-darwin-arm64"),
    path.join(macResourcesPath, "app.asar.unpacked", "electron", "native", "steam-native-bridge-darwin-x64"),
    path.join(macResourcesPath, "app.asar.unpacked", "electron", "native", "libsteam_api.dylib"),
  ];

  if (!fs.existsSync(macBinaryPath)) {
    fail(`Missing macOS app binary at ${macBinaryPath}.`);
  }

  for (const runtimePath of macNativeRuntimePaths) {
    if (!fs.existsSync(runtimePath)) {
      fail(`Missing macOS Steam runtime dependency at ${runtimePath}.`);
    }
  }
}

if (platform.key !== "windows") {
  const unexpectedWindowsExe = path.join(installRoot, "ConquerorsDominationDemo.exe");
  if (fs.existsSync(unexpectedWindowsExe)) {
    fail(`Unexpected Windows executable found in ${installRoot}. Steam mounted the wrong depot.`);
  }
}

console.log(`Steam install verified for ${platform.label}.`);
console.log(`- BuildID: ${buildId ?? "unknown"}`);
console.log(`- Depots: ${installedDepots.join(", ")}`);
console.log(`- Launch target: ${launchTargetPath}`);
