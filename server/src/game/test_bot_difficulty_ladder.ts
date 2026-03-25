import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { GameState } from './GameState';
import { createBotAI } from './BotAIFactory';
import { BuildingData, UnitData } from './data/Registry';
import { GameMap, Island, OilSpot } from './MapGenerator';

type DuelMapType = 'desert' | 'grasslands' | 'islands';
type DuelResult = {
    lowerDifficulty: number;
    higherDifficulty: number;
    mapType: DuelMapType;
    seed: number;
    winnerDifficulty: number | null;
    winnerPlayerId: string | null;
    loserPlayerId: string | null;
    method: 'base_destroyed' | 'timeout' | 'double_base_loss';
    elapsedMs: number;
    maxDurationMs: number;
    lowerBaseAlive: boolean;
    higherBaseAlive: boolean;
    finalSnapshot: {
        lower: PlayerSnapshot;
        higher: PlayerSnapshot;
    };
    timeoutSnapshot?: {
        lower: PlayerSnapshot;
        higher: PlayerSnapshot;
    };
    roundStats: {
        lowerGold: number | null;
        higherGold: number | null;
        lowerOil: number | null;
        higherOil: number | null;
        lowerBaseDestroyed: boolean;
        higherBaseDestroyed: boolean;
    };
};

type PairSummary = {
    lowerDifficulty: number;
    higherDifficulty: number;
    matches: number;
    higherWins: number;
    lowerWins: number;
    timeouts: number;
    doubleBaseLosses: number;
    higherBaseKills: number;
    lowerBaseKills: number;
    avgLowerGold: number;
    avgHigherGold: number;
    avgLowerOil: number;
    avgHigherOil: number;
    higherWinRate: number;
    pass: boolean;
};

type LadderRun = {
    summary: PairSummary[];
    results: DuelResult[];
};

type PlayerSnapshot = {
    playerId: string;
    baseHealth: number | null;
    resources: {
        gold: number;
        oil: number;
    } | null;
    totalUnits: number;
    combatUnits: number;
    statuses: Record<string, number>;
    buildings: Record<string, number>;
    bridges: Record<string, number>;
    units: Record<string, number>;
    queues: {
        buildings: Record<string, number>;
        units: Record<string, number>;
    };
    botState: {
        currentGoal: string | null;
        phase: string | null;
        lastDecision: string | null;
        lastDecisionScore?: number | null;
        defenceReserveGold: number | null;
        strategyProfile: any;
        progression: any;
        production?: any;
        aggressionState: any;
        logCounts: Record<string, number>;
        recentLogs: any[];
        attackManager: {
            state: string | null;
            armySize: number | null;
            requiredSize: number | null;
            targetId: string | null;
            targetType: string | null;
            targetPos: any;
            rally: any;
            timeSinceAttack: number | null;
            blockReason?: string | null;
            stateTimeSec?: number | null;
            lastOrderSec?: number | null;
            ordersIssued?: number | null;
            ordersApplied?: number | null;
            lastOrderBlocked?: boolean | null;
            lastPathOk?: boolean | null;
            lastTransitionReason?: string | null;
            fortificationHpEstimate?: number | null;
            requiredAssaultPower?: number | null;
            rosterAssaultPower?: number | null;
            requiredUnitsFromPower?: number | null;
        } | null;
    } | null;
};

function circleIsland(
    id: string,
    x: number,
    y: number,
    radius: number,
    type: Island['type'],
    ownerId?: string
): Island {
    return {
        id,
        x,
        y,
        radius,
        type,
        ownerId,
        buildings: [],
        goldSpots: [
            { id: `${id}_gold_0`, x: -120, y: 70 },
            { id: `${id}_gold_1`, x: -20, y: -80 },
            { id: `${id}_gold_2`, x: 80, y: 35 },
            { id: `${id}_gold_3`, x: 150, y: -35 }
        ]
    };
}

