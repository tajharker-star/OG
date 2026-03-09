import { GameState } from './GameState';
import { MapGenerator, Island } from './MapGenerator';

function findPlacementNear(
    gameState: GameState,
    island: Island,
    buildingType: string,
    anchorX: number,
    anchorY: number,
    minDistance: number,
    maxDistance: number
) {
    const resolvesToTargetIsland = (x: number, y: number) => {
        const candidates = gameState.map.islands.filter(candidate => {
            if (candidate.points) return MapGenerator.isPointInPolygon(x, y, candidate.points);
            return Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius + 50;
        });

        candidates.sort((left, right) => left.radius - right.radius);
        return candidates[0]?.id === island.id;
    };

    for (let radius = minDistance; radius <= maxDistance; radius += 8) {
        for (let step = 0; step < 48; step++) {
            const angle = (step / 48) * Math.PI * 2;
            const x = anchorX + Math.cos(angle) * radius;
            const y = anchorY + Math.sin(angle) * radius;
            if (!resolvesToTargetIsland(x, y)) continue;
            if (gameState.isBuildingPlacementClearOnIsland(island, buildingType, x, y)) {
                return { x, y };
            }
        }
    }

    return null;
}

async function main() {
    const gameState = new GameState('desert');
    gameState.mapType = 'desert';
    gameState.map = MapGenerator.generate(3200, 2400, 40, 'desert');
    gameState.map.mapType = 'desert';

    gameState.addPlayer('player-1');
    const player = gameState.players.get('player-1');
    if (!player) throw new Error('player-1 not found');
    player.resources = { gold: 5000, oil: 5000 };

    gameState.units = [];
    gameState.assignStartingIsland('player-1');

    const island = gameState.map.islands.find(i =>
        i.buildings.some(b => b.type === 'base' && b.ownerId === 'player-1')
    );
    if (!island) throw new Error('Player base island not found');

    const base = island.buildings.find(b => b.type === 'base' && b.ownerId === 'player-1');
    const builder = gameState.units.find(u => u.ownerId === 'player-1' && u.type === 'builder');
    if (!base || !builder) throw new Error('Base or builder missing');

    const hqX = island.x + (base.x || 0);
    const hqY = island.y + (base.y || 0);
    const barracksRadius = gameState.getBuildingFootprintRadius('barracks');
    const baseRadius = gameState.getBuildingFootprintRadius('base');

    const firstSpot = findPlacementNear(
        gameState,
        island,
        'barracks',
        hqX,
        hqY,
        baseRadius + barracksRadius + 18,
        baseRadius + barracksRadius + 280
    );
    if (!firstSpot) throw new Error('Failed to find first barracks position');

    const firstPlaced = gameState.buildStructure('player-1', builder.id, 'barracks', firstSpot.x, firstSpot.y);
    if (!firstPlaced) throw new Error('Failed to place first barracks');

    const barracks = gameState.map.islands
        .flatMap(candidate => candidate.buildings.map(building => ({ candidate, building })))
        .find(entry => entry.building.type === 'barracks' && entry.building.ownerId === 'player-1');
    if (!barracks) throw new Error('Placed barracks not found');

    const barracksIsland = barracks.candidate;
    const barracksBuilding = barracks.building;
    const barracksX = barracksIsland.x + (barracksBuilding.x || 0);
    const barracksY = barracksIsland.y + (barracksBuilding.y || 0);
    const blockedOffset = (barracksRadius * 2) + 2;
    const blockedX = barracksX + blockedOffset;
    const blockedY = barracksY;
    const blockedPlaced = gameState.buildStructure('player-1', builder.id, 'barracks', blockedX, blockedY);

    const secondSpot = findPlacementNear(
        gameState,
        barracksIsland,
        'barracks',
        barracksX,
        barracksY,
        (barracksRadius * 2) + 10,
        (barracksRadius * 2) + 160
    );
    if (!secondSpot) throw new Error('Failed to find second barracks position');

    const secondPlaced = gameState.buildStructure('player-1', builder.id, 'barracks', secondSpot.x, secondSpot.y);
    if (!secondPlaced) throw new Error('Failed to place second barracks');

    const builtBarracks = barracksIsland.buildings.filter(b => b.type === 'barracks' && b.ownerId === 'player-1');
    const firstSecondDist = builtBarracks.length >= 2
        ? Math.hypot(
            (builtBarracks[0].x || 0) - (builtBarracks[1].x || 0),
            (builtBarracks[0].y || 0) - (builtBarracks[1].y || 0)
        )
        : null;

    if (blockedPlaced) {
        throw new Error('Blocked overlapping barracks placement succeeded unexpectedly');
    }

    console.log(JSON.stringify({
        firstPlaced,
        blockedPlaced,
        secondPlaced,
        barracksCount: builtBarracks.length,
        baseRadius,
        barracksRadius,
        firstSecondDist
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
