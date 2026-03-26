import { GameState } from './GameState';
import { BotAI } from './BotAI';
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

function addBuilding(island: Island, type: string, ownerId: string, x: number, y: number, id?: string) {
    const stats = BuildingData[type];
    island.buildings.push({
        id: id || `${type}_${ownerId}_${island.id}_${island.buildings.length}`,
        type: type as any,
        level: 1,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        x,
        y,
        ownerId,
        isConstructing: false,
        constructionProgress: 100,
        range: stats.range,
        recruitmentQueue: []
    } as any);
}

function createUnit(ownerId: string, type: 'mothership' | 'aircraft_carrier' | 'destroyer', x: number, y: number, healthRatio: number) {
    const stats = UnitData[type];
    return {
        id: `${type}_${ownerId}_${Math.random()}`,
        ownerId,
        type,
        x,
        y,
        status: 'idle' as const,
        health: stats.maxHealth * healthRatio,
        maxHealth: stats.maxHealth,
        damage: stats.damage,
        range: stats.range,
        speed: stats.speed,
        fireRate: stats.fireRate,
        facingAngle: 0,
        recruitmentQueue: [],
        cargo: []
    };
}

function main() {
    const botId = 'capital-retreat-bot';
    const enemyId = 'capital-retreat-enemy';

    const homeIsland = createIsland('home', 420, 540, 200, botId);
    const enemyIsland = createIsland('enemy', 1680, 540, 220, enemyId);

    addBuilding(homeIsland, 'base', botId, 0, 0, 'base_home');
    addBuilding(homeIsland, 'repair_dock', botId, 46, -12, 'repair_home');
    addBuilding(enemyIsland, 'base', enemyId, 0, 0, 'base_enemy');

    const map: GameMap = {
        width: 2400,
        height: 1200,
        islands: [homeIsland, enemyIsland],
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
    gameState.addPlayer(botId, true, 'Capital Retreat Bot', 10);
    gameState.addPlayer(enemyId, false, 'Enemy', 1);
    gameState.players.get(botId)!.resources = { gold: 20000, oil: 20000 };

    const mothership = createUnit(botId, 'mothership', 1450, 320, 0.18) as any;
    const carrier = createUnit(botId, 'aircraft_carrier', 1500, 700, 0.19) as any;
    gameState.units.push(mothership, carrier);

    const bot = new BotAI(botId, 10) as any;
    bot.startTime = Date.now() - 8 * 60 * 1000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;
    bot.airState.mode = 'ATTACK';

    const myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    const repairDockPoint = {
        x: homeIsland.x + 46,
        y: homeIsland.y - 12
    };
    const enemyBasePoint = {
        x: enemyIsland.x,
        y: enemyIsland.y
    };

    bot.usedUnitIds.clear();
    bot.manageAirForce(gameState, gameState.players.get(botId)!, myUnits);

    assert(mothership.status === 'moving', 'low-hp mothership should start retreating');
    assert(carrier.status === 'moving', 'low-hp carrier should start retreating');
    assert(
        Math.hypot((mothership.targetX || 0) - repairDockPoint.x, (mothership.targetY || 0) - repairDockPoint.y) <
            Math.hypot((mothership.targetX || 0) - enemyBasePoint.x, (mothership.targetY || 0) - enemyBasePoint.y),
        'mothership retreat target should favor the home repair area over the enemy'
    );
    assert(
        Math.hypot((carrier.targetX || 0) - repairDockPoint.x, (carrier.targetY || 0) - repairDockPoint.y) <
            Math.hypot((carrier.targetX || 0) - enemyBasePoint.x, (carrier.targetY || 0) - enemyBasePoint.y),
        'carrier retreat target should favor the home repair area over the enemy'
    );

    mothership.x = repairDockPoint.x + 48;
    mothership.y = repairDockPoint.y + 12;
    mothership.health = mothership.maxHealth * 0.29;
    mothership.status = 'moving';
    mothership.targetX = enemyBasePoint.x;
    mothership.targetY = enemyBasePoint.y;
    bot.usedUnitIds.clear();
    bot.manageAirForce(gameState, gameState.players.get(botId)!, myUnits);
    assert(
        Math.hypot((mothership.targetX || 0) - repairDockPoint.x, (mothership.targetY || 0) - repairDockPoint.y) <
            Math.hypot((mothership.targetX || 0) - enemyBasePoint.x, (mothership.targetY || 0) - enemyBasePoint.y),
        'mothership should overwrite stale attack orders with a repair hold order while retreating'
    );

    mothership.health = mothership.maxHealth * 0.4;
    carrier.health = carrier.maxHealth * 0.45;
    bot.usedUnitIds.clear();
    bot.manageAirForce(gameState, gameState.players.get(botId)!, myUnits);

    assert(
        Math.hypot((mothership.targetX || 0) - repairDockPoint.x, (mothership.targetY || 0) - repairDockPoint.y) <
            Math.hypot((mothership.targetX || 0) - enemyBasePoint.x, (mothership.targetY || 0) - enemyBasePoint.y),
        'mothership should keep retreating home until it has substantially healed'
    );
    assert(
        Math.hypot((carrier.targetX || 0) - repairDockPoint.x, (carrier.targetY || 0) - repairDockPoint.y) <
            Math.hypot((carrier.targetX || 0) - enemyBasePoint.x, (carrier.targetY || 0) - enemyBasePoint.y),
        'carrier should keep retreating home until it has substantially healed'
    );

    mothership.x = 1390;
    mothership.y = 360;
    mothership.health = mothership.maxHealth * 0.34;
    mothership.status = 'idle';
    mothership.targetX = undefined;
    mothership.targetY = undefined;
    gameState.units.push(createUnit(enemyId, 'destroyer', 1480, 360, 1) as any);

    bot.usedUnitIds.clear();
    bot.manageAirForce(gameState, gameState.players.get(botId)!, myUnits);

    assert(mothership.status === 'moving', 'pressured mothership should retreat before dropping all the way to 30% hp');
    assert(
        Math.hypot((mothership.targetX || 0) - repairDockPoint.x, (mothership.targetY || 0) - repairDockPoint.y) <
            Math.hypot((mothership.targetX || 0) - enemyBasePoint.x, (mothership.targetY || 0) - enemyBasePoint.y),
        'pressured mothership should still favor the repair area over the enemy base'
    );

    console.log(JSON.stringify({
        mothershipRetreatTarget: { x: mothership.targetX, y: mothership.targetY },
        carrierRetreatTarget: { x: carrier.targetX, y: carrier.targetY },
        stickyRetreat: true,
        staleAttackOrderCleared: true,
        pressuredRetreat: true
    }, null, 2));
}

main();
