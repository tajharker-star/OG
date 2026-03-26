import { getTarget, syncSteamAppIdFiles } from "./steam-common.mjs";

const targetKey = process.argv[2];

if (!targetKey) {
  console.error("Usage: node scripts/sync-steam-appids.mjs <demo|main>");
  process.exit(1);
}

const target = getTarget(targetKey);
syncSteamAppIdFiles(target);
console.log(`Synced staged steam_appid.txt files for ${target.label} (${target.appId}).`);
