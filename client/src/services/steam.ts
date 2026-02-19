// Define the interface for Steam User Data
export interface SteamUser {
    steamId: string;
    name: string;
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

    public setRichPresence(key: string, value: string) {
        if (!this.isInitialized || !ipcRenderer) return;
        ipcRenderer.send('steam:set-rich-presence', { [key]: value });
    }

    public async createLobby(roomId: string, map: string, mode: string): Promise<{ success: boolean; lobbyId?: string; error?: string }> {
        if (!this.isInitialized || !ipcRenderer) return { success: false, error: 'Not initialized' };
        return await ipcRenderer.invoke('steam:create-lobby', { roomId, map, mode });
    }

    public async getLobbyData(lobbyId: string): Promise<{ success: boolean; roomId?: string; error?: string }> {
        if (!this.isInitialized || !ipcRenderer) return { success: false, error: 'Not initialized' };
        return await ipcRenderer.invoke('steam:get-lobby-data', lobbyId);
    }

    public activateAchievement(achievementId: string) {
        if (!this.isInitialized || !ipcRenderer) return;
        ipcRenderer.send('steam:activate-achievement', achievementId);
    }
}

export const steamService = new SteamService();
