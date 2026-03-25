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

function createUnit(ownerId: string, type: 'construction_ship', x: number, y: number) {
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

function finishBridgeNodes(gameState: GameState, playerId: string) {
    gameState.map.islands.forEach(island => {
        island.buildings.forEach(building => {
            if (building.type === 'bridge_node' && building.ownerId === playerId) {
                building.isConstructing = false;
                building.constructionProgress = 100;
                building.health = building.maxHealth;
            }
        });
    });
    (gameState.map.waterBuildings || []).forEach(building => {
        if (building.type === 'bridge_node' && building.ownerId === playerId) {
            building.isConstructing = false;
            building.constructionProgress = 100;
            building.health = building.maxHealth;
        }
    });
}

function main() {
    const playerId = 'bridge-chain';
    const homeIsland = createIsland('home', 260, 420, 120, playerId);
    const targetIsland = createIsland('target', 1180, 420, 120);

    const map: GameMap = {
        width: 1600,
        height: 900,
        islands: [homeIsland, targetIsland],
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
    gameState.addPlayer(playerId, false, 'Bridge Chain');
    gameState.players.get(playerId)!.resources = { gold: 5000, oil: 5000 };

    homeIsland.buildings.push({
        id: 'base_home',
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

    gameState.units.push(
        createUnit(playerId, 'construction_ship', 410, 420),
        createUnit(playerId, 'construction_ship', 710, 420),
        createUnit(playerId, 'construction_ship', 1030, 420)
    );

    const sourceNodeBuilt = gameState.buildStructure(playerId, gameState.units[0].id, 'bridge_node', 374, 420);
    const waterNodeBuilt = gameState.buildStructure(playerId, gameState.units[1].id, 'bridge_node', 720, 420);
    const targetNodeBuilt = gameState.buildStructure(playerId, gameState.units[2].id, 'bridge_node', 1066, 420);
    assert(sourceNodeBuilt, 'source bridge node should build on land from construction ship support');
    assert(waterNodeBuilt, 'middle bridge node should build in open water');
    assert(targetNodeBuilt, 'target bridge node should build on land from construction ship support');

    finishBridgeNodes(gameState, playerId);

    const nodeIds = [
        homeIsland.buildings.find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id,
        (gameState.map.waterBuildings || []).find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id,
        targetIsland.buildings.find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id
    ];
    assert(nodeIds.every(Boolean), 'all planned bridge nodes should exist');

    gameState.connectNodes(playerId, nodeIds[0]!, nodeIds[1]!);
    gameState.connectNodes(playerId, nodeIds[1]!, nodeIds[2]!);
    assert(gameState.map.bridges.length === 2, 'bridge chain should create two linear bridge segments');

    const traversal = gameState.findIslandTraversalPath(homeIsland.id, targetIsland.id);
    assert(Array.isArray(traversal) && traversal.includes(`node:${nodeIds[1]}`), 'island traversal should route through the water bridge node');

    const bridgeAtMidpoint = gameState.getBridgeAt(720, 420);
    assert(!!bridgeAtMidpoint, 'bridge midpoint should be recognized as traversable bridge surface');

    const goldBeforeLoopAttempt = gameState.players.get(playerId)!.resources.gold;
    gameState.connectNodes(playerId, nodeIds[2]!, nodeIds[0]!);
    assert(gameState.map.bridges.length === 2, 'bridge chains should reject loop closures');
    assert(gameState.players.get(playerId)!.resources.gold === goldBeforeLoopAttempt, 'loop rejection should not charge resources');

    console.log(JSON.stringify({
        bridgeSegments: gameState.map.bridges.length,
        traversalPath: traversal,
        waterBridgeNodeId: nodeIds[1]
    }, null, 2));
}

main();
