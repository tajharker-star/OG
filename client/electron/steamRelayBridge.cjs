const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { io: createSocketClient } = require('socket.io-client');

const RELAY_SEND_TYPE_RELIABLE = 2;
const RELAY_CHUNK_SIZE = 24 * 1024;
const RELAY_SOCKET_ID_EVENT = 'ag:relay_socket_id';
const RELAY_TRANSPORT_QUERY_VALUE = 'steamrelay';
const RELAY_CHUNK_TTL_MS = 30000;

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown error';
}

function normalizeSteamId(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  if (typeof rawValue === 'bigint') {
    return rawValue > 0n ? rawValue.toString() : null;
  }

  if (typeof rawValue === 'object' && rawValue.steamId64 !== undefined && rawValue.steamId64 !== null) {
    return normalizeSteamId(rawValue.steamId64);
  }

  const normalized = String(rawValue).trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = BigInt(normalized);
    return parsed > 0n ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function serializeRelayEnvelope(envelope) {
  return Buffer.from(JSON.stringify(envelope, (_, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    return value;
  }), 'utf8');
}

function deserializeRelayEnvelope(buffer) {
  return JSON.parse(buffer.toString('utf8'));
}

function sanitizeRelayArgs(rawArgs) {
  return JSON.parse(JSON.stringify(rawArgs, (_, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    return value;
  }));
}

function createSteamRelayBridge(options = {}) {
  const getSteamClient = typeof options.getSteamClient === 'function'
    ? options.getSteamClient
    : () => null;
  const getSteamworksApi = typeof options.getSteamworksApi === 'function'
    ? options.getSteamworksApi
    : () => null;
  const getHostServerUrl = typeof options.getHostServerUrl === 'function'
    ? options.getHostServerUrl
    : () => null;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const warn = typeof options.warn === 'function' ? options.warn : () => {};
  const error = typeof options.error === 'function' ? options.error : () => {};

  let localBridgeServer = null;
  let localBridgeIo = null;
  let localBridgePort = null;
  let localBridgeReadyPromise = null;
  let packetPumpTimer = null;
  let packetCleanupAt = 0;
  let p2pSessionRequestHandle = null;
  let p2pSessionConnectFailHandle = null;

  const pendingChunks = new Map();
  const guestSessions = new Map();
  const hostSessions = new Map();

  const getNetworkingApi = () => getSteamClient()?.networking || null;
  const getCallbackApi = () => getSteamClient()?.callback || null;
  const getSteamCallbackEnum = () => getSteamworksApi()?.SteamCallback || null;

  const canUseRelay = () => {
    const networking = getNetworkingApi();
    return Boolean(
      networking
      && typeof networking.sendP2PPacket === 'function'
      && typeof networking.isP2PPacketAvailable === 'function'
      && typeof networking.readP2PPacket === 'function'
      && typeof networking.acceptP2PSession === 'function'
    );
  };

  const getGuestEndpoint = (sessionId) => {
    if (!localBridgePort) {
      return null;
    }

    return `http://127.0.0.1:${localBridgePort}?ag_transport=${RELAY_TRANSPORT_QUERY_VALUE}&ag_session=${encodeURIComponent(sessionId)}`;
  };

  const getHostSessionKey = (peerSteamId, sessionId) => `${peerSteamId}:${sessionId}`;

  const clearGuestHandshakeTimers = (session) => {
    if (!session) return;

    if (session.handshakeInterval) {
      clearInterval(session.handshakeInterval);
      session.handshakeInterval = null;
    }

    if (session.handshakeTimeout) {
      clearTimeout(session.handshakeTimeout);
      session.handshakeTimeout = null;
    }
  };

  const resolveGuestReady = (session) => {
    if (!session || !session.readyResolve) {
      return;
    }

    const resolve = session.readyResolve;
    session.readyResolve = null;
    session.readyReject = null;
    clearGuestHandshakeTimers(session);
    resolve();
  };

  const rejectGuestReady = (session, message) => {
    if (!session || !session.readyReject) {
      return;
    }

    const reject = session.readyReject;
    session.readyResolve = null;
    session.readyReject = null;
    clearGuestHandshakeTimers(session);
    reject(new Error(message));
  };

  const destroyHostSession = (sessionKey) => {
    const session = hostSessions.get(sessionKey);
    if (!session) {
      return false;
    }

    hostSessions.delete(sessionKey);

    if (session.serverSocket) {
      session.serverSocket.removeAllListeners();
      if (typeof session.serverSocket.disconnect === 'function') {
        session.serverSocket.disconnect();
      }
    }

    return true;
  };

  const emitRendererRelaySocketId = (session) => {
    if (!session?.rendererSocket || !session.remoteSocketId) {
      return;
    }

    session.rendererSocket.emit(RELAY_SOCKET_ID_EVENT, session.remoteSocketId);
  };

  const flushGuestIncoming = (session) => {
    if (!session?.rendererSocket) {
      return;
    }

    emitRendererRelaySocketId(session);

    while (session.pendingIncoming.length > 0) {
      const next = session.pendingIncoming.shift();
      if (!next) break;
      session.rendererSocket.emit(next.event, ...(next.args || []));
    }
  };

  const sendEnvelope = (peerSteamId, envelope) => {
    if (!canUseRelay()) {
      throw new Error('Steam relay networking is unavailable.');
    }

    const normalizedPeerId = normalizeSteamId(peerSteamId);
    if (!normalizedPeerId) {
      throw new Error('Invalid remote Steam ID for relay packet.');
    }

    const networking = getNetworkingApi();
    const payload = serializeRelayEnvelope(envelope);
    const messageId = crypto.randomUUID();
    const totalChunks = Math.max(1, Math.ceil(payload.length / RELAY_CHUNK_SIZE));

    for (let index = 0; index < totalChunks; index += 1) {
      const offset = index * RELAY_CHUNK_SIZE;
      const chunk = payload.subarray(offset, offset + RELAY_CHUNK_SIZE);
      const header = Buffer.from(JSON.stringify({
        mid: messageId,
        idx: index,
        total: totalChunks,
      }) + '\n', 'utf8');
      const packet = Buffer.concat([header, chunk]);
      const ok = networking.sendP2PPacket(BigInt(normalizedPeerId), RELAY_SEND_TYPE_RELIABLE, packet);

      if (!ok) {
        throw new Error(`Failed to send Steam relay packet chunk ${index + 1}/${totalChunks}.`);
      }
    }
  };

  const flushGuestOutgoing = (session) => {
    if (!session?.remoteConnected || session.pendingOutgoing.length === 0) {
      return;
    }

    while (session.pendingOutgoing.length > 0) {
      const next = session.pendingOutgoing.shift();
      if (!next) break;
      sendEnvelope(session.peerSteamId, next);
    }
  };

  const closeGuestSession = (sessionId, reason = 'closed', options = {}) => {
    const session = guestSessions.get(sessionId);
    if (!session) {
      return false;
    }

    guestSessions.delete(sessionId);
    clearGuestHandshakeTimers(session);

    if (options.rejectReady !== false) {
      rejectGuestReady(session, reason);
    }

    if (options.notifyPeer !== false) {
      try {
        sendEnvelope(session.peerSteamId, {
          type: 'relay_disconnect',
          sessionId,
          reason,
        });
      } catch (relayError) {
        warn('[SteamRelay] Failed to notify peer about relay close:', relayError);
      }
    }

    if (session.rendererSocket && options.disconnectRenderer !== false) {
      session.rendererSocket.removeAllListeners();
      session.rendererSocket.disconnect(true);
    }

    return true;
  };

  const cleanupPeerSessions = (peerSteamId, message) => {
    guestSessions.forEach((session, sessionId) => {
      if (session.peerSteamId !== peerSteamId) {
        return;
      }

      session.lastError = message;
      closeGuestSession(sessionId, message, {
        notifyPeer: false,
        rejectReady: true,
        disconnectRenderer: true,
      });
    });

    Array.from(hostSessions.entries()).forEach(([sessionKey, session]) => {
      if (session.peerSteamId !== peerSteamId) {
        return;
      }

      destroyHostSession(sessionKey);
    });
  };

  const ensureHostSession = (peerSteamId, sessionId) => {
    const sessionKey = getHostSessionKey(peerSteamId, sessionId);
    const existing = hostSessions.get(sessionKey);
    if (existing) {
      return existing;
    }

    const targetServerUrl = getHostServerUrl();
    if (!targetServerUrl) {
      throw new Error('Host relay server URL is unavailable.');
    }

    const serverSocket = createSocketClient(targetServerUrl, {
      autoConnect: true,
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
      extraHeaders: {
        'bypass-tunnel-reminder': 'true',
      },
    });

    const session = {
      sessionId,
      peerSteamId,
      serverSocket,
      connected: false,
      remoteSocketId: null,
      pendingClientEvents: [],
    };

    hostSessions.set(sessionKey, session);

    serverSocket.on('connect', () => {
      session.connected = true;
      session.remoteSocketId = serverSocket.id || null;

      try {
        sendEnvelope(peerSteamId, {
          type: 'relay_connected',
          sessionId,
          remoteSocketId: session.remoteSocketId,
        });
      } catch (relayError) {
        warn('[SteamRelay] Failed to confirm relay connection:', relayError);
      }

      while (session.pendingClientEvents.length > 0) {
        const next = session.pendingClientEvents.shift();
        if (!next) break;
        serverSocket.emit(next.event, ...(next.args || []));
      }
    });

    serverSocket.onAny((event, ...args) => {
      try {
        sendEnvelope(peerSteamId, {
          type: 'relay_event',
          sessionId,
          event,
          args: sanitizeRelayArgs(args),
        });
      } catch (relayError) {
        warn('[SteamRelay] Failed to forward host event:', relayError);
      }
    });

    serverSocket.on('disconnect', (disconnectReason) => {
      try {
        sendEnvelope(peerSteamId, {
          type: 'relay_disconnect',
          sessionId,
          reason: String(disconnectReason || 'Host server disconnected'),
        });
      } catch (relayError) {
        warn('[SteamRelay] Failed to notify peer of host disconnect:', relayError);
      } finally {
        destroyHostSession(sessionKey);
      }
    });

    serverSocket.on('connect_error', (connectError) => {
      try {
        sendEnvelope(peerSteamId, {
          type: 'relay_error',
          sessionId,
          error: toErrorMessage(connectError),
        });
      } catch (relayError) {
        warn('[SteamRelay] Failed to forward host connect error:', relayError);
      } finally {
        destroyHostSession(sessionKey);
      }
    });

    return session;
  };

  const handleRelayEnvelope = (peerSteamId, envelope) => {
    if (!envelope || typeof envelope !== 'object') {
      return;
    }

    const sessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId : null;
    if (!sessionId) {
      return;
    }

    switch (envelope.type) {
      case 'relay_connect': {
        const session = ensureHostSession(peerSteamId, sessionId);
        if (session.connected) {
          sendEnvelope(peerSteamId, {
            type: 'relay_connected',
            sessionId,
            remoteSocketId: session.remoteSocketId,
          });
        }
        break;
      }
      case 'relay_connected': {
        const session = guestSessions.get(sessionId);
        if (!session || session.peerSteamId !== peerSteamId) {
          return;
        }

        session.remoteConnected = true;
        session.remoteSocketId = typeof envelope.remoteSocketId === 'string'
          ? envelope.remoteSocketId
          : session.remoteSocketId;
        resolveGuestReady(session);
        emitRendererRelaySocketId(session);
        flushGuestOutgoing(session);
        flushGuestIncoming(session);
        break;
      }
      case 'relay_event': {
        const guestSession = guestSessions.get(sessionId);
        if (guestSession && guestSession.peerSteamId === peerSteamId) {
          const eventName = typeof envelope.event === 'string' ? envelope.event : '';
          const eventArgs = Array.isArray(envelope.args) ? envelope.args : [];

          if (guestSession.rendererSocket) {
            emitRendererRelaySocketId(guestSession);
            guestSession.rendererSocket.emit(eventName, ...eventArgs);
          } else {
            guestSession.pendingIncoming.push({ event: eventName, args: eventArgs });
          }
          return;
        }

        const hostSession = ensureHostSession(peerSteamId, sessionId);
        const eventName = typeof envelope.event === 'string' ? envelope.event : '';
        const eventArgs = Array.isArray(envelope.args) ? envelope.args : [];

        if (!hostSession.connected) {
          hostSession.pendingClientEvents.push({ event: eventName, args: eventArgs });
          return;
        }

        hostSession.serverSocket.emit(eventName, ...eventArgs);
        break;
      }
      case 'relay_error': {
        const session = guestSessions.get(sessionId);
        if (!session || session.peerSteamId !== peerSteamId) {
          return;
        }

        const message = typeof envelope.error === 'string'
          ? envelope.error
          : 'Steam relay connection failed.';
        session.lastError = message;
        rejectGuestReady(session, message);
        if (session.rendererSocket) {
          session.rendererSocket.disconnect(true);
        }
        break;
      }
      case 'relay_disconnect': {
        const guestSession = guestSessions.get(sessionId);
        if (guestSession && guestSession.peerSteamId === peerSteamId) {
          const message = typeof envelope.reason === 'string'
            ? envelope.reason
            : 'Steam relay disconnected.';
          guestSession.lastError = message;
          closeGuestSession(sessionId, message, {
            notifyPeer: false,
            rejectReady: true,
            disconnectRenderer: true,
          });
          return;
        }

        destroyHostSession(getHostSessionKey(peerSteamId, sessionId));
        break;
      }
      default:
        break;
    }
  };

  const cleanupExpiredChunks = () => {
    const now = Date.now();
    pendingChunks.forEach((entry, key) => {
      if ((now - entry.createdAt) > RELAY_CHUNK_TTL_MS) {
        pendingChunks.delete(key);
      }
    });
  };

  const handleIncomingPacket = (packet) => {
    const peerSteamId = normalizeSteamId(packet?.steamId);
    const packetData = packet?.data;

    if (!peerSteamId || !Buffer.isBuffer(packetData)) {
      return;
    }

    const separatorIndex = packetData.indexOf(0x0a);
    if (separatorIndex <= 0) {
      warn('[SteamRelay] Discarding malformed relay packet.');
      return;
    }

    let header;
    try {
      header = JSON.parse(packetData.subarray(0, separatorIndex).toString('utf8'));
    } catch (headerError) {
      warn('[SteamRelay] Failed to parse relay packet header:', headerError);
      return;
    }

    const messageId = typeof header.mid === 'string' ? header.mid : null;
    const chunkIndex = Number.isInteger(header.idx) ? header.idx : -1;
    const totalChunks = Number.isInteger(header.total) ? header.total : -1;
    if (!messageId || chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
      warn('[SteamRelay] Relay packet header was incomplete.');
      return;
    }

    const chunkKey = `${peerSteamId}:${messageId}`;
    const existing = pendingChunks.get(chunkKey) || {
      createdAt: Date.now(),
      totalChunks,
      chunks: new Array(totalChunks),
      receivedCount: 0,
    };

    if (!existing.chunks[chunkIndex]) {
      existing.chunks[chunkIndex] = packetData.subarray(separatorIndex + 1);
      existing.receivedCount += 1;
    }

    pendingChunks.set(chunkKey, existing);

    if (existing.receivedCount < existing.totalChunks) {
      return;
    }

    pendingChunks.delete(chunkKey);

    try {
      const payload = Buffer.concat(existing.chunks);
      const envelope = deserializeRelayEnvelope(payload);
      handleRelayEnvelope(peerSteamId, envelope);
    } catch (payloadError) {
      warn('[SteamRelay] Failed to decode relay payload:', payloadError);
    }
  };

  const ensurePacketPump = () => {
    if (packetPumpTimer || !canUseRelay()) {
      return;
    }

    packetPumpTimer = setInterval(() => {
      try {
        const networking = getNetworkingApi();
        if (!networking) {
          return;
        }

        let nextPacketSize = networking.isP2PPacketAvailable();
        let iterations = 0;

        while (nextPacketSize && iterations < 256) {
          const packet = networking.readP2PPacket(nextPacketSize);
          if (!packet?.data) {
            break;
          }

          handleIncomingPacket(packet);
          nextPacketSize = networking.isP2PPacketAvailable();
          iterations += 1;
        }

        if ((Date.now() - packetCleanupAt) > 5000) {
          cleanupExpiredChunks();
          packetCleanupAt = Date.now();
        }
      } catch (pumpError) {
        warn('[SteamRelay] Failed to pump relay packets:', pumpError);
      }
    }, 16);
  };

  const ensureCallbacksRegistered = () => {
    if (!canUseRelay()) {
      return;
    }

    const callbackApi = getCallbackApi();
    const SteamCallback = getSteamCallbackEnum();
    if (!callbackApi?.register || !SteamCallback) {
      return;
    }

    if (!p2pSessionRequestHandle) {
      p2pSessionRequestHandle = callbackApi.register(
        SteamCallback.P2PSessionRequest,
        ({ remote }) => {
          const normalizedPeerId = normalizeSteamId(remote);
          if (!normalizedPeerId) {
            return;
          }

          try {
            getNetworkingApi()?.acceptP2PSession(BigInt(normalizedPeerId));
            log('[SteamRelay] Accepted Steam P2P session request from', normalizedPeerId);
          } catch (acceptError) {
            warn('[SteamRelay] Failed to accept Steam P2P session request:', acceptError);
          }
        }
      );
    }

    if (!p2pSessionConnectFailHandle) {
      p2pSessionConnectFailHandle = callbackApi.register(
        SteamCallback.P2PSessionConnectFail,
        ({ remote, error: errorCode }) => {
          const normalizedPeerId = normalizeSteamId(remote);
          if (!normalizedPeerId) {
            return;
          }

          const message = `Steam P2P session failed (${errorCode}).`;
          warn('[SteamRelay]', message, normalizedPeerId);
          cleanupPeerSessions(normalizedPeerId, message);
        }
      );
    }
  };

  const ensureLocalBridgeServer = async () => {
    if (localBridgePort) {
      return localBridgePort;
    }

    if (localBridgeReadyPromise) {
      return localBridgeReadyPromise;
    }

    localBridgeReadyPromise = new Promise((resolve, reject) => {
      const bridgeServer = http.createServer();
      const ioServer = new Server(bridgeServer, {
        cors: {
          origin: '*',
        },
        transports: ['websocket'],
      });

      ioServer.on('connection', (socket) => {
        const sessionId = typeof socket.handshake.query.ag_session === 'string'
          ? socket.handshake.query.ag_session
          : '';
        const session = guestSessions.get(sessionId);

        if (!session) {
          warn('[SteamRelay] Renderer connected without a known guest session.', sessionId);
          socket.disconnect(true);
          return;
        }

        if (session.rendererSocket && session.rendererSocket !== socket) {
          session.rendererSocket.disconnect(true);
        }

        session.rendererSocket = socket;
        emitRendererRelaySocketId(session);
        flushGuestIncoming(session);

        socket.onAny((event, ...args) => {
          const envelope = {
            type: 'relay_event',
            sessionId,
            event,
            args: sanitizeRelayArgs(args),
          };

          if (session.remoteConnected) {
            try {
              sendEnvelope(session.peerSteamId, envelope);
            } catch (relayError) {
              warn('[SteamRelay] Failed to forward renderer event:', relayError);
            }
          } else {
            session.pendingOutgoing.push(envelope);
          }
        });

        socket.on('disconnect', () => {
          if (session.rendererSocket === socket) {
            session.rendererSocket = null;
          }
        });
      });

      bridgeServer.on('error', (bridgeError) => {
        localBridgeReadyPromise = null;
        reject(bridgeError);
      });

      bridgeServer.listen(0, '127.0.0.1', () => {
        const address = bridgeServer.address();
        if (!address || typeof address === 'string') {
          localBridgeReadyPromise = null;
          reject(new Error('Steam relay bridge did not expose a usable local port.'));
          return;
        }

        localBridgeServer = bridgeServer;
        localBridgeIo = ioServer;
        localBridgePort = address.port;
        log('[SteamRelay] Local bridge listening on', `127.0.0.1:${localBridgePort}`);
        resolve(localBridgePort);
      });
    });

    return localBridgeReadyPromise;
  };

  const activate = async () => {
    if (!canUseRelay()) {
      return false;
    }

    ensureCallbacksRegistered();
    ensurePacketPump();
    return true;
  };

  const prepareGuestSession = async (peerSteamId, timeoutMs = 12000) => {
    if (!canUseRelay()) {
      return { success: false, error: 'Steam relay networking is unavailable in this build.' };
    }

    const normalizedPeerId = normalizeSteamId(peerSteamId);
    if (!normalizedPeerId) {
      return { success: false, error: 'Invalid Steam host ID for relay connection.' };
    }

    try {
      await activate();
      await ensureLocalBridgeServer();
    } catch (startupError) {
      return { success: false, error: toErrorMessage(startupError) };
    }

    const sessionId = crypto.randomUUID();
    const session = {
      sessionId,
      peerSteamId: normalizedPeerId,
      remoteConnected: false,
      remoteSocketId: null,
      rendererSocket: null,
      pendingOutgoing: [],
      pendingIncoming: [],
      readyResolve: null,
      readyReject: null,
      handshakeInterval: null,
      handshakeTimeout: null,
      lastError: null,
    };

    guestSessions.set(sessionId, session);

    const readyPromise = new Promise((resolve, reject) => {
      session.readyResolve = resolve;
      session.readyReject = reject;
      session.handshakeInterval = setInterval(() => {
        try {
          sendEnvelope(normalizedPeerId, {
            type: 'relay_connect',
            sessionId,
          });
        } catch (relayError) {
          rejectGuestReady(session, toErrorMessage(relayError));
        }
      }, 700);
      session.handshakeTimeout = setTimeout(() => {
        rejectGuestReady(session, 'Timed out waiting for Steam relay handshake.');
      }, timeoutMs);
    });

    try {
      sendEnvelope(normalizedPeerId, {
        type: 'relay_connect',
        sessionId,
      });
      await readyPromise;
      return {
        success: true,
        sessionId,
        endpoint: getGuestEndpoint(sessionId),
      };
    } catch (relayError) {
      closeGuestSession(sessionId, toErrorMessage(relayError), {
        notifyPeer: true,
        rejectReady: false,
        disconnectRenderer: true,
      });
      return { success: false, error: toErrorMessage(relayError) };
    }
  };

  const shutdown = (reason = 'shutdown') => {
    guestSessions.forEach((_, sessionId) => {
      closeGuestSession(sessionId, reason, {
        notifyPeer: false,
        rejectReady: true,
        disconnectRenderer: true,
      });
    });

    Array.from(hostSessions.keys()).forEach((sessionKey) => {
      destroyHostSession(sessionKey);
    });

    pendingChunks.clear();

    if (packetPumpTimer) {
      clearInterval(packetPumpTimer);
      packetPumpTimer = null;
    }

    if (p2pSessionRequestHandle?.disconnect) {
      p2pSessionRequestHandle.disconnect();
      p2pSessionRequestHandle = null;
    }

    if (p2pSessionConnectFailHandle?.disconnect) {
      p2pSessionConnectFailHandle.disconnect();
      p2pSessionConnectFailHandle = null;
    }

    if (localBridgeIo) {
      localBridgeIo.close();
      localBridgeIo = null;
    }

    if (localBridgeServer) {
      localBridgeServer.close();
      localBridgeServer = null;
    }

    localBridgePort = null;
    localBridgeReadyPromise = null;
  };

  return {
    activate,
    canUseRelay,
    prepareGuestSession,
    closeGuestSession,
    shutdown,
  };
}

module.exports = {
  RELAY_SOCKET_ID_EVENT,
  RELAY_TRANSPORT_QUERY_VALUE,
  createSteamRelayBridge,
};
