import { GameState } from './GameState';
import { createBotAI } from './BotAIFactory';
import { BuildingData, UnitData } from './data/Registry';
import { GameMap, Island, OilSpot } from './MapGenerator';

type DuelMapType = 'desert' | 'grasslands';

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

function addBase(island: Island, ownerId: string, relX: number, relY: number) {
    island.buildings.push({
        id: `base_${ownerId}_${island.id}`,
        type: 'base',
        level: 1,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
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

function createMap(mapType: DuelMapType, lowerId: string, higherId: string): GameMap {
    if (mapType === 'desert') {
        const floor = circleIsland('desert_floor', 1100, 760, 760, 'desert');
        addBase(floor, lowerId, -320, 0);
        addBase(floor, higherId, 320, 0);
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

    const lowerIsland = circleIsland('lower_island', 520, 760, 360, 'grasslands', lowerId);
    const higherIsland = circleIsland('higher_island', 1680, 760, 360, 'grasslands', higherId);
    const centerIsland = circleIsland('center_island', 1100, 360, 220, 'grasslands');
    addBase(lowerIsland, lowerId, -50, 0);
    addBase(higherIsland, higherId, 50, 0);

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

function createSeededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
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

function applyFastTimings() {
    const buildingKeys = ['mine', 'tower', 'wall_node', 'dock', 'barracks', 'tank_factory', 'air_base', 'oil_well', 'oil_rig'] as const;
    const unitKeys = ['builder', 'soldier', 'tank', 'construction_ship', 'destroyer', 'light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'] as const;
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
    bot.actionInterval = Math.max(40, Math.floor(bot.actionInterval * 0.2));
    bot.minBuildDelay = Math.max(0, Math.floor(bot.minBuildDelay * 0.1));
    bot.maxBuildDelay = Math.max(bot.minBuildDelay, Math.floor(bot.maxBuildDelay * 0.1));
    bot.currentBuildDelay = 0;
    bot.timeToAirPhase = Math.max(1500, Math.floor(bot.timeToAirPhase * 0.015));
    bot.attackManager.attackStartTimeSec = Math.max(2, Math.floor(bot.attackManager.attackStartTimeSec * 0.05));
    bot.attackManager.minArmySize = Math.max(2, Math.floor(bot.attackManager.minArmySize * 0.5));
}

function summarizeBot(gameState: GameState, playerId: string, bot: any) {
    const player = gameState.players.get(playerId)!;
    const ownedBuildings = gameState.map.islands.flatMap(island =>
        island.buildings.filter(building => building.ownerId === playerId)
    );
    const buildings = ownedBuildings.map(building => building.type);
    const oilBuildings = gameState.map.oilSpots
        .filter(spot => (spot as any).ownerId === playerId && (spot as any).building)
        .map(spot => (spot as any).building.type);
    const units = gameState.units.filter(unit => unit.ownerId === playerId).map(unit => unit.type);
    const airBaseIds = new Set(ownedBuildings.filter(building => building.type === 'air_base').map(building => building.id));
    const allLogs = Array.isArray(bot?.debugState?.logs) ? bot.debugState.logs : [];
    const airProductionOrders = allLogs.filter((entry: any) =>
        entry?.eventType === 'PRODUCTION_ORDER' &&
        ['light_plane', 'heavy_plane', 'mothership'].includes(entry?.type) &&
        typeof entry?.buildingId === 'string' &&
        airBaseIds.has(entry.buildingId)
    );
    const airProductionByBuilding: Record<string, number> = {};
    airProductionOrders.forEach((entry: any) => {
        const key = String(entry.buildingId);
        airProductionByBuilding[key] = (airProductionByBuilding[key] || 0) + 1;
    });

    const count = (values: string[]) =>
        values.reduce<Record<string, number>>((acc, value) => {
            acc[value] = (acc[value] || 0) + 1;
            return acc;
        }, {});

    return {
        playerId,
        resources: player.resources,
        buildings: count(buildings),
        oilStructures: count(oilBuildings),
        units: count(units),
        airBases: Array.from(airBaseIds),
        airProductionByBuilding,
        uniqueAirProductionBuildings: Object.keys(airProductionByBuilding).length,
        goal: bot.debugState.currentGoal,
        attackManager: bot.debugState.attackManager,
        progression: bot.debugState.progression
    };
}

async function main() {
    const lowerDifficulty = Number(process.env.BOT_PAIR_LOW ?? '7');
    const higherDifficulty = Number(process.env.BOT_PAIR_HIGH ?? String(lowerDifficulty + 1));
    const mapType = (process.env.BOT_PAIR_MAP as DuelMapType | undefined) ?? 'grasslands';
    const seed = Number(process.env.BOT_PAIR_SEED ?? '1120');

    const lowerId = `bot-${lowerDifficulty}-seed-${seed}`;
    const higherId = `bot-${higherDifficulty}-seed-${seed}`;
    const originalRandom = Math.random;
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    const restoreTimings = applyFastTimings();
    Math.random = createSeededRandom(seed);

    try {
        const gameState = new GameState(mapType);
        gameState.mapType = mapType;
        gameState.map = createMap(mapType, lowerId, higherId);
        gameState.status = 'playing';
        gameState.players.clear();
        gameState.units = [];
        gameState.bots = [];

        gameState.addPlayer(lowerId, true, `Bot ${lowerDifficulty}`, lowerDifficulty);
        gameState.addPlayer(higherId, true, `Bot ${higherDifficulty}`, higherDifficulty);

        gameState.players.get(lowerId)!.resources = { gold: 4800, oil: 1000 };
        gameState.players.get(higherId)!.resources = { gold: 4800, oil: 1000 };

        const lowerIsland = gameState.map.islands.find(island =>
            island.buildings.some(building => building.ownerId === lowerId && building.type === 'base')
        )!;
        const higherIsland = gameState.map.islands.find(island =>
            island.buildings.some(building => building.ownerId === higherId && building.type === 'base')
        )!;

        addBuilders(gameState, lowerIsland, lowerId, 3);
        addBuilders(gameState, higherIsland, higherId, 3);

        const lowerBot = createBotAI(lowerId, lowerDifficulty) as any;
        const higherBot = createBotAI(higherId, higherDifficulty) as any;
        accelerateBot(lowerBot);
        accelerateBot(higherBot);

        const lateStart = Date.now() - 6 * 60 * 1000;
        lowerBot.startTime = lateStart;
        higherBot.startTime = lateStart;
        lowerBot.lastMeaningfulActionTime = lateStart;
        higherBot.lastMeaningfulActionTime = lateStart;
        gameState.startTime = lateStart;
        gameState.bots.push(lowerBot, higherBot);

        const io = createIo();
        gameState.startGameLoop(io, `pair-snapshot-${lowerDifficulty}-${higherDifficulty}-${seed}`);
        const configuredTimeoutMs = Number(process.env.BOT_PAIR_TIMEOUT_MS ?? '');
        const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
            ? configuredTimeoutMs
            : (mapType === 'desert' ? 9000 : 11000);
        await new Promise(resolve => setTimeout(resolve, timeoutMs));
        gameState.stopGameLoop();

        originalLog(
            JSON.stringify(
                {
                    lowerDifficulty,
                    higherDifficulty,
                    mapType,
                    seed,
                    lower: summarizeBot(gameState, lowerId, lowerBot),
                    higher: summarizeBot(gameState, higherId, higherBot)
                },
                null,
                2
            )
        );
    } finally {
        Math.random = originalRandom;
        console.log = originalLog;
        console.warn = originalWarn;
        restoreTimings();
    }
}

main();
