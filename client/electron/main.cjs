const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = electron;
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// In CJS, __dirname and __filename are already defined
let steamClient;
let serverProcess;

// Steam native binaries may be missing on CI/Linux. Allow skipping via
// DISABLE_STEAM=1 so smoke tests can launch the app without Steam present.
if (process.env.DISABLE_STEAM === '1') {
  console.log('[Steam] Disabled via DISABLE_STEAM=1');
} else {
  try {
    const steamworks = require('steamworks.js');
    steamClient = steamworks.init(4432220);
  } catch (e) {
    console.error('[Steam] Failed to load or initialize:', e);
  }
}

// --- Performance Fixes ---
// We enable HW Acceleration for better performance.
// app.disableHardwareAcceleration(); 
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000', // Black background to match game
    show: false, // Wait until ready to avoid flicker
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simplified security for local app
    },
  });

  // Show window only when content is ready
  win.once('ready-to-show', () => {
    win.show();
  });

  // Crash Guard: Reload on renderer crash
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Electron] Render process gone:', details);
    if (details.reason !== 'clean-exit') {
      console.log('[Electron] Reloading renderer due to crash...');
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.reload();
        }
      }, 1000);
    }
  });

  // Soft Refresh (Ctrl+R / Cmd+R)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key.toLowerCase() === 'r') {
        event.preventDefault();
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev) {
          win.loadURL('http://localhost:5173');
        } else {
          win.loadFile(path.join(__dirname, '../dist/index.html'));
        }
      }
    }
  });

  // Check if we are in dev mode
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    win.loadURL('http://localhost:5173').catch(err => {
      console.error('[Electron] Failed to load Dev URL:', err);
    });
  } else {
    // 1. Load the GUI first so the user sees the menu immediately
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log('[Electron] Loading Production File:', indexPath);
    win.loadFile(indexPath).catch(err => {
      console.error('[Electron] Failed to load Production file:', err);
    });
  }

  // 2. Start the local server in the background for Campaign/Local play
  // This is needed for local development AND production

  const isPackaged = app.isPackaged;
  let serverPath;
  let serverCwd;

  if (isPackaged) {
    // Packaged mode: Server is in extraResources
    serverPath = path.join(process.resourcesPath, 'server', 'dist', 'index.js');
    serverCwd = path.dirname(path.dirname(serverPath));

    // Fallback just in case
    if (!fs.existsSync(serverPath)) {
      const fallback = path.join(__dirname, '..', '..', 'server', 'dist', 'index.js');
      if (fs.existsSync(fallback)) {
        serverPath = fallback;
        serverCwd = path.dirname(path.dirname(serverPath));
      }
    }
  } else {
    // Development mode
    serverPath = path.join(__dirname, '../../server/dist/index.js');
    serverCwd = path.join(__dirname, '../../server');
  }

  // Create a log file for the server in the app directory
  const logPath = path.join(app.getPath('userData'), 'server.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    logStream.write(formatted);
  };

  log(`[Electron] Starting local backend server...`);
  log(`[Electron] Server Path: ${serverPath}`);
  log(`[Electron] Server CWD: ${serverCwd}`);
  log(`[Electron] NODE_ENV: ${process.env.NODE_ENV}`);

  if (fs.existsSync(serverPath)) {
    // Use Electron's embedded Node runtime so Steam users do not need Node installed.
    const useEmbeddedNode = process.execPath.toLowerCase().includes('electron') || isPackaged;
    const serverCommand = useEmbeddedNode ? process.execPath : 'node';
    const serverEnv = { ...process.env, PORT: '3001', NODE_ENV: 'production' };
    if (useEmbeddedNode) {
      serverEnv.ELECTRON_RUN_AS_NODE = '1';

      // When launching an external script with Electron's Node runtime,
      // include the app's bundled node_modules in module resolution.
      const candidateNodePaths = [
        path.join(serverCwd, 'node_modules'),
        path.join(process.resourcesPath, 'app.asar', 'node_modules'),
        path.join(process.resourcesPath, 'app', 'node_modules')
      ];
      const existingNodePaths = (process.env.NODE_PATH || '')
        .split(path.delimiter)
        .filter(Boolean);
      const mergedNodePaths = [...new Set([...candidateNodePaths, ...existingNodePaths])]
        .filter(p => fs.existsSync(p));
      if (mergedNodePaths.length > 0) {
        serverEnv.NODE_PATH = mergedNodePaths.join(path.delimiter);
        log(`[Electron] NODE_PATH: ${serverEnv.NODE_PATH}`);
      }
    }

    log(`[Electron] Launch Command: ${serverCommand} ${serverPath}`);
    serverProcess = spawn(serverCommand, [serverPath], {
      cwd: serverCwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    serverProcess.stdout.on('data', (data) => log(`[Server] ${data}`));
    serverProcess.stderr.on('data', (data) => log(`[Server Error] ${data}`));

    serverProcess.on('close', (code) => {
      log(`[Server] Process exited with code ${code}`);
    });

    serverProcess.on('error', (err) => {
      log(`[Server] Failed to start process: ${err.message}`);
    });
  } else {
    log(`[Electron] ERROR: Local server not found at: ${serverPath}`);
    console.warn('[Electron] Local server not found at:', serverPath);
  }

  // Log load failures to help diagnose black screens
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load: ${validatedURL}`);
    console.error(`  Error Code: ${errorCode}`);
    console.error(`  Description: ${errorDescription}`);

    // If it's a file:// error, try to diagnose path
    if (validatedURL.startsWith('file://')) {
      console.error('[Electron] Check if the path is correct and files are built.');
    }
  });

  // --- Steam Integration ---
  if (steamClient) {
    console.log('[Steam] Initialized successfully. Player:', steamClient.localplayer.getName());

    // Notify renderer of success
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('steam:init-success', {
        steamId: steamClient.localplayer.getSteamId().steamId64.toString(),
        name: steamClient.localplayer.getName()
      });
    });

    // Handle Overlay
    ipcMain.on('steam:activate-overlay', (_, dialog) => {
      steamClient.overlay.activate(dialog || 'Friends');
    });

    // Handle Rich Presence
    ipcMain.on('steam:set-rich-presence', (_, data) => {
      for (const [key, value] of Object.entries(data)) {
        steamClient.localplayer.setRichPresence(key, value);
      }
    });

    // Handle Lobby Creation
    ipcMain.handle('steam:create-lobby', async (_, data) => {
      try {
        const lobby = await steamClient.matchmaking.createLobby(2, 4);
        if (lobby) {
          await lobby.setData('ag_room', data.roomId);
          await lobby.setData('map', data.map || 'Unknown');
          await lobby.setData('mode', data.mode || 'Standard');
          console.log('[Steam] Created Lobby:', lobby.id, 'for Room:', data.roomId);
          return { success: true, lobbyId: lobby.id };
        }
        return { success: false };
      } catch (err) {
        console.error('[Steam] Create Lobby Error:', err);
        return { success: false, error: err.message };
      }
    });

    // Handle Getting Current Lobby Data
    ipcMain.handle('steam:get-lobby-data', async (_, lobbyId) => {
      try {
        console.log('[Steam] Joining lobby to read data:', lobbyId);
        const lobby = await steamClient.matchmaking.joinLobby(lobbyId);
        const roomId = await lobby.getData('ag_room');
        console.log('[Steam] Got Room ID:', roomId);
        return { success: true, roomId };
      } catch (err) {
        console.error('[Steam] Get Lobby Data Error:', err);
        return { success: false, error: err.message };
      }
    });

    // Handle Achievements
    ipcMain.on('steam:activate-achievement', (_, achievementId) => {
      try {
        if (steamClient.achievement.activate(achievementId)) {
          console.log('[Steam] Achievement Activated:', achievementId);
        }
      } catch (err) {
        console.error('[Steam] Failed to activate achievement:', err);
      }
    });
  } else {
    console.log('[Steam] Initialization failed or not running.');
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('steam:init-error', 'Steam is not running or AppID is missing.');
    });
  }

  // --- Persistence Handlers (Save/Load) ---
  const SAVE_FILE = path.join(app.getPath('userData'), 'save.json');
  console.log('[Persistence] Save file path:', SAVE_FILE);

  ipcMain.handle('save-data', async (_, data) => {
    try {
      await fs.promises.writeFile(SAVE_FILE, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (err) {
      console.error('[Persistence] Save Error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('load-data', async () => {
    try {
      if (!fs.existsSync(SAVE_FILE)) {
        return { success: true, data: null };
      }
      const data = await fs.promises.readFile(SAVE_FILE, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    } catch (err) {
      console.error('[Persistence] Load Error:', err);
      return { success: false, error: err.message };
    }
  });
}

// Check for Steam Launch Args (+connect_lobby <lobbyId>)
const handleSteamLaunchArgs = (argv) => {
  const idx = argv.indexOf('+connect_lobby');
  if (idx !== -1 && argv[idx + 1]) {
    const lobbyId = argv[idx + 1];
    return lobbyId;
  }
  return null;
};

app.whenReady().then(() => {
  createWindow();

  // --- Secret Bypass Shortcut ---
  globalShortcut.register('CommandOrControl+O', () => {
    console.log('[Electron] Secret Bypass Shortcut Triggered!');
    const wins = BrowserWindow.getAllWindows();
    wins.forEach(win => {
      win.webContents.send('steam:bypass-error');
    });
  });

  const lobbyId = handleSteamLaunchArgs(process.argv);
  if (lobbyId && steamClient) {
    const checkWin = setInterval(() => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0 && wins[0].webContents && !wins[0].webContents.isLoading()) {
        wins[0].webContents.send('steam:join-lobby', lobbyId);
        clearInterval(checkWin);
      }
    }, 1000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/PID', serverProcess.pid, '/T']);
    } else {
      serverProcess.kill();
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
