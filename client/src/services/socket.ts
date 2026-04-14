import { io, Socket } from 'socket.io-client';

const stripIpv6Brackets = (host: string) => host.replace(/^\[/, '').replace(/\]$/, '');

const isPrivateIpv4Host = (host: string) => {
    const parts = host.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    return false;
};

const parseEndpointHost = (rawValue?: string | null): string | null => {
    if (!rawValue) return null;

    const value = rawValue.trim();
    if (!value) return null;

    try {
        return stripIpv6Brackets(new URL(value).hostname);
    } catch {
        const normalized = value.startsWith('ws://')
            ? `http://${value.slice('ws://'.length)}`
            : value.startsWith('wss://')
                ? `https://${value.slice('wss://'.length)}`
                : value;

        try {
            return stripIpv6Brackets(new URL(normalized).hostname);
        } catch {
            return null;
        }
    }
};

const normalizeSocketUrl = (rawValue?: string | null): string | null => {
    if (!rawValue) return null;

    const value = rawValue.trim();
    if (!value) return null;

    try {
        return new URL(value).toString();
    } catch {
        const normalized = value.startsWith('ws://')
            ? `http://${value.slice('ws://'.length)}`
            : value.startsWith('wss://')
                ? `https://${value.slice('wss://'.length)}`
                : value;

        try {
            return new URL(normalized).toString();
        } catch {
            return null;
        }
    }
};

const hasForcedSteamRelayTransport = (rawValue?: string | null): boolean => {
    const normalized = normalizeSocketUrl(rawValue);
    if (!normalized) return false;

    try {
        const parsed = new URL(normalized);
        return parsed.searchParams.get('ag_transport') === 'steamrelay';
    } catch {
        return false;
    }
};

const isLoopbackSocketEndpoint = (rawValue?: string | null): boolean => {
    const host = parseEndpointHost(rawValue);
    if (!host) return false;

    if (host === 'localhost' || host === '0.0.0.0' || host === '::1') {
        return true;
    }

    if (host.endsWith('.local')) {
        return true;
    }

    return isPrivateIpv4Host(host);
};

export const isLocalSocketEndpoint = (rawValue?: string | null): boolean => {
    if (hasForcedSteamRelayTransport(rawValue)) {
        return false;
    }

    const host = parseEndpointHost(rawValue);
    if (!host) return false;

    if (host === 'localhost' || host === '0.0.0.0' || host === '::1') {
        return true;
    }

    if (host.endsWith('.local')) {
        return true;
    }

    return isPrivateIpv4Host(host);
};

const getCurrentSocketTarget = () => {
    return (socket.io as any)?.uri || INITIAL_URL || '';
};

const getPreferredTransports = (rawValue?: string | null) => {
    if (isLoopbackSocketEndpoint(rawValue)) {
        return ['websocket'];
    }

    return ['polling', 'websocket'];
};

const getSocketUrl = () => {
    // 1. Check for Playit placeholder override
    let serverUrl = import.meta.env.VITE_SERVER_URL;
    if (serverUrl && serverUrl.includes('your-tunnel-url.playit.gg')) {
        console.warn('[Socket] Detected placeholder VITE_SERVER_URL. Falling back to dynamic detection.');
        serverUrl = undefined;
    }
    if (serverUrl) return serverUrl;

    // 2. Production: 
    if (import.meta.env.PROD) {
        // If we have an explicit VITE_SERVER_URL, use it
        if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;

        if (window.location.protocol === 'file:') {
            // Packaged Electron/Steam builds should prefer the embedded local engine.
            return import.meta.env.VITE_PROD_SERVER_URL || 'http://127.0.0.1:3001';
        }
        return undefined; // Connect to origin
    }

    // 3. Development: Dynamic detection
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    // If accessing via LAN IP (e.g. 192.168.x.x:5173), connect to Server on same IP:3001
    if (!isLocalhost && window.location.port !== '3001') {
        return `http://${hostname}:3001`;
    }

    // Default to 127.0.0.1:3001 for local dev to avoid IPv6 ambiguity
    return 'http://127.0.0.1:3001';
};

const INITIAL_URL = getSocketUrl();

export const socket: Socket = io(INITIAL_URL, {
    extraHeaders: {
        "bypass-tunnel-reminder": "true"
    },
    autoConnect: false,
    reconnection: false,
    transports: getPreferredTransports(INITIAL_URL)
});
(socket as any).isTunnel = !isLocalSocketEndpoint(INITIAL_URL);

export type ConnectionPhase = 'IDLE' | 'CONNECTING' | 'OPEN' | 'HANDSHAKING' | 'READY' | 'FAILED' | 'DISCONNECTED';

export interface ConnectionState {
    phase: ConnectionPhase;
    error?: string;
    url: string;
    details?: string;
    retryCount?: number;
}

