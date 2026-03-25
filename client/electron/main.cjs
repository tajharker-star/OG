const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const brokenStdIoErrorCodes = new Set(['EBADF', 'EINVAL', 'ENXIO']);
const fallbackConsoleLogPath = path.join(os.tmpdir(), 'conquerors-domination-demo-main.log');

function formatConsoleArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }

  if (typeof arg === 'string') {
    return arg;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function patchConsoleMethod(method) {
  const original = console[method].bind(console);

  console[method] = (...args) => {
    try {
      original(...args);
      return;
    } catch (err) {
      if (!err || !brokenStdIoErrorCodes.has(err.code)) {
        throw err;
      }
    }

    try {
      const line = `[${new Date().toISOString()}] [${method}] ${args.map(formatConsoleArg).join(' ')}\n`;
      fs.appendFileSync(fallbackConsoleLogPath, line);
    } catch {
      // No further fallback is available if file logging also fails.
    }
  };
}

['log', 'warn', 'error'].forEach(patchConsoleMethod);

function writeMainLog(message) {
  try {
    fs.appendFileSync(fallbackConsoleLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures.
  }
}

// In CJS, __dirname and __filename are already defined
let steamClient;
let steamworksApi;
let steamJoinRequestedHandle;
let serverProcess;
let mainWindow;
const isSmokeTest = process.env.SMOKE_TEST === '1';
const appIconPath = path.join(__dirname, 'icons', 'app-icon.png');
const appCopyright = 'Copyright © 2026 Thecoadstar';

function stopServerProcess() {
  if (!serverProcess) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/PID', serverProcess.pid, '/T']);
  } else {
    serverProcess.kill();
  }

  serverProcess = null;
}

function getBestLanAddress() {
  const interfaces = os.networkInterfaces();
  let fallback = '127.0.0.1';

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const iface of entries) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
        return iface.address;
      }
      fallback = iface.address;
    }
  }

  return fallback;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) }, () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isServerReachable(port = '3001') {
  return checkPort(port);
}

