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
    const playerId = 'attacker';
    const enemyId = 'defender';
    const enemyIsland = createIsland('enemy_island', 500, 380, 140, enemyId);

    const map: GameMap = {
        width: 1200,
        height: 900,
        islands: [enemyIsland],
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

    gameState.addPlayer(playerId, false, 'Attacker');
    gameState.addPlayer(enemyId, false, 'Defender');

    const attacker = gameState.players.get(playerId);
    if (!attacker) {
        throw new Error('attacker player not found');
    }
    attacker.resources = { gold: 5000, oil: 5000 };

    const blockedWithoutBuilder = gameState.buildStructure(playerId, enemyIsland.id, 'bridge_node', enemyIsland.x, enemyIsland.y);
    assert(!blockedWithoutBuilder, 'enemy-land bridge node should still require a worker in range');

    gameState.units.push(createBuilder(playerId, enemyIsland.x + 12, enemyIsland.y));

    const bridgeNodeBuilt = gameState.buildStructure(playerId, enemyIsland.id, 'bridge_node', enemyIsland.x, enemyIsland.y);
    assert(bridgeNodeBuilt, 'bridge node should build on enemy-owned land when a worker is nearby');

    const barracksBuilt = gameState.buildStructure(playerId, enemyIsland.id, 'barracks', enemyIsland.x + 56, enemyIsland.y);
    assert(barracksBuilt, 'barracks should build on enemy-owned land when a builder is nearby');

    console.log(JSON.stringify({
        blockedWithoutBuilder,
        bridgeNodeBuilt,
        barracksBuilt,
        enemyIslandBuildings: enemyIsland.buildings.map(building => ({
            type: building.type,
            ownerId: building.ownerId
        }))
    }, null, 2));
}

main();
