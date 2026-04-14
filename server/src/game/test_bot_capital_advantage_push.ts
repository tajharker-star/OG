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

function addUnit(gameState: GameState, ownerId: string, type: string, x: number, y: number, id: string, health = 1000, maxHealth = 1000) {
    gameState.units.push({
        id,
        ownerId,
        type,
        x,
        y,
        health,
        maxHealth,
        speed: 0,
        damage: 0,
        range: 0,
        fireRate: 1000,
        status: 'idle',
        cargo: []
    } as any);
}

function main() {
    const botId = 'bot_10';
    const enemyId = 'enemy_1';
    const homeIsland = createIsland('home', 600, 520, 220, botId);
    const enemyIsland = createIsland('enemy', 1600, 520, 220, enemyId);

    addBuilding(homeIsland, 'base', botId, 0, 0, 'home_base');
    addBuilding(homeIsland, 'air_base', botId, -40, 80, 'home_air_1');
    addBuilding(homeIsland, 'air_base', botId, 40, 80, 'home_air_2');
    addBuilding(homeIsland, 'oil_well', botId, -80, -40, 'home_oil');

    addBuilding(enemyIsland, 'base', enemyId, 0, 0, 'enemy_base');
    addBuilding(enemyIsland, 'tower', enemyId, 70, 30, 'enemy_tower');

    const map: GameMap = {
        width: 2600,
        height: 1400,
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
    gameState.addPlayer(botId, true, 'Bot 10', 10);
    gameState.addPlayer(enemyId, false, 'Enemy', 1);
    gameState.players.get(botId)!.resources = { gold: 24000, oil: 4000 };
    gameState.players.get(enemyId)!.resources = { gold: 3000, oil: 300 };

    addUnit(gameState, botId, 'mothership', 640, 520, 'ms_1', 5000, 5000);
    addUnit(gameState, botId, 'mothership', 690, 560, 'ms_2', 5000, 5000);
    addUnit(gameState, botId, 'light_plane', 650, 470, 'lp_1', 300, 300);
    addUnit(gameState, enemyId, 'light_plane', 1500, 470, 'enemy_lp_1', 300, 300);
    addUnit(gameState, enemyId, 'light_plane', 1520, 560, 'enemy_lp_2', 300, 300);
    addUnit(gameState, enemyId, 'destroyer', 1550, 650, 'enemy_destroyer', 650, 650);

    const bot = new BotAI(botId, 10) as any;
    bot.startTime = Date.now() - 8 * 60 * 1000;
    bot.lastApmRefill = 0;
    bot.apmTokens = 999;

    const myIslands = gameState.map.islands.filter(island => island.ownerId === botId);
    const myUnits = gameState.units.filter(unit => unit.ownerId === botId);
    const player = gameState.players.get(botId)!;

    const target = bot.findAirTarget(gameState);
    assert(target !== null, 'air target should exist when enemy base is present');
    assert(Math.abs(target!.x - enemyIsland.x) < 100, 'capital advantage should target the enemy base instead of side targets');

    bot.manageAirForce(gameState, player, myUnits);

    const scores = bot.calculateGoalScores(gameState, player, myUnits);
    const attackScore = scores.find((entry: any) => entry.goal === 'ATTACK')?.score ?? 0;
    const expandScore = scores.find((entry: any) => entry.goal === 'EXPAND')?.score ?? 0;

    assert(bot.debugState.airCommander.capitalStrikeAdvantage === true, 'air commander should detect capital strike advantage');
    assert(bot.debugState.airCommander.mode === 'ATTACK', 'capital advantage should commit the air commander to attack mode');
    assert(attackScore > expandScore, 'capital advantage should make attack outrank expansion');

    console.log(JSON.stringify({
        target,
        airCommander: bot.debugState.airCommander,
        goalScores: scores
    }, null, 2));
}

main();
