# Steamworks Main Game Checklist (App 4432210)

This file tracks what was completed programmatically and what remains UI-only for the main game app.

## Completed by automation on 2026-03-10

- Uploaded a new main-game build to depot `4432211`.
- Build ID: `22270527`
- Depot manifest GID: `7241007551054220428`
- Set `public` branch live to build `22270527` via Steam Partner API.

Verification command output showed:

- `depots.branches.public.buildid = 22270527`
- `depots.4432211.manifests.public.gid = 7241007551054220428`

## Exact launch options to enter in Steamworks UI

Because the main app now uses separate platform depots, use these executable paths:

- Windows: `ConquerorsDominationDemo.exe`
- macOS: `ConquerorsDominationDemo.app`
- Linux + SteamOS: `conquerors-domination-demo`

Install folder:

- `Conquerors Domination`

## Store checklist assets prepared locally

Generated in:

- `client/steam-store-assets/main/`

Includes:

- 5 screenshots
- Capsules (616x353, 460x215, 231x87)
- Library assets (600x900, 3840x1240 + logo source)
- Community icon candidates (512x512, 32x32, 16x16)

Regenerate with:

```bash
cd /Users/codyharker/Desktop/cody/OG/client
npm run build:steam-store-assets
```

## Still manual-only in Steamworks web UI

- Basic Info / Descriptions
- Content Survey
- Planned Release Date
- System Requirements
- Controller Support Description
- Upload screenshots/capsules/library assets/support info/tags
- Set Developer and Publisher names
- Store-side platform support sync if still flagged
- Trailer upload
- Publish app metadata changes in the Publish tab

## Important note

The Steam Web API key in use can upload and set build live, but it does not provide endpoints for full store-page metadata editing. Those fields must be completed in the Steamworks UI.
