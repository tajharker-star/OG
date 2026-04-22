const electron = require('electron');
const { app, BrowserWindow, ipcMain, globalShortcut } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { createSteamRelayBridge } = require('./steamRelayBridge.cjs');
const { createSteamNativeBridge } = require('./steamNativeBridge.cjs');

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
let steamBridge;
let steamInitPromise;
let steamInitError = null;
let steamBridgeEventsAttached = false;
let activeSteamLobby;
let activeSteamLobbyId;
let steamRelayBridge;
let localtunnelFactory;
let publicTunnel;
let publicTunnelUrl;
let publicTunnelPort;
let serverProcess;
let mainWindow;
const isSmokeTest = process.env.SMOKE_TEST === '1';
const forceSteamBypassForSmoke = process.env.SMOKE_TEST_FORCE_STEAM_BYPASS === '1';
const runtimeDebugLogsEnabled =
  process.env.ENABLE_RUNTIME_DEBUG_LOGS === '1' ||
  process.env.NODE_ENV !== 'production' ||
  isSmokeTest;
const appIconPath = path.join(__dirname, 'icons', 'app-icon.png');
const appCopyright = 'Copyright © 2026 Thecoadstar';
const defaultSteamAppId = 4432220;
const steamLobbyVisibilityMap = {
  private: 0,
  friends: 1,
  public: 2,
  invisible: 3,
};

function registerSteamInventoryUnavailableHandlers(reason = 'Steam Inventory item bridge is not implemented in this build. Create matching Steamworks Inventory Service item definitions before enabling live grants.') {
  ipcMain.removeHandler('steam:get-inventory-items');
  ipcMain.handle('steam:get-inventory-items', async () => ({
    success: false,
    items: [],
    unavailable: true,
    error: reason,
  }));

  ipcMain.removeHandler('steam:request-inventory-items');
  ipcMain.handle('steam:request-inventory-items', async (_, itemDefIds) => ({
    success: false,
    granted: [],
    requested: Array.isArray(itemDefIds) ? itemDefIds : [],
    unavailable: true,
    error: reason,
  }));
}

if (!runtimeDebugLogsEnabled) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

function parsePositiveIntEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSteamAppId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readSteamAppIdFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    return parseSteamAppId(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveSteamAppId() {
  const envCandidates = [
    process.env.STEAM_APP_ID,
    process.env.STEAM_APPID,
    process.env.SteamAppId,
    process.env.SteamGameId,
  ];

  for (const candidate of envCandidates) {
    const parsed = parseSteamAppId(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const execDir = path.dirname(process.execPath);
  const candidatePaths = [
    path.join(process.cwd(), 'steam_appid.txt'),
    path.join(__dirname, '..', 'steam_appid.txt'),
    process.resourcesPath ? path.join(process.resourcesPath, 'steam_appid.txt') : null,
    path.join(execDir, 'steam_appid.txt'),
    path.join(execDir, '..', 'steam_appid.txt'),
    path.join(execDir, '..', '..', 'steam_appid.txt'),
    path.join(execDir, '..', '..', '..', 'steam_appid.txt'),
  ];

  for (const candidatePath of candidatePaths) {
    const parsed = readSteamAppIdFile(candidatePath);
    if (parsed) {
      return parsed;
    }
  }

  return defaultSteamAppId;
}

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

  ipcMain.removeHandler('network:ensure-public-tunnel');
  ipcMain.handle('network:ensure-public-tunnel', async (_, data) => {
    return await ensurePublicTunnel(data?.port || process.env.PORT || '3001');
  });

  ipcMain.removeHandler('network:close-public-tunnel');
  ipcMain.handle('network:close-public-tunnel', async () => {
    closePublicTunnel('renderer requested tunnel close');
    return { success: true };
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

function parseSteamLobbyId(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  if (typeof rawValue === 'bigint') {
    return rawValue > 0n ? rawValue : null;
  }

  const normalized = String(rawValue).trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = BigInt(normalized);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function isLoopbackLobbyHost(hostname) {
  if (!hostname) {
    return false;
  }

  const normalized = String(hostname).trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized === '::';
}

function resolveAdvertisedLobbyEndpoint(rawValue, defaultPort = '3001') {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return null;
  }

  const normalized = normalizeEndpointForLobby(rawValue, defaultPort);
  const fallback = normalizeEndpointForLobby(
    `http://${getBestLanAddress()}:${defaultPort}`,
    defaultPort
  );

  if (!normalized) {
    return fallback;
  }

  try {
    const parsed = new URL(normalized);
    if (isLoopbackLobbyHost(parsed.hostname)) {
      return fallback || normalized;
    }
  } catch {
    return fallback || normalized;
  }

  return normalized;
}

function parseOptionalInteger(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeLobbyMetadataEntries(rawValue) {
  const normalized = {};

  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return normalized;
  }

  for (const [key, value] of Object.entries(rawValue)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (value === undefined || value === null) continue;

    if (typeof value === 'boolean') {
      normalized[key] = value ? '1' : '0';
      continue;
    }

    normalized[key] = String(value);
  }

  return normalized;
}

function rememberActiveSteamLobby(lobby) {
  const normalizedLobbyId = lobby && typeof lobby === 'object'
    ? lobby.id?.toString?.() || lobby.lobbyId?.toString?.() || null
    : lobby
      ? String(lobby)
      : null;
  activeSteamLobby = normalizedLobbyId ? { id: normalizedLobbyId } : null;
  activeSteamLobbyId = normalizedLobbyId;
  return activeSteamLobbyId;
}

function leaveActiveSteamLobby(reason = 'unspecified') {
  if (!activeSteamLobbyId) {
    return false;
  }

  try {
    if (steamBridge?.isReady()) {
      void steamBridge.leaveLobby(activeSteamLobbyId).catch((err) => {
        console.warn('[Steam] Failed to leave active lobby cleanly:', err);
      });
    }
    console.log(`[Steam] Left active lobby (${activeSteamLobbyId || 'unknown'}) reason=${reason}`);
  } catch (err) {
    console.warn('[Steam] Failed to leave active lobby cleanly:', err);
  } finally {
    activeSteamLobby = null;
    activeSteamLobbyId = null;
  }

  return true;
}

function loadLocaltunnelFactory() {
  if (!localtunnelFactory) {
    localtunnelFactory = require('localtunnel');
  }

  return localtunnelFactory;
}

function closePublicTunnel(reason = 'unspecified') {
  if (!publicTunnel) {
    return false;
  }

  const tunnel = publicTunnel;
  publicTunnel = null;
  publicTunnelUrl = null;
  publicTunnelPort = null;

  try {
    if (typeof tunnel.close === 'function') {
      tunnel.close();
    }
    console.log(`[Network] Closed public tunnel reason=${reason}`);
  } catch (err) {
    console.warn('[Network] Failed to close public tunnel cleanly:', err);
  }

  return true;
}

function probeSocketIoEndpoint(rawEndpoint, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const normalized = normalizeEndpointForLobby(rawEndpoint);
    if (!normalized) {
      resolve(false);
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(normalized);
    } catch {
      resolve(false);
      return;
    }

    const transportPath = `/socket.io/?EIO=4&transport=polling&t=${Date.now().toString(36)}`;
    const client = targetUrl.protocol === 'https:' ? https : http;
    const request = client.get({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: transportPath,
      headers: {
        'bypass-tunnel-reminder': 'true',
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        resolve(response.statusCode === 200 && body.startsWith('0'));
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', () => resolve(false));
  });
}

async function waitForPublicTunnelReady(endpoint, attempts = 8, delayMs = 750) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probeSocketIoEndpoint(endpoint)) {
      return true;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

async function ensurePublicTunnel(port = '3001') {
  const requestedPort = String(port || '3001').trim() || '3001';
  const parsedPort = Number.parseInt(requestedPort, 10);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    return { success: false, error: `Invalid local port: ${requestedPort}` };
  }

  if (publicTunnel && publicTunnelUrl && publicTunnelPort === requestedPort) {
    const stillReachable = await waitForPublicTunnelReady(publicTunnelUrl, 2, 300);
    if (stillReachable) {
      return { success: true, endpoint: publicTunnelUrl, reused: true };
    }

    closePublicTunnel('existing public tunnel stopped responding');
  }

  closePublicTunnel('rotating public tunnel');

  try {
    const createTunnel = loadLocaltunnelFactory();
    const tunnel = await createTunnel({
      port: parsedPort,
      local_host: '127.0.0.1',
    });
    const endpoint = normalizeEndpointForLobby(tunnel?.url, requestedPort);

    if (!endpoint) {
      if (typeof tunnel?.close === 'function') {
        tunnel.close();
      }
      return { success: false, error: 'Tunnel provider did not return a usable public endpoint.' };
    }

    publicTunnel = tunnel;
    publicTunnelUrl = endpoint;
    publicTunnelPort = requestedPort;

    if (typeof tunnel?.on === 'function') {
      tunnel.on('close', () => {
        if (publicTunnel === tunnel) {
          console.log('[Network] Public tunnel closed by provider.');
          publicTunnel = null;
          publicTunnelUrl = null;
          publicTunnelPort = null;
        }
      });

      tunnel.on('error', (err) => {
        console.error('[Network] Public tunnel error:', err);
        if (publicTunnel === tunnel) {
          publicTunnel = null;
          publicTunnelUrl = null;
          publicTunnelPort = null;
        }
      });
    }

    const tunnelReady = await waitForPublicTunnelReady(endpoint);
    if (!tunnelReady) {
      closePublicTunnel('public tunnel failed readiness probe');
      return { success: false, error: 'Public tunnel was created but never became reachable.' };
    }

    console.log('[Network] Public tunnel ready:', endpoint);
    return { success: true, endpoint, reused: false };
  } catch (err) {
    console.error('[Network] Failed to create public tunnel:', err);
    closePublicTunnel('public tunnel creation failed');
    return { success: false, error: err?.message || 'Unable to create public tunnel.' };
  }
}

async function openSteamInviteSurface(targetLobby, reason = 'unspecified') {
  const result = {
    success: false,
    method: null,
    note: null,
  };

  const activeWin = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((candidate) => candidate && !candidate.isDestroyed()) || null;
  if (activeWin) {
    presentWindow(activeWin, `steam invite surface (${reason})`);
  }

  try {
    const lobbyId = targetLobby && typeof targetLobby === 'object'
      ? targetLobby.id?.toString?.() || targetLobby.lobbyId?.toString?.() || null
      : targetLobby
        ? String(targetLobby)
        : null;

    if (!steamBridge?.isReady()) {
      return {
        success: false,
        method: null,
        note: 'Native Steam bridge is unavailable.',
      };
    }

    const inviteResult = await steamBridge.openInviteDialog(lobbyId);
    result.success = Boolean(inviteResult?.success !== false);
    result.method = inviteResult?.method || 'native-overlay-invite-dialog';
    result.note = inviteResult?.note || 'Requested the native Steam invite dialog.';
    return result;
  } catch (inviteError) {
    console.warn('[Steam] Native invite dialog attempt failed:', inviteError);
    return {
      success: false,
      method: null,
      note: inviteError?.message || 'Unable to open the native Steam invite dialog.',
    };
  }
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
    const steamAppId = resolveSteamAppId();
    steamBridge = createSteamNativeBridge({
      appId: steamAppId,
      log: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
    });
    steamInitPromise = steamBridge.start()
      .then(({ user }) => {
        steamInitError = null;
        console.log(`[Steam] Native bridge initialized app ${steamAppId} for ${user?.name || 'unknown user'}.`);
        return user;
      })
      .catch((error) => {
        steamInitError = error?.message || String(error);
        console.error('[Steam] Native bridge failed to initialize:', error);
        return null;
      });
  } catch (e) {
    steamInitError = e?.message || String(e);
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
  const contentWidth = parsePositiveIntEnv('ELECTRON_WINDOW_CONTENT_WIDTH');
  const contentHeight = parsePositiveIntEnv('ELECTRON_WINDOW_CONTENT_HEIGHT');

  ipcMain.removeHandler('local-server-status');
  ipcMain.handle('local-server-status', async () => {
    return {
      ready: await isServerReachable(localServerPort),
      port: localServerPort,
    };
  });
  ipcMain.removeHandler('local-server-start');
  ipcMain.handle('local-server-start', async () => {
    const ready = await waitForServerReady(localServerPort, app.isPackaged ? 25000 : 12000);
    return {
      success: ready,
      ready,
      managed: Boolean(serverProcess),
      port: Number(localServerPort),
      error: ready ? undefined : `Local backend did not become reachable on port ${localServerPort}.`,
    };
  });
  ipcMain.removeHandler('local-server-stop');
  ipcMain.handle('local-server-stop', async () => {
    const ready = await isServerReachable(localServerPort);
    return {
      success: true,
      stopped: false,
      ready,
      managed: Boolean(serverProcess),
      port: Number(localServerPort),
      reason: 'Electron keeps the shared local backend warm and pauses match simulation from the renderer.',
    };
  });

  const win = new BrowserWindow({
    width: contentWidth || 1280,
    height: contentHeight || 720,
    useContentSize: !!(contentWidth && contentHeight),
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

  if (steamInitPromise) {
    await steamInitPromise;
  }

  // --- Steam Integration ---
  if (steamBridge?.isReady()) {
    const currentUser = steamBridge.getCurrentUser();
    console.log('[Steam] Native bridge initialized successfully. Player:', currentUser?.name || 'Unknown');

    if (!steamRelayBridge) {
      steamRelayBridge = createSteamRelayBridge({
        relayTransport: steamBridge,
        getHostServerUrl: () => `http://127.0.0.1:${process.env.PORT || '3001'}`,
        log: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
      });
    }
    void steamRelayBridge.activate();

    if (!steamBridgeEventsAttached) {
      steamBridge.on('join-lobby-requested', ({ lobbyId, source }) => {
        console.log('[Steam] Join requested callback:', lobbyId, `source=${source || 'unknown'}`);
        emitSteamJoinLobby(lobbyId);
      });
      steamBridge.on('error', ({ message }) => {
        console.error('[Steam] Native bridge event error:', message);
      });
      steamBridgeEventsAttached = true;
    }

    win.webContents.on('did-finish-load', () => {
      win.webContents.send('steam:init-success', {
        steamId: currentUser?.steamId || '',
        name: currentUser?.name || 'Unknown',
      });
    });

    ipcMain.removeAllListeners('steam:activate-overlay');
    ipcMain.on('steam:activate-overlay', (_, dialog) => {
      void steamBridge.activateOverlay(dialog || 'Friends').catch((err) => {
        console.error('[Steam] Failed to activate overlay:', err);
      });
    });

    ipcMain.removeAllListeners('steam:set-rich-presence');
    ipcMain.on('steam:set-rich-presence', (_, data) => {
      void steamBridge.setRichPresence(data || {}).catch((err) => {
        console.error('[Steam] Failed to set rich presence:', err);
      });
    });

    ipcMain.removeHandler('steam:create-lobby');
    ipcMain.handle('steam:create-lobby', async (_, data) => {
      try {
        leaveActiveSteamLobby('hosting a new steam lobby');
        const requestedVisibility = typeof data?.lobbyVisibility === 'string'
          ? data.lobbyVisibility.toLowerCase()
          : 'friends';
        const maxMembers = Math.max(2, Math.min(10, parseOptionalInteger(data?.maxMembers) || 10));
        const endpoint = data?.endpoint
          ? resolveAdvertisedLobbyEndpoint(data?.endpoint, process.env.PORT || '3001')
          : null;

        const result = await steamBridge.createLobby({
          roomId: String(data?.roomId || ''),
          map: String(data?.map || 'Unknown'),
          mode: String(data?.mode || 'Standard'),
          endpoint,
          lobbyVisibility: requestedVisibility,
          maxMembers,
          metadata: normalizeLobbyMetadataEntries(data?.metadata),
        });

        if (result?.lobbyId) {
          rememberActiveSteamLobby(result.lobbyId);
        }

        return {
          success: Boolean(result?.success),
          lobbyId: result?.lobbyId,
          endpoint: result?.endpoint || endpoint,
          error: result?.error,
        };
      } catch (err) {
        console.error('[Steam] Create Lobby Error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.removeHandler('steam:list-lobbies');
    ipcMain.handle('steam:list-lobbies', async (_, filters) => {
      try {
        const result = await steamBridge.listLobbies(filters || {});
        return {
          success: Boolean(result?.success),
          lobbies: Array.isArray(result?.lobbies) ? result.lobbies : [],
          error: result?.error,
        };
      } catch (err) {
        console.error('[Steam] List Lobbies Error:', err);
        return { success: false, lobbies: [], error: err.message };
      }
    });

    ipcMain.removeHandler('steam:get-lobby-data');
    ipcMain.handle('steam:get-lobby-data', async (_, lobbyId) => {
      try {
        const parsedLobbyId = parseSteamLobbyId(lobbyId);
        if (!parsedLobbyId) {
          return { success: false, error: 'Invalid Steam lobby ID.' };
        }

        const normalizedLobbyId = parsedLobbyId.toString();
        if (activeSteamLobbyId && activeSteamLobbyId !== normalizedLobbyId) {
          leaveActiveSteamLobby('switching to another steam lobby');
        }

        const result = await steamBridge.getLobbyData(normalizedLobbyId);
        if (result?.success) {
          rememberActiveSteamLobby(normalizedLobbyId);
        }
        return result;
      } catch (err) {
        console.error('[Steam] Get Lobby Data Error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.removeHandler('steam:open-invite-dialog');
    ipcMain.handle('steam:open-invite-dialog', async (_, lobbyId) => {
      try {
        const parsedLobbyId = parseSteamLobbyId(lobbyId);
        const targetLobbyId = parsedLobbyId?.toString?.() || activeSteamLobbyId;

        if (!targetLobbyId) {
          return { success: false, error: 'No active Steam lobby is available to invite from.' };
        }

        rememberActiveSteamLobby(targetLobbyId);
        return await openSteamInviteSurface(targetLobbyId, 'renderer requested invite dialog');
      } catch (err) {
        console.error('[Steam] Open Invite Dialog Error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.removeHandler('steam:list-friends');
    ipcMain.handle('steam:list-friends', async () => {
      try {
        const result = await steamBridge.listFriends();
        return {
          success: Boolean(result?.success),
          friends: Array.isArray(result?.friends) ? result.friends : [],
          error: result?.error,
        };
      } catch (err) {
        console.error('[Steam] List Friends Error:', err);
        return { success: false, friends: [], error: err.message };
      }
    });

    ipcMain.removeHandler('steam:invite-friend');
    ipcMain.handle('steam:invite-friend', async (_, friendSteamId, lobbyId) => {
      try {
        const parsedLobbyId = parseSteamLobbyId(lobbyId);
        const targetLobbyId = parsedLobbyId?.toString?.() || activeSteamLobbyId;
        if (!targetLobbyId) {
          return { success: false, error: 'No active Steam lobby is available to invite from.' };
        }

        rememberActiveSteamLobby(targetLobbyId);
        const result = await steamBridge.inviteFriend(String(friendSteamId || ''), targetLobbyId);
        return {
          success: Boolean(result?.success),
          method: result?.method || null,
          note: result?.note || null,
          error: result?.error,
        };
      } catch (err) {
        console.error('[Steam] Invite Friend Error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.removeHandler('steam:leave-lobby');
    ipcMain.handle('steam:leave-lobby', async (_, lobbyId) => {
      const requestedLobbyId = parseSteamLobbyId(lobbyId);

      if (requestedLobbyId && activeSteamLobbyId && activeSteamLobbyId !== requestedLobbyId.toString()) {
        return { success: false, error: 'Requested Steam lobby is not the active lobby.' };
      }

      leaveActiveSteamLobby('renderer requested lobby leave');
      closePublicTunnel('renderer requested steam lobby leave');
      return { success: true };
    });

    ipcMain.removeHandler('steam:prepare-relay-connection');
    ipcMain.handle('steam:prepare-relay-connection', async (_, hostSteamId) => {
      if (!steamRelayBridge) {
        return { success: false, error: 'Steam relay bridge is unavailable.' };
      }

      return await steamRelayBridge.prepareGuestSession(hostSteamId);
    });

    ipcMain.removeHandler('steam:close-relay-connection');
    ipcMain.handle('steam:close-relay-connection', async (_, sessionId) => {
      if (!steamRelayBridge) {
        return { success: false, error: 'Steam relay bridge is unavailable.' };
      }

      steamRelayBridge.closeGuestSession(sessionId, 'renderer requested relay close');
      return { success: true };
    });

    ipcMain.removeHandler('steam:update-active-lobby-data');
    ipcMain.handle('steam:update-active-lobby-data', async (_, rawMetadata) => {
      try {
        if (!activeSteamLobbyId) {
          return { success: false, error: 'No active Steam lobby is available to update.' };
        }

        return await steamBridge.updateActiveLobbyData(rawMetadata || {});
      } catch (err) {
        console.error('[Steam] Update Lobby Data Error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.removeAllListeners('steam:activate-achievement');
    ipcMain.on('steam:activate-achievement', (_, achievementId) => {
      void steamBridge.activateAchievement(achievementId).catch((err) => {
        console.error('[Steam] Failed to activate achievement:', err);
      });
    });

    ipcMain.removeHandler('steam:get-stats');
    ipcMain.handle('steam:get-stats', async (_, statNames) => {
      try {
        return await steamBridge.getStats(Array.isArray(statNames) ? statNames : []);
      } catch (err) {
        console.error('[Steam] Failed to read stats:', err);
        return { success: false, stats: {}, error: err.message };
      }
    });

    ipcMain.removeHandler('steam:set-stats');
    ipcMain.handle('steam:set-stats', async (_, statMap) => {
      try {
        return await steamBridge.setStats(statMap || {});
      } catch (err) {
        console.error('[Steam] Failed to store stats:', err);
        return { success: false, stored: false, rejected: Object.keys(statMap || {}), error: err.message };
      }
    });

    ipcMain.removeHandler('steam:get-leaderboard-snapshot');
    ipcMain.handle('steam:get-leaderboard-snapshot', async (_, options) => {
      try {
        return await steamBridge.getLeaderboardSnapshot(options || {});
      } catch (err) {
        console.error('[Steam] Failed to read leaderboard snapshot:', err);
        return {
          success: false,
          name: String(options?.name || ''),
          totalEntries: 0,
          entries: [],
          playerEntry: null,
          error: err.message,
        };
      }
    });

    ipcMain.removeHandler('steam:set-leaderboard-score');
    ipcMain.handle('steam:set-leaderboard-score', async (_, options) => {
      try {
        return await steamBridge.setLeaderboardScore(options || {});
      } catch (err) {
        console.error('[Steam] Failed to update leaderboard score:', err);
        return {
          success: false,
          name: String(options?.name || ''),
          error: err.message,
        };
      }
    });

    registerSteamInventoryUnavailableHandlers();
  } else {
    console.log('[Steam] Initialization failed or not running.');
    registerSteamInventoryUnavailableHandlers('Steam is not initialized, so Steam Inventory skin items cannot be read or granted.');
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('steam:init-error', steamInitError || 'Steam is not running or AppID is missing.');
      if (isSmokeTest && forceSteamBypassForSmoke && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        setTimeout(() => {
          if (win.isDestroyed() || win.webContents.isDestroyed()) {
            return;
          }
          console.log('[SmokeTest] Auto-bypassing Steam gate for smoke capture.');
          win.webContents.send('steam:bypass-error');
        }, 150);
      }
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
  if (lobbyId && steamBridge?.isReady()) {
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
  closePublicTunnel('app quitting');
  leaveActiveSteamLobby('app quitting');
  steamRelayBridge?.shutdown('app quitting');
  steamBridge?.stop('app quitting');
});
