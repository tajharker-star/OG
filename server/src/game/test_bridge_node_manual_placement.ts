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

function createUnit(ownerId: string, type: 'builder' | 'construction_ship', x: number, y: number) {
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

function main() {
    const playerId = 'bridge-player';
    const homeIsland = createIsland('home', 300, 420, 120, playerId);
    const neutralIsland = createIsland('neutral', 760, 420, 120);
    const enemyIsland = createIsland('enemy', 1140, 420, 120, 'enemy-player');

    const map: GameMap = {
        width: 1400,
        height: 900,
        islands: [homeIsland, neutralIsland, enemyIsland],
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
    gameState.addPlayer(playerId, false, 'Bridge Player');
    gameState.addPlayer('enemy-player', false, 'Enemy Player');

    const player = gameState.players.get(playerId);
    if (!player) {
        throw new Error('player not found');
    }
    player.resources = { gold: 5000, oil: 5000 };

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

    const waterShip = createUnit(playerId, 'construction_ship', 460, 420);
    const islandShip = createUnit(playerId, 'construction_ship', 620, 420);
    const enemyIslandShip = createUnit(playerId, 'construction_ship', 980, 420);
    gameState.units.push(waterShip, islandShip, enemyIslandShip);

    const waterNodeX = 430;
    const waterNodeY = 420;
    const neutralIslandNodeX = 652;
    const neutralIslandNodeY = 420;
    const enemyIslandNodeX = 1032;
    const enemyIslandNodeY = 420;

    const waterNodeBuilt = gameState.buildStructure(playerId, undefined as any, 'bridge_node', waterNodeX, waterNodeY);
    assert(waterNodeBuilt, 'bridge node should build in water even when clicked close to an island edge');

    const outOfRangeWaterNodeBuilt = gameState.buildStructure(playerId, undefined as any, 'bridge_node', 220, 120);
    assert(!outOfRangeWaterNodeBuilt, 'bridge node should still require a nearby builder or construction ship');

    const neutralIslandNodeBuilt = gameState.buildStructure(playerId, undefined as any, 'bridge_node', neutralIslandNodeX, neutralIslandNodeY);
    assert(neutralIslandNodeBuilt, 'bridge node should build on an unclaimed island when a nearby construction ship supports it');

    const enemyIslandNodeBuilt = gameState.buildStructure(playerId, undefined as any, 'bridge_node', enemyIslandNodeX, enemyIslandNodeY);
    assert(enemyIslandNodeBuilt, 'bridge node should build on an enemy-owned island when a nearby construction ship supports it');

    const waterNode = (gameState.map.waterBuildings || []).find(
        building => building.type === 'bridge_node' && Math.hypot((building.x || 0) - waterNodeX, (building.y || 0) - waterNodeY) < 1
    );
    const islandNode = neutralIsland.buildings.find(
        building => building.type === 'bridge_node' && Math.hypot(neutralIsland.x + (building.x || 0) - neutralIslandNodeX, neutralIsland.y + (building.y || 0) - neutralIslandNodeY) < 1
    );
    const enemyNode = enemyIsland.buildings.find(
        building => building.type === 'bridge_node' && Math.hypot(enemyIsland.x + (building.x || 0) - enemyIslandNodeX, enemyIsland.y + (building.y || 0) - enemyIslandNodeY) < 1
    );

    assert(!!waterNode, 'water bridge node should be stored with water buildings');
    assert(!!islandNode, 'island bridge node should be stored on the target island');
    assert(!!enemyNode, 'enemy island bridge node should be stored on the target island');

    console.log(JSON.stringify({
        waterNodeBuilt,
        outOfRangeWaterNodeBuilt,
        neutralIslandNodeBuilt,
        enemyIslandNodeBuilt,
        waterBuildingCount: (gameState.map.waterBuildings || []).length,
        neutralIslandBridgeNodes: neutralIsland.buildings.filter(building => building.type === 'bridge_node').length,
        enemyIslandBridgeNodes: enemyIsland.buildings.filter(building => building.type === 'bridge_node').length
    }, null, 2));
}

main();
