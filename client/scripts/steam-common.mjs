import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretsPath = path.join(clientDir, ".steam-secrets");

export const steamTargets = {
  demo: {
    key: "demo",
    label: "Demo",
    appId: "4432220",
    buildLabel: "Conquerors: Domination Demo Build",
    branch: "public",
    appBuildPath: path.join(clientDir, "steampipe", "app_build_4432220.vdf"),
    outputLogPath: path.join(clientDir, "steampipe", "output", "app_build_4432220.log"),
    autoSetLiveFromUpload: true,
  },
  main: {
    key: "main",
    label: "Main Game",
    appId: "4432210",
    buildLabel: "Conquerors: Domination Main Build",
    branch: "public",
    appBuildPath: path.join(clientDir, "steampipe", "app_build_4432210.vdf"),
    outputLogPath: path.join(clientDir, "steampipe", "output", "app_build_4432210.log"),
    autoSetLiveFromUpload: false,
  },
};

function syncSteamAppIdFiles(target) {
  const stageRoot = path.join(clientDir, "releases", "steam");
  const macBundlePath = path.join(stageRoot, "macos", "ConquerorsDominationDemo.app");
  const fileTargets = [
    path.join(stageRoot, "microsoft-windows", "steam_appid.txt"),
    path.join(stageRoot, "linux", "steam_appid.txt"),
    path.join(stageRoot, "macos", "steam_appid.txt"),
    path.join(macBundlePath, "Contents", "MacOS", "steam_appid.txt"),
    path.join(macBundlePath, "Contents", "Resources", "steam_appid.txt"),
  ];

  for (const filePath of fileTargets) {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      continue;
    }

    fs.writeFileSync(filePath, `${target.appId}\n`, "utf8");
  }
}

function parseSecretsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

export function loadSteamEnv() {
  const fileEnv = parseSecretsFile(secretsPath);
  const mergedEnv = {
    ...fileEnv,
    ...process.env,
  };

  return {
    steamUsername: mergedEnv.STEAM_USERNAME ?? mergedEnv.STEAM_USER ?? "",
    steamPassword: mergedEnv.STEAM_PASSWORD ?? "",
    steamPartnerKey: mergedEnv.STEAM_PARTNER_KEY ?? "",
    steamApproverSteamId: mergedEnv.STEAM_APPROVER_STEAMID ?? "",
    steamBranch: mergedEnv.STEAM_BRANCH ?? "public",
    secretsPath,
  };
}

export function getTarget(targetKey) {
  const target = steamTargets[targetKey];
  if (!target) {
    const validTargets = Object.keys(steamTargets).join(", ");
    throw new Error(`Unknown Steam target "${targetKey}". Expected one of: ${validTargets}.`);
  }
  return target;
}

export async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? clientDir,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

export async function runBuildAndVerificationPipeline() {
  const steps = [
    ["npm", ["run", "build"]],
    ["npm", ["run", "build-server"]],
    ["node", ["scripts/build-steam-artifacts.mjs"]],
    ["npm", ["run", "stage:steam"]],
    ["npm", ["run", "verify:steam-layout"]],
    ["npm", ["run", "verify:release-binaries"]],
    ["npm", ["run", "verify:steam-runtime"]],
    ["npm", ["run", "smoke:packaged-server"]],
    ["npm", ["run", "smoke:packaged"]],
  ];

  for (const [command, args] of steps) {
    await runCommand(command, args);
  }
}

function createNoLiveAppBuildPath(target) {
  const original = fs.readFileSync(target.appBuildPath, "utf8");
  const updated = original.replace(/\n\t"setlive"\s+"[^"]*"/, '\n\t"setlive" ""');
  const tempPath = path.join(
    path.dirname(target.appBuildPath),
    `${path.basename(target.appBuildPath, ".vdf")}.nolive.${Date.now()}.vdf`
  );

  fs.writeFileSync(tempPath, updated, "utf8");
  return tempPath;
}

export async function uploadWithSteamCmd(
  target,
  steamUsername,
  steamPassword,
  options = {}
) {
  if (!steamUsername) {
    throw new Error(
      `Missing STEAM_USERNAME. Put it in ${secretsPath} or export it before running the upload.`
    );
  }

  const loginArgs = steamPassword
    ? ["+login", steamUsername, steamPassword]
    : ["+login", steamUsername];

  syncSteamAppIdFiles(target);

  const appBuildPath = options.disableSetLive ? createNoLiveAppBuildPath(target) : target.appBuildPath;

  try {
    await runCommand("steamcmd", [...loginArgs, "+run_app_build_http", appBuildPath, "+quit"]);
  } finally {
    if (options.disableSetLive && fs.existsSync(appBuildPath)) {
      fs.unlinkSync(appBuildPath);
    }
  }
}

export function readBuildIdFromLog(target) {
  if (!fs.existsSync(target.outputLogPath)) {
    return null;
  }

  const log = fs.readFileSync(target.outputLogPath, "utf8");
  const matches = [...log.matchAll(/BuildID (\d+)/g)];
  const lastMatch = matches.at(-1);
  return lastMatch?.[1] ?? null;
}

async function fetchPartner(endpoint, params, method = "GET") {
  const url = new URL(`https://partner.steam-api.com/ISteamApps/${endpoint}`);
  const searchParams = new URLSearchParams(params);
  let response;

  if (method === "POST") {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: searchParams,
    });
  } else {
    url.search = searchParams.toString();
    response = await fetch(url);
  }

  if (!response.ok) {
    throw new Error(`Steam Partner API ${endpoint} failed with HTTP ${response.status}.`);
  }

  return response.json();
}

export async function getLatestBuildId(target, steamPartnerKey) {
  const data = await fetchPartner("GetAppBuilds/v1/", {
    key: steamPartnerKey,
    appid: target.appId,
    count: "1",
  });

  const builds = data?.response?.builds ?? {};
  const latestBuild = Object.values(builds)[0];
  if (!latestBuild?.BuildID) {
    throw new Error(`Could not find any builds for app ${target.appId}.`);
  }

  return String(latestBuild.BuildID);
}

export async function setBuildLive(
  target,
  steamPartnerKey,
  buildId,
  branch = target.branch,
  steamApproverSteamId = ""
) {
  const params = {
    key: steamPartnerKey,
    appid: target.appId,
    buildid: buildId,
    betakey: branch,
    description: `${target.label} ${branch} -> ${buildId}`,
  };

  if (steamApproverSteamId) {
    params.steamid = steamApproverSteamId;
  }

  const data = await fetchPartner(
    "SetAppBuildLive/v2/",
    params,
    "POST"
  );

  const result = data?.response?.result;
  if (result !== 1) {
    throw new Error(
      `Steam Partner API refused SetAppBuildLive for app ${target.appId}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

export async function getBranchBuildId(target, steamPartnerKey, branch = target.branch) {
  const data = await fetchPartner("GetAppBetas/v1/", {
    key: steamPartnerKey,
    appid: target.appId,
  });

  const buildId = data?.response?.betas?.[branch]?.BuildID;
  if (!buildId) {
    throw new Error(`Could not read branch ${branch} for app ${target.appId}.`);
  }

  return String(buildId);
}
