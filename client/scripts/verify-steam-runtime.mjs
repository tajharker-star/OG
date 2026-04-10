import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listPackage } from "@electron/asar";
import { platforms } from "./release-config.mjs";

const errors = [];

const runtimeChecks = {
  macos: {
    asarEntries: [
      "/dist/index.html",
      "/electron/main.cjs",
      "/electron/steamNativeBridge.cjs",
      "/electron/steamRelayBridge.cjs",
      "/node_modules/cors/lib/index.js",
      "/node_modules/express/index.js",
      "/node_modules/localtunnel/package.json",
      "/node_modules/socket.io/dist/index.js",
      "/node_modules/socket.io-client/build/cjs/index.js",
    ],
    stageFiles: [
      "ConquerorsDominationDemo.app/Contents/MacOS/ConquerorsDominationDemo",
      "ConquerorsDominationDemo.app/Contents/Resources/server/dist/index.js",
      "ConquerorsDominationDemo.app/Contents/Resources/server/package.json",
    ],
    unpackedFiles: [
      "electron/native/steam-native-bridge-darwin-arm64",
      "electron/native/steam-native-bridge-darwin-x64",
      "electron/native/libsteam_api.dylib",
    ],
    executableFiles: [
      "electron/native/steam-native-bridge-darwin-arm64",
      "electron/native/steam-native-bridge-darwin-x64",
      "electron/native/libsteam_api.dylib",
    ],
    nativeSignatures: [
      {
        relPath: "electron/native/steam-native-bridge-darwin-arm64",
        signature: "Mach-O 64-bit executable arm64",
      },
      {
        relPath: "electron/native/steam-native-bridge-darwin-x64",
        signature: "Mach-O 64-bit executable x86_64",
      },
      {
        relPath: "electron/native/libsteam_api.dylib",
        signature: "Mach-O",
      },
    ],
  },
  windows: {
    asarEntries: [
      "/dist/index.html",
      "/electron/main.cjs",
      "/node_modules/cors/lib/index.js",
      "/node_modules/express/index.js",
      "/node_modules/localtunnel/package.json",
      "/node_modules/socket.io/dist/index.js",
      "/node_modules/socket.io-client/build/cjs/index.js",
      "/node_modules/steamworks.js/index.js",
      "/node_modules/steamworks.js/package.json",
    ],
    stageFiles: [
      "locales/en-US.pak",
      "resources/server/dist/index.js",
      "resources/server/package.json",
    ],
    unpackedFiles: [
      "node_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node",
      "node_modules/steamworks.js/dist/win64/steam_api64.dll",
    ],
    nativeSignatures: [
      {
        relPath: "node_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node",
        signature: "PE32+ executable (DLL) (GUI) x86-64, for MS Windows",
      },
      {
        relPath: "node_modules/steamworks.js/dist/win64/steam_api64.dll",
        signature: "PE32+ executable (DLL) (GUI) x86-64, for MS Windows",
      },
    ],
  },
  linux: {
    asarEntries: [
      "/dist/index.html",
      "/electron/main.cjs",
      "/node_modules/cors/lib/index.js",
      "/node_modules/express/index.js",
      "/node_modules/localtunnel/package.json",
      "/node_modules/socket.io/dist/index.js",
      "/node_modules/socket.io-client/build/cjs/index.js",
      "/node_modules/steamworks.js/index.js",
      "/node_modules/steamworks.js/package.json",
    ],
    stageFiles: [
      "chrome-sandbox",
      "locales/en-US.pak",
      "resources/server/dist/index.js",
      "resources/server/package.json",
    ],
    unpackedFiles: [
      "node_modules/steamworks.js/dist/linux64/steamworksjs.linux-x64-gnu.node",
      "node_modules/steamworks.js/dist/linux64/libsteam_api.so",
    ],
    nativeSignatures: [
      {
        relPath: "node_modules/steamworks.js/dist/linux64/steamworksjs.linux-x64-gnu.node",
        signature: "ELF 64-bit LSB shared object, x86-64",
      },
      {
        relPath: "node_modules/steamworks.js/dist/linux64/libsteam_api.so",
        signature: "ELF 64-bit LSB shared object, x86-64",
      },
    ],
  },
};

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

for (const platform of platforms.filter((entry) => entry.key in runtimeChecks)) {
  const checks = runtimeChecks[platform.key];
  const appAsarPath = platform.resourcePath;
  const resourceDir = path.dirname(appAsarPath);
  const unpackedDir = path.join(resourceDir, "app.asar.unpacked");

  check(fs.existsSync(appAsarPath), `${platform.label} app.asar is missing at ${appAsarPath}`);
  check(fs.existsSync(unpackedDir), `${platform.label} app.asar.unpacked is missing at ${unpackedDir}`);

  if (fs.existsSync(appAsarPath)) {
    const asarEntries = new Set(listPackage(appAsarPath));
    for (const entry of checks.asarEntries) {
      check(asarEntries.has(entry), `${platform.label} app.asar is missing ${entry}`);
    }
  }

  for (const relPath of checks.stageFiles) {
    const absolutePath = path.join(platform.stageDir, relPath);
    check(fs.existsSync(absolutePath), `${platform.label} staged runtime file is missing at ${absolutePath}`);
  }

  for (const relPath of checks.unpackedFiles) {
    const absolutePath = path.join(unpackedDir, relPath);
    check(fs.existsSync(absolutePath), `${platform.label} unpacked runtime file is missing at ${absolutePath}`);
  }

  for (const { relPath, signature } of checks.nativeSignatures) {
    const absolutePath = path.join(unpackedDir, relPath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const description = execFileSync("file", [absolutePath], { encoding: "utf8" }).trim();
    check(
      description.includes(signature),
      `${platform.label} native runtime signature mismatch for ${absolutePath}. Expected ${JSON.stringify(signature)} in ${JSON.stringify(description)}`
    );
  }

  for (const relPath of checks.executableFiles ?? []) {
    const absolutePath = path.join(unpackedDir, relPath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const mode = fs.statSync(absolutePath).mode;
    check(
      (mode & 0o111) !== 0,
      `${platform.label} unpacked runtime file is missing execute permission at ${absolutePath}`
    );
  }

  if (platform.key === "linux") {
    const chromeSandboxPath = path.join(platform.stageDir, "chrome-sandbox");
    if (fs.existsSync(chromeSandboxPath)) {
      const mode = fs.statSync(chromeSandboxPath).mode;
      check(
        (mode & 0o111) !== 0,
        `${platform.label} chrome-sandbox is missing execute permission at ${chromeSandboxPath}`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Steam runtime verification failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Steam runtime verified:");
for (const platform of platforms.filter((entry) => entry.key in runtimeChecks)) {
  console.log(`- ${platform.label}`);
}
