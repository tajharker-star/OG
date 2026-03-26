import { settingsManager } from '../game/SettingsManager';
import type { Building, Unit } from '../types/game';
import type { SfxEffectId } from './sfxCatalog';

export type ButtonSoundVariant = 'primary' | 'secondary' | 'danger';
export type CombatSoundSource =
    | Unit['type']
    | 'tower'
    | 'base'
    | 'tesla'
    | 'unknown';
export type PlacementOwnership = 'self' | 'enemy' | 'neutral';

export interface SpatialSoundLocation {
    x: number;
    y: number;
    listenerX: number;
    listenerY: number;
    viewportWidth: number;
    viewportHeight: number;
    zoom?: number;
}

type SoundLayer = ToneLayer | NoiseLayer;

interface ToneLayer {
    kind: 'tone';
    wave: OscillatorType;
    startHz: number;
    endHz?: number;
    gain: number;
    startMs?: number;
    attackMs?: number;
    decayMs: number;
    detune?: number;
    highpassHz?: number;
    lowpassHz?: number;
    bandpassHz?: number;
    q?: number;
}

interface NoiseLayer {
    kind: 'noise';
    gain: number;
    startMs?: number;
    attackMs?: number;
    decayMs: number;
    playbackRate?: number;
    highpassHz?: number;
    lowpassHz?: number;
    bandpassHz?: number;
    q?: number;
}

interface SoundRecipe {
    cooldownMs: number;
    baseVolume: number;
    layers: SoundLayer[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const EPSILON_GAIN = 0.0001;

const BUTTON_RECIPES: Record<ButtonSoundVariant, SoundRecipe> = {
    primary: {
        cooldownMs: 22,
        baseVolume: 0.62,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 240, endHz: 148, gain: 0.22, attackMs: 2, decayMs: 72, lowpassHz: 1400 },
            { kind: 'tone', wave: 'square', startHz: 1620, endHz: 980, gain: 0.055, startMs: 4, attackMs: 1, decayMs: 40, highpassHz: 650 },
            { kind: 'noise', gain: 0.03, startMs: 2, attackMs: 1, decayMs: 22, bandpassHz: 2800, q: 0.9 }
        ]
    },
    secondary: {
        cooldownMs: 24,
        baseVolume: 0.54,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 210, endHz: 132, gain: 0.18, attackMs: 2, decayMs: 64, lowpassHz: 1100 },
            { kind: 'tone', wave: 'sine', startHz: 1100, endHz: 760, gain: 0.03, startMs: 5, attackMs: 1, decayMs: 34, highpassHz: 520 },
            { kind: 'noise', gain: 0.02, startMs: 1, attackMs: 1, decayMs: 18, bandpassHz: 2200, q: 0.75 }
        ]
    },
    danger: {
        cooldownMs: 28,
        baseVolume: 0.66,
        layers: [
            { kind: 'tone', wave: 'sawtooth', startHz: 186, endHz: 104, gain: 0.2, attackMs: 2, decayMs: 88, lowpassHz: 980 },
            { kind: 'tone', wave: 'square', startHz: 920, endHz: 540, gain: 0.045, startMs: 3, attackMs: 1, decayMs: 48, bandpassHz: 860, q: 1.1 },
            { kind: 'noise', gain: 0.034, startMs: 0, attackMs: 1, decayMs: 34, highpassHz: 1200, lowpassHz: 3600 }
        ]
    }
};