function addBase(island: Island, ownerId: string, relX: number, relY: number, healthScale: number = 1) {
    const scaledHealth = Math.max(400, Math.round(BuildingData.base.maxHealth * healthScale));
    island.buildings.push({
        id: `base_${ownerId}_${island.id}`,
        type: 'base',
        level: 1,
        health: scaledHealth,
        maxHealth: scaledHealth,
        x: relX,
        y: relY,
        ownerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.base.range
    });
}

function addBuilders(gameState: GameState, island: Island, ownerId: string, count: number) {
    const positions = [
        { x: 30, y: 0 },
        { x: 60, y: 30 },
        { x: -20, y: -40 },
        { x: 100, y: -20 }
    ];

    for (let i = 0; i < count; i++) {
        const pos = positions[i % positions.length];
        gameState.units.push({
            id: `builder_${ownerId}_${i}`,
            ownerId,
            type: 'builder',
            x: island.x + pos.x,
            y: island.y + pos.y,
            status: 'idle',
            health: UnitData.builder.maxHealth,
            maxHealth: UnitData.builder.maxHealth,
            damage: UnitData.builder.damage,
            range: UnitData.builder.range,
            speed: 120,
            fireRate: UnitData.builder.fireRate
        });
    }
}

function createDuelMap(mapType: DuelMapType, seed: number, lowerId: string, higherId: string): GameMap {
    const offset = (seed % 2) * 40;

    if (mapType === 'islands') {
        const lowerIsland = circleIsland('lower_home', 860, 760, 210, 'grasslands', lowerId);
        const higherIsland = circleIsland('higher_home', 1340, 760, 210, 'grasslands', higherId);

        // Keep islands duels naval-decisive: place HQs on the enemy-facing coastline.
        addBase(lowerIsland, lowerId, 165 + Math.floor(offset * 0.5), 0, 0.55);
        addBase(higherIsland, higherId, -165 - Math.floor(offset * 0.5), 0, 0.55);

        const oilSpots: OilSpot[] = [
            { id: 'island_oil_lower', x: 1085, y: 760, radius: 35 },
            { id: 'island_oil_higher', x: 1115, y: 760, radius: 35 },
            { id: 'island_oil_mid_0', x: 1100, y: 640, radius: 35 }
        ];

        return {
            width: 2300,
            height: 1500,
            islands: [lowerIsland, higherIsland],
            oilSpots,
            bridges: [],
            mapType
        };
    }

    if (mapType === 'desert') {
        const floor = circleIsland('desert_floor', 1100, 760, 760, 'desert');
        addBase(floor, lowerId, -320 + offset, 0);
        addBase(floor, higherId, 320 - offset, 0);

        floor.goldSpots.push(
            { id: 'desert_center_gold_0', x: -10, y: 120 },
            { id: 'desert_center_gold_1', x: 30, y: -140 }
        );

        const oilSpots: OilSpot[] = [
            { id: 'desert_oil_lower', x: floor.x - 220, y: floor.y + 140, radius: 35 },
            { id: 'desert_oil_higher', x: floor.x + 220, y: floor.y - 140, radius: 35 },
            { id: 'desert_oil_mid', x: floor.x, y: floor.y + 10, radius: 35 }
        ];

        return {
            width: 2200,
            height: 1500,
            islands: [floor],
            oilSpots,
            bridges: [],
            mapType
        };
    }

    const lowerIsland = circleIsland('lower_island', 620, 760, 360, 'grasslands', lowerId);
    const higherIsland = circleIsland('higher_island', 1580, 760, 360, 'grasslands', higherId);
    const centerIsland = circleIsland('center_island', 1100, 760, 250, 'grasslands');
    addBase(lowerIsland, lowerId, -50 + offset, 0);
    addBase(higherIsland, higherId, 50 - offset, 0);

    const oilSpots: OilSpot[] = [
        { id: 'grass_oil_lower', x: lowerIsland.x + lowerIsland.radius + 70, y: lowerIsland.y - 10, radius: 35 },
        { id: 'grass_oil_higher', x: higherIsland.x - higherIsland.radius - 70, y: higherIsland.y + 10, radius: 35 },
        { id: 'grass_oil_center_a', x: centerIsland.x - 90, y: centerIsland.y + 70, radius: 35 },
        { id: 'grass_oil_center_b', x: centerIsland.x + 90, y: centerIsland.y - 70, radius: 35 }
    ];

    return {
        width: 2300,
        height: 1500,
        islands: [lowerIsland, higherIsland, centerIsland],
        oilSpots,
        bridges: [],
        mapType
    };
}

