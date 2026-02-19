import { io, Socket } from 'socket.io-client';

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
            // NOTE: Change this to your real server IP/Domain for Steam builds!
            return import.meta.env.VITE_PROD_SERVER_URL || 'http://localhost:3001';
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
    reconnection: false
});

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
        socket.on('connect', () => {
            console.log('[ConnectionManager] Socket Open');

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
            this.updateState({ phase: 'READY' });

            // Identify connection type after handshake
            const hostname = window.location.hostname;
            const isLocal = hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31);

            socket.emit('identify_connection', { isTunnel: !isLocal });
        });
    }

    private startConnectTimeout() {
        this.cleanupTimeouts();
        this.connectTimeoutTimer = setTimeout(() => {
            if (this.state.phase === 'CONNECTING') {
                console.error('[ConnectionManager] Connect Timeout');
                this.updateState({
                    phase: 'FAILED',
                    error: 'Connection Timeout',
                    details: 'Server did not accept connection within 5s'
                });
                socket.disconnect();
            }
        }, 5000);
    }

    private startHandshake() {
        this.clearHandshakeTimeout(); // Clear any existing timeout
        this.handshakeTimeoutTimer = setTimeout(() => {
            if (this.state.phase === 'HANDSHAKING') {
                console.error('[ConnectionManager] Handshake Timeout');
                this.updateState({
                    phase: 'FAILED',
                    error: 'Handshake Timeout',
                    details: 'Server connected but did not respond to hello (10s)'
                });
                socket.disconnect();
            }
        }, 10000);

        // Send Client Hello
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
        socket.connect();

        this.startConnectTimeout();
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
export const connectToServer = (input: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
        connectionManager.connect(input);

        const unsubscribe = connectionManager.subscribe((state) => {
            if (state.phase === 'READY') {
                unsubscribe();
                resolve({ success: true });
            } else if (state.phase === 'FAILED') {
                unsubscribe();
                resolve({ success: false, error: state.error });
            }
        });
    });
};
