import { GameState } from './GameState';
import { GameMap, Island } from './MapGenerator';
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

function createUnit(ownerId: string, type: 'heavy_plane' | 'light_plane' | 'soldier', x: number, y: number) {
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
    const bomberOwnerId = 'bomber-owner';
    const enemyId = 'bomber-enemy';

    const island = createIsland('central', 500, 450, 320);
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
    gameState.addPlayer(bomberOwnerId, false, 'Bomber Owner');
    gameState.addPlayer(enemyId, false, 'Enemy');

    const bomber = createUnit(bomberOwnerId, 'heavy_plane', 400, 450);
    const enemyAir = createUnit(enemyId, 'light_plane', 470, 450);
    const enemyGroundPrimary = createUnit(enemyId, 'soldier', 520, 450);
    const enemyGroundSplash = createUnit(enemyId, 'soldier', 560, 470);
    const enemyGroundFar = createUnit(enemyId, 'soldier', 700, 450);
    const friendlyGround = createUnit(bomberOwnerId, 'soldier', 540, 430);

    enemyAir.damage = 0;
    enemyGroundPrimary.damage = 0;
    enemyGroundSplash.damage = 0;
    enemyGroundFar.damage = 0;
    friendlyGround.damage = 0;

    gameState.units.push(
        bomber as any,
        enemyAir as any,
        enemyGroundPrimary as any,
        enemyGroundSplash as any,
        enemyGroundFar as any,
        friendlyGround as any
    );

    (gameState as any).updateGrid();
    gameState.resolveCombat({ to: () => ({ emit: () => undefined }) }, 'test-room');

    assert(UnitData.heavy_plane.height === 2, 'heavy plane should now use the same high-air layer as the mothership');
    assert(gameState.pendingProjectiles.length === 1, 'heavy plane should emit one bomb projectile');

    const projectile = gameState.pendingProjectiles[0];
    assert(projectile.type === 'heavy_plane_bomb', 'heavy plane should emit a heavy_plane_bomb projectile');
    assert(projectile.radius === 90, 'heavy plane bomb should use the expected blast radius');

    assert(enemyAir.health === enemyAir.maxHealth, 'heavy plane bomber should ignore air units and only bomb units below it');
    assert(
        enemyGroundPrimary.health === enemyGroundPrimary.maxHealth - UnitData.heavy_plane.damage,
        'primary ground target should take direct bomb damage'
    );
    assert(
        enemyGroundSplash.health === enemyGroundSplash.maxHealth - UnitData.heavy_plane.damage,
        'nearby ground unit should take splash bomb damage'
    );
    assert(enemyGroundFar.health === enemyGroundFar.maxHealth, 'ground units outside the splash radius should not be damaged');
    assert(friendlyGround.health === friendlyGround.maxHealth, 'friendly ground units should not be damaged by the bomber splash');

    console.log(JSON.stringify({
        heavyPlaneHeight: UnitData.heavy_plane.height,
        projectileType: projectile.type,
        projectileRadius: projectile.radius,
        primaryHealthAfter: enemyGroundPrimary.health,
        splashHealthAfter: enemyGroundSplash.health,
        farHealthAfter: enemyGroundFar.health,
        enemyAirHealthAfter: enemyAir.health,
        friendlyGroundHealthAfter: friendlyGround.health
    }, null, 2));

    const buildingScenario = new GameState('grasslands');
    buildingScenario.mapType = 'grasslands';
    buildingScenario.map = {
        width: 1200,
        height: 900,
        islands: [createIsland('building-test', 500, 450, 320)],
        oilSpots: [],
        bridges: [],
        waterBuildings: [],
        mapType: 'grasslands'
    };
    buildingScenario.players.clear();
    buildingScenario.units = [];
    buildingScenario.addPlayer(bomberOwnerId, false, 'Bomber Owner');
    buildingScenario.addPlayer(enemyId, false, 'Enemy');

    const bomberVsBase = createUnit(bomberOwnerId, 'heavy_plane', 400, 450);
    const enemyBase = {
        id: 'enemy-base',
        type: 'base',
        ownerId: enemyId,
        x: 20,
        y: 0,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
        isConstructing: false,
        constructionProgress: 100,
        level: 1
    };
    buildingScenario.map.islands[0].buildings.push(enemyBase as any);
    buildingScenario.units.push(bomberVsBase as any);

    (buildingScenario as any).updateGrid();
    buildingScenario.resolveCombat({ to: () => ({ emit: () => undefined }) }, 'building-test-room');

    assert(buildingScenario.pendingProjectiles.length === 1, 'heavy plane should emit one bomb projectile against buildings');
    assert(
        enemyBase.health === enemyBase.maxHealth - UnitData.heavy_plane.damage,
        'heavy plane bomber should damage enemy buildings inside the blast radius'
    );

    console.log(JSON.stringify({
        heavyPlaneHeight: UnitData.heavy_plane.height,
        projectileType: buildingScenario.pendingProjectiles[0].type,
        buildingHealthAfter: enemyBase.health
    }, null, 2));
}

main();