function createIo() {
    return {
        to() {
            return {
                emit() {
                    return undefined;
                }
            };
        }
    };
}

function createSeededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function applyFastTimings() {
    const buildingKeys = [
        'mine',
        'tower',
        'wall_node',
        'dock',
        'barracks',
        'tank_factory',
        'air_base',
        'oil_well',
        'oil_rig'
    ] as const;
    const unitKeys = [
        'builder',
        'soldier',
        'rocketeer',
        'tank',
        'missile_launcher',
        'construction_ship',
        'destroyer',
        'light_plane',
        'heavy_plane',
        'aircraft_carrier',
        'mothership'
    ] as const;

    const buildingOriginals = new Map<string, number>();
    const unitOriginals = new Map<string, number>();

    buildingKeys.forEach(key => {
        const current = BuildingData[key].constructionTime ?? 100;
        buildingOriginals.set(key, current);
        BuildingData[key].constructionTime = Math.max(6, Math.min(current, 18));
    });

    unitKeys.forEach(key => {
        const current = UnitData[key].constructionTime ?? 100;
        unitOriginals.set(key, current);
        UnitData[key].constructionTime = Math.max(6, Math.min(current, 20));
    });

    return () => {
        buildingKeys.forEach(key => {
            const original = buildingOriginals.get(key);
            if (original !== undefined) BuildingData[key].constructionTime = original;
        });
        unitKeys.forEach(key => {
            const original = unitOriginals.get(key);
            if (original !== undefined) UnitData[key].constructionTime = original;
        });
    };
}

function accelerateBot(bot: any) {
    const apmScale = 5;
    bot.actionInterval = Math.max(40, Math.floor(bot.actionInterval * 0.2));
    bot.minBuildDelay = Math.max(0, Math.floor(bot.minBuildDelay * 0.1));
    bot.maxBuildDelay = Math.max(bot.minBuildDelay, Math.floor(bot.maxBuildDelay * 0.1));
    bot.currentBuildDelay = 0;
    bot.timeToAirPhase = Math.max(1500, Math.floor(bot.timeToAirPhase * 0.015));
    bot.maxApmTokens = Math.max(20, Math.floor(bot.maxApmTokens * apmScale));
    bot.apmTokens = bot.maxApmTokens;
    const attackStartFloor =
        bot.difficulty <= 3 ? 10 :
        bot.difficulty <= 6 ? 8 :
        bot.difficulty <= 8 ? 7 : 6;
    bot.attackManager.attackStartTimeSec = Math.max(attackStartFloor, Math.floor(bot.attackManager.attackStartTimeSec * 0.12));
    bot.attackManager.minArmySize = Math.max(2, Math.floor(bot.attackManager.minArmySize * 0.5));
}

function parseDifficultyPairs(rawPairs: string | undefined): number[] {
    if (!rawPairs?.trim()) {
        return Array.from({ length: 9 }, (_, index) => index + 1);
    }

    return rawPairs
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isFinite(value) && value >= 1 && value <= 9)
        .sort((a, b) => a - b);
}

function parseMaps(rawMaps: string | undefined): DuelMapType[] {
    const validMaps: DuelMapType[] = ['desert', 'grasslands', 'islands'];
    if (!rawMaps?.trim()) {
        return validMaps;
    }

    const requestedMaps = rawMaps
        .split(',')
        .map(value => value.trim())
        .filter((value): value is DuelMapType => validMaps.includes(value as DuelMapType));

    return requestedMaps.length > 0 ? requestedMaps : validMaps;
}

