import { GameState } from './GameState';
import { MapGenerator } from './MapGenerator';
import { BotAI } from './BotAI';

function getOwnedBuildings(gameState: GameState, playerId: string) {
    return gameState.map.islands.flatMap(island =>
        island.buildings
            .filter(building => building.ownerId === playerId)
            .map(building => ({
                island,
                building,
                x: island.x + (building.x || 0),
                y: island.y + (building.y || 0)
            }))
    );
}

function getOverlapViolations(gameState: GameState, playerId: string) {
    const owned = getOwnedBuildings(gameState, playerId);
    const violations: string[] = [];

    for (let i = 0; i < owned.length; i++) {
        for (let j = i + 1; j < owned.length; j++) {
            const left = owned[i];
            const right = owned[j];
            const padding = Math.max(
                left.building.type === 'wall_node' || left.building.type === 'bridge_node' || left.building.type === 'wall' ? 2 : 4,
                right.building.type === 'wall_node' || right.building.type === 'bridge_node' || right.building.type === 'wall' ? 2 : 4
            );
            const minDistance =
                gameState.getBuildingFootprintRadius(left.building.type) +
                gameState.getBuildingFootprintRadius(right.building.type) +
                padding;
            const distance = Math.hypot(left.x - right.x, left.y - right.y);

            if (distance < minDistance) {
                violations.push(`${left.building.type}:${left.building.id}<->${right.building.type}:${right.building.id}`);
            }
        }
    }

    return violations;
}

function finishOwnedConstruction(gameState: GameState, playerId: string) {
    gameState.map.islands.forEach(island => {
        island.buildings.forEach(building => {
            if (building.ownerId !== playerId || !building.isConstructing) return;
            building.isConstructing = false;
            building.constructionProgress = 100;
            building.health = building.maxHealth;
        });
    });
}

async function runScenario(mapType: 'desert' | 'grasslands') {
    const gameState = new GameState(mapType);
    gameState.mapType = mapType;
    gameState.map = MapGenerator.generate(3200, 2400, 40, mapType);
    gameState.map.mapType = mapType;

    gameState.addPlayer('bot');
    const player = gameState.players.get('bot');
    if (!player) throw new Error(`bot missing for ${mapType}`);
    player.resources = { gold: 8000, oil: 4000 };

    gameState.units = [];
    gameState.assignStartingIsland('bot');

    const bot = new BotAI('bot', 10) as any;
    gameState.bots.push(bot);

    const island = gameState.map.islands.find(i =>
        i.buildings.some(b => b.type === 'base' && b.ownerId === 'bot')
    );
    if (!island) throw new Error(`Base island missing for ${mapType}`);

    const base = island.buildings.find(b => b.type === 'base' && b.ownerId === 'bot');
    if (!base) throw new Error(`Base missing for ${mapType}`);

    const hqX = island.x + (base.x || 0);
    const hqY = island.y + (base.y || 0);
    const baseRadius = gameState.getBuildingFootprintRadius('base');

    for (let i = 0; i < 18; i++) {
        bot.apmTokens = 1000;
        bot.baseDefenseBuilder.tick(gameState, Date.now() + (i * 1200));
        finishOwnedConstruction(gameState, 'bot');
    }

    const owned = getOwnedBuildings(gameState, 'bot');
    const towers = owned.filter(entry => entry.building.type === 'tower');
    const nodes = owned.filter(entry => entry.building.type === 'wall_node');

    if (towers.length === 0) {
        throw new Error(`No tower placed for ${mapType}`);
    }

    if (nodes.length === 0) {
        throw new Error(`No wall node placed for ${mapType}`);
    }

    const distanceViolations = owned
        .filter(entry => entry.building.type === 'tower' || entry.building.type === 'wall_node')
        .map(entry => {
            const footprint = gameState.getBuildingFootprintRadius(entry.building.type);
            const distance = Math.hypot(entry.x - hqX, entry.y - hqY);
            const minDistance = baseRadius + footprint + 10;
            const maxDistance = entry.building.type === 'tower'
                ? baseRadius + footprint + 100
                : baseRadius + footprint + 140;

            if (distance < minDistance || distance > maxDistance) {
                return `${entry.building.type}:${entry.building.id}:${distance.toFixed(1)}`;
            }

            return null;
        })
        .filter((value): value is string => value !== null);

    const overlapViolations = getOverlapViolations(gameState, 'bot');
    if (distanceViolations.length > 0) {
        throw new Error(`Distance violations for ${mapType}: ${distanceViolations.join(', ')}`);
    }
    if (overlapViolations.length > 0) {
        throw new Error(`Overlap violations for ${mapType}: ${overlapViolations.join(', ')}`);
    }

    return {
        mapType,
        towers: towers.length,
        wallNodes: nodes.length,
        nearestTower: Math.min(...towers.map(entry => Math.hypot(entry.x - hqX, entry.y - hqY))),
        nearestWallNode: Math.min(...nodes.map(entry => Math.hypot(entry.x - hqX, entry.y - hqY)))
    };
}

async function main() {
    const results = [];
    results.push(await runScenario('desert'));
    results.push(await runScenario('grasslands'));
    console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
