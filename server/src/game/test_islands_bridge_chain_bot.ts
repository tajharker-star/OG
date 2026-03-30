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
        if (building.type === 'naval_mine' && building.ownerId === playerId) {
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
    const playerId = 'bridge-bot-chain';
    const homeIsland = createIsland('home', 280, 420, 120, playerId);
    const expansionIsland = createIsland('expansion', 1460, 420, 135);

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
        y: -68,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100
    } as any);

    const map: GameMap = {
        width: 2200,
        height: 1100,
        islands: [homeIsland, expansionIsland],
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
    gameState.addPlayer(playerId, true, 'Bridge Bot', 10);
    gameState.players.get(playerId)!.resources = { gold: 9000, oil: 9000 };

    gameState.units.push(
        createUnit(playerId, 'construction_ship', 470, 420),
        createUnit(playerId, 'construction_ship', 690, 420)
    );

    const bot = new BotAI(playerId, 10) as any;
    bot.startTime = Date.now() - 220000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;

    const player = gameState.players.get(playerId)!;

    for (let tick = 0; tick < 36; tick += 1) {
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
    assert(!!traversalPath, 'level 10 islands bot should complete a chained bridge traversal to the new island');

    const ownedWaterBridgeNodes = (gameState.map.waterBuildings || []).filter(
        building => building.type === 'bridge_node' && building.ownerId === playerId
    );
    assert(ownedWaterBridgeNodes.length >= 1, 'level 10 islands bot should create at least one water bridge node in the chain');
    assert(gameState.map.bridges.length >= 2, 'bridge chain should contain multiple bridge segments');

    const myIslands = gameState.map.islands.filter(
        island => island.ownerId === playerId || island.buildings.some(building => building.ownerId === playerId)
    );
    const myUnits = gameState.units.filter(unit => unit.ownerId === playerId);
    gameState.units.push({
        ...createUnit('enemy', 'construction_ship', ownedWaterBridgeNodes[0].x || 0, (ownedWaterBridgeNodes[0].y || 0) + 120),
        id: 'enemy_ship_probe'
    } as any);

    for (let tick = 0; tick < 10; tick += 1) {
        bot.usedUnitIds.clear();
        bot.apmTokens = 999;
        bot.manageNavalMineDefence(gameState, player, myIslands, myUnits);
        moveConstructionShips(gameState, playerId);
        finishBotBridgeNodes(gameState, playerId);
        const mineNearChain = (gameState.map.waterBuildings || []).find(building =>
            building.type === 'naval_mine' &&
            building.ownerId === playerId &&
            Math.hypot((building.x || 0) - (ownedWaterBridgeNodes[0].x || 0), (building.y || 0) - (ownedWaterBridgeNodes[0].y || 0)) <= 180
        );
        if (mineNearChain) {
            console.log(JSON.stringify({
                bridgeSegments: gameState.map.bridges.length,
                waterBridgeNodes: ownedWaterBridgeNodes.length,
                traversalPath,
                mineNearChain: {
                    id: mineNearChain.id,
                    x: mineNearChain.x,
                    y: mineNearChain.y
                }
            }, null, 2));
            return;
        }
    }

    throw new Error('level 10 islands bot should defend chained bridge nodes with naval mines');
}

main();