function parseSeeds(rawSeeds: string | undefined): number[] {
    if (!rawSeeds?.trim()) {
        return [1001, 2002];
    }

    const parsed = rawSeeds
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isFinite(value));

    return parsed.length > 0 ? parsed : [1001, 2002];
}

function hasLivingBase(gameState: GameState, playerId: string): boolean {
    return gameState.map.islands.some(island =>
        island.buildings.some(building => building.ownerId === playerId && building.type === 'base' && building.health > 0)
    );
}

function countByType(items: Array<{ type: string }>, playerId?: string, ownerAccessor?: (item: any) => string | undefined) {
    const counts: Record<string, number> = {};
    items.forEach(item => {
        const ownerId = ownerAccessor ? ownerAccessor(item) : undefined;
        if (playerId && ownerId !== playerId) return;
        counts[item.type] = (counts[item.type] || 0) + 1;
    });
    return counts;
}

function snapshotPlayer(gameState: GameState, playerId: string): PlayerSnapshot {
    const player = gameState.players.get(playerId) || null;
    const bot = (gameState.bots as any[]).find(candidate => candidate.playerId === playerId) || null;
    const playerUnits = gameState.units.filter(unit => unit.ownerId === playerId);
    const unitCounts = countByType(playerUnits);
    const statusCounts: Record<string, number> = {};
    playerUnits.forEach(unit => {
        const key = unit.status || 'unknown';
        statusCounts[key] = (statusCounts[key] || 0) + 1;
    });
    const queuedBuildingUnits: Record<string, number> = {};
    const queuedMobileUnits: Record<string, number> = {};
    const buildingEntries = gameState.map.islands.flatMap(island =>
        island.buildings.filter(building => building.ownerId === playerId)
    );
    buildingEntries.forEach(building => {
        if (!building.recruitmentQueue || building.recruitmentQueue.length === 0) return;
        queuedBuildingUnits[building.type] = (queuedBuildingUnits[building.type] || 0) + building.recruitmentQueue.length;
    });
    const buildingCounts = countByType(buildingEntries);
    const bridgeCounts = countByType(
        gameState.map.bridges.filter(bridge => bridge.ownerId === playerId)
    );
    const oilBuildings = gameState.map.oilSpots
        .map(spot => (spot as any).building)
        .filter((building): building is { type: string; ownerId?: string } => !!building && building.ownerId === playerId);
    oilBuildings.forEach(building => {
        buildingCounts[building.type] = (buildingCounts[building.type] || 0) + 1;
    });

    const base = buildingEntries.find(building => building.type === 'base');
    const combatUnits = playerUnits.filter(
        unit => !['builder', 'construction_ship', 'oil_seeker', 'ferry'].includes(unit.type)
    ).length;
    playerUnits.forEach(unit => {
        if (!unit.recruitmentQueue || unit.recruitmentQueue.length === 0) return;
        queuedMobileUnits[unit.type] = (queuedMobileUnits[unit.type] || 0) + unit.recruitmentQueue.length;
    });

    const attackManagerState = bot?.debugState?.attackManager
        ? {
              state: bot.debugState.attackManager.state || null,
              armySize: bot.debugState.attackManager.armySize ?? null,
              requiredSize: bot.debugState.attackManager.requiredSize ?? null,
              targetId: bot.debugState.attackManager.targetId || null,
              targetType: bot.debugState.attackManager.targetType || null,
              targetPos: bot.debugState.attackManager.targetPos || null,
              rally: bot.debugState.attackManager.rally || null,
              timeSinceAttack: bot.debugState.attackManager.timeSinceAttack ?? null,
              blockReason: bot.debugState.attackManager.blockReason ?? null,
              stateTimeSec: bot.debugState.attackManager.stateTimeSec ?? null,
              lastOrderSec: bot.debugState.attackManager.lastOrderSec ?? null,
              ordersIssued: bot.debugState.attackManager.ordersIssued ?? null,
                  ordersApplied: bot.debugState.attackManager.ordersApplied ?? null,
                  lastOrderBlocked: bot.debugState.attackManager.lastOrderBlocked ?? null,
                  lastPathOk: bot.debugState.attackManager.lastPathOk ?? null,
                  lastTransitionReason: bot.debugState.attackManager.lastTransitionReason ?? null,
                  fortificationHpEstimate: bot.debugState.attackManager.fortificationHpEstimate ?? null,
                  requiredAssaultPower: bot.debugState.attackManager.requiredAssaultPower ?? null,
                  rosterAssaultPower: bot.debugState.attackManager.rosterAssaultPower ?? null,
                  requiredUnitsFromPower: bot.debugState.attackManager.requiredUnitsFromPower ?? null
              }
        : null;
    const recentLogs = Array.isArray(bot?.debugState?.logs) ? bot.debugState.logs.slice(-10) : [];
    const logCounts: Record<string, number> = {};
    recentLogs.forEach((entry: any) => {
        const key = entry?.eventType || entry?.type || 'UNKNOWN';
        logCounts[key] = (logCounts[key] || 0) + 1;
    });

    return {
        playerId,
        baseHealth: base?.health ?? null,
        resources: player
            ? {
                  gold: Math.round(player.resources.gold),
                  oil: Math.round(player.resources.oil)
              }
            : null,
        totalUnits: playerUnits.length,
        combatUnits,
        statuses: statusCounts,
        buildings: buildingCounts,
        bridges: bridgeCounts,
        units: unitCounts,
        queues: {
            buildings: queuedBuildingUnits,
            units: queuedMobileUnits
        },
        botState: bot
            ? {
                  currentGoal: bot.debugState?.currentGoal || null,
                  phase: bot.debugState?.progression?.phase || bot.getMatchPhase?.() || null,
                  lastDecision: bot.debugState?.lastDecision || null,
                  lastDecisionScore: bot.debugState?.lastDecisionScore ?? null,
                  defenceReserveGold: bot.defenceReserveGold ?? null,
                  strategyProfile: bot.debugState?.strategyProfile || null,
                  progression: bot.debugState?.progression || null,
                  production: bot.debugState?.production || null,
                  aggressionState: bot.debugState?.aggressionState || null,
                  logCounts,
                  recentLogs,
                  attackManager: attackManagerState
              }
            : null
    };
}

