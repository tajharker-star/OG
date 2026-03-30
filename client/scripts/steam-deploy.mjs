import {
  getBranchBuildId,
  getTarget,
  loadSteamEnv,
  readBuildIdFromLog,
  runBuildAndVerificationPipeline,
  setBuildLive,
  uploadWithSteamCmd,
} from "./steam-common.mjs";

const args = process.argv.slice(2);
const targetKey = args.find((arg) => !arg.startsWith("--"));
const skipBuild = args.includes("--skip-build");
const noLive = args.includes("--no-live");

if (!targetKey) {
  console.error("Usage: node scripts/steam-deploy.mjs <demo|main> [--skip-build] [--no-live]");
  process.exit(1);
}

const target = getTarget(targetKey);
const steamEnv = loadSteamEnv();
const shouldDisableSetLiveDuringUpload =
  target.autoSetLiveFromUpload && !noLive && Boolean(steamEnv.steamPartnerKey && steamEnv.steamApproverSteamId);

console.log(`Preparing ${target.label} Steam deployment for app ${target.appId}.`);

if (!skipBuild) {
  console.log("Running local build, verification, and smoke-test pipeline...");
  await runBuildAndVerificationPipeline();
} else {
  console.log("Skipping local build pipeline by request.");
}

console.log(`Uploading ${target.label} with SteamCMD...`);
await uploadWithSteamCmd(target, steamEnv.steamUsername, steamEnv.steamPassword, {
  disableSetLive: shouldDisableSetLiveDuringUpload,
});

const uploadedBuildId = readBuildIdFromLog(target);
if (!uploadedBuildId) {
  console.error(`Upload finished, but I could not parse the BuildID from ${target.outputLogPath}.`);
  process.exit(1);
}

console.log(`${target.label} upload completed with BuildID ${uploadedBuildId}.`);

if (!noLive && (!target.autoSetLiveFromUpload || shouldDisableSetLiveDuringUpload)) {
  if (!steamEnv.steamPartnerKey) {
    console.warn(
      `Skipping SetAppBuildLive because STEAM_PARTNER_KEY is missing. Add it to ${steamEnv.secretsPath} if you want ${target.label} uploads to go live automatically.`
    );
    process.exit(0);
  }

  console.log(`Promoting ${target.label} BuildID ${uploadedBuildId} to ${steamEnv.steamBranch}...`);
  await setBuildLive(
    target,
    steamEnv.steamPartnerKey,
    uploadedBuildId,
    steamEnv.steamBranch,
    steamEnv.steamApproverSteamId
  );
}

if (steamEnv.steamPartnerKey) {
  const liveBuildId = await getBranchBuildId(target, steamEnv.steamPartnerKey, steamEnv.steamBranch);
  console.log(`${target.label} branch ${steamEnv.steamBranch} is now on BuildID ${liveBuildId}.`);
} else {
  console.log(`${target.label} upload is complete. Branch verification skipped because STEAM_PARTNER_KEY is not set.`);
}
