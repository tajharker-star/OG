export type SfxEffectGroupId = 'ui' | 'orders' | 'combat' | 'building';

export interface SfxEffectDefinition {
    id: string;
    label: string;
    group: SfxEffectGroupId;
    defaultLevel: number;
}

export const SFX_GROUP_DEFINITIONS = [
    { id: 'ui', label: 'Interface Clicks' },
    { id: 'orders', label: 'Orders & Alerts' },
    { id: 'combat', label: 'Weapons & Combat' },
    { id: 'building', label: 'Building Placement' },
] as const satisfies ReadonlyArray<{ id: SfxEffectGroupId; label: string }>;

export const SFX_EFFECT_DEFINITIONS = [
    { id: 'uiButtonPrimary', label: 'Primary buttons', group: 'ui', defaultLevel: 1 },
    { id: 'uiButtonSecondary', label: 'Secondary buttons', group: 'ui', defaultLevel: 1 },
    { id: 'uiButtonDanger', label: 'Danger buttons', group: 'ui', defaultLevel: 1 },

    { id: 'moveLand', label: 'Land move orders', group: 'orders', defaultLevel: 1 },
    { id: 'moveWater', label: 'Naval move orders', group: 'orders', defaultLevel: 1 },
    { id: 'moveAir', label: 'Air move orders', group: 'orders', defaultLevel: 1 },
    { id: 'recruit', label: 'Unit recruitment', group: 'orders', defaultLevel: 1 },
    { id: 'explosion', label: 'Explosions', group: 'orders', defaultLevel: 1 },
    { id: 'damageAlertHq', label: 'HQ damage alert', group: 'orders', defaultLevel: 1 },
    { id: 'damageAlertBuilding', label: 'Building damage alert', group: 'orders', defaultLevel: 1 },
    { id: 'menuProjectile', label: 'Menu background shots', group: 'orders', defaultLevel: 1 },

    { id: 'attackSoldier', label: 'Soldier fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackSniper', label: 'Sniper fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackRocketeer', label: 'Rocketeer fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackDestroyer', label: 'Destroyer fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackPirateShip', label: 'Pirate ship fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackTank', label: 'Tank fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackHumvee', label: 'Humvee fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackMissileLauncher', label: 'Missile launcher fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackLightPlane', label: 'Light plane fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackHeavyPlane', label: 'Heavy plane fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackAircraftCarrier', label: 'Aircraft carrier fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackMothership', label: 'Mothership beam', group: 'combat', defaultLevel: 1 },
    { id: 'attackTower', label: 'Tower fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackBase', label: 'HQ defense fire', group: 'combat', defaultLevel: 1 },
    { id: 'attackTesla', label: 'Tesla beam', group: 'combat', defaultLevel: 1 },
    { id: 'attackUnknown', label: 'Fallback attack', group: 'combat', defaultLevel: 1 },

    { id: 'buildBarracks', label: 'Barracks placement', group: 'building', defaultLevel: 1 },
    { id: 'buildMine', label: 'Mine placement', group: 'building', defaultLevel: 1 },
    { id: 'buildTower', label: 'Tower placement', group: 'building', defaultLevel: 1 },
    { id: 'buildDock', label: 'Dock placement', group: 'building', defaultLevel: 1 },
    { id: 'buildBase', label: 'HQ placement', group: 'building', defaultLevel: 1 },
    { id: 'buildOilRig', label: 'Oil rig placement', group: 'building', defaultLevel: 1 },
    { id: 'buildOilWell', label: 'Oil well placement', group: 'building', defaultLevel: 1 },
    { id: 'buildWall', label: 'Wall placement', group: 'building', defaultLevel: 1 },
    { id: 'buildBridgeNode', label: 'Bridge node placement', group: 'building', defaultLevel: 1 },
    { id: 'buildWallNode', label: 'Wall node placement', group: 'building', defaultLevel: 1 },
    { id: 'buildFarm', label: 'Farm placement', group: 'building', defaultLevel: 1 },
    { id: 'buildTankFactory', label: 'Tank factory placement', group: 'building', defaultLevel: 1 },
    { id: 'buildAirBase', label: 'Air base placement', group: 'building', defaultLevel: 1 },
    { id: 'buildHospital', label: 'Hospital placement', group: 'building', defaultLevel: 1 },
    { id: 'buildRepairDock', label: 'Repair dock placement', group: 'building', defaultLevel: 1 },
    { id: 'buildNavalMine', label: 'Naval mine placement', group: 'building', defaultLevel: 1 },
] as const satisfies ReadonlyArray<SfxEffectDefinition>;

export type SfxEffectId = typeof SFX_EFFECT_DEFINITIONS[number]['id'];
export type SfxEffectLevels = Record<SfxEffectId, number>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const createDefaultSfxEffectLevels = (): SfxEffectLevels => {
    const entries = SFX_EFFECT_DEFINITIONS.map(definition => [definition.id, definition.defaultLevel]);
    return Object.fromEntries(entries) as SfxEffectLevels;
};

export const normalizeSfxEffectLevels = (value: unknown): SfxEffectLevels => {
    const defaults = createDefaultSfxEffectLevels();

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaults;
    }

    const source = value as Record<string, unknown>;
    const next: SfxEffectLevels = { ...defaults };

    SFX_EFFECT_DEFINITIONS.forEach(definition => {
        const candidate = source[definition.id];
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            next[definition.id] = clamp(candidate, 0, 1);
        }
    });

    return next;
};
