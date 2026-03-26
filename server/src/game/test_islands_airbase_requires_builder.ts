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

function addBuilding(island: Island, type: string, ownerId: string, x: number, y: number, id?: string) {
    const stats = BuildingData[type];
    island.buildings.push({
        id: id || `${type}_${ownerId}_${island.id}_${island.buildings.length}`,
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

function primeBot(bot: any) {
    bot.startTime = Date.now() - 240000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;
    bot.maxApmTokens = 999;
    bot.minBuildDelay = 0;
    bot.maxBuildDelay = 0;
    bot.currentBuildDelay = 0;
    bot.lastBuildTime = 0;
    bot.baseDefenseBuilder.debugState.towersBuilt = 3;
    bot.baseDefenseBuilder.debugState.wallNodesPlaced = 6;
    bot.baseDefenseBuilder.debugState.wallConnectionsMade = 1;
}

function main() {
    const botId = 'airbase-rule-bot';
    const enemyId = 'airbase-rule-enemy';

    const homeIsland = createIsland('home', 300, 440, 82, botId);
    const expansionIsland = createIsland('expansion', 1120, 440, 155);
    const enemyIsland = createIsland('enemy', 1680, 440, 140, enemyId);

    addBuilding(homeIsland, 'base', botId, 0, 0, 'base_home');
    addBuilding(homeIsland, 'dock', botId, 70, -14, 'dock_home');
    addBuilding(homeIsland, 'repair_dock', botId, -54, -24, 'repair_home');
    addBuilding(homeIsland, 'tower', botId, -10, 56, 'tower_home_1');
    addBuilding(homeIsland, 'tower', botId, 50, 42, 'tower_home_2');
    addBuilding(homeIsland, 'hospital', botId, -42, 28, 'hospital_home');
    addBuilding(homeIsland, 'bridge_node', botId, 82, 0, 'bridge_node_home');

    addBuilding(expansionIsland, 'bridge_node', botId, -155, 0, 'bridge_node_expansion');
    addBuilding(expansionIsland, 'dock', botId, 132, 0, 'dock_expansion');
    addBuilding(enemyIsland, 'base', enemyId, 0, 0, 'base_enemy');

    const ownedOil: OilSpot = {
        id: 'owned_oil',
        x: 620,
        y: 720,
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

    const map: GameMap = {
        width: 2200,
        height: 1200,
        islands: [homeIsland, expansionIsland, enemyIsland],
        oilSpots: [ownedOil],
        bridges: [{
            id: 'bridge_home_expansion',
            type: 'bridge',
            nodeAId: 'bridge_node_home',
            nodeBId: 'bridge_node_expansion',
            islandAId: homeIsland.id,
            islandBId: expansionIsland.id,
            ownerId: botId,
            health: 500,
            maxHealth: 500
        } as any],
        waterBuildings: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, true, 'Airbase Rule Bot', 10);
    gameState.addPlayer(enemyId, false, 'Enemy', 1);
    gameState.players.get(botId)!.resources = { gold: 30000, oil: 12000 };

    const builder = createUnit(botId, 'builder', homeIsland.x - 16, homeIsland.y + 12) as any;
    const constructionShip = createUnit(botId, 'construction_ship', expansionIsland.x - 50, expansionIsland.y - 210);
    gameState.units.push(builder, constructionShip);

    const directBuildResult = gameState.buildStructure(botId, expansionIsland.id, 'air_base');
    assert(directBuildResult === false, 'game rules should deny air base placement on a remote island when only a construction ship is present');
    assert(
        !expansionIsland.buildings.some(building => building.type === 'air_base' && building.ownerId === botId),
        'remote air base placement should not create a building without a local builder'
    );

    const bot = new BotAI(botId, 10) as any;
    primeBot(bot);
    assert(!bot.findAutoBuildPosition(gameState, homeIsland, 'air_base'), 'setup should keep the home island too full for an air base');

    let myIslands = gameState.map.islands.filter(
        island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
    );
    let myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageAirStrategy(gameState, gameState.players.get(botId)!, myIslands, myUnits);

    assert(
        !expansionIsland.buildings.some(building => building.type === 'air_base' && building.ownerId === botId),
        'bot should not be able to place an air base until a builder has crossed onto the target island'
    );
    assert(builder.status === 'moving', 'bot should move a builder across the bridge before trying to place the air base');
    const builderPathPointsBeforeTransfer = (builder.path || []).length;
    assert(builderPathPointsBeforeTransfer >= 1, 'builder transfer to the target island should use a bridge-aware path');

    builder.x = expansionIsland.x - 30;
    builder.y = expansionIsland.y + 10;
    builder.status = 'idle';
    builder.targetX = undefined;
    builder.targetY = undefined;
    builder.path = undefined;

    bot.buildRetryCooldownUntil.clear();
    myIslands = gameState.map.islands.filter(
        island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId)
    );
    myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageAirStrategy(gameState, gameState.players.get(botId)!, myIslands, myUnits);

    const airBase = expansionIsland.buildings.find(building => building.type === 'air_base' && building.ownerId === botId);
    assert(!!airBase, 'once a builder reaches the island, the bot should be able to place the air base there');

    console.log(JSON.stringify({
        directBuildDeniedWithoutBuilder: directBuildResult === false,
        builderMovedAcrossBridgeFirst: builder.status === 'idle' || builder.status === 'moving',
        builderPathPointsBeforeTransfer,
        airBaseBuiltAfterBuilderArrival: !!airBase
    }, null, 2));
}

main();
