import { GameState } from './GameState';
import { UnitData } from './data/Registry';
import { GameMap, Island } from './MapGenerator';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function createIsland(id: string, x: number, y: number, radius: number, type: Island['type'], ownerId?: string): Island {
    return {
        id,
        x,
        y,
        radius,
        type,
        ownerId,
        buildings: [],
        goldSpots: []
    };
}

function createUnit(ownerId: string, type: 'soldier' | 'tank', x: number, y: number, health: number) {
    const stats = UnitData[type];
    return {
        id: `${type}_${ownerId}_${Math.random()}`,
        ownerId,
        type,
        x,
        y,
        status: 'idle' as const,
        health,
        maxHealth: stats.maxHealth,
        damage: stats.damage,
        range: stats.range,
        speed: stats.speed,
        fireRate: stats.fireRate,
        facingAngle: 0
    };
}

function main() {
    const playerId = 'support-owner';
    const enemyId = 'enemy-owner';

    const island = createIsland('support_island', 600, 600, 360, 'grasslands', playerId);

    const map: GameMap = {
        width: 1400,
        height: 1200,
        islands: [island],
        oilSpots: [],
        bridges: [],
        mapType: 'grasslands'
    };

    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, false, 'Support');
    gameState.addPlayer(enemyId, false, 'Enemy');
    const owner = gameState.players.get(playerId);
    assert(!!owner, 'support owner should exist');
    owner!.resources = { gold: 5000, oil: 5000 };

    gameState.units.push({
        id: `builder_${playerId}`,
        ownerId: playerId,
        type: 'builder',
        x: island.x,
        y: island.y,
        status: 'idle',
        health: UnitData.builder.maxHealth,
        maxHealth: UnitData.builder.maxHealth,
        damage: UnitData.builder.damage,
        range: UnitData.builder.range,
        speed: UnitData.builder.speed,
        fireRate: UnitData.builder.fireRate,
        facingAngle: 0
    });

    const hospitalPlaced = gameState.buildStructure(playerId, island.id, 'hospital', island.x - 40, island.y);
    const repairDockPlaced = gameState.buildStructure(playerId, island.id, 'repair_dock', island.x + 40, island.y);
    assert(hospitalPlaced, 'hospital placement failed');
    assert(repairDockPlaced, 'repair dock placement failed');

    island.buildings.forEach(building => {
        building.isConstructing = false;
        building.constructionProgress = 100;
        building.health = building.maxHealth;
    });

    const soldier = createUnit(playerId, 'soldier', island.x - 20, island.y, 30); // missing 20 => +1
    const tank = createUnit(playerId, 'tank', island.x + 20, island.y, 300); // missing 100 => +5
    const farTank = createUnit(playerId, 'tank', island.x + 340, island.y, 300); // out of range, unchanged
    const enemySoldier = createUnit(enemyId, 'soldier', island.x - 20, island.y, 20); // enemy, unchanged

    gameState.units.push(soldier, tank, farTank, enemySoldier);

    (gameState as any).processSupportBuildingHealingTick();

    assert(Math.abs(soldier.health - 31) < 0.0001, `hospital heal mismatch for soldier: ${soldier.health}`);
    assert(Math.abs(tank.health - 305) < 0.0001, `repair dock heal mismatch for tank: ${tank.health}`);
    assert(Math.abs(farTank.health - 300) < 0.0001, `out-of-range tank should not heal: ${farTank.health}`);
    assert(Math.abs(enemySoldier.health - 20) < 0.0001, `enemy soldier should not heal: ${enemySoldier.health}`);

    console.log(JSON.stringify({
        soldierHealthAfter: soldier.health,
        tankHealthAfter: tank.health,
        farTankHealthAfter: farTank.health,
        enemySoldierHealthAfter: enemySoldier.health
    }, null, 2));
}

main();
