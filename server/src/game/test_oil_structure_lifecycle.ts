import { GameState } from './GameState';
import { BuildingData, UnitData } from './data/Registry';
import { GameMap, Island, OilSpot } from './MapGenerator';

type OilLifecycleSummary = {
    scenario: 'land_oil_well' | 'water_oil_rig';
    firstStructureId: string;
    secondStructureId: string;
    rebuiltOnSameSpot: boolean;
    spotClearedAfterDestroy: boolean;
};

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
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
        goldSpots: []
    };
}

function addBase(island: Island, ownerId: string) {
    island.buildings.push({
        id: `base_${ownerId}_${island.id}`,
        type: 'base',
        level: 1,
        health: BuildingData.base.maxHealth,
        maxHealth: BuildingData.base.maxHealth,
        x: 0,
        y: 0,
        ownerId,
        isConstructing: false,
        constructionProgress: 100,
        range: BuildingData.base.range
    });
}

function addBuilder(gameState: GameState, ownerId: string, x: number, y: number) {
    gameState.units.push({
        id: `builder_${ownerId}_${gameState.units.length}`,
        ownerId,
        type: 'builder',
        x,
        y,
        status: 'idle',
        health: UnitData.builder.maxHealth,
        maxHealth: UnitData.builder.maxHealth,
        damage: UnitData.builder.damage,
        range: UnitData.builder.range,
        speed: 120,
        fireRate: UnitData.builder.fireRate
    });
}

function addConstructionShip(gameState: GameState, ownerId: string, x: number, y: number) {
    gameState.units.push({
        id: `construction_ship_${ownerId}_${gameState.units.length}`,
        ownerId,
        type: 'construction_ship',
        x,
        y,
        status: 'idle',
        health: UnitData.construction_ship.maxHealth,
        maxHealth: UnitData.construction_ship.maxHealth,
        damage: UnitData.construction_ship.damage,
        range: UnitData.construction_ship.range,
        speed: 120,
        fireRate: UnitData.construction_ship.fireRate
    });
}

function finishConstruction(building: any) {
    building.isConstructing = false;
    building.constructionProgress = 100;
    building.health = building.maxHealth;
}

function createLandOilGame(): { gameState: GameState; playerId: string; island: Island; oilSpot: OilSpot } {
    const playerId = 'land-player';
    const island = createIsland('desert_island', 800, 700, 320, 'desert', playerId);
    addBase(island, playerId);

    const oilSpot: OilSpot = {
        id: 'hidden_oil_land_0',
        x: island.x + 70,
        y: island.y - 20,
        radius: 35
    };

    const map: GameMap = {
        width: 1600,
        height: 1200,
        islands: [island],
        oilSpots: [oilSpot],
        bridges: [],
        mapType: 'desert'
    };

    const gameState = new GameState('desert');
    gameState.mapType = 'desert';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, false, 'Tester');

    const player = gameState.players.get(playerId);
    assert(!!player, 'land player missing');
    player!.resources = { gold: 5000, oil: 5000 };
    addBuilder(gameState, playerId, island.x + 40, island.y);

    return { gameState, playerId, island, oilSpot };
}

function createWaterOilGame(): { gameState: GameState; playerId: string; oilSpot: OilSpot } {
    const playerId = 'water-player';
    const island = createIsland('home_island', 400, 600, 180, 'grasslands', playerId);
    addBase(island, playerId);

    const oilSpot: OilSpot = {
        id: 'oil_water_0',
        x: 760,
        y: 600,
        radius: 18
    };

    const map: GameMap = {
        width: 1600,
        height: 1200,
        islands: [island],
        oilSpots: [oilSpot],
        bridges: [],
        mapType: 'grasslands'
    };

    const gameState = new GameState('grasslands');
    gameState.mapType = 'grasslands';
    gameState.map = map;
    gameState.players.clear();
    gameState.units = [];
    gameState.addPlayer(playerId, false, 'Tester');

    const player = gameState.players.get(playerId);
    assert(!!player, 'water player missing');
    player!.resources = { gold: 5000, oil: 5000 };
    addConstructionShip(gameState, playerId, oilSpot.x + 20, oilSpot.y);

    return { gameState, playerId, oilSpot };
}

