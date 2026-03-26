import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  clientDir,
  currentRendererDistDir,
  currentServerDistDir,
  getSelectedPlatforms,
} from "./release-config.mjs";

const errors = [];
const shouldCompareSourceOutputs = process.env.VERIFY_RELEASE_COMPARE_SOURCES !== "0";

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function countFilesRecursively(rootDir) {
  let total = 0;
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        total += 1;
      }
    }
  }

  return total;
}

function listRelativeFiles(rootDir) {
  const files = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, entryPath));
      }
    }
  }

  return files.sort();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function compareDirectoryContents(expectedDir, actualDir, label) {
  check(fs.existsSync(expectedDir), `${label} expected directory is missing at ${path.relative(clientDir, expectedDir)}`);
  check(fs.existsSync(actualDir), `${label} packaged directory is missing at ${path.relative(clientDir, actualDir)}`);

  if (!fs.existsSync(expectedDir) || !fs.existsSync(actualDir)) {
    return;
  }

  const expectedFiles = listRelativeFiles(expectedDir);
  const actualFiles = listRelativeFiles(actualDir);

  check(
    JSON.stringify(expectedFiles) === JSON.stringify(actualFiles),
    `${label} file list does not match the current build output`
  );

  const sharedFiles = expectedFiles.filter((relativePath) => actualFiles.includes(relativePath));
  for (const relativePath of sharedFiles) {
    const expectedPath = path.join(expectedDir, relativePath);
    const actualPath = path.join(actualDir, relativePath);
    check(
      hashFile(expectedPath) === hashFile(actualPath),
      `${label} file content mismatch for ${relativePath}`
    );
  }
}

const selectedPlatforms = getSelectedPlatforms();

for (const platform of selectedPlatforms) {
  const fileCount = countFilesRecursively(platform.stageDir);

  check(
    fs.existsSync(platform.binaryPath),
    `${platform.label} binary is missing at ${path.relative(clientDir, platform.binaryPath)}`
  );
  check(
    fs.existsSync(platform.resourcePath),
    `${platform.label} resources/app.asar is missing at ${path.relative(clientDir, platform.resourcePath)}`
  );
  check(
    fs.existsSync(platform.rendererIndexPath),
    `${platform.label} renderer index is missing at ${path.relative(clientDir, platform.rendererIndexPath)}`
  );
  check(
    fs.existsSync(platform.serverEntryPath),
    `${platform.label} packaged server entry is missing at ${path.relative(clientDir, platform.serverEntryPath)}`
  );
  check(
    fileCount >= platform.minimumFileCount,
    `${platform.label} staged release looks incomplete. Expected at least ${platform.minimumFileCount} files, found ${fileCount}`
  );

  if (shouldCompareSourceOutputs) {
    compareDirectoryContents(currentRendererDistDir, platform.rendererDir, `${platform.label} renderer dist`);
    compareDirectoryContents(currentServerDistDir, platform.serverDistDir, `${platform.label} packaged server dist`);
  }

  if (fs.existsSync(platform.binaryPath)) {
    const description = execFileSync("file", [platform.binaryPath], { encoding: "utf8" }).trim();
    check(
      description.includes(platform.fileSignature),
      `${platform.label} binary signature mismatch. Expected ${JSON.stringify(platform.fileSignature)} in ${JSON.stringify(description)}`
    );
    if (platform.requiresExecutableBit) {
      const mode = fs.statSync(platform.binaryPath).mode;
      check(
        (mode & 0o111) !== 0,
        `${platform.label} binary is missing execute permission at ${path.relative(clientDir, platform.binaryPath)}`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Release binary verification failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Release binaries verified:");
for (const platform of selectedPlatforms) {
  const description = execFileSync("file", [platform.binaryPath], { encoding: "utf8" }).trim();
  const fileCount = countFilesRecursively(platform.stageDir);
  console.log(`- ${platform.label}: ${description} (${fileCount} staged files)`);
}
