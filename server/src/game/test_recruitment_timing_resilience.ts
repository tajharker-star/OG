import { GameState } from './GameState';
import { GameMap, Island } from './MapGenerator';
import { UnitData } from './data/Registry';

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

function main() {
    const playerId = 'timing-player';
    const island = createIsland('home', 400, 300, 160, playerId);
    const barracks = {
        id: 'barracks_home',
        type: 'barracks',
        level: 1,
        health: 1000,
        maxHealth: 1000,
        x: 0,
        y: 0,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        recruitmentQueue: [
            { unitType: 'soldier', progress: 0, totalTime: UnitData.soldier.constructionTime || 100 },
            { unitType: 'soldier', progress: 0, totalTime: UnitData.soldier.constructionTime || 100 }
        ]
    } as any;
    island.buildings.push(barracks);

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = {
        width: 1200,
        height: 900,
        islands: [island],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    } as GameMap;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, false, 'Timing Player');

    (gameState as any).advanceConstructionRepairAndRecruitment(1.5);
    const unitsAfterShortDelay = gameState.units.filter(unit => unit.ownerId === playerId && unit.type === 'soldier').length;
    assert(unitsAfterShortDelay === 0, 'soldier should not spawn before its full real-time recruitment duration passes');
    assert(barracks.recruitmentQueue.length === 2, 'queue should remain intact after partial progress');

    (gameState as any).advanceConstructionRepairAndRecruitment(1.5);
    const unitsAfterThreeSeconds = gameState.units.filter(unit => unit.ownerId === playerId && unit.type === 'soldier').length;
    assert(unitsAfterThreeSeconds === 1, 'one soldier should spawn after three real seconds even with split slow updates');
    assert(barracks.recruitmentQueue.length === 1, 'one queued soldier should remain after the first full recruitment duration');

    (gameState as any).advanceConstructionRepairAndRecruitment(3.2);
    const finalSoldierCount = gameState.units.filter(unit => unit.ownerId === playerId && unit.type === 'soldier').length;
    assert(finalSoldierCount === 2, 'second soldier should also spawn after another delayed real-time step');
    assert(barracks.recruitmentQueue.length === 0, 'queue should fully drain after enough real time elapses');

    console.log(JSON.stringify({
        unitsAfterShortDelay,
        unitsAfterThreeSeconds,
        finalSoldierCount
    }, null, 2));
}

main();
