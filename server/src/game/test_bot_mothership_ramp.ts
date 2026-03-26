import { GameState } from './GameState';
import { BotAI } from './BotAI';
import { GameMap, Island } from './MapGenerator';

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
    island.buildings.push({
        id: id || `${type}_${ownerId}_${Math.random()}`,
        type,
        level: 1,
        health: 1000,
        maxHealth: 1000,
        x,
        y,
        ownerId,
        isConstructing: false,
        constructionProgress: 100
    } as any);
}

function buildScenario(botLevel: number, airBaseCount: number, phaseStartOffsetMs: number) {
    const playerId = `bot_${botLevel}`;
    const island = createIsland(`island_${botLevel}`, 640, 420, 220, playerId);
    addBuilding(island, 'base', playerId, 0, 0, `base_${botLevel}`);
    addBuilding(island, 'dock', playerId, 60, -80, `dock_${botLevel}`);
    addBuilding(island, 'barracks', playerId, -80, 50, `barracks_${botLevel}`);
    addBuilding(island, 'oil_well', playerId, -110, -40, `oil_${botLevel}`);

    for (let i = 0; i < airBaseCount; i += 1) {
        addBuilding(island, 'air_base', playerId, -20 + i * 55, 110, `airbase_${botLevel}_${i}`);
    }

    const map: GameMap = {
        width: 1600,
        height: 1000,
        islands: [island],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'grasslands'
    };

    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, true, `Bot ${botLevel}`, botLevel);
    gameState.players.get(playerId)!.resources = { gold: 12000, oil: 5000 };

    const bot = new BotAI(playerId, botLevel) as any;
    bot.startTime = Date.now() - phaseStartOffsetMs;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;
    bot.baseDefenseBuilder.debugState.towersBuilt = 6;
    bot.baseDefenseBuilder.debugState.wallNodesPlaced = 8;
    bot.baseDefenseBuilder.debugState.wallConnectionsMade = 1;

    return {
        bot,
        gameState,
        island,
        playerId
    };
}

function countQueuedType(island: Island, type: string): number {
    return island.buildings.reduce((count, building) => {
        return count + (building.recruitmentQueue || []).filter(entry => entry.unitType === type).length;
    }, 0);
}

function main() {
    const savingsIntervals = [];
    for (let level = 1; level <= 10; level += 1) {
        const scenario = buildScenario(level, 1, 6 * 60 * 1000);
        const intervalMs = scenario.bot.getMothershipSavingsIntervalMs();
        savingsIntervals.push({
            level,
            intervalMs
        });
    }

    assert(savingsIntervals[0].intervalMs === 10 * 60 * 1000, 'level 1 mothership saving interval should be 10 minutes');
    assert(savingsIntervals[9].intervalMs === 3 * 60 * 1000, 'level 10 mothership saving interval should be 3 minutes');
    for (let index = 1; index < savingsIntervals.length; index += 1) {
        assert(
            savingsIntervals[index].intervalMs < savingsIntervals[index - 1].intervalMs,
            'higher bot levels should save for motherships more frequently than lower levels'
        );
    }

    const allLevelsLate = [];
    for (let level = 1; level <= 10; level += 1) {
        const lateScenario = buildScenario(level, 1, 6 * 60 * 1000);
        const desiredAirBasesLate = lateScenario.bot.getDesiredAirBaseCount('grasslands', true, 'LATE');
        assert(desiredAirBasesLate >= 1, `level ${level} bots should want at least one air base in late game when oil is online`);

        const myIslands = lateScenario.gameState.map.islands.filter(island => island.ownerId === lateScenario.playerId);
        const myUnits = lateScenario.gameState.units.filter(unit => unit.ownerId === lateScenario.playerId);
        lateScenario.bot.manageAirStrategy(
            lateScenario.gameState,
            lateScenario.gameState.players.get(lateScenario.playerId)!,
            myIslands,
            myUnits
        );

        const queuedMotherships = countQueuedType(lateScenario.island, 'mothership');
        assert(queuedMotherships >= 1, `level ${level} bots should queue a mothership in late game once oil production and an air base exist`);
        allLevelsLate.push({
            level,
            desiredAirBasesLate,
            queuedMotherships
        });
    }

    const savingsScenario = buildScenario(10, 1, 6 * 60 * 1000);
    savingsScenario.bot.firstAirBaseBuiltAt = Date.now() - savingsScenario.bot.getMothershipSavingsIntervalMs();
    savingsScenario.bot.nextMothershipSavingsAt = Date.now() - 1000;
    savingsScenario.bot.mothershipSavingsActive = false;
    const savingsIslands = savingsScenario.gameState.map.islands.filter(island => island.ownerId === savingsScenario.playerId);
    const savingsUnits = savingsScenario.gameState.units.filter(unit => unit.ownerId === savingsScenario.playerId);
    savingsScenario.bot.manageAirStrategy(
        savingsScenario.gameState,
        savingsScenario.gameState.players.get(savingsScenario.playerId)!,
        savingsIslands,
        savingsUnits
    );

    const queuedLightPlanesDuringSave = countQueuedType(savingsScenario.island, 'light_plane');
    const queuedHeavyPlanesDuringSave = countQueuedType(savingsScenario.island, 'heavy_plane');
    const queuedCarriersDuringSave = countQueuedType(savingsScenario.island, 'aircraft_carrier');
    const queuedMothershipsDuringSave = countQueuedType(savingsScenario.island, 'mothership');
    assert(queuedMothershipsDuringSave >= 1, 'active mothership savings should queue a mothership once the interval matures');
    assert(queuedLightPlanesDuringSave === 0, 'bots should not spend oil on light planes during an active mothership saving window');
    assert(queuedHeavyPlanesDuringSave === 0, 'bots should not spend oil on heavy planes during an active mothership saving window');
    assert(queuedCarriersDuringSave === 0, 'bots should not spend oil on carriers during an active mothership saving window');

    const midLevel10 = buildScenario(10, 3, 4 * 60 * 1000);
    const myIslands = midLevel10.gameState.map.islands.filter(island => island.ownerId === midLevel10.playerId);
    const myUnits = midLevel10.gameState.units.filter(unit => unit.ownerId === midLevel10.playerId);
    midLevel10.bot.manageAirStrategy(midLevel10.gameState, midLevel10.gameState.players.get(midLevel10.playerId)!, myIslands, myUnits);

    const level10QueuedMotherships = countQueuedType(midLevel10.island, 'mothership');
    const airBasesWithMothershipQueue = midLevel10.island.buildings.filter(building =>
        building.type === 'air_base' &&
        (building.recruitmentQueue || []).some(entry => entry.unitType === 'mothership')
    ).length;

    assert(level10QueuedMotherships >= 2, 'level 10 bots should queue multiple motherships once mid-game oil production is online');
    assert(airBasesWithMothershipQueue >= 2, 'level 10 bots should spread mothership production across dedicated air bases');

    console.log(JSON.stringify({
        savingsIntervals,
        allLevelsLate,
        savingsLock: {
            queuedMothershipsDuringSave,
            queuedLightPlanesDuringSave,
            queuedHeavyPlanesDuringSave,
            queuedCarriersDuringSave
        },
        level10: {
            queuedMothershipsMid: level10QueuedMotherships,
            airBasesWithMothershipQueue
        }
    }, null, 2));
}

main();
