import { GameState } from './GameState';
import { createBotAI } from './BotAIFactory';
import { BuildingData } from './data/Registry';
import { GameMap, Island } from './MapGenerator';

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
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
        goldSpots: [{ id: `${id}_gold_0`, x: -40, y: 0 }]
    };
}

function addBase(island: Island, ownerId: string, x: number, y: number) {
    island.buildings.push({
        id: `base_${ownerId}_${island.id}`,
        type: 'base',
        level: 1,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
        x,
        y,
        ownerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.base.range
    });
}

function createIo() {
    return {
        to() {
            return {
                emit() {
                    return undefined;
                }
            };
        }
    };
}

function countBotStructures(gameState: GameState, botId: string): number {
    return gameState.map.islands.reduce((count, island) =>
        count + island.buildings.filter(building => building.ownerId === botId && building.type !== 'base').length,
    0);
}

async function main() {
    const botId = 'gate-bot';
    const humanId = 'gate-human';
    const botIsland = createIsland('bot_island', 700, 700, 260, 'grasslands', botId);
    const humanIsland = createIsland('human_island', 1320, 700, 240, 'grasslands', humanId);
    addBase(botIsland, botId, -20, 0);
    addBase(humanIsland, humanId, 0, 0);

    const gameMap: GameMap = {
        width: 2000,
        height: 1400,
        islands: [botIsland, humanIsland],
        oilSpots: [],
        bridges: [],
        mapType: 'grasslands'
    };

    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = gameMap;
    gameState.players.clear();
    gameState.units = [];
    gameState.bots = [];
    gameState.status = 'waiting';

    gameState.addPlayer(botId, true, 'Bot', 5);
    gameState.addPlayer(humanId, false, 'Human', 1);

    const botPlayer = gameState.players.get(botId);
    const humanPlayer = gameState.players.get(humanId);
    assert(!!botPlayer && !!humanPlayer, 'players were not created');
    botPlayer!.resources = { gold: 4000, oil: 1000 };
    humanPlayer!.resources = { gold: 4000, oil: 1000 };

    gameState.units.push({
        id: 'gate_builder_0',
        ownerId: botId,
        type: 'builder',
        x: botIsland.x + 60,
        y: botIsland.y + 10,
        status: 'idle',
        health: 50,
        maxHealth: 50,
        damage: 0,
        range: 50,
        speed: 100,
        fireRate: 0
    });

    const bot = createBotAI(botId, 5) as any;
    bot.actionInterval = 0;
    bot.minBuildDelay = 0;
    bot.maxBuildDelay = 0;
    bot.currentBuildDelay = 0;
    bot.maxApmTokens = 1000;
    bot.apmTokens = 1000;
    gameState.bots = [bot];
    gameState.status = 'playing';

    const originalStartTime = bot.startTime;
    gameState.armHumanReadyBotStartGate();

    const io = createIo();
    gameState.startGameLoop(io, 'bot-ready-gate-test');
    await new Promise(resolve => setTimeout(resolve, 300));

    const structuresBeforeReady = countBotStructures(gameState, botId);
    assert(structuresBeforeReady === 0, `expected no bot structures before human ready, got ${structuresBeforeReady}`);
    assert(bot.debugState.currentGoal === 'WAITING_FOR_PLAYERS', `expected waiting goal before ready, got ${bot.debugState.currentGoal}`);
    assert(bot.startTime === originalStartTime, 'bot clock should not reset before human-ready signal');

    const markedReady = gameState.markHumanPlayerMatchReady(humanId);
    assert(markedReady, 'expected human-ready signal to be accepted');

    await new Promise(resolve => setTimeout(resolve, 900));
    gameState.stopGameLoop();

    const structuresAfterReady = countBotStructures(gameState, botId);
    assert(bot.startTime > originalStartTime, 'bot clock should reset when humans are ready');
    assert(structuresAfterReady > 0 || bot.debugState.currentGoal !== 'WAITING_FOR_PLAYERS', 'expected bot to begin acting after human-ready signal');

    console.log(JSON.stringify({
        structuresBeforeReady,
        structuresAfterReady,
        botStartTimeReset: bot.startTime > originalStartTime,
        goalAfterRelease: bot.debugState.currentGoal
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
