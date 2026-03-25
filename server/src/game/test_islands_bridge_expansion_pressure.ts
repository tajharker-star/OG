import { GameState } from './GameState';
import { BotAI } from './BotAI';
import { GameMap, Island, OilSpot } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function createIsland(id: string, x: number, y: number, radius: number, ownerId?: string): Island {
    return {
        id,
        x,
        y,
        radius,
        type: 'grasslands',
        ownerId,
        buildings: [],
        goldSpots: []
    };
}

function addBuilding(island: Island, type: string, ownerId: string, x: number, y: number) {
    const stats = BuildingData[type];
    island.buildings.push({
        id: `${type}_${ownerId}_${island.id}_${island.buildings.length}`,
        type: type as any,
        level: 1,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        x,
        y,
        ownerId,
        isConstructing: false,
        constructionProgress: 100,
        range: stats.range,
        recruitmentQueue: []
    } as any);
}

function createUnit(ownerId: string, type: 'builder' | 'construction_ship', x: number, y: number) {
    const stats = UnitData[type];
    return {
        id: `${type}_${ownerId}_${Math.random()}`,
        ownerId,
        type,
        x,
        y,
        status: 'idle' as const,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        damage: stats.damage,
        range: stats.range,
        speed: stats.speed,
        fireRate: stats.fireRate,
        facingAngle: 0,
        recruitmentQueue: [],
        cargo: []
    };
}

function primeBot(bot: any, elapsedMs: number) {
    bot.startTime = Date.now() - elapsedMs;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;
    bot.maxApmTokens = 999;
    bot.minBuildDelay = 0;
    bot.maxBuildDelay = 0;
    bot.currentBuildDelay = 0;
    bot.lastBuildTime = 0;
}

function finishBridgeNodes(gameState: GameState, playerId: string) {
    gameState.map.islands.forEach(island => {
        island.buildings.forEach(building => {
            if (building.type === 'bridge_node' && building.ownerId === playerId) {
                building.isConstructing = false;
                building.constructionProgress = 100;
                building.health = building.maxHealth;
            }
        });
    });
    (gameState.map.waterBuildings || []).forEach(building => {
        if (building.type === 'bridge_node' && building.ownerId === playerId) {
            building.isConstructing = false;
            building.constructionProgress = 100;
            building.health = building.maxHealth;
        }
    });
}

function moveConstructionShips(gameState: GameState, playerId: string) {
    gameState.units.forEach(unit => {
        if (unit.ownerId !== playerId || unit.type !== 'construction_ship') return;
        if (unit.targetX === undefined || unit.targetY === undefined) return;
        unit.x = unit.targetX;
        unit.y = unit.targetY;
        unit.status = 'idle';
        unit.targetX = undefined;
        unit.targetY = undefined;
        unit.path = undefined;
    });
}

function teleportBuildersToTargets(gameState: GameState, playerId: string) {
    gameState.units.forEach(unit => {
        if (unit.ownerId !== playerId || unit.type !== 'builder') return;
        if (unit.targetX === undefined || unit.targetY === undefined) return;
        unit.x = unit.targetX;
        unit.y = unit.targetY;
        unit.status = 'idle';
        unit.targetX = undefined;
        unit.targetY = undefined;
        unit.path = undefined;
    });
}

function finishBuildings(gameState: GameState, playerId: string, types: string[]) {
    gameState.map.islands.forEach(island => {
        island.buildings.forEach(building => {
            if (building.ownerId !== playerId || !types.includes(building.type)) return;
            building.isConstructing = false;
            building.constructionProgress = 100;
            building.health = building.maxHealth;
        });
    });
}

