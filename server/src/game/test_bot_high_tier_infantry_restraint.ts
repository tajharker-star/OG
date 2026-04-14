import { GameState } from './GameState';
import { GameMap, Island } from './MapGenerator';
import { BotAI } from './BotAI';
import { BuildingData } from './data/Registry';

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

function addBuilding(island: Island, type: string, ownerId: string, x: number, y: number, id: string) {
    const stats = BuildingData[type];
    island.buildings.push({
        id,
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

function getQueuedCount(island: Island, type: string): number {
    return island.buildings.reduce((count, building) => {
        const queue = (building as any).recruitmentQueue || [];
        return count + queue.filter((entry: any) => entry.unitType === type).length;
    }, 0);
}

function main() {
    const playerId = 'high-tier-restraint-bot';
    const homeIsland = createIsland('home', 540, 420, 220, playerId);

    addBuilding(homeIsland, 'base', playerId, 0, 0, 'base_home');
    addBuilding(homeIsland, 'barracks', playerId, -80, -20, 'barracks_a');
    addBuilding(homeIsland, 'barracks', playerId, 10, -30, 'barracks_b');
    addBuilding(homeIsland, 'tank_factory', playerId, 80, 10, 'factory_a');
    addBuilding(homeIsland, 'tank_factory', playerId, 130, 52, 'factory_b');
    addBuilding(homeIsland, 'air_base', playerId, -10, 92, 'air_base_a');
    addBuilding(homeIsland, 'oil_well', playerId, -130, 72, 'oil_a');

    const map: GameMap = {
        width: 1800,
        height: 1000,
        islands: [homeIsland],
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
    gameState.addPlayer(playerId, true, 'High Tier Restraint', 10);
    const player = gameState.players.get(playerId)!;
    player.resources = { gold: 50000, oil: 50000 };

    const bot = new BotAI(playerId, 10) as any;
    bot.startTime = Date.now() - 7 * 60 * 1000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;

    const myIslands = [homeIsland];
    const myUnits: any[] = [];

    for (let cycle = 0; cycle < 3; cycle += 1) {
        bot.usedUnitIds.clear();
        bot.apmTokens = 999;
        bot.recruitLandArmy(gameState, player, myIslands, myUnits);
    }

    const soldierQueued = getQueuedCount(homeIsland, 'soldier');
    const rocketeerQueued = getQueuedCount(homeIsland, 'rocketeer');
    const tankQueued = getQueuedCount(homeIsland, 'tank');
    const missileQueued = getQueuedCount(homeIsland, 'missile_launcher');
    const totalBasicInfantryQueued = soldierQueued + rocketeerQueued;
    const totalArmoredQueued = tankQueued + missileQueued;

    assert(totalBasicInfantryQueued === 0, `level 10 should stop queueing cheap infantry once mothership tech is the priority: ${totalBasicInfantryQueued}`);
    assert(rocketeerQueued === 0, `level 10 should not rely on rocketeers for its escort once missile launchers are online: ${rocketeerQueued}`);
    assert(missileQueued <= 5, `level 10 missile-launcher escort should stay capped at 5: ${missileQueued}`);
    assert(totalArmoredQueued >= 2, `level 10 should still keep a small armored escort online: ${totalArmoredQueued}`);
    assert(totalArmoredQueued <= 7, `level 10 should not over-invest in land escort while mothership tech is the priority: ${totalArmoredQueued}`);

    console.log(JSON.stringify({
        soldierQueued,
        rocketeerQueued,
        tankQueued,
        missileQueued,
        totalBasicInfantryQueued,
        totalArmoredQueued
    }, null, 2));
}

main();
