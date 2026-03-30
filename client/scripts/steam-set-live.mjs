import {
  getBranchBuildId,
  getLatestBuildId,
  getTarget,
  loadSteamEnv,
  setBuildLive,
} from "./steam-common.mjs";

const args = process.argv.slice(2);
const targetKey = args[0];
const buildIdArg = args[1];
const branchArg = args[2];

if (!targetKey) {
  console.error("Usage: node scripts/steam-set-live.mjs <demo|main> [buildid] [branch]");
  process.exit(1);
}

const target = getTarget(targetKey);
const steamEnv = loadSteamEnv();

if (!steamEnv.steamPartnerKey) {
  console.error(
    `Missing STEAM_PARTNER_KEY. Put it in ${steamEnv.secretsPath} or export it before making a build live.`
  );
  process.exit(1);
}

const branch = branchArg || steamEnv.steamBranch || target.branch;
const buildId = buildIdArg || (await getLatestBuildId(target, steamEnv.steamPartnerKey));

console.log(`Setting ${target.label} BuildID ${buildId} live on branch ${branch}...`);
await setBuildLive(
  target,
  steamEnv.steamPartnerKey,
  buildId,
  branch,
  steamEnv.steamApproverSteamId
);

const liveBuildId = await getBranchBuildId(target, steamEnv.steamPartnerKey, branch);
console.log(`${target.label} branch ${branch} is now on BuildID ${liveBuildId}.`);