const COMBAT_RECIPES: Record<CombatSoundSource, SoundRecipe> = {
    soldier: {
        cooldownMs: 42,
        baseVolume: 0.52,
        layers: [
            { kind: 'noise', gain: 0.075, attackMs: 1, decayMs: 38, highpassHz: 1300, lowpassHz: 5200 },
            { kind: 'tone', wave: 'square', startHz: 210, endHz: 120, gain: 0.05, attackMs: 1, decayMs: 32, lowpassHz: 900 },
            { kind: 'tone', wave: 'triangle', startHz: 840, endHz: 620, gain: 0.02, startMs: 2, attackMs: 1, decayMs: 24, bandpassHz: 1400, q: 0.8 }
        ]
    },
    sniper: {
        cooldownMs: 140,
        baseVolume: 0.84,
        layers: [
            { kind: 'noise', gain: 0.12, attackMs: 1, decayMs: 74, highpassHz: 1600, lowpassHz: 7600 },
            { kind: 'tone', wave: 'square', startHz: 460, endHz: 138, gain: 0.09, attackMs: 1, decayMs: 96, lowpassHz: 1200 },
            { kind: 'tone', wave: 'sine', startHz: 1680, endHz: 820, gain: 0.04, startMs: 3, attackMs: 1, decayMs: 72, bandpassHz: 2000, q: 1.2 }
        ]
    },
    rocketeer: {
        cooldownMs: 160,
        baseVolume: 0.8,
        layers: [
            { kind: 'noise', gain: 0.08, attackMs: 6, decayMs: 160, highpassHz: 240, lowpassHz: 1900 },
            { kind: 'tone', wave: 'sawtooth', startHz: 120, endHz: 220, gain: 0.09, attackMs: 8, decayMs: 180, lowpassHz: 760 },
            { kind: 'tone', wave: 'square', startHz: 520, endHz: 240, gain: 0.03, attackMs: 2, decayMs: 100, bandpassHz: 980, q: 1.4 }
        ]
    },
    destroyer: {
        cooldownMs: 220,
        baseVolume: 0.95,
        layers: [
            { kind: 'noise', gain: 0.11, attackMs: 4, decayMs: 210, highpassHz: 180, lowpassHz: 1800 },
            { kind: 'tone', wave: 'triangle', startHz: 84, endHz: 42, gain: 0.16, attackMs: 4, decayMs: 260, lowpassHz: 240 },
            { kind: 'tone', wave: 'square', startHz: 420, endHz: 150, gain: 0.05, startMs: 8, attackMs: 2, decayMs: 120, bandpassHz: 640, q: 0.8 }
        ]
    },
    pirate_ship: {
        cooldownMs: 240,
        baseVolume: 0.88,
        layers: [
            { kind: 'noise', gain: 0.095, attackMs: 3, decayMs: 190, highpassHz: 150, lowpassHz: 1400 },
            { kind: 'tone', wave: 'triangle', startHz: 96, endHz: 52, gain: 0.13, attackMs: 4, decayMs: 220, lowpassHz: 260 },
            { kind: 'tone', wave: 'sine', startHz: 310, endHz: 148, gain: 0.035, startMs: 8, attackMs: 2, decayMs: 110, lowpassHz: 520 }
        ]
    },
    tank: {
        cooldownMs: 170,
        baseVolume: 0.82,
        layers: [
            { kind: 'noise', gain: 0.088, attackMs: 3, decayMs: 150, highpassHz: 360, lowpassHz: 2600 },
            { kind: 'tone', wave: 'triangle', startHz: 110, endHz: 58, gain: 0.12, attackMs: 2, decayMs: 180, lowpassHz: 320 },
            { kind: 'tone', wave: 'square', startHz: 560, endHz: 220, gain: 0.042, startMs: 5, attackMs: 1, decayMs: 70, bandpassHz: 900, q: 0.9 }
        ]
    },
    humvee: {
        cooldownMs: 36,
        baseVolume: 0.48,
        layers: [
            { kind: 'noise', gain: 0.06, attackMs: 1, decayMs: 28, highpassHz: 1500, lowpassHz: 6200 },
            { kind: 'tone', wave: 'square', startHz: 250, endHz: 160, gain: 0.04, attackMs: 1, decayMs: 24, lowpassHz: 1400 }
        ]
    },
    missile_launcher: {
        cooldownMs: 190,
        baseVolume: 0.82,
        layers: [
            { kind: 'noise', gain: 0.09, attackMs: 10, decayMs: 220, highpassHz: 200, lowpassHz: 2300 },
            { kind: 'tone', wave: 'sawtooth', startHz: 96, endHz: 196, gain: 0.11, attackMs: 12, decayMs: 200, lowpassHz: 720 },
            { kind: 'tone', wave: 'square', startHz: 460, endHz: 280, gain: 0.03, startMs: 5, attackMs: 2, decayMs: 120, bandpassHz: 780, q: 1.0 }
        ]
    },
    light_plane: {
        cooldownMs: 72,
        baseVolume: 0.56,
        layers: [
            { kind: 'noise', gain: 0.058, attackMs: 2, decayMs: 46, highpassHz: 1400, lowpassHz: 5200 },
            { kind: 'tone', wave: 'square', startHz: 460, endHz: 300, gain: 0.03, attackMs: 1, decayMs: 32, bandpassHz: 1100, q: 1.2 },
            { kind: 'tone', wave: 'sine', startHz: 980, endHz: 720, gain: 0.018, startMs: 2, attackMs: 1, decayMs: 40, highpassHz: 900 }
        ]
    },
    heavy_plane: {
        cooldownMs: 110,
        baseVolume: 0.74,
        layers: [
            { kind: 'noise', gain: 0.085, attackMs: 4, decayMs: 82, highpassHz: 1000, lowpassHz: 4200 },
            { kind: 'tone', wave: 'triangle', startHz: 180, endHz: 84, gain: 0.08, attackMs: 2, decayMs: 96, lowpassHz: 540 },
            { kind: 'tone', wave: 'square', startHz: 720, endHz: 300, gain: 0.03, startMs: 3, attackMs: 1, decayMs: 52, bandpassHz: 980, q: 0.85 }
        ]
    },
    aircraft_carrier: {
        cooldownMs: 220,
        baseVolume: 0.9,
        layers: [
            { kind: 'noise', gain: 0.09, attackMs: 9, decayMs: 220, highpassHz: 160, lowpassHz: 1900 },
            { kind: 'tone', wave: 'sawtooth', startHz: 86, endHz: 168, gain: 0.12, attackMs: 10, decayMs: 220, lowpassHz: 640 },
            { kind: 'tone', wave: 'triangle', startHz: 300, endHz: 170, gain: 0.035, startMs: 10, attackMs: 2, decayMs: 120, bandpassHz: 520, q: 0.95 }
        ]
    },
    mothership: {
        cooldownMs: 180,
        baseVolume: 0.82,
        layers: [
            { kind: 'tone', wave: 'sawtooth', startHz: 320, endHz: 180, gain: 0.08, attackMs: 4, decayMs: 160, bandpassHz: 780, q: 1.3 },
            { kind: 'tone', wave: 'sine', startHz: 860, endHz: 420, gain: 0.06, attackMs: 2, decayMs: 140, bandpassHz: 1200, q: 0.9 },
            { kind: 'noise', gain: 0.045, attackMs: 3, decayMs: 120, highpassHz: 1800, lowpassHz: 6200 }
        ]
    },
    tower: {
        cooldownMs: 70,
        baseVolume: 0.52,
        layers: [
            { kind: 'noise', gain: 0.06, attackMs: 1, decayMs: 34, highpassHz: 1300, lowpassHz: 5000 },
            { kind: 'tone', wave: 'triangle', startHz: 190, endHz: 110, gain: 0.045, attackMs: 1, decayMs: 30, lowpassHz: 860 }
        ]
    },
    base: {
        cooldownMs: 120,
        baseVolume: 0.72,
        layers: [
            { kind: 'noise', gain: 0.08, attackMs: 2, decayMs: 60, highpassHz: 900, lowpassHz: 4200 },
            { kind: 'tone', wave: 'triangle', startHz: 170, endHz: 86, gain: 0.085, attackMs: 2, decayMs: 82, lowpassHz: 460 },
            { kind: 'tone', wave: 'square', startHz: 620, endHz: 260, gain: 0.022, startMs: 4, attackMs: 1, decayMs: 42, bandpassHz: 920, q: 1.1 }
        ]
    },
    tesla: {
        cooldownMs: 110,
        baseVolume: 0.8,
        layers: [
            { kind: 'noise', gain: 0.05, attackMs: 1, decayMs: 80, highpassHz: 2400, lowpassHz: 9000 },
            { kind: 'tone', wave: 'sawtooth', startHz: 1420, endHz: 520, gain: 0.055, attackMs: 1, decayMs: 90, bandpassHz: 2200, q: 1.8 },
            { kind: 'tone', wave: 'square', startHz: 260, endHz: 180, gain: 0.03, startMs: 2, attackMs: 1, decayMs: 56, bandpassHz: 480, q: 1.1 }
        ]
    },
    unknown: {
        cooldownMs: 60,
        baseVolume: 0.5,
        layers: [
            { kind: 'noise', gain: 0.05, attackMs: 1, decayMs: 34, highpassHz: 1200, lowpassHz: 4200 },
            { kind: 'tone', wave: 'square', startHz: 220, endHz: 140, gain: 0.04, attackMs: 1, decayMs: 30, lowpassHz: 900 }
        ]
    },
    builder: { cooldownMs: 9999, baseVolume: 0, layers: [] },
    construction_ship: { cooldownMs: 9999, baseVolume: 0, layers: [] },
    ferry: { cooldownMs: 9999, baseVolume: 0, layers: [] },
    oil_seeker: { cooldownMs: 9999, baseVolume: 0, layers: [] }
};

