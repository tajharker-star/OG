import { GameState } from './GameState';
import { MapGenerator } from './MapGenerator';
import { BotAI } from './BotAI';

function getOwnedBuildingCount(gameState: GameState, playerId: string, type: string): number {
    return gameState.map.islands.reduce((count, island) => {
        return count + island.buildings.filter(building => building.type === type && building.ownerId === playerId).length;
    }, 0);
}

async function main() {
    const gameState = new GameState('desert');
    gameState.mapType = 'desert';
    gameState.map = MapGenerator.generate(3200, 2400, 40, 'desert');
    gameState.map.mapType = 'desert';

    gameState.addPlayer('human');
    gameState.addPlayer('bot-10', true, undefined, 10);

    gameState.players.forEach(player => {
        player.resources = { gold: 5000, oil: 5000 };
        player.status = 'active';
        player.canBuildHQ = true;
        player.hqRespawnsUsed = 0;
        player.hqSpawnedOnce = false;
    });

    gameState.units = [];
    gameState.assignStartingIsland('human');
    gameState.assignStartingIsland('bot-10');
    gameState.status = 'playing';

    const botController = new BotAI('bot-10', 10) as any;
    gameState.bots.push(botController);

    botController.actionInterval = 0;
    botController.minBuildDelay = 0;
    botController.maxBuildDelay = 0;
    botController.currentBuildDelay = 0;

    const io = {
        to() {
            return {
                emit() {
                    return undefined;
                }
            };
        }
    };

    gameState.startGameLoop(io, 'desert-test');

    await new Promise(resolve => setTimeout(resolve, 10000));

    gameState.stopGameLoop();

    const botBaseIsland = gameState.map.islands.find(island =>
        island.buildings.some(building => building.type === 'base' && building.ownerId === 'bot-10')
    );

    const summary = {
        botBaseIslandId: botBaseIsland?.id ?? null,
        botBaseIslandOwnerId: botBaseIsland?.ownerId ?? null,
        botBuilders: gameState.units.filter(unit => unit.ownerId === 'bot-10' && unit.type === 'builder').length,
        botBarracks: getOwnedBuildingCount(gameState, 'bot-10', 'barracks'),
        botTankFactories: getOwnedBuildingCount(gameState, 'bot-10', 'tank_factory'),
        botOwnedBuildings: gameState.map.islands.flatMap(island =>
            island.buildings
                .filter(building => building.ownerId === 'bot-10')
                .map(building => ({ islandId: island.id, type: building.type }))
        )
    };

    const progressed = summary.botBuilders >= 2 && summary.botBarracks >= 1;
    if (!progressed) {
        console.error(JSON.stringify(summary, null, 2));
        process.exit(1);
    }

    console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
