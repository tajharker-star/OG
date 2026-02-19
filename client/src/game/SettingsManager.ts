type Listener = (settings: Settings) => void;

class SimpleEventEmitter {
    private listeners: Listener[] = [];

    on(event: string, listener: Listener) {
        if (event === 'change') {
            this.listeners.push(listener);
        }
    }

    off(event: string, listener: Listener) {
        if (event === 'change') {
            this.listeners = this.listeners.filter(l => l !== listener);
        }
    }

    emit(event: string, settings: Settings) {
        if (event === 'change') {
            this.listeners.forEach(l => l(settings));
        }
    }
}

export interface Keybinds {
    cameraUp: string;
    cameraDown: string;
    cameraLeft: string;
    cameraRight: string;
    centerCamera: string;
    clearSelection: string;
    loadFerry: string;
    unloadFerry: string;
    buildMine: string;
    buildBarracks: string;
    buildTower: string;
    buildDock: string;
    buildOilRig: string;
    buildWall: string;
    buildBridgeNode: string;
    buildWallNode: string;
    cancel: string;
}

export interface AudioSettings {
    masterVolume: number;
    sfxVolume: number;
    musicVolume: number;
}

export interface GraphicsSettings {
    showFps: boolean;
    highQuality: boolean;
    showParticles: boolean;
    showWeather: boolean; // Rain, snow, tumbleweeds
    maxParticles: number;
    resolution: number; // 0.5 to 1.0
    targetFps: number; // 30, 60, 144, etc.
    menuExplosionDensity: number; // 0.0 to 1.0 (Multiplier for background explosions)
    screenShakeIntensity: number; // 0.0 to 2.0 (Multiplier for audio shake)
    menuProjectileMultiplierPercent: number; // 0 to 10000 (Main menu projectile density percent)
}

export interface Settings {
    keybinds: Keybinds;
    audio: AudioSettings;
    graphics: GraphicsSettings;
}

const DEFAULT_SETTINGS: Settings = {
    keybinds: {
        cameraUp: 'W',
        cameraDown: 'S',
        cameraLeft: 'A',
        cameraRight: 'D',
        centerCamera: 'H',
        clearSelection: 'Z',
        loadFerry: 'K',
        unloadFerry: 'L',
        buildMine: '1',
        buildBarracks: '2',
        buildTower: '3',
        buildDock: '4',
        buildOilRig: '5',
        buildWall: '6',
        buildBridgeNode: '7',
        buildWallNode: '8',
        cancel: 'Escape'
    },
    audio: {
        masterVolume: 0.5,
        sfxVolume: 0.5,
        musicVolume: 0.5
    },
    graphics: {
        showFps: false,
        highQuality: false,
        showParticles: false,
        showWeather: false,
        maxParticles: 200,
        resolution: 1.0,
        targetFps: 30,
        menuExplosionDensity: 1.0,
        screenShakeIntensity: 1.0,
        menuProjectileMultiplierPercent: 100
    }
};

class SettingsManager extends SimpleEventEmitter {
    private settings: Settings;

    constructor() {
        super();
        this.settings = this.loadSettings();
    }

    private loadSettings(): Settings {
        try {
            const stored = localStorage.getItem('game_settings');
            if (stored) {
                // Merge with default to ensure new keys exist
                const parsed = JSON.parse(stored);
                const merged: Settings = {
                    keybinds: { ...DEFAULT_SETTINGS.keybinds, ...parsed.keybinds },
                    audio: { ...DEFAULT_SETTINGS.audio, ...parsed.audio },
                    graphics: { ...DEFAULT_SETTINGS.graphics, ...parsed.graphics }
                };
                // Migration: derive menuProjectileMultiplierPercent from legacy menuExplosionDensity if missing
                if (merged.graphics.menuProjectileMultiplierPercent === undefined) {
                    const legacy = merged.graphics.menuExplosionDensity;
                    if (typeof legacy === 'number') {
                        const percent = Math.max(0, Math.min(10000, legacy * 100));
                        merged.graphics.menuProjectileMultiplierPercent = percent;
                    }
                }
                return merged;
            }
        } catch (e) {
            console.error('Failed to load settings', e);
        }
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }

    public saveSettings() {
        localStorage.setItem('game_settings', JSON.stringify(this.settings));
        this.emit('change', this.settings);
    }

    public getSettings(): Settings {
        return this.settings;
    }

    public getKeybind(action: keyof Keybinds): string {
        return this.settings.keybinds[action];
    }

    public setKeybind(action: keyof Keybinds, key: string) {
        this.settings.keybinds[action] = key.toUpperCase();
        this.saveSettings();
    }

    public setAudio(setting: keyof AudioSettings, value: number) {
        this.settings.audio[setting] = Math.max(0, Math.min(1, value));
        this.saveSettings();
    }

    public setGraphics(setting: keyof GraphicsSettings, value: boolean | number) {
        (this.settings.graphics as any)[setting] = value;
        this.saveSettings();
    }

    public reset() {
        this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        this.saveSettings();
    }
}

export const settingsManager = new SettingsManager();