async function runMatch(
    lowerDifficulty: number,
    higherDifficulty: number,
    mapType: DuelMapType,
    seed: number
): Promise<DuelResult> {
    const lowerId = `bot-${lowerDifficulty}-seed-${seed}`;
    const higherId = `bot-${higherDifficulty}-seed-${seed}`;
    const originalRandom = Math.random;
    Math.random = createSeededRandom(seed);

    try {
        const gameState = new GameState(mapType);
        gameState.mapType = mapType;
        gameState.map = createDuelMap(mapType, seed, lowerId, higherId);
        gameState.status = 'playing';
        gameState.players.clear();
        gameState.units = [];
        gameState.bots = [];

        gameState.addPlayer(lowerId, true, `Bot ${lowerDifficulty}`, lowerDifficulty);
        gameState.addPlayer(higherId, true, `Bot ${higherDifficulty}`, higherDifficulty);

        const lowerPlayer = gameState.players.get(lowerId);
        const higherPlayer = gameState.players.get(higherId);
        if (!lowerPlayer || !higherPlayer) {
            throw new Error(`missing duel players for ${lowerDifficulty} vs ${higherDifficulty}`);
        }

        lowerPlayer.resources = { gold: 4800, oil: 1000 };
        higherPlayer.resources = { gold: 4800, oil: 1000 };

        const lowerIsland = gameState.map.islands.find(island =>
            island.buildings.some(building => building.ownerId === lowerId && building.type === 'base')
        );
        const higherIsland = gameState.map.islands.find(island =>
            island.buildings.some(building => building.ownerId === higherId && building.type === 'base')
        );
        if (!lowerIsland || !higherIsland) {
            throw new Error(`missing starting islands for ${lowerDifficulty} vs ${higherDifficulty}`);
        }

        addBuilders(gameState, lowerIsland, lowerId, 3);
        addBuilders(gameState, higherIsland, higherId, 3);

        const lowerBot = createBotAI(lowerId, lowerDifficulty) as any;
        const higherBot = createBotAI(higherId, higherDifficulty) as any;
        accelerateBot(lowerBot);
        accelerateBot(higherBot);
        const matchStart = Date.now();
        lowerBot.startTime = matchStart;
        higherBot.startTime = matchStart;
        lowerBot.lastMeaningfulActionTime = matchStart;
        higherBot.lastMeaningfulActionTime = matchStart;
        gameState.bots = [lowerBot, higherBot];
        gameState.startTime = matchStart;

        const io = createIo();
        gameState.startGameLoop(io, `ladder-${lowerDifficulty}-${higherDifficulty}-${seed}`);
        const startedAt = Date.now();
        const configuredTimeoutMs = Number(process.env.BOT_LADDER_MAX_MATCH_MS || `${10 * 60 * 1000}`);
        const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
            ? configuredTimeoutMs
            : 10 * 60 * 1000;

        await new Promise<void>(resolve => {
            const poll = setInterval(() => {
                const lowerBaseAlive = hasLivingBase(gameState, lowerId);
                const higherBaseAlive = hasLivingBase(gameState, higherId);
                if (!lowerBaseAlive || !higherBaseAlive || Date.now() - startedAt >= timeoutMs) {
                    clearInterval(poll);
                    resolve();
                }
            }, 100);
        });

        gameState.stopGameLoop();

        const elapsedMs = Date.now() - startedAt;
        const lowerBaseAlive = hasLivingBase(gameState, lowerId);
        const higherBaseAlive = hasLivingBase(gameState, higherId);

        let winnerPlayerId: string | null = null;
        let loserPlayerId: string | null = null;
        let winnerDifficulty: number | null = null;
        let method: 'base_destroyed' | 'timeout' | 'double_base_loss' = 'timeout';

        if (!lowerBaseAlive && higherBaseAlive) {
            winnerPlayerId = higherId;
            loserPlayerId = lowerId;
            winnerDifficulty = higherDifficulty;
            method = 'base_destroyed';
        } else if (!higherBaseAlive && lowerBaseAlive) {
            winnerPlayerId = lowerId;
            loserPlayerId = higherId;
            winnerDifficulty = lowerDifficulty;
            method = 'base_destroyed';
        } else if (!lowerBaseAlive && !higherBaseAlive) {
            method = 'double_base_loss';
        }

        return {
            lowerDifficulty,
            higherDifficulty,
            mapType,
            seed,
            winnerDifficulty,
            winnerPlayerId,
            loserPlayerId,
            method,
            elapsedMs,
            maxDurationMs: timeoutMs,
            lowerBaseAlive,
            higherBaseAlive,
            finalSnapshot: {
                lower: snapshotPlayer(gameState, lowerId),
                higher: snapshotPlayer(gameState, higherId)
            },
            timeoutSnapshot:
                method === 'timeout'
                    ? {
                          lower: snapshotPlayer(gameState, lowerId),
                          higher: snapshotPlayer(gameState, higherId)
                      }
                    : undefined,
            roundStats: {
                lowerGold: lowerPlayer ? Math.round(lowerPlayer.resources.gold) : null,
                higherGold: higherPlayer ? Math.round(higherPlayer.resources.gold) : null,
                lowerOil: lowerPlayer ? Math.round(lowerPlayer.resources.oil) : null,
                higherOil: higherPlayer ? Math.round(higherPlayer.resources.oil) : null,
                lowerBaseDestroyed: !lowerBaseAlive,
                higherBaseDestroyed: !higherBaseAlive
            }
        };
    } finally {
        Math.random = originalRandom;
    }
}