const BUILDING_RECIPES: Record<Building['type'], SoundRecipe> = {
    barracks: {
        cooldownMs: 90,
        baseVolume: 0.7,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 180, endHz: 118, gain: 0.12, attackMs: 3, decayMs: 140, lowpassHz: 620 },
            { kind: 'noise', gain: 0.05, attackMs: 2, decayMs: 78, bandpassHz: 1600, q: 0.8 },
            { kind: 'tone', wave: 'sine', startHz: 720, endHz: 520, gain: 0.028, startMs: 14, attackMs: 2, decayMs: 88, bandpassHz: 980, q: 1.0 }
        ]
    },
    mine: {
        cooldownMs: 80,
        baseVolume: 0.66,
        layers: [
            { kind: 'tone', wave: 'square', startHz: 620, endHz: 420, gain: 0.048, attackMs: 1, decayMs: 56, bandpassHz: 1200, q: 1.4 },
            { kind: 'noise', gain: 0.045, startMs: 3, attackMs: 1, decayMs: 44, highpassHz: 2000, lowpassHz: 5200 },
            { kind: 'tone', wave: 'triangle', startHz: 140, endHz: 102, gain: 0.07, attackMs: 2, decayMs: 100, lowpassHz: 420 }
        ]
    },
    tower: {
        cooldownMs: 100,
        baseVolume: 0.72,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 154, endHz: 102, gain: 0.11, attackMs: 3, decayMs: 150, lowpassHz: 500 },
            { kind: 'noise', gain: 0.05, attackMs: 2, decayMs: 68, bandpassHz: 1400, q: 0.9 },
            { kind: 'tone', wave: 'sine', startHz: 840, endHz: 620, gain: 0.022, startMs: 12, attackMs: 1, decayMs: 70, bandpassHz: 1200, q: 1.1 }
        ]
    },
    dock: {
        cooldownMs: 95,
        baseVolume: 0.72,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 132, endHz: 82, gain: 0.11, attackMs: 3, decayMs: 160, lowpassHz: 360 },
            { kind: 'noise', gain: 0.04, attackMs: 4, decayMs: 96, highpassHz: 300, lowpassHz: 1400 },
            { kind: 'tone', wave: 'sine', startHz: 420, endHz: 240, gain: 0.03, startMs: 10, attackMs: 2, decayMs: 84, bandpassHz: 520, q: 0.9 }
        ]
    },
    base: {
        cooldownMs: 130,
        baseVolume: 0.86,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 120, endHz: 64, gain: 0.16, attackMs: 4, decayMs: 220, lowpassHz: 260 },
            { kind: 'noise', gain: 0.06, attackMs: 3, decayMs: 92, highpassHz: 650, lowpassHz: 2400 },
            { kind: 'tone', wave: 'sine', startHz: 520, endHz: 280, gain: 0.032, startMs: 15, attackMs: 2, decayMs: 120, bandpassHz: 720, q: 0.85 }
        ]
    },
    oil_rig: {
        cooldownMs: 110,
        baseVolume: 0.78,
        layers: [
            { kind: 'tone', wave: 'sawtooth', startHz: 150, endHz: 98, gain: 0.1, attackMs: 5, decayMs: 170, lowpassHz: 520 },
            { kind: 'noise', gain: 0.052, attackMs: 5, decayMs: 120, bandpassHz: 900, q: 1.0 },
            { kind: 'tone', wave: 'square', startHz: 880, endHz: 540, gain: 0.018, startMs: 8, attackMs: 1, decayMs: 88, bandpassHz: 1500, q: 1.5 }
        ]
    },
    oil_well: {
        cooldownMs: 110,
        baseVolume: 0.74,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 110, endHz: 82, gain: 0.1, attackMs: 4, decayMs: 140, lowpassHz: 340 },
            { kind: 'noise', gain: 0.042, attackMs: 2, decayMs: 74, bandpassHz: 980, q: 0.8 },
            { kind: 'tone', wave: 'sine', startHz: 420, endHz: 240, gain: 0.028, startMs: 16, attackMs: 2, decayMs: 110, bandpassHz: 560, q: 0.9 }
        ]
    },
    wall: {
        cooldownMs: 50,
        baseVolume: 0.55,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 150, endHz: 110, gain: 0.08, attackMs: 1, decayMs: 88, lowpassHz: 420 },
            { kind: 'noise', gain: 0.036, attackMs: 1, decayMs: 42, bandpassHz: 1800, q: 0.85 }
        ]
    },
    bridge_node: {
        cooldownMs: 60,
        baseVolume: 0.62,
        layers: [
            { kind: 'tone', wave: 'square', startHz: 420, endHz: 240, gain: 0.05, attackMs: 1, decayMs: 80, bandpassHz: 760, q: 1.1 },
            { kind: 'noise', gain: 0.044, attackMs: 1, decayMs: 56, highpassHz: 1200, lowpassHz: 4400 },
            { kind: 'tone', wave: 'triangle', startHz: 128, endHz: 92, gain: 0.05, startMs: 4, attackMs: 2, decayMs: 92, lowpassHz: 380 }
        ]
    },
    wall_node: {
        cooldownMs: 60,
        baseVolume: 0.58,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 168, endHz: 116, gain: 0.08, attackMs: 1, decayMs: 96, lowpassHz: 420 },
            { kind: 'noise', gain: 0.04, attackMs: 1, decayMs: 48, bandpassHz: 1600, q: 0.9 }
        ]
    },
    farm: {
        cooldownMs: 70,
        baseVolume: 0.6,
        layers: [
            { kind: 'tone', wave: 'sine', startHz: 260, endHz: 180, gain: 0.05, attackMs: 2, decayMs: 110, bandpassHz: 480, q: 0.7 },
            { kind: 'tone', wave: 'triangle', startHz: 150, endHz: 108, gain: 0.07, attackMs: 2, decayMs: 118, lowpassHz: 460 },
            { kind: 'noise', gain: 0.024, attackMs: 1, decayMs: 36, highpassHz: 1800, lowpassHz: 5200 }
        ]
    },
    tank_factory: {
        cooldownMs: 120,
        baseVolume: 0.84,
        layers: [
            { kind: 'tone', wave: 'triangle', startHz: 112, endHz: 68, gain: 0.13, attackMs: 4, decayMs: 200, lowpassHz: 280 },
            { kind: 'noise', gain: 0.06, attackMs: 3, decayMs: 110, bandpassHz: 860, q: 1.0 },
            { kind: 'tone', wave: 'square', startHz: 520, endHz: 220, gain: 0.03, startMs: 12, attackMs: 1, decayMs: 110, bandpassHz: 820, q: 1.2 }
        ]
    },
    air_base: {
        cooldownMs: 120,
        baseVolume: 0.8,
        layers: [
            { kind: 'noise', gain: 0.05, attackMs: 5, decayMs: 120, highpassHz: 320, lowpassHz: 1800 },
            { kind: 'tone', wave: 'sawtooth', startHz: 180, endHz: 280, gain: 0.08, attackMs: 8, decayMs: 180, lowpassHz: 720 },
            { kind: 'tone', wave: 'sine', startHz: 640, endHz: 840, gain: 0.02, startMs: 10, attackMs: 3, decayMs: 90, bandpassHz: 1200, q: 1.1 }
        ]
    },
    hospital: {
        cooldownMs: 110,
        baseVolume: 0.64,
        layers: [
            { kind: 'tone', wave: 'sine', startHz: 520, endHz: 680, gain: 0.04, attackMs: 6, decayMs: 120, bandpassHz: 900, q: 0.7 },
            { kind: 'tone', wave: 'triangle', startHz: 180, endHz: 132, gain: 0.06, attackMs: 3, decayMs: 100, lowpassHz: 460 },
            { kind: 'noise', gain: 0.018, attackMs: 1, decayMs: 30, highpassHz: 2200, lowpassHz: 6200 }
        ]
    },
    repair_dock: {
        cooldownMs: 110,
        baseVolume: 0.74,
        layers: [
            { kind: 'tone', wave: 'square', startHz: 620, endHz: 380, gain: 0.04, attackMs: 1, decayMs: 74, bandpassHz: 1000, q: 1.2 },
            { kind: 'noise', gain: 0.046, attackMs: 2, decayMs: 70, highpassHz: 1800, lowpassHz: 5200 },
            { kind: 'tone', wave: 'triangle', startHz: 130, endHz: 88, gain: 0.08, startMs: 6, attackMs: 2, decayMs: 120, lowpassHz: 360 }
        ]
    },
    naval_mine: {
        cooldownMs: 110,
        baseVolume: 0.7,
        layers: [
            { kind: 'tone', wave: 'sine', startHz: 680, endHz: 360, gain: 0.038, attackMs: 2, decayMs: 120, bandpassHz: 920, q: 1.6 },
            { kind: 'noise', gain: 0.04, attackMs: 2, decayMs: 86, bandpassHz: 1200, q: 0.9 },
            { kind: 'tone', wave: 'triangle', startHz: 120, endHz: 76, gain: 0.08, startMs: 6, attackMs: 2, decayMs: 140, lowpassHz: 320 }
        ]
    }
};

