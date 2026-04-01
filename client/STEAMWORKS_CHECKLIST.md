# Steamworks Checklist Prep

This file is the local prep pack for Steam app `4432220`.

It does not log into Steamworks for you. It gives you the exact repo-backed data, upload commands, and recommended Steamworks selections so the remaining web UI work is minimal.

## What is already verified locally

- App ID: `4432220`
- Demo build description: `Conquerors: Domination Demo Build`
- Depot `4432222` -> macOS
- Depot `4432223` -> Windows
- Depot `4432224` -> Linux + SteamOS
- No shared placeholder depot. The demo app should install only the current platform depot.
- Install folder: `Conquerors Domination Demo`
- Windows launch target: `ConquerorsDominationDemo.exe`
- macOS launch target: `ConquerorsDominationDemo.app`
- Linux launch target: `conquerors-domination-demo`

Validated on `2026-03-03`:

- `npm run verify:steam-layout` -> passed
- `npm run verify:release-binaries` -> passed
- `npm run smoke:packaged` -> passed on macOS staged build

Post-publish validation on a host machine:

- `npm run verify:steam-install` -> confirms Steam mounted the expected depot for the current OS and that the launch target exists in `steamapps/common`

## Commands

Open the Steamworks app page in your local browser:

```bash
open "https://partner.steamgames.com/apps/landing/4432220"
```

Rebuild and restage the Steam release locally:

```bash
cd /Users/codyharker/Desktop/cody/OG/client
npm run dist:steam
```

Upload the staged build with SteamCMD:

```bash
cd /Users/codyharker/Desktop/cody/OG/client
steamcmd +login "$STEAM_USER" +run_app_build_http steampipe/app_build_4432220.vdf +quit
```

Notes:

- Use your own Steam account locally. Do not paste credentials into chat.
- If Steam Guard prompts, finish that in your own terminal session.
- The upload command only handles the build checklist. It does not complete the store, pricing, or legal checklists.

## Steamworks values to use

- Product name: `Conquerors: Domination Demo`
- App type: `Demo`
- Default language: `English`
- Supported OS: `Windows`, `macOS`, `Linux + SteamOS`
- Install folder: `Conquerors Domination Demo`

Recommended language matrix:

- English -> Interface: `Yes`
- English -> Full Audio: `No`
- English -> Subtitles: `No`

## Store page draft copy

Short description:

`A strategy war game demo featuring campaign battles, custom skirmishes, LAN play, and online multiplayer across land, sea, and air.`

About This Game:

`Conquerors: Domination Demo is a fast-paced strategy war game focused on base expansion, army composition, and territorial control. Build your economy, train land, naval, and air units, and overwhelm enemy factions across island, desert, grassland, and random battlefields.`

`This demo includes single-player campaign battles, custom matches with AI bots, LAN play, and online multiplayer with lobby-based matches and shareable join codes.`

Key features:

- Build a base economy with mines, farms, docks, tank factories, air bases, towers, walls, and oil production.
- Command mixed armies with infantry, tanks, missile units, naval transports, destroyers, aircraft carriers, and aircraft.
- Play campaign stages or launch custom skirmishes with adjustable bot count and difficulty.
- Host LAN or online matches and invite players with room IDs or Steam lobbies.
- Fight across multiple map types including islands, grasslands, desert, and random warzones.

Suggested tags:

- Strategy
- Real Time Strategy
- Base Building
- Multiplayer
- PvP
- Singleplayer
- Top-Down
- War

## Recommended feature checkboxes

These are the safest Steamworks feature selections based on the current repo.

Check:

- Single-player
- Online PvP
- LAN PvP

Conditional:

- Cross-Platform Multiplayer
Only check this if you want Windows, macOS, and Linux players sharing the same live ecosystem. The build and networking layout suggest this is intended.

- Steam Achievements
Only check this if you also configure the Steamworks achievement API name `WIN_GAME`. The client code can trigger it, but the backend definition still has to exist in Steamworks.

## Steam stats to create

If you want the new lobby statistics screen to persist through Steam, create these integer stat API names in Steamworks for app `4432220`:

- `STAT_LIFETIME_WINS`
- `STAT_LIFETIME_LOSSES`
- `STAT_LIFETIME_DRAWS`
- `STAT_LIFETIME_BEST_WIN_STREAK`
- `STAT_CAMPAIGN_WINS`
- `STAT_CAMPAIGN_LOSSES`
- `STAT_CUSTOM_WINS`
- `STAT_CUSTOM_LOSSES`
- `STAT_MULTIPLAYER_WINS`
- `STAT_MULTIPLAYER_LOSSES`
- `STAT_MULTIPLAYER_DRAWS`
- `STAT_COOP_WINS`
- `STAT_COOP_LOSSES`
- `STAT_RANKED_WINS`
- `STAT_RANKED_LOSSES`
- `STAT_RANKED_BEST_WIN_STREAK`

