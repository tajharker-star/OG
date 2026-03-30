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

function createUnit(ownerId: string, type: 'builder' | 'construction_ship' | 'destroyer', x: number, y: number) {
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
    const ownerId = 'naval-mine-owner';
    const enemyId = 'naval-mine-enemy';

    const island = createIsland('home', 400, 400, 120, ownerId);
    const map: GameMap = {
        width: 1200,
        height: 900,
        islands: [island],
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
    gameState.addPlayer(ownerId, false, 'Owner');
    gameState.addPlayer(enemyId, false, 'Enemy');
    gameState.players.get(ownerId)!.resources = { gold: 5000, oil: 5000 };
    gameState.players.get(enemyId)!.resources = { gold: 5000, oil: 5000 };

    const builder = createUnit(ownerId, 'builder', island.x, island.y);
    const constructionShip = createUnit(ownerId, 'construction_ship', 560, 400);
    const enemyDestroyer = createUnit(enemyId, 'destroyer', 645, 400);
    const enemyConstructionShip = createUnit(enemyId, 'construction_ship', 780, 400);
    const enemyFarDestroyer = createUnit(enemyId, 'destroyer', 860, 400);
    const friendlyDestroyer = createUnit(ownerId, 'destroyer', 560, 430);
    const enemyBuilder = createUnit(enemyId, 'builder', 520, 400);

    gameState.units.push(
        builder,
        constructionShip,
        enemyDestroyer,
        enemyConstructionShip,
        enemyFarDestroyer,
        friendlyDestroyer,
        enemyBuilder
    );

    const navalMinePlaced = gameState.buildStructure(ownerId, undefined as any, 'naval_mine', 640, 400);
    assert(navalMinePlaced, 'naval mine placement failed');
    assert((gameState.map.waterBuildings || []).length === 1, 'naval mine should be stored as a water building');

    const outOfRangeNavalMinePlaced = gameState.buildStructure(ownerId, undefined as any, 'naval_mine', 980, 400);
    assert(!outOfRangeNavalMinePlaced, 'naval mine should still require a nearby construction ship');

    const mine = (gameState.map.waterBuildings || [])[0];
    mine.isConstructing = false;
    mine.constructionProgress = 100;
    mine.health = mine.maxHealth;

    const ownerVisibleMap = gameState.getVisibleMapForPlayer(ownerId);
    const enemyVisibleMap = gameState.getVisibleMapForPlayer(enemyId);
    assert((ownerVisibleMap.waterBuildings || []).length === 1, 'owner should see naval mine');
    assert((enemyVisibleMap.waterBuildings || []).length === 0, 'enemy should not see naval mine');

    const now = Date.now();
    const enemyDestroyerHealthBefore = enemyDestroyer.health;
    const enemyConstructionShipHealthBefore = enemyConstructionShip.health;
    const enemyFarDestroyerHealthBefore = enemyFarDestroyer.health;
    const friendlyDestroyerHealthBefore = friendlyDestroyer.health;
    const enemyBuilderHealthBefore = enemyBuilder.health;
    (gameState as any).processNavalMineTriggers(now);
    assert(mine.health <= 0, 'naval mine should detonate after enemy water contact');
    assert(enemyDestroyer.health === enemyDestroyerHealthBefore - 500, 'enemy destroyer should take 500 blast damage');
    assert(enemyConstructionShip.health === enemyConstructionShipHealthBefore - 500, 'enemy construction ship should take 500 blast damage');
    assert(enemyFarDestroyer.health === enemyFarDestroyerHealthBefore, 'enemy ship outside blast radius should not be damaged');
    assert(friendlyDestroyer.health === friendlyDestroyerHealthBefore, 'friendly water units should not be damaged');
    assert(enemyBuilder.health === enemyBuilderHealthBefore, 'non-water enemy units should not be damaged');
    assert(
        gameState.pendingProjectiles.some(projectile => projectile.type === 'naval_mine_blast' && projectile.radius === UnitData.pirate_ship.range),
        'naval mine should emit a blast effect sized to pirate ship range'
    );

    console.log(JSON.stringify({
        ownerVisibleWaterBuildings: (ownerVisibleMap.waterBuildings || []).length,
        enemyVisibleWaterBuildings: (enemyVisibleMap.waterBuildings || []).length,
        outOfRangeNavalMinePlaced,
        enemyDestroyerHealthAfterBlast: enemyDestroyer.health,
        enemyConstructionShipHealthAfterBlast: enemyConstructionShip.health,
        enemyFarDestroyerHealthAfterBlast: enemyFarDestroyer.health,
        friendlyDestroyerHealthAfterBlast: friendlyDestroyer.health,
        enemyBuilderHealthAfterBlast: enemyBuilder.health
    }, null, 2));
}

main();