class ConnectionManager {
    private state: ConnectionState = {
        phase: 'IDLE',
        url: INITIAL_URL || window.location.host,
        retryCount: 0
    };
    private listeners: ((state: ConnectionState) => void)[] = [];
    private connectTimeoutTimer: any;
    private handshakeTimeoutTimer: any;
    private reconnectTimer: any;
    private maxRetries = 20;

    constructor() {
        this.setupSocketListeners();
    }

    private setupSocketListeners() {
        socket.on('ag:relay_socket_id', (remoteSocketId: string) => {
            const normalizedId = typeof remoteSocketId === 'string' ? remoteSocketId.trim() : '';
            if (!normalizedId) {
                return;
            }

            (socket as any).relaySocketId = normalizedId;
            // The game uses socket.id as the authoritative player id in many places.
            // When connected through the local Steam relay bridge, we overwrite it
            // with the upstream server's socket id so ownership checks still work.
            (socket as any).id = normalizedId;
            console.log('[ConnectionManager] Bound relay socket id:', normalizedId);
        });

        socket.on('connect', () => {
            console.log('[ConnectionManager] Socket Open', {
                id: socket.id,
                url: getCurrentSocketTarget(),
                transport: (socket.io.engine as any)?.transport?.name || 'unknown'
            });

            // Prevent duplicate handshake if already handled
            if (this.state.phase === 'HANDSHAKING' || this.state.phase === 'READY') {
                console.log('[ConnectionManager] Ignoring duplicate connect event');
                return;
            }

            this.clearConnectTimeout();
            this.clearReconnectTimer();
            this.updateState({ phase: 'HANDSHAKING', retryCount: 0 });

            // Start Handshake
            this.startHandshake();
        });

        // Handle case where socket is already connected when listener is attached
        if (socket.connected) {
            console.log('[ConnectionManager] Socket already open, starting handshake');
            this.clearConnectTimeout();
            this.updateState({ phase: 'HANDSHAKING' });
            this.startHandshake();
        }

        socket.on('disconnect', (reason) => {
            console.log('[ConnectionManager] Disconnected:', reason);
            (socket as any).relaySocketId = null;

            // If we were explicitly cancelled or failed, stay failed.
            if (this.state.phase === 'FAILED') return;

            // Otherwise, treat as a temporary disconnection
            this.updateState({
                phase: 'DISCONNECTED',
                error: 'Disconnected from server',
                details: reason.toString()
            });

            this.startReconnectLoop();
        });

        socket.on('connect_error', (err) => {
            console.error('[ConnectionManager] Connect Error:', err);
            // If we are already in a reconnect loop, don't fail immediately
            if (this.state.phase === 'DISCONNECTED') {
                // Let the reconnect loop handle it
                return;
            }

            this.updateState({
                phase: 'FAILED',
                error: 'Connection Refused',
                details: err.message
            });
            this.cleanupTimeouts();
        });

        // Handshake Response Listener
        socket.on('SERVER_HELLO', (data) => {
            console.log('[ConnectionManager] Received SERVER_HELLO', data);
            this.clearHandshakeTimeout();
            const connectionUrl = getCurrentSocketTarget();
            const isLocal = isLocalSocketEndpoint(connectionUrl);

            (socket as any).isTunnel = !isLocal;
            this.updateState({ phase: 'READY', url: connectionUrl });

            console.log('[ConnectionManager] Connection profile:', isLocal ? 'LOCAL' : 'TUNNEL', connectionUrl);

            socket.emit('identify_connection', { isTunnel: !isLocal });
        });
    }

    private getConnectTimeoutMs() {
        return isLocalSocketEndpoint(this.state.url) ? 20000 : 8000;
    }

    private getHandshakeTimeoutMs() {
        return isLocalSocketEndpoint(this.state.url) ? 15000 : 10000;
    }

    private startConnectTimeout() {
        this.cleanupTimeouts();
        const timeoutMs = this.getConnectTimeoutMs();
        this.connectTimeoutTimer = setTimeout(() => {
            if (this.state.phase === 'CONNECTING') {
                console.error('[ConnectionManager] Connect Timeout');
                this.updateState({
                    phase: 'FAILED',
                    error: 'Connection Timeout',
                    details: `Server did not accept connection within ${Math.round(timeoutMs / 1000)}s`
                });
                socket.disconnect();
            }
        }, timeoutMs);
    }

    private startHandshake() {
        this.clearHandshakeTimeout(); // Clear any existing timeout
        const timeoutMs = this.getHandshakeTimeoutMs();
        this.handshakeTimeoutTimer = setTimeout(() => {
            if (this.state.phase === 'HANDSHAKING') {
                console.error('[ConnectionManager] Handshake Timeout');
                this.updateState({
                    phase: 'FAILED',
                    error: 'Handshake Timeout',
                    details: `Server connected but did not respond to hello (${Math.round(timeoutMs / 1000)}s)`
                });
                socket.disconnect();
            }
        }, timeoutMs);

        // Send Client Hello
        console.log('[ConnectionManager] Sending CLIENT_HELLO', {
            url: getCurrentSocketTarget(),
            transport: (socket.io.engine as any)?.transport?.name || 'unknown'
        });
        socket.emit('CLIENT_HELLO', {
            clientVersion: '1.0.0',
            userAgent: navigator.userAgent
        });
    }

