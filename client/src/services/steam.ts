// Define the interface for Steam User Data
export interface SteamUser {
    steamId: string;
    name: string;
}

export interface SteamFriend {
    steamId: string;
    name: string;
    nickname?: string | null;
    state?: string;
    isOnline?: boolean;
    gameAppId?: string | null;
    lobbyId?: string | null;
}

export interface SteamLobbyData {
    success: boolean;
    lobbyId?: string;
    roomId?: string;
    endpoint?: string;
    hostSteamId?: string;
    map?: string;
    mode?: string;
    queueType?: string;
    status?: string;
    ranked?: boolean;
    requiredPlayers?: number;
    memberCount?: number;
    memberLimit?: number;
    error?: string;
}

export interface SteamLobbyListResult {
    success: boolean;
    lobbies: SteamLobbyData[];
    error?: string;
}

export interface SteamFriendListResult {
    success: boolean;
    friends: SteamFriend[];
    error?: string;
}

export interface SteamStatsResult {
    success: boolean;
    stats: Record<string, number | null>;
    error?: string;
}

export interface SteamStatsUpdateResult {
    success: boolean;
    stored: boolean;
    rejected: string[];
    error?: string;
}

export interface SteamLobbyActionResult {
    success: boolean;
    error?: string;
    method?: string | null;
    note?: string | null;
}

export interface SteamRelayConnectionResult extends SteamLobbyActionResult {
    sessionId?: string;
    endpoint?: string;
}

export interface SteamLobbyCreateOptions {
    lobbyVisibility?: 'private' | 'friends' | 'public' | 'invisible';
    maxMembers?: number;
    metadata?: Record<string, string | number | boolean | null | undefined>;
}

// Add type declaration for window.require
declare global {
    interface Window {
        require: (module: string) => any;
    }
}

// Define the interface for IPC Renderer
const ipcRenderer = (window.require) ? window.require('electron').ipcRenderer : null;

type SteamEvents = {
    'initialized': (user: SteamUser) => void;
    'error': (error: string) => void;
    'join-lobby': (lobbyId: string) => void;
};

class SteamService {
    public isInitialized = false;
    public currentUser: SteamUser | null = null;
    public initError: string | null = null;

    private listeners: { [key: string]: Function[] } = {};

    constructor() {
        if (!ipcRenderer) {
            console.warn('[SteamService] IPC Renderer not available. Not running in Electron?');
            return;
        }
        this.setupListeners();
    }

    private setupListeners() {
        ipcRenderer.on('steam:init-success', (_: any, user: SteamUser) => {
            console.log('[SteamService] Init Success', user);
            this.isInitialized = true;
            this.currentUser = user;
            this.emit('initialized', user);
        });

        ipcRenderer.on('steam:init-error', (_: any, error: string) => {
            console.error('[SteamService] Init Error', error);
            this.isInitialized = false;
            this.initError = error;
            this.emit('error', error);
        });

        ipcRenderer.on('steam:join-lobby', (_: any, lobbyId: string) => {
            console.log('[SteamService] Received Join Lobby via Steam:', lobbyId);
            this.emit('join-lobby', lobbyId);
        });
    }

    public on<K extends keyof SteamEvents>(event: K, listener: SteamEvents[K]) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event]?.push(listener);
    }

    public off<K extends keyof SteamEvents>(event: K, listener: SteamEvents[K]) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event]?.filter(l => l !== listener);
    }

    private emit<K extends keyof SteamEvents>(event: K, ...args: Parameters<SteamEvents[K]>) {
        this.listeners[event]?.forEach(listener => {
            // @ts-ignore
            listener(...args);
        });
    }


    public activateOverlay(dialog: 'Friends' | 'Community' | 'Players' | 'Settings' | 'OfficialGameGroup' | 'Stats' | 'Achievements' = 'Friends') {
        if (!this.isInitialized || !ipcRenderer) return;
        ipcRenderer.send('steam:activate-overlay', dialog);
    }

    public setRichPresence(key: string, value?: string | null) {
        if (!this.isInitialized || !ipcRenderer) return;
        ipcRenderer.send('steam:set-rich-presence', { [key]: value });
    }

    public async createLobby(
        roomId: string,
        map: string,
        mode: string,
        endpoint?: string,
        options?: SteamLobbyCreateOptions
    ): Promise<{ success: boolean; lobbyId?: string; endpoint?: string; error?: string }> {
        if (!this.isInitialized || !ipcRenderer) return { success: false, error: 'Not initialized' };
        return await ipcRenderer.invoke('steam:create-lobby', {
            roomId,
            map,
            mode,
            endpoint,
            lobbyVisibility: options?.lobbyVisibility,
            maxMembers: options?.maxMembers,
            metadata: options?.metadata,
        });
    }

    public async getLobbyData(lobbyId: string): Promise<SteamLobbyData> {
        if (!this.isInitialized || !ipcRenderer) return { success: false, error: 'Not initialized' };
        return await ipcRenderer.invoke('steam:get-lobby-data', lobbyId);
    }

    public async listLobbies(filters?: {
        queueType?: string;
        status?: string;
        requireOpenSlot?: boolean;
        maxResults?: number;
    }): Promise<SteamLobbyListResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, lobbies: [], error: 'Not initialized' };
        }

        return await ipcRenderer.invoke('steam:list-lobbies', filters || {});
    }

    public async openInviteDialog(lobbyId?: string): Promise<SteamLobbyActionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:open-invite-dialog', lobbyId);
    }

    public async listFriends(): Promise<SteamFriendListResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, friends: [], error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:list-friends');
    }

    public async inviteFriend(friendSteamId: string, lobbyId?: string): Promise<SteamLobbyActionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:invite-friend', friendSteamId, lobbyId);
    }

    public async leaveLobby(lobbyId?: string): Promise<SteamLobbyActionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:leave-lobby', lobbyId);
    }

    public async prepareRelayConnection(hostSteamId: string): Promise<SteamRelayConnectionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:prepare-relay-connection', hostSteamId);
    }

    public async closeRelayConnection(sessionId?: string): Promise<SteamLobbyActionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:close-relay-connection', sessionId);
    }

    public async updateActiveLobbyData(metadata: Record<string, string | number | boolean | null | undefined>): Promise<SteamLobbyActionResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:update-active-lobby-data', metadata);
    }

    public activateAchievement(achievementId: string) {
        if (!this.isInitialized || !ipcRenderer) return;
        ipcRenderer.send('steam:activate-achievement', achievementId);
    }

    public async getStats(statNames: string[]): Promise<SteamStatsResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, stats: {}, error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:get-stats', statNames);
    }

    public async setStats(stats: Record<string, number>): Promise<SteamStatsUpdateResult> {
        if (!this.isInitialized || !ipcRenderer) {
            return { success: false, stored: false, rejected: Object.keys(stats), error: 'Not initialized' };
        }
        return await ipcRenderer.invoke('steam:set-stats', stats);
    }
}

export const steamService = new SteamService();