async function runLocalLadder(lowerDifficulties: number[], maps: DuelMapType[], seeds: number[]): Promise<LadderRun> {
    const restoreTimings = applyFastTimings();
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    try {
        const results: DuelResult[] = [];

        for (const lower of lowerDifficulties) {
            const higher = lower + 1;
            for (const mapType of maps) {
                for (const seed of seeds) {
                    results.push(await runMatch(lower, higher, mapType, seed + lower * 17));
                }
            }
        }

        const summary: PairSummary[] = [];
        for (const lower of lowerDifficulties) {
            const higher = lower + 1;
            const pairResults = results.filter(result => result.lowerDifficulty === lower && result.higherDifficulty === higher);
            const higherWins = pairResults.filter(result => result.winnerDifficulty === higher).length;
            const lowerWins = pairResults.filter(result => result.winnerDifficulty === lower).length;
            const timeouts = pairResults.filter(result => result.method === 'timeout').length;
            const doubleBaseLosses = pairResults.filter(result => result.method === 'double_base_loss').length;
            const higherBaseKills = pairResults.filter(result => !result.lowerBaseAlive).length;
            const lowerBaseKills = pairResults.filter(result => !result.higherBaseAlive).length;
            const avgLowerGold = pairResults.length > 0
                ? Math.round(pairResults.reduce((sum, result) => sum + (result.roundStats.lowerGold ?? 0), 0) / pairResults.length)
                : 0;
            const avgHigherGold = pairResults.length > 0
                ? Math.round(pairResults.reduce((sum, result) => sum + (result.roundStats.higherGold ?? 0), 0) / pairResults.length)
                : 0;
            const avgLowerOil = pairResults.length > 0
                ? Math.round(pairResults.reduce((sum, result) => sum + (result.roundStats.lowerOil ?? 0), 0) / pairResults.length)
                : 0;
            const avgHigherOil = pairResults.length > 0
                ? Math.round(pairResults.reduce((sum, result) => sum + (result.roundStats.higherOil ?? 0), 0) / pairResults.length)
                : 0;
            const higherWinRate = pairResults.length > 0 ? higherWins / pairResults.length : 0;
            summary.push({
                lowerDifficulty: lower,
                higherDifficulty: higher,
                matches: pairResults.length,
                higherWins,
                lowerWins,
                timeouts,
                doubleBaseLosses,
                higherBaseKills,
                lowerBaseKills,
                avgLowerGold,
                avgHigherGold,
                avgLowerOil,
                avgHigherOil,
                higherWinRate: Number(higherWinRate.toFixed(2)),
                pass: timeouts === 0 && doubleBaseLosses === 0 && higherWins > lowerWins
            });
        }

        console.log = originalLog;
        console.warn = originalWarn;
        restoreTimings();
        return { summary, results };
    } catch (error) {
        console.log = originalLog;
        console.warn = originalWarn;
        restoreTimings();
        throw error;
    }
}