function runLandOilWellLifecycle(): OilLifecycleSummary {
    const { gameState, playerId, island, oilSpot } = createLandOilGame();
    const firstBuilt = gameState.buildStructure(playerId, island.id, 'oil_well', oilSpot.x, oilSpot.y);
    assert(firstBuilt, 'failed to place first land oil well');

    const firstWell = island.buildings.find(building => building.type === 'oil_well');
    assert(!!firstWell, 'first land oil well missing from island');
    assert((oilSpot as any).building === firstWell, 'land oil well should share the same oil spot building record');
    finishConstruction(firstWell);

    gameState.damageBuilding((oilSpot as any).building, firstWell!.maxHealth + 10);
    gameState.cleanupDeadEntities();

    const spotClearedAfterDestroy = !oilSpot.occupiedBy && !(oilSpot as any).ownerId && !(oilSpot as any).building;
    assert(spotClearedAfterDestroy, 'land oil spot did not clear after destruction');
    assert(!island.buildings.some(building => building.id === firstWell!.id), 'destroyed land oil well remained on island');

    const secondBuilt = gameState.buildStructure(playerId, island.id, 'oil_well', oilSpot.x, oilSpot.y);
    assert(secondBuilt, 'failed to rebuild land oil well on the same spot');

    const secondWell = island.buildings.find(building => building.type === 'oil_well');
    assert(!!secondWell, 'rebuilt land oil well missing from island');
    assert(secondWell!.id !== firstWell!.id, 'rebuilt land oil well reused the destroyed structure id');
    assert(oilSpot.occupiedBy === secondWell!.id, 'land oil spot did not bind to rebuilt oil well');

    return {
        scenario: 'land_oil_well',
        firstStructureId: firstWell!.id,
        secondStructureId: secondWell!.id,
        rebuiltOnSameSpot: oilSpot.occupiedBy === secondWell!.id,
        spotClearedAfterDestroy
    };
}

function runWaterOilRigLifecycle(): OilLifecycleSummary {
    const { gameState, playerId, oilSpot } = createWaterOilGame();
    const firstBuilt = gameState.buildStructure(playerId, oilSpot.id, 'oil_rig');
    assert(firstBuilt, 'failed to place first water oil rig');

    const firstRig = (oilSpot as any).building;
    assert(!!firstRig, 'first water oil rig missing from oil spot');
    finishConstruction(firstRig);

    gameState.damageBuilding(firstRig, firstRig.maxHealth + 10);
    gameState.cleanupDeadEntities();

    const spotClearedAfterDestroy = !oilSpot.occupiedBy && !(oilSpot as any).ownerId && !(oilSpot as any).building;
    assert(spotClearedAfterDestroy, 'water oil spot did not clear after rig destruction');

    const secondBuilt = gameState.buildStructure(playerId, oilSpot.id, 'oil_rig');
    assert(secondBuilt, 'failed to rebuild water oil rig on the same spot');

    const secondRig = (oilSpot as any).building;
    assert(!!secondRig, 'rebuilt water oil rig missing from oil spot');
    assert(secondRig.id !== firstRig.id, 'rebuilt water oil rig reused the destroyed structure id');

    return {
        scenario: 'water_oil_rig',
        firstStructureId: firstRig.id,
        secondStructureId: secondRig.id,
        rebuiltOnSameSpot: oilSpot.occupiedBy === secondRig.id,
        spotClearedAfterDestroy
    };
}

function main() {
    const results = [runLandOilWellLifecycle(), runWaterOilRigLifecycle()];
    console.log(JSON.stringify(results, null, 2));
}

main();