const BUTTON_VARIANT_TO_EFFECT_ID: Record<ButtonSoundVariant, SfxEffectId> = {
    primary: 'uiButtonPrimary',
    secondary: 'uiButtonSecondary',
    danger: 'uiButtonDanger'
};

const COMBAT_SOURCE_TO_EFFECT_ID: Record<CombatSoundSource, SfxEffectId> = {
    soldier: 'attackSoldier',
    sniper: 'attackSniper',
    rocketeer: 'attackRocketeer',
    destroyer: 'attackDestroyer',
    pirate_ship: 'attackPirateShip',
    construction_ship: 'attackUnknown',
    builder: 'attackUnknown',
    ferry: 'attackUnknown',
    tank: 'attackTank',
    humvee: 'attackHumvee',
    missile_launcher: 'attackMissileLauncher',
    oil_seeker: 'attackUnknown',
    light_plane: 'attackLightPlane',
    heavy_plane: 'attackHeavyPlane',
    aircraft_carrier: 'attackAircraftCarrier',
    mothership: 'attackMothership',
    tower: 'attackTower',
    base: 'attackBase',
    tesla: 'attackTesla',
    unknown: 'attackUnknown'
};

const BUILDING_TYPE_TO_EFFECT_ID: Record<Building['type'], SfxEffectId> = {
    barracks: 'buildBarracks',
    mine: 'buildMine',
    tower: 'buildTower',
    dock: 'buildDock',
    base: 'buildBase',
    oil_rig: 'buildOilRig',
    oil_well: 'buildOilWell',
    wall: 'buildWall',
    bridge_node: 'buildBridgeNode',
    wall_node: 'buildWallNode',
    farm: 'buildFarm',
    tank_factory: 'buildTankFactory',
    air_base: 'buildAirBase',
    hospital: 'buildHospital',
    repair_dock: 'buildRepairDock',
    naval_mine: 'buildNavalMine'
};

