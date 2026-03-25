import { GameState, Unit } from './GameState';
import { BuildingData } from './data/Registry';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function createTestUnit(ownerId: string): Unit {
    return {
        id: 'unit_owner_a_0',
        ownerId,
        type: 'soldier',
        x: 900,
        y: 760,
        status: 'idle',
        health: 100,
        maxHealth: 100,
        damage: 10,
        range: 100,
        speed: 100,
        fireRate: 1000
    };
}

async function main() {
    const gameState = new GameState('desert');
    gameState.status = 'playing';
    gameState.matchState = 'IN_MATCH';
    gameState.startTime = Date.now() - 30_000;
    gameState.players.clear();
    gameState.units = [];
    gameState.bots = [];

    gameState.addPlayer('owner_a', false, 'Owner A', 1);
    gameState.addPlayer('owner_b', false, 'Owner B', 1);

    const island = {
        id: 'test_island',
        x: 1100,
        y: 760,
        radius: 650,
        type: 'desert' as const,
        ownerId: 'owner_a',
        buildings: [
            {
                id: 'base_owner_a',
                type: 'base',
                level: 1,
                ownerId: 'owner_a',
                x: -220,
                y: 0,
                health: 1,
                maxHealth: BuildingData.base.maxHealth,
                isConstructing: false,
                constructionProgress: 100,
                range: BuildingData.base.range
            },
            {
                id: 'tower_owner_a',
                type: 'tower',
                level: 1,
                ownerId: 'owner_a',
                x: -120,
                y: 0,
                health: 500,
                maxHealth: 500,
                isConstructing: false,
                constructionProgress: 100,
                range: BuildingData.tower.range
            },
            {
                id: 'barracks_owner_a',
                type: 'barracks',
                level: 1,
                ownerId: 'owner_a',
                x: -80,
                y: 60,
                health: 600,
                maxHealth: 600,
                isConstructing: false,
                constructionProgress: 100,
                range: BuildingData.barracks.range
            },
            {
                id: 'base_owner_b',
                type: 'base',
                level: 1,
                ownerId: 'owner_b',
                x: 220,
                y: 0,
                health: BuildingData.base.maxHealth,
                maxHealth: BuildingData.base.maxHealth,
                isConstructing: false,
                constructionProgress: 100,
                range: BuildingData.base.range
            }
        ],
        goldSpots: []
    };

    gameState.map = {
        width: 2400,
        height: 1600,
        islands: [island as any],
        oilSpots: [
            {
                id: 'oil_owner_a',
                x: 1000,
                y: 760,
                radius: 35,
                occupiedBy: 'oil_well_owner_a',
                ownerId: 'owner_a',
                building: {
                    id: 'oil_well_owner_a',
                    ownerId: 'owner_a',
                    type: 'oil_well',
                    level: 1,
                    x: -100,
                    y: 0,
                    health: 400,
                    maxHealth: 400,
                    isConstructing: false,
                    constructionProgress: 100,
                    range: 0
                }
            } as any
        ],
        bridges: [],
        mapType: 'desert'
    } as any;

    gameState.units.push(createTestUnit('owner_a'));
    gameState.units.push({
        ...createTestUnit('owner_b'),
        id: 'unit_owner_b_0',
        x: 1300,
        ownerId: 'owner_b'
    });

    gameState.eliminatePlayer('owner_a', 'HQ_DESTROYED');

    const collapseStates = (gameState as any).playerCollapseStates as Map<string, { startedAt: number; ticksApplied: number; nextTickAt: number }>;
    const state = collapseStates.get('owner_a');
    assert(state, 'collapse state should be created for eliminated owner');

    const tower = island.buildings.find((building: any) => building.id === 'tower_owner_a');
    const unit = gameState.units.find(current => current.id === 'unit_owner_a_0');
    assert(tower && unit, 'owner_a assets should still exist immediately after elimination');
    assert((tower as any).burning === true, 'tower should be flagged as burning');
    assert((unit as any).burning === true, 'unit should be flagged as burning');

    (gameState as any).processPlayerAssetCollapse(state.startedAt + 1000);
    gameState.cleanupDeadEntities();

    const towerAfterOneTick = island.buildings.find((building: any) => building.id === 'tower_owner_a');
    const unitAfterOneTick = gameState.units.find(current => current.id === 'unit_owner_a_0');
    assert(towerAfterOneTick && unitAfterOneTick, 'assets should survive the first collapse tick');
    assert(Math.round(towerAfterOneTick.health) === 450, `tower should lose 10% HP on tick 1 (got ${towerAfterOneTick.health})`);
    assert(Math.round(unitAfterOneTick.health) === 90, `unit should lose 10% HP on tick 1 (got ${unitAfterOneTick.health})`);

    for (let tick = 2; tick <= 10; tick += 1) {
        (gameState as any).processPlayerAssetCollapse(state.startedAt + tick * 1000);
        gameState.cleanupDeadEntities();
    }

    assert(!collapseStates.has('owner_a'), 'collapse state should be removed after 10 ticks');
    assert(gameState.units.every(current => current.ownerId !== 'owner_a'), 'owner_a units should be destroyed after full collapse');

    const ownerABuildings = gameState.map.islands.flatMap(currentIsland =>
        currentIsland.buildings.filter((building: any) => building.ownerId === 'owner_a')
    );
    assert(ownerABuildings.length === 0, 'owner_a buildings should be destroyed after full collapse');

    const ownedOil = gameState.map.oilSpots.filter(spot => (spot as any).ownerId === 'owner_a');
    assert(ownedOil.length === 0, 'owner_a oil structures should be destroyed after full collapse');

    console.log(
        JSON.stringify(
            {
                test: 'base-collapse-decay',
                result: 'pass',
                ticks: 10
            },
            null,
            2
        )
    );
}

main();
