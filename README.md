# Hosting with playit.gg

This guide explains how to expose your local game server to the internet using **playit.gg**, allowing remote players to connect without port forwarding.

## 1. Prerequisites

- **Node.js** installed.
- **playit.gg agent** installed on your machine.
  - [Download playit.gg](https://playit.gg/download)

## 2. Server Setup (Host)

### Step 1: Start the Local Game Server
The server is configured to listen on port **3001** by default.

```bash
cd server
npm run dev
```

You should see:
```
Server is running on port 3001
```

### Step 2: Start playit.gg Tunnel
1. Run the playit agent:
   - **Windows:** Double-click the `playit.exe`.
   - **macOS/Linux:** Run `playit` in a terminal.
2. Follow the link provided in the terminal to claim your agent on the playit.gg website.
3. On the dashboard, create a **TCP Tunnel**:
   - **Tunnel Type:** Custom (TCP)
   - **Local Address:** `127.0.0.1`
   - **Local Port:** `3001`
   - **Port Count:** 1
4. Once created, playit.gg will give you a public address (e.g., `s1.playit.gg:12345`).

**Note:** Ensure the agent stays running while you want people to connect.

## 3. Client Connection (Remote Players)

Remote players need to tell their game client to connect to your playit.gg address instead of localhost.

### Option A: Join via UI
1. Launch the game client.
2. Go to **Multiplayer** -> **Join Game**.
3. Enter the **Join Code** provided by the host (e.g., `PLAYIT:s1.playit.gg:12345`) or the raw WebSocket URL (`ws://s1.playit.gg:12345`).
4. Click **Join**.

### Option B: Environment Variable (Dev/Electron)
Start the client with the `VITE_SERVER_URL` environment variable set to the public address.

**macOS/Linux:**
```bash
cd client
VITE_SERVER_URL="http://s1.playit.gg:12345" npm run electron:dev
# OR for browser
VITE_SERVER_URL="http://s1.playit.gg:12345" npm run dev
```

**Windows (PowerShell):**
```powershell
$env:VITE_SERVER_URL="http://s1.playit.gg:12345"; npm run electron:dev
```
