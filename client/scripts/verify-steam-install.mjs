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
const expectedDepots = [platform.depotId].sort();

if (installedDirName !== installFolder) {
  fail(`Steam install folder mismatch. Expected ${JSON.stringify(installFolder)}, found ${JSON.stringify(installedDirName)}.`);
}

const installRoot = path.join(steamAppsDir, "common", installFolder);
const launchTargetPath = path.join(installRoot, platform.launchExecutable);

if (!fs.existsSync(installRoot)) {
  fail(`Missing Steam install root at ${installRoot}.`);
}

if (JSON.stringify(installedDepots) !== JSON.stringify(expectedDepots)) {
  fail(
    [
      `Wrong depots installed for ${platform.label}.`,
      `Expected: ${expectedDepots.join(", ") || "(none)"}`,
      `Found: ${installedDepots.join(", ") || "(none)"}`,
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

  if (!fs.existsSync(macBinaryPath)) {
    fail(`Missing macOS app binary at ${macBinaryPath}.`);
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
