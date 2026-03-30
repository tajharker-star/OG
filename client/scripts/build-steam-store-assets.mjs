import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(clientDir, "steam-store-assets", "main");

const sources = {
  hero: path.join(clientDir, "packaged-app-verification.png"),
  icon: path.join(clientDir, "public", "app-icon.png"),
};

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required source file: ${path.relative(clientDir, filePath)}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runSips(args) {
  const result = spawnSync("sips", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`sips failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
}

function crop(source, width, height, destination) {
  runSips(["-c", String(height), String(width), source, "--out", destination]);
}

function resize(source, width, height, destination) {
  runSips(["-z", String(height), String(width), source, "--out", destination]);
}

function copy(source, destination) {
  fs.copyFileSync(source, destination);
}

Object.values(sources).forEach(ensureFile);
fs.rmSync(outputDir, { recursive: true, force: true });

const screenshotsDir = path.join(outputDir, "screenshots");
const capsulesDir = path.join(outputDir, "capsules");
const libraryDir = path.join(outputDir, "library");
const communityDir = path.join(outputDir, "community");

ensureDir(screenshotsDir);
ensureDir(capsulesDir);
ensureDir(libraryDir);
ensureDir(communityDir);

// Screenshots are now generated from real gameplay captures.

// Store capsules.
crop(sources.hero, 616, 353, path.join(capsulesDir, "capsule-main-616x353.png"));
crop(sources.hero, 460, 215, path.join(capsulesDir, "capsule-header-460x215.png"));
crop(sources.hero, 231, 87, path.join(capsulesDir, "capsule-small-231x87.png"));

// Library assets.
crop(sources.hero, 600, 900, path.join(libraryDir, "library-capsule-600x900.png"));
crop(sources.hero, 3840, 1240, path.join(libraryDir, "library-hero-3840x1240.png"));
copy(sources.icon, path.join(libraryDir, "library-logo-source-512x512.png"));

// Community/App icons.
copy(sources.icon, path.join(communityDir, "app-icon-512x512.png"));
resize(sources.icon, 32, 32, path.join(communityDir, "client-icon-32x32.png"));
resize(sources.icon, 16, 16, path.join(communityDir, "shortcut-icon-16x16.png"));

const readme = `# Steam Store Asset Pack (Main App 4432210)

Generated: ${new Date().toISOString()}

This folder contains auto-generated candidates for Steamworks checklist uploads:

- screenshots/: 5 files (meets 5+ screenshot count requirement)
- capsules/: main/header/small capsules
- library/: library capsule + hero + source logo
- community/: app icon + client/shortcut icons

Notes:
- Capsules/library/community assets are generated from current local captures and icons.
- Screenshots should be generated separately from real gameplay with \`npm run build:steam-gameplay-assets\`.
- Upload targets in Steamworks:
  - Store Presence -> Screenshots
  - Store Presence -> Capsules
  - Store Presence -> Library Assets
  - Community -> App Icon / Shortcut Icon
`;

fs.writeFileSync(path.join(outputDir, "README.md"), readme);
console.log(`Generated Steam store asset candidates at ${path.relative(clientDir, outputDir)}`);
