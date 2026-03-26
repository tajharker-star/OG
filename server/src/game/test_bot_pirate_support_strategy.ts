import { GameState } from './GameState';
import { createBotAI } from './BotAIFactory';
import { BuildingData, UnitData } from './data/Registry';
import { GameMap, Island, OilSpot } from './MapGenerator';

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
}

function createIsland(id: string, x: number, y: number, radius: number, type: Island['type'], ownerId?: string): Island {
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
    });
}

function createBaseMap(botId: string, enemyId: string): { gameState: GameState; botIsland: Island; enemyIsland: Island } {
    const botIsland = createIsland('bot_island', 500, 500, 260, 'grasslands', botId);
    const enemyIsland = createIsland('enemy_island', 1200, 700, 260, 'grasslands', enemyId);
    addBuilding(botIsland, 'base', botId, 0, 0);
    addBuilding(botIsland, 'dock', botId, 180, 0);
    addBuilding(enemyIsland, 'base', enemyId, 0, 0);

    const map: GameMap = {
        width: 2000,
        height: 1400,
        islands: [botIsland, enemyIsland],
        oilSpots: [],
        bridges: [],
        mapType: 'islands'
    };

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, false, 'Bot');
    gameState.addPlayer(enemyId, false, 'Enemy');
    const botPlayer = gameState.players.get(botId);
    const enemyPlayer = gameState.players.get(enemyId);
    assert(!!botPlayer && !!enemyPlayer, 'failed to create players');
    botPlayer!.resources = { gold: 10000, oil: 5000 };
    enemyPlayer!.resources = { gold: 10000, oil: 5000 };

    return { gameState, botIsland, enemyIsland };
}

function runLowDifficultyPirateSpamScenario() {
    const botId = 'bot-low';
    const enemyId = 'enemy-low';
    const { gameState, botIsland } = createBaseMap(botId, enemyId);
    const bot = createBotAI(botId, 2) as any;
    const botPlayer = gameState.players.get(botId)!;
    const myIslands = [botIsland];
    const myUnits = gameState.units.filter(unit => unit.ownerId === botId);

    for (let i = 0; i < 3; i += 1) {
        bot.managePirateShipPressure(gameState, botPlayer, myIslands, myUnits, true, 0);
    }

    const dock = botIsland.buildings.find(building => building.type === 'dock' && building.ownerId === botId);
    assert(!!dock, 'dock missing for low difficulty scenario');
    const pirateQueued = (dock!.recruitmentQueue || []).filter(entry => entry.unitType === 'pirate_ship').length;
    assert(pirateQueued >= 3, `expected low difficulty pirate spam queue >= 3, got ${pirateQueued}`);

    return { pirateQueued };
}

function runHighDifficultyOilRaidScenario() {
    const botId = 'bot-high';
    const enemyId = 'enemy-high';
    const { gameState, botIsland } = createBaseMap(botId, enemyId);
    const bot = createBotAI(botId, 9) as any;
    const botPlayer = gameState.players.get(botId)!;
    const myIslands = [botIsland];

    const enemyOilSpot: OilSpot = {
        id: 'enemy_oil_0',
        x: 1040,
        y: 600,
        radius: 20,
        occupiedBy: 'enemy_oil_rig_0'
    };
    (enemyOilSpot as any).ownerId = enemyId;
    (enemyOilSpot as any).building = {
        id: 'enemy_oil_rig_0',
        type: 'oil_rig',
        ownerId: enemyId,
        health: BuildingData.oil_rig.maxHealth,
        maxHealth: BuildingData.oil_rig.maxHealth,
        isConstructing: false
    };
    gameState.map.oilSpots.push(enemyOilSpot);

    const pirateUnit = {
        id: 'pirate_high_0',
        ownerId: botId,
        type: 'pirate_ship',
        x: 680,
        y: 520,
        status: 'idle' as const,
        health: UnitData.pirate_ship.maxHealth,
        maxHealth: UnitData.pirate_ship.maxHealth,
        damage: UnitData.pirate_ship.damage,
        range: UnitData.pirate_ship.range,
        speed: UnitData.pirate_ship.speed,
        fireRate: UnitData.pirate_ship.fireRate
    };
    gameState.units.push(pirateUnit as any);

    const raidTarget = bot.findHighValueNavalTarget(gameState, pirateUnit as any, botPlayer);
    assert(!!raidTarget, 'expected pirate raid target');
    assert(raidTarget!.type === 'PIRATE_OIL_RAID', `expected PIRATE_OIL_RAID target type, got ${raidTarget!.type}`);

    bot.managePirateShipPressure(gameState, botPlayer, myIslands, gameState.units.filter(unit => unit.ownerId === botId), true, 0);
    const dock = botIsland.buildings.find(building => building.type === 'dock' && building.ownerId === botId);
    assert(!!dock, 'dock missing for high difficulty scenario');
    const pirateQueued = (dock!.recruitmentQueue || []).filter(entry => entry.unitType === 'pirate_ship').length;
    assert(pirateQueued >= 1, `expected high difficulty pirate recruitment, got queue=${pirateQueued}`);

    return {
        raidType: raidTarget!.type,
        raidX: raidTarget!.x,
        raidY: raidTarget!.y,
        pirateQueued
    };
}

