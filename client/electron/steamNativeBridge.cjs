const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

function getPlatformBinaryName() {
  if (process.platform === 'win32') {
    return 'steam-native-bridge-win32-x64.exe';
  }

  if (process.platform === 'linux') {
    return 'steam-native-bridge-linux-x64';
  }

  if (process.arch === 'arm64') {
    return 'steam-native-bridge-darwin-arm64';
  }

  return 'steam-native-bridge-darwin-x64';
}

function getPlatformRuntimeSubdir() {
  if (process.platform === 'win32') {
    return 'win64';
  }

  if (process.platform === 'linux') {
    return 'linux64';
  }

  return 'osx';
}

function getRuntimeLibraryNames() {
  if (process.platform === 'win32') {
    return ['steam_api64.dll'];
  }

  if (process.platform === 'linux') {
    return ['libsteam_api.so'];
  }

  return ['libsteam_api.dylib'];
}

function resolveCargoRegistryRuntimeDir() {
  try {
    const registryRoot = path.join(os.homedir(), '.cargo', 'registry', 'src');
    if (!fs.existsSync(registryRoot)) {
      return null;
    }

    const registryScopes = fs.readdirSync(registryRoot);
    for (const scope of registryScopes) {
      const scopePath = path.join(registryRoot, scope);
      if (!fs.statSync(scopePath).isDirectory()) {
        continue;
      }

      const packageDirs = fs.readdirSync(scopePath)
        .filter((entry) => entry.startsWith('steamworks-sys-'))
        .sort()
        .reverse();
      for (const packageDir of packageDirs) {
        const runtimeDir = path.join(
          scopePath,
          packageDir,
          'lib',
          'steam',
          'redistributable_bin',
          getPlatformRuntimeSubdir(),
        );
        if (fs.existsSync(runtimeDir)) {
          return runtimeDir;
        }
      }
    }
  } catch {
    // Ignore cargo registry lookup failures and continue with other candidates.
  }

  return null;
}

function buildRuntimeLibraryEnv(libDir) {
  const env = { ...process.env };

  if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = [libDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
  } else if (process.platform === 'win32') {
    env.PATH = [libDir, env.PATH].filter(Boolean).join(';');
  } else {
    env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }

  return env;
}

function directoryHasRuntimeLibrary(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return false;
  }

  return getRuntimeLibraryNames().some((fileName) => fs.existsSync(path.join(directoryPath, fileName)));
}

function resolveRuntimeLibraryDir(options = {}) {
  const candidateDirs = [
    options.runtimeLibraryDir,
    path.join(__dirname, 'native'),
    resolveCargoRegistryRuntimeDir(),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'electron', 'native') : null,
  ].filter(Boolean);

  return candidateDirs.find(directoryHasRuntimeLibrary) || null;
}

function resolveNativeBridgePath() {
  const binaryName = getPlatformBinaryName();
  const candidatePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', binaryName) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'electron', 'native', binaryName) : null,
    path.join(__dirname, 'native', binaryName),
    path.join(__dirname, '..', 'native', 'steam_bridge', 'target', 'debug', 'steam-native-bridge'),
    path.join(__dirname, '..', 'native', 'steam_bridge', 'target', 'debug', 'steam-native-bridge.exe'),
    path.join(__dirname, '..', 'native', 'steam_bridge', 'target', 'release', 'steam-native-bridge'),
    path.join(__dirname, '..', 'native', 'steam_bridge', 'target', 'release', 'steam-native-bridge.exe'),
  ].filter(Boolean);

  return candidatePaths.find((candidate) => fs.existsSync(candidate)) || null;
}

class SteamNativeBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.warn = typeof options.warn === 'function' ? options.warn : () => {};
    this.error = typeof options.error === 'function' ? options.error : () => {};
    this.appId = options.appId;
    this.runtimeLibraryDir = resolveRuntimeLibraryDir(options);
    this.child = null;
    this.pending = new Map();
    this.ready = false;
    this.startPromise = null;
    this.currentUser = null;
    this.nextId = 1;
  }

  isReady() {
    return this.ready && this.child && !this.child.killed;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async start() {
    if (this.isReady()) {
      return { success: true, user: this.currentUser };
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise((resolve, reject) => {
      const binaryPath = resolveNativeBridgePath();
      if (!binaryPath) {
        reject(new Error('Native Steam bridge binary was not found. Build it before launching Steam multiplayer.'));
        return;
      }

      const childEnv = buildRuntimeLibraryEnv(this.runtimeLibraryDir || path.dirname(binaryPath));
      if (this.appId) {
        childEnv.STEAM_APP_ID = String(this.appId);
      }

      const child = spawn(binaryPath, [], {
        cwd: path.dirname(binaryPath),
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.child = child;
      child.stderr.on('data', (chunk) => {
        const message = chunk.toString('utf8').trim();
        if (message) {
          this.warn('[SteamNativeBridge][stderr]', message);
        }
      });

      child.on('exit', (code, signal) => {
        const message = `Native Steam bridge exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;
        this.ready = false;
        this.child = null;
        this.currentUser = null;
        const pendingEntries = Array.from(this.pending.values());
        this.pending.clear();
        pendingEntries.forEach(({ reject: rejectPending }) => rejectPending(new Error(message)));
        this.emit('exit', { code, signal, message });
      });

      child.on('error', (spawnError) => {
        this.ready = false;
        reject(spawnError);
      });

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        this.handleLine(line, { resolve, reject });
      });
    })
      .then((result) => {
        this.startPromise = null;
        return result;
      })
      .catch((err) => {
        this.startPromise = null;
        throw err;
      });

    return this.startPromise;
  }

  stop(reason = 'shutdown') {
    if (!this.child) {
      return;
    }

    this.log('[SteamNativeBridge] Stopping:', reason);
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.currentUser = null;
    try {
      child.stdin.destroy();
    } catch {
      // Ignore stdin teardown failures.
    }
    try {
      child.kill();
    } catch {
      // Ignore process kill failures.
    }
  }

  async invoke(method, params = {}) {
    await this.start();

    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params });
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${payload}\n`, (writeError) => {
        if (!writeError) {
          return;
        }

        this.pending.delete(id);
        reject(writeError);
      });
    });
  }

  sendNotification(method, params = {}) {
    if (!this.isReady()) {
      return false;
    }

    try {
      this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
      return true;
    } catch (writeError) {
      this.warn('[SteamNativeBridge] Notification write failed:', writeError);
      return false;
    }
  }

  activateOverlay(dialog) {
    return this.invoke('activate_overlay', { dialog });
  }

  setRichPresence(entries) {
    return this.invoke('set_rich_presence', { entries });
  }

  createLobby(payload) {
    return this.invoke('create_lobby', payload);
  }

  listLobbies(filters = {}) {
    return this.invoke('list_lobbies', filters);
  }

  getLobbyData(lobbyId) {
    return this.invoke('get_lobby_data', { lobbyId });
  }

  openInviteDialog(lobbyId) {
    return this.invoke('open_invite_dialog', lobbyId ? { lobbyId } : {});
  }

  listFriends() {
    return this.invoke('list_friends');
  }

  inviteFriend(friendSteamId, lobbyId) {
    return this.invoke('invite_friend', { friendSteamId, lobbyId });
  }

  leaveLobby(lobbyId) {
    return this.invoke('leave_lobby', lobbyId ? { lobbyId } : {});
  }

  updateActiveLobbyData(metadata) {
    return this.invoke('update_active_lobby_data', { metadata });
  }

  getStats(statNames) {
    return this.invoke('get_stats', { statNames });
  }

  setStats(stats) {
    return this.invoke('set_stats', { stats });
  }

  activateAchievement(achievementId) {
    return this.invoke('activate_achievement', { achievementId });
  }

  acceptP2PSession(steamId) {
    return this.sendNotification('accept_p2p_session', { steamId });
  }

  sendP2PPacket(steamId, sendType, dataBuffer) {
    return this.sendNotification('send_p2p_packet', {
      steamId,
      sendType,
      dataBase64: Buffer.from(dataBuffer).toString('base64'),
    });
  }

  closeP2PSession(steamId) {
    return this.sendNotification('close_p2p_session', { steamId });
  }

  handleLine(line, deferredStart) {
    if (!line || !line.trim()) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(line);
    } catch (parseError) {
      this.warn('[SteamNativeBridge] Failed to parse bridge output:', parseError, line);
      return;
    }

    if (payload.type === 'response') {
      const pending = this.pending.get(String(payload.id || ''));
      if (!pending) {
        return;
      }
      this.pending.delete(String(payload.id || ''));
      if (payload.success) {
        pending.resolve(payload.result || {});
      } else {
        pending.reject(new Error(payload.error || 'Native Steam bridge request failed.'));
      }
      return;
    }

    if (payload.type !== 'event') {
      return;
    }

    const eventName = String(payload.event || '');
    const eventPayload = payload.payload || {};

    if (eventName === 'initialized') {
      this.ready = true;
      this.currentUser = {
        steamId: String(eventPayload.steamId || ''),
        name: String(eventPayload.name || ''),
      };
      deferredStart?.resolve?.({ success: true, user: this.currentUser });
    } else if (eventName === 'error' && !this.ready) {
      deferredStart?.reject?.(new Error(eventPayload.message || 'Steam native bridge initialization failed.'));
    }

    if (eventName === 'p2p-packet' && typeof eventPayload.dataBase64 === 'string') {
      eventPayload.data = Buffer.from(eventPayload.dataBase64, 'base64');
    }

    this.emit(eventName, eventPayload);
  }
}

function createSteamNativeBridge(options = {}) {
  return new SteamNativeBridge(options);
}

module.exports = {
  createSteamNativeBridge,
};
