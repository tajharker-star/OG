import { GameState } from './GameState';
import { GameMap, Island } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function createSharedIsland(id: string, points: { x: number; y: number }[]): Island {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        id,
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5,
        radius: Math.max(maxX - minX, maxY - minY) * 0.5,
        points,
        type: 'grasslands',
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
    const playerId = 'shared-land-player';
    const leftLand = createSharedIsland('left_land', [
        { x: 120, y: 120 },
        { x: 340, y: 120 },
        { x: 340, y: 320 },
        { x: 120, y: 320 }
    ]);
    const rightLand = createSharedIsland('right_land', [
        { x: 342, y: 120 },
        { x: 620, y: 120 },
        { x: 620, y: 320 },
        { x: 342, y: 320 }
    ]);

    const seamX = 341;
    const seamY = 220;

    const map: GameMap = {
        width: 900,
        height: 500,
        islands: [leftLand, rightLand],
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
    gameState.addPlayer(playerId, false, 'Shared Land Tester', 1);
    gameState.players.get(playerId)!.resources = { gold: 5000, oil: 5000 };
    gameState.units.push(createBuilder(playerId, 300, 220) as any);

    const seamWalkable = gameState.isValidPosition(seamX, seamY, 'builder');
    assert(seamWalkable, 'builder should treat tiny inland shared-land seams as passable land');

    const placementClear =
        gameState.isBuildingPlacementClearOnIsland(leftLand, 'tower', seamX, seamY) ||
        gameState.isBuildingPlacementClearOnIsland(rightLand, 'tower', seamX, seamY);
    assert(placementClear, 'land building placement should accept shared-land seam positions that are not real coastlines');

    const built = gameState.buildStructure(playerId, leftLand.id, 'tower', seamX, seamY);
    assert(built, 'tower should build on the shared-land seam once phantom water boundaries are ignored');

    const builtTower = map.islands
        .flatMap(island => island.buildings)
        .find(building => building.type === 'tower' && building.ownerId === playerId);
    assert(!!builtTower, 'built tower should be stored on one of the shared-land islands');

    console.log(JSON.stringify({
        seamWalkable,
        placementClear,
        builtTowerIslandId: map.islands.find(island => island.buildings.includes(builtTower as any))?.id || null
    }, null, 2));
}

main();
