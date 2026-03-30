import { GameState } from './GameState';
import { MapGenerator } from './MapGenerator';

function collectBaseAngles(gameState: GameState) {
    const centerX = gameState.map.width / 2;
    const centerY = gameState.map.height / 2;
    const bases: Array<{ islandId: string; x: number; y: number; angle: number }> = [];

    gameState.map.islands.forEach(island => {
        island.buildings.forEach(building => {
            if (building.type !== 'base') return;
            const x = island.x + (building.x || 0);
            const y = island.y + (building.y || 0);
            bases.push({
                islandId: island.id,
                x,
                y,
                angle: Math.atan2(y - centerY, x - centerX)
            });
        });
    });

    return bases.sort((left, right) => left.angle - right.angle);
}

function getMinAngleGap(angles: Array<{ angle: number }>): number {
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < angles.length; i += 1) {
        const current = angles[i];
        const next = angles[(i + 1) % angles.length];
        const nextAngle = i === angles.length - 1 ? next.angle + Math.PI * 2 : next.angle;
        minGap = Math.min(minGap, nextAngle - current.angle);
    }
    return minGap;
}

async function main() {
    const summaries: Array<{ run: number; minGap: number; quadrants: number; islands: string[] }> = [];

    for (let run = 0; run < 4; run += 1) {
        const gameState = new GameState('islands');
        gameState.mapType = 'islands';
        gameState.map = MapGenerator.generate(3200, 2400, 40, 'islands');
        gameState.map.mapType = 'islands';

        for (let i = 0; i < 6; i += 1) {
            gameState.addPlayer(`p${i}`);
        }

        gameState.players.forEach(player => {
            player.status = 'active';
            player.canBuildHQ = true;
            player.hqRespawnsUsed = 0;
            player.hqSpawnedOnce = false;
        });

        Array.from(gameState.players.keys()).forEach(playerId => {
            gameState.assignStartingIsland(playerId);
        });

        const bases = collectBaseAngles(gameState);
        const centerX = gameState.map.width / 2;
        const centerY = gameState.map.height / 2;
        const quadrants = new Set(
            bases.map(base => `${base.x >= centerX ? 1 : 0}${base.y >= centerY ? 1 : 0}`)
        ).size;

        summaries.push({
            run,
            minGap: Number(getMinAngleGap(bases).toFixed(3)),
            quadrants,
            islands: bases.map(base => base.islandId)
        });
    }

    const failed = summaries.find(summary => summary.minGap < 0.35 || summary.quadrants < 3);
    if (failed) {
        console.error(JSON.stringify({ failed, summaries }, null, 2));
        process.exit(1);
    }

    console.log(JSON.stringify({ summaries }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
