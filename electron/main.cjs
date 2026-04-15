const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

const SAFE_RENDERER_MODE = process.argv.includes('--safe-renderer') || process.env.CONQUERORS_SAFE_RENDERER === '1';

// Run with the real GPU path by default. The old forced SwiftShader path kept
// the game alive on unstable machines, but it also crushed FPS in both the
// lobby and live matches. Safe mode still exists as an escape hatch.
if (SAFE_RENDERER_MODE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

// Keep a global reference of the window object
let mainWindow;
let serverProcess;
let serverStartPromise = null;
let serverStopPromise = null;
let serverStopExpected = false;
let rendererCrashCount = 0;
const SERVER_PORT = 3001;
const DEV_CLIENT_PORT = 5173;

function registerDesktopIpcHandlers() {
  const saveFile = path.join(app.getPath('userData'), 'save.json');

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

  ipcMain.removeHandler('local-server-status');
  ipcMain.handle('local-server-status', async () => ({
    ready: await checkPort(SERVER_PORT),
    port: SERVER_PORT,
    managed: Boolean(serverProcess && !serverProcess.killed),
  }));

  ipcMain.removeHandler('local-server-start');
  ipcMain.handle('local-server-start', async () => ensureLocalServerRunning());

  ipcMain.removeHandler('local-server-stop');
  ipcMain.handle('local-server-stop', async () => stopLocalServer());

  ipcMain.removeHandler('local-server-restart');
  ipcMain.handle('local-server-restart', async () => {
    await stopLocalServer();
    return ensureLocalServerRunning();
  });

  // Keep the UI stable even when the Steam/public tunnel stack is unavailable in
  // this lightweight desktop wrapper.
  ipcMain.removeHandler('network:ensure-public-tunnel');
  ipcMain.handle('network:ensure-public-tunnel', async (_, data) => ({
    success: false,
    error: `Public tunnel support is unavailable in this desktop build for port ${data?.port || SERVER_PORT}.`,
  }));

  ipcMain.removeHandler('network:close-public-tunnel');
  ipcMain.handle('network:close-public-tunnel', async () => ({ success: true }));
}

function resolveAppIconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'client', 'dist', 'app-icon.png'),
        path.join(process.resourcesPath, 'app', 'client', 'dist', 'app-icon.png'),
      ]
    : [
        path.join(__dirname, '..', 'client', 'public', 'app-icon.png'),
        path.join(__dirname, '..', 'client', 'dist', 'app-icon.png'),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createWindow() {
  registerDesktopIpcHandlers();

  const iconPath = resolveAppIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Conquerors: Domination",
    backgroundColor: '#0f0f13', // Match loading screen bg
    webPreferences: {
      // The renderer still relies on window.require for Steam, save data, and
      // local desktop launch hooks. Keep Node integration on until those APIs
      // are fully migrated behind preload helpers.
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
      webgl: true
    },
    icon,
    show: false
  });

  if (process.platform === 'darwin' && icon && !icon.isEmpty() && app.dock?.setIcon) {
    app.dock.setIcon(icon);
  }

  mainWindow.maximize();
  mainWindow.show();

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] Failed to load renderer URL:', { errorCode, errorDescription, validatedURL });
  });

  // Load the loading screen first
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  // Wait for loading screen to be ready before starting logic
  mainWindow.webContents.once('did-finish-load', () => {
    // Small delay to ensure IPC is bound and UI is rendered
    setTimeout(initAppSequence, 500);
  });

  // Register Reload Shortcut (CommandOrControl+R)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key.toLowerCase() === 'r') {
        event.preventDefault();
        mainWindow.loadFile(path.join(__dirname, 'loading.html'));
        setTimeout(initAppSequence, 500);
      }
    }
  });

  // Crash Guards
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Electron] Render process gone:', details);
    if (details.reason !== 'clean-exit') {
      rendererCrashCount += 1;
      if (!SAFE_RENDERER_MODE && rendererCrashCount >= 2) {
        console.error('[Electron] Renderer crashed repeatedly. Relaunching in safe renderer mode.');
        app.relaunch({ args: process.argv.slice(1).concat('--safe-renderer') });
        app.exit(0);
        return;
      }

      if (rendererCrashCount >= 3) {
        console.error('[Electron] Renderer crashed repeatedly, loading error screen instead of looping forever.');
        sendError('Renderer crashed while loading the game window. The safe renderer fallback is active, but the UI still failed to start.');
        return;
      }

      console.log('[Electron] Reloading renderer due to crash...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile(path.join(__dirname, 'loading.html'));
          setTimeout(initAppSequence, 500);
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.log('[Electron] Window unresponsive...');
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function sendStatus(text, progress) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send('status-update', text);
      if (progress !== undefined) {
        mainWindow.webContents.send('progress-update', progress);
      }
    } catch (e) {
      console.error('Failed to send status:', e);
    }
  }
}

