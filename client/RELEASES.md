# Release Layout

Steam-ready platform builds are staged into `client/releases/steam/` after `npm run stage:steam` or `npm run dist:steam`.
`npm run dist:steam` rebuilds fresh Steam artifacts before staging on supported hosts.

Platform folders:
- `client/releases/steam/microsoft-windows/` -> `ConquerorsDominationDemo.exe`
- `client/releases/steam/macos/` -> `ConquerorsDominationDemo.app`
- `client/releases/steam/linux/` -> `conquerors-domination-demo`

Steam launch mapping:
- Windows uses `ConquerorsDominationDemo.exe`
- macOS uses `ConquerorsDominationDemo.app`
- Linux + SteamOS uses `conquerors-domination-demo`

SteamPipe upload sources:
- Depot `4432222` -> `releases/steam/microsoft-windows/*`
- Depot `4432223` -> `releases/steam/macos/*`
- Depot `4432224` -> `releases/steam/linux/*`

Validation commands:
- `npm run stage:steam`
- `npm run verify:steam-layout`
- `npm run verify:release-binaries`
- `npm run verify:steam-runtime`
- `npm run smoke:packaged-server`
- `npm run smoke:packaged`
- `npm run smoke:windows:wine` (optional, requires `wine`/`wine64` or `WINE_BIN`)
- `npm run dist:steam`
