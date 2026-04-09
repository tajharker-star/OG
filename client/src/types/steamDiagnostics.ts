export type SteamMultiplayerRoute = 'steam-relay' | 'direct-endpoint' | 'pending' | 'idle';

export type SteamMultiplayerFlow = 'hosting' | 'joining' | 'ranked' | 'idle';

export type SteamDiagnosticsEvent = {
    id: string;
    at: string;
    message: string;
};

export type SteamMultiplayerDiagnostics = {
    flow: SteamMultiplayerFlow;
    route: SteamMultiplayerRoute;
    status: string;
    lobbyId: string | null;
    roomId: string | null;
    hostSteamId: string | null;
    endpoint: string | null;
    relaySessionId: string | null;
    connectionPhase: string;
    connectionUrl: string | null;
    lastError: string | null;
    updatedAt: string | null;
    events: SteamDiagnosticsEvent[];
};

export const createDefaultSteamMultiplayerDiagnostics = (): SteamMultiplayerDiagnostics => ({
    flow: 'idle',
    route: 'idle',
    status: 'Idle',
    lobbyId: null,
    roomId: null,
    hostSteamId: null,
    endpoint: null,
    relaySessionId: null,
    connectionPhase: 'IDLE',
    connectionUrl: null,
    lastError: null,
    updatedAt: null,
    events: [],
});
