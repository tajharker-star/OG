const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

// Fix for SharedImageManager::ProduceSkia errors:
// We enable HW Acceleration for better performance.
// If black screen occurs, check for GPU driver compatibility.
// app.disableHardwareAcceleration(); 

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Keep a global reference of the window object
let mainWindow;
let serverProcess;
const SERVER_PORT = 3001;
const DEV_CLIENT_PORT = 5173;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Conquerors: Dominion",
    backgroundColor: '#0f0f13', // Match loading screen bg
    webPreferences: {
      nodeIntegration: false, // Security best practice
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  mainWindow.maximize();
  mainWindow.show();

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
        // Instead of full reload, just go back to home URL to avoid process kill
        mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
      }
    }
  });

  // Crash Guards
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Electron] Render process gone:', details);
    if (details.reason !== 'clean-exit') {
      console.log('[Electron] Reloading renderer due to crash...');
      // Give it a moment to stabilize then reload
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
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

  // 2. Check for Local Server (already running)
  const isServerUp = await checkPort(SERVER_PORT);
  if (isServerUp) {
    sendStatus('Active Server detected on port ' + SERVER_PORT, 30);
    setTimeout(() => {
      sendStatus('Connecting to Local Server...', 60);
      setTimeout(() => {
        loadGame(`http://localhost:${SERVER_PORT}`);
      }, 500);
    }, 500);
    return;
  }

  // 3. Spawn Server
  spawnAndConnectServer();
}

const { exec } = require('child_process');

function spawnAndConnectServer() {
  sendStatus('Initializing launch parameters...', 10);

  const isPackaged = app.isPackaged;
  // In production, the server is usually in resources/app/server/dist/index.js
  // or resources/server/dist/index.js depending on build config
  let serverPath;
  let cwd;

  if (isPackaged) {
    // Try multiple potential paths for packaged production
    const p1 = path.join(process.resourcesPath, 'app', 'server', 'dist', 'index.js');
    const p2 = path.join(process.resourcesPath, 'server', 'dist', 'index.js');
    const p3 = path.join(__dirname, '..', 'server', 'dist', 'index.js');

    const fs = require('fs');
    if (fs.existsSync(p1)) serverPath = p1;
    else if (fs.existsSync(p2)) serverPath = p2;
    else serverPath = p3;

    cwd = path.dirname(path.dirname(serverPath));
  } else {
    serverPath = path.join(__dirname, '..', 'server', 'dist', 'index.js');
    cwd = path.join(__dirname, '..', 'server');
  }

  console.log('Launching server from:', serverPath);
  console.log('CWD:', cwd);
  sendStatus('Igniting server engines...', 25);

  // Before starting, attempt to kill any existing server on this port (Windows safety)
  if (process.platform === 'win32') {
    exec(`taskkill /F /IM node.exe /T`, (err) => {
      // Ignore error (might not be running)
      startServer(serverPath, cwd);
    });
  } else {
    startServer(serverPath, cwd);
  }
}

function startServer(serverPath, cwd) {
  // Fork the server process
  try {
    serverProcess = fork(serverPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: cwd,
      env: { ...process.env, PORT: SERVER_PORT.toString(), HEADLESS: 'true' }
    });

    sendStatus('Server ignition confirmed. Stabilizing...', 40);
  } catch (err) {
    console.error("Failed to fork server:", err);
    sendError("Failed to launch server process: " + err.message + "\n(Ensure 'npm run build' was run in server/)");
    return;
  }

  // Log server output
  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server]: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error]: ${data}`);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server process:', err);
    sendError("Server process failed: " + err.message);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && code !== null) {
      sendError(`Server crashed with exit code ${code}`);
    }
  });

  // Start polling
  pollServer();
}

function pollServer(retries = 0) {
  const maxRetries = 60;

  // Calculate fake progress based on retries (from 40% to 90%)
  const progress = 40 + Math.min(50, (retries / 5) * 10);

  if (retries === 0) sendStatus('Establishing connection uplink...', 45);
  else if (retries === 5) sendStatus('Waiting for server heartbeat...', 55);
  else if (retries === 10) sendStatus('Calibrating game assets...', 65);
  else if (retries === 20) sendStatus('Finalizing protocols...', 80);

  if (retries % 5 !== 0 && retries > 0) {
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('progress-update', progress);
    }
  }

  http.get(`http://localhost:${SERVER_PORT}`, (res) => {
    if (res.statusCode === 200) {
      loadGame(`http://localhost:${SERVER_PORT}`);
    } else {
      retryPoll(retries);
    }
  }).on('error', (err) => {
    retryPoll(retries);
  });
}

function retryPoll(retries) {
  if (retries < 60) {
    setTimeout(() => pollServer(retries + 1), 200);
  } else {
    console.error('Server failed to start in time.');
    sendError("Connection timed out. Server did not respond.");
  }
}

function loadGame(url) {
  console.log('Loading game from:', url);
  sendStatus('Systems Nominal. Launching!', 100);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(url);
    }
  }, 800);
}

app.on('ready', () => {
  createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
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