function sendError(text) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send('error-update', text);
    } catch (e) {
      console.error('Failed to send error:', e);
    }
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(true);
      req.abort();
    }).on('error', () => {
      resolve(false);
    });
  });
}

function resolveRendererEntry() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'client', 'dist', 'index.html'),
        path.join(process.resourcesPath, 'app', 'client', 'dist', 'index.html'),
        path.join(__dirname, '..', 'client', 'dist', 'index.html'),
      ]
    : [
        path.join(__dirname, '..', 'client', 'dist', 'index.html'),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function initAppSequence() {
  sendStatus('Scanning environment...', 10);

  // 1. Check for Dev Client (Vite)
  const isDevClientUp = await checkPort(DEV_CLIENT_PORT);
  if (isDevClientUp) {
    sendStatus('Dev Client detected on port ' + DEV_CLIENT_PORT, 30);
    setTimeout(() => {
      sendStatus('Connecting to Development Environment...', 60);
      setTimeout(() => {
        loadGame(`http://localhost:${DEV_CLIENT_PORT}`);
      }, 500);
    }, 500);
    return;
  }

  const rendererEntry = resolveRendererEntry();
  if (rendererEntry) {
    sendStatus('Loading command deck...', 35);
    setTimeout(() => {
      sendStatus('Preparing lobby systems...', 70);
      setTimeout(() => {
        loadGame(rendererEntry);
      }, 350);
    }, 350);
    return;
  }

  sendError("Renderer build could not be found. Run 'npm --prefix client run build' and try again.");
}

const { exec } = require('child_process');

function resolveServerLaunchConfig() {
  const isPackaged = app.isPackaged;
  let serverPath;
  let cwd;

  if (isPackaged) {
    const p1 = path.join(process.resourcesPath, 'app', 'server', 'dist', 'index.js');
    const p2 = path.join(process.resourcesPath, 'server', 'dist', 'index.js');
    const p3 = path.join(__dirname, '..', 'server', 'dist', 'index.js');
    if (fs.existsSync(p1)) serverPath = p1;
    else if (fs.existsSync(p2)) serverPath = p2;
    else serverPath = p3;

    cwd = path.dirname(path.dirname(serverPath));
  } else {
    serverPath = path.join(__dirname, '..', 'server', 'dist', 'index.js');
    cwd = path.join(__dirname, '..', 'server');
  }

  return { serverPath, cwd };
}

function attachServerProcessListeners() {
  if (!serverProcess) {
    return;
  }

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server]: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error]: ${data}`);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server process:', err);
    if (!serverStopExpected) {
      sendError("Server process failed: " + err.message);
    }
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
    const expectedStop = serverStopExpected;
    serverProcess = null;
    serverStopExpected = false;

    if (!expectedStop && code !== 0 && code !== null) {
      sendError(`Server crashed with exit code ${code}`);
    }
  });
}

function spawnServerProcess() {
  if (serverProcess && !serverProcess.killed) {
    return { success: true };
  }

  const { serverPath, cwd } = resolveServerLaunchConfig();
  console.log('Launching server from:', serverPath);
  console.log('CWD:', cwd);

  const clientDistDir = app.isPackaged
    ? path.join(process.resourcesPath, 'client', 'dist')
    : path.join(__dirname, '..', 'client', 'dist');

  try {
    serverProcess = fork(serverPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: cwd,
      env: {
        ...process.env,
        PORT: SERVER_PORT.toString(),
        HEADLESS: 'true',
        CLIENT_DIST_DIR: clientDistDir,
      }
    });
  } catch (err) {
    console.error("Failed to fork server:", err);
    return {
      success: false,
      error: "Failed to launch server process: " + err.message + "\n(Ensure 'npm run build' was run in server/)",
    };
  }

  attachServerProcessListeners();
  return { success: true };
}

async function waitForServerReady(maxRetries = 60, intervalMs = 200) {
  for (let retries = 0; retries < maxRetries; retries += 1) {
    if (await checkPort(SERVER_PORT)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

async function ensureLocalServerRunning() {
  if (await checkPort(SERVER_PORT)) {
    return {
      success: true,
      ready: true,
      port: SERVER_PORT,
      managed: Boolean(serverProcess && !serverProcess.killed),
    };
  }

  if (serverStartPromise) {
    return serverStartPromise;
  }

  serverStartPromise = (async () => {
    sendStatus('Starting local match engine...', 35);

    const spawnResult = spawnServerProcess();
    if (!spawnResult.success) {
      sendError(spawnResult.error);
      return {
        success: false,
        ready: false,
        port: SERVER_PORT,
        error: spawnResult.error,
      };
    }

    sendStatus('Waiting for local match engine heartbeat...', 55);
    const ready = await waitForServerReady(80, 200);
    if (!ready) {
      const error = 'Local match engine failed to start in time.';
      console.error(error);
      sendError(error);
      return {
        success: false,
        ready: false,
        port: SERVER_PORT,
        error,
      };
    }

    return {
      success: true,
      ready: true,
      port: SERVER_PORT,
      managed: true,
    };
  })();

  try {
    return await serverStartPromise;
  } finally {
    serverStartPromise = null;
  }
}

async function stopLocalServer() {
  if (serverStartPromise) {
    try {
      await serverStartPromise;
    } catch (error) {
      console.warn('Ignoring local server start wait failure during stop.', error);
    }
  }

  if (serverStopPromise) {
    return serverStopPromise;
  }

  if (!serverProcess || serverProcess.killed) {
    return {
      success: true,
      stopped: false,
      port: SERVER_PORT,
      reason: 'No managed local server process was running.',
    };
  }

  serverStopExpected = true;
  const processToStop = serverProcess;

  serverStopPromise = new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && processToStop && !processToStop.killed) {
          processToStop.kill('SIGKILL');
        }
      } catch (error) {
        console.error('Failed to force stop local server process.', error);
      }

      finish({
        success: false,
        stopped: false,
        port: SERVER_PORT,
        error: 'Timed out while stopping the local match engine.',
      });
    }, 4000);

    processToStop.once('exit', () => {
      clearTimeout(timeoutId);
      finish({
        success: true,
        stopped: true,
        port: SERVER_PORT,
      });
    });

    try {
      if (process.platform === 'win32') {
        exec(`taskkill /F /PID ${processToStop.pid} /T`, (err) => {
          if (err) {
            clearTimeout(timeoutId);
            finish({
              success: false,
              stopped: false,
              port: SERVER_PORT,
              error: err.message,
            });
          }
        });
      } else {
        processToStop.kill('SIGTERM');
      }
    } catch (error) {
      clearTimeout(timeoutId);
      finish({
        success: false,
        stopped: false,
        port: SERVER_PORT,
        error: error.message,
      });
    }
  });

  try {
    return await serverStopPromise;
  } finally {
    serverStopPromise = null;
  }
}

function loadGame(target) {
  console.log('Loading game from:', target);
  sendStatus('Systems Nominal. Launching!', 100);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (/^https?:\/\//i.test(target)) {
        mainWindow.loadURL(target);
      } else {
        mainWindow.loadFile(target);
      }
    }
  }, 800);
}

app.on('ready', () => {
  registerDesktopIpcHandlers();
  createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverStopExpected = true;
    if (process.platform === 'win32') {
      // Force kill entire tree on Windows to avoid locks
      exec(`taskkill /F /PID ${serverProcess.pid} /T`, (err) => {
        if (err) console.error('Failed to kill server process tree on Windows:', err);
      });
    } else {
      serverProcess.kill();
    }
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