const EFFECT_PREVIEW_RECIPES: Record<SfxEffectId, SoundRecipe> = {
    uiButtonPrimary: BUTTON_RECIPES.primary,
    uiButtonSecondary: BUTTON_RECIPES.secondary,
    uiButtonDanger: BUTTON_RECIPES.danger,
    moveLand: {
        cooldownMs: 70,
        baseVolume: 0.62,
        layers: [
            { kind: 'noise', gain: 0.038, attackMs: 1, decayMs: 44, bandpassHz: 1400, q: 0.9 },
            { kind: 'tone', wave: 'triangle', startHz: 180, endHz: 110, gain: 0.08, attackMs: 1, decayMs: 72, lowpassHz: 460 }
        ]
    },
    moveWater: {
        cooldownMs: 80,
        baseVolume: 0.66,
        layers: [
            { kind: 'noise', gain: 0.045, attackMs: 3, decayMs: 110, highpassHz: 240, lowpassHz: 1600 },
            { kind: 'tone', wave: 'sine', startHz: 160, endHz: 90, gain: 0.06, attackMs: 2, decayMs: 100, lowpassHz: 300 }
        ]
    },
    moveAir: {
        cooldownMs: 80,
        baseVolume: 0.62,
        layers: [
            { kind: 'noise', gain: 0.03, attackMs: 2, decayMs: 80, highpassHz: 1000, lowpassHz: 4200 },
            { kind: 'tone', wave: 'sawtooth', startHz: 260, endHz: 360, gain: 0.05, attackMs: 3, decayMs: 120, bandpassHz: 720, q: 1.1 }
        ]
    },
    recruit: {
        cooldownMs: 90,
        baseVolume: 0.6,
        layers: [
            { kind: 'tone', wave: 'sine', startHz: 620, endHz: 820, gain: 0.055, attackMs: 2, decayMs: 88, bandpassHz: 1100, q: 0.8 },
            { kind: 'tone', wave: 'triangle', startHz: 220, endHz: 180, gain: 0.04, startMs: 8, attackMs: 2, decayMs: 120, lowpassHz: 520 }
        ]
    },
    explosion: {
        cooldownMs: 140,
        baseVolume: 0.88,
        layers: [
            { kind: 'noise', gain: 0.12, attackMs: 2, decayMs: 220, highpassHz: 140, lowpassHz: 2200 },
            { kind: 'tone', wave: 'triangle', startHz: 110, endHz: 44, gain: 0.14, attackMs: 3, decayMs: 260, lowpassHz: 240 }
        ]
    },
    damageAlertHq: {
        cooldownMs: 120,
        baseVolume: 0.76,
        layers: [
            { kind: 'tone', wave: 'sawtooth', startHz: 340, endHz: 160, gain: 0.07, attackMs: 2, decayMs: 160, bandpassHz: 620, q: 1.2 },
            { kind: 'noise', gain: 0.04, attackMs: 1, decayMs: 90, highpassHz: 1500, lowpassHz: 5000 },
            { kind: 'tone', wave: 'triangle', startHz: 130, endHz: 78, gain: 0.09, startMs: 4, attackMs: 2, decayMs: 140, lowpassHz: 320 }
        ]
    },
    damageAlertBuilding: {
        cooldownMs: 70,
        baseVolume: 0.58,
        layers: [
            { kind: 'noise', gain: 0.05, attackMs: 1, decayMs: 38, highpassHz: 1800, lowpassHz: 6200 },
            { kind: 'tone', wave: 'square', startHz: 580, endHz: 320, gain: 0.032, attackMs: 1, decayMs: 48, bandpassHz: 1100, q: 1.2 }
        ]
    },
    menuProjectile: {
        cooldownMs: 60,
        baseVolume: 0.46,
        layers: [
            { kind: 'noise', gain: 0.045, attackMs: 1, decayMs: 34, highpassHz: 1600, lowpassHz: 5000 },
            { kind: 'tone', wave: 'square', startHz: 440, endHz: 220, gain: 0.025, attackMs: 1, decayMs: 28, bandpassHz: 980, q: 1.0 }
        ]
    },
    attackSoldier: COMBAT_RECIPES.soldier,
    attackSniper: COMBAT_RECIPES.sniper,
    attackRocketeer: COMBAT_RECIPES.rocketeer,
    attackDestroyer: COMBAT_RECIPES.destroyer,
    attackPirateShip: COMBAT_RECIPES.pirate_ship,
    attackTank: COMBAT_RECIPES.tank,
    attackHumvee: COMBAT_RECIPES.humvee,
    attackMissileLauncher: COMBAT_RECIPES.missile_launcher,
    attackLightPlane: COMBAT_RECIPES.light_plane,
    attackHeavyPlane: COMBAT_RECIPES.heavy_plane,
    attackAircraftCarrier: COMBAT_RECIPES.aircraft_carrier,
    attackMothership: COMBAT_RECIPES.mothership,
    attackTower: COMBAT_RECIPES.tower,
    attackBase: COMBAT_RECIPES.base,
    attackTesla: COMBAT_RECIPES.tesla,
    attackUnknown: COMBAT_RECIPES.unknown,
    buildBarracks: BUILDING_RECIPES.barracks,
    buildMine: BUILDING_RECIPES.mine,
    buildTower: BUILDING_RECIPES.tower,
    buildDock: BUILDING_RECIPES.dock,
    buildBase: BUILDING_RECIPES.base,
    buildOilRig: BUILDING_RECIPES.oil_rig,
    buildOilWell: BUILDING_RECIPES.oil_well,
    buildWall: BUILDING_RECIPES.wall,
    buildBridgeNode: BUILDING_RECIPES.bridge_node,
    buildWallNode: BUILDING_RECIPES.wall_node,
    buildFarm: BUILDING_RECIPES.farm,
    buildTankFactory: BUILDING_RECIPES.tank_factory,
    buildAirBase: BUILDING_RECIPES.air_base,
    buildHospital: BUILDING_RECIPES.hospital,
    buildRepairDock: BUILDING_RECIPES.repair_dock,
    buildNavalMine: BUILDING_RECIPES.naval_mine
};

