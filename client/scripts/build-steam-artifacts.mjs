import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { clientDir, platforms } from "./release-config.mjs";

const electronBuilderBin = path.join(
  clientDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

const buildTargetsByHost = {
  darwin: [
    { label: "macOS", args: ["--mac", "--x64", "--dir"], expectedKey: "macos" },
    { label: "Windows", args: ["--win", "--dir"], expectedKey: "windows" },
    { label: "Linux", args: ["--linux", "--dir"], expectedKey: "linux" },
  ],
  linux: [{ label: "Linux", args: ["--linux", "--dir"], expectedKey: "linux" }],
  win32: [{ label: "Windows", args: ["--win", "--dir"], expectedKey: "windows" }],
};

const buildTargets = buildTargetsByHost[process.platform];

if (!buildTargets) {
  console.error(`Unsupported host platform for Steam artifact build: ${process.platform}`);
  process.exit(1);
}

for (const dir of ["mac", "win-unpacked", "linux-unpacked"]) {
  fs.rmSync(path.join(clientDir, "dist_electron", dir), { recursive: true, force: true });
}

for (const target of buildTargets) {
  console.log(`Building ${target.label} unpacked artifact...`);

  const targetArgs =
    target.expectedKey === "windows" && process.platform !== "win32"
      ? [...target.args, "-c.win.signAndEditExecutable=false"]
      : target.args;

  const result = spawnSync(electronBuilderBin, targetArgs, {
    cwd: clientDir,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const platform = platforms.find((entry) => entry.key === target.expectedKey);
  if (!platform || !fs.existsSync(platform.sourceDir)) {
    console.error(`Expected ${target.label} artifact missing at ${platform?.sourceDir ?? "unknown path"}`);
    process.exit(1);
  }
}

console.log("Steam artifact build outputs are ready:");
for (const target of buildTargets) {
  const platform = platforms.find((entry) => entry.key === target.expectedKey);
  console.log(`- ${target.label}: ${path.relative(clientDir, platform.sourceDir)}`);
}