async function waitForServerReady(port = '3001', timeoutMs = 15000, pollMs = 250) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    if (await isServerReachable(port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return false;
}

function registerCoreIpcHandlers() {
  const saveFile = path.join(app.getPath('userData'), 'save.json');
  console.log('[Persistence] Save file path:', saveFile);

  ipcMain.removeHandler('save-data');
  ipcMain.handle('save-data', async (_, data) => {
    try {
      let existing = {};
      if (fs.existsSync(saveFile)) {
        try {
          const current = await fs.promises.readFile(saveFile, 'utf-8');
          const parsed = JSON.parse(current);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            existing = parsed;
          }
        } catch (err) {
          console.warn('[Persistence] Failed to parse existing save file, replacing with incoming data.', err);
        }
      }

      const next = (data && typeof data === 'object' && !Array.isArray(data))
        ? { ...existing, ...data }
        : existing;

      await fs.promises.writeFile(saveFile, JSON.stringify(next, null, 2));
      return { success: true };
    } catch (err) {
      console.error('[Persistence] Save Error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.removeHandler('load-data');
  ipcMain.handle('load-data', async () => {
    try {
      if (!fs.existsSync(saveFile)) {
        return { success: true, data: null };
      }
      const data = await fs.promises.readFile(saveFile, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    } catch (err) {
      console.error('[Persistence] Load Error:', err);
      return { success: false, error: err.message };
    }
  });
}

function normalizeEndpointForLobby(rawValue, defaultPort = '3001') {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  let value = rawValue.trim();
  if (!value) return null;

  if (value.startsWith('PLAYIT:')) {
    const parts = value.split(':');
    if (parts.length >= 3) {
      value = `http://${parts[1]}:${parts[2]}`;
    }
  }

  if (value.startsWith('ws://')) {
    value = `http://${value.slice('ws://'.length)}`;
  } else if (value.startsWith('wss://')) {
    value = `https://${value.slice('wss://'.length)}`;
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  if (/^[^/\s]+:\d+$/.test(value) || /^\[[^\]]+\]:\d+$/.test(value)) {
    return `http://${value}`;
  }

  if (/^[^\s/:]+$/.test(value)) {
    return `http://${value}:${defaultPort}`;
  }

  return null;
}

function emitSteamJoinLobby(lobbyId) {
  if (!lobbyId) return;

  const sendToReadyWindow = () => {
    const wins = BrowserWindow.getAllWindows();
    let delivered = false;
    wins.forEach((win) => {
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
      win.webContents.send('steam:join-lobby', lobbyId);
      delivered = true;
    });
    return delivered;
  };

  if (sendToReadyWindow()) return;

  const retry = setInterval(() => {
    if (sendToReadyWindow()) {
      clearInterval(retry);
    }
  }, 750);

  setTimeout(() => clearInterval(retry), 15000);
}

// Steam native binaries may be missing on CI/Linux. Allow skipping via
// DISABLE_STEAM=1 so smoke tests can launch the app without Steam present.
if (process.env.DISABLE_STEAM === '1') {
  console.log('[Steam] Disabled via DISABLE_STEAM=1');
} else {
  try {
    steamworksApi = require('steamworks.js');
    steamClient = steamworksApi.init(4432220);
  } catch (e) {
    console.error('[Steam] Failed to load or initialize:', e);
  }
}

function isWineRuntime() {
  if (process.platform !== 'win32') {
    return false;
  }

  if (process.env.WINELOADERNOEXEC || process.env.WINEPREFIX) {
    return true;
  }

  return /^z:\\/i.test(process.execPath || '');
}

const runningUnderWine = isWineRuntime();
const forceSoftwareRendering = process.env.AG_DISABLE_GPU === '1' || runningUnderWine;

if (forceSoftwareRendering) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  if (runningUnderWine) {
    app.commandLine.appendSwitch('disable-direct-composition');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
  console.log('[Electron] GPU acceleration disabled for compatibility mode.');
} else if (process.platform === 'darwin') {
  // Keep aggressive GPU tuning on native macOS builds only.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

app.setAboutPanelOptions({
  applicationName: 'ConquerorsDominationDemo',
  applicationVersion: app.getVersion(),
  copyright: appCopyright,
  authors: ['Thecoadstar'],
});

function presentWindow(win, reason) {
  if (!win || win.isDestroyed()) {
    return;
  }

  writeMainLog(`[Electron] Presenting window (${reason}).`);

  if (process.platform === 'darwin') {
    if (app.dock) {
      app.dock.show();
    }
    app.focus({ steal: true });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  if (process.platform === 'win32') {
    const [width, height] = win.getSize();
    if (width < 1024 || height < 600) {
      win.setSize(1280, 720);
    }
    if (runningUnderWine) {
      win.setPosition(40, 40);
    } else {
      win.center();
    }
  } else {
    win.center();
  }
  win.show();
  if (process.platform === 'win32' && win.isMinimized()) {
    win.restore();
  }
  win.focus();
  win.moveTop();

  if (process.platform === 'darwin') {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.setVisibleOnAllWorkspaces(false);
      }
    }, 1500);
  } else if (process.platform === 'win32') {
    // Wine/compat layers can leave a shown window off-screen unless we force z-order.
    win.setAlwaysOnTop(true, 'screen-saver');
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
      }
    }, 1200);
  }
}

function getProductionIndexCandidates() {
  const candidates = [];

  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'dist', 'index.html'),
      path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
      path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
    );
  }

  candidates.push(path.join(__dirname, '../dist/index.html'));

  return [...new Set(candidates)];
}

function getPreferredProductionDistPath() {
  const distCandidates = getProductionIndexCandidates()
    .map((indexPath) => path.dirname(indexPath));
  return distCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) || null;
}

