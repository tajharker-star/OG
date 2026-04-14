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

function addUnit(gameState: GameState, ownerId: string, type: string, x: number, y: number, id: string) {
    gameState.units.push({
        id,
        ownerId,
        type,
        x,
        y,
        health: 1000,
        maxHealth: 1000,
        speed: 0,
        damage: 0,
        range: 0,
        fireRate: 1000,
        status: 'idle',
        cargo: [],
        recruitmentQueue: []
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

function countUnitQueueType(gameState: GameState, type: string): number {
    return gameState.units.reduce((count, unit: any) => {
        return count + ((unit.recruitmentQueue || []).filter((entry: any) => entry.unitType === type).length);
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

    const priorityLevel9 = buildScenario(9, 2, 4 * 60 * 1000);
    const level9Islands = priorityLevel9.gameState.map.islands.filter(island => island.ownerId === priorityLevel9.playerId);
    const level9Units = priorityLevel9.gameState.units.filter(unit => unit.ownerId === priorityLevel9.playerId);
    priorityLevel9.bot.manageAirStrategy(
        priorityLevel9.gameState,
        priorityLevel9.gameState.players.get(priorityLevel9.playerId)!,
        level9Islands,
        level9Units
    );

    const level9QueuedMotherships = countQueuedType(priorityLevel9.island, 'mothership');
    const level9QueuedLightPlanes = countQueuedType(priorityLevel9.island, 'light_plane');
    const level9QueuedHeavyPlanes = countQueuedType(priorityLevel9.island, 'heavy_plane');
    const level9QueuedCarriers = countQueuedType(priorityLevel9.island, 'aircraft_carrier');
    assert(level9QueuedMotherships >= 1, 'level 9 bots should queue motherships as a mid-game priority once oil and air are online');
    assert(level9QueuedLightPlanes === 0, 'level 9 bots should preserve oil instead of queueing light planes while motherships are still below target');
    assert(level9QueuedHeavyPlanes === 0, 'level 9 bots should preserve oil instead of queueing heavy planes while motherships are still below target');
    assert(level9QueuedCarriers === 0, 'level 9 bots should not queue carriers ahead of their first mothership');
    assert(priorityLevel9.bot.debugState.airStrategy.highTierMothershipPriorityMode === true, 'level 9 air strategy should report high-tier mothership priority mode');

    const priorityLevel10 = buildScenario(10, 3, 4 * 60 * 1000);
    const level10PriorityIslands = priorityLevel10.gameState.map.islands.filter(island => island.ownerId === priorityLevel10.playerId);
    const level10PriorityUnits = priorityLevel10.gameState.units.filter(unit => unit.ownerId === priorityLevel10.playerId);
    priorityLevel10.bot.manageAirStrategy(
        priorityLevel10.gameState,
        priorityLevel10.gameState.players.get(priorityLevel10.playerId)!,
        level10PriorityIslands,
        level10PriorityUnits
    );

    const level10QueuedLightPlanes = countQueuedType(priorityLevel10.island, 'light_plane');
    const level10QueuedHeavyPlanes = countQueuedType(priorityLevel10.island, 'heavy_plane');
    const level10QueuedCarriers = countQueuedType(priorityLevel10.island, 'aircraft_carrier');
    assert(level10QueuedLightPlanes === 0, 'level 10 bots should not leak oil into light planes while chasing mothership targets');
    assert(level10QueuedHeavyPlanes === 0, 'level 10 bots should not leak oil into heavy planes while chasing mothership targets');
    assert(level10QueuedCarriers === 0, 'level 10 bots should not queue carriers before their first mothership is established');
    assert(priorityLevel10.bot.debugState.airStrategy.highTierMothershipPriorityMode === true, 'level 10 air strategy should report high-tier mothership priority mode');

    const overflowScenario = buildScenario(10, 3, 8 * 60 * 1000);
    addUnit(overflowScenario.gameState, overflowScenario.playerId, 'mothership', 620, 420, 'overflow_ms_1');
    addUnit(overflowScenario.gameState, overflowScenario.playerId, 'mothership', 680, 420, 'overflow_ms_2');
    addUnit(overflowScenario.gameState, overflowScenario.playerId, 'mothership', 650, 470, 'overflow_ms_3');
    overflowScenario.gameState.players.get(overflowScenario.playerId)!.resources = { gold: 30000, oil: 6000 };
    const overflowIslands = overflowScenario.gameState.map.islands.filter(island => island.ownerId === overflowScenario.playerId);
    const overflowUnits = overflowScenario.gameState.units.filter(unit => unit.ownerId === overflowScenario.playerId);
    overflowScenario.bot.manageAirStrategy(
        overflowScenario.gameState,
        overflowScenario.gameState.players.get(overflowScenario.playerId)!,
        overflowIslands,
        overflowUnits
    );

    const queuedAlienScouts = countUnitQueueType(overflowScenario.gameState, 'alien_scout');
    const queuedHeavyAliens = countUnitQueueType(overflowScenario.gameState, 'heavy_alien');
    assert(queuedAlienScouts + queuedHeavyAliens >= 1, 'high-tier bots with 3 motherships and >1k oil should spend overflow on alien offspring air units');

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
        },
        priorityFocus: {
            level9: {
                queuedMotherships: level9QueuedMotherships,
                queuedLightPlanes: level9QueuedLightPlanes,
                queuedHeavyPlanes: level9QueuedHeavyPlanes,
                queuedCarriers: level9QueuedCarriers,
                highTierMothershipPriorityMode: priorityLevel9.bot.debugState.airStrategy.highTierMothershipPriorityMode
            },
            level10: {
                queuedLightPlanes: level10QueuedLightPlanes,
                queuedHeavyPlanes: level10QueuedHeavyPlanes,
                queuedCarriers: level10QueuedCarriers,
                highTierMothershipPriorityMode: priorityLevel10.bot.debugState.airStrategy.highTierMothershipPriorityMode
            }
        },
        overflowSpend: {
            queuedAlienScouts,
            queuedHeavyAliens
        }
    }, null, 2));
}

main();