Notes:

- The client will still save stats locally even if these Steam stat definitions do not exist yet.
- Steam sync will only store the stat names that are configured on the Steamworks backend.
- Once those stats exist, you can wire achievement unlock conditions against them inside Steamworks.

If you want the new achievements screen to sync with Steam too, create these achievement API names:

- `FIRST_DEPLOYMENT`
- `FIELD_TESTED`
- `WAR_MACHINE`
- `FIRST_VICTORY`
- `SEASONED_WINNER`
- `DOMINATOR`
- `STAYING_POWER`
- `LEGENDARY_STREAK`
- `CAMPAIGN_INITIATE`
- `TUTORIAL_GRADUATE`
- `CAMPAIGN_CONQUEROR`
- `CAMPAIGN_LEGEND`
- `SKIRMISH_STARTER`
- `SKIRMISH_SUPREME`
- `NETWORK_INITIATE`
- `ONLINE_WARLORD`
- `ONLINE_LEGEND`
- `COOP_WINGMAN`
- `BOT_LEVEL_7`
- `BOT_LEVEL_8`
- `BOT_LEVEL_9`
- `BOT_LEVEL_10`
- `PVE_COMMANDER`
- `RANKED_ROOKIE`
- `RANKED_CONTENDER`

Use the generated metadata pack when creating or updating them in Steamworks:

- `/Users/codyharker/Desktop/cody/OG/client/steam-achievements/demo/steamworks-achievements.json`
- `/Users/codyharker/Desktop/cody/OG/client/steam-achievements/demo/steamworks-achievements.csv`

Those files include the exact API names, display titles, descriptions, and the matching locked/unlocked icon paths for the current achievement set, including:

- `TUTORIAL_GRADUATE`
- `BOT_LEVEL_7`
- `BOT_LEVEL_8`
- `BOT_LEVEL_9`
- `BOT_LEVEL_10`

Leave unchecked unless you add explicit support:

- Full controller support
- Partial controller support
- Steam Cloud
- Steam Leaderboards
- Steam Workshop
- Trading Cards
- Remote Play Together
- Co-op
- Online Co-op
- LAN Co-op
- Split screen
- VR support

## Demo-specific notes

- If this demo belongs to a separate full game app, link the demo to the base game in Steamworks demo settings.
- If the demo has its own store page, make sure the graphical assets visibly include the word `Demo`.

## Assets currently available in this repo

Screenshots:

- `client/packaged-app-verification.png` -> `4480x2520`
- `client/building-preview.png` -> `1280x720`
- `client/unit-preview.png` -> `1280x720`

Icon:

- `client/public/app-icon.png` -> `512x512`

Release artwork candidates:

- `client/packaged-app-dock.png`
- `client/packaged-app-dock-wide.png`

Important:

- This repo does not clearly contain the full Steam capsule/library asset set in standard Steamworks sizes.
- The Store Presence checklist will not fully clear until those assets are uploaded in Steamworks, or until a matching asset set is generated and committed locally.

## Manual-only checklist items

These still require you, as the Steamworks account owner, to review and confirm in the web UI:

- Pricing and availability
- Demo package visibility
- Content survey / age-rating answers
- Legal attestations
- Tax / banking / company info
- Release dates
- Demo-to-base-game association
- Store capsule and library artwork uploads
- Final `Mark as ready for review` / release actions

## Risks to fix before claiming the checklist is complete

- In-game naming is inconsistent. The package, SteamPipe config, and release folder use `Conquerors Domination Demo`, while the current browser/window title inside the client still shows `Conquerors: Dominion`.
- Steam lobby capacity is inconsistent. The Steam integration currently creates Steam lobbies with a max size of `4`, while the in-game room UI allows up to `10` required human players.
- Do not claim Steam-invite multiplayer above 4 players until that mismatch is resolved.

## Repo files that matter

- `client/steampipe/app_build_4432220.vdf`
- `client/steampipe/depot_build_4432222.vdf`
- `client/steampipe/depot_build_4432223.vdf`
- `client/steampipe/depot_build_4432224.vdf`
- `client/RELEASES.md`
- `client/scripts/verify-steam-layout.mjs`
- `client/scripts/verify-release-binaries.mjs`
- `client/electron/main.cjs`
- `client/src/App.tsx`
- `client/src/services/steam.ts`
