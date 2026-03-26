import fs from "node:fs";
import path from "node:path";
import { clientDir, getSelectedPlatforms, installFolder, platforms, releaseRoot } from "./release-config.mjs";

const appBuildPath = path.join(clientDir, "steampipe", "app_build_4432220.vdf");
const appBuild = fs.readFileSync(appBuildPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(clientDir, "package.json"), "utf8"));
const errors = [];
const selectedPlatforms = getSelectedPlatforms();
const depotIdsInAppBuild = [...appBuild.matchAll(/"(\d+)"\s+"depot_build_[^"]+\.vdf"/g)].map((match) => match[1]);
const expectedDepotIds = platforms.map((platform) => platform.depotId).sort();

function vdfValue(contents, key) {
  const match = contents.match(new RegExp(`"${key}"\\s+"([^"]+)"`));
  return match ? match[1] : null;
}

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

check(
  packageJson.build?.productName === "ConquerorsDominationDemo",
  `build.productName must be ConquerorsDominationDemo, found ${JSON.stringify(packageJson.build?.productName)}`
);
check(
  packageJson.build?.executableName === "ConquerorsDominationDemo",
  `build.executableName must be ConquerorsDominationDemo, found ${JSON.stringify(packageJson.build?.executableName)}`
);
check(
  packageJson.build?.win?.executableName === "ConquerorsDominationDemo",
  `build.win.executableName must be ConquerorsDominationDemo, found ${JSON.stringify(packageJson.build?.win?.executableName)}`
);
check(
  packageJson.build?.linux?.executableName === "conquerors-domination-demo",
  `build.linux.executableName must be conquerors-domination-demo, found ${JSON.stringify(packageJson.build?.linux?.executableName)}`
);
check(fs.existsSync(releaseRoot), `Missing staged release root at ${path.relative(clientDir, releaseRoot)}`);
check(
  fs.existsSync(path.join(releaseRoot, "platform-manifest.json")),
  `Missing platform manifest at ${path.relative(clientDir, path.join(releaseRoot, "platform-manifest.json"))}`
);
check(
  JSON.stringify([...depotIdsInAppBuild].sort()) === JSON.stringify(expectedDepotIds),
  `app_build_4432220.vdf should contain only demo platform depots ${expectedDepotIds.join(", ")}, found ${depotIdsInAppBuild.join(", ") || "(none)"}`
);
check(
  !appBuild.includes('"4432221" "depot_build_4432221.vdf"'),
  "app_build_4432220.vdf must not include the placeholder shared-base depot 4432221"
);

for (const platform of selectedPlatforms) {
  const depotBuildPath = path.join(clientDir, "steampipe", `depot_build_${platform.depotId}.vdf`);
  const depotBuild = fs.readFileSync(depotBuildPath, "utf8");
  const localPath = vdfValue(depotBuild, "LocalPath");

  check(
    appBuild.includes(`"${platform.depotId}" "depot_build_${platform.depotId}.vdf"`),
    `app_build_4432220.vdf is missing depot ${platform.depotId}`
  );
  check(
    localPath === platform.steamLocalPath,
    `Depot ${platform.depotId} should map ${platform.label} to ${platform.steamLocalPath}, found ${JSON.stringify(localPath)}`
  );
  check(
    fs.existsSync(platform.stageDir),
    `Missing staged ${platform.label} folder at ${path.relative(clientDir, platform.stageDir)}`
  );
  check(
    fs.existsSync(platform.binaryPath),
    `Missing staged ${platform.label} launch target at ${path.relative(clientDir, platform.binaryPath)}`
  );

  if (platform.bundlePath) {
    check(
      fs.existsSync(platform.bundlePath),
      `Missing staged ${platform.label} app bundle at ${path.relative(clientDir, platform.bundlePath)}`
    );
  }

  if (platform.requiresExecutableBit && fs.existsSync(platform.binaryPath)) {
    const mode = fs.statSync(platform.binaryPath).mode;
    check(
      (mode & 0o111) !== 0,
      `${platform.label} launch target is not executable: ${path.relative(clientDir, platform.binaryPath)}`
    );
  }
}

if (errors.length > 0) {
  console.error("Steam layout verification failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Steam layout verified for install folder: ${installFolder}`);
for (const platform of selectedPlatforms) {
  console.log(`- ${platform.label}: ${platform.launchExecutable}`);
}
