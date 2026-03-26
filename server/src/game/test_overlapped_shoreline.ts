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

function createBuilder(ownerId: string, x: number, y: number) {
    const stats = UnitData.builder;
    return {
        id: `builder_${ownerId}`,
        ownerId,
        type: 'builder',
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

function main() {
    const playerId = 'shore-player';
    const leftIsland = createIsland('left', 400, 400, 160, playerId);
    const rightIsland = createIsland('right', 620, 400, 160, playerId);

    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = {
        width: 1400,
        height: 1000,
        islands: [leftIsland, rightIsland],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'islands'
    } as GameMap;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, false, 'Shore Player');
    gameState.players.get(playerId)!.resources = { gold: 5000, oil: 5000 };
    gameState.units.push(createBuilder(playerId, 400, 400) as any);

    const overlapInnerX = 545;
    const overlapInnerY = 400;
    const outerShoreX = 255;
    const outerShoreY = 400;

    assert(
        !(gameState as any).isPointOnExposedIslandShoreline(leftIsland, overlapInnerX, overlapInnerY),
        'buried overlap edge should not count as shoreline'
    );
    assert(
        (gameState as any).isPointOnExposedIslandShoreline(leftIsland, outerShoreX, outerShoreY),
        'outer coast should still count as shoreline'
    );

    const buriedDockBuilt = gameState.buildStructure(playerId, leftIsland.id, 'dock', overlapInnerX, overlapInnerY);
    assert(!buriedDockBuilt, 'dock should not build on overlapped internal shoreline');

    const exposedDockBuilt = gameState.buildStructure(playerId, leftIsland.id, 'dock', outerShoreX, outerShoreY);
    assert(exposedDockBuilt, 'dock should still build on exposed shoreline');

    console.log(JSON.stringify({
        buriedDockBuilt,
        exposedDockBuilt
    }, null, 2));
}

main();
