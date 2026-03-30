import { GameState, Unit } from './GameState';
import { MapGenerator } from './MapGenerator';
import { BotAI } from './BotAI';
import { UnitData } from './data/Registry';

function getOwnedBuildingCount(gameState: GameState, playerId: string, type: string): number {
    return gameState.map.islands.reduce((count, island) => {
        return count + island.buildings.filter(building => building.type === type && building.ownerId === playerId).length;
    }, 0);
}

function findBaseIsland(gameState: GameState, playerId: string) {
    return gameState.map.islands.find(island =>
        island.buildings.some(building => building.type === 'base' && building.ownerId === playerId)
    );
}

async function main() {
    const gameState = new GameState('desert');
    gameState.mapType = 'desert';
    gameState.map = MapGenerator.generate(3200, 2400, 40, 'desert');
    gameState.map.mapType = 'desert';

    const botId = 'bot-10';
    gameState.addPlayer(botId, true, undefined, 10);

    const player = gameState.players.get(botId);
    if (!player) throw new Error('Missing bot player.');
    player.resources = { gold: 8000, oil: 4000 };
    player.status = 'active';
    player.canBuildHQ = true;
    player.hqRespawnsUsed = 0;
    player.hqSpawnedOnce = false;

    gameState.units = [];
    gameState.assignStartingIsland(botId);
    gameState.status = 'playing';

    const botController = new BotAI(botId, 10) as any;
    botController.actionInterval = 0;
    botController.minBuildDelay = 0;
    botController.maxBuildDelay = 0;
    botController.currentBuildDelay = 0;
    botController.lastActionTime = 0;

    const baseIsland = findBaseIsland(gameState, botId);
    if (!baseIsland) throw new Error('Missing bot base island.');

    const builtBarracks = gameState.buildStructure(botId, baseIsland.id, 'barracks');
    if (!builtBarracks) throw new Error('Failed to build test barracks.');

    const hiddenSpot = (gameState.map.oilSpots || []).find(spot =>
        spot.id.startsWith('hidden') &&
        !(spot as any).occupiedBy &&
        Math.hypot(spot.x - baseIsland.x, spot.y - baseIsland.y) < 1400
    );
    if (!hiddenSpot) throw new Error('Missing reachable hidden desert oil spot.');

    const builder = gameState.units.find(unit => unit.ownerId === botId && unit.type === 'builder');
    if (!builder) throw new Error('Missing bot builder.');

    builder.x = hiddenSpot.x + 30;
    builder.y = hiddenSpot.y + 30;

    botController.update(gameState);
    botController.lastActionTime = 0;
    botController.update(gameState);

    const beforeReveal = {
        revealed: botController.revealedSpots.has(hiddenSpot.id),
        oilWells: getOwnedBuildingCount(gameState, botId, 'oil_well')
    };

    if (beforeReveal.revealed || beforeReveal.oilWells !== 0) {
        console.error(JSON.stringify({ stage: 'before_reveal', beforeReveal }, null, 2));
        process.exit(1);
    }

    const seekerStats = UnitData.oil_seeker;
    const seekRange = Math.max(gameState.map.width, gameState.map.height) / 4;
    const seekerX = hiddenSpot.x - Math.min(seekRange - 40, 220);
    const seekerY = hiddenSpot.y;
    const oilSeeker: Unit = {
        id: 'test_oil_seeker',
        ownerId: botId,
        type: 'oil_seeker',
        x: seekerX,
        y: seekerY,
        status: 'idle',
        health: seekerStats.health,
        maxHealth: seekerStats.maxHealth,
        damage: seekerStats.damage,
        range: seekerStats.range,
        speed: seekerStats.speed,
        fireRate: seekerStats.fireRate
    };
    gameState.units.push(oilSeeker);

    botController.lastActionTime = 0;
    botController.update(gameState);
    botController.lastActionTime = 0;
    botController.update(gameState);

    const spotRevealedOnMap = !hiddenSpot.id.startsWith('hidden');
    const afterReveal = {
        revealed: spotRevealedOnMap || botController.revealedSpots.has(hiddenSpot.id),
        oilWells: getOwnedBuildingCount(gameState, botId, 'oil_well')
    };

    if (!afterReveal.revealed || afterReveal.oilWells < 1) {
        console.error(JSON.stringify({ stage: 'after_reveal', afterReveal, hiddenSpotId: hiddenSpot.id }, null, 2));
        process.exit(1);
    }

    console.log(JSON.stringify({ beforeReveal, afterReveal, hiddenSpotId: hiddenSpot.id }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
