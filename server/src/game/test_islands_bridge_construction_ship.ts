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
    const playerId = 'bridge-bot';
    const homeIsland = createIsland('home', 300, 320, 120, playerId);
    const expansionIsland = createIsland('expansion', 690, 320, 120);

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
        x: 0,
        y: -70,
        ownerId: playerId,
        isConstructing: false,
        constructionProgress: 100
    } as any);

    const map: GameMap = {
        width: 1200,
        height: 900,
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
    gameState.addPlayer(playerId, false, 'Bridge Bot');
    gameState.players.get(playerId)!.resources = { gold: 5000, oil: 5000 };

    gameState.units.push(
        createUnit(playerId, 'builder', homeIsland.x, homeIsland.y),
        createUnit(playerId, 'construction_ship', 495, 320)
    );

    const bot = new BotAI(playerId, 10) as any;
    bot.startTime = Date.now() - 180000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;

    const player = gameState.players.get(playerId)!;

    for (let i = 0; i < 8; i += 1) {
        const myIslands = gameState.map.islands.filter(
            island => island.ownerId === playerId || island.buildings.some(building => building.ownerId === playerId)
        );
        const myUnits = gameState.units.filter(unit => unit.ownerId === playerId);
        bot.usedUnitIds.clear();
        (bot as any).manageLandBridgeExpansion(gameState, player, myIslands, myUnits);

        gameState.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (building.type === 'bridge_node' && building.ownerId === playerId) {
                    building.isConstructing = false;
                    building.constructionProgress = 100;
                    building.health = building.maxHealth;
                }
            });
        });

        if (gameState.map.bridges.some(bridge => bridge.type === 'bridge')) {
            break;
        }
    }

    assert(gameState.map.bridges.some(bridge => bridge.type === 'bridge'), 'bot should complete a bridge to the nearby expansion island');

    gameState.units.push(createUnit(playerId, 'builder', expansionIsland.x, expansionIsland.y));
    const airBaseBuilt = gameState.buildStructure(playerId, expansionIsland.id, 'air_base');
    assert(airBaseBuilt, 'friendly bridge foothold should unlock follow-up building placement on the expansion island');

    console.log(JSON.stringify({
        bridgeCount: gameState.map.bridges.length,
        expansionBridgeNodes: expansionIsland.buildings.filter(building => building.type === 'bridge_node' && building.ownerId === playerId).length,
        airBaseBuilt
    }, null, 2));
}

main();
