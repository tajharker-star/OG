import { GameState } from './GameState';
import { createBotAI } from './BotAIFactory';
import { GameMap, Island, OilSpot } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';

type Summary = {
    difficulty: number;
    controller: string;
    towers: number;
    wallNodes: number;
    recruitmentBuildings: number;
    airBases: number;
    carriers: number;
    motherships: number;
    phase: string;
};

function circleIsland(id: string, x: number, y: number, radius: number, ownerId?: string): Island {
    return {
        id,
        x,
        y,
        radius,
        type: 'grasslands',
        ownerId,
        buildings: [],
        goldSpots: [
            { id: `${id}_gold_0`, x: -120, y: 70 },
            { id: `${id}_gold_1`, x: -20, y: -80 },
            { id: `${id}_gold_2`, x: 80, y: 30 },
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

function addBuilder(gameState: GameState, island: Island, ownerId: string, relX: number, relY: number) {
    gameState.units.push({
        id: `builder_${ownerId}_${gameState.units.length}`,
        ownerId,
        type: 'builder',
        x: island.x + relX,
        y: island.y + relY,
        status: 'idle',
        health: UnitData.builder.maxHealth,
        maxHealth: UnitData.builder.maxHealth,
        damage: UnitData.builder.damage,
        range: UnitData.builder.range,
        speed: 120,
        fireRate: UnitData.builder.fireRate
    });
}

function createScenario(botId: string, enemyId: string): GameMap {
    const botIsland = circleIsland('bot_island', 520, 720, 360, botId);
    const enemyIsland = circleIsland('enemy_island', 1720, 720, 260, enemyId);
    const neutralIsland = circleIsland('neutral_island', 1050, 320, 180);
    addBase(botIsland, botId, -40, 0);
    addBase(enemyIsland, enemyId, 0, 0);

    const oilSpots: OilSpot[] = [
        { id: 'oil_0', x: botIsland.x + botIsland.radius + 95, y: botIsland.y - 10, radius: 18 },
        { id: 'oil_1', x: botIsland.x + botIsland.radius + 135, y: botIsland.y + 110, radius: 18 }
    ];

    return {
        width: 2200,
        height: 1400,
        islands: [botIsland, enemyIsland, neutralIsland],
        oilSpots,
        bridges: [],
        mapType: 'grasslands'
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
    const targets = ['mine', 'tower', 'wall_node', 'dock', 'barracks', 'tank_factory', 'air_base', 'oil_well', 'oil_rig'] as const;
    const units = ['builder', 'soldier', 'tank', 'construction_ship', 'destroyer', 'light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'] as const;
    const buildingOriginals = new Map<string, number>();
    const unitOriginals = new Map<string, number>();

    targets.forEach(type => {
        const current = BuildingData[type].constructionTime ?? 100;
        buildingOriginals.set(type, current);
        BuildingData[type].constructionTime = Math.max(6, Math.min(current, 18));
    });
    units.forEach(type => {
        const current = UnitData[type].constructionTime ?? 100;
        unitOriginals.set(type, current);
        UnitData[type].constructionTime = Math.max(6, Math.min(current, 20));
    });

    return () => {
        targets.forEach(type => {
            const original = buildingOriginals.get(type);
            if (original !== undefined) BuildingData[type].constructionTime = original;
        });
        units.forEach(type => {
            const original = unitOriginals.get(type);
            if (original !== undefined) UnitData[type].constructionTime = original;
        });
    };
}

function countOwnedBuildings(gameState: GameState, playerId: string, type: string): number {
    return gameState.map.islands.reduce((count, island) => {
        return count + island.buildings.filter(building => building.ownerId === playerId && building.type === type).length;
    }, 0);
}

function minimumRecruitmentBuildingsForDifficulty(difficulty: number): number {
    if (difficulty >= 7) return 2;
    return 1;
}

function countRecruitmentBuildings(gameState: GameState, playerId: string): number {
    return countOwnedBuildings(gameState, playerId, 'barracks') + countOwnedBuildings(gameState, playerId, 'tank_factory');
}

function minimumTowersForDifficulty(difficulty: number): number {
    if (difficulty <= 3) return 1;
    if (difficulty <= 6) return 2;
    if (difficulty <= 9) return 3;
    return 5;
}

function minimumWallNodesForDifficulty(difficulty: number): number {
    if (difficulty <= 3) return 4;
    if (difficulty <= 6) return 6;
    if (difficulty <= 9) return 7;
    return 9;
}

function minimumAirBasesForDifficulty(difficulty: number): number {
    if (difficulty === 10) return 1;
    return 0;
}

async function runScenario(difficulty: number): Promise<Summary> {
    const botId = `bot-${difficulty}`;
    const enemyId = `enemy-${difficulty}`;
    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = createScenario(botId, enemyId);
    gameState.status = 'playing';
    gameState.players.clear();
    gameState.units = [];
    gameState.bots = [];

    gameState.addPlayer(botId, true, 'Bot', difficulty);
    gameState.addPlayer(enemyId, false, 'Enemy', 1);

    const botPlayer = gameState.players.get(botId);
    const enemyPlayer = gameState.players.get(enemyId);
    if (!botPlayer || !enemyPlayer) {
        throw new Error(`players missing for difficulty ${difficulty}`);
    }

    botPlayer.resources = { gold: 20000, oil: 8000 };
    enemyPlayer.resources = { gold: 5000, oil: 5000 };
    const botIsland = gameState.map.islands[0];
    addBuilder(gameState, botIsland, botId, 30, 0);
    addBuilder(gameState, botIsland, botId, 60, 30);
    addBuilder(gameState, botIsland, botId, -20, -40);
    addBuilder(gameState, botIsland, botId, 100, -20);

    const bot = createBotAI(botId, difficulty) as any;
    bot.actionInterval = 0;
    bot.minBuildDelay = 0;
    bot.maxBuildDelay = 0;
    bot.currentBuildDelay = 0;
    bot.maxApmTokens = 1000;
    bot.apmTokens = 1000;
    bot.startTime = Date.now() - 360_000;
    bot.lastMeaningfulActionTime = bot.startTime;
    bot.attackManager.attackStartTimeSec = 1;
    bot.attackManager.minArmySize = 3;

    gameState.startTime = bot.startTime;
    gameState.bots.push(bot);

    const io = createIo();
    gameState.startGameLoop(io, `difficulty-${difficulty}`);
    const runtimeMs = difficulty === 10 ? 32000 : difficulty >= 8 ? 20000 : 12000;
    await new Promise(resolve => setTimeout(resolve, runtimeMs));
    gameState.stopGameLoop();

    return {
        difficulty,
        controller: bot.constructor.name,
        towers: countOwnedBuildings(gameState, botId, 'tower'),
        wallNodes: countOwnedBuildings(gameState, botId, 'wall_node'),
        recruitmentBuildings: countRecruitmentBuildings(gameState, botId),
        airBases: countOwnedBuildings(gameState, botId, 'air_base'),
        carriers: gameState.units.filter(unit => unit.ownerId === botId && unit.type === 'aircraft_carrier').length,
        motherships: gameState.units.filter(unit => unit.ownerId === botId && unit.type === 'mothership').length,
        phase: bot.getMatchPhase()
    };
}

async function main() {
    const restoreTimings = applyFastTimings();
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalRandom = Math.random;
    let randomState = 0x12345678;
    Math.random = () => {
        randomState = (randomState * 1664525 + 1013904223) >>> 0;
        return randomState / 0x100000000;
    };
    console.log = () => {};
    console.warn = () => {};

    try {
        const results: Summary[] = [];
        for (let difficulty = 1; difficulty <= 10; difficulty++) {
            results.push(await runScenario(difficulty));
        }

        const failures: string[] = [];
        results.forEach(result => {
            if (result.phase !== 'LATE') failures.push(`difficulty ${result.difficulty} phase=${result.phase}`);
            if (result.towers < minimumTowersForDifficulty(result.difficulty)) failures.push(`difficulty ${result.difficulty} towers=${result.towers}`);
            if (result.wallNodes < minimumWallNodesForDifficulty(result.difficulty)) failures.push(`difficulty ${result.difficulty} wallNodes=${result.wallNodes}`);
            if (result.recruitmentBuildings < minimumRecruitmentBuildingsForDifficulty(result.difficulty)) failures.push(`difficulty ${result.difficulty} recruitmentBuildings=${result.recruitmentBuildings}`);
            if (result.airBases < minimumAirBasesForDifficulty(result.difficulty)) failures.push(`difficulty ${result.difficulty} airBases=${result.airBases}`);
            if (result.difficulty === 10 && (result.carriers < 1 || result.motherships < 1)) failures.push(`difficulty 10 carrier=${result.carriers} mothership=${result.motherships}`);
        });

        console.log = originalLog;
        console.warn = originalWarn;
        Math.random = originalRandom;
        restoreTimings();

        if (failures.length > 0) {
            throw new Error(`Difficulty smoke failures:\n${failures.join('\n')}\nResults:\n${JSON.stringify(results, null, 2)}`);
        }

        console.log(JSON.stringify(results, null, 2));
    } catch (error) {
        console.log = originalLog;
        console.warn = originalWarn;
        Math.random = originalRandom;
        restoreTimings();
        console.error(error);
        process.exit(1);
    }
}

main();
