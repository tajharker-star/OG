import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { clientDir, platforms } from "./release-config.mjs";

const errors = [];

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

for (const platform of platforms) {
  check(
    fs.existsSync(platform.binaryPath),
    `${platform.label} binary is missing at ${path.relative(clientDir, platform.binaryPath)}`
  );
  check(
    fs.existsSync(platform.resourcePath),
    `${platform.label} resources/app.asar is missing at ${path.relative(clientDir, platform.resourcePath)}`
  );

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
for (const platform of platforms) {
  const description = execFileSync("file", [platform.binaryPath], { encoding: "utf8" }).trim();
  console.log(`- ${platform.label}: ${description}`);
}