const BUTTON_VARIANT_SELECTORS: Array<{ variant: ButtonSoundVariant; selector: string }> = [
    { variant: 'danger', selector: '.danger, .btn-danger, .hud-btn-menu, .game-over-btn.return' },
    { variant: 'secondary', selector: '.secondary, .stats-control-btn, .settings-tab-btn, .key-bind-btn' }
];

const PLACEMENT_RELATION_VOLUME: Record<PlacementOwnership, number> = {
    self: 1,
    enemy: 0.84,
    neutral: 0.74
};

class SoundEffectsManager {
    private context: AudioContext | null = null;
    private outputNode: AudioNode | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private lastPlayedAt = new Map<string, number>();

    private get audioContextConstructor():
        | (new () => AudioContext)
        | undefined {
        const audioWindow = window as Window & typeof globalThis & {
            webkitAudioContext?: new () => AudioContext;
        };

        return audioWindow.AudioContext || audioWindow.webkitAudioContext;
    }

    private ensureContext(): AudioContext | null {
        if (this.context && this.outputNode) {
            return this.context;
        }

        const AudioContextCtor = this.audioContextConstructor;
        if (!AudioContextCtor) {
            return null;
        }

        const context = new AudioContextCtor();
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 2.5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.22;
        compressor.connect(context.destination);

        this.context = context;
        this.outputNode = compressor;
        return context;
    }