    private cleanupTimeouts() {
        this.clearConnectTimeout();
        this.clearHandshakeTimeout();
        this.clearReconnectTimer();
    }

    private clearConnectTimeout() {
        if (this.connectTimeoutTimer) {
            clearTimeout(this.connectTimeoutTimer);
            this.connectTimeoutTimer = null;
        }
    }

    private clearHandshakeTimeout() {
        if (this.handshakeTimeoutTimer) {
            clearTimeout(this.handshakeTimeoutTimer);
            this.handshakeTimeoutTimer = null;
        }
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private startReconnectLoop() {
        this.clearReconnectTimer();

        const currentRetry = this.state.retryCount || 0;

        if (currentRetry >= this.maxRetries) {
            this.updateState({
                phase: 'FAILED',
                error: 'Max Retries Exceeded',
                details: 'Could not reconnect after multiple attempts'
            });
            return;
        }

        const nextRetry = currentRetry + 1;
        // Exponential backoff: 2s, 4s, 8s, 10s max
        const delay = Math.min(2000 * Math.pow(1.5, currentRetry), 10000);

        this.updateState({ retryCount: nextRetry });

        console.log(`[ConnectionManager] Reconnecting in ${delay}ms (Attempt ${nextRetry})`);

        this.reconnectTimer = setTimeout(() => {
            console.log('[ConnectionManager] Attempting Reconnect...');
            if (socket.disconnected) {
                socket.connect();
            }
        }, delay);
    }

    public retry() {
        console.log('[ConnectionManager] Manual Retry');
        this.cleanupTimeouts();
        this.updateState({
            phase: 'DISCONNECTED',
            retryCount: 0,
            error: undefined
        });

        // Force disconnect if connected (to reset state)
        if (socket.connected) socket.disconnect();

        // Immediate connect
        socket.connect();
        this.startConnectTimeout();
    }

    public updateState(newState: Partial<ConnectionState>) {
        this.state = { ...this.state, ...newState };
        if (this.state.phase === 'FAILED') {
            console.error('[ConnectionManager] State FAILED', this.state);
        }
        this.notifyListeners();
    }

    public getState(): ConnectionState {
        return this.state;
    }

    public subscribe(listener: (state: ConnectionState) => void) {
        this.listeners.push(listener);
        listener(this.state); // Initial emit
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l(this.state));
    }

    public connect(url: string) {
        console.log('[ConnectionManager] Connecting to:', url);

        // Reset State
        this.updateState({
            phase: 'CONNECTING',
            url: url,
            error: undefined,
            details: undefined
        });

        // Parse URL (Logic from original connectToServer)
        let targetUrl = url;
        if (url.startsWith('PLAYIT:')) {
            const parts = url.split(':');
            if (parts.length >= 3) {
                targetUrl = `http://${parts[1]}:${parts[2]}`;
            }
        } else if (!url.startsWith('http') && !url.startsWith('ws')) {
            if (url.includes(':')) {
                targetUrl = `http://${url}`;
            }
        }

        if (socket.connected) {
            socket.disconnect();
        }

        // @ts-ignore
        socket.io.uri = targetUrl;
        (socket as any).isTunnel = !isLocalSocketEndpoint(targetUrl);
        socket.io.opts.transports = getPreferredTransports(targetUrl);
        console.log('[ConnectionManager] Preferred transports:', socket.io.opts.transports);
        socket.connect();

        this.startConnectTimeout();
    }

    public idle(reason: string = 'Idle') {
        console.log('[ConnectionManager] Returning to idle:', reason);
        this.cleanupTimeouts();
        socket.disconnect();
        this.updateState({
            phase: 'IDLE',
            error: undefined,
            details: reason,
            retryCount: 0,
        });
    }

    public cancel() {
        console.log('[ConnectionManager] Cancelled by user');
        this.cleanupTimeouts();
        socket.disconnect();
        this.updateState({
            phase: 'FAILED',
            error: 'Cancelled',
            details: 'User cancelled connection'
        });
    }
}

export const connectionManager = new ConnectionManager();

// Backward compatibility wrapper for existing code
export const connectToServer = (
    input: string,
    timeoutMs: number = 12000
): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
        connectionManager.connect(input);

        const timeoutId = window.setTimeout(() => {
            unsubscribe();
            resolve({ success: false, error: 'Connection attempt timed out.' });
        }, timeoutMs);

        const unsubscribe = connectionManager.subscribe((state) => {
            if (state.phase === 'READY') {
                window.clearTimeout(timeoutId);
                unsubscribe();
                resolve({ success: true });
            } else if (state.phase === 'FAILED') {
                window.clearTimeout(timeoutId);
                unsubscribe();
                resolve({ success: false, error: state.error });
            }
        });
    });
};
