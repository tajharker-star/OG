# Steam Review Fixes For App 4432210

Updated: 2026-03-27

This note tracks the Steam review issues reported for `Conquerors: Domination` and what is already fixed locally versus what still needs a Steamworks admin session.

## Ready Now

- Real gameplay screenshots prepared for store upload:
  - `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/screenshots/screenshot-01-1920x1080.png`
  - `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/screenshots/screenshot-02-1920x1080.png`
- Gameplay trailer source prepared:
  - `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/trailer/gameplay-trailer.webm`
- LAN PVP validation passed locally:
  - report: `/Users/codyharker/Desktop/cody/OG/client/tests/output/lan-pvp/report.md`
  - host screenshot: `/Users/codyharker/Desktop/cody/OG/client/tests/output/lan-pvp/host.png`
  - joiner screenshot: `/Users/codyharker/Desktop/cody/OG/client/tests/output/lan-pvp/join.png`

## Steam Review Items

### 1. Steam Cloud developer-only checkbox

Valve reported that `Cloud support for developers only` is still enabled while the store page advertises Steam Cloud.

Required Steamworks change:
- Open `App Data Admin -> Steam Cloud`
- Uncheck `Cloud support for developers only`
- Save and publish the change

Status:
- Not changed yet from automation because the current Steamworks partner session handoff is still failing after login.

### 2. Trailer must show gameplay

Valve rejected the current review build because the uploaded trailer does not show real gameplay.

Replacement asset prepared:
- `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/trailer/gameplay-trailer.webm`

Recommended action:
- Upload this gameplay trailer, or another real gameplay capture, into the store page trailer section before resubmitting.

### 3. Screenshot 1 must be gameplay-only

Valve flagged the first screenshot as non-gameplay.

Replacement assets prepared:
- `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/screenshots/screenshot-01-1920x1080.png`
- `/Users/codyharker/Desktop/cody/OG/client/steam-store-assets/main/screenshots/screenshot-02-1920x1080.png`

Recommended action:
- Replace the flagged screenshot with one of the gameplay captures above.

### 4. Content Survey AI disclosure

Valve indicated that the current trailer and some screenshots appear to have been created with AI.

Required Content Survey action:
- If any AI-generated trailer/screenshots remain on the store page, update the Content Survey to disclose AI-generated store assets.
- If all AI-generated trailer/screenshots are removed and replaced with real gameplay captures, the survey can be updated to reflect the remaining truth of the store page.

Important:
- This needs to match the final assets that are actually left on the store page at resubmission time.

### 5. Content Survey must disclose in-game chat

The game includes in-game chat.

Code evidence:
- `/Users/codyharker/Desktop/cody/OG/server/src/index.ts`
- `/Users/codyharker/Desktop/cody/OG/client/src/components/GameUI.tsx`

Required Content Survey action:
- Check the `In-game chat` category in the Content Survey before resubmitting.

### 6. LAN PVP verification

Valve said they could not verify LAN PVP.

Local validation result:
- PASS
- Host created a LAN room
- Second client joined by room ID
- Match progressed into the synchronized start flow and reached gameplay HUD state

Artifacts:
- `/Users/codyharker/Desktop/cody/OG/client/tests/output/lan-pvp/report.md`

## Automation Added

Local helper scripts added for this review cycle:
- `/Users/codyharker/Desktop/cody/OG/client/scripts/capture-steam-gameplay-assets.mjs`
- `/Users/codyharker/Desktop/cody/OG/client/scripts/test-lan-pvp.mjs`

Package scripts:
- `npm run build:steam-gameplay-assets`
- `npm run test:lan-pvp`

## Current Blocker

The remaining unresolved items are Steamworks admin-page changes, not code/runtime issues:
- Steam Cloud checkbox
- Content Survey updates
- Store screenshot/trailer upload

Those still require a working authenticated Steamworks partner browser session.
