import { GameState } from './GameState';
import { BotAI } from './BotAI';
import { BuildingData } from './data/Registry';
import { GameMap, Island, OilSpot } from './MapGenerator';

type ScenarioSummary = {
    scenario: string;
    difficulty: number;
    elapsedMs: number;
    barracks: number;
    docks: number;
    oilWells: number;
    oilRigs: number;
    soldiers: number;
    constructionShips: number;
    destroyers: number;
    attackState: string;
};

function circleIsland(id: string, x: number, y: number, radius: number, type: Island['type'], ownerId?: string): Island {
    return {
        id,
        x,
        y,
        radius,
        type,
        ownerId,
        buildings: [],
        goldSpots: []
    };
}

function addBase(island: Island, playerId: string, relX: number, relY: number) {
    island.buildings.push({
        id: `base_${playerId}_${island.id}`,
        type: 'base',
        level: 1,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
        x: relX,
        y: relY,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.base.range
    });
}

function addBuilder(gameState: GameState, island: Island, playerId: string, relX: number, relY: number) {
    gameState.units.push({
        id: `builder_${playerId}_${gameState.units.length}`,
        ownerId: playerId,
        type: 'builder',
        x: island.x + relX,
        y: island.y + relY,
        status: 'idle',
        health: 50,
        maxHealth: 50,
        damage: 0,
        range: 50,
        speed: 100,
        fireRate: 0
    });
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

function applyBotTestSpeed(bot: BotAI, attackStartTimeSec: number, minArmySize: number) {
    const controller = bot as any;
    controller.actionInterval = 0;
    controller.minBuildDelay = 0;
    controller.maxBuildDelay = 0;
    controller.currentBuildDelay = 0;
    controller.attackManager.attackStartTimeSec = attackStartTimeSec;
    controller.attackManager.minArmySize = minArmySize;
}

async function runScenario(
    scenario: string,
    difficulty: number,
    map: GameMap,
    playerOil: number,
    runtimeMs: number
): Promise<ScenarioSummary> {
    const botId = `${scenario}-bot`;
    const enemyId = `${scenario}-enemy`;
    const gameState = new GameState(map.mapType || 'islands');
    gameState.mapType = map.mapType || 'islands';
    gameState.map = map;
    gameState.status = 'playing';
    gameState.players.clear();
    gameState.units = [];
    gameState.bots = [];

    gameState.addPlayer(botId, false, 'Bot', difficulty);
    gameState.addPlayer(enemyId, false, 'Enemy');

    const botPlayer = gameState.players.get(botId);
    const enemyPlayer = gameState.players.get(enemyId);
    if (!botPlayer || !enemyPlayer) {
        throw new Error(`Missing players for ${scenario}`);
    }

    botPlayer.resources = { gold: 5000, oil: playerOil };
    enemyPlayer.resources = { gold: 5000, oil: 5000 };
    botPlayer.status = 'active';
    enemyPlayer.status = 'active';

    const botIsland = map.islands.find(island => island.buildings.some(building => building.ownerId === botId && building.type === 'base'));
    if (!botIsland) {
        throw new Error(`Missing bot island for ${scenario}`);
    }

    addBuilder(gameState, botIsland, botId, 50, 0);

    const bot = new BotAI(botId, difficulty);
    applyBotTestSpeed(bot, 5, gameState.mapType === 'islands' ? 1 : 3);
    gameState.bots.push(bot);

    const io = createIo();
    gameState.startGameLoop(io, `${scenario}-test`);
    await new Promise(resolve => setTimeout(resolve, runtimeMs));
    gameState.stopGameLoop();

    const attackState = ((bot as any).attackManager?.state as string) || 'UNKNOWN';
    return {
        scenario,
        difficulty,
        elapsedMs: runtimeMs,
        barracks: map.islands.reduce((count, island) => count + island.buildings.filter(building => building.ownerId === botId && building.type === 'barracks').length, 0),
        docks: map.islands.reduce((count, island) => count + island.buildings.filter(building => building.ownerId === botId && building.type === 'dock').length, 0),
        oilWells: map.islands.reduce((count, island) => count + island.buildings.filter(building => building.ownerId === botId && building.type === 'oil_well').length, 0),
        oilRigs: map.oilSpots.filter(spot => (spot as any).ownerId === botId).length,
        soldiers: gameState.units.filter(unit => unit.ownerId === botId && unit.type === 'soldier').length,
        constructionShips: gameState.units.filter(unit => unit.ownerId === botId && unit.type === 'construction_ship').length,
        destroyers: gameState.units.filter(unit => unit.ownerId === botId && unit.type === 'destroyer').length,
        attackState
    };
}

function createDesertScenario(): GameMap {
    const botId = 'desert-bot';
    const enemyId = 'desert-enemy';
    const desertFloor = circleIsland('desert_floor', 800, 700, 620, 'desert');
    desertFloor.goldSpots.push({ id: 'gold_0', x: -120, y: 80 });
    addBase(desertFloor, botId, -180, 0);
    addBase(desertFloor, enemyId, 240, 0);

    const oilSpots: OilSpot[] = [
        { id: 'desert_oil_0', x: desertFloor.x - 40, y: desertFloor.y + 110, radius: 35 }
    ];

    return {
        width: 1600,
        height: 1200,
        islands: [desertFloor],
        oilSpots,
        bridges: [],
        mapType: 'desert'
    };
}

function createGrasslandsScenario(): GameMap {
    const botId = 'grasslands-bot';
    const enemyId = 'grasslands-enemy';
    const botIsland = circleIsland('grass_bot_island', 780, 650, 240, 'grasslands');
    const enemyIsland = circleIsland('grass_enemy_island', 1480, 650, 220, 'grasslands');
    botIsland.goldSpots.push({ id: 'gold_0', x: -80, y: -40 });
    addBase(botIsland, botId, -40, 0);
    addBase(enemyIsland, enemyId, 0, 0);

    const oilSpots: OilSpot[] = [
        { id: 'grass_oil_0', x: botIsland.x + botIsland.radius + 45, y: botIsland.y - 20, radius: 15 }
    ];

    return {
        width: 1700,
        height: 1300,
        islands: [botIsland, enemyIsland],
        oilSpots,
        bridges: [],
        mapType: 'grasslands'
    };
}

function createIslandsScenario(): GameMap {
    const botId = 'islands-bot';
    const enemyId = 'islands-enemy';
    const botIsland = circleIsland('bot_island', 520, 650, 130, 'grasslands', botId);
    const enemyIsland = circleIsland('enemy_island', 1110, 650, 130, 'grasslands', enemyId);
    addBase(botIsland, botId, 0, 0);
    addBase(enemyIsland, enemyId, 0, 0);

    const oilSpots: OilSpot[] = [
        { id: 'islands_oil_0', x: botIsland.x + botIsland.radius + 110, y: botIsland.y, radius: 15 }
    ];

    return {
        width: 1800,
        height: 1300,
        islands: [botIsland, enemyIsland],
        oilSpots,
        bridges: [],
        mapType: 'islands'
    };
}

async function main() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    try {
        const scenarios = [
            { name: 'desert', difficulty: 3, map: createDesertScenario(), runtimeMs: 26000 },
            { name: 'desert', difficulty: 10, map: createDesertScenario(), runtimeMs: 22000 },
            { name: 'grasslands', difficulty: 3, map: createGrasslandsScenario(), runtimeMs: 42000 },
            { name: 'grasslands', difficulty: 10, map: createGrasslandsScenario(), runtimeMs: 36000 },
            { name: 'islands', difficulty: 3, map: createIslandsScenario(), runtimeMs: 30000 },
            { name: 'islands', difficulty: 10, map: createIslandsScenario(), runtimeMs: 36000 }
        ];
        const results: ScenarioSummary[] = [];
        for (const scenario of scenarios) {
            results.push(await runScenario(scenario.name, scenario.difficulty, scenario.map, 0, scenario.runtimeMs));
        }

        console.log = originalLog;
        console.warn = originalWarn;

        const failures: string[] = [];
        results.forEach(result => {
            if (result.scenario === 'desert') {
                if (result.barracks < 1 || result.soldiers < 1 || result.oilWells < 1) {
                    failures.push(`desert=${JSON.stringify(result)}`);
                }
                return;
            }

            if (result.scenario === 'grasslands') {
                const navalOilChainOnline = result.constructionShips > 0 || result.oilRigs > 0;
                if (result.barracks < 1 || result.soldiers < 1 || result.docks < 1 || !navalOilChainOnline) {
                    failures.push(`grasslands=${JSON.stringify(result)}`);
                }
                return;
            }

            const navalOilChainOnline = result.constructionShips > 0 || result.oilRigs > 0;
            if (result.docks < 1 || !navalOilChainOnline || result.oilRigs < 1) {
                failures.push(`islands=${JSON.stringify(result)}`);
            }
        });

        originalLog(JSON.stringify(results, null, 2));

        if (failures.length > 0) {
            throw new Error(failures.join('\n'));
        }
    } catch (error) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error(error);
        process.exit(1);
    }
}

main();