function runSupportHealingMovementScenario() {
    const botId = 'bot-support';
    const enemyId = 'enemy-support';
    const island = createIsland('support_island', 800, 650, 300, 'grasslands', botId);
    addBuilding(island, 'base', botId, 0, 0);
    addBuilding(island, 'hospital', botId, -30, 0);
    addBuilding(island, 'repair_dock', botId, 30, 0);

    const map: GameMap = {
        width: 2000,
        height: 1400,
        islands: [island],
        oilSpots: [],
        bridges: [],
        mapType: 'grasslands'
    };

    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(botId, false, 'Support Bot');
    gameState.addPlayer(enemyId, false, 'Enemy');

    const soldier = {
        id: 'support_soldier',
        ownerId: botId,
        type: 'soldier',
        x: island.x - 280,
        y: island.y + 40,
        status: 'idle' as const,
        health: 20,
        maxHealth: UnitData.soldier.maxHealth,
        damage: UnitData.soldier.damage,
        range: UnitData.soldier.range,
        speed: UnitData.soldier.speed,
        fireRate: UnitData.soldier.fireRate
    };
    const tank = {
        id: 'support_tank',
        ownerId: botId,
        type: 'tank',
        x: island.x + 320,
        y: island.y - 30,
        status: 'idle' as const,
        health: 120,
        maxHealth: UnitData.tank.maxHealth,
        damage: UnitData.tank.damage,
        range: UnitData.tank.range,
        speed: UnitData.tank.speed,
        fireRate: UnitData.tank.fireRate
    };
    gameState.units.push(soldier as any, tank as any);

    const bot = createBotAI(botId, 7) as any;
    bot.usedUnitIds.clear();
    bot.manageArmyHealing(gameState, gameState.units.filter((unit: any) => unit.ownerId === botId), [island]);

    const soldierAfter = gameState.units.find(unit => unit.id === 'support_soldier');
    const tankAfter = gameState.units.find(unit => unit.id === 'support_tank');
    assert(!!soldierAfter && !!tankAfter, 'support units missing after healing pass');
    assert(soldierAfter!.status === 'moving', 'soldier should move toward hospital');
    assert(tankAfter!.status === 'moving', 'tank should move toward repair dock');

    return {
        soldierTarget: { x: soldierAfter!.targetX, y: soldierAfter!.targetY },
        tankTarget: { x: tankAfter!.targetX, y: tankAfter!.targetY }
    };
}

function main() {
    const low = runLowDifficultyPirateSpamScenario();
    const high = runHighDifficultyOilRaidScenario();
    const healing = runSupportHealingMovementScenario();

    console.log(JSON.stringify({
        lowDifficultyPirateSpam: low,
        highDifficultyOilRaid: high,
        supportHealingMovement: healing
    }, null, 2));
}

main();
