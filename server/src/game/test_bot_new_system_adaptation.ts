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

function createUnit(ownerId: string, type: string, x: number, y: number) {
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
        facingAngle: 0
    };
}

function primeBot(bot: any) {
    bot.startTime = Date.now() - 360000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;
    bot.maxApmTokens = 999;
    bot.minBuildDelay = 0;
    bot.maxBuildDelay = 0;
    bot.currentBuildDelay = 0;
    bot.lastBuildTime = 0;
    bot.baseDefenseBuilder.debugState.towersBuilt = 2;
    bot.baseDefenseBuilder.debugState.wallNodesPlaced = 6;
    bot.baseDefenseBuilder.debugState.wallConnectionsMade = 1;
}

function runForwardBridgeheadAirbaseScenario() {
    const botId = 'forward-bot';
    const enemyId = 'forward-enemy';
    const homeIsland = createIsland('home', 320, 380, 125, botId);
    const bridgeheadIsland = createIsland('bridgehead', 680, 380, 120);
    const enemyIsland = createIsland('enemy', 1030, 380, 130, enemyId);
    addBuilding(homeIsland, 'base', botId, 0, 0);
    addBuilding(homeIsland, 'dock', botId, 18, -88);
    addBuilding(bridgeheadIsland, 'bridge_node', botId, -98, 0);
    addBuilding(enemyIsland, 'base', enemyId, 0, 0);

    const ownedOilSpot: OilSpot = {
        id: 'owned_oil',
        x: 500,
        y: 560,
        radius: 18,
        occupiedBy: 'owned_oil_rig'
    };
    (ownedOilSpot as any).ownerId = botId;
    (ownedOilSpot as any).building = {
        id: 'owned_oil_rig',
        type: 'oil_rig',
        ownerId: botId,
        health: BuildingData.oil_rig.maxHealth,
        maxHealth: BuildingData.oil_rig.maxHealth,
        isConstructing: false
    };

    const map: GameMap = {
        width: 1600,
        height: 1000,
        islands: [homeIsland, bridgeheadIsland, enemyIsland],
        oilSpots: [ownedOilSpot],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, false, 'Forward Bot');
    gameState.addPlayer(enemyId, false, 'Enemy');
    gameState.players.get(botId)!.resources = { gold: 20000, oil: 10000 };

    gameState.units.push(
        createUnit(botId, 'builder', bridgeheadIsland.x - 20, bridgeheadIsland.y),
        createUnit(botId, 'builder', homeIsland.x + 30, homeIsland.y + 20),
        createUnit(botId, 'construction_ship', 470, 380)
    );

    const bot = new BotAI(botId, 10) as any;
    primeBot(bot);

    let myIslands = gameState.map.islands.filter(island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId));
    let myUnits = gameState.units.filter(unit => unit.ownerId === botId);

    bot.runIslandsStrategy(gameState, gameState.players.get(botId)!, myIslands, myUnits);
    const forwardDock = bridgeheadIsland.buildings.find(building => building.type === 'dock' && building.ownerId === botId);
    assert(!!forwardDock, 'level 10 islands bot should turn a bridgehead island into a dock expansion point');

    forwardDock!.isConstructing = false;
    forwardDock!.constructionProgress = 100;
    forwardDock!.health = forwardDock!.maxHealth;

    myIslands = gameState.map.islands.filter(island => island.ownerId === botId || island.buildings.some(building => building.ownerId === botId));
    myUnits = gameState.units.filter(unit => unit.ownerId === botId);

    bot.usedUnitIds.clear();
    bot.apmTokens = 999;
    bot.manageAirStrategy(gameState, gameState.players.get(botId)!, myIslands, myUnits);

    const bridgeheadAirBase = bridgeheadIsland.buildings.find(building => building.type === 'air_base' && building.ownerId === botId);
    assert(!!bridgeheadAirBase, 'level 10 islands bot should prioritize an air base on the new bridgehead once the dock is established');

    return {
        dockBuiltOnBridgehead: !!forwardDock,
        airBaseBuiltOnBridgehead: !!bridgeheadAirBase
    };
}

function runBurnRepairResponseScenario() {
    const botId = 'repair-bot';
    const enemyId = 'repair-enemy';
    const island = createIsland('repair_island', 700, 520, 210, botId);
    addBuilding(island, 'base', botId, 0, 0);
    addBuilding(island, 'repair_dock', botId, 28, 0);

    const map: GameMap = {
        width: 1500,
        height: 1000,
        islands: [island],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, false, 'Repair Bot');
    gameState.addPlayer(enemyId, false, 'Enemy');

    const destroyer = createUnit(botId, 'destroyer', island.x - 280, island.y + 110) as any;
    destroyer.health = destroyer.maxHealth * 0.92;
    destroyer.damageOverTimeEffects = [{
        type: 'naval_mine_burn',
        endsAt: Date.now() + 12000,
        damagePerSecond: destroyer.maxHealth * 0.05
    }];
    destroyer.burningUntil = Date.now() + 12000;
    gameState.units.push(destroyer);

    const bot = new BotAI(botId, 9) as any;
    primeBot(bot);
    bot.usedUnitIds.clear();
    bot.manageArmyHealing(gameState, gameState.units.filter(unit => unit.ownerId === botId), [island]);

    assert(destroyer.status === 'moving', 'burning naval units should retreat to a repair dock immediately');

    return {
        destroyerStatus: destroyer.status,
        retreatTarget: { x: destroyer.targetX, y: destroyer.targetY }
    };
}

function runDockMineCoverageScenario() {
    const botId = 'mine-bot';
    const enemyId = 'mine-enemy';
    const island = createIsland('mine_island', 420, 420, 120, botId);
    const enemyIsland = createIsland('mine_enemy_island', 980, 420, 120, enemyId);
    addBuilding(island, 'base', botId, 0, 0);
    addBuilding(island, 'dock', botId, 95, 0);
    addBuilding(enemyIsland, 'base', enemyId, 0, 0);

    const map: GameMap = {
        width: 1500,
        height: 1000,
        islands: [island, enemyIsland],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, false, 'Mine Bot');
    gameState.addPlayer(enemyId, false, 'Enemy');
    gameState.players.get(botId)!.resources = { gold: 5000, oil: 5000 };

    gameState.units.push(createUnit(botId, 'construction_ship', 575, 420));

    const bot = new BotAI(botId, 10) as any;
    primeBot(bot);
    bot.usedUnitIds.clear();
    bot.manageNavalMineDefence(gameState, gameState.players.get(botId)!, [island], gameState.units.filter(unit => unit.ownerId === botId));

    const mine = (gameState.map.waterBuildings || []).find(building => building.type === 'naval_mine' && building.ownerId === botId);
    assert(!!mine, 'high-difficulty islands bot should mine around docks/chokepoints even without owning an offshore oil spot');

    return {
        mineCount: (gameState.map.waterBuildings || []).length,
        minePosition: { x: mine!.x, y: mine!.y }
    };
}

function main() {
    const forwardBridgehead = runForwardBridgeheadAirbaseScenario();
    const burnRepair = runBurnRepairResponseScenario();
    const dockMineCoverage = runDockMineCoverageScenario();

    console.log(JSON.stringify({
        forwardBridgehead,
        burnRepair,
        dockMineCoverage
    }, null, 2));
}

main();
