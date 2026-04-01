import { GameState } from './GameState';
import { GameMap, Island, MapGenerator } from './MapGenerator';
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

function createIo() {
    return {
        to() {
            return {
                emit() {
                    return undefined;
                }
            };
        }
    };
}

function distanceToNearestBridge(gameState: GameState, x: number, y: number) {
    let best = Number.POSITIVE_INFINITY;
    for (const bridge of gameState.map.bridges) {
        if (bridge.type !== 'bridge') continue;
        const endpoints = gameState.getBridgeEndpoints(bridge);
        if (!endpoints) continue;
        const closest = MapGenerator.getClosestPointOnSegment(x, y, endpoints.ax, endpoints.ay, endpoints.bx, endpoints.by);
        best = Math.min(best, Math.hypot(x - closest.x, y - closest.y));
    }
    return best;
}

function isPointOnIslandSurface(island: Island, x: number, y: number) {
    if (island.points) return MapGenerator.isPointInPolygon(x, y, island.points);
    return Math.hypot(x - island.x, y - island.y) <= island.radius;
}

async function main() {
    const playerId = 'bridge-turn';
    const homeIsland = createIsland('home', 260, 420, 120, playerId);
    const targetIsland = createIsland('target', 1180, 420, 120);

    const map: GameMap = {
        width: 1600,
        height: 1000,
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
    gameState.status = 'playing';
    gameState.matchState = 'IN_MATCH';
    (gameState as any).requireHumanReadyForBotStart = false;
    (gameState as any).botsReleasedForMatch = true;

    gameState.addPlayer(playerId, false, 'Bridge Turn');
    gameState.players.get(playerId)!.resources = { gold: 5000, oil: 5000 };

    homeIsland.buildings.push({
        id: 'base_home',
        type: 'base',
        level: 1,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
        x: 0,
        y: 0,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.base.range
    } as any);

    const builder: any = {
        id: 'builder_turn',
        ownerId: playerId,
        type: 'builder',
        x: 300,
        y: 420,
        status: 'idle' as const,
        health: UnitData.builder.maxHealth,
        maxHealth: UnitData.builder.maxHealth,
        damage: UnitData.builder.damage,
        range: UnitData.builder.range,
        speed: UnitData.builder.speed,
        fireRate: UnitData.builder.fireRate,
        facingAngle: 0
    };
    gameState.units.push(builder as any);

    homeIsland.buildings.push({
        id: 'bridge_node_home',
        type: 'bridge_node',
        level: 1,
        health: 100,
        maxHealth: 100,
        x: 96,
        y: 0,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.bridge_node.range
    } as any);

    (gameState.map.waterBuildings || []).push({
        id: 'bridge_node_mid',
        type: 'bridge_node',
        level: 1,
        health: 100,
        maxHealth: 100,
        x: 720,
        y: 560,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.bridge_node.range
    } as any);

    targetIsland.buildings.push({
        id: 'bridge_node_target',
        type: 'bridge_node',
        level: 1,
        health: 100,
        maxHealth: 100,
        x: -96,
        y: 0,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.bridge_node.range
    } as any);

    gameState.connectNodes(playerId, 'bridge_node_home', 'bridge_node_mid');
    gameState.connectNodes(playerId, 'bridge_node_mid', 'bridge_node_target');
    assert(gameState.map.bridges.length === 2, 'angled bridge chain should exist before movement starts');

    gameState.moveUnitsToPosition(playerId, [builder.id], targetIsland.x, targetIsland.y);
    assert(builder.status === 'moving', 'builder should begin moving across the angled bridge');

    const io = createIo();
    gameState.startGameLoop(io, 'bridge-turn-following');

    let maxWaterOffset = 0;
    let reachedTargetIsland = false;

    try {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 80));

            const onHome = isPointOnIslandSurface(homeIsland, builder.x, builder.y);
            const onTarget = isPointOnIslandSurface(targetIsland, builder.x, builder.y);
            const bridgeOffset = distanceToNearestBridge(gameState, builder.x, builder.y);

            if (!onHome && !onTarget) {
                maxWaterOffset = Math.max(maxWaterOffset, bridgeOffset);
                assert(bridgeOffset <= 14, `builder drifted ${bridgeOffset.toFixed(1)}px away from the bridge while crossing water`);
            }

            if (onTarget && Math.hypot(builder.x - targetIsland.x, builder.y - targetIsland.y) < 120) {
                reachedTargetIsland = true;
                break;
            }
        }
    } finally {
        gameState.stopGameLoop();
    }

    assert(reachedTargetIsland, 'builder should complete the angled bridge crossing');

    console.log(JSON.stringify({
        reachedTargetIsland,
        maxWaterOffset: Number(maxWaterOffset.toFixed(2)),
        finalPosition: { x: Number(builder.x.toFixed(1)), y: Number(builder.y.toFixed(1)) }
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