function renderSnapshotMarkdown(ladderRun: LadderRun): string {
    const lines: string[] = [];
    lines.push('# Bot Difficulty Ladder');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    ladderRun.summary.forEach(item => {
        lines.push(
            `- ${item.lowerDifficulty} -> ${item.higherDifficulty}: ` +
            `${item.higherWins}/${item.matches} higher wins, ` +
            `${item.lowerWins} lower wins, ` +
            `${item.timeouts} timeouts, ` +
            `${item.doubleBaseLosses} double base losses, ` +
            `base kills (higher/lower): ${item.higherBaseKills}/${item.lowerBaseKills}, ` +
            `avg gold (lower/higher): ${item.avgLowerGold}/${item.avgHigherGold}, ` +
            `avg oil (lower/higher): ${item.avgLowerOil}/${item.avgHigherOil}, ` +
            `${item.pass ? 'PASS' : 'FAIL'}`
        );
    });
    lines.push('');
    lines.push('## Match Snapshots');
    lines.push('');
    ladderRun.results.forEach(result => {
        const snapshot = result.method === 'timeout' && result.timeoutSnapshot ? result.timeoutSnapshot : result.finalSnapshot;
        lines.push(`### ${result.lowerDifficulty} -> ${result.higherDifficulty} | ${result.mapType} | seed ${result.seed}`);
        lines.push('');
        lines.push(`- Result: ${result.method}`);
        lines.push(`- Winner: ${result.winnerDifficulty ?? 'none'}`);
        lines.push(`- Elapsed: ${result.elapsedMs}ms / ${result.maxDurationMs}ms`);
        lines.push(`- Lower base alive: ${result.lowerBaseAlive}`);
        lines.push(`- Higher base alive: ${result.higherBaseAlive}`);
        lines.push(
            `- Round stats: gold ${result.roundStats.lowerGold}/${result.roundStats.higherGold}, ` +
            `oil ${result.roundStats.lowerOil}/${result.roundStats.higherOil}, ` +
            `baseDestroyed ${result.roundStats.lowerBaseDestroyed}/${result.roundStats.higherBaseDestroyed}`
        );
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(snapshot, null, 2));
        lines.push('```');
        lines.push('');
    });
    return lines.join('\n');
}

