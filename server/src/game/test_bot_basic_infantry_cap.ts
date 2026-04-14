import { GameState } from './GameState';
import { BotAI } from './BotAI';
import { GameMap, Island } from './MapGenerator';
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
        if (!Array.isArray((building as any).recruitmentQueue)) return count;
        return count + (building as any).recruitmentQueue.filter((entry: any) => entry.unitType === type).length;
    }, 0);
}

function main() {
    const botId = 'basic-infantry-cap-bot';
    const homeIsland = createIsland('home', 500, 420, 220, botId);

    addBuilding(homeIsland, 'base', botId, 0, 0, 'base_home');
    addBuilding(homeIsland, 'barracks', botId, -60, -30, 'barracks_a');
    addBuilding(homeIsland, 'barracks', botId, 20, -25, 'barracks_b');
    addBuilding(homeIsland, 'barracks', botId, 80, 20, 'barracks_c');

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
    gameState.addPlayer(botId, true, 'Infantry Cap Bot', 3);
    const player = gameState.players.get(botId)!;
    player.resources = { gold: 50000, oil: 50000 };

    const bot = new BotAI(botId, 3) as any;
    const myIslands = [homeIsland];

    for (let cycle = 0; cycle < 20; cycle += 1) {
        bot.recruitUnitType(gameState, player, myIslands, 'soldier', 'barracks');
        bot.recruitUnitType(gameState, player, myIslands, 'sniper', 'barracks');
        bot.recruitUnitType(gameState, player, myIslands, 'rocketeer', 'barracks');
    }

    const soldierQueued = getQueuedCount(homeIsland, 'soldier');
    const sniperQueued = getQueuedCount(homeIsland, 'sniper');
    const rocketeerQueued = getQueuedCount(homeIsland, 'rocketeer');
    const totalBasicInfantryQueued = soldierQueued + sniperQueued + rocketeerQueued;

    assert(totalBasicInfantryQueued === 10, `basic infantry queue cap mismatch: ${totalBasicInfantryQueued}`);
    assert(soldierQueued <= 10, `soldier queue should not exceed 10: ${soldierQueued}`);
    assert(sniperQueued <= 10, `sniper queue should not exceed 10: ${sniperQueued}`);
    assert(rocketeerQueued <= 10, `rocketeer queue should not exceed 10: ${rocketeerQueued}`);

    console.log(JSON.stringify({
        soldierQueued,
        sniperQueued,
        rocketeerQueued,
        totalBasicInfantryQueued
    }, null, 2));
}

main();
