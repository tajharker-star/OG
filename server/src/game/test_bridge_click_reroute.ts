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

function createUnit(ownerId: string, type: 'builder', x: number, y: number) {
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
    const playerId = 'bridge-click';
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
    gameState.addPlayer(playerId, false, 'Bridge Click');
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
        createUnit(playerId, 'builder', 300, 420)
    );

    const supportShipA = {
        ...UnitData.construction_ship,
        id: 'ship_a',
        ownerId: playerId,
        type: 'construction_ship',
        x: 410,
        y: 420,
        status: 'idle' as const,
        health: UnitData.construction_ship.maxHealth,
        maxHealth: UnitData.construction_ship.maxHealth,
        damage: UnitData.construction_ship.damage,
        range: UnitData.construction_ship.range,
        speed: UnitData.construction_ship.speed,
        fireRate: UnitData.construction_ship.fireRate,
        facingAngle: 0
    };
    const supportShipB = {
        ...UnitData.construction_ship,
        id: 'ship_b',
        ownerId: playerId,
        type: 'construction_ship',
        x: 710,
        y: 420,
        status: 'idle' as const,
        health: UnitData.construction_ship.maxHealth,
        maxHealth: UnitData.construction_ship.maxHealth,
        damage: UnitData.construction_ship.damage,
        range: UnitData.construction_ship.range,
        speed: UnitData.construction_ship.speed,
        fireRate: UnitData.construction_ship.fireRate,
        facingAngle: 0
    };
    const supportShipC = {
        ...UnitData.construction_ship,
        id: 'ship_c',
        ownerId: playerId,
        type: 'construction_ship',
        x: 1030,
        y: 420,
        status: 'idle' as const,
        health: UnitData.construction_ship.maxHealth,
        maxHealth: UnitData.construction_ship.maxHealth,
        damage: UnitData.construction_ship.damage,
        range: UnitData.construction_ship.range,
        speed: UnitData.construction_ship.speed,
        fireRate: UnitData.construction_ship.fireRate,
        facingAngle: 0
    };
    gameState.units.push(supportShipA as any, supportShipB as any, supportShipC as any);

    assert(gameState.buildStructure(playerId, supportShipA.id, 'bridge_node', 356, 420), 'source bridge node should build');
    assert(gameState.buildStructure(playerId, supportShipB.id, 'bridge_node', 720, 420), 'middle bridge node should build');
    assert(gameState.buildStructure(playerId, supportShipC.id, 'bridge_node', 1084, 420), 'target bridge node should build');

    finishBridgeNodes(gameState, playerId);

    const nodeIds = [
        homeIsland.buildings.find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id,
        (gameState.map.waterBuildings || []).find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id,
        targetIsland.buildings.find(building => building.type === 'bridge_node' && building.ownerId === playerId)?.id
    ];
    assert(nodeIds.every(Boolean), 'all bridge nodes should exist');

    gameState.connectNodes(playerId, nodeIds[0]!, nodeIds[1]!);
    gameState.connectNodes(playerId, nodeIds[1]!, nodeIds[2]!);

    const builder = gameState.units.find(unit => unit.type === 'builder' && unit.ownerId === playerId)!;
    gameState.moveUnitsToPosition(playerId, [builder.id], targetIsland.x, targetIsland.y);

    assert(builder.status === 'moving', 'builder should start moving toward the clicked island');
    assert((builder.path || []).length >= 3, 'clicked cross-island move should receive bridge node waypoints');
    assert(Math.hypot((builder.path || [])[0].x - 356, (builder.path || [])[0].y - 420) < 25, 'first waypoint should snap to the bridge entrance');
    assert(Math.hypot((builder.path || [])[1].x - 720, (builder.path || [])[1].y - 420) < 25, 'bridge route should include the midpoint bridge node');
    assert(Math.hypot((builder.path || [])[2].x - 1084, (builder.path || [])[2].y - 420) < 25, 'bridge route should include the far-side bridge node');
    assert(Math.hypot((builder.targetX || 0) - targetIsland.x, (builder.targetY || 0) - targetIsland.y) < 1, 'final target should stay on the clicked destination');

    console.log(JSON.stringify({
        waypoints: builder.path,
        target: { x: builder.targetX, y: builder.targetY }
    }, null, 2));
}

main();