function writeArtifacts(ladderRun: LadderRun) {
    const serverRoot = resolve(__dirname, '..', '..');
    const outputDir = join(serverRoot, 'test-results');
    mkdirSync(outputDir, { recursive: true });
    const jsonPath = join(outputDir, 'bot-difficulty-ladder.json');
    const markdownPath = join(outputDir, 'bot-difficulty-ladder.md');
    writeFileSync(jsonPath, `${JSON.stringify(ladderRun, null, 2)}\n`, 'utf8');
    writeFileSync(markdownPath, `${renderSnapshotMarkdown(ladderRun)}\n`, 'utf8');
}

function runIsolatedPair(lowerDifficulty: number, maps: DuelMapType[], seeds: number[]): LadderRun {
    const child = spawnSync(
        process.execPath,
        ['-r', 'ts-node/register', __filename],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                BOT_LADDER_CHILD_MODE: '1',
                BOT_LADDER_PAIRS: String(lowerDifficulty),
                BOT_LADDER_MAPS: maps.join(','),
                BOT_LADDER_SEEDS: seeds.join(',')
            },
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10
        }
    );

    if (child.status !== 0) {
        throw new Error(child.stderr || child.stdout || `pair process failed for ${lowerDifficulty} vs ${lowerDifficulty + 1}`);
    }

    const payload = child.stdout.trim();
    if (!payload) {
        throw new Error(`empty pair payload for ${lowerDifficulty} vs ${lowerDifficulty + 1}`);
    }

    return JSON.parse(payload) as LadderRun;
}

async function main() {
    const maps = parseMaps(process.env.BOT_LADDER_MAPS);
    const seeds = parseSeeds(process.env.BOT_LADDER_SEEDS);
    const lowerDifficulties = parseDifficultyPairs(process.env.BOT_LADDER_PAIRS);
    const childMode = process.env.BOT_LADDER_CHILD_MODE === '1';

    let ladderRun: LadderRun;
    if (childMode || lowerDifficulties.length <= 1) {
        ladderRun = await runLocalLadder(lowerDifficulties, maps, seeds);
    } else {
        const summary: PairSummary[] = [];
        const results: DuelResult[] = [];
        for (const lower of lowerDifficulties) {
            const isolatedRun = runIsolatedPair(lower, maps, seeds);
            summary.push(...isolatedRun.summary);
            results.push(...isolatedRun.results);
        }
        ladderRun = { summary, results };
    }

    if (childMode) {
        console.log(JSON.stringify(ladderRun, null, 2));
        return;
    }

    writeArtifacts(ladderRun);

    const failingPairs = ladderRun.summary.filter(item => !item.pass);
    const failingResults = ladderRun.results.filter(result =>
        failingPairs.some(
            pair =>
                pair.lowerDifficulty === result.lowerDifficulty &&
                pair.higherDifficulty === result.higherDifficulty
        )
    );

    if (failingPairs.length > 0) {
        console.error(
            new Error(
                `Ladder failures:\n${JSON.stringify(failingPairs, null, 2)}\nFailing match results:\n${JSON.stringify(failingResults, null, 2)}\nResults:\n${JSON.stringify(ladderRun.summary, null, 2)}`
            )
        );
        process.exit(1);
    }

    console.log(JSON.stringify(ladderRun, null, 2));
}

main();