    async resume() {
        const context = this.ensureContext();
        if (!context) {
            return;
        }

        if (context.state === 'suspended') {
            try {
                await context.resume();
            } catch (error) {
                console.warn('[SFX] Failed to resume audio context.', error);
            }
        }
    }

    private getNoiseBuffer(context: AudioContext): AudioBuffer {
        if (this.noiseBuffer && this.noiseBuffer.sampleRate === context.sampleRate) {
            return this.noiseBuffer;
        }

        const length = context.sampleRate;
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < length; index += 1) {
            data[index] = (Math.random() * 2 - 1) * (1 - index / length * 0.4);
        }

        this.noiseBuffer = buffer;
        return buffer;
    }

    getEffectVolume(effectId: SfxEffectId, baseVolume = 1) {
        const settings = settingsManager.getSettings();
        const effectLevel = settings.audio.sfxEffectLevels[effectId] ?? 1;
        return clamp(settings.audio.masterVolume * settings.audio.sfxVolume * effectLevel * baseVolume, 0, 1);
    }

    private getSpatialMix(spatial?: SpatialSoundLocation) {
        if (!spatial) {
            return { gain: 1, pan: 0 };
        }

        const zoom = spatial.zoom && Number.isFinite(spatial.zoom) ? Math.max(spatial.zoom, 0.25) : 1;
        const worldWidth = Math.max(spatial.viewportWidth / zoom, 1);
        const worldHeight = Math.max(spatial.viewportHeight / zoom, 1);
        const dx = spatial.x - spatial.listenerX;
        const dy = spatial.y - spatial.listenerY;
        const normalisedX = clamp(dx / (worldWidth * 0.65), -1, 1);
        const normalisedY = clamp(dy / (worldHeight * 0.65), -1, 1);
        const distance = Math.hypot(normalisedX, normalisedY);
        const gain = clamp(1.08 - distance * 0.54, 0.16, 1);

        return {
            gain,
            pan: clamp(normalisedX * 0.9, -0.95, 0.95)
        };
    }

    private shouldThrottle(key: string, cooldownMs: number) {
        const now = performance.now();
        const previous = this.lastPlayedAt.get(key) ?? -Infinity;
        if (now - previous < cooldownMs) {
            return true;
        }

        this.lastPlayedAt.set(key, now);
        return false;
    }

    private wireLayerFilters<T extends SoundLayer>(
        context: AudioContext,
        source: AudioNode,
        layer: T
    ) {
        let current: AudioNode = source;

        if (layer.bandpassHz) {
            const filter = context.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = layer.bandpassHz;
            filter.Q.value = layer.q ?? 1;
            current.connect(filter);
            current = filter;
        } else {
            if (layer.highpassHz) {
                const filter = context.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = layer.highpassHz;
                filter.Q.value = layer.q ?? 0.8;
                current.connect(filter);
                current = filter;
            }

            if (layer.lowpassHz) {
                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = layer.lowpassHz;
                filter.Q.value = layer.q ?? 0.7;
                current.connect(filter);
                current = filter;
            }
        }

        return current;
    }

    private scheduleLayer(
        context: AudioContext,
        target: AudioNode,
        layer: SoundLayer,
        startAt: number
    ) {
        const gainNode = context.createGain();
        gainNode.gain.setValueAtTime(EPSILON_GAIN, startAt);

        const attack = Math.max((layer.attackMs ?? 1) / 1000, 0.001);
        const releaseAt = startAt + Math.max(layer.decayMs / 1000, attack + 0.001);
        gainNode.gain.linearRampToValueAtTime(Math.max(layer.gain, EPSILON_GAIN), startAt + attack);
        gainNode.gain.exponentialRampToValueAtTime(EPSILON_GAIN, releaseAt);
        gainNode.connect(target);

        if (layer.kind === 'tone') {
            const oscillator = context.createOscillator();
            oscillator.type = layer.wave;
            oscillator.frequency.setValueAtTime(layer.startHz, startAt);
            if (typeof layer.endHz === 'number' && layer.endHz > 0 && layer.endHz !== layer.startHz) {
                oscillator.frequency.exponentialRampToValueAtTime(Math.max(layer.endHz, 20), releaseAt);
            }
            if (typeof layer.detune === 'number') {
                oscillator.detune.value = layer.detune;
            }

            const filtered = this.wireLayerFilters(context, oscillator, layer);
            filtered.connect(gainNode);
            oscillator.start(startAt);
            oscillator.stop(releaseAt + 0.02);
        } else {
            const source = context.createBufferSource();
            source.buffer = this.getNoiseBuffer(context);
            source.loop = true;
            if (typeof layer.playbackRate === 'number') {
                source.playbackRate.value = layer.playbackRate;
            }

            const filtered = this.wireLayerFilters(context, source, layer);
            filtered.connect(gainNode);
            source.start(startAt);
            source.stop(releaseAt + 0.02);
        }

        return releaseAt - startAt;
    }

    private playRecipe(
        effectId: SfxEffectId,
        recipeKey: string,
        recipe: SoundRecipe,
        spatial?: SpatialSoundLocation,
        volumeMultiplier = 1
    ) {
        if (recipe.layers.length === 0 || this.shouldThrottle(recipeKey, recipe.cooldownMs)) {
            return;
        }

        const context = this.ensureContext();
        if (!context || !this.outputNode) {
            return;
        }

        const effectiveVolume = this.getEffectVolume(effectId, recipe.baseVolume * volumeMultiplier);
        if (effectiveVolume <= 0) {
            return;
        }

        if (context.state === 'suspended') {
            void context.resume().catch(() => undefined);
        }

        const spatialMix = this.getSpatialMix(spatial);
        const instanceGain = context.createGain();
        instanceGain.gain.value = effectiveVolume * spatialMix.gain;

        let tailNode: AudioNode = instanceGain;
        if ('createStereoPanner' in context) {
            const panner = context.createStereoPanner();
            panner.pan.value = spatialMix.pan;
            instanceGain.connect(panner);
            tailNode = panner;
        }

        tailNode.connect(this.outputNode);

        const startAt = context.currentTime + 0.001;
        let longestLayer = 0;
        recipe.layers.forEach(layer => {
            const offset = (layer.startMs ?? 0) / 1000;
            longestLayer = Math.max(longestLayer, offset + this.scheduleLayer(context, instanceGain, layer, startAt + offset));
        });

        window.setTimeout(() => {
            try {
                tailNode.disconnect();
                instanceGain.disconnect();
            } catch {
                // Nodes may already be gone; safe to ignore.
            }
        }, Math.ceil((longestLayer + 0.15) * 1000));
    }

    playButtonClick(variant: ButtonSoundVariant = 'primary') {
        const recipe = BUTTON_RECIPES[variant];
        const effectId = BUTTON_VARIANT_TO_EFFECT_ID[variant];
        this.playRecipe(effectId, `button:${variant}`, recipe);
    }

    playUnitFire(source: CombatSoundSource, spatial?: SpatialSoundLocation) {
        const recipe = COMBAT_RECIPES[source] ?? COMBAT_RECIPES.unknown;
        const effectId = COMBAT_SOURCE_TO_EFFECT_ID[source] ?? 'attackUnknown';
        this.playRecipe(effectId, `combat:${source}`, recipe, spatial);
    }

    playBuildingPlacement(type: Building['type'], ownership: PlacementOwnership, spatial?: SpatialSoundLocation) {
        const recipe = BUILDING_RECIPES[type];
        const effectId = BUILDING_TYPE_TO_EFFECT_ID[type];
        this.playRecipe(effectId, `placement:${type}:${ownership}`, recipe, spatial, PLACEMENT_RELATION_VOLUME[ownership]);
    }

    playSfxPreview(effectId: SfxEffectId = 'uiButtonPrimary') {
        const recipe = EFFECT_PREVIEW_RECIPES[effectId] ?? BUTTON_RECIPES.primary;
        this.playRecipe(effectId, `preview:${effectId}`, recipe);
    }

    getButtonVariant(element: HTMLElement): ButtonSoundVariant {
        const matched = BUTTON_VARIANT_SELECTORS.find(entry => element.matches(entry.selector));
        return matched?.variant ?? 'primary';
    }
}

export const soundEffectsManager = new SoundEffectsManager();
