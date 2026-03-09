import { GameState } from './GameState';
import { MapGenerator } from './MapGenerator';
import { BotAI } from './BotAI';

type ScenarioResult = {
    scenario: number;
    islandRadius: number;
    hqEdgeClearance: number;
    dockBuilt: boolean;
    wallNodes: number;
    gateNodeAId: string;
    gateNodeBId: string;
};

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

function getBaseIsland(gameState: GameState, playerId: string) {
    const island = gameState.map.islands.find(candidate =>
        candidate.buildings.some(building => building.type === 'base' && building.ownerId === playerId)
    );
    if (!island) {
        throw new Error(`Base island missing for ${playerId}`);
    }
    return island;
}

async function runScenario(scenario: number): Promise<ScenarioResult> {
    const playerId = `bot-${scenario}`;
    const gameState = new GameState('islands');
    gameState.mapType = 'islands';
    gameState.map = MapGenerator.generate(3200, 2400, 40, 'islands');
    gameState.map.mapType = 'islands';

    gameState.addPlayer(playerId, true, undefined, 10);
    const player = gameState.players.get(playerId);
    if (!player) {
        throw new Error(`Player missing for ${playerId}`);
    }
    player.resources = { gold: 18000, oil: 6000 };

    gameState.units = [];
    gameState.assignStartingIsland(playerId);

    const bot = new BotAI(playerId, 10) as any;
    gameState.bots.push(bot);

    const island = getBaseIsland(gameState, playerId);
    const base = island.buildings.find(building => building.type === 'base' && building.ownerId === playerId);
    if (!base) {
        throw new Error(`Base missing for ${playerId}`);
    }

    const hqX = island.x + (base.x || 0);
    const hqY = island.y + (base.y || 0);
    const closestEdge = island.points
        ? MapGenerator.getClosestPointOnPolygon(hqX, hqY, island.points)
        : { x: island.x, y: island.y };
    const hqEdgeClearance = island.points
        ? Math.hypot(hqX - closestEdge.x, hqY - closestEdge.y)
        : island.radius - Math.hypot(hqX - island.x, hqY - island.y);

    const preferredDock = bot.baseDefenseBuilder.getPreferredDockPlacement(gameState, island);
    if (!preferredDock) {
        throw new Error(`No preferred dock placement found in scenario ${scenario}`);
    }

    const dockBuilt = gameState.buildStructure(playerId, island.id, 'dock', preferredDock.x, preferredDock.y);
    if (!dockBuilt) {
        throw new Error(`Dock build failed in scenario ${scenario}`);
    }
    finishOwnedConstruction(gameState, playerId);

    for (let tick = 0; tick < 28; tick++) {
        bot.apmTokens = 1000;
        bot.baseDefenseBuilder.tick(gameState, Date.now() + tick * 1200);
        finishOwnedConstruction(gameState, playerId);
    }

    const dock = island.buildings.find(building => building.type === 'dock' && building.ownerId === playerId);
    if (!dock) {
        throw new Error(`Dock missing after build in scenario ${scenario}`);
    }

    const wallNodes = island.buildings.filter(building => building.type === 'wall_node' && building.ownerId === playerId);
    if (wallNodes.length < 3) {
        throw new Error(`Expected at least 3 wall nodes in scenario ${scenario}, found ${wallNodes.length}`);
    }

    const nodeRadius = gameState.getBuildingFootprintRadius('wall_node');
    const dockRadius = gameState.getBuildingFootprintRadius('dock');
    const edgeViolations = wallNodes
        .map(node => {
            const absX = island.x + (node.x || 0);
            const absY = island.y + (node.y || 0);
            const edge = island.points
                ? MapGenerator.getClosestPointOnPolygon(absX, absY, island.points)
                : { x: island.x, y: island.y };
            const distanceToEdge = island.points
                ? Math.hypot(absX - edge.x, absY - edge.y)
                : Math.abs(Math.hypot(absX - island.x, absY - island.y) - island.radius);
            return distanceToEdge > nodeRadius + 10 ? `${node.id}:${distanceToEdge.toFixed(1)}` : null;
        })
        .filter((value): value is string => value !== null);
    if (edgeViolations.length > 0) {
        throw new Error(`Wall nodes drifted off the coastline in scenario ${scenario}: ${edgeViolations.join(', ')}`);
    }

    const dockX = island.x + (dock.x || 0);
    const dockY = island.y + (dock.y || 0);
    const dockBlockingNodes = wallNodes
        .map(node => {
            const absX = island.x + (node.x || 0);
            const absY = island.y + (node.y || 0);
            const distance = Math.hypot(absX - dockX, absY - dockY);
            return distance < dockRadius + nodeRadius + 8 ? `${node.id}:${distance.toFixed(1)}` : null;
        })
        .filter((value): value is string => value !== null);
    if (dockBlockingNodes.length > 0) {
        throw new Error(`Wall nodes blocked the dock corridor in scenario ${scenario}: ${dockBlockingNodes.join(', ')}`);
    }

    const sortedNodes = wallNodes
        .map(node => {
            const absX = island.x + (node.x || 0);
            const absY = island.y + (node.y || 0);
            return {
                node,
                angle: Math.atan2(absY - hqY, absX - hqX)
            };
        })
        .sort((left, right) => left.angle - right.angle);

    let largestGap = -1;
    let gapPair: { a: string; b: string } | null = null;
    for (let i = 0; i < sortedNodes.length; i++) {
        const current = sortedNodes[i];
        const next = sortedNodes[(i + 1) % sortedNodes.length];
        const gap = i === sortedNodes.length - 1
            ? (sortedNodes[0].angle + Math.PI * 2) - current.angle
            : next.angle - current.angle;

        if (gap > largestGap) {
            largestGap = gap;
            gapPair = {
                a: current.node.id,
                b: next.node.id
            };
        }
    }

    const gate = gameState.map.bridges.find(bridge =>
        bridge.ownerId === playerId &&
        bridge.type === 'gate' &&
        bridge.islandAId === island.id &&
        bridge.islandBId === island.id
    );
    if (!gate || !gapPair) {
        throw new Error(`Expected one gate on the base island in scenario ${scenario}`);
    }

    const gateMatchesGap =
        (gate.nodeAId === gapPair.a && gate.nodeBId === gapPair.b) ||
        (gate.nodeAId === gapPair.b && gate.nodeBId === gapPair.a);
    if (!gateMatchesGap) {
        throw new Error(
            `Gate did not match the reserved dock opening in scenario ${scenario}: gate=${gate.nodeAId}-${gate.nodeBId} gap=${gapPair.a}-${gapPair.b}`
        );
    }

    return {
        scenario,
        islandRadius: island.radius,
        hqEdgeClearance: Number(hqEdgeClearance.toFixed(1)),
        dockBuilt,
        wallNodes: wallNodes.length,
        gateNodeAId: gate.nodeAId,
        gateNodeBId: gate.nodeBId
    };
}

async function main() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    try {
        const results: ScenarioResult[] = [];
        for (let scenario = 0; scenario < 4; scenario++) {
            results.push(await runScenario(scenario));
        }

        console.log = originalLog;
        console.warn = originalWarn;
        originalLog(JSON.stringify(results, null, 2));
    } catch (error) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error(error);
        process.exit(1);
    }
}

main();