function main() {
    const botId = 'bridge-pressure-bot';
    const enemyId = 'bridge-pressure-enemy';

    const homeIsland = createIsland('home', 280, 430, 82, botId);
    const expansionIsland = createIsland('expansion', 980, 430, 150);
    const enemyIsland = createIsland('enemy', 1530, 430, 140, enemyId);

    addBuilding(homeIsland, 'base', botId, 0, 0);
    addBuilding(homeIsland, 'dock', botId, 72, -16);
    addBuilding(homeIsland, 'repair_dock', botId, -54, -26);
    addBuilding(homeIsland, 'tower', botId, -8, 58);
    addBuilding(homeIsland, 'tower', botId, 52, 42);
    addBuilding(homeIsland, 'hospital', botId, -44, 30);
    addBuilding(enemyIsland, 'base', enemyId, 0, 0);

    const ownedOil: OilSpot = {
        id: 'owned_oil',
        x: 450,
        y: 640,
        radius: 18,
        occupiedBy: 'owned_rig'
    };
    (ownedOil as any).ownerId = botId;
    (ownedOil as any).building = {
        id: 'owned_rig',
        type: 'oil_rig',
        ownerId: botId,
        health: BuildingData.oil_rig.maxHealth,
        maxHealth: BuildingData.oil_rig.maxHealth,
        isConstructing: false
    };

    const neutralOilA: OilSpot = { id: 'neutral_a', x: 1220, y: 210, radius: 18 };
    const neutralOilB: OilSpot = { id: 'neutral_b', x: 1260, y: 700, radius: 18 };

    const map: GameMap = {
        width: 1900,
        height: 1000,
        islands: [homeIsland, expansionIsland, enemyIsland],
        oilSpots: [ownedOil, neutralOilA, neutralOilB],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, true, 'Bridge Pressure Bot', 10);
    gameState.addPlayer(enemyId, false, 'Enemy', 1);
    gameState.players.get(botId)!.resources = { gold: 25000, oil: 12000 };

    gameState.units.push(
        createUnit(botId, 'builder', homeIsland.x + 12, homeIsland.y - 8),
        createUnit(botId, 'construction_ship', 430, 430),
        createUnit(botId, 'construction_ship', 560, 430)
    );

    const bot = new BotAI(botId, 10) as any;
    primeBot(bot, 90000);

    const player = gameState.players.get(botId)!;
    const homeAirBaseSpace = bot.findAutoBuildPosition(gameState, homeIsland, 'air_base');
    assert(!homeAirBaseSpace, 'setup should leave the home island too cramped for an air base');
    assert(bot.shouldForceIslandsBridgeExpansion(gameState, player, [homeIsland]) === true, 'level 10 should force bridge expansion when its home island is build-space starved');

    for (let tick = 0; tick < 40; tick += 1) {
        const myIslands = gameState.map.islands.filter(
            island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
        );
        const myUnits = gameState.units.filter(unit => unit.ownerId === botId);
        bot.usedUnitIds.clear();
        bot.apmTokens = 999;
        bot.manageLandBridgeExpansion(gameState, player, myIslands, myUnits);
        moveConstructionShips(gameState, botId);
        finishBridgeNodes(gameState, botId);
        if (gameState.findIslandTraversalPath(homeIsland.id, expansionIsland.id)) {
            break;
        }
    }

    const traversalPath = gameState.findIslandTraversalPath(homeIsland.id, expansionIsland.id);
    assert(!!traversalPath, 'level 10 should build a bridge chain before mid game when new build space is urgently needed');

    let myIslands = gameState.map.islands.filter(
        island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
    );
    let myUnits = gameState.units.filter(unit => unit.ownerId === botId);

    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageIslandsForwardBuilderStaging(gameState, player, myIslands, myUnits);

    const builder = gameState.units.find(unit => unit.ownerId === botId && unit.type === 'builder') as any;
    assert(builder.status === 'moving', 'after the bridge opens, a builder should be staged onto the new island');
    assert((builder.path || []).length >= 1, 'the staged builder should receive a bridge-aware movement path');

    teleportBuildersToTargets(gameState, botId);

    myIslands = gameState.map.islands.filter(
        island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
    );
    myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.runIslandsStrategy(gameState, player, myIslands, myUnits);

    const forwardDock = expansionIsland.buildings.find(building => building.type === 'dock' && building.ownerId === botId);
    if (forwardDock) {
        finishBuildings(gameState, botId, ['dock']);
    }

    myIslands = gameState.map.islands.filter(
        island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
    );
    myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageAirStrategy(gameState, player, myIslands, myUnits);

    const forwardAirBase = expansionIsland.buildings.find(building => building.type === 'air_base' && building.ownerId === botId);
    assert(!!forwardDock || !!forwardAirBase, 'the bridged expansion island should turn into a real production foothold');
    assert(!!forwardAirBase, 'once bridge space is opened, level 10 should place an air base on the new island');

    finishBuildings(gameState, botId, ['air_base']);

    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageIslandsBridgeheadDefences(gameState, player, myIslands, myUnits);
    const forwardTower = expansionIsland.buildings.find(building => building.type === 'tower' && building.ownerId === botId);
    assert(!!forwardTower, 'the bot should start fortifying the new bridged expansion island');

    console.log(JSON.stringify({
        forcedBridgeExpansion: true,
        traversalPath,
        builderPathPoints: (builder.path || []).length,
        dockBuiltOnExpansion: !!forwardDock,
        airBaseBuiltOnExpansion: !!forwardAirBase,
        towerBuiltOnExpansion: !!forwardTower
    }, null, 2));
}

main();
