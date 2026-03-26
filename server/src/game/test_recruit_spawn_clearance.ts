import { GameState, Player, Unit } from './GameState';
import type { Building, GameMap, Island } from './MapGenerator';

function getExpectedBuildingRadius(buildingType: Building['type'], unitType: string): number {
    if (buildingType === 'base') return unitType === 'builder' ? 40 : 50;
    return 30;
}

function isInsideBuilding(unit: Unit, island: Island): boolean {
    return island.buildings.some(building => {
        if (building.type === 'bridge_node' || building.type === 'wall_node') return false;

        const buildingX = island.x + (building.x || 0);
        const buildingY = island.y + (building.y || 0);
        const buffer = unit.type === 'builder' ? 8 : 5;
        const radius = getExpectedBuildingRadius(building.type, unit.type);
        return Math.hypot(unit.x - buildingX, unit.y - buildingY) < radius + buffer;
    });
}

const playerId = 'player-host';
const island: Island = {
    id: 'test-island',
    x: 500,
    y: 500,
    radius: 230,
    type: 'grasslands',
    buildings: [],
    goldSpots: []
};

const base: Building = {
    id: 'base-test',
    type: 'base',
    level: 1,
    health: 500,
    maxHealth: 500,
    x: -90,
    y: -10,
    ownerId: playerId
};

const barracks: Building = {
    id: 'barracks-test',
    type: 'barracks',
    level: 1,
    health: 300,
    maxHealth: 300,
    x: 85,
    y: 10,
    ownerId: playerId
};

island.buildings.push(base, barracks);

const map: GameMap = {
    width: 1200,
    height: 1200,
    islands: [island],
    oilSpots: [],
    bridges: [],
    version: 'recruit-spawn-test'
};

const player: Player = {
    id: playerId,
    color: '#f97316',
    resources: { gold: 9999, oil: 9999 },
    status: 'active',
    canBuildHQ: false,
    hqRespawnsUsed: 0,
    hqSpawnedOnce: true
};

const gameState = new GameState('islands');
gameState.map = map;
gameState.players.set(playerId, player);
gameState.units = [];

for (let i = 0; i < 12; i++) {
    gameState.spawnUnit(playerId, 'soldier', island, barracks);
}

for (let i = 0; i < 6; i++) {
    gameState.spawnUnit(playerId, 'builder', island, base);
}

const recruitedSoldiers = gameState.units.filter(unit => unit.type === 'soldier');
const recruitedBuilders = gameState.units.filter(unit => unit.type === 'builder');

const soldierViolations = recruitedSoldiers.filter(unit => isInsideBuilding(unit, island));
const builderViolations = recruitedBuilders.filter(unit => isInsideBuilding(unit, island));

const summary = {
    soldiersSpawned: recruitedSoldiers.length,
    buildersSpawned: recruitedBuilders.length,
    soldierViolations: soldierViolations.map(unit => ({ id: unit.id, x: unit.x, y: unit.y })),
    builderViolations: builderViolations.map(unit => ({ id: unit.id, x: unit.x, y: unit.y }))
};

if (soldierViolations.length > 0 || builderViolations.length > 0) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
