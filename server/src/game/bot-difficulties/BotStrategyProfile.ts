export type BotMatchPhase = 'EARLY' | 'MID' | 'LATE';
export type BotDifficultyBand = 'easy' | 'medium' | 'hard' | 'insane';
export type CapitalShipTiming = 'RARE_LATE' | 'LATE' | 'MID_LATE' | 'MID';

export interface BotStrategyProfile {
    level: number;
    controllerId: string;
    category: BotDifficultyBand;
    resourceClaims: number;
    towers: number;
    wallNodes: number;
    recruitmentBuildings: number;
    airBases: number;
    builderCap: number;
    dockCount: number;
    factoryCount: number;
    minCombatUnits: number;
    openingCombatTarget: number;
    openingFleetTarget: number;
    coordinationWeight: number;
    aggressionWeight: number;
    capitalShipTiming: CapitalShipTiming;
}

const BOT_PROFILE_DEFAULTS: Array<Omit<BotStrategyProfile, 'controllerId'>> = [
    {
        level: 1,
        category: 'easy',
        resourceClaims: 1,
        towers: 1,
        wallNodes: 4,
        recruitmentBuildings: 1,
        airBases: 0,
        builderCap: 2,
        dockCount: 1,
        factoryCount: 0,
        minCombatUnits: 5,
        openingCombatTarget: 2,
        openingFleetTarget: 0,
        coordinationWeight: 0.15,
        aggressionWeight: 0.8,
        capitalShipTiming: 'RARE_LATE'
    },
    {
        level: 2,
        category: 'easy',
        resourceClaims: 2,
        towers: 2,
        wallNodes: 5,
        recruitmentBuildings: 2,
        airBases: 0,
        builderCap: 3,
        dockCount: 1,
        factoryCount: 1,
        minCombatUnits: 7,
        openingCombatTarget: 3,
        openingFleetTarget: 0,
        coordinationWeight: 0.25,
        aggressionWeight: 0.95,
        capitalShipTiming: 'RARE_LATE'
    },
    {
        level: 3,
        category: 'easy',
        resourceClaims: 3,
        towers: 3,
        wallNodes: 6,
        recruitmentBuildings: 2,
        airBases: 1,
        builderCap: 3,
        dockCount: 2,
        factoryCount: 1,
        minCombatUnits: 8,
        openingCombatTarget: 4,
        openingFleetTarget: 0,
        coordinationWeight: 0.35,
        aggressionWeight: 1.1,
        capitalShipTiming: 'RARE_LATE'
    },
    {
        level: 4,
        category: 'medium',
        resourceClaims: 3,
        towers: 3,
        wallNodes: 6,
        recruitmentBuildings: 3,
        airBases: 1,
        builderCap: 4,
        dockCount: 2,
        factoryCount: 2,
        minCombatUnits: 10,
        openingCombatTarget: 5,
        openingFleetTarget: 0,
        coordinationWeight: 0.45,
        aggressionWeight: 1.2,
        capitalShipTiming: 'LATE'
    },
    {
        level: 5,
        category: 'medium',
        resourceClaims: 4,
        towers: 4,
        wallNodes: 7,
        recruitmentBuildings: 3,
        airBases: 1,
        builderCap: 4,
        dockCount: 3,
        factoryCount: 2,
        minCombatUnits: 11,
        openingCombatTarget: 6,
        openingFleetTarget: 1,
        coordinationWeight: 0.55,
        aggressionWeight: 1.32,
        capitalShipTiming: 'LATE'
    },
    {
        level: 6,
        category: 'medium',
        resourceClaims: 4,
        towers: 4,
        wallNodes: 8,
        recruitmentBuildings: 4,
        airBases: 2,
        builderCap: 5,
        dockCount: 3,
        factoryCount: 3,
        minCombatUnits: 12,
        openingCombatTarget: 7,
        openingFleetTarget: 1,
        coordinationWeight: 0.66,
        aggressionWeight: 1.45,
        capitalShipTiming: 'LATE'
    },
    {
        level: 7,
        category: 'hard',
        resourceClaims: 5,
        towers: 5,
        wallNodes: 9,
        recruitmentBuildings: 4,
        airBases: 2,
        builderCap: 5,
        dockCount: 4,
        factoryCount: 3,
        minCombatUnits: 13,
        openingCombatTarget: 8,
        openingFleetTarget: 2,
        coordinationWeight: 0.78,
        aggressionWeight: 1.6,
        capitalShipTiming: 'MID_LATE'
    },
    {
        level: 8,
        category: 'hard',
        resourceClaims: 5,
        towers: 6,
        wallNodes: 10,
        recruitmentBuildings: 5,
        airBases: 2,
        builderCap: 6,
        dockCount: 4,
        factoryCount: 4,
        minCombatUnits: 14,
        openingCombatTarget: 9,
        openingFleetTarget: 2,
        coordinationWeight: 0.9,
        aggressionWeight: 1.78,
        capitalShipTiming: 'MID_LATE'
    },
    {
        level: 9,
        category: 'hard',
        resourceClaims: 6,
        towers: 7,
        wallNodes: 11,
        recruitmentBuildings: 5,
        airBases: 3,
        builderCap: 6,
        dockCount: 5,
        factoryCount: 5,
        minCombatUnits: 15,
        openingCombatTarget: 10,
        openingFleetTarget: 3,
        coordinationWeight: 1.02,
        aggressionWeight: 1.95,
        capitalShipTiming: 'MID_LATE'
    },
    {
        level: 10,
        category: 'insane',
        resourceClaims: 6,
        towers: 8,
        wallNodes: 12,
        recruitmentBuildings: 5,
        airBases: 3,
        builderCap: 6,
        dockCount: 5,
        factoryCount: 5,
        minCombatUnits: 16,
        openingCombatTarget: 11,
        openingFleetTarget: 3,
        coordinationWeight: 1.15,
        aggressionWeight: 2.15,
        capitalShipTiming: 'MID'
    }
];

export function createBotStrategyProfile(
    level: number,
    overrides: Partial<BotStrategyProfile> = {}
): BotStrategyProfile {
    const index = Math.max(0, Math.min(BOT_PROFILE_DEFAULTS.length - 1, level - 1));
    const defaults = BOT_PROFILE_DEFAULTS[index];
    return {
        ...defaults,
        controllerId: overrides.controllerId || `difficulty-${defaults.level}`,
        ...overrides,
        level: defaults.level
    };
}

export function getFallbackBotStrategyProfile(level: number): BotStrategyProfile {
    return createBotStrategyProfile(level);
}

export function resolveBotMatchPhase(elapsedMs: number): BotMatchPhase {
    if (elapsedMs < 2 * 60 * 1000) return 'EARLY';
    if (elapsedMs < 5 * 60 * 1000) return 'MID';
    return 'LATE';
}

export function canDeployCapitalShips(timing: CapitalShipTiming, phase: BotMatchPhase): boolean {
    if (timing === 'MID') return phase === 'MID' || phase === 'LATE';
    if (timing === 'MID_LATE') return phase === 'MID' || phase === 'LATE';
    if (timing === 'LATE') return phase === 'LATE';
    return phase === 'LATE';
}