function loadProductionRenderer(win, localServerUrl = null) {
  const candidates = [];
  if (localServerUrl) {
    candidates.push({ kind: 'url', value: localServerUrl });
  }
  for (const indexPath of getProductionIndexCandidates()) {
    candidates.push({ kind: 'file', value: indexPath });
  }

  const tryLoadCandidate = (index) => {
    if (index >= candidates.length) {
      writeMainLog('[Electron] Exhausted all production renderer candidates.');
      console.error('[Electron] Failed to load any production renderer candidate.');
      return;
    }

    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      writeMainLog('[Electron] Stopping production renderer fallback because the window is already destroyed.');
      return;
    }

    const candidate = candidates[index];

    if (candidate.kind === 'url') {
      writeMainLog(`[Electron] Loading production renderer candidate ${index + 1}/${candidates.length}: ${candidate.value}`);
      console.log('[Electron] Loading Production URL:', candidate.value);
      win.loadURL(candidate.value).catch((err) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          writeMainLog(`[Electron] Production renderer URL candidate was interrupted after window teardown: ${candidate.value}`);
          return;
        }
        writeMainLog(`[Electron] Production renderer URL candidate failed ${candidate.value}: ${err?.message || err}`);
        console.warn('[Electron] Production URL candidate failed:', candidate.value, err);
        tryLoadCandidate(index + 1);
      });
      return;
    }

    const exists = fs.existsSync(candidate.value);
    writeMainLog(
      `[Electron] Loading production renderer candidate ${index + 1}/${candidates.length}: ${candidate.value} (exists=${exists})`
    );
    console.log('[Electron] Loading Production File:', candidate.value);

    win.loadFile(candidate.value).catch((err) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        writeMainLog(`[Electron] Production renderer file candidate was interrupted after window teardown: ${candidate.value}`);
        return;
      }
      writeMainLog(`[Electron] Production renderer file candidate failed ${candidate.value}: ${err?.message || err}`);
      console.warn('[Electron] Production file candidate failed:', candidate.value, err);
      tryLoadCandidate(index + 1);
    });
  };

  tryLoadCandidate(0);
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    writeMainLog('[Electron] Reusing existing main window.');
    presentWindow(mainWindow, 'reuse');
    return mainWindow;
  }

  writeMainLog('[Electron] Creating main window.');
  registerCoreIpcHandlers();
  const localServerPort = process.env.PORT || '3001';

  ipcMain.removeHandler('local-server-status');
  ipcMain.handle('local-server-status', async () => {
    return {
      ready: await isServerReachable(localServerPort),
      port: localServerPort,
    };
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000', // Black background to match game
    show: process.platform === 'win32', // Avoid hidden-window issues under Wine/compat layers.
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simplified security for local app
    },
  });

  mainWindow = win;

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    writeMainLog(`[Renderer Console][${level}] ${message} (${sourceId}:${line})`);
  });

  // Show window only when content is ready
  win.once('ready-to-show', () => {
    writeMainLog('[Electron] Window ready-to-show.');
    console.log('[Electron] Window ready-to-show. Showing main window.');
    presentWindow(win, 'ready-to-show');
  });

  // Some macOS launches never emit ready-to-show even though the renderer is alive.
  win.webContents.once('did-finish-load', () => {
    writeMainLog('[Electron] Renderer finished loading.');
    console.log('[Electron] Renderer finished loading.');
    if (!win.isVisible()) {
      writeMainLog('[Electron] Window still hidden after did-finish-load. Forcing show.');
      console.log('[Electron] Window still hidden after did-finish-load. Forcing show.');
    }
    presentWindow(win, 'did-finish-load');
  });

  if (isSmokeTest) {
    const fallbackQuit = setTimeout(() => {
      console.log('[SmokeTest] Fallback quit triggered.');
      stopServerProcess();
      if (!win.isDestroyed()) {
        win.destroy();
      }
      app.exit(0);
    }, 25000);

    win.webContents.once('did-finish-load', async () => {
      const smokeCapturePath = process.env.SMOKE_CAPTURE_PATH;

      if (smokeCapturePath) {
        try {
          const probe = await win.webContents.executeJavaScript(`(() => {
            const splash = !!document.getElementById('boot-splash');
            const title = document.title || '';
            const htmlLength = document.documentElement?.outerHTML?.length || 0;
            const bodyBackground = getComputedStyle(document.body).background || '';
            return { splash, title, htmlLength, bodyBackground };
          })()`);
          console.log('[SmokeTest] DOM probe:', JSON.stringify(probe));

          await new Promise((resolve) => setTimeout(resolve, 1200));
          const image = await win.webContents.capturePage();
          fs.mkdirSync(path.dirname(smokeCapturePath), { recursive: true });
          fs.writeFileSync(smokeCapturePath, image.toPNG());
          console.log('[SmokeTest] Renderer screenshot saved:', smokeCapturePath);
        } catch (err) {
          console.error('[SmokeTest] Failed to capture renderer screenshot:', err);
        }
      }

      console.log('[SmokeTest] Renderer loaded. Closing app shortly.');
      setTimeout(() => {
        clearTimeout(fallbackQuit);
        stopServerProcess();
        if (!win.isDestroyed()) {
          win.destroy();
        }
        setTimeout(() => app.exit(0), 250);
      }, 6000);
    });
  }

  // Crash Guard: Reload on renderer crash
  win.webContents.on('render-process-gone', (event, details) => {
    writeMainLog(`[Electron] Render process gone: ${JSON.stringify(details)}`);
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
          loadProductionRenderer(win, `http://127.0.0.1:${localServerPort}`);
        }
      }
    }
  });

  // Check if we are in dev mode
  const isDev = process.env.NODE_ENV === 'development';

  const forceShowTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      writeMainLog('[Electron] Force-show fallback triggered.');
      console.log('[Electron] Force-show fallback triggered.');
      presentWindow(win, 'force-show');
    }
  }, 5000);

  win.on('show', () => {
    writeMainLog('[Electron] Window show event.');
    clearTimeout(forceShowTimer);
  });

  win.on('hide', () => {
    writeMainLog('[Electron] Window hide event.');
  });

  win.on('close', () => {
    writeMainLog('[Electron] Window close event.');
  });

  win.on('closed', () => {
    writeMainLog('[Electron] Window closed event.');
    clearTimeout(forceShowTimer);
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

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

  if (await isServerReachable(localServerPort)) {
    log(`[Electron] Reusing existing local backend on port ${localServerPort}.`);
  } else if (fs.existsSync(serverPath)) {
    // Use Electron's embedded Node runtime so Steam users do not need Node installed.
    const useEmbeddedNode = process.execPath.toLowerCase().includes('electron') || isPackaged;
    const serverCommand = useEmbeddedNode ? process.execPath : 'node';
    const serverEnv = { ...process.env, PORT: localServerPort, NODE_ENV: 'production' };
    const preferredDistPath = isPackaged ? getPreferredProductionDistPath() : path.join(__dirname, '../dist');
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

    if (preferredDistPath && fs.existsSync(path.join(preferredDistPath, 'index.html'))) {
      serverEnv.CLIENT_DIST_DIR = preferredDistPath;
      log(`[Electron] CLIENT_DIST_DIR: ${serverEnv.CLIENT_DIST_DIR}`);
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
      if (code === 1) {
        setTimeout(() => {
          isServerReachable(process.env.PORT || '3001').then((reachable) => {
            if (reachable) {
              log(`[Electron] Detected healthy server on port ${process.env.PORT || '3001'} after child exit; continuing with existing backend.`);
            }
          }).catch((err) => {
            log(`[Electron] Server reachability check failed after child exit: ${err.message}`);
          });
        }, 300);
      }
    });

    serverProcess.on('error', (err) => {
      log(`[Server] Failed to start process: ${err.message}`);
    });
  } else {
    log(`[Electron] ERROR: Local server not found at: ${serverPath}`);
    console.warn('[Electron] Local server not found at:', serverPath);
  }

  if (await waitForServerReady(localServerPort, isPackaged ? 25000 : 10000)) {
    log(`[Electron] Local backend reachable on port ${localServerPort}.`);
  } else {
    log(`[Electron] Local backend did not become reachable on port ${localServerPort} before renderer startup.`);
  }

  if (isDev) {
    win.loadURL('http://localhost:5173').catch(err => {
      writeMainLog(`[Electron] Failed to load Dev URL: ${err?.message || err}`);
      console.error('[Electron] Failed to load Dev URL:', err);
    });
  } else {
    // Prefer the packaged local HTTP origin because it avoids fragile file:// loading
    // from asar bundles on Windows compatibility layers.
    loadProductionRenderer(win, `http://127.0.0.1:${localServerPort}`);
  }

  // Log load failures to help diagnose black screens
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      writeMainLog(`[Electron] Ignoring did-fail-load after window teardown for ${validatedURL}`);
      return;
    }
    writeMainLog(`[Electron] did-fail-load ${validatedURL} code=${errorCode} description=${errorDescription}`);
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

    if (!steamJoinRequestedHandle && steamClient.callback?.register && steamworksApi?.SteamCallback) {
      steamJoinRequestedHandle = steamClient.callback.register(
        steamworksApi.SteamCallback.GameLobbyJoinRequested,
        ({ lobby_steam_id }) => {
          const lobbyId = lobby_steam_id?.toString?.() || '';
          console.log('[Steam] GameLobbyJoinRequested callback:', lobbyId);
          emitSteamJoinLobby(lobbyId);
        }
      );
    }

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
        const lobby = await steamClient.matchmaking.createLobby(2, 10);
        if (lobby) {
          const localSteamId = steamClient.localplayer.getSteamId().steamId64.toString();
          const endpointFromRequest = normalizeEndpointForLobby(data?.endpoint, process.env.PORT || '3001');
          const fallbackEndpoint = normalizeEndpointForLobby(
            `http://${getBestLanAddress()}:${process.env.PORT || '3001'}`,
            process.env.PORT || '3001'
          );
          const endpoint = endpointFromRequest || fallbackEndpoint;

          lobby.setData('ag_room', data.roomId);
          lobby.setData('map', data.map || 'Unknown');
          lobby.setData('mode', data.mode || 'Standard');
          lobby.setData('ag_host_steam_id', localSteamId);
          if (endpoint) {
            lobby.setData('ag_endpoint', endpoint);
          }

          console.log('[Steam] Created Lobby:', lobby.id, 'for Room:', data.roomId);
          console.log('[Steam] Lobby Endpoint:', endpoint || 'none');
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
        const roomId = lobby.getData('ag_room');
        const endpoint = lobby.getData('ag_endpoint');
        const hostSteamId = lobby.getData('ag_host_steam_id');
        const map = lobby.getData('map');
        const mode = lobby.getData('mode');

        console.log('[Steam] Got Lobby Data:', { roomId, endpoint, hostSteamId, map, mode });
        return {
          success: true,
          roomId,
          endpoint,
          hostSteamId,
          map,
          mode,
        };
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

    ipcMain.handle('steam:get-stats', async (_, statNames) => {
      try {
        if (!steamClient?.stats) {
          return { success: false, stats: {}, error: 'Steam stats interface unavailable.' };
        }

        const stats = {};
        const requested = Array.isArray(statNames) ? statNames : [];
        for (const name of requested) {
          if (typeof name !== 'string' || !name.trim()) continue;
          stats[name] = steamClient.stats.getInt(name);
        }

        return { success: true, stats };
      } catch (err) {
        console.error('[Steam] Failed to read stats:', err);
        return { success: false, stats: {}, error: err.message };
      }
    });

    ipcMain.handle('steam:set-stats', async (_, statMap) => {
      try {
        if (!steamClient?.stats) {
          return { success: false, stored: false, rejected: [], error: 'Steam stats interface unavailable.' };
        }

        const rejected = [];
        const entries = Object.entries(statMap || {});
        for (const [name, value] of entries) {
          if (typeof name !== 'string' || !name.trim()) continue;
          const normalized = Number(value);
          if (!Number.isFinite(normalized)) {
            rejected.push(name);
            continue;
          }

          const ok = steamClient.stats.setInt(name, Math.trunc(normalized));
          if (!ok) {
            rejected.push(name);
          }
        }

        const stored = steamClient.stats.store();
        return {
          success: rejected.length === 0 && stored,
          stored,
          rejected,
          error: rejected.length > 0 ? `Steam rejected stat keys: ${rejected.join(', ')}` : (!stored ? 'Steam did not confirm StoreStats.' : undefined)
        };
      } catch (err) {
        console.error('[Steam] Failed to store stats:', err);
        return { success: false, stored: false, rejected: Object.keys(statMap || {}), error: err.message };
      }
    });
  } else {
    console.log('[Steam] Initialization failed or not running.');
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('steam:init-error', 'Steam is not running or AppID is missing.');
    });
  }

  return win;
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
  if (process.platform === 'darwin' && app.dock && fs.existsSync(appIconPath)) {
    app.dock.setIcon(appIconPath);
  }

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
    emitSteamJoinLobby(lobbyId);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServerProcess();
  if (process.platform !== 'darwin' || isSmokeTest) {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (steamJoinRequestedHandle?.disconnect) {
    steamJoinRequestedHandle.disconnect();
    steamJoinRequestedHandle = null;
  }
});
