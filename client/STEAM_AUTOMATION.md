# Steam Upload Automation

This setup gives you three clickable actions from Finder on macOS:

- `client/actions/upload-demo.command`
- `client/actions/upload-main.command`
- `client/actions/make-live.command`

## One-time setup

1. Create a local secrets file:

   - Copy `client/.steam-secrets.example` to `client/.steam-secrets`

2. Fill in your real values in `client/.steam-secrets`:

```env
STEAM_USERNAME=your_steam_username
STEAM_PASSWORD=your_steam_password
STEAM_PARTNER_KEY=your_partner_api_key
STEAM_APPROVER_STEAMID=your_partner_steamid64
STEAM_BRANCH=public
```

Notes:

- `STEAM_PASSWORD` is optional. If you leave it out, SteamCMD will prompt for it.
- `STEAM_PARTNER_KEY` is required for the main-game upload to auto-promote the new build live, and for the standalone `make-live` action.
- `STEAM_APPROVER_STEAMID` is recommended for any app where Valve requires a mobile-confirmed approver on `public`. With that set, the scripts can upload first and then request the correct live-promotion approval automatically.
- Steam Guard approval may still be required. That cannot be bypassed safely from local automation.

## What each action does

### Upload Demo

`client/actions/upload-demo.command`

- Runs the full local build + verify + smoke flow
- Uploads app `4432220`
- If `STEAM_APPROVER_STEAMID` is set, it uploads first and then promotes the build live through the Partner API so released/public approval flows work cleanly

### Upload Main

`client/actions/upload-main.command`

- Runs the full local build + verify + smoke flow
- Uploads app `4432210`
- If `STEAM_PARTNER_KEY` exists, it also promotes the uploaded build live on `public`

### Make Live

`client/actions/make-live.command`

- Lets you choose `demo` or `main`
- Lets you enter a specific `BuildID`, or leave it blank to use the latest uploaded build
- Promotes that build live on the configured branch

## Terminal commands if you prefer them

```bash
cd /Users/codyharker/Desktop/cody/OG/client
npm run steam:upload:demo
npm run steam:upload:main
npm run steam:set-live -- demo
npm run steam:set-live -- main
```

## Important limitation

This automation handles the repeatable technical steps, but Steam may still ask for:

- Steam Guard mobile approval
- Steamworks partner permissions on the account in use

That part still needs your approval when Valve requests it.
