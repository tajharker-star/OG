import { GameState, Unit } from './GameState';
import { Building, GameMap, Island } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function createIsland(): Island {
    const baseStats = BuildingData.base;
    return {
        id: 'arena',
        x: 500,
        y: 500,
        radius: 260,
        type: 'grasslands',
        ownerId: 'defender',
        goldSpots: [],
        buildings: [
            {
                id: 'defender_base',
                type: 'base',
                level: 1,
                health: baseStats.maxHealth,
                maxHealth: baseStats.maxHealth,
                x: 0,
                y: 0,
                ownerId: 'defender'
            }
        ]
    };
}

function addWallNode(island: Island, id: string, x: number, y: number): Building {
    const stats = BuildingData.wall_node;
    const wallNode: Building = {
        id,
        type: 'wall_node',
        level: 1,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        x,
        y,
        ownerId: 'defender'
    };
    island.buildings.push(wallNode);
    return wallNode;
}

function createUnit(ownerId: string, type: 'tank' | 'missile_launcher', x: number, y: number): Unit {
    const stats = UnitData[type];
    return {
        id: `${type}_${ownerId}`,
        ownerId,
        type,
        x,
        y,
        status: 'idle',
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        damage: stats.damage,
        range: stats.range,
        speed: stats.speed,
        fireRate: stats.fireRate,
        facingAngle: 0
    };
}

function createGameState(): { gameState: GameState; island: Island; base: Building } {
    const island = createIsland();
    const map: GameMap = {
        width: 1200,
        height: 900,
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
    gameState.addPlayer('defender', false, 'Defender');
    gameState.addPlayer('attacker', false, 'Attacker');

    const base = island.buildings[0];
    return { gameState, island, base };
}

function resolveOnce(gameState: GameState) {
    const io = { to: () => ({ emit: () => undefined }) };
    gameState.resolveCombat(io, 'wall-taunt-test');
}

function testWallNodeTauntsGroundUnits() {
    const { gameState, island, base } = createGameState();
    const wallNode = addWallNode(island, 'wall_node_front', 0, 40);
    const tank = createUnit('attacker', 'tank', island.x, island.y + 90);
    gameState.units.push(tank);

    const baseHealthBefore = base.health;
    const wallHealthBefore = wallNode.health;
    resolveOnce(gameState);

    assert(wallNode.health === wallHealthBefore - tank.damage, 'ground tank should attack taunting wall node first');
    assert(base.health === baseHealthBefore, 'ground tank should not attack HQ while wall node is taunting in range');
}

function testWallSegmentTauntsGroundUnits() {
    const { gameState, island, base } = createGameState();
    addWallNode(island, 'wall_node_left', -120, 40);
    addWallNode(island, 'wall_node_right', 120, 40);
    const wall = {
        id: 'wall_segment_front',
        type: 'wall' as const,
        nodeAId: 'wall_node_left',
        nodeBId: 'wall_node_right',
        islandAId: island.id,
        islandBId: island.id,
        ownerId: 'defender',
        health: BuildingData.wall.maxHealth,
        maxHealth: BuildingData.wall.maxHealth
    };
    gameState.map.bridges.push(wall);
    const tank = createUnit('attacker', 'tank', island.x, island.y + 120);
    gameState.units.push(tank);

    const baseHealthBefore = base.health;
    const wallHealthBefore = wall.health;
    resolveOnce(gameState);

    assert(wall.health === wallHealthBefore - tank.damage, 'ground tank should attack taunting wall segment first');
    assert(base.health === baseHealthBefore, 'ground tank should not attack HQ while wall segment is taunting in range');
}

function testArtilleryIgnoresWallTaunt() {
    const { gameState, island, base } = createGameState();
    const wallNode = addWallNode(island, 'wall_node_front', 0, 50);
    const missileLauncher = createUnit('attacker', 'missile_launcher', island.x, island.y + 220);
    gameState.units.push(missileLauncher);

    const baseHealthBefore = base.health;
    const wallHealthBefore = wallNode.health;
    resolveOnce(gameState);

    assert(base.health === baseHealthBefore - missileLauncher.damage, 'missile launcher should ignore wall taunt and hit HQ');
    assert(wallNode.health === wallHealthBefore, 'missile launcher should not be forced onto wall node taunt');
}

function main() {
    testWallNodeTauntsGroundUnits();
    testWallSegmentTauntsGroundUnits();
    testArtilleryIgnoresWallTaunt();

    console.log(JSON.stringify({
        wallNodeTaunt: 'passed',
        wallSegmentTaunt: 'passed',
        artilleryException: 'passed'
    }, null, 2));
}

main();
