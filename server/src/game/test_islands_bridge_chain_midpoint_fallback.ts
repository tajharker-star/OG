import { GameState } from './GameState';
import { BotAI } from './BotAI';
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

function finishBotBridgeNodes(gameState: GameState, playerId: string) {
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

function moveConstructionShips(gameState: GameState, playerId: string) {
    gameState.units.forEach(unit => {
        if (unit.ownerId !== playerId || unit.type !== 'construction_ship') return;
        if (unit.targetX === undefined || unit.targetY === undefined) return;
        unit.x = unit.targetX;
        unit.y = unit.targetY;
        unit.status = 'idle';
        unit.targetX = undefined;
        unit.targetY = undefined;
    });
}

function main() {
    const playerId = 'bridge-midpoint-bot';
    const homeIsland = createIsland('home', 240, 420, 120, playerId);
    const blockingIsland = createIsland('blocking', 1030, 420, 210, 'enemy_obstacle');
    const expansionIsland = createIsland('expansion', 1820, 420, 135);

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
    homeIsland.buildings.push({
        id: 'dock_home',
        type: 'dock',
        level: 1,
        health: 500,
        maxHealth: 500,
        x: 12,
        y: -70,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100
    } as any);

    const map: GameMap = {
        width: 2600,
        height: 1200,
        islands: [homeIsland, blockingIsland, expansionIsland],
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
    gameState.addPlayer(playerId, true, 'Bridge Midpoint Bot', 8);
    gameState.players.get(playerId)!.resources = { gold: 12000, oil: 9000 };

    gameState.units.push(
        createUnit(playerId, 'construction_ship', 450, 420),
        createUnit(playerId, 'construction_ship', 630, 420),
        createUnit(playerId, 'construction_ship', 810, 420)
    );

    const bot = new BotAI(playerId, 8) as any;
    bot.startTime = Date.now() - 220000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;

    const player = gameState.players.get(playerId)!;

    for (let tick = 0; tick < 60; tick += 1) {
        const myIslands = gameState.map.islands.filter(
            island => island.ownerId === playerId || island.buildings.some(building => building.ownerId === playerId)
        );
        const myUnits = gameState.units.filter(unit => unit.ownerId === playerId);
        bot.usedUnitIds.clear();
        bot.apmTokens = 999;
        bot.manageLandBridgeExpansion(gameState, player, myIslands, myUnits);
        moveConstructionShips(gameState, playerId);
        finishBotBridgeNodes(gameState, playerId);

        const path = gameState.findIslandTraversalPath(homeIsland.id, expansionIsland.id);
        if (path) break;
    }

    const traversalPath = gameState.findIslandTraversalPath(homeIsland.id, expansionIsland.id);
    assert(!!traversalPath, 'bot should recover from a blocked midpoint by inserting more water bridge nodes and still reach the far island');

    const waterBridgeNodes = (gameState.map.waterBuildings || []).filter(
        building => building.type === 'bridge_node' && building.ownerId === playerId
    );
    assert(waterBridgeNodes.length >= 2, 'blocked midpoint fallback should create multiple water bridge nodes');
    assert(gameState.map.bridges.length >= 3, 'fallback chain should contain at least three bridge segments');
    assert(
        waterBridgeNodes.every(building => Math.hypot((building.x || 0) - blockingIsland.x, (building.y || 0) - blockingIsland.y) > blockingIsland.radius),
        'water fallback nodes should stay off the blocking island and reconnect back to land'
    );

    console.log(JSON.stringify({
        bridgeSegments: gameState.map.bridges.length,
        waterBridgeNodes: waterBridgeNodes.map(building => ({
            id: building.id,
            x: building.x,
            y: building.y
        })),
        traversalPath
    }, null, 2));
}

main();
