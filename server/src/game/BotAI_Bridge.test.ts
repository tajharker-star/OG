
import { MapGenerator, GameMap, Island } from './MapGenerator';
import { BotAI } from './BotAI';
import { GameState } from './GameState';
import { UnitData, BuildingData } from './data/Registry';

// Mock console to keep output clean(er)
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
    // Uncomment to see logs
    originalConsoleLog(...args);
};

// --- Mocks ---
const mockIo = {
    emit: (event: string, data: any) => {},
    to: (room: string) => ({ emit: (event: string, data: any) => {} })
};

class MockGameState extends GameState {
    constructor() {
        super('islands');
        // Reset state
        this.players.clear();
        this.units = [];
        this.map = {
            width: 2000,
            height: 2000,
            islands: [],
            oilSpots: [],
            bridges: []
        };
        this.mapType = 'islands';
    }

    buildStructure(playerId: string, locationId: string, type: any, x?: number, y?: number): boolean {
        console.log(`[Mock] buildStructure called: ${type} at ${x},${y} for ${playerId}`);
        const result = super.buildStructure(playerId, locationId, type, x, y);
        console.log(`[Mock] buildStructure result: ${result}`);
        if (!result) {
            const player = this.players.get(playerId);
            const stats = BuildingData[type];
            console.log(`[Mock] Debug: Gold=${player?.resources.gold}, Cost=${stats?.cost?.gold}`);
            // Check other failure conditions
            const island = this.map.islands.find(i => i.id === locationId);
            if (island && x !== undefined && y !== undefined) {
                const targetX = x - island.x;
                const targetY = y - island.y;
                const dist = Math.hypot(targetX, targetY);
                console.log(`[Mock] Debug: Dist=${dist}, Radius=${island.radius}`);
            }
        }
        return result;
    }
}

// --- Test ---
console.log("Starting BotAI Bridge Test...");

const gameState = new MockGameState();

// Setup Bot Player
const botId = 'bot_1';
// Fix: Correct signature (id, isBot, name, difficulty)
gameState.addPlayer(botId, true, 'Bot 1', 10);
const player = gameState.players.get(botId)!;
// Give lots of gold
player.resources.gold = 5000;
player.resources.oil = 5000;

// Setup Islands (2 close islands)
// Island 1 at (500, 500) radius 70 (Small to avoid manageWalls)
// Island 2 at (800, 500) radius 70
// Distance = 300. Combined Radius = 140. Gap = 160.
// Perfect for bridge.
const existingBuildings = [
    { id: 'b_base', type: 'base', health: 1000, maxHealth: 1000, x: 0, y: 0, isConstructing: false },
    { id: 'b_barracks', type: 'barracks', health: 500, maxHealth: 500, x: 10, y: 10, isConstructing: false },
    { id: 'b_dock', type: 'dock', health: 500, maxHealth: 500, x: 20, y: 20, isConstructing: false },
    { id: 'b_t1', type: 'tower', health: 200, maxHealth: 200, x: -20, y: -20, isConstructing: false },
    { id: 'b_t2', type: 'tower', health: 200, maxHealth: 200, x: -30, y: -30, isConstructing: false },
    { id: 'b_t3', type: 'tower', health: 200, maxHealth: 200, x: -40, y: -40, isConstructing: false }
];

gameState.map.islands.push({
    id: 'island_1',
    x: 500,
    y: 500,
    radius: 70,
    type: 'grasslands',
    ownerId: botId,
    buildings: JSON.parse(JSON.stringify(existingBuildings)), // Deep copy
    goldSpots: []
});

gameState.map.islands.push({
    id: 'island_2',
    x: 800,
    y: 500,
    radius: 70,
    type: 'grasslands',
    ownerId: botId,
    buildings: JSON.parse(JSON.stringify(existingBuildings)), // Deep copy
    goldSpots: []
});

// Add a builder to Island 1
gameState.units.push({
    id: 'builder_1',
    ownerId: botId,
    type: 'builder',
    x: 500,
    y: 500,
    status: 'idle',
    health: 100,
    maxHealth: 100,
    damage: 0,
    range: 50,
    speed: 5,
    fireRate: 0
});

// Add a builder to Island 2 (to avoid travel time issues for test speed)
gameState.units.push({
    id: 'builder_2',
    ownerId: botId,
    type: 'builder',
    x: 800,
    y: 500,
    status: 'idle',
    health: 100,
    maxHealth: 100,
    damage: 0,
    range: 50,
    speed: 5,
    fireRate: 0
});

const botAI = new BotAI(botId, 10); // Difficulty 10 = Fast

// Helper to simulate ticks and movement
function runTicks(ticks: number) {
    for (let i = 0; i < ticks; i++) {
        // Force bot update
        botAI.lastActionTime = 0;
        // Run bot update
        botAI.update(gameState);

        // Simulate Unit Movement (simplified)
        gameState.units.forEach(u => {
            if (u.targetX !== undefined && u.targetY !== undefined) {
                const dx = u.targetX - u.x;
                const dy = u.targetY - u.y;
                const dist = Math.hypot(dx, dy);
                
                if (dist <= u.speed) {
                    u.x = u.targetX;
                    u.y = u.targetY;
                    delete u.targetX;
                    delete u.targetY;
                    u.status = 'idle';
                } else {
                    u.x += (dx / dist) * u.speed;
                    u.y += (dy / dist) * u.speed;
                    u.status = 'moving';
                }
            }
        });
        
        // Simulate Construction Progress
        gameState.map.islands.forEach(island => {
            island.buildings.forEach(b => {
                if (b.isConstructing) {
                    // Fix: Handle optional constructionProgress
                    b.constructionProgress = (b.constructionProgress || 0) + 10; // Fast build
                    if (b.constructionProgress >= b.maxHealth) {
                        b.isConstructing = false;
                        b.health = b.maxHealth;
                    }
                }
            });
        });
    }
}


console.log("Test: Building Bridge Nodes...");
// Run enough ticks for bot to decide and builders to build
// Tick 1: Bot scans, sees gap, orders Node 1.
// Ticks 2-20: Builder 1 builds Node 1.
// Tick 21: Bot scans, sees Node 1, sees gap, orders Node 2.
// Ticks 22-40: Builder 2 builds Node 2.
// Tick 41: Bot scans, sees both nodes, connects them.

runTicks(50);

const i1 = gameState.map.islands.find(i => i.id === 'island_1')!;
const i2 = gameState.map.islands.find(i => i.id === 'island_2')!;

const node1 = i1.buildings.find(b => b.type === 'bridge_node');
const node2 = i2.buildings.find(b => b.type === 'bridge_node');

if (node1) console.log("PASS: Bridge Node 1 built on Island 1");
else console.error("FAIL: Bridge Node 1 NOT built");

if (node2) console.log("PASS: Bridge Node 2 built on Island 2");
else console.error("FAIL: Bridge Node 2 NOT built");

if (node1 && node2) {
    console.log("Test: Connecting Bridge...");
    // Run more ticks to allow connection logic to trigger
    runTicks(10);
    
    const bridge = gameState.map.bridges.find(b => 
        (b.nodeAId === node1.id && b.nodeBId === node2.id) ||
        (b.nodeAId === node2.id && b.nodeBId === node1.id)
    );
    
    if (bridge) {
        console.log("PASS: Bridge connected successfully!");
    } else {
        console.error("FAIL: Bridge NOT connected");
    }
}
