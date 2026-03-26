import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const clientDir = path.resolve(scriptDir, "..");
export const releaseRoot = path.join(clientDir, "releases", "steam");
export const installFolder = "Conquerors Domination Demo";

const stageDir = (folder) => path.join(releaseRoot, folder);
const sourceDir = (...segments) => path.join(clientDir, ...segments);

export const platforms = [
  {
    key: "windows",
    label: "Microsoft Windows",
    folder: "microsoft-windows",
    depotId: "4432223",
    launchExecutable: "ConquerorsDominationDemo.exe",
    sourceDir: sourceDir("dist_electron", "win-unpacked"),
    sourceLocalPath: "dist_electron/win-unpacked",
    stageDir: stageDir("microsoft-windows"),
    steamLocalPath: "releases/steam/microsoft-windows/*",
    binaryPath: path.join(stageDir("microsoft-windows"), "ConquerorsDominationDemo.exe"),
    fileSignature: "PE32+ executable",
    resourcePath: path.join(stageDir("microsoft-windows"), "resources", "app.asar"),
    rendererIndexPath: path.join(stageDir("microsoft-windows"), "resources", "dist", "index.html"),
    serverEntryPath: path.join(stageDir("microsoft-windows"), "resources", "server", "dist", "index.js"),
    minimumFileCount: 150,
  },
  {
    key: "macos",
    label: "macOS",
    folder: "macos",
    depotId: "4432222",
    launchExecutable: "ConquerorsDominationDemo.app",
    sourceDir: sourceDir("dist_electron", "mac"),
    sourceLocalPath: "dist_electron/mac",
    stageDir: stageDir("macos"),
    steamLocalPath: "releases/steam/macos/*",
    binaryPath: path.join(
      stageDir("macos"),
      "ConquerorsDominationDemo.app",
      "Contents",
      "MacOS",
      "ConquerorsDominationDemo"
    ),
    bundlePath: path.join(stageDir("macos"), "ConquerorsDominationDemo.app"),
    fileSignature: "Mach-O 64-bit executable",
    resourcePath: path.join(
      stageDir("macos"),
      "ConquerorsDominationDemo.app",
      "Contents",
      "Resources",
      "app.asar"
    ),
    rendererIndexPath: path.join(
      stageDir("macos"),
      "ConquerorsDominationDemo.app",
      "Contents",
      "Resources",
      "dist",
      "index.html"
    ),
    serverEntryPath: path.join(
      stageDir("macos"),
      "ConquerorsDominationDemo.app",
      "Contents",
      "Resources",
      "server",
      "dist",
      "index.js"
    ),
    minimumFileCount: 250,
  },
  {
    key: "linux",
    label: "Linux + SteamOS",
    folder: "linux",
    depotId: "4432224",
    launchExecutable: "conquerors-domination-demo",
    sourceDir: sourceDir("dist_electron", "linux-unpacked"),
    sourceLocalPath: "dist_electron/linux-unpacked",
    stageDir: stageDir("linux"),
    steamLocalPath: "releases/steam/linux/*",
    binaryPath: path.join(stageDir("linux"), "conquerors-domination-demo"),
    fileSignature: "ELF 64-bit",
    resourcePath: path.join(stageDir("linux"), "resources", "app.asar"),
    rendererIndexPath: path.join(stageDir("linux"), "resources", "dist", "index.html"),
    serverEntryPath: path.join(stageDir("linux"), "resources", "server", "dist", "index.js"),
    minimumFileCount: 150,
    requiresExecutableBit: true,
  },
];

export const launchOptions = platforms.map((platform) => ({
  key: platform.key,
  platform: platform.label,
  executable: platform.launchExecutable,
  depotId: platform.depotId,
  stageDir: platform.stageDir,
  steamLocalPath: platform.steamLocalPath,
}));

function parsePlatformFilter(filterValue = process.env.STEAM_PLATFORM_FILTER ?? "") {
  const requestedKeys = filterValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (requestedKeys.length === 0) {
    return [];
  }

  const unknownKeys = requestedKeys.filter((key) => !platforms.some((platform) => platform.key === key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown platform keys in STEAM_PLATFORM_FILTER: ${unknownKeys.join(", ")}`);
  }

  return [...new Set(requestedKeys)];
}

export function getSelectedPlatforms(filterValue = process.env.STEAM_PLATFORM_FILTER ?? "") {
  const requestedKeys = parsePlatformFilter(filterValue);
  if (requestedKeys.length === 0) {
    return platforms;
  }

  const selectedKeys = new Set(requestedKeys);
  return platforms.filter((platform) => selectedKeys.has(platform.key));
}

export function getSelectedLaunchOptions(filterValue = process.env.STEAM_PLATFORM_FILTER ?? "") {
  const selectedKeys = new Set(getSelectedPlatforms(filterValue).map((platform) => platform.key));
  return launchOptions.filter((platform) => selectedKeys.has(platform.key));
}
