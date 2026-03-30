import { GameState } from './GameState';
import { GameMap, Island, MapGenerator } from './MapGenerator';
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
        type: 'desert',
        ownerId,
        buildings: [],
        goldSpots: []
    };
}

function createBuilder(ownerId: string, x: number, y: number) {
    const stats = UnitData.builder;
    return {
        id: `builder_${ownerId}_${Math.random()}`,
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
    const playerId = 'player-1';
    const island = createIsland('island_1', 400, 400, 180, playerId);
    island.buildings.push({
        id: 'base_1',
        type: 'base',
        level: 1,
        health: 1000,
        maxHealth: 1000,
        x: 0,
        y: 0,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100
    } as any);

    const highGround = {
        id: 'hg_1',
        x: 460,
        y: 400,
        radius: 32,
        points: [
            { x: 430, y: 372 },
            { x: 490, y: 372 },
            { x: 490, y: 428 },
            { x: 430, y: 428 }
        ]
    };

    const map: GameMap = {
        width: 1200,
        height: 900,
        islands: [island],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        highGrounds: [highGround],
        mapType: 'desert'
    };

    const gameState = new GameState('desert');
    gameState.mapType = 'desert';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId);

    const player = gameState.players.get(playerId);
    if (!player) {
        throw new Error('player not found');
    }
    player.resources = { gold: 5000, oil: 5000 };

    gameState.units.push(createBuilder(playerId, 345, 400));

    const blockedWalk = gameState.isValidPosition(460, 400, 'builder');
    assert(!blockedWalk, 'land units should not be able to stand on high ground');

    const adjusted = gameState.adjustTarget('builder', 460, 400);
    assert(!MapGenerator.isPointInPolygon(adjusted.x, adjusted.y, highGround.points), 'adjustTarget should push land units off high ground');

    const blockedBuild = gameState.buildStructure(playerId, island.id, 'barracks', 460, 400);
    assert(!blockedBuild, 'buildings should not be placeable on high ground');

    const openBuild = gameState.buildStructure(playerId, island.id, 'barracks', 300, 400);
    assert(openBuild, 'normal land outside high ground should still allow building');

    console.log(JSON.stringify({
        blockedWalk,
        adjusted,
        blockedBuild,
        openBuild
    }, null, 2));
}

main();
