import { MapGenerator, GameMap, Island, Building, Bridge } from './MapGenerator';
import { BotAI } from './BotAI';
import { createBotAI } from './BotAIFactory';
import { UnitData, BuildingData } from './data/Registry';
import { randomUUID } from 'crypto';

const ENABLE_VALID_POSITION_LOGS = process.env.DEBUG_VALID_POSITION === '1';
const SIMULATION_TICKS_PER_SECOND = 30;
const CONSTRUCTION_SPEED_MULTIPLIER = 3;

export interface Player {
    id: string;
    color: string;
    name?: string;
    resources: {
        gold: number;
        oil: number;
    };
    isBot?: boolean;
    difficulty?: number;
    status?: 'active' | 'eliminated';
    godMode?: boolean;
    canBuildHQ?: boolean;
    hqRespawnsUsed?: number;
    hqSpawnedOnce?: boolean;
}

export interface Unit {
    id: string;
    ownerId: string;
    type: string;
    x: number;
    y: number;
    targetIslandId?: string;
    targetX?: number;
    targetY?: number;
    status: 'idle' | 'moving' | 'fighting';
    health: number;
    maxHealth: number;
    damage: number;
    range: number;
    speed: number;
    fireRate: number;
    lastAttackTime?: number;
    cargo?: Unit[]; // Units inside
    recruitmentQueue?: { unitType: string, progress: number, totalTime: number }[];
    abilityCooldown?: number;
    laserTargetId?: string;
    laserActive?: boolean;
    laserEndTime?: number;
    laserLastTick?: number;
    intentId?: string;
    path?: { x: number, y: number }[];
    facingAngle?: number;
}

export class GameState {
    map: GameMap;
    players: Map<string, Player>;
    units: Unit[];
    bots: BotAI[];
    startTime: number;
    gameEnded: boolean = false;
    lastTickTime: number = 0;
    lastMapEmitTime: number = 0;
    lastUnitEmitTime: number = 0;
    tickCounter: number = 0;
    io: any;
    roomId: string | undefined;
    gameLoopInterval: any = null;
    pendingProjectiles: any[] = [];
    eliminatedPlayerIds: Set<string> = new Set();
    matchState: 'LOBBY' | 'STARTING' | 'IN_MATCH' | 'ENDED' = 'LOBBY';
    winnerId: string | null = null;
    endReason: string | null = null;
    status: 'waiting' | 'voting' | 'starting' | 'playing' = 'waiting';
    voteEndTime: number = 0;
    mapVotes = new Map<string, string>();
    requiredPlayers = 2;
    tunnelUrl?: string;
    password?: string;
    mapType: string = 'random';
    serverRegion: string = 'US-East';
    private startupHqCheckTimeout: NodeJS.Timeout | null = null;
    private playerCollapseStates: Map<string, { startedAt: number; ticksApplied: number; nextTickAt: number }> = new Map();
    private humanMatchReadyPlayerIds: Set<string> = new Set();
    private requireHumanReadyForBotStart: boolean = false;
    private botsReleasedForMatch: boolean = true;
    private traversalPathCache: Map<string, string[]> = new Map();
    private economySecondAccumulator: number = 0;

    // Spatial Grid for O(N) optimization
    private grid: Map<string, Unit[]> = new Map();
    private readonly cellSize = 200;

    constructor(mapType: string = 'random') {
        this.mapType = mapType;
        this.serverRegion = 'NA-East-1';

        // Initial dummy map for lobby background or empty
        this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any);
        this.map.mapType = this.mapType;
        this.map.serverRegion = this.serverRegion;
        this.map.waterBuildings = this.map.waterBuildings || [];
        this.map.version = randomUUID();

        this.players = new Map();
        this.units = [];
        this.bots = [];
        this.startTime = Date.now();
    }

    private touchMapVersion() {
        this.map.waterBuildings = this.map.waterBuildings || [];
        this.map.version = randomUUID();
    }

    private getActiveHumanPlayerIds(): string[] {
        return Array.from(this.players.values())
            .filter(player => !player.isBot && player.status !== 'eliminated')
            .map(player => player.id);
    }

    private areAllHumansReadyForMatchStart(): boolean {
        if (!this.requireHumanReadyForBotStart) return true;
        const humanIds = this.getActiveHumanPlayerIds();
        if (humanIds.length === 0) return true;
        return humanIds.every(playerId => this.humanMatchReadyPlayerIds.has(playerId));
    }

    private releaseBotsForHumanReadyGate(reason: string) {
        if (this.botsReleasedForMatch) return;
        const now = Date.now();
        this.botsReleasedForMatch = true;
        this.matchState = 'IN_MATCH';
        this.bots.forEach(bot => bot.resetMatchStartTime(now));
        console.log(`[BOT_START_GATE] released room=${this.roomId || 'unknown'} reason=${reason} ready=${this.humanMatchReadyPlayerIds.size}/${this.getActiveHumanPlayerIds().length}`);
    }

    public armHumanReadyBotStartGate() {
        this.humanMatchReadyPlayerIds.clear();
        this.requireHumanReadyForBotStart = true;
        const humanIds = this.getActiveHumanPlayerIds();
        this.botsReleasedForMatch = humanIds.length === 0;
        this.matchState = this.botsReleasedForMatch ? 'IN_MATCH' : 'STARTING';
        if (this.botsReleasedForMatch) {
            const now = Date.now();
            this.bots.forEach(bot => bot.resetMatchStartTime(now));
        } else {
            console.log(`[BOT_START_GATE] armed room=${this.roomId || 'unknown'} humans=${humanIds.length}`);
        }
    }

    public markHumanPlayerMatchReady(playerId: string): boolean {
        if (!this.requireHumanReadyForBotStart || this.status !== 'playing') return false;
        const player = this.players.get(playerId);
        if (!player || player.isBot || player.status === 'eliminated') return false;

        const sizeBefore = this.humanMatchReadyPlayerIds.size;
        this.humanMatchReadyPlayerIds.add(playerId);
        if (this.humanMatchReadyPlayerIds.size !== sizeBefore) {
            console.log(`[BOT_START_GATE] ready room=${this.roomId || 'unknown'} player=${playerId} progress=${this.humanMatchReadyPlayerIds.size}/${this.getActiveHumanPlayerIds().length}`);
        }

        if (this.areAllHumansReadyForMatchStart()) {
            this.releaseBotsForHumanReadyGate('all_humans_ready');
        }

        return true;
    }

    private isOwnerOnlyBuilding(building: Building): boolean {
        return building.type === 'naval_mine' || !!BuildingData[building.type]?.hiddenFromEnemies;
    }

    private isBuildingVisibleToPlayer(building: Building, playerId: string): boolean {
        if (!this.isOwnerOnlyBuilding(building)) return true;
        return building.ownerId === playerId;
    }

    public getVisibleMapForPlayer(playerId: string): GameMap {
        return {
            ...this.map,
            islands: this.map.islands.map(island => ({
                ...island,
                points: island.points?.map(point => ({ ...point })),
                goldSpots: island.goldSpots.map(spot => ({ ...spot })),
                buildings: island.buildings
                    .filter(building => this.isBuildingVisibleToPlayer(building, playerId))
                    .map(building => ({
                        ...building,
                        recruitmentQueue: building.recruitmentQueue?.map(item => ({ ...item }))
                    }))
            })),
            oilSpots: this.map.oilSpots.map(spot => ({ ...(spot as any) })),
            bridges: this.map.bridges.map(bridge => ({ ...bridge })),
            waterBuildings: (this.map.waterBuildings || [])
                .filter(building => this.isBuildingVisibleToPlayer(building as Building, playerId))
                .map(building => ({
                    ...building,
                    recruitmentQueue: building.recruitmentQueue?.map(item => ({ ...item }))
                })),
            highGrounds: this.map.highGrounds?.map(highGround => ({
                ...highGround,
                points: highGround.points.map(point => ({ ...point }))
            }))
        };
    }

    public emitVisibleMapData(io: any, roomId?: string) {
        const targetRoomId = roomId || this.roomId;
        if (!io || !targetRoomId) return;

        let emitted = false;
        this.players.forEach(player => {
            if (player.isBot) return;
            io.to(player.id).emit('mapData', this.getVisibleMapForPlayer(player.id));
            emitted = true;
        });

        if (!emitted) {
            io.to(targetRoomId).emit('mapData', this.map);
        }
    }

    public emitVisibleMapDataToPlayer(io: any, playerId: string) {
        if (!io) return;
        io.to(playerId).emit('mapData', this.getVisibleMapForPlayer(playerId));
    }

    private getBuildSupportUnitTypes(type: string): string[] {
        if (type === 'naval_mine') return ['construction_ship'];
        if (type === 'bridge_node') return ['builder', 'construction_ship'];
        return ['builder'];
    }

    private getBuildSupportRange(type: string): number {
        if (type === 'oil_rig') return 150;
        if (type === 'naval_mine') return 180;
        if (type === 'bridge_node') return 220;
        return 400;
    }

    private canBuildOnNeutralIsland(type: string): boolean {
        return type === 'bridge_node';
    }

    private getBuildSupportUnitsInRange(playerId: string, type: string, x: number, y: number, range: number): Unit[] {
        const allowedTypes = new Set(this.getBuildSupportUnitTypes(type));
        return this.units.filter(unit =>
            unit.ownerId === playerId &&
            allowedTypes.has(unit.type) &&
            Math.hypot(unit.x - x, unit.y - y) <= range
        );
    }

    private getClosestBuildSupportUnit(playerId: string, type: string, x: number, y: number): Unit | null {
        const allowedTypes = new Set(this.getBuildSupportUnitTypes(type));
        const workers = this.units.filter(unit => unit.ownerId === playerId && allowedTypes.has(unit.type));
        if (workers.length === 0) return null;

        return workers.reduce((best, unit) => {
            if (!best) return unit;
            const bestDist = Math.hypot(best.x - x, best.y - y);
            const unitDist = Math.hypot(unit.x - x, unit.y - y);
            return unitDist < bestDist ? unit : best;
        }, workers[0]);
    }

    private isNavalMinePlacementClear(absX: number, absY: number): boolean {
        const footprint = this.getBuildingFootprintRadius('naval_mine');
        if (
            absX < footprint ||
            absX > this.map.width - footprint ||
            absY < footprint ||
            absY > this.map.height - footprint
        ) {
            return false;
        }

        if (!this.isValidPosition(absX, absY, 'destroyer')) {
            return false;
        }

        const minSpacing = BuildingData.naval_mine?.minSpacing ?? 110;
        for (const building of this.map.waterBuildings || []) {
            if (building.type !== 'naval_mine') continue;
            const mineX = building.x || 0;
            const mineY = building.y || 0;
            if (Math.hypot(mineX - absX, mineY - absY) < minSpacing) {
                return false;
            }
        }

        return true;
    }

    private clearTraversalCaches() {
        this.pathCache.clear();
        this.traversalPathCache.clear();
    }

    private isPointOnAnyIslandSurface(x: number, y: number): boolean {
        return this.map.islands.some(island => this.isPointOnIslandSurface(island, x, y));
    }

    private getExactIslandCandidatesAtPoint(x: number, y: number): Island[] {
        return this.map.islands
            .filter(island => this.isPointOnIslandSurface(island, x, y))
            .sort((a, b) => a.radius - b.radius);
    }

    private isBridgeNodeWaterPlacementClear(absX: number, absY: number): boolean {
        const footprint = this.getBuildingFootprintRadius('bridge_node');
        if (
            absX < footprint ||
            absX > this.map.width - footprint ||
            absY < footprint ||
            absY > this.map.height - footprint
        ) {
            return false;
        }

        if (this.isPointOnAnyIslandSurface(absX, absY)) {
            return false;
        }

        if (!this.isValidPosition(absX, absY, 'construction_ship')) {
            return false;
        }

        for (const spot of this.map.oilSpots) {
            if (Math.hypot(spot.x - absX, spot.y - absY) < spot.radius + 10) {
                return false;
            }
        }

        const minSpacing = Math.max(18, footprint * 2);
        for (const building of this.map.waterBuildings || []) {
            if (!building.id) continue;
            const otherX = building.x || 0;
            const otherY = building.y || 0;
            const sameFamily =
                building.type === 'bridge_node' ||
                building.type === 'naval_mine' ||
                building.type === 'oil_rig';
            if (!sameFamily) continue;
            if (Math.hypot(otherX - absX, otherY - absY) < minSpacing) {
                return false;
            }
        }

        return true;
    }

    public getNodeContext(nodeId: string): { node: Building; island?: Island; islandId?: string; x: number; y: number } | null {
        for (const island of this.map.islands) {
            const node = island.buildings.find(building => building.id === nodeId);
            if (!node) continue;
            return {
                node,
                island,
                islandId: island.id,
                x: island.x + (node.x || 0),
                y: island.y + (node.y || 0)
            };
        }

        for (const building of this.map.waterBuildings || []) {
            if (building.id !== nodeId) continue;
            return {
                node: building,
                x: building.x || 0,
                y: building.y || 0
            };
        }

        return null;
    }

    public getBridgeEndpoints(bridge: Bridge | any): { ax: number; ay: number; bx: number; by: number } | null {
        const nodeA = this.getNodeContext(bridge.nodeAId);
        const nodeB = this.getNodeContext(bridge.nodeBId);
        if (!nodeA || !nodeB) return null;

        return {
            ax: nodeA.x,
            ay: nodeA.y,
            bx: nodeB.x,
            by: nodeB.y
        };
    }

    private getBridgeNodeDegree(nodeId: string): number {
        return this.map.bridges.filter(bridge =>
            bridge.type === 'bridge' && (bridge.nodeAId === nodeId || bridge.nodeBId === nodeId)
        ).length;
    }

    private hasBridgeNodePath(startNodeId: string, endNodeId: string): boolean {
        if (startNodeId === endNodeId) return true;

        const visited = new Set<string>([startNodeId]);
        const queue: string[] = [startNodeId];

        while (queue.length > 0) {
            const currentNodeId = queue.shift()!;
            const neighbors = this.map.bridges
                .filter(bridge =>
                    bridge.type === 'bridge' &&
                    (bridge.nodeAId === currentNodeId || bridge.nodeBId === currentNodeId)
                )
                .map(bridge => bridge.nodeAId === currentNodeId ? bridge.nodeBId : bridge.nodeAId);

            for (const neighbor of neighbors) {
                if (neighbor === endNodeId) return true;
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }

        return false;
    }

    public findIslandTraversalPath(startIslandId: string, endIslandId: string): string[] | null {
        const cacheKey = `${startIslandId}->${endIslandId}`;
        if (this.traversalPathCache.has(cacheKey)) {
            return this.traversalPathCache.get(cacheKey)!;
        }

        const startToken = `island:${startIslandId}`;
        const endToken = `island:${endIslandId}`;
        const queue: Array<{ token: string; path: string[] }> = [{ token: startToken, path: [startToken] }];
        const visited = new Set<string>([startToken]);

        const getNeighbors = (token: string): string[] => {
            if (token.startsWith('island:')) {
                const islandId = token.slice('island:'.length);
                const island = this.map.islands.find(candidate => candidate.id === islandId);
                if (!island) return [];

                const neighbors = island.buildings
                    .filter(building => building.type === 'bridge_node' && !building.isConstructing && building.health > 0)
                    .map(building => `node:${building.id}`);

                this.map.islands.forEach(other => {
                    if (other.id === island.id) return;
                    if (!this.areIslandsLandConnected(island, other)) return;
                    neighbors.push(`island:${other.id}`);
                });

                return neighbors;
            }

            const nodeId = token.slice('node:'.length);
            const context = this.getNodeContext(nodeId);
            if (!context || context.node.type !== 'bridge_node' || context.node.isConstructing || context.node.health <= 0) {
                return [];
            }

            const neighbors: string[] = [];
            if (context.islandId) {
                neighbors.push(`island:${context.islandId}`);
            }

            this.map.bridges.forEach(bridge => {
                if (bridge.type !== 'bridge') return;
                if (bridge.nodeAId === nodeId) neighbors.push(`node:${bridge.nodeBId}`);
                if (bridge.nodeBId === nodeId) neighbors.push(`node:${bridge.nodeAId}`);
            });

            return neighbors;
        };

        while (queue.length > 0) {
            const { token, path } = queue.shift()!;
            if (token === endToken) {
                this.traversalPathCache.set(cacheKey, path);
                return path;
            }

            for (const neighbor of getNeighbors(token)) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push({ token: neighbor, path: [...path, neighbor] });
            }
        }

        return null;
    }

    private isLandUnitType(type: string): boolean {
        return ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(type);
    }

    private isWaterUnitType(type: string): boolean {
        return ['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(type);
    }

    private isAirUnitType(type: string): boolean {
        return ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type);
    }

    private isHospitalUnitType(type: string): boolean {
        return ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(type);
    }

    private processSupportBuildingHealingTick() {
        this.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (building.isConstructing || !building.ownerId) return;
                if (building.type !== 'hospital' && building.type !== 'repair_dock') return;

                const owner = this.players.get(building.ownerId);
                if (!owner || owner.status === 'eliminated') return;

                const centerX = island.x + (building.x || 0);
                const centerY = island.y + (building.y || 0);
                const healRadius = building.range || BuildingData[building.type]?.range || 220;
                const isHospital = building.type === 'hospital';

                this.units.forEach(unit => {
                    if (unit.ownerId !== building.ownerId || unit.health >= unit.maxHealth) return;

                    const isHospitalUnit = this.isHospitalUnitType(unit.type);
                    if (isHospital && !isHospitalUnit) return;
                    if (!isHospital && isHospitalUnit) return;

                    if (Math.hypot(unit.x - centerX, unit.y - centerY) > healRadius) return;

                    const missingHealth = unit.maxHealth - unit.health;
                    const healAmount = missingHealth * 0.05;
                    unit.health = Math.min(unit.maxHealth, unit.health + healAmount);
                });
            });
        });
    }

    private getSimulationTickDelta(deltaTimeSeconds: number) {
        if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds <= 0) return 0;
        return deltaTimeSeconds * SIMULATION_TICKS_PER_SECOND;
    }

    private processEconomySecondTick() {
        this.players.forEach(player => {
            let goldIncome = 1;
            let oilIncome = 0;

            this.map.oilSpots.forEach(spot => {
                if ((spot as any).ownerId === player.id && (spot as any).building && !(spot as any).building.isConstructing) {
                    if ((spot as any).building.type === 'oil_rig') {
                        goldIncome += 200;
                        oilIncome += 5;
                    } else if ((spot as any).building.type === 'oil_well') {
                        goldIncome += 200;
                        oilIncome += 5;
                    } else {
                        oilIncome += 5;
                    }
                }
            });

            this.map.islands.forEach(island => {
                if (island.ownerId === player.id) {
                    goldIncome += 1;
                }

                island.buildings.forEach(b => {
                    if (b.ownerId !== player.id) return;
                    if (b.isConstructing) return;
                    if (b.type === 'mine') goldIncome += 50;
                    if (b.type === 'base') goldIncome += 10;
                    if (b.type === 'farm') goldIncome += 25;
                });
            });

            player.resources.gold += goldIncome;
            player.resources.oil += oilIncome;
        });

        this.processSupportBuildingHealingTick();
    }

    private advanceEconomy(deltaTimeSeconds: number) {
        if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds <= 0) return;

        this.economySecondAccumulator += deltaTimeSeconds;
        const wholeSeconds = Math.floor(this.economySecondAccumulator);
        if (wholeSeconds <= 0) return;

        this.economySecondAccumulator -= wholeSeconds;
        for (let second = 0; second < wholeSeconds; second += 1) {
            this.processEconomySecondTick();
        }
    }

    private advanceConstructionRepairAndRecruitment(deltaTimeSeconds: number) {
        const tickDelta = this.getSimulationTickDelta(deltaTimeSeconds);
        if (tickDelta <= 0) return;

        const processConstruction = (b: any, x: number, y: number, ownerId: string) => {
            if (!b.isConstructing) return;

            const stats = BuildingData[b.type];
            if (!stats) {
                console.log(`[Construction] Missing stats for ${b.type}, finishing instantly.`);
                b.isConstructing = false;
                b.health = b.maxHealth;
                return;
            }

            const totalTicks = stats.constructionTime || 100;
            let progressPerTick = (100 / totalTicks) * CONSTRUCTION_SPEED_MULTIPLIER;

            if (!isNaN(x) && !isNaN(y)) {
                const builders = this.getNearbyUnits(x, y, 300).filter(u =>
                    u.ownerId === ownerId &&
                    (u.type === 'builder' || u.type === 'construction_ship')
                );

                if (builders.length > 0) {
                    progressPerTick *= (1 + builders.length * 1.0);
                }
            }

            b.constructionProgress = (b.constructionProgress || 0) + (progressPerTick * tickDelta);
            const calculatedHealth = Math.floor(b.maxHealth * (b.constructionProgress / 100));
            b.health = Math.max(1, Math.min(b.maxHealth, calculatedHealth));

            if (b.constructionProgress >= 100) {
                b.constructionProgress = 100;
                b.isConstructing = false;
                b.health = b.maxHealth;
            }
        };

        const processRepair = (b: any, x: number, y: number, ownerId: string) => {
            if (b.isConstructing || b.health >= b.maxHealth) return;
            if (b.type === 'bridge_node' || b.type === 'wall_node') return;

            const enemyPressure = this.getNearbyUnits(x, y, b.type === 'base' ? 325 : 240).some(u =>
                u.ownerId !== ownerId &&
                u.health > 0 &&
                !['builder', 'construction_ship', 'oil_seeker', 'ferry'].includes(u.type)
            );
            if (enemyPressure) return;

            if (!isNaN(x) && !isNaN(y)) {
                const builders = this.getNearbyUnits(x, y, 150).filter(u =>
                    u.ownerId === ownerId &&
                    u.type === 'builder' &&
                    u.status === 'idle'
                );

                if (builders.length > 0) {
                    const count = Math.min(builders.length, 5);
                    const repairAmount = 0.15 * count * tickDelta;
                    b.health = Math.min(b.maxHealth, b.health + repairAmount);
                }
            }
        };

        const processRecruitment = (b: any, island: any) => {
            if (!b.recruitmentQueue || b.recruitmentQueue.length === 0) return;

            let remainingTickBudget = tickDelta;
            while (b.recruitmentQueue.length > 0 && remainingTickBudget > 0) {
                const item = b.recruitmentQueue[0];
                item.progress = item.progress || 0;
                item.totalTime = item.totalTime || 100;

                const remainingTicks = Math.max(0, item.totalTime - item.progress);
                if (remainingTicks > remainingTickBudget) {
                    item.progress += remainingTickBudget;
                    remainingTickBudget = 0;
                    break;
                }

                item.progress = item.totalTime;
                remainingTickBudget -= remainingTicks;

                const ownerId = b.ownerId || (island ? island.ownerId : null);
                if (ownerId) {
                    this.spawnUnit(ownerId, item.unitType, island, b);
                }
                b.recruitmentQueue.shift();
            }
        };

        this.map.islands.forEach(island => {
            island.buildings.forEach(b => {
                if (!b.ownerId) return;
                processConstruction(b, island.x + (b.x || 0), island.y + (b.y || 0), b.ownerId);
                processRepair(b, island.x + (b.x || 0), island.y + (b.y || 0), b.ownerId);
                processRecruitment(b, island);
            });
        });

        this.units.forEach(u => {
            if (u.type === 'mothership' || u.type === 'aircraft_carrier') {
                processRecruitment(u, null);
            }
        });

        this.map.oilSpots.forEach(spot => {
            const b = (spot as any).building;
            if (b && (spot as any).ownerId) {
                if (this.isOilStructureBackedByIslandBuilding(b)) return;
                processConstruction(b, spot.x, spot.y, (spot as any).ownerId);
                processRepair(b, spot.x, spot.y, (spot as any).ownerId);
            }
        });

        (this.map.waterBuildings || []).forEach(building => {
            if (!building.ownerId) return;
            processConstruction(building, building.x || 0, building.y || 0, building.ownerId);
            processRepair(building, building.x || 0, building.y || 0, building.ownerId);
        });
    }

    private isUnitWithinFriendlyRepairDock(unit: Unit): boolean {
        return this.map.islands.some(island =>
            island.buildings.some(building => {
                if (building.type !== 'repair_dock' || building.isConstructing || building.ownerId !== unit.ownerId) return false;
                const centerX = island.x + (building.x || 0);
                const centerY = island.y + (building.y || 0);
                const healRadius = building.range || BuildingData[building.type]?.range || 220;
                return Math.hypot(unit.x - centerX, unit.y - centerY) <= healRadius;
            })
        );
    }

    private applyDamageOverTimeEffect(unit: Unit, type: string, durationMs: number, damagePerSecond: number, now: number) {
        const effects = ((unit as any).damageOverTimeEffects || []) as Array<{
            type: string;
            endsAt: number;
            damagePerSecond: number;
        }>;
        const existing = effects.find(effect => effect.type === type);
        if (existing) {
            existing.endsAt = Math.max(existing.endsAt, now + durationMs);
            existing.damagePerSecond = Math.max(existing.damagePerSecond, damagePerSecond);
        } else {
            effects.push({
                type,
                endsAt: now + durationMs,
                damagePerSecond
            });
        }

        (unit as any).damageOverTimeEffects = effects;
        (unit as any).burning = true;
        (unit as any).burningUntil = Math.max((unit as any).burningUntil || 0, now + durationMs);
    }

    private processDamageOverTime(deltaTimeSeconds: number, now: number) {
        this.units.forEach(unit => {
            const owner = this.players.get(unit.ownerId);
            const effects = (((unit as any).damageOverTimeEffects || []) as Array<{
                type: string;
                endsAt: number;
                damagePerSecond: number;
            }>).filter(effect => effect.endsAt > now);

            if (effects.length === 0) {
                (unit as any).damageOverTimeEffects = [];
                if (((unit as any).burningUntil || 0) <= now) {
                    delete (unit as any).burning;
                    delete (unit as any).burningUntil;
                }
                return;
            }

            (unit as any).damageOverTimeEffects = effects;
            if (owner?.godMode) return;

            const protectedByRepairDock = this.isUnitWithinFriendlyRepairDock(unit);
            const totalDamagePerSecond = effects.reduce((sum, effect) => {
                let effectDamage = effect.damagePerSecond;
                if (protectedByRepairDock && effect.type === 'naval_mine_burn') {
                    effectDamage *= 0.2;
                }
                return sum + effectDamage;
            }, 0);
            unit.health -= totalDamagePerSecond * deltaTimeSeconds;
            (unit as any).burning = true;
            (unit as any).burningUntil = Math.max(...effects.map(effect => effect.endsAt));
        });
    }

    private processNavalMineTriggers(now: number) {
        const waterBuildings = this.map.waterBuildings || [];
        if (waterBuildings.length === 0) return;

        const triggerRadius = BuildingData.naval_mine?.range ?? 38;
        const blastRadius = UnitData.pirate_ship?.range ?? 180;
        const blastDamage = BuildingData.naval_mine?.damage ?? 500;

        waterBuildings.forEach(building => {
            if (building.type !== 'naval_mine' || building.isConstructing || !building.ownerId || building.health <= 0) return;
            const mineX = building.x || 0;
            const mineY = building.y || 0;

            const triggerTarget = this.units
                .filter(unit =>
                    unit.ownerId !== building.ownerId &&
                    unit.health > 0 &&
                    this.isWaterUnitType(unit.type) &&
                    Math.hypot(unit.x - mineX, unit.y - mineY) <= triggerRadius
                )
                .sort((left, right) =>
                    Math.hypot(left.x - mineX, left.y - mineY) -
                    Math.hypot(right.x - mineX, right.y - mineY)
                )[0];

            if (!triggerTarget) return;

            const affectedUnits = this.units.filter(unit =>
                unit.ownerId !== building.ownerId &&
                unit.health > 0 &&
                this.isWaterUnitType(unit.type) &&
                Math.hypot(unit.x - mineX, unit.y - mineY) <= blastRadius
            );

            affectedUnits.forEach(unit => {
                if (!this.players.get(unit.ownerId)?.godMode) {
                    unit.health -= blastDamage;
                }
            });

            this.pendingProjectiles.push({
                x1: mineX,
                y1: mineY,
                x2: mineX,
                y2: mineY,
                type: 'naval_mine_blast',
                speed: 0,
                radius: blastRadius
            });
            building.health = 0;
        });
    }

    public getBuildingFootprintRadius(buildingType: string): number {
        const configuredRadius = BuildingData[buildingType]?.radius;
        if (typeof configuredRadius === 'number') return configuredRadius;

        if (buildingType === 'base') return 36;
        if (buildingType === 'dock') return 28;
        if (buildingType === 'tower') return 18;
        if (buildingType === 'wall') return 10;
        if (buildingType === 'bridge_node' || buildingType === 'wall_node') return 10;
        return 30;
    }

    public getBuildingPlacementRadius(buildingType: string): number {
        return this.getEffectivePlacementFootprintRadius(buildingType);
    }

    private isNonBlockingBuildingType(buildingType: string): boolean {
        return buildingType === 'mine' || buildingType === 'bridge_node' || buildingType === 'naval_mine';
    }

    private getEffectivePlacementFootprintRadius(buildingType: string, _island?: Island): number {
        if (this.isNonBlockingBuildingType(buildingType)) return 0;
        const baseRadius = this.getBuildingFootprintRadius(buildingType);

        if (buildingType === 'air_base') {
            if (this.mapType === 'islands') return Math.max(14, Math.round(baseRadius * 0.5));
            return Math.max(22, Math.round(baseRadius * 0.7));
        }

        if (this.mapType === 'islands') {
            if (['barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'dock', 'hospital', 'repair_dock'].includes(buildingType)) {
                return Math.max(9, Math.round(baseRadius * 0.68));
            }
            if (buildingType === 'wall' || buildingType === 'wall_node') {
                return Math.max(5, Math.round(baseRadius * 0.7));
            }
        }

        return baseRadius;
    }

    private getBuildingCollisionRadius(buildingType: string, _unitType?: string): number {
        if (this.isNonBlockingBuildingType(buildingType)) return 0;
        if (this.mapType === 'islands' && ['air_base', 'barracks', 'tank_factory', 'tower', 'dock', 'oil_well', 'hospital', 'repair_dock'].includes(buildingType)) {
            return Math.max(8, Math.round(this.getBuildingFootprintRadius(buildingType) * 0.72));
        }
        return this.getBuildingFootprintRadius(buildingType);
    }

    private getBuildingPlacementPadding(buildingType: string): number {
        if (this.isNonBlockingBuildingType(buildingType)) return 0;
        if (buildingType === 'air_base') return this.mapType === 'islands' ? 0 : 2;
        if (this.mapType === 'islands' && ['wall', 'wall_node'].includes(buildingType)) return 1;
        if (buildingType === 'wall_node' || buildingType === 'wall') return 2;
        if (this.mapType === 'islands' && ['air_base', 'barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'dock', 'hospital', 'repair_dock'].includes(buildingType)) {
            return 0;
        }
        return 4;
    }

    public isBuildingPlacementClearOnIsland(island: Island, buildingType: string, absX: number, absY: number): boolean {
        const footprint = this.getEffectivePlacementFootprintRadius(buildingType, island);
        const nonBlocking = this.isNonBlockingBuildingType(buildingType);

        if (
            absX < footprint ||
            absX > this.map.width - footprint ||
            absY < footprint ||
            absY > this.map.height - footprint
        ) {
            return false;
        }

        if (this.map.highGrounds) {
            for (const hg of this.map.highGrounds) {
                if (absX < hg.x - hg.radius - footprint || absX > hg.x + hg.radius + footprint || absY < hg.y - hg.radius - footprint || absY > hg.y + hg.radius + footprint) {
                    continue;
                }

                if (MapGenerator.isPointInPolygon(absX, absY, hg.points)) {
                    return false;
                }

                const closest = MapGenerator.getClosestPointOnPolygon(absX, absY, hg.points);
                const highGroundEdgePadding = nonBlocking ? 0 : footprint + 4;
                if (Math.hypot(absX - closest.x, absY - closest.y) < highGroundEdgePadding) {
                    return false;
                }
            }
        }

        if (buildingType !== 'dock' && buildingType !== 'oil_rig') {
            const edgePadding = nonBlocking
                ? 0
                : this.mapType === 'islands'
                    ? ['air_base', 'barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'hospital', 'repair_dock'].includes(buildingType)
                        ? Math.max(1, Math.round(footprint * 0.15))
                        : Math.max(1, Math.round(footprint * 0.25))
                    : footprint + 4;
            if (island.points) {
                if (!MapGenerator.isPointInPolygon(absX, absY, island.points)) {
                    return false;
                }

                const closest = MapGenerator.getClosestPointOnPolygon(absX, absY, island.points);
                if (Math.hypot(absX - closest.x, absY - closest.y) < edgePadding) {
                    return false;
                }
            } else if (Math.hypot(absX - island.x, absY - island.y) > Math.max(0, island.radius - footprint - edgePadding)) {
                return false;
            }
        }

        if (nonBlocking) return true;

        return !island.buildings.some(existing => {
            if (this.isNonBlockingBuildingType(existing.type)) return false;
            const existingX = island.x + (existing.x || 0);
            const existingY = island.y + (existing.y || 0);
            const existingFootprint = this.getEffectivePlacementFootprintRadius(existing.type, island);
            const requiredSeparation =
                footprint +
                existingFootprint +
                Math.max(this.getBuildingPlacementPadding(buildingType), this.getBuildingPlacementPadding(existing.type));

            if (requiredSeparation <= 0) return false;
            return Math.hypot(absX - existingX, absY - existingY) < requiredSeparation;
        });
    }

    private isPointOnIslandSurface(island: Island, x: number, y: number): boolean {
        if (island.points) {
            return MapGenerator.isPointInPolygon(x, y, island.points);
        }
        return Math.hypot(x - island.x, y - island.y) <= island.radius;
    }

    private getIslandShorelineProbe(
        island: Island,
        x: number,
        y: number,
        tolerance: number = 20
    ): { edgeX: number; edgeY: number; outwardX: number; outwardY: number } | null {
        if (island.points && island.points.length > 2) {
            if (!MapGenerator.isPointInPolygon(x, y, island.points)) {
                return null;
            }

            const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
            if (Math.hypot(x - closest.x, y - closest.y) > tolerance) {
                return null;
            }

            let outwardX = closest.x - island.x;
            let outwardY = closest.y - island.y;
            const outwardLength = Math.hypot(outwardX, outwardY);
            if (outwardLength <= 0.001) {
                outwardX = x - island.x;
                outwardY = y - island.y;
            }
            const normalizedLength = Math.hypot(outwardX, outwardY) || 1;
            return {
                edgeX: closest.x,
                edgeY: closest.y,
                outwardX: outwardX / normalizedLength,
                outwardY: outwardY / normalizedLength
            };
        }

        const dx = x - island.x;
        const dy = y - island.y;
        const distance = Math.hypot(dx, dy);
        const innerRadius = Math.max(0, island.radius - tolerance);
        if (distance < innerRadius || distance > island.radius + 2) {
            return null;
        }

        const length = distance || 1;
        return {
            edgeX: island.x + (dx / length) * island.radius,
            edgeY: island.y + (dy / length) * island.radius,
            outwardX: dx / length,
            outwardY: dy / length
        };
    }

    public isPointOnExposedIslandShoreline(island: Island, x: number, y: number, tolerance: number = 20): boolean {
        const probe = this.getIslandShorelineProbe(island, x, y, tolerance);
        if (!probe) return false;

        const probeDistances = [6, 12, 18];
        return probeDistances.some(distance => {
            const probeX = probe.edgeX + probe.outwardX * distance;
            const probeY = probe.edgeY + probe.outwardY * distance;
            return !this.isPointOnAnyIslandSurface(probeX, probeY);
        });
    }

    private isPointTouchingIslandSurface(island: Island, x: number, y: number, tolerance: number = 8): boolean {
        if (this.isPointOnIslandSurface(island, x, y)) return true;

        if (island.points && island.points.length > 2) {
            const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
            return Math.hypot(x - closest.x, y - closest.y) <= tolerance;
        }

        return Math.hypot(x - island.x, y - island.y) <= island.radius + tolerance;
    }

    private areIslandsLandConnected(islandA: Island, islandB: Island, tolerance: number = 10): boolean {
        const centerDist = Math.hypot(islandA.x - islandB.x, islandA.y - islandB.y);
        if (centerDist > islandA.radius + islandB.radius + Math.max(80, tolerance * 4)) {
            return false;
        }

        if (!islandA.points && !islandB.points) {
            return centerDist <= islandA.radius + islandB.radius + tolerance;
        }

        const sampleIslandAgainst = (source: Island, target: Island): boolean => {
            if (source.points && source.points.length > 0) {
                const step = Math.max(1, Math.floor(source.points.length / 24));
                for (let i = 0; i < source.points.length; i += step) {
                    const p = source.points[i];
                    if (this.isPointTouchingIslandSurface(target, p.x, p.y, tolerance)) {
                        return true;
                    }
                }
                return false;
            }

            const samples = 24;
            for (let i = 0; i < samples; i++) {
                const angle = (i / samples) * Math.PI * 2;
                const px = source.x + Math.cos(angle) * source.radius;
                const py = source.y + Math.sin(angle) * source.radius;
                if (this.isPointTouchingIslandSurface(target, px, py, tolerance)) {
                    return true;
                }
            }
            return false;
        };

        if (sampleIslandAgainst(islandA, islandB)) return true;
        if (sampleIslandAgainst(islandB, islandA)) return true;

        const midX = (islandA.x + islandB.x) * 0.5;
        const midY = (islandA.y + islandB.y) * 0.5;
        return (
            this.isPointTouchingIslandSurface(islandA, midX, midY, tolerance) &&
            this.isPointTouchingIslandSurface(islandB, midX, midY, tolerance)
        );
    }

    private isSpawnClearOfBuildings(x: number, y: number, island: Island, unitType: string): boolean {
        if (this.isAirUnitType(unitType)) return true;

        return !island.buildings.some(building => {
            if (building.type === 'bridge_node' || building.type === 'wall_node') return false;

            const buildingX = island.x + (building.x || 0);
            const buildingY = island.y + (building.y || 0);
            const radius = this.getBuildingCollisionRadius(building.type, unitType);
            const buffer = unitType === 'builder' ? 8 : 5;
            return Math.hypot(x - buildingX, y - buildingY) < radius + buffer;
        });
    }

    private isRecruitSpawnCandidateValid(x: number, y: number, island: Island, unitType: string): boolean {
        if (!this.isValidPosition(x, y, unitType)) return false;
        if (!this.isSpawnClearOfBuildings(x, y, island, unitType)) return false;

        const offsets = this.isLandUnitType(unitType)
            ? [
                { dx: 10, dy: 0 },
                { dx: -10, dy: 0 },
                { dx: 0, dy: 10 },
                { dx: 0, dy: -10 }
            ]
            : [];

        for (const offset of offsets) {
            const sampleX = x + offset.dx;
            const sampleY = y + offset.dy;
            if (!this.isValidPosition(sampleX, sampleY, unitType)) return false;
            if (!this.isSpawnClearOfBuildings(sampleX, sampleY, island, unitType)) return false;
        }

        return true;
    }

    private findLandRecruitSpawnPosition(unitType: string, island: Island, building: Building): { x: number; y: number } | null {
        const bx = island.x + (building.x || 0);
        const by = island.y + (building.y || 0);
        const buildingRadius = this.getBuildingCollisionRadius(building.type, unitType);
        const preferredAngle = Math.atan2(by - island.y, bx - island.x);
        const angleOffsets = [
            0,
            Math.PI / 8,
            -Math.PI / 8,
            Math.PI / 4,
            -Math.PI / 4,
            (3 * Math.PI) / 8,
            (-3 * Math.PI) / 8,
            Math.PI / 2,
            -Math.PI / 2,
            (5 * Math.PI) / 8,
            (-5 * Math.PI) / 8,
            (3 * Math.PI) / 4,
            (-3 * Math.PI) / 4,
            (7 * Math.PI) / 8,
            (-7 * Math.PI) / 8,
            Math.PI
        ];

        const searchRadii: number[] = [];
        const minRadius = Math.max(buildingRadius + 18, 48);
        for (let radius = minRadius; radius <= minRadius + 168; radius += 14) {
            searchRadii.push(radius);
        }

        for (const radius of searchRadii) {
            for (const offset of angleOffsets) {
                const angle = preferredAngle + offset;
                const tx = bx + Math.cos(angle) * radius;
                const ty = by + Math.sin(angle) * radius;

                if (!this.isPointOnIslandSurface(island, tx, ty) && !this.isPointOnBridge(tx, ty)) continue;
                if (!this.isRecruitSpawnCandidateValid(tx, ty, island, unitType)) continue;

                return { x: tx, y: ty };
            }
        }

        const maxSweepRadius = Math.max(minRadius + 40, Math.min(island.radius + 40, minRadius + 240));
        for (let radius = minRadius; radius <= maxSweepRadius; radius += 16) {
            const steps = Math.max(16, Math.floor((2 * Math.PI * radius) / 26));
            for (let step = 0; step < steps; step++) {
                const angle = (step / steps) * Math.PI * 2;
                const tx = bx + Math.cos(angle) * radius;
                const ty = by + Math.sin(angle) * radius;

                if (!this.isPointOnIslandSurface(island, tx, ty) && !this.isPointOnBridge(tx, ty)) continue;
                if (!this.isRecruitSpawnCandidateValid(tx, ty, island, unitType)) continue;

                return { x: tx, y: ty };
            }
        }

        return null;
    }

    public getBuildingHitboxSnapshot(): Record<string, { placementRadius: number; collisionRadius: number; blocking: boolean }> {
        const snapshot: Record<string, { placementRadius: number; collisionRadius: number; blocking: boolean }> = {};
        Object.keys(BuildingData).forEach(type => {
            snapshot[type] = {
                placementRadius: this.getEffectivePlacementFootprintRadius(type),
                collisionRadius: this.getBuildingCollisionRadius(type),
                blocking: !this.isNonBlockingBuildingType(type)
            };
        });
        return snapshot;
    }

    getPlayerBase(playerId: string): { island: Island; building: Building; x: number; y: number } | null {
        for (const island of this.map.islands) {
            const building = island.buildings.find(candidate => candidate.type === 'base' && candidate.ownerId === playerId);
            if (building) {
                return {
                    island,
                    building,
                    x: island.x + (building.x || 0),
                    y: island.y + (building.y || 0)
                };
            }
        }

        return null;
    }

    hasPlayerBase(playerId: string): boolean {
        return this.getPlayerBase(playerId) !== null;
    }

    private clearStartupHqCheck() {
        if (this.startupHqCheckTimeout) {
            clearTimeout(this.startupHqCheckTimeout);
            this.startupHqCheckTimeout = null;
        }
    }

    private ensureOpeningBase(playerId: string, source: string): boolean {
        const player = this.players.get(playerId);
        if (!player || player.status === 'eliminated') return false;

        const base = this.getPlayerBase(playerId);
        if (base) {
            player.hqSpawnedOnce = true;
            console.log(`[SpawnCheck] ${source}: HQ present for ${playerId} at ${base.x.toFixed(1)}, ${base.y.toFixed(1)}.`);
            return true;
        }

        console.warn(`[SpawnCheck] ${source}: HQ missing for ${playerId}. Attempting recovery spawn.`);
        const previousCanBuildHQ = player.canBuildHQ;
        const previousSpawnedOnce = player.hqSpawnedOnce;
        player.canBuildHQ = true;
        player.hqSpawnedOnce = false;

        const spawned = this.assignStartingIsland(playerId);
        if (!spawned || !this.hasPlayerBase(playerId)) {
            player.canBuildHQ = previousCanBuildHQ;
            player.hqSpawnedOnce = previousSpawnedOnce;
            console.error(`[SpawnCheck] ${source}: failed to restore HQ for ${playerId}.`);
            return false;
        }

        console.warn(`[SpawnCheck] ${source}: restored HQ for ${playerId}.`);
        return true;
    }

    verifyHumanStartingBases(): { ready: boolean; missingPlayerIds: string[]; recoveredPlayerIds: string[] } {
        const missingPlayerIds: string[] = [];
        const recoveredPlayerIds: string[] = [];

        this.players.forEach(player => {
            if (player.isBot || player.status === 'eliminated') return;

            const hadBase = this.hasPlayerBase(player.id);
            const ready = hadBase || this.ensureOpeningBase(player.id, 'pre-start');
            if (!ready) {
                missingPlayerIds.push(player.id);
                return;
            }

            if (!hadBase) {
                recoveredPlayerIds.push(player.id);
            }
        });

        return {
            ready: missingPlayerIds.length === 0,
            missingPlayerIds,
            recoveredPlayerIds
        };
    }

    emitPlayerHqStatus(io: any, playerId: string) {
        const player = this.players.get(playerId);
        if (!player || player.isBot) return;

        const base = this.getPlayerBase(playerId);
        io.to(playerId).emit('PLAYER_HQ_STATUS', {
            playerId,
            confirmed: !!base,
            baseId: base?.building.id ?? null,
            x: base?.x ?? null,
            y: base?.y ?? null
        });
    }

    emitHumanHqStatuses(io: any) {
        this.players.forEach(player => {
            if (player.isBot) return;
            this.emitPlayerHqStatus(io, player.id);
        });
    }

    scheduleStartupHqVerification(io: any, roomId: string) {
        this.clearStartupHqCheck();
        this.startupHqCheckTimeout = setTimeout(() => {
            this.startupHqCheckTimeout = null;

            if (this.status !== 'playing' || this.matchState === 'ENDED') return;

            let changed = false;

            this.players.forEach(player => {
                if (player.status === 'eliminated') return;

                const hasBase = this.hasPlayerBase(player.id);
                console.log(`[SpawnCheck] 5s HQ verification for ${player.id}: ${hasBase ? 'present' : 'missing'}.`);
                if (hasBase) return;

                const spawned = this.ensureOpeningBase(player.id, 'startup-5s');
                if (!spawned) return;
                changed = true;
            });

            if (changed) {
                this.touchMapVersion();
                this.emitVisibleMapData(io, roomId);
                io.to(roomId).emit('playersData', Array.from(this.players.values()));
                io.to(roomId).emit('unitsData', this.units);
            }

            this.emitHumanHqStatuses(io);
        }, 5000);
    }

    private setUnitFacingFromVector(unit: Unit, dx: number, dy: number) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;
        unit.facingAngle = Math.atan2(dy, dx);
    }

    startVoting(io: any, roomId: string) {
        if (this.status !== 'waiting') return;

        console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=voting reason=start_voting humans=${this.players.size}`);
        this.status = 'voting';
        this.mapVotes.clear();
        this.voteEndTime = Date.now() + 10000; // 10 seconds

        io.to(roomId).emit('gameStatus', 'voting');
        io.to(roomId).emit('votingUpdate', {
            timeLeft: 10000,
            votes: []
        });
    }

    registerVote(playerId: string, mapType: string) {
        if (this.status !== 'voting') return;
        if (['islands', 'grasslands', 'desert', 'random'].includes(mapType)) {
            this.mapVotes.set(playerId, mapType);
        }
    }

    setRequiredPlayers(count: number) {
        this.requiredPlayers = Math.max(1, Math.min(10, count));
        // If we now have enough players, trigger check
        // However, checkVotingStart needs 'io' which we don't have here easily without passing it.
        // For now, the lobby loop or next join will trigger it.
        // Ideally we should check if we can start.
    }

    forceStart(io: any, roomId: string) {
        if (this.status === 'waiting') {
            // Update required players to match current count to ensure logic holds
            // FIX: Ensure host is included in human count
            const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;

            console.log(`[GameState] forceStart: roomId=${roomId}, humanCount=${humanCount}`);

            // Allow start with just 1 player (Host) for LAN/Testing
            this.requiredPlayers = Math.max(1, Math.min(10, humanCount));

            // Force start voting immediately
            this.startVoting(io, roomId);
        }
    }

    startCustomGame(io: any, roomId: string, mapType: string) {
        if (this.status !== 'waiting') return;

        console.log(`Starting Custom Game in room ${roomId} with map ${mapType}`);
        this.mapType = mapType;
        this.requiredPlayers = 1;

        // Skip voting, start immediately
        this.status = 'voting'; // Temporarily set to voting so finalize accepts it
        // Force finalize with specific map
        this.mapVotes.clear(); // Clear any existing votes
        this.mapVotes.set('host', mapType); // Dummy vote to ensure selection if logic used

        // Override the random selection in finalizeMapAndStart by setting mapType directly
        // finalizeMapAndStart uses this.mapType if maxVotes is 0 or as a fallback
        // But let's just make sure we call it and it respects our choice.
        // Actually, finalizeMapAndStart recalculates mapType based on votes.
        // Let's modify finalizeMapAndStart to accept an override or just handle it here.

        // Better approach: Re-implement the start logic specifically for custom game to avoid side effects
        // Reuse the generation and start logic

        this.mapType = mapType;
        console.log(`Custom Map selected: ${this.mapType}`);

        // Generate Map
        this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any);
        this.map.mapType = this.mapType;
        this.map.serverRegion = this.serverRegion;
        this.map.waterBuildings = this.map.waterBuildings || [];
        this.touchMapVersion();

        this.units = [];
        // Keep bots but reset them
        const botPlayers = Array.from(this.players.values()).filter(p => p.isBot);
        this.bots = [];
        botPlayers.forEach(p => {
            this.bots.push(createBotAI(p.id, p.difficulty || 5));
        });

        this.players.forEach(p => {
            p.resources = { gold: 200, oil: 0 };
            p.status = 'active';
            p.canBuildHQ = true;
            p.hqRespawnsUsed = 0;
            p.hqSpawnedOnce = false;
        });

        this.status = 'starting';

        this.players.forEach(p => {
            this.assignStartingIsland(p.id);
        });

        const startingBases = this.verifyHumanStartingBases();
        if (!startingBases.ready) {
            this.status = 'waiting';
            io.to(roomId).emit('gameStatus', 'waiting');
            io.to(roomId).emit('MATCH_START_FAILED', {
                reason: `Unable to assign a starting HQ to players: ${startingBases.missingPlayerIds.join(', ')}`
            });
            return;
        }

        this.status = 'playing';
        this.startTime = Date.now();
        this.scheduleStartupHqVerification(io, roomId);
        this.armHumanReadyBotStartGate();

        io.to(roomId).emit('gameStatus', 'playing');
        io.to(roomId).emit('gameStarted', { mapType: this.mapType });
        this.emitVisibleMapData(io, roomId);
        io.to(roomId).emit('playersData', Array.from(this.players.values()));
        io.to(roomId).emit('unitsData', this.units);
        this.emitHumanHqStatuses(io);
    }

    finalizeMapAndStart(io: any, roomId: string) {
        if (this.status !== 'voting' && this.status !== 'starting') return;

        // Lock transition to prevent bounce back to lobby during generation
        if (this.status === 'voting') {
            console.log(`[LOBBY_STATE_CHANGE] from=voting to=starting reason=finalizing_map matchId=${roomId}`);
            this.status = 'starting';
            io.to(roomId).emit('gameStatus', 'starting');
        }

        if (roomId === 'lobby') {
            // Do not start games in the global lobby
            console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=waiting reason=is_global_lobby humans=${this.players.size}`);
            this.status = 'waiting';
            io.to(roomId).emit('gameStatus', 'waiting');
            return;
        }

        // Double check player count (unless testing/campaign)
        // FIX: One-way transition. Only fail if critically impossible (e.g. 0 humans)
        const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;
        if (humanCount < 1) {
            console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=waiting reason=no_humans humans=${humanCount}`);
            this.status = 'waiting';
            io.to(roomId).emit('gameStatus', 'waiting');
            io.to(roomId).emit('MATCH_START_FAILED', { reason: 'No players in lobby' });
            return;
        }

        // Calculate Votes
        const votes: Record<string, number> = { islands: 0, grasslands: 0, desert: 0, random: 0 };
        this.mapVotes.forEach(v => {
            if (votes[v] !== undefined) votes[v]++;
        });

        console.log(`[GameState] Finalizing map for room ${roomId}. Current mapType: ${this.mapType}. Votes:`, votes);

        // Strict Majority Selection
        let maxVotes = 0;
        let winners: string[] = [];

        Object.entries(votes).forEach(([type, count]) => {
            if (count > maxVotes) {
                maxVotes = count;
                winners = [type];
            } else if (count === maxVotes) {
                winners.push(type);
            }
        });

        // If no votes (maxVotes === 0), use all types as pool
        if (maxVotes === 0) {
            // If the room was created with a specific map type, use it
            if (this.mapType && this.mapType !== 'random') {
                winners = [this.mapType];
            } else {
                winners = ['islands', 'grasslands', 'desert'];
            }
        }

        let selected = winners[Math.floor(Math.random() * winners.length)];

        if (selected === 'random') {
            const types = ['islands', 'grasslands', 'desert'];
            selected = types[Math.floor(Math.random() * types.length)];
        }

        this.mapType = selected;
        console.log(`[MATCH] creating matchId=${randomUUID()} from lobbyId=${roomId}`);
        console.log(`[MATCH] initMatch start matchId=${roomId}`);

        console.log(`Map selected: ${this.mapType}`);

        // Generate Map
        this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any);
        this.map.mapType = this.mapType;
        this.map.serverRegion = this.serverRegion;
        this.map.waterBuildings = this.map.waterBuildings || [];
        this.touchMapVersion();

        // Reset State but keep players
        this.units = [];
        // Bots should be re-initialized from players list

        // Clear player resources/status
        this.players.forEach(p => {
            p.resources = { gold: 200, oil: 0 };
            p.status = 'active';
            p.canBuildHQ = true;
            p.hqRespawnsUsed = 0;
            p.hqSpawnedOnce = false;
        });

        // Spawn HQs while still in startup. The match should only enter playing
        // after every human player has a confirmed starting base.
        console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=starting reason=assigning_hq humans=${humanCount}`);
        this.status = 'starting';

        // Spawn Bases
        this.players.forEach(p => {
            this.assignStartingIsland(p.id);
        });

        const startingBases = this.verifyHumanStartingBases();
        if (!startingBases.ready) {
            console.log(`[LOBBY_STATE_CHANGE] from=starting to=waiting reason=missing_player_hq humans=${humanCount}`);
            this.status = 'waiting';
            io.to(roomId).emit('gameStatus', 'waiting');
            io.to(roomId).emit('MATCH_START_FAILED', {
                reason: `Unable to assign a starting HQ to players: ${startingBases.missingPlayerIds.join(', ')}`
            });
            return;
        }

        console.log(`[LOBBY_STATE_CHANGE] from=starting to=playing reason=match_started humans=${humanCount}`);
        this.status = 'playing';
        this.startTime = Date.now();
        console.log(`[MATCH] state -> RUNNING matchId=${roomId}`);
        console.log(`[MATCH] MATCH_STARTED matchId=${roomId} lobbyId=${roomId}`);

        this.scheduleStartupHqVerification(io, roomId);

        // Re-add bots
        const botPlayers = Array.from(this.players.values()).filter(p => p.isBot);
        this.bots = [];
        botPlayers.forEach(p => {
            this.bots.push(createBotAI(p.id, p.difficulty || 5));
        });
        this.armHumanReadyBotStartGate();

        const baseCount = this.map.islands.reduce((acc, i) => acc + i.buildings.filter(b => b.type === 'base').length, 0);
        console.log(`[MATCH] initMatch complete matchId=${roomId} entitiesSpawned=${this.units.length} bases=${baseCount}`);

        // Broadcast Start
        console.log(`[MATCH] broadcast MATCH_STARTED matchId=${roomId}`);
        io.to(roomId).emit('gameStatus', 'playing'); // Explicitly update status
        io.to(roomId).emit('gameStarted', { mapType: this.mapType });
        io.to(roomId).emit('MATCH_STARTED', { matchId: roomId }); // Authoritative start event
        this.emitVisibleMapData(io, roomId);
        io.to(roomId).emit('playersData', Array.from(this.players.values()));
        io.to(roomId).emit('unitsData', this.units);
        this.emitHumanHqStatuses(io);
    }



    addPlayer(id: string, isBot: boolean = false, name?: string, difficulty: number = 5): Player | null {
        if (this.players.has(id)) return this.players.get(id)!;

        // Assign a random color
        const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

        const player: Player = {
            id,
            color,
            name: name || (isBot ? `Bot ${id.substr(-4)}` : `Player ${id.substr(0, 4)}`),
            resources: { gold: 200, oil: 0 },
            isBot,
            difficulty,
            status: 'active',
            canBuildHQ: true,
            hqRespawnsUsed: 0,
            hqSpawnedOnce: false
        };

        this.players.set(id, player);

        // Only assign island if game is already playing
        if (this.status === 'playing') {
            this.assignStartingIsland(id);
            if (isBot) {
                this.bots.push(createBotAI(id, difficulty));
            }
        }

        // Check for voting trigger
        // Voting is now triggered via checkVotingStart called from index.ts

        return player;
    }

    // Helper to check voting (called from index.ts)
    checkVotingStart(io: any, roomId: string) {
        // FIX: Ensure host is included in human count
        const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;

        console.log(`[GameState] checkVotingStart: roomId=${roomId}, humanCount=${humanCount}, required=${this.requiredPlayers}, status=${this.status}`);

        // Never auto-start voting in the global lobby
        if (roomId === 'lobby') return;

        // Stop watchdog if we are already voting, starting, or playing
        if (this.status !== 'waiting') return;

        // Allow start if we have enough humans (min 1 for LAN/testing if requiredPlayers is 1)
        if (this.status === 'waiting' && humanCount >= this.requiredPlayers) {
            console.log(`[GameState] Triggering voting start for ${roomId}`);
            this.startVoting(io, roomId);
        }
    }

    removePlayer(id: string) {
        const player = this.players.get(id);

        // If game is playing, mark as eliminated instead of removing
        // This ensures Game Over logic (player count) works correctly
        if (this.status === 'playing' && player) {
            player.status = 'eliminated';
            console.log(`Player ${id} disconnected during game. Marked as eliminated.`);
        } else {
            this.players.delete(id);
        }

        this.humanMatchReadyPlayerIds.delete(id);
        if (this.requireHumanReadyForBotStart && !this.botsReleasedForMatch && this.areAllHumansReadyForMatchStart()) {
            this.releaseBotsForHumanReadyGate('player_removed');
        }

        this.bots = this.bots.filter(b => b.playerId !== id);

        // Remove units
        this.units = this.units.filter(u => u.ownerId !== id);

        // Reset owned islands and remove buildings
        this.map.islands.forEach(island => {
            if (island.ownerId === id) {
                island.ownerId = undefined;
            }

            // Remove buildings owned by this player
            island.buildings = island.buildings.filter(b => {
                if (b.ownerId === id) {
                    // Free up resources if needed
                    if (b.type === 'mine') {
                        const spot = island.goldSpots.find(s => s.occupiedBy === b.id);
                        if (spot) spot.occupiedBy = undefined;
                    }
                    return false; // Remove building
                }
                return true;
            });
        });

        // Reset oil spots
        this.map.oilSpots.forEach(spot => {
            if ((spot as any).ownerId === id) {
                (spot as any).ownerId = undefined;
                (spot as any).building = undefined;
                spot.occupiedBy = undefined;
            } else if (spot.occupiedBy) {
                // Check if the building occupying it was removed?
                // Since we don't have easy access to the building list here without searching islands,
                // we rely on the fact that if the building was on an island (oil_pump), it's gone.
                // If it was an oil_rig (on water), where is it stored?
                // GameState usually stores oil_rigs in island.buildings too? 
                // Or map.oilSpots has the building directly?
            }
        });
    }

    assignStartingIsland(playerId: string): boolean {
        // Check if player is allowed to build HQ (Anti-Exploit)
        const player = this.players.get(playerId);
        if (player && player.canBuildHQ === false) {
            console.log(`[Spawn] Player ${playerId} is blocked from spawning HQ (Eliminated/Restricted).`);
            return false;
        }

        if (player?.hqSpawnedOnce) {
            console.log(`[Spawn] Player ${playerId} has already received an HQ this match. Blocking additional spawn.`);
            return false;
        }

        // Determine map strategy
        const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
        console.log(`Assigning starting island for player ${playerId} on map ${this.mapType}`);

        // Collect all existing bases to check distance
        const existingBases: { x: number, y: number }[] = [];
        this.map.islands.forEach(i => {
            i.buildings.forEach(b => {
                if (b.type === 'base') {
                    existingBases.push({ x: i.x + (b.x || 0), y: i.y + (b.y || 0) });
                }
            });
        });

        // Check if player already has a base to prevent double spawning
        const existingBase = this.map.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === playerId));
        if (existingBase) {
            if (player) player.hqSpawnedOnce = true;
            console.log(`[Spawn] Player ${playerId} already has a base. Skipping spawn.`);
            return true;
        }

        const activePlayerCount = Array.from(this.players.values()).filter(p => p.status !== 'eliminated').length;
        const participantCount = Math.max(2, activePlayerCount || this.players.size || 2);
        const minMapDim = Math.max(600, Math.min(this.map.width, this.map.height));
        const densityScale = Math.max(0.58, Math.min(1, 2.6 / Math.sqrt(participantCount)));
        const mapCenterX = this.map.width / 2;
        const mapCenterY = this.map.height / 2;
        const spawnSlotIndex = Math.min(existingBases.length, Math.max(0, participantCount - 1));
        const targetAngle = (-Math.PI / 2) + (spawnSlotIndex / participantCount) * Math.PI * 2;
        const angleDelta = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        const existingBaseAngles = existingBases.map(base => Math.atan2(base.y - mapCenterY, base.x - mapCenterX));

        const getEligibleSpawnIslands = (): Island[] => {
            if (isSharedMap) {
                return this.map.islands.filter(isl =>
                    isl.radius > 200 &&
                    isl.id !== 'oil_pit' &&
                    isl.id !== 'high_land'
                );
            }

            return this.map.islands.filter(isl => !isl.ownerId);
        };

        const rankIslandForSpawn = (island: Island): number => {
            const islandAngle = Math.atan2(island.y - mapCenterY, island.x - mapCenterX);
            const targetDelta = angleDelta(islandAngle, targetAngle);
            const targetAlignmentScore = (Math.PI - targetDelta) * 260;
            const nearestExistingAngle = existingBaseAngles.length > 0
                ? Math.min(...existingBaseAngles.map(baseAngle => angleDelta(islandAngle, baseAngle)))
                : Math.PI;
            const angularSpreadScore = nearestExistingAngle * 220;
            const islandSizeScore = this.mapType === 'islands' ? island.radius * 11 : island.radius * 5;
            return islandSizeScore + targetAlignmentScore + angularSpreadScore;
        };

        const strictBaseSeparation = isSharedMap
            ? Math.max(420, Math.floor(minMapDim * 0.24))
            : Math.max(300, Math.floor(minMapDim * 0.16));
        const relaxedBaseSeparation = isSharedMap
            ? Math.max(340, Math.floor(strictBaseSeparation * 0.82))
            : Math.max(250, Math.floor(strictBaseSeparation * 0.8));
        const minimalBaseSeparation = isSharedMap
            ? Math.max(280, Math.floor(strictBaseSeparation * 0.68))
            : Math.max(220, Math.floor(strictBaseSeparation * 0.65));

        const strictSeparation = Math.max(isSharedMap ? 340 : 220, Math.floor(strictBaseSeparation * densityScale));
        const relaxedSeparation = Math.max(isSharedMap ? 300 : 200, Math.floor(relaxedBaseSeparation * densityScale));
        const minimalSeparation = Math.max(isSharedMap ? 240 : 180, Math.floor(minimalBaseSeparation * densityScale));
        const idealAngularGap = (Math.PI * 2) / participantCount;
        const strictAngularSeparation = participantCount >= 3 ? idealAngularGap * 0.55 : 0;
        const relaxedAngularSeparation = participantCount >= 3 ? idealAngularGap * 0.4 : 0;
        const minimalAngularSeparation = participantCount >= 3 ? idealAngularGap * 0.28 : 0;

        // Strategy Phases
        const phases = [
            { attempts: 70, buffer: 70, separation: strictSeparation, angleSeparation: strictAngularSeparation, name: 'Strict' },
            { attempts: 60, buffer: 36, separation: relaxedSeparation, angleSeparation: relaxedAngularSeparation, name: 'Relaxed' },
            { attempts: 40, buffer: 14, separation: minimalSeparation, angleSeparation: minimalAngularSeparation, name: 'Minimal' }
        ];

        let bestCandidate: { island: Island, x: number, y: number, score: number } | null = null;

        for (const phase of phases) {
            if (bestCandidate) break;
            console.log(`Trying spawning phase: ${phase.name}`);

            const candidates: { island: Island, x: number, y: number, score: number }[] = [];

            for (let i = 0; i < phase.attempts; i++) {
                // Pick an island
                const eligibleIslands = getEligibleSpawnIslands()
                    .sort((a, b) => rankIslandForSpawn(b) - rankIslandForSpawn(a));
                const islandPool = eligibleIslands.slice(0, Math.min(eligibleIslands.length, isSharedMap ? 6 : 8));
                const island = islandPool.length > 0 ? islandPool[i % islandPool.length] : undefined;

                if (!island) continue;

                // Generate random point on island
                const minX = Math.max(0, island.x - island.radius);
                const maxX = Math.min(this.map.width, island.x + island.radius);
                const minY = Math.max(0, island.y - island.radius);
                const maxY = Math.min(this.map.height, island.y + island.radius);

                const testX = minX + Math.random() * (maxX - minX);
                const testY = minY + Math.random() * (maxY - minY);

                // Validate
                let valid = true;
                let distToEdge = island.radius;
                if (island.points) {
                    if (!MapGenerator.isPointInPolygon(testX, testY, island.points)) {
                        valid = false;
                    } else {
                        // Ensure not too close to the edge (Buffer)
                        const closest = MapGenerator.getClosestPointOnPolygon(testX, testY, island.points);
                        distToEdge = Math.hypot(testX - closest.x, testY - closest.y);

                        if (distToEdge < phase.buffer) valid = false;
                    }
                } else {
                    // Circle check
                    const distFromCenter = Math.hypot(testX - island.x, testY - island.y);
                    distToEdge = Math.max(0, island.radius - distFromCenter);
                    if (distFromCenter > Math.max(0, island.radius - phase.buffer)) {
                        valid = false;
                    }
                }

                if (valid) {
                    // Check High Ground Collision
                    if (this.map.highGrounds) {
                        for (const hg of this.map.highGrounds) {
                            if (MapGenerator.isPointInPolygon(testX, testY, hg.points)) {
                                valid = false;
                                break;
                            }
                        }
                    }
                }

                if (valid) {
                    // Score based on distance to nearest base
                    let minDist = existingBases.length > 0 ? Infinity : phase.separation + island.radius;
                    existingBases.forEach(base => {
                        const d = Math.hypot(testX - base.x, testY - base.y);
                        if (d < minDist) minDist = d;
                    });

                    if (minDist < phase.separation) valid = false;

                    const candidateAngle = Math.atan2(testY - mapCenterY, testX - mapCenterX);
                    const nearestExistingAngle = existingBaseAngles.length > 0
                        ? Math.min(...existingBaseAngles.map(baseAngle => angleDelta(candidateAngle, baseAngle)))
                        : Math.PI;
                    if (nearestExistingAngle < phase.angleSeparation) valid = false;

                    if (valid) {
                        let score = minDist;
                        const targetDelta = angleDelta(candidateAngle, targetAngle);
                        const targetAlignmentScore = (Math.PI - targetDelta) * 260;
                        const angularSpreadScore = nearestExistingAngle * 220;
                        score += targetAlignmentScore + angularSpreadScore;
                        if (this.mapType === 'islands') {
                            score += island.radius * 12;
                            score += distToEdge * 14;
                        } else {
                            score += island.radius * 6;
                            score += distToEdge * 8;
                        }

                        candidates.push({
                            island,
                            x: testX - island.x,
                            y: testY - island.y,
                            score
                        });
                    }
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score);
                bestCandidate = candidates[0];
            }
        }

        // Failsafe: Force spawn somewhere if nothing found
        if (!bestCandidate) {
            console.warn(`WARN: Could not find valid spawn for ${playerId}. Using failsafe.`);
            const validIslands = this.map.islands
                .filter(i => i.id !== 'oil_pit' && i.id !== 'high_land')
                .sort((a, b) => rankIslandForSpawn(b) - rankIslandForSpawn(a));
            let fallbackBest: { island: Island, x: number, y: number, score: number } | null = null;

            validIslands.forEach(island => {
                const sampleAttempts = island.points ? 64 : 80;
                for (let attempt = 0; attempt < sampleAttempts; attempt++) {
                    let testX = island.x;
                    let testY = island.y;
                    if (island.points) {
                        const minX = Math.max(0, island.x - island.radius);
                        const maxX = Math.min(this.map.width, island.x + island.radius);
                        const minY = Math.max(0, island.y - island.radius);
                        const maxY = Math.min(this.map.height, island.y + island.radius);
                        testX = minX + Math.random() * (maxX - minX);
                        testY = minY + Math.random() * (maxY - minY);
                        if (!MapGenerator.isPointInPolygon(testX, testY, island.points)) continue;
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = Math.random() * Math.max(12, island.radius - 14);
                        testX = island.x + Math.cos(angle) * dist;
                        testY = island.y + Math.sin(angle) * dist;
                    }

                    if (this.map.highGrounds) {
                        let insideHighGround = false;
                        for (const hg of this.map.highGrounds) {
                            if (MapGenerator.isPointInPolygon(testX, testY, hg.points)) {
                                insideHighGround = true;
                                break;
                            }
                        }
                        if (insideHighGround) continue;
                    }

                    const edgeDist = island.points
                        ? Math.hypot(
                            testX - MapGenerator.getClosestPointOnPolygon(testX, testY, island.points).x,
                            testY - MapGenerator.getClosestPointOnPolygon(testX, testY, island.points).y
                        )
                        : Math.max(0, island.radius - Math.hypot(testX - island.x, testY - island.y));

                    let minDist = existingBases.length > 0 ? Infinity : minimalSeparation + island.radius;
                    existingBases.forEach(base => {
                        const d = Math.hypot(testX - base.x, testY - base.y);
                        if (d < minDist) minDist = d;
                    });

                    const candidateAngle = Math.atan2(testY - mapCenterY, testX - mapCenterX);
                    const targetDelta = angleDelta(candidateAngle, targetAngle);
                    const targetAlignmentScore = (Math.PI - targetDelta) * 220;
                    const nearestExistingAngle = existingBaseAngles.length > 0
                        ? Math.min(...existingBaseAngles.map(baseAngle => angleDelta(candidateAngle, baseAngle)))
                        : Math.PI;
                    const angularSpreadScore = nearestExistingAngle * 180;
                    const score = minDist + island.radius * 9 + edgeDist * 6 + targetAlignmentScore + angularSpreadScore;
                    if (!fallbackBest || score > fallbackBest.score) {
                        fallbackBest = {
                            island,
                            x: testX - island.x,
                            y: testY - island.y,
                            score
                        };
                    }
                }
            });

            if (fallbackBest) {
                bestCandidate = fallbackBest;
            } else {
                const island = validIslands[0];
                if (island) {
                    let fx = 0;
                    let fy = 0;
                    if (island.points) {
                        const p = MapGenerator.getClosestPointOnPolygon(island.x, island.y, island.points);
                        fx = p.x - island.x;
                        fy = p.y - island.y;
                    }

                    bestCandidate = {
                        island,
                        x: fx,
                        y: fy,
                        score: 0
                    };
                }
            }
        }

        if (bestCandidate) {
            const { island, x, y } = bestCandidate;

            // Assign ownership
            if (!isSharedMap) {
                island.ownerId = playerId;
            }

            console.log(`Spawning base for ${playerId} at ${island.x + x}, ${island.y + y} (Island: ${island.id})`);

            // Add Base
            island.buildings.push({
                id: `bld_base_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                type: 'base',
                level: 1,
                health: 500,
                maxHealth: 500,
                x: x,
                y: y,
                ownerId: playerId,
                isConstructing: false,
                constructionProgress: 500,
                range: BuildingData.base.range
            });

            // Add Builder (Find safe spot outside base collision radius)
            console.log(`[Spawn] Base rel: ${x},${y}. Finding safe spot for builder...`);
            let bx = island.x + x;
            let by = island.y + y;
            let foundSafeSpot = false;

            const baseRadius = this.getBuildingFootprintRadius('base');

            // Spiral Search for valid land spot
            searchLoop:
            for (let r = baseRadius + 18; r <= baseRadius + 120; r += 10) {
                const steps = Math.floor(2 * Math.PI * r / 20); // ~20px intervals
                for (let i = 0; i < steps; i++) {
                    const angle = (i / steps) * Math.PI * 2;
                    const tx = island.x + x + Math.cos(angle) * r;
                    const ty = island.y + y + Math.sin(angle) * r;

                    // Check point validity
                    if (this.isValidPosition(tx, ty, 'builder')) {
                        // Strict Check: Must be on the SAME island as the base
                        let onSameIsland = false;
                        if (island.points) {
                            if (MapGenerator.isPointInPolygon(tx, ty, island.points)) onSameIsland = true;
                        } else {
                            const dist = Math.hypot(tx - island.x, ty - island.y);
                            if (dist <= island.radius) onSameIsland = true;
                        }

                        if (!onSameIsland) continue;

                        // Check immediate surroundings to ensure it's not a tiny speck of land
                        const pathChecks = [
                            { dx: 10, dy: 0 }, { dx: -10, dy: 0 }, { dx: 0, dy: 10 }, { dx: 0, dy: -10 }
                        ];
                        let pathable = true;
                        for (const pc of pathChecks) {
                            if (!this.isValidPosition(tx + pc.dx, ty + pc.dy, 'builder')) {
                                pathable = false;
                                break;
                            }
                        }

                        if (pathable) {
                            bx = tx;
                            by = ty;
                            foundSafeSpot = true;
                            console.log(`[Spawn] Found safe builder spot at dist ${r}, angle ${angle.toFixed(2)}`);
                            break searchLoop;
                        }
                    }
                }
            }

            if (!foundSafeSpot) {
                console.warn(`[Spawn] No safe spot found! Defaulting to base center (risk of stuck).`);
                bx = island.x + x;
                by = island.y + y;
            }

            this.units.push({
                id: `unit_${Date.now()}_builder_${Math.floor(Math.random() * 10000)}`,
                ownerId: playerId,
                type: 'builder',
                x: bx,
                y: by,
                status: 'idle',
                health: UnitData.builder.health,
                maxHealth: UnitData.builder.maxHealth,
                damage: UnitData.builder.damage,
                range: UnitData.builder.range,
                speed: UnitData.builder.speed,
                fireRate: UnitData.builder.fireRate,
                facingAngle: 0
            });
            if (player) {
                player.hqSpawnedOnce = true;
            }
            this.touchMapVersion();
            return true;
        } else {
            console.error(`CRITICAL: Failed to spawn base for ${playerId} even with failsafe!`);
            return false;
        }
    }

    buildStructure(playerId: string, locationId: string, type: 'barracks' | 'mine' | 'tower' | 'dock' | 'base' | 'oil_rig' | 'oil_well' | 'wall' | 'bridge_node' | 'wall_node' | 'farm' | 'tank_factory' | 'air_base' | 'hospital' | 'repair_dock' | 'naval_mine', x?: number, y?: number): boolean {
        const player = this.players.get(playerId);
        if (!player) return false;

        const stats = BuildingData[type];
        if (!stats) return false;

        if (type === 'base') {
            // Anti-Exploit: Explicitly notify if blocked due to elimination
            if (player.status === 'eliminated' || player.canBuildHQ === false) {
                if (this.io) {
                    this.io.to(playerId).emit('chat_message', {
                        sender: 'System',
                        content: '⛔ Construction Denied: You cannot rebuild HQ after elimination!',
                        timestamp: Date.now()
                    });
                }
            }
            return false; // Hard restrict: HQs are only spawned, not built
        }

        if (player.resources.gold < stats.cost.gold || player.resources.oil < stats.cost.oil) return false;

        if (type === 'naval_mine') {
            if (x === undefined || y === undefined) return false;
            if (!this.isNavalMinePlacementClear(x, y)) return false;

            const BUILD_RANGE = this.getBuildSupportRange(type);
            const nearbyWorkers = this.getBuildSupportUnitsInRange(playerId, type, x, y, BUILD_RANGE);
            if (nearbyWorkers.length === 0) return false;

            player.resources.gold -= stats.cost.gold;
            player.resources.oil -= stats.cost.oil;

            const building = {
                id: `bld_${Date.now()}_${Math.random()}`,
                type,
                level: 1,
                health: 1,
                maxHealth: stats.maxHealth,
                x,
                y,
                isConstructing: true,
                constructionProgress: 0,
                ownerId: playerId,
                range: stats.range,
                hiddenFromEnemies: true
            };

            this.map.waterBuildings = this.map.waterBuildings || [];
            this.map.waterBuildings.push(building as any);

            const worker = this.getClosestBuildSupportUnit(playerId, type, x, y);
            if (worker) {
                this.moveUnitsToPosition(playerId, [worker.id], x, y);
            }
            this.touchMapVersion();
            return true;
        }

        const useExactBridgeNodeIslandLookup = type === 'bridge_node' && x !== undefined && y !== undefined;

        // Check if location is an Island or OilSpot
        let island = this.map.islands.find(i => i.id === locationId);
        let oilSpot = this.map.oilSpots.find(o => o.id === locationId);

        // If a specific oil spot is targeted (by ID) but no coordinates provided, use the spot's coordinates
        // This allows clicking directly on a visible/hidden oil spot to place an Oil Well
        if (oilSpot && x === undefined && y === undefined) {
            x = oilSpot.x;
            y = oilSpot.y;
        }

        // If x/y provided, try to find the location if locationId is not specific enough or mismatched
        if (x !== undefined && y !== undefined) {
            const foundOilSpot = this.map.oilSpots.find(o => Math.hypot(o.x - x, o.y - y) < o.radius + 20);
            if (foundOilSpot) oilSpot = foundOilSpot;

            const preferOilSpotForRig = type === 'oil_rig' && !!oilSpot;
            const preferAccessibleIslandForOilWell = type === 'oil_well' && !!oilSpot;
            if (!preferOilSpotForRig) {
                // Find island at this position
                // Prioritize smaller islands (e.g. Oases on top of Desert Floor)
                let candidates = useExactBridgeNodeIslandLookup
                    ? this.getExactIslandCandidatesAtPoint(x, y)
                    : this.map.islands.filter(i => {
                        if (i.points) return MapGenerator.isPointInPolygon(x, y, i.points);
                        return Math.hypot(i.x - x, i.y - y) < i.radius + 50;
                    });

                if (type === 'dock') {
                    candidates = candidates.filter(candidate => this.isPointOnExposedIslandShoreline(candidate, x!, y!));
                }

                if (candidates.length > 0) {
                    if (preferAccessibleIslandForOilWell) {
                        const ownedCandidates = candidates.filter(candidate => candidate.ownerId === playerId);
                        const builderUnits = this.units.filter(unit => unit.ownerId === playerId && unit.type === 'builder');
                        const scoreCandidate = (candidate: Island) => {
                            const distToCenter = Math.hypot(candidate.x - x, candidate.y - y);
                            const nearestBuilderDist =
                                builderUnits.length > 0
                                    ? Math.min(...builderUnits.map(unit => Math.hypot(unit.x - x, unit.y - y)))
                                    : Number.POSITIVE_INFINITY;
                            const ownerBias = candidate.ownerId === playerId ? -300 : candidate.ownerId ? 220 : 0;
                            return distToCenter + nearestBuilderDist * 0.6 + ownerBias + candidate.radius * 0.08;
                        };

                        const ranked = (ownedCandidates.length > 0 ? ownedCandidates : candidates).sort(
                            (a, b) => scoreCandidate(a) - scoreCandidate(b)
                        );
                        island = ranked[0];
                    } else {
                        island = candidates[0];
                    }
                }
            } else {
                island = undefined;
            }
        }

        if (island) {
            // Ownership check:
            // - Shared maps already allow open land building.
            // - Neutral islands on classic maps still require bridge footholds / bridge nodes.
            // - Enemy-owned land is now buildable as long as the player still satisfies normal worker/range/footprint rules.
            const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
            const enemyOwnedIsland = !!island.ownerId && island.ownerId !== playerId;
            const allowNeutralBridgeNode = !island.ownerId && this.canBuildOnNeutralIsland(type);
            const hasForwardBridgeFoothold =
                !island.ownerId &&
                island.buildings.some(building => building.ownerId === playerId && building.type === 'bridge_node');
            const neutralIslandAllowed = isSharedMap || allowNeutralBridgeNode || hasForwardBridgeFoothold;
            if (!enemyOwnedIsland && island.ownerId !== playerId && !neutralIslandAllowed) return false;

            if (type === 'oil_rig') return false;

            let targetX = 0;
            let targetY = 0;

            const hasDockWaterSpawn = (absX: number, absY: number): boolean => {
                const radii = [40, 60, 80, 100, 120, 150, 180, 200];
                for (const r of radii) {
                    for (let i = 0; i < 8; i++) {
                        const angle = (i / 8) * Math.PI * 2;
                        const tx = absX + Math.cos(angle) * r;
                        const ty = absY + Math.sin(angle) * r;
                        if (this.isValidPosition(tx, ty, 'destroyer')) {
                            return true;
                        }
                    }
                }
                return false;
            };

            if (x !== undefined && y !== undefined) {
                // Manual placement (Absolute to Relative)
                targetX = x - island.x;
                targetY = y - island.y;

                // Gold Mine Placement Fix
                if (type === 'mine') {
                    // Try to find nearest free gold spot within reasonable range
                    const nearestSpot = island.goldSpots.find(s => !s.occupiedBy && Math.hypot(s.x - targetX, s.y - targetY) < 100);
                    if (nearestSpot) {
                        targetX = nearestSpot.x;
                        targetY = nearestSpot.y;
                    } else {
                        // If no spot found near click, fail
                        return false;
                    }
                }

                // Validate placement
                if (island.points) {
                    const absX = island.x + targetX;
                    const absY = island.y + targetY;
                    if (type === 'mine') {
                    } else if (type === 'dock') {
                        if (!this.isPointOnExposedIslandShoreline(island, absX, absY)) return false;
                        if (!hasDockWaterSpawn(absX, absY)) return false;
                    } else {
                        const inside = MapGenerator.isPointInPolygon(absX, absY, island.points);
                        if (!inside) return false;
                    }
                } else {
                    const dist = Math.hypot(targetX, targetY);
                    if (type === 'dock') {
                        const absX = island.x + targetX;
                        const absY = island.y + targetY;
                        if (!this.isPointOnExposedIslandShoreline(island, absX, absY)) return false;
                        if (!hasDockWaterSpawn(absX, absY)) return false;
                    } else if (dist > island.radius) {
                        return false;
                    }
                }

                // Oil Well Specific Validation
                if (type === 'oil_well') {
                    // Land oil wells are allowed on any valid land island oil spot.
                    // Water spots remain oil rigs only and are filtered by radius below.
                    const absX = island.x + targetX;
                    const absY = island.y + targetY;

                    // Find valid oil spot near click
                    const oilSpot = this.map.oilSpots.find(os =>
                        Math.hypot(os.x - absX, os.y - absY) < 40 && // Close enough
                        !os.occupiedBy // Not taken
                    );

                    if (!oilSpot) return false;

                    // STRICT VALIDATION: Ensure it IS a Land Oil Spot
                    // Land spots have radius >= 30, Water spots have 15.
                    if (oilSpot.radius < 30) return false;

                    // Distance check to other wells?
                    const tooClose = this.map.oilSpots.some(os =>
                        os.id !== oilSpot.id &&
                        os.occupiedBy &&
                        (os as any).building?.type === 'oil_well' &&
                        Math.hypot(os.x - oilSpot.x, os.y - oilSpot.y) < 60
                    );
                    if (tooClose) return false;

                    // Store reference for post-build processing
                    (stats as any).targetOilSpotId = oilSpot.id;
                }

                // Farm Validation
                if (type === 'farm') {
                    if (island.type !== 'forest' && island.type !== 'grasslands') return false;

                    const farmAbsX = island.x + targetX;
                    const farmAbsY = island.y + targetY;
                    if (!this.isBuildingPlacementClearOnIsland(island, type, farmAbsX, farmAbsY)) return false;
                }

                // Check for Builder in range
                // User requested larger radius, increased to 400px
                const BUILD_RANGE = this.getBuildSupportRange(type);
                const finalAbsX = island.x + targetX;
                const finalAbsY = island.y + targetY;

                const nearbyWorkers = this.getBuildSupportUnitsInRange(playerId, type, finalAbsX, finalAbsY, BUILD_RANGE);
                if (nearbyWorkers.length === 0) return false;
            } else {
                // Auto placement logic (legacy/bot)
                if (type === 'mine') {
                    const freeSpot = island.goldSpots.find(s => !s.occupiedBy);
                    if (!freeSpot) return false;
                    targetX = freeSpot.x;
                    targetY = freeSpot.y;
                } else if (type === 'dock') {
                    let valid = false;
                    let attempts = 0;
                        while (!valid && attempts < 40) {
                            attempts++;
                            if (island.points && island.points.length > 0) {
                            const index = Math.floor(Math.random() * island.points.length);
                            const p = island.points[index];
                            const dx = p.x - island.x;
                            const dy = p.y - island.y;
                            const len = Math.hypot(dx, dy) || 1;
                            const insideOffset = 15;
                            const anchorX = p.x - (dx / len) * insideOffset;
                            const anchorY = p.y - (dy / len) * insideOffset;
                            if (!MapGenerator.isPointInPolygon(anchorX, anchorY, island.points)) {
                                continue;
                            }
                                const absX = anchorX;
                                const absY = anchorY;
                                if (!this.isPointOnExposedIslandShoreline(island, absX, absY)) {
                                    continue;
                                }
                                if (!hasDockWaterSpawn(absX, absY)) {
                                    continue;
                                }
                            const relX = anchorX - island.x;
                            const relY = anchorY - island.y;
                            if (!this.isBuildingPlacementClearOnIsland(island, type, absX, absY)) {
                                continue;
                            }
                            targetX = relX;
                            targetY = relY;
                            valid = true;
                        } else {
                            const angle = Math.random() * Math.PI * 2;
                            const innerRadius = Math.max(0, island.radius - 15);
                            const tx = Math.cos(angle) * innerRadius;
                            const ty = Math.sin(angle) * innerRadius;
                            const absX = island.x + tx;
                            const absY = island.y + ty;
                            if (!this.isPointOnExposedIslandShoreline(island, absX, absY)) {
                                continue;
                            }
                            if (!hasDockWaterSpawn(absX, absY)) {
                                continue;
                            }
                            if (!this.isBuildingPlacementClearOnIsland(island, type, absX, absY)) {
                                continue;
                            }
                            targetX = tx;
                            targetY = ty;
                            valid = true;
                        }
                    }
                    if (!valid) return false;
                } else {
                    let valid = false;
                    let attempts = 0;
                    const base = island.buildings.find(b => b.type === 'base' && b.ownerId === playerId);
                    const footprint = this.getEffectivePlacementFootprintRadius(type, island);
                    const baseFootprint = base ? this.getEffectivePlacementFootprintRadius('base', island) : 0;
                    const anchorX = base ? island.x + (base.x || 0) : island.x;
                    const anchorY = base ? island.y + (base.y || 0) : island.y;
                    const minDist = type === 'air_base'
                        ? Math.max(footprint + 6, baseFootprint + footprint - 10)
                        : Math.max(footprint + 20, baseFootprint + footprint + 12);
                    const maxIslandDist = Math.max(footprint + 4, island.radius - Math.max(0, footprint) - 6);
                    const maxDist = island.points
                        ? minDist + (type === 'air_base' ? 260 : 220)
                        : Math.max(
                            minDist + 12,
                            Math.min(
                                Math.max(footprint + 12, maxIslandDist),
                                minDist + (type === 'air_base' ? 260 : 220)
                            )
                        );

                    while (!valid && attempts < (type === 'air_base' ? 120 : 64)) {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = minDist + Math.random() * Math.max(20, maxDist - minDist);
                        const absX = anchorX + Math.cos(angle) * dist;
                        const absY = anchorY + Math.sin(angle) * dist;

                        if (!this.isBuildingPlacementClearOnIsland(island, type, absX, absY)) {
                            attempts++;
                            continue;
                        }

                        targetX = absX - island.x;
                        targetY = absY - island.y;
                        valid = true;
                        attempts++;
                    }

                    if (!valid) return false;
                }

            }

            const finalAbsX = island.x + targetX;
            const finalAbsY = island.y + targetY;

            if (!this.isBuildingPlacementClearOnIsland(island, type, finalAbsX, finalAbsY)) {
                return false;
            }

            const BUILD_RANGE = this.getBuildSupportRange(type);
            const nearbyWorkers = this.getBuildSupportUnitsInRange(playerId, type, finalAbsX, finalAbsY, BUILD_RANGE);
            if (nearbyWorkers.length === 0) return false;

            // Deduct cost
            player.resources.gold -= stats.cost.gold;
            player.resources.oil -= stats.cost.oil;

            const buildingId = `bld_${Date.now()}_${Math.random()}`;
            let linkedOilSpot: any = null;

            if (type === 'oil_well') {
                const targetId = (stats as any).targetOilSpotId;
                if (targetId) {
                    const spot = this.map.oilSpots.find(s => s.id === targetId);
                    if (spot) {
                        linkedOilSpot = spot;
                        targetX = spot.x - island.x;
                        targetY = spot.y - island.y;

                        if (spot.id.startsWith('hidden_oil_')) {
                            spot.id = spot.id.replace('hidden_oil_', 'oil_revealed_');
                        }

                        const snappedAbsX = island.x + targetX;
                        const snappedAbsY = island.y + targetY;
                        if (!this.isBuildingPlacementClearOnIsland(island, type, snappedAbsX, snappedAbsY)) {
                            player.resources.gold += stats.cost.gold;
                            player.resources.oil += stats.cost.oil;
                            return false;
                        }
                    }
                }
            }

            if (type === 'mine') {
                // If manual, find closest gold spot?
                let freeSpot: any = null;
                if (x !== undefined && y !== undefined) {
                    // Closest check
                    let minSpotDist = Infinity;
                    for (const s of island.goldSpots) {
                        if (!s.occupiedBy) {
                            const d = Math.hypot(s.x - targetX, s.y - targetY);
                            if (d < 100 && d < minSpotDist) {
                                minSpotDist = d;
                                freeSpot = s;
                            }
                        }
                    }
                } else {
                    freeSpot = island.goldSpots.find(s => !s.occupiedBy);
                }

                if (!freeSpot) {
                    // Refund
                    player.resources.gold += stats.cost.gold;
                    player.resources.oil += stats.cost.oil;
                    return false;
                }
                freeSpot.occupiedBy = buildingId;
                // Snap to spot
                targetX = freeSpot.x;
                targetY = freeSpot.y;

                const snappedAbsX = island.x + targetX;
                const snappedAbsY = island.y + targetY;
                if (!this.isBuildingPlacementClearOnIsland(island, type, snappedAbsX, snappedAbsY)) {
                    player.resources.gold += stats.cost.gold;
                    player.resources.oil += stats.cost.oil;
                    freeSpot.occupiedBy = undefined;
                    return false;
                }
            }

            const isInstant = ((type as string) === 'barracks' || (type as string) === 'base');
            // console.log(`Building constructed: ${type} at ${targetX},${targetY}. Instant? ${isInstant}`);

            const building = {
                id: buildingId,
                type,
                level: 1,
                health: isInstant ? stats.maxHealth : 1, // Start full for barracks/base as requested
                maxHealth: stats.maxHealth,
                x: targetX,
                y: targetY,
                isConstructing: !isInstant, // Barracks/Base instant for now to fix user issue
                constructionProgress: isInstant ? stats.maxHealth : 0,
                ownerId: playerId, // Assign ownership
                range: stats.range
            };

            island.buildings.push(building);

            if (linkedOilSpot) {
                linkedOilSpot.occupiedBy = buildingId;
                (linkedOilSpot as any).ownerId = playerId;
                (linkedOilSpot as any).building = building;
            }

            // Command closest builder to move to construction site
            const closestWorker = this.getClosestBuildSupportUnit(playerId, type, finalAbsX, finalAbsY);
            if (closestWorker) {
                this.moveUnitsToPosition(playerId, [closestWorker.id], finalAbsX, finalAbsY);
            }

            return true;
        } else if (type === 'bridge_node' && x !== undefined && y !== undefined) {
            if (!this.isBridgeNodeWaterPlacementClear(x, y)) return false;

            const BUILD_RANGE = this.getBuildSupportRange(type);
            const nearbyWorkers = this.getBuildSupportUnitsInRange(playerId, type, x, y, BUILD_RANGE);
            if (nearbyWorkers.length === 0) return false;

            player.resources.gold -= stats.cost.gold;
            player.resources.oil -= stats.cost.oil;

            const building = {
                id: `bld_${Date.now()}_${Math.random()}`,
                type,
                level: 1,
                health: 1,
                maxHealth: stats.maxHealth,
                x,
                y,
                isConstructing: true,
                constructionProgress: 0,
                ownerId: playerId,
                range: stats.range
            };

            this.map.waterBuildings = this.map.waterBuildings || [];
            this.map.waterBuildings.push(building as any);

            const closestWorker = this.getClosestBuildSupportUnit(playerId, type, x, y);
            if (closestWorker) {
                this.moveUnitsToPosition(playerId, [closestWorker.id], x, y);
            }

            this.touchMapVersion();
            return true;
        } else if (oilSpot) {
            if (type !== 'oil_rig') return false;
            if (oilSpot.occupiedBy) return false;

            // STRICT VALIDATION: Ensure it is NOT a Land Oil Spot
            if (oilSpot.id.startsWith('hidden_oil_') || oilSpot.id.startsWith('oil_revealed_')) return false;

            // Check for Construction Ship nearby
            const hasConstructionShip = this.units.some(u =>
                u.ownerId === playerId &&
                u.type === 'construction_ship' &&
                Math.hypot(u.x - oilSpot!.x, u.y - oilSpot!.y) < 150 // Range check
            );

            if (!hasConstructionShip) return false;

            // Check if any other oil rig is too close (Hitbox check)
            // User wants to prevent placing them "ontop of eachother or super close"
            const tooClose = this.map.oilSpots.some(other =>
                other.id !== oilSpot!.id && // Not this one
                other.occupiedBy && // Has a rig
                Math.hypot(other.x - oilSpot!.x, other.y - oilSpot!.y) < 80 // Distance threshold
            );

            if (tooClose) return false;

            player.resources.gold -= stats.cost.gold;
            player.resources.oil -= stats.cost.oil;

            (oilSpot as any).ownerId = playerId;
            (oilSpot as any).building = {
                id: `bld_${Date.now()}_${Math.random()}`,
                type: 'oil_rig',
                level: 1,
                health: 1,
                maxHealth: stats.maxHealth,
                isConstructing: true,
                constructionProgress: 0
            };
            oilSpot.occupiedBy = (oilSpot as any).building.id;

            return true;
        }

        return false;
    }

    handleUseAbility(playerId: string, unitId: string, ability: string, io: any) {
        const unit = this.units.find(u => u.id === unitId);
        if (!unit || unit.ownerId !== playerId) return;

        if (ability === 'reveal_oil' && unit.type === 'oil_seeker') {
            // Check cooldown
            const now = Date.now();
            if (unit.abilityCooldown && now < unit.abilityCooldown) return;

            // Set cooldown (30s)
            unit.abilityCooldown = now + 30000;

            // Calculate massive range (1/4 of map)
            const range = Math.max(this.map.width, this.map.height) / 4;
            const revealedIds: string[] = [];

            this.map.oilSpots.forEach(spot => {
                if (Math.hypot(spot.x - unit.x, spot.y - unit.y) <= range) {
                    revealedIds.push(spot.id);
                }
            });

            // Emit event to player
            io.to(playerId).emit('abilityEffect', {
                type: 'reveal_oil',
                unitId: unit.id,
                oilSpotIds: revealedIds,
                duration: 10000, // 10s
                range: range // Send range for visual feedback
            });
        }
    }

    recruitUnit(playerId: string, islandId: string | null, type: string, buildingId?: string): boolean {
        const player = this.players.get(playerId);
        if (!player) return false;

        const island = this.map.islands.find(i => i.id === islandId);
        // If recruiting from Mothership, islandId might be just "current location" or irrelevant if we pass buildingId (Mothership ID)
        // But let's keep island validation if provided.

        // Ownership check: Strict for classic maps, relaxed for shared maps
        const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
        if (island && !isSharedMap && island.ownerId !== playerId) return false;
        if (island && island.ownerId && island.ownerId !== playerId) return false;

        // Find source
        let sourceBuilding: any = undefined;

        if (buildingId) {
            // 1. Check buildings on island
            if (island) {
                sourceBuilding = island.buildings.find(b => b.id === buildingId);
            }
            // 2. Check units (Mothership)
            if (!sourceBuilding) {
                sourceBuilding = this.units.find(u => u.id === buildingId);
            }
        }

        if (sourceBuilding && sourceBuilding.ownerId && sourceBuilding.ownerId !== playerId) return false; // Not my building/unit

        if (buildingId && (!sourceBuilding || (sourceBuilding.isConstructing && !['mothership', 'aircraft_carrier'].includes(sourceBuilding.type)))) return false;

        const isInfantry = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(type);
        const isNaval = ['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'aircraft_carrier'].includes(type);
        const isVehicle = ['tank', 'humvee', 'missile_launcher'].includes(type);
        const isAir = ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type);

        if (!sourceBuilding && island) {
            if (isNaval) {
                sourceBuilding = island.buildings.find(b => b.type === 'dock' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
            } else if (isVehicle) {
                sourceBuilding = island.buildings.find(b => b.type === 'tank_factory' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
            } else if (isAir) {
                sourceBuilding = island.buildings.find(b => b.type === 'air_base' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
            } else {
                sourceBuilding = island.buildings.find(b => (b.type === 'barracks' || (type === 'builder' && b.type === 'base')) && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
            }
        }

        if (!sourceBuilding) return false;

        if (isNaval && sourceBuilding.type !== 'dock') return false;
        if (isVehicle && sourceBuilding.type !== 'tank_factory') return false;
        if (isAir && sourceBuilding.type !== 'air_base' && sourceBuilding.type !== 'mothership' && sourceBuilding.type !== 'aircraft_carrier') return false;
        if (isInfantry && !(sourceBuilding.type === 'barracks' || (type === 'builder' && sourceBuilding.type === 'base'))) return false;

        // Mothership restriction
        if (sourceBuilding.type === 'mothership') {
            if (!['alien_scout', 'heavy_alien', 'light_plane', 'heavy_plane'].includes(type)) return false;
        }

        // Air Carrier restriction
        if (sourceBuilding.type === 'aircraft_carrier') {
            if (!['light_plane', 'heavy_plane'].includes(type)) return false;
        }

        const stats = UnitData[type];
        if (!stats) return false;

        if (player.resources.gold < stats.cost.gold || player.resources.oil < stats.cost.oil) return false;

        if (sourceBuilding) {
            if (!sourceBuilding.recruitmentQueue) sourceBuilding.recruitmentQueue = [];

            if (sourceBuilding.recruitmentQueue.length >= 5) return false;

            player.resources.gold -= stats.cost.gold;
            player.resources.oil -= stats.cost.oil;

            // Add to queue
            sourceBuilding.recruitmentQueue.push({
                unitType: type,
                progress: 0,
                totalTime: stats.constructionTime || 100
            });
            return true;
        }

        return false;
    }

    spawnUnit(playerId: string, type: string, island: any, building: any) {
        const stats = UnitData[type];
        if (!stats) return;

        // Handle Unit-as-Building (Mothership)
        if (!island) {
            if (building && building.x !== undefined && building.y !== undefined) {
                // Check if source is a transport with capacity
                const canLoad = ['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(building.type);

                if (canLoad) {
                    // EXCEPTION: Mothership and Carrier recruiting Air units should spawn them OUTSIDE (launch them)
                    const isAirLaunch = (building.type === 'mothership' || building.type === 'aircraft_carrier') &&
                        ['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(type);

                    if (!isAirLaunch) {
                        if (!building.cargo) building.cargo = [];

                        let maxCapacity = 10;
                        if (building.type === 'humvee') maxCapacity = 4;
                        if (['aircraft_carrier', 'mothership'].includes(building.type)) maxCapacity = 20;

                        if (building.cargo.length < maxCapacity) {
                            // Add directly to cargo (skip world placement)
                            building.cargo.push({
                                id: `unit_${Date.now()}_${Math.random()}`,
                                ownerId: playerId,
                                type,
                                x: building.x, // Placeholder, will be updated on unload
                                y: building.y,
                                status: 'idle',
                                health: stats.health,
                                maxHealth: stats.maxHealth,
                                damage: stats.damage,
                                range: stats.range,
                                speed: stats.speed,
                                fireRate: stats.fireRate,
                                facingAngle: 0,
                                recruitmentQueue: [],
                                cargo: []
                            });
                            return;
                        }
                    }
                }

                // Spawn relative to the unit/building (fallback if full or not transport)
                const spawnX = building.x + (Math.random() - 0.5) * 50;
                const spawnY = building.y + (Math.random() - 0.5) * 50;

                this.units.push({
                    id: `unit_${Date.now()}_${Math.random()}`,
                    ownerId: playerId,
                    type,
                    x: spawnX,
                    y: spawnY,
                    status: 'idle',
                    health: stats.health,
                    maxHealth: stats.maxHealth,
                    damage: stats.damage,
                    range: stats.range,
                    speed: stats.speed,
                    fireRate: stats.fireRate,
                    facingAngle: 0
                });
                return;
            }
            return; // Invalid spawn
        }

        let spawnX = island.x;
        let spawnY = island.y;

        const bx = island.x + (building.x || 0);
        const by = island.y + (building.y || 0);

        const isNaval = ['destroyer', 'pirate_ship', 'construction_ship', 'ferry'].includes(type);

        if (building.type === 'dock' && isNaval) {
            // Robust Water Search: Scan in expanding rings around the dock
            let foundWater = false;

            // Search radii: Start close, expand outward (Increased range for Carriers)
            const radii = [40, 60, 80, 100, 120, 150, 180, 200];

            // Try the "natural" direction first (center -> dock)
            const dx = bx - island.x;
            const dy = by - island.y;
            const naturalAngle = Math.atan2(dy, dx);

            // Angles to check: Natural direction first, then fan out
            // We'll check 8 directions (0, 45, 90...) + natural angle

            for (const r of radii) {
                if (foundWater) break;

                // Check natural direction first at this radius
                const nx = bx + Math.cos(naturalAngle) * r;
                const ny = by + Math.sin(naturalAngle) * r;
                if (this.isValidPosition(nx, ny, type)) {
                    spawnX = nx;
                    spawnY = ny;
                    foundWater = true;
                    break;
                }

                // Check 8 cardinal/intercardinal directions
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2;
                    const tx = bx + Math.cos(angle) * r;
                    const ty = by + Math.sin(angle) * r;

                    if (this.isValidPosition(tx, ty, type)) {
                        spawnX = tx;
                        spawnY = ty;
                        foundWater = true;
                        break;
                    }
                }
            }

            if (!foundWater) {
                // Absolute fallback: Push outside the island polygon/radius
                if (island.points) {
                    // Find closest point on the island edge from the dock
                    const closest = MapGenerator.getClosestPointOnPolygon(bx, by, island.points);

                    // Calculate vector from island center to that edge point to determine "outward" direction
                    const dx = closest.x - island.x;
                    const dy = closest.y - island.y;
                    const len = Math.hypot(dx, dy) || 1;

                    // Spawn 30px outside the edge
                    spawnX = closest.x + (dx / len) * 30;
                    spawnY = closest.y + (dy / len) * 30;
                } else {
                    // Circle fallback: Push out to radius + 30
                    const dx = bx - island.x;
                    const dy = by - island.y;
                    const len = Math.hypot(dx, dy) || 1;
                    spawnX = island.x + (dx / len) * (island.radius + 30);
                    spawnY = island.y + (dy / len) * (island.radius + 30);
                }
            }
        } else if (this.isLandUnitType(type)) {
            const safeSpawn = this.findLandRecruitSpawnPosition(type, island, building);
            if (safeSpawn) {
                spawnX = safeSpawn.x;
                spawnY = safeSpawn.y;
            } else {
                console.warn(`[Spawn] No clear land recruit spawn found for ${type} from ${building.type} (${building.id}). Falling back to source center.`);
                spawnX = bx;
                spawnY = by;
            }
        } else {
            // Air units can safely lift from the source structure.
            spawnX = bx;
            spawnY = by;
        }

        this.units.push({
            id: `unit_${Date.now()}_${Math.random()}`,
            ownerId: playerId,
            type,
            x: spawnX,
            y: spawnY,
            status: 'idle',
            health: stats.health,
            maxHealth: stats.maxHealth,
            damage: stats.damage,
            range: stats.range,
            speed: stats.speed,
            fireRate: stats.fireRate,
            facingAngle: 0,
            recruitmentQueue: [],
            cargo: []
        });
    }

    moveUnits(playerId: string, unitIds: string[], targetIslandId: string) {
        const targetIsland = this.map.islands.find(i => i.id === targetIslandId);

        if (!targetIsland) return;

        unitIds.forEach(uid => {
            const unit = this.units.find(u => u.id === uid);
            if (unit && unit.ownerId === playerId) {
                const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder'].includes(unit.type);

                if (isLandUnit) {
                    // Check if moving to a different island
                    // Find current island
                    const currentIsland = this.map.islands.find(i => {
                        if (i.points) return MapGenerator.isPointInPolygon(unit.x, unit.y, i.points);
                        return Math.hypot(unit.x - i.x, unit.y - i.y) <= i.radius + 30;
                    });

                    // Also check if currently on a bridge connected to the target

                    if (currentIsland) {
                        if (currentIsland.id !== targetIslandId) {
                            const tIsland = this.map.islands.find(i => i.id === targetIslandId);
                            // Check for overlap connection
                            let connectedByLand = false;
                            if (tIsland) {
                                connectedByLand = this.areIslandsLandConnected(currentIsland, tIsland);
                            }

                            if (!connectedByLand) {
                                // Moving between islands: Must have a traversable bridge chain
                                const hasBridge = !!this.findIslandPath(currentIsland.id, targetIslandId);

                                if (!hasBridge) {
                                    // Block movement
                                    unit.targetIslandId = undefined;
                                    unit.status = 'idle';
                                    return;
                                }
                            }
                        }
                    } else {
                        const bridgeInfo = this.getBridgeAt(unit.x, unit.y);
                        if (!bridgeInfo) return;

                        const nodeAContext = this.getNodeContext(bridgeInfo.bridge.nodeAId);
                        const nodeBContext = this.getNodeContext(bridgeInfo.bridge.nodeBId);
                        const canReachTarget =
                            (!!nodeAContext?.islandId && !!this.findIslandPath(nodeAContext.islandId, targetIslandId)) ||
                            (!!nodeBContext?.islandId && !!this.findIslandPath(nodeBContext.islandId, targetIslandId));

                        if (!canReachTarget) return;
                    }
                }

                unit.targetIslandId = targetIslandId;
                unit.status = 'moving';
            }
        });
    }

    unloadCargo(playerId: string, carrierId: string) {
        const carrier = this.units.find(u => u.id === carrierId);
        if (!carrier || carrier.ownerId !== playerId) return;
        if (!carrier.cargo || carrier.cargo.length === 0) return;

        // Unload all
        carrier.cargo.forEach(u => {
            // Find valid spot around carrier
            // Try multiple times to find valid land spot
            let valid = false;
            let tx = carrier.x;
            let ty = carrier.y;

            for (let i = 0; i < 10; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 30 + Math.random() * 50;
                tx = carrier.x + Math.cos(angle) * dist;
                ty = carrier.y + Math.sin(angle) * dist;
                if (this.isValidPosition(tx, ty, u.type)) {
                    valid = true;
                    break;
                }
            }

            if (!valid) {
                // Fallback to carrier position (will be pushed by collision)
                tx = carrier.x;
                ty = carrier.y;
            }

            u.x = tx;
            u.y = ty;
            u.status = 'idle';
            this.units.push(u);
        });

        carrier.cargo = [];
    }

    shouldEliminateOnBaseLoss(ownerId: string): boolean {
        const owner = this.players.get(ownerId);
        if (!owner) return true;
        return owner.status === 'eliminated' || owner.canBuildHQ === false || owner.hqSpawnedOnce === true;
    }

    private isOilStructureBackedByIslandBuilding(building: any): boolean {
        return this.map.islands.some(island =>
            island.buildings.some(existing => existing === building || existing.id === building.id)
        );
    }

    private destroyOilStructureById(buildingId: string) {
        this.map.islands.forEach(island => {
            island.buildings = island.buildings.filter(building => building.id !== buildingId);
        });

        this.map.oilSpots.forEach(spot => {
            if (spot.occupiedBy === buildingId || (spot as any).building?.id === buildingId) {
                spot.occupiedBy = undefined;
                delete (spot as any).ownerId;
                delete (spot as any).building;
            }
        });
    }

    private startPlayerAssetCollapse(playerId: string) {
        if (this.playerCollapseStates.has(playerId)) return;

        const now = Date.now();
        this.playerCollapseStates.set(playerId, {
            startedAt: now,
            ticksApplied: 0,
            nextTickAt: now + 1000
        });

        this.units.forEach(unit => {
            if (unit.ownerId !== playerId) return;
            unit.status = 'idle';
            unit.targetX = undefined;
            unit.targetY = undefined;
            unit.targetIslandId = undefined;
            unit.path = [];
            unit.damage = 0;
            (unit as any).burning = true;
            (unit as any).burningUntil = now + 10000;
        });

        this.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (building.ownerId !== playerId) return;
                (building as any).burning = true;
                (building as any).burningUntil = now + 10000;
            });
        });

        (this.map.waterBuildings || []).forEach(building => {
            if (building.ownerId !== playerId) return;
            (building as any).burning = true;
            (building as any).burningUntil = now + 10000;
        });

        this.map.oilSpots.forEach(spot => {
            if ((spot as any).ownerId !== playerId) return;
            const building = (spot as any).building;
            if (!building) return;
            (building as any).burning = true;
            (building as any).burningUntil = now + 10000;
        });
    }

    private processPlayerAssetCollapse(now: number) {
        if (this.playerCollapseStates.size === 0) return;

        const completed: string[] = [];
        this.playerCollapseStates.forEach((state, playerId) => {
            while (state.ticksApplied < 10 && now >= state.nextTickAt) {
                state.ticksApplied += 1;
                state.nextTickAt += 1000;

                this.units.forEach(unit => {
                    if (unit.ownerId !== playerId || unit.health <= 0) return;
                    unit.health -= Math.max(1, unit.maxHealth * 0.1);
                });

                this.map.islands.forEach(island => {
                    island.buildings.forEach(building => {
                        if (building.ownerId !== playerId || building.health <= 0) return;
                        building.health -= Math.max(1, building.maxHealth * 0.1);
                    });
                });

                (this.map.waterBuildings || []).forEach(building => {
                    if (building.ownerId !== playerId || building.health <= 0) return;
                    building.health -= Math.max(1, building.maxHealth * 0.1);
                });

                this.map.oilSpots.forEach(spot => {
                    if ((spot as any).ownerId !== playerId) return;
                    const building = (spot as any).building;
                    if (!building || building.health <= 0) return;
                    building.health -= Math.max(1, building.maxHealth * 0.1);
                });
            }

            if (state.ticksApplied >= 10) {
                this.units.forEach(unit => {
                    if (unit.ownerId !== playerId) return;
                    unit.health = 0;
                });

                this.map.islands.forEach(island => {
                    island.buildings.forEach(building => {
                        if (building.ownerId !== playerId) return;
                        building.health = 0;
                    });
                });

                (this.map.waterBuildings || []).forEach(building => {
                    if (building.ownerId !== playerId) return;
                    building.health = 0;
                });

                this.map.oilSpots.forEach(spot => {
                    if ((spot as any).ownerId !== playerId) return;
                    const building = (spot as any).building;
                    if (building) building.health = 0;
                });

                completed.push(playerId);
            }
        });

        completed.forEach(playerId => this.playerCollapseStates.delete(playerId));
    }

    cleanupDeadEntities() {
        // Remove dead units
        const initialCount = this.units.length;
        this.units = this.units.filter(u => {
            if (u.health <= 0) {
                // Check for cargo
                if (u.cargo && u.cargo.length > 0) {
                    console.log(`[Cleanup] Transport ${u.type} (${u.id}) destroyed with ${u.cargo.length} units inside.`);
                    u.cargo.forEach(c => console.log(`   - Cargo Lost: ${c.type} (${c.id})`));
                } else {
                    console.log(`[Cleanup] Removing dead unit: ${u.type} (${u.id}) Owner: ${u.ownerId} Health: ${u.health}`);
                }
                return false;
            }
            return true;
        });

        // Remove destroyed buildings and resolve HQ elimination consistently.
        // This catches every combat path, including AoE paths that bypass explicit HQ checks.
        const eliminateQueue = new Set<string>();
        const destroyedNodeIds = new Set<string>();
        this.map.islands.forEach(island => {
            island.buildings = island.buildings.filter(b => {
                if (b.health > 0) return true;

                if (b.type === 'base' && b.ownerId) {
                    if (this.shouldEliminateOnBaseLoss(b.ownerId)) {
                        eliminateQueue.add(b.ownerId);
                    }
                }

                if (b.type === 'mine') {
                    const spot = island.goldSpots.find(s => s.occupiedBy === b.id);
                    if (spot) spot.occupiedBy = undefined;
                }

                if (b.type === 'oil_rig' || b.type === 'oil_well') {
                    const spot = this.map.oilSpots.find(s => s.occupiedBy === b.id || (s as any).building?.id === b.id);
                    if (spot) {
                        spot.occupiedBy = undefined;
                        delete (spot as any).ownerId;
                        delete (spot as any).building;
                    }
                }

                if ((b.type === 'bridge_node' || b.type === 'wall_node') && b.id) {
                    destroyedNodeIds.add(b.id);
                }

                return false;
            });
        });

        if (destroyedNodeIds.size > 0) {
            this.map.bridges = this.map.bridges.filter(bridge =>
                !destroyedNodeIds.has(bridge.nodeAId) && !destroyedNodeIds.has(bridge.nodeBId)
            );
            this.clearTraversalCaches();
        }

        this.map.oilSpots.forEach(spot => {
            const building = (spot as any).building;
            if (building && building.health <= 0) {
                this.destroyOilStructureById(building.id);
            }
        });

        if (this.map.waterBuildings && this.map.waterBuildings.length > 0) {
            this.map.waterBuildings = this.map.waterBuildings.filter(building => {
                if (building.health > 0) return true;
                if ((building.type === 'bridge_node' || building.type === 'wall_node') && building.id) {
                    destroyedNodeIds.add(building.id);
                }
                return false;
            });
        }

        if (destroyedNodeIds.size > 0) {
            this.map.bridges = this.map.bridges.filter(bridge =>
                !destroyedNodeIds.has(bridge.nodeAId) && !destroyedNodeIds.has(bridge.nodeBId)
            );
            this.clearTraversalCaches();
        }

        eliminateQueue.forEach(playerId => this.eliminatePlayer(playerId, 'HQ_DESTROYED'));

        // Sync bots array with players array (Remove disconnected/stale bots)
        this.bots = this.bots.filter(b => this.players.has(b.playerId));
    }

    handleCheat(playerId: string, command: string, args: string[]): string {
        const player = this.players.get(playerId);
        if (!player) return 'Player not found';

        switch (command) {
            case 'gold':
                const gold = parseInt(args[0]);
                if (!isNaN(gold)) {
                    player.resources.gold += gold;
                    return `Added ${gold} Gold. Total: ${player.resources.gold}`;
                }
                return 'Invalid amount';

            case 'oil':
                const oil = parseInt(args[0]);
                if (!isNaN(oil)) {
                    player.resources.oil += oil;
                    return `Added ${oil} Oil. Total: ${player.resources.oil}`;
                }
                return 'Invalid amount';

            case 'setgold':
                const sGold = parseInt(args[0]);
                if (!isNaN(sGold)) {
                    player.resources.gold = sGold;
                    return `Set Gold to ${sGold}`;
                }
                return 'Invalid amount';

            case 'setoil':
                const sOil = parseInt(args[0]);
                if (!isNaN(sOil)) {
                    player.resources.oil = sOil;
                    return `Set Oil to ${sOil}`;
                }
                return 'Invalid amount';

            case 'god':
            case 'godmode':
                player.godMode = !player.godMode;
                // Also heal existing units if enabling
                if (player.godMode) {
                    this.units.forEach(u => {
                        if (u.ownerId === playerId) {
                            u.health = u.maxHealth;
                        }
                    });
                    this.map.islands.forEach(i => {
                        i.buildings.forEach(b => {
                            if (b.ownerId === playerId) b.health = b.maxHealth;
                        });
                    });
                }
                return `God Mode ${player.godMode ? 'ENABLED' : 'DISABLED'}`;

            case 'money':
            case 'cash':
                player.resources.gold += 10000;
                return `Added 10,000 Gold. Current: ${player.resources.gold}`;

            case 'fuel':
                player.resources.oil += 5000;
                return `Added 5,000 Oil. Current: ${player.resources.oil}`;

            case 'help':
            case 'list':
            case 'cheats':
                return 'Available Cheats: /gold [amt], /oil [amt], /setgold [amt], /setoil [amt], /god, /money, /fuel';

            default:
                return 'Unknown cheat command. Try /help or /cheats';
        }
    }

    moveUnitsToPosition(playerId: string, unitIds: string[], x: number, y: number) {
        // console.log(`[Move] Request from ${playerId} for ${unitIds.length} units to ${x},${y}`);

        // Check for Loading into Carrier/Mothership
        const targetCarrier = this.units.find(u =>
            ['aircraft_carrier', 'mothership', 'ferry', 'humvee'].includes(u.type) &&
            u.ownerId === playerId &&
            Math.hypot(u.x - x, u.y - y) < 60
        );

        if (targetCarrier) {
            // If the selection is ONLY the carrier itself, treat this as a move command, not a load command.
            // This allows moving the carrier small distances (clicking on/near itself).
            const isSelfClick = unitIds.length === 1 && unitIds[0] === targetCarrier.id;

            if (!isSelfClick) {
                // Attempt to load units
                const unitsToLoad = unitIds.map(id => this.units.find(u => u.id === id)).filter(u => u && u.ownerId === playerId) as Unit[];

                let loadedSomething = false;
                unitsToLoad.forEach(unit => {
                    // Prevent loading into self
                    if (unit.id === targetCarrier.id) return;

                    const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unit.type);
                    // Allow land units to load into carriers/ferries
                    // Humvees can only carry soldiers/snipers/rocketeers
                    if (targetCarrier.type === 'humvee' && !['soldier', 'sniper', 'rocketeer'].includes(unit.type)) return;

                    if (!isLandUnit) return;

                    // Check capacity
                    const capacity = targetCarrier.type === 'humvee' ? 4 : 20;
                    if (!targetCarrier.cargo) targetCarrier.cargo = [];
                    if (targetCarrier.cargo.length >= capacity) return;

                    // Load
                    targetCarrier.cargo.push(unit);

                    // Remove from world
                    const idx = this.units.findIndex(u => u.id === unit.id);
                    if (idx !== -1) this.units.splice(idx, 1);
                    loadedSomething = true;
                });

                // Only stop movement if we actually tried to load something (or if the intent was clearly loading)
                // If we selected a bunch of units and clicked a carrier, we assume loading.
                // If we selected a carrier AND other units, and clicked the carrier, we load the others. The carrier stays?
                // Existing logic returned immediately.
                return;
            }
        }

        unitIds.forEach(uid => {
            const unit = this.units.find(u => u.id === uid);
            if (unit && unit.ownerId === playerId) {
                const adjusted = this.adjustTarget(unit.type, x, y);
                const isAirUnit = ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(unit.type);
                const isWaterUnit = ['ferry', 'construction_ship', 'destroyer', 'pirate_ship', 'oil_tanker', 'aircraft_carrier'].includes(unit.type);
                const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unit.type);

                if (isAirUnit) {
                    // Air units fly directly
                    unit.targetX = adjusted.x;
                    unit.targetY = adjusted.y;
                    unit.targetIslandId = undefined;
                    unit.status = 'moving';
                    return;
                }

                if (isWaterUnit) {
                    unit.targetX = adjusted.x;
                    unit.targetY = adjusted.y;
                    unit.targetIslandId = undefined;
                    unit.status = 'moving';
                    return;
                }

                if (isLandUnit) {
                    // Check if moving to a different island
                    const currentIsland = this.map.islands.find(i => {
                        if (i.points) {
                            // Check if point is inside OR within buffer
                            if (MapGenerator.isPointInPolygon(unit.x, unit.y, i.points)) return true;
                            const closest = MapGenerator.getClosestPointOnPolygon(unit.x, unit.y, i.points);
                            return Math.hypot(unit.x - closest.x, unit.y - closest.y) < 40;
                        }
                        return Math.hypot(unit.x - i.x, unit.y - i.y) <= i.radius + 40;
                    });
                    const targetIsland = this.map.islands.find(i => {
                        if (i.points) {
                            if (MapGenerator.isPointInPolygon(adjusted.x, adjusted.y, i.points)) return true;
                            const closest = MapGenerator.getClosestPointOnPolygon(adjusted.x, adjusted.y, i.points);
                            return Math.hypot(adjusted.x - closest.x, adjusted.y - closest.y) < 40;
                        }
                        return Math.hypot(adjusted.x - i.x, adjusted.y - i.y) <= i.radius + 40;
                    });

                    if (unit.type === 'builder') {
                        // console.log(`[MoveDebug] Builder ${unit.id} on ${currentIsland?.id} target ${targetIsland?.id}`);
                    }

                    if (currentIsland && targetIsland && currentIsland.id !== targetIsland.id) {
                        // Moving between different islands

                        const islandPath = this.findIslandPath(currentIsland.id, targetIsland.id);
                        if (!islandPath) {
                            // If no path, move to the edge of the current island closest to the target
                            if (currentIsland.points) {
                                const closest = MapGenerator.getClosestPointOnPolygon(adjusted.x, adjusted.y, currentIsland.points);
                                const angle = Math.atan2(closest.y - currentIsland.y, closest.x - currentIsland.x);
                                unit.targetX = closest.x - Math.cos(angle) * 5;
                                unit.targetY = closest.y - Math.sin(angle) * 5;
                            } else {
                                const angle = Math.atan2(adjusted.y - currentIsland.y, adjusted.x - currentIsland.x);
                                unit.targetX = currentIsland.x + Math.cos(angle) * (currentIsland.radius - 10);
                                unit.targetY = currentIsland.y + Math.sin(angle) * (currentIsland.radius - 10);
                            }
                            unit.targetIslandId = undefined;
                            unit.status = 'moving';
                            return;
                        }
                    }

                    // Handle Stuck Units (Not on island and not on bridge)
                    // Only if NOT moving to a valid island (if we clicked land, just go there)
                    if (!currentIsland && !targetIsland) {
                        const onBridge = this.isPointOnBridge(unit.x, unit.y);
                        if (!onBridge) {
                            // Fallback: If unit is stuck (not on island/bridge), allow it to move to closest island if close enough
                            const closestIsland = this.map.islands.find(i => Math.hypot(unit.x - i.x, unit.y - i.y) < i.radius + 60);
                            if (closestIsland) {
                                // Allow move to this island
                                const angle = Math.atan2(unit.y - closestIsland.y, unit.x - closestIsland.x);
                                unit.targetX = closestIsland.x + Math.cos(angle) * (closestIsland.radius - 10);
                                unit.targetY = closestIsland.y + Math.sin(angle) * (closestIsland.radius - 10);
                                unit.status = 'moving';
                                return;
                            }
                        }
                    }
                }

                unit.targetX = adjusted.x;
                unit.targetY = adjusted.y;
                unit.targetIslandId = undefined; // Direct move
                unit.status = 'moving';

                if (!this.isValidPosition(adjusted.x, adjusted.y, unit.type)) {
                    console.log(`[Move] WARNING: Target ${adjusted.x.toFixed(1)},${adjusted.y.toFixed(1)} is INVALID for ${unit.type}!`);
                } else {
                    // console.log(`[Move] Unit ${unitIds[0]} moving to ${adjusted.x.toFixed(1)},${adjusted.y.toFixed(1)}`);
                }
            }
        });
    }

    handleMoveIntent(playerId: string, unitId: string, intentId: string, x: number, y: number) {
        const unit = this.units.find(u => u.id === unitId);
        if (!unit || unit.ownerId !== playerId) return;

        // Update Intent
        unit.intentId = intentId;

        // Reuse existing logic for target validation/setting
        this.moveUnitsToPosition(playerId, [unitId], x, y);
    }

    // handleMoveSteer removed (Steering logic deprecated)

    private logWallPair(
        playerId: string,
        nodeAId: string,
        nodeBId: string,
        type: 'bridge' | 'wall' | 'unknown',
        dist: number | null,
        maxDist: number | null,
        ok: boolean,
        reason: string
    ) {
        const distStr = dist !== null && !isNaN(dist) ? dist.toFixed(1) : 'NaN';
        const maxStr = maxDist !== null && !isNaN(maxDist) ? maxDist.toFixed(1) : 'NaN';
        console.log(
            `[WALL_PAIR] bot=${playerId} type=${type} A=${nodeAId} B=${nodeBId} dist=${distStr} maxDist=${maxStr} ok=${ok} reason=${reason}`
        );
    }

    ensureWallLoop(ownerId: string, nodeIdsOrdered: string[]) {
        const player = this.players.get(ownerId);
        if (!player) {
            console.log(
                `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${nodeIdsOrdered.length} segs=0 created=0 failed=${nodeIdsOrdered.length} reason=NO_PLAYER`
            );
            return { createdCount: 0, existingCount: 0, failedCount: nodeIdsOrdered.length };
        }

        const nodeEntries: { node: any; island: any }[] = [];
        const seenIds = new Set<string>();

        this.map.islands.forEach(island => {
            island.buildings.forEach(b => {
                if (b.type === 'wall_node' && b.ownerId === ownerId && b.id && nodeIdsOrdered.includes(b.id)) {
                    if (!seenIds.has(b.id)) {
                        seenIds.add(b.id);
                        nodeEntries.push({ node: b, island });
                    }
                }
            });
        });

        if (nodeEntries.length < 2) {
            console.log(
                `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${nodeEntries.length} segs=0 created=0 failed=${nodeEntries.length} reason=INSUFFICIENT_NODES`
            );
            return { createdCount: 0, existingCount: 0, failedCount: nodeEntries.length };
        }

        let centerX = 0;
        let centerY = 0;
        let centerCount = 0;

        const baseIsland = this.map.islands.find(i =>
            i.buildings.some(b => b.type === 'base' && b.ownerId === ownerId)
        );
        if (baseIsland) {
            const base = baseIsland.buildings.find(b => b.type === 'base' && b.ownerId === ownerId);
            if (base) {
                centerX = baseIsland.x + (base.x || 0);
                centerY = baseIsland.y + (base.y || 0);
                centerCount = 1;
            }
        }

        if (centerCount === 0) {
            nodeEntries.forEach(e => {
                centerX += e.island.x + (e.node.x || 0);
                centerY += e.island.y + (e.node.y || 0);
            });
            centerX /= nodeEntries.length;
            centerY /= nodeEntries.length;
        }

        const sorted = nodeEntries
            .map(e => {
                const wx = e.island.x + (e.node.x || 0);
                const wy = e.island.y + (e.node.y || 0);
                const angle = Math.atan2(wy - centerY, wx - centerX);
                return { node: e.node, island: e.island, angle };
            })
            .sort((a, b) => a.angle - b.angle);

        const orderedIds = sorted.map(s => s.node.id as string);
        console.log(
            `[WALL_LOOP_SET] bot=${ownerId} N=${orderedIds.length} center=${centerX.toFixed(1)},${centerY.toFixed(1)}`
        );

        let createdCount = 0;
        let existingCount = 0;
        let failedCount = 0;

        const expectedPairs: { a: string; b: string }[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i].node;
            const next = sorted[(i + 1) % sorted.length].node;
            if (current.id && next.id) expectedPairs.push({ a: current.id, b: next.id });
        }

        for (const p of expectedPairs) {
            const before = this.map.bridges.some(
                b =>
                    b.ownerId === ownerId &&
                    b.type === 'wall' &&
                    ((b.nodeAId === p.a && b.nodeBId === p.b) || (b.nodeAId === p.b && b.nodeBId === p.a))
            );

            this.connectNodes(ownerId, p.a, p.b);

            const after = this.map.bridges.some(
                b =>
                    b.ownerId === ownerId &&
                    b.type === 'wall' &&
                    ((b.nodeAId === p.a && b.nodeBId === p.b) || (b.nodeAId === p.b && b.nodeBId === p.a))
            );

            if (after && !before) {
                createdCount++;
            } else if (after && before) {
                existingCount++;
            } else {
                failedCount++;
            }
        }

        const segs = createdCount + existingCount;
        console.log(
            `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${sorted.length} segs=${segs} created=${createdCount} failed=${failedCount}`
        );

        return { createdCount, existingCount, failedCount };
    }

    connectNodes(playerId: string, nodeAId: string, nodeBId: string) {
        const player = this.players.get(playerId);
        if (!player) {
            this.logWallPair(playerId, nodeAId, nodeBId, 'unknown', null, null, false, 'NO_PLAYER');
            return;
        }

        const nodeAContext = this.getNodeContext(nodeAId);
        const nodeBContext = this.getNodeContext(nodeBId);
        const nodeA = nodeAContext?.node;
        const nodeB = nodeBContext?.node;

        if (!nodeAContext || !nodeBContext || !nodeA || !nodeB) {
            this.logWallPair(playerId, nodeAId, nodeBId, 'unknown', null, null, false, 'INVALID_NODE');
            return;
        }

        const isBridge = nodeA.type === 'bridge_node' && nodeB.type === 'bridge_node';
        const isWall = nodeA.type === 'wall_node' && nodeB.type === 'wall_node';
        const type: 'bridge' | 'wall' = isBridge ? 'bridge' : 'wall';

        if (!isBridge && !isWall) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'INVALID_TYPE');
            return;
        }

        if (nodeA.ownerId !== playerId || nodeB.ownerId !== playerId) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'NOT_OWNED');
            return;
        }

        if (isWall && (!nodeAContext.islandId || !nodeBContext.islandId)) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'WALL_REQUIRES_LAND');
            return;
        }

        if (isBridge) {
            const nodeADegree = this.getBridgeNodeDegree(nodeAId);
            const nodeBDegree = this.getBridgeNodeDegree(nodeBId);
            if (nodeADegree >= 2 || nodeBDegree >= 2) {
                this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'CHAIN_BRANCH_BLOCKED');
                return;
            }
            if (this.hasBridgeNodePath(nodeAId, nodeBId)) {
                this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'CHAIN_LOOP_BLOCKED');
                return;
            }
        }

        const ax = nodeAContext.x;
        const ay = nodeAContext.y;
        const bx = nodeBContext.x;
        const by = nodeBContext.y;
        const dist = Math.hypot(ax - bx, ay - by);

        const maxDist = isBridge ? 800 : 999999;
        if (dist > maxDist) {
            console.log(
                `[WALL_LINK] player=${playerId} type=${type} a=${nodeAId} b=${nodeBId} dist=${dist.toFixed(
                    1
                )} maxAllowed=${maxDist} result=FAIL`
            );
            this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'TOO_FAR');
            return;
        }

        const costPerPx = isBridge ? 0.2 : 0.1;
        const cost = Math.floor(dist * costPerPx);

        if (player.resources.gold < cost) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'INSUFFICIENT_GOLD');
            return;
        }

        const existing = this.map.bridges.find(b =>
            (b.nodeAId === nodeAId && b.nodeBId === nodeBId) ||
            (b.nodeAId === nodeBId && b.nodeBId === nodeAId)
        );
        if (existing) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'ALREADY_CONNECTED');
            return;
        }

        // Intersection check (Segment-Segment)
        const intersect = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
            const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
            if (denom === 0) return false;
            const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
            const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
            // Strict intersection to allow shared endpoints
            return (ua > 0.01 && ua < 0.99) && (ub > 0.01 && ub < 0.99);
        };

        const overlap = this.map.bridges.some(b => {
            const endpoints = this.getBridgeEndpoints(b);
            if (!endpoints) return false;

            return intersect(ax, ay, bx, by, endpoints.ax, endpoints.ay, endpoints.bx, endpoints.by);
        });

        if (overlap) {
            this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'SEGMENT_INTERSECTS');
            return;
        }

        player.resources.gold -= cost;

        this.map.bridges.push({
            id: `bridge_${Date.now()}_${Math.random()}`,
            type,
            nodeAId,
            nodeBId,
            islandAId: nodeAContext.islandId,
            islandBId: nodeBContext.islandId,
            ownerId: playerId,
            health: 500,
            maxHealth: 500
        });

        console.log(
            `[WALL_LINK] player=${playerId} type=${type} a=${nodeAId} b=${nodeBId} dist=${dist.toFixed(
                1
            )} maxAllowed=${maxDist} result=OK`
        );
        this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, true, 'OK');

        // Clear path cache as connectivity changed
        this.clearTraversalCaches();
    }

    convertWallToGate(playerId: string, nodeAId: string, nodeBId: string) {
        const bridge = this.map.bridges.find(b =>
            (b.nodeAId === nodeAId && b.nodeBId === nodeBId) ||
            (b.nodeAId === nodeBId && b.nodeBId === nodeAId)
        );

        if (!bridge || bridge.ownerId !== playerId) return;
        if (bridge.type !== 'wall') return; // Can only convert walls

        // Cost check? Let's say 50 gold to upgrade
        const player = this.players.get(playerId);
        if (!player || player.resources.gold < 50) return;

        player.resources.gold -= 50;
        bridge.type = 'gate';
    }

    // Pathfinding Cache
    private pathCache: Map<string, string[]> = new Map();

    findIslandPath(startIslandId: string, endIslandId: string): string[] | null {
        const cacheKey = `${startIslandId}-${endIslandId}`;
        if (this.pathCache.has(cacheKey)) {
            return this.pathCache.get(cacheKey)!;
        }

        const traversalPath = this.findIslandTraversalPath(startIslandId, endIslandId);
        if (!traversalPath) return null;

        const islandPath = traversalPath
            .filter(token => token.startsWith('island:'))
            .map(token => token.slice('island:'.length))
            .filter((islandId, index, array) => index === 0 || islandId !== array[index - 1]);

        this.pathCache.set(cacheKey, islandPath);
        return islandPath;
    }

    adjustTarget(unitType: string, targetX: number, targetY: number): { x: number, y: number } {
        // Safety check for NaN
        if (isNaN(targetX) || isNaN(targetY)) {
            return { x: 0, y: 0 }; // Default safe fallback
        }

        const isAirUnit = ['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(unitType);
        if (isAirUnit) {
            // Air units ignore obstacles and terrain snapping, just stay in bounds
            const clampedX = Math.max(0, Math.min(this.map.width, targetX));
            const clampedY = Math.max(0, Math.min(this.map.height, targetY));
            return { x: clampedX, y: clampedY };
        }

        // Check High Ground Collision (Obstacles) - Snap OUT of them
        if (this.map.highGrounds) {
            for (const hg of this.map.highGrounds) {
                if (MapGenerator.isPointInPolygon(targetX, targetY, hg.points)) {
                    // Snap to closest edge
                    const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, hg.points);
                    // Vector from obstacle center to point to push OUT
                    const angle = Math.atan2(closest.y - hg.y, closest.x - hg.x);
                    // Push out by 10px
                    targetX = closest.x + Math.cos(angle) * 10;
                    targetY = closest.y + Math.sin(angle) * 10;
                    break; // Handled
                }
            }
        }

        const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unitType);

        // Find closest island
        let closestIsland: Island | null = null;
        let minDist = Infinity;

        this.map.islands.forEach(island => {
            const dist = Math.hypot(targetX - island.x, targetY - island.y);
            const distToEdge = dist - island.radius;
            if (distToEdge < minDist) {
                minDist = distToEdge;
                closestIsland = island;
            }
        });

        if (!closestIsland) return { x: targetX, y: targetY }; // Should ideally snap to something

        // Check bridges for land units
        if (isLandUnit) {
            const onBridge = this.map.bridges.some(bridge => {
                if (bridge.type !== 'bridge') return false;
                const endpoints = this.getBridgeEndpoints(bridge);
                if (!endpoints) return false;
                const { ax, ay, bx, by } = endpoints;

                const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
                if (l2 === 0) return false;
                let t = ((targetX - ax) * (bx - ax) + (targetY - ay) * (by - ay)) / l2;
                t = Math.max(0, Math.min(1, t));
                const px = ax + t * (bx - ax);
                const py = ay + t * (by - ay);

                const distToSegment = Math.hypot(targetX - px, targetY - py);
                return distToSegment < 25; // Bridge width/2 + margin
            });

            if (onBridge) return { x: targetX, y: targetY };
        }

        const island = closestIsland as Island;
        const dx = targetX - island.x;
        const dy = targetY - island.y;
        const distFromCenter = Math.hypot(dx, dy);

        if (isLandUnit) {
            // If on water (outside radius), snap to edge
            if (island.points) {
                if (!MapGenerator.isPointInPolygon(targetX, targetY, island.points)) {
                    const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, island.points);
                    const dist = Math.hypot(targetX - closest.x, targetY - closest.y);

                    // Always snap to edge (pushed in slightly) if outside
                    const angle = Math.atan2(closest.y - island.y, closest.x - island.x);
                    return {
                        x: closest.x - Math.cos(angle) * 20,
                        y: closest.y - Math.sin(angle) * 20
                    };
                }
            } else if (distFromCenter > island.radius) {
                const angle = Math.atan2(dy, dx);
                return {
                    x: island.x + Math.cos(angle) * (island.radius - 20),
                    y: island.y + Math.sin(angle) * (island.radius - 20)
                };
            }
        } else {
            // Water units
            // If on land (inside radius), snap to edge
            if (island.points) {
                if (MapGenerator.isPointInPolygon(targetX, targetY, island.points)) {
                    const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, island.points);
                    const angle = Math.atan2(closest.y - island.y, closest.x - island.x);
                    return {
                        x: closest.x + Math.cos(angle) * 15,
                        y: closest.y + Math.sin(angle) * 15
                    };
                }
            } else if (distFromCenter < island.radius) {
                const angle = Math.atan2(dy, dx);
                return {
                    x: island.x + Math.cos(angle) * (island.radius + 15),
                    y: island.y + Math.sin(angle) * (island.radius + 15)
                };
            }
        }

        return { x: targetX, y: targetY };
    }

    // --- Spatial Grid Helpers ---
    private updateGrid() {
        this.grid.clear();
        this.units.forEach(u => {
            const gx = Math.floor(u.x / this.cellSize);
            const gy = Math.floor(u.y / this.cellSize);
            const key = `${gx},${gy}`;
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key)!.push(u);
        });
    }

    private getNearbyUnits(x: number, y: number, radius: number): Unit[] {
        const results: Unit[] = [];
        const startX = Math.floor((x - radius) / this.cellSize);
        const endX = Math.floor((x + radius) / this.cellSize);
        const startY = Math.floor((y - radius) / this.cellSize);
        const endY = Math.floor((y + radius) / this.cellSize);

        for (let gx = startX; gx <= endX; gx++) {
            for (let gy = startY; gy <= endY; gy++) {
                const cell = this.grid.get(`${gx},${gy}`);
                if (cell) {
                    for (const u of cell) {
                        const d2 = (u.x - x) ** 2 + (u.y - y) ** 2;
                        if (d2 <= radius ** 2) {
                            results.push(u);
                        }
                    }
                }
            }
        }
        return results;
    }

    applyUnitSeparation() {
        const getRadius = (type: string) => {
            if (type === 'mothership') return 60;
            if (type === 'aircraft_carrier') return 30;
            if (['tank', 'humvee', 'missile_launcher', 'heavy_plane', 'oil_rig'].includes(type)) return 20;
            return 15;
        };

        const getMass = (type: string) => {
            if (['oil_rig', 'oil_well'].includes(type)) return 10000;
            if (['mothership', 'aircraft_carrier'].includes(type)) return 100;
            if (['tank', 'heavy_plane', 'destroyer', 'pirate_ship', 'construction_ship'].includes(type)) return 40;
            if (['humvee', 'ferry', 'light_plane', 'missile_launcher'].includes(type)) return 20;
            return 10;
        };

        this.updateGrid();

        for (let i = 0; i < this.units.length; i++) {
            const u1 = this.units[i];
            const r1 = getRadius(u1.type);
            const m1 = getMass(u1.type);
            if (m1 >= 1000) continue;

            // Check only nearby grid cells
            const gx = Math.floor(u1.x / this.cellSize);
            const gy = Math.floor(u1.y / this.cellSize);

            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const cell = this.grid.get(`${gx + ox},${gy + oy}`);
                    if (!cell) continue;

                    for (const u2 of cell) {
                        if (u1 === u2) continue;

                        const r2 = getRadius(u2.type);
                        const m2 = getMass(u2.type);
                        const sep = r1 + r2;

                        // Category filters
                        const isU1Land = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'missile_launcher', 'oil_seeker'].includes(u1.type);
                        const isU2Land = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'missile_launcher', 'oil_seeker'].includes(u2.type);
                        const isU1Air = ['light_plane', 'heavy_plane', 'mothership'].includes(u1.type);
                        const isU2Air = ['light_plane', 'heavy_plane', 'mothership'].includes(u2.type);
                        const isU1Water = ['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(u1.type);
                        const isU2Water = ['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(u2.type);

                        if (isU1Land && !isU2Land) continue;
                        if (isU1Air && !isU2Air) continue;
                        if (isU1Water && !isU2Water) continue;

                        const dx = u1.x - u2.x;
                        const dy = u1.y - u2.y;
                        const d2 = dx * dx + dy * dy;

                        if (d2 < sep * sep && d2 > 0.001) {
                            const dist = Math.sqrt(d2);
                            const overlap = sep - dist;
                            if (overlap <= 5.0) continue;

                            const nx = dx / dist;
                            const ny = dy / dist;
                            const totalMass = m1 + m2;
                            const push = overlap * 0.5;

                            const p1 = Math.min(push * (m2 / totalMass), 4.0);
                            const nextX1 = u1.x + nx * p1;
                            const nextY1 = u1.y + ny * p1;
                            if (this.isValidPosition(nextX1, nextY1, u1.type)) {
                                u1.x = nextX1;
                                u1.y = nextY1;
                            }
                        }
                    }
                }
            }
        }
    }

    resolveCombat(io: any, roomId: string) {
        const now = Date.now();
        const getLayer = (type: string) => {
            const stats = UnitData[type];
            if (stats?.height === 2) return 'AIR_2';
            if (stats?.height === 1) return 'AIR_1';
            if (type === 'mothership') return 'AIR_2';
            if (['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(type)) return 'AIR_1';
            return 'GROUND';
        };

        const canHit = (atkType: string, tarType: string) => {
            const tarLayer = getLayer(tarType);
            if (tarLayer === 'AIR_2') {
                if (['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'aircraft_carrier', 'oil_tanker'].includes(atkType)) {
                    return !!UnitData[atkType]?.canAttackAir;
                }
                return ['missile_launcher', 'rocketeer', 'tower', 'base'].includes(atkType) || getLayer(atkType).startsWith('AIR') || !!UnitData[atkType]?.canAttackAir;
            }
            return true;
        };

        const getTargetPriority = (attackerType: string, targetType: string, isBuildingTarget: boolean): number => {
            const isAirAttacker = ['light_plane', 'heavy_plane', 'mothership'].includes(attackerType);
            const isProductionTarget = ['base', 'barracks', 'tank_factory', 'dock', 'air_base'].includes(targetType);
            const isEconomyTarget = ['mine', 'oil_rig', 'oil_well'].includes(targetType);
            const isNodeTarget = targetType === 'wall_node' || targetType === 'bridge_node';

            if (targetType === 'base') return 0;
            if (isProductionTarget) return 1;

            if (isAirAttacker && isNodeTarget) return 9;
            if (targetType === 'tower') return 2;
            if (isEconomyTarget) return 3;
            if (isNodeTarget) return 5;
            if (isBuildingTarget) return 4;
            return 2;
        };

        this.units.forEach(attacker => {
            const attackerOwner = this.players.get(attacker.ownerId);
            if (attackerOwner?.status === 'eliminated') return;

            if (attacker.type === 'mothership' && (attacker as any).laserTargetId) {
                const targetId = (attacker as any).laserTargetId;
                let targetUnit = this.units.find(u => u.id === targetId);
                let targetBuilding: any = null;
                let targetIsland: any = null;

                if (!targetUnit) {
                    for (const island of this.map.islands) {
                        const b = island.buildings.find(b => b.id === targetId);
                        if (b) { targetBuilding = b; targetIsland = island; break; }
                    }
                    if (!targetBuilding) {
                        const spot = this.map.oilSpots.find(s => s.occupiedBy === targetId);
                        if (spot) targetBuilding = (spot as any).building;
                    }
                }

                if (targetUnit) {
                    this.setUnitFacingFromVector(attacker, targetUnit.x - attacker.x, targetUnit.y - attacker.y);
                } else if (targetBuilding) {
                    let buildingX = 0;
                    let buildingY = 0;
                    if (targetIsland) {
                        buildingX = targetIsland.x + (targetBuilding.x || 0);
                        buildingY = targetIsland.y + (targetBuilding.y || 0);
                    } else {
                        const oilSpot = this.map.oilSpots.find(s => s.occupiedBy === targetBuilding.id);
                        if (oilSpot) {
                            buildingX = oilSpot.x;
                            buildingY = oilSpot.y;
                        }
                    }
                    this.setUnitFacingFromVector(attacker, buildingX - attacker.x, buildingY - attacker.y);
                }

                if (now > ((attacker as any).laserEndTime || 0) || (!targetUnit && !targetBuilding)) {
                    (attacker as any).laserTargetId = null;
                    attacker.lastAttackTime = now;
                } else if (now - ((attacker as any).lastLaserTick || 0) >= 100) {
                    (attacker as any).lastLaserTick = now;
                    const damage = 25;
                    if (targetUnit) {
                        if (!this.players.get(targetUnit.ownerId)?.godMode) targetUnit.health -= damage;
                    } else if (targetBuilding) {
                        this.damageBuilding(targetBuilding, damage);
                        if (targetBuilding.health <= 0) {
                            if (targetIsland) {
                                targetIsland.buildings = targetIsland.buildings.filter((b: any) => b.id !== targetBuilding.id);
                                if (targetBuilding.type === 'base' && targetBuilding.ownerId && this.shouldEliminateOnBaseLoss(targetBuilding.ownerId)) {
                                    this.eliminatePlayer(targetBuilding.ownerId, 'HQ_DESTROYED');
                                }
                                if (targetBuilding.type === 'mine') {
                                    const spot = targetIsland.goldSpots.find((s: any) => s.occupiedBy === targetBuilding.id);
                                    if (spot) spot.occupiedBy = undefined;
                                }
                            }
                            this.destroyOilStructureById(targetBuilding.id);
                        }
                    }
                }
                return;
            }

            if (attacker.damage <= 0) return;
            const onCooldown = !!(attacker.lastAttackTime && now - attacker.lastAttackTime < attacker.fireRate);

            // Spatial Lookup for units
            const nearbyEnemies = this.getNearbyUnits(attacker.x, attacker.y, attacker.range)
                .filter(u => u.ownerId !== attacker.ownerId && u.health > 0 && canHit(attacker.type, u.type));

            // Throttled building lookup (keep as is or optimize if needed, but buildings are fewer)
            let buildingsInRange: any[] = [];
            if (this.tickCounter % 5 === 0) { // Optimization: Only check buildings every few ticks
                this.map.islands.forEach(island => {
                    if (Math.hypot(island.x - attacker.x, island.y - attacker.y) > island.radius + attacker.range + 100) return;
                    island.buildings.forEach(b => {
                        if (b.ownerId && b.ownerId !== attacker.ownerId) {
                            const bx = island.x + (b.x || 0);
                            const by = island.y + (b.y || 0);
                            if (Math.hypot(bx - attacker.x, by - attacker.y) <= attacker.range) {
                                buildingsInRange.push({ ...b, realX: bx, realY: by, islandId: island.id });
                            }
                        }
                    });
                });
                this.map.oilSpots.forEach(spot => {
                    const b = (spot as any).building;
                    if (b && (spot as any).ownerId && (spot as any).ownerId !== attacker.ownerId) {
                        if (this.isOilStructureBackedByIslandBuilding(b)) return;
                        if (Math.hypot(spot.x - attacker.x, spot.y - attacker.y) <= attacker.range) {
                            buildingsInRange.push({ ...b, realX: spot.x, realY: spot.y, isOilBuilding: true });
                        }
                    }
                });
                (attacker as any).cachedBuildingsInRange = buildingsInRange;
            } else {
                buildingsInRange = (attacker as any).cachedBuildingsInRange || [];
            }

            if (attacker.type === 'missile_launcher') { /* nearbyEnemies = [] */ }
            let targets: any[] = [];
            if (attacker.type === 'missile_launcher') {
                targets = buildingsInRange;
            } else if (attacker.type === 'destroyer' || attacker.type === 'pirate_ship' || attacker.type === 'aircraft_carrier') {
                const baseTargets = buildingsInRange.filter(candidate => candidate.type === 'base');
                if (baseTargets.length > 0) {
                    targets = [...baseTargets, ...buildingsInRange];
                } else if (buildingsInRange.length > 0) {
                    targets = buildingsInRange;
                } else {
                    targets = nearbyEnemies;
                }
            } else {
                targets = [...nearbyEnemies, ...buildingsInRange];
            }

            if (targets.length > 0) {
                const target = targets.reduce((closest, curr) => {
                    const tx = ('realX' in curr) ? curr.realX : curr.x;
                    const ty = ('realY' in curr) ? curr.realY : curr.y;
                    const dist = Math.hypot(tx - attacker.x, ty - attacker.y);
                    const isBuildingTarget = 'realX' in curr || 'realY' in curr;
                    const priority = getTargetPriority(attacker.type, curr.type, isBuildingTarget);

                    if (!closest) return { t: curr, dist, priority };
                    if (priority < closest.priority) return { t: curr, dist, priority };
                    if (priority > closest.priority) return closest;
                    return dist < closest.dist ? { t: curr, dist, priority } : closest;
                }, null as { t: any, dist: number, priority: number } | null)?.t;

                const tx = ('realX' in target) ? target.realX : target.x;
                const ty = ('realY' in target) ? target.realY : target.y;
                this.setUnitFacingFromVector(attacker, tx - attacker.x, ty - attacker.y);

                if (onCooldown) {
                    return;
                }

                if (attacker.type === 'mothership') {
                    (attacker as any).laserTargetId = target.id;
                    (attacker as any).laserEndTime = now + 1000;
                    (attacker as any).lastLaserTick = now;
                    attacker.lastAttackTime = now;
                    io.to(roomId).emit('laserBeam', { attackerId: attacker.id, targetId: target.id, x1: attacker.x, y1: attacker.y, x2: tx, y2: ty, duration: 1000, color: 0x0088FF });
                } else if (attacker.type === 'aircraft_carrier') {
                    this.pendingProjectiles.push({ attackerId: attacker.id, x1: attacker.x, y1: attacker.y, x2: tx, y2: ty, type: 'rocket_missile', speed: 600 });
                    const aoe = 150;
                    this.units.forEach(u => {
                        if (u.ownerId !== attacker.ownerId && u.health > 0 && Math.hypot(u.x - tx, u.y - ty) <= aoe) {
                            if (!this.players.get(u.ownerId)?.godMode) u.health -= attacker.damage;
                        }
                    });
                    // Simplified building AoE for performance
                    this.map.islands.forEach(island => {
                        if (Math.hypot(island.x - tx, island.y - ty) > island.radius + aoe + 50) return;
                        island.buildings.forEach(b => {
                            if (b.ownerId && b.ownerId !== attacker.ownerId && Math.hypot(island.x + (b.x || 0) - tx, island.y + (b.y || 0) - ty) <= aoe) {
                                this.damageBuilding(b, attacker.damage);
                                if (b.health <= 0) {
                                    if (b.type === 'base' && b.ownerId && this.shouldEliminateOnBaseLoss(b.ownerId)) {
                                        this.eliminatePlayer(b.ownerId, 'HQ_DESTROYED');
                                    }
                                    if (b.type === 'mine') {
                                        const spot = island.goldSpots.find(s => s.occupiedBy === b.id);
                                        if (spot) spot.occupiedBy = undefined;
                                    }
                                    if (b.type === 'oil_rig' || b.type === 'oil_well') {
                                        this.destroyOilStructureById(b.id);
                                    }
                                    island.buildings = island.buildings.filter(build => build.id !== b.id);
                                }
                            }
                        });
                    });
                    attacker.lastAttackTime = now;
                } else if (attacker.type === 'rocketeer') {
                    this.pendingProjectiles.push({ attackerId: attacker.id, x1: attacker.x, y1: attacker.y, x2: tx, y2: ty, type: 'rocketeer_rocket', speed: 720 });
                    if ('realX' in target) {
                        const building = target.isOilBuilding ? (this.map.oilSpots.find(s => s.occupiedBy === target.id) as any)?.building : this.map.islands.find(i => i.id === target.islandId)?.buildings.find(b => b.id === target.id);
                        if (building) { this.damageBuilding(building, attacker.damage); attacker.lastAttackTime = now; }
                    } else {
                        if (!this.players.get(target.ownerId)?.godMode) target.health -= attacker.damage;
                        attacker.lastAttackTime = now;
                    }
                } else if (attacker.type === 'pirate_ship') {
                    this.pendingProjectiles.push({ attackerId: attacker.id, x1: attacker.x, y1: attacker.y, x2: tx, y2: ty, type: 'cannon_ball', speed: 560 });
                    if ('realX' in target) {
                        const building = target.isOilBuilding ? (this.map.oilSpots.find(s => s.occupiedBy === target.id) as any)?.building : this.map.islands.find(i => i.id === target.islandId)?.buildings.find(b => b.id === target.id);
                        if (building) { this.damageBuilding(building, attacker.damage); attacker.lastAttackTime = now; }
                    } else {
                        if (!this.players.get(target.ownerId)?.godMode) target.health -= attacker.damage;
                        attacker.lastAttackTime = now;
                    }
                } else {
                    this.pendingProjectiles.push({ attackerId: attacker.id, x1: attacker.x, y1: attacker.y, x2: tx, y2: ty, type: 'bullet', speed: 800 });
                    if ('realX' in target) {
                        const building = target.isOilBuilding ? (this.map.oilSpots.find(s => s.occupiedBy === target.id) as any)?.building : this.map.islands.find(i => i.id === target.islandId)?.buildings.find(b => b.id === target.id);
                        if (building) { this.damageBuilding(building, attacker.damage); attacker.lastAttackTime = now; }
                    } else {
                        if (!this.players.get(target.ownerId)?.godMode) target.health -= attacker.damage;
                        attacker.lastAttackTime = now;
                    }
                }
            }
        });

        // Simplified Tower Logic
        this.map.islands.forEach(island => {
            island.buildings.forEach(b => {
                if (!b.ownerId) return;
                const buildingOwner = this.players.get(b.ownerId);
                if (buildingOwner?.status === 'eliminated') return;
                let stats = BuildingData[b.type];
                if (b.type === 'base' && b.hasTesla) stats = { ...stats, range: 400, damage: 100, fireRate: 500 };
                if (!stats?.damage || (b.lastAttackTime && now - b.lastAttackTime < (stats.fireRate || 1000))) return;

                const bx = island.x + (b.x || 0);
                const by = island.y + (b.y || 0);
                const target = this.getNearbyUnits(bx, by, stats.range!).find(u => u.ownerId !== b.ownerId && canHit(b.type, u.type));

                if (target) {
                    if (!this.players.get(target.ownerId)?.godMode) target.health -= stats.damage!;
                    b.lastAttackTime = now;
                    io.to(roomId).emit('projectile', { x1: bx, y1: by, x2: target.x, y2: target.y, type: (b.type === 'base' && b.hasTesla) ? 'tesla' : 'bullet', speed: (b.type === 'base' && b.hasTesla) ? 1500 : 800 });
                }
            });
        });

        this.units = this.units.filter(u => {
            if (u.health <= 0) {
                // If transport dies, log cargo loss
                if (u.cargo && u.cargo.length > 0) {
                    console.log(`[Death] Transport ${u.type} (${u.id}) destroyed with ${u.cargo.length} units inside.`);
                    u.cargo.forEach(c => console.log(`   - Cargo Lost: ${c.type} (${c.id})`));
                } else {
                    console.log(`[Death] Unit ${u.type} (${u.id}) died.`);
                }
                return false;
            }
            return true;
        });
    }

    loadUnits(playerId: string, transportId: string, unitIds: string[]) {
        const transport = this.units.find(u => u.id === transportId);
        if (!transport || transport.ownerId !== playerId) return;
        if (!['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(transport.type)) return;

        if (!transport.cargo) transport.cargo = [];

        unitIds.forEach(uid => {
            const unitIndex = this.units.findIndex(u => u.id === uid);
            if (unitIndex === -1) return;
            const unit = this.units[unitIndex];

            if (unit.ownerId !== playerId) return;

            const isInfantry = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(unit.type);
            const isVehicle = ['tank', 'humvee', 'missile_launcher'].includes(unit.type);

            if (['ferry', 'humvee'].includes(transport.type)) {
                if (!isInfantry) return;
            } else if (['aircraft_carrier', 'mothership'].includes(transport.type)) {
                // Carriers and Motherships can carry infantry and vehicles
                if (!isInfantry && !isVehicle) return;
            }

            // Check distance
            if (Math.hypot(unit.x - transport.x, unit.y - transport.y) > 100) return; // Must be close

            let maxCapacity = 10;
            if (transport.type === 'humvee') maxCapacity = 4;
            if (['aircraft_carrier', 'mothership'].includes(transport.type)) maxCapacity = 20;

            if (transport.cargo!.length >= maxCapacity) return; // Max capacity

            // Add to cargo
            transport.cargo!.push(unit);

            // Remove from world
            this.units.splice(unitIndex, 1);
        });

        // Update clients
        // We rely on the main loop emitting 'unitsData'
    }

    unloadUnits(playerId: string, transportId: string, targetX: number, targetY: number) {
        const transport = this.units.find(u => u.id === transportId);
        if (!transport || transport.ownerId !== playerId) return;
        if (!['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(transport.type)) return;
        if (!transport.cargo || transport.cargo.length === 0) return;

        // Check range to target
        if (Math.hypot(targetX - transport.x, targetY - transport.y) > transport.range) return;

        // For air transports, we allow unloading at a distance (drop) but it must be valid land
        // For ground transports, target must be reachable?
        // Existing logic used 'soldier' check. We should check each unit type?
        // Or just check 'soldier' as a proxy for "is this land"?
        // Let's use 'tank' for vehicles if we want to be strict, but 'soldier' is generally fine for land check.
        // However, isValidPosition takes unit type for collision radius check.

        // We'll check the FIRST unit's validity as a proxy for the drop zone
        const sampleUnit = transport.cargo[0];
        const isValid = this.isValidPosition(targetX, targetY, sampleUnit.type);
        if (!isValid) {
            console.log(`[Unload] Failed: Invalid position for ${sampleUnit.type} at ${targetX},${targetY}`);
            return;
        }

        // ... existing bridge logic ...
        // We calculate isLand locally or assume if isValid is true and getBridgeAt is true, we might be on bridge.
        // Let's re-verify isLand to be safe, or just prefer bridge spread if on bridge.
        // If we are on an island, bridge spread is still safe (just linear).
        // But let's check strict bridge-only case if possible.
        // Re-using logic from isValidPosition:
        const closestIsland = this.map.islands.reduce((closest, island) => {
            const dist = Math.hypot(targetX - island.x, targetY - island.y) - island.radius;
            if (!closest || dist < closest.dist) return { island, dist };
            return closest;
        }, null as { island: any, dist: number } | null);

        const isLand = closestIsland && closestIsland.dist <= 0;
        const bridgeInfo = !isLand ? this.getBridgeAt(targetX, targetY) : null;

        // Unload all
        const spread = 20;
        transport.cargo.forEach((unit) => {
            if (bridgeInfo) {
                // Constrain spread to bridge axis
                const dx = bridgeInfo.end.x - bridgeInfo.start.x;
                const dy = bridgeInfo.end.y - bridgeInfo.start.y;
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const nx = dx / len;
                    const ny = dy / len;

                    // Spread along length
                    const longSpread = (Math.random() - 0.5) * spread * 2;
                    // Spread across width (keep it tight, bridge is ~50 wide, use +/- 10 safe zone)
                    const wideSpread = (Math.random() - 0.5) * 15;

                    // Perpendicular vector (-ny, nx)
                    unit.x = targetX + (nx * longSpread) + (-ny * wideSpread);
                    unit.y = targetY + (ny * longSpread) + (nx * wideSpread);
                } else {
                    unit.x = targetX;
                    unit.y = targetY;
                }
            } else {
                unit.x = targetX + (Math.random() - 0.5) * spread;
                unit.y = targetY + (Math.random() - 0.5) * spread;
            }

            unit.status = 'idle';
            unit.targetX = undefined;
            unit.targetY = undefined;
            this.units.push(unit);
        });

        transport.cargo = [];
    }

    deleteEntities(playerId: string, entityIds: string[]) {
        entityIds.forEach(id => {
            // 1. Try to find and delete unit
            const unitIndex = this.units.findIndex(u => u.id === id);
            if (unitIndex !== -1) {
                const unit = this.units[unitIndex];
                if (unit.ownerId === playerId) {
                    this.units.splice(unitIndex, 1);
                    return;
                }
            }

            // 2. Try to find and delete building
            for (const island of this.map.islands) {
                const bIndex = island.buildings.findIndex(b => b.id === id);
                if (bIndex !== -1) {
                    const building = island.buildings[bIndex];
                    if (building.ownerId === playerId) {
                        // Anti-Exploit: HQ Deletion Rules
                        if (building.type === 'base') {
                            const elapsed = Date.now() - this.startTime;
                            if (elapsed < 60000) {
                                // < 60s: Disallow delete with warning
                                if (this.io && this.roomId) {
                                    // Send system message to player
                                    const socket = Array.from(this.io.sockets.sockets.values()).find((s: any) => s.id === playerId) as any;
                                    if (socket) {
                                        socket.emit('chat_message', {
                                            sender: 'System',
                                            content: '⚠️ HQ cannot be sold/deleted in the first 60 seconds!',
                                            timestamp: Date.now()
                                        });
                                    }
                                }
                                return; // Skip deletion
                            } else {
                                // > 60s: Allow delete -> Immediate Defeat
                                const player = this.players.get(playerId);
                                if (player) {
                                    player.canBuildHQ = false;
                                    // Trigger elimination (with specific reason)
                                    this.eliminatePlayer(playerId, 'HQ_SELF_DELETED');
                                }
                            }
                        }

                        island.buildings.splice(bIndex, 1);

                        // If it was a mine, free the gold spot
                        if (building.type === 'mine') {
                            const spot = island.goldSpots.find(s => s.occupiedBy === id);
                            if (spot) spot.occupiedBy = undefined;
                        }

                        // If it was an oil rig, free the oil spot
                        if (building.type === 'oil_rig' || building.type === 'oil_well') {
                            this.destroyOilStructureById(id);
                        }
                        return;
                    }
                }
            }

            // 3. Try to find and delete wall/bridge
            if (this.map.bridges) {
                const wIndex = this.map.bridges.findIndex(b => b.id === id);
                if (wIndex !== -1) {
                    const bridge = this.map.bridges[wIndex];
                    if (bridge.ownerId === playerId) {
                        this.map.bridges.splice(wIndex, 1);
                        this.clearTraversalCaches();
                        return;
                    }
                }
            }

            // 4. Try to find and delete a water building
            if (this.map.waterBuildings) {
                const waterBuildingIndex = this.map.waterBuildings.findIndex(building => building.id === id);
                if (waterBuildingIndex !== -1) {
                    const waterBuilding = this.map.waterBuildings[waterBuildingIndex];
                    if (waterBuilding.ownerId === playerId) {
                        if ((waterBuilding.type === 'bridge_node' || waterBuilding.type === 'wall_node') && waterBuilding.id) {
                            this.map.bridges = this.map.bridges.filter(bridge =>
                                bridge.nodeAId !== waterBuilding.id && bridge.nodeBId !== waterBuilding.id
                            );
                            this.clearTraversalCaches();
                        }
                        this.map.waterBuildings.splice(waterBuildingIndex, 1);
                        return;
                    }
                }
            }
        });
    }

    checkIslandCapture() {
        this.map.islands.forEach(island => {
            // Find units on this island
            const occupiers = this.units.filter(u => {
                if (island.points) return MapGenerator.isPointInPolygon(u.x, u.y, island.points);
                const dist = Math.hypot(u.x - island.x, u.y - island.y);
                return dist <= island.radius;
            });

            if (occupiers.length === 0) return;

            const owners = new Set(occupiers.map(u => u.ownerId));

            if (owners.size > 1) return; // Contested

            const occupierId = occupiers[0].ownerId;

            if (island.ownerId === occupierId) return;

            // Check for defenses
            const defenses = island.buildings.filter(b => b.type === 'tower' || b.type === 'base');
            if (defenses.length > 0) return;

            // Capture
            island.ownerId = occupierId;
        });
    }

    checkMatchEnd() {
        // Wait for game to settle (e.g. 10 seconds after start)
        if (Date.now() - this.startTime < 10000) return;
        if (this.matchState === 'ENDED') {
            if (this.playerCollapseStates.size === 0) {
                this.stopGameLoop();
            }
            return;
        }

        // Count active players (not eliminated)
        const activePlayers = Array.from(this.players.values()).filter(p => p.status !== 'eliminated');

        // If only 1 player remains (and there were originally > 1)
        if (activePlayers.length <= 1 && this.players.size > 1) {
            const winner = activePlayers[0];
            this.matchState = 'ENDED';
            this.winnerId = winner ? winner.id : null;
            this.endReason = 'ALL_ENEMIES_DEFEATED';

            console.log(`Match Ended! Winner: ${this.winnerId}`);

            if (this.io && this.roomId) {
                const payload = {
                    winnerPlayerId: this.winnerId,
                    eliminatedPlayerIds: Array.from(this.eliminatedPlayerIds),
                    endReason: this.endReason,
                    timestamp: Date.now()
                };

                // Emit legacy event for compatibility if needed
                this.io.to(this.roomId).emit('gameOver', {
                    winnerId: this.winnerId,
                    reason: 'elimination'
                });

                // Emit new authoritative event
                this.io.to(this.roomId).emit('MATCH_ENDED', payload);

                if (this.playerCollapseStates.size === 0) {
                    this.stopGameLoop();
                }
            }
        } else if (activePlayers.length === 0 && this.players.size > 0) {
            // Draw / Everyone died?
            this.matchState = 'ENDED';
            this.endReason = 'ALL_ENEMIES_DEFEATED'; // or DRAW?
            console.log(`Match Ended! Draw.`);
            if (this.io && this.roomId) {
                const payload = {
                    winnerPlayerId: null,
                    eliminatedPlayerIds: Array.from(this.eliminatedPlayerIds),
                    endReason: this.endReason,
                    timestamp: Date.now()
                };

                this.io.to(this.roomId).emit('gameOver', {
                    winnerId: null,
                    reason: 'draw'
                });

                this.io.to(this.roomId).emit('MATCH_ENDED', payload);

                if (this.playerCollapseStates.size === 0) {
                    this.stopGameLoop();
                }
            }
        }
    }

    eliminatePlayer(playerId: string, reason: string = 'HQ_DESTROYED') {
        const player = this.players.get(playerId);
        if (player && player.status !== 'eliminated') {
            player.status = 'eliminated';
            player.canBuildHQ = false;
            this.eliminatedPlayerIds.add(playerId);
            console.log(`Player ${playerId} eliminated! Reason: ${reason}`);

            // Clear island control immediately, but keep owned entities for collapse burn-down.
            this.map.islands.forEach(island => {
                if (island.ownerId === playerId) island.ownerId = undefined;
            });

            // Freeze player-controlled units and begin timed collapse (10s, 10% max HP per second).
            this.startPlayerAssetCollapse(playerId);

            // Check if this elimination triggers match end
            this.checkMatchEnd();

            if (this.matchState !== 'ENDED') {
                // If match is still running, emit just the elimination event
                if (this.io && this.roomId) {
                    this.io.to(this.roomId).emit('playerEliminated', { playerId, reason });
                }
            }

            // If Bot, stop AI
            const botIndex = this.bots.findIndex(b => b.playerId === playerId);
            if (botIndex !== -1) {
                this.bots.splice(botIndex, 1);
            }
        }
    }

    isPointOnBridge(x: number, y: number): boolean {
        return !!this.getBridgeAt(x, y);
    }

    getBridgeAt(x: number, y: number): { bridge: any, start: { x: number, y: number }, end: { x: number, y: number } } | null {
        if (!this.map.bridges) return null;

        for (const bridge of this.map.bridges) {
            if (bridge.type !== 'bridge') continue;

            const endpoints = this.getBridgeEndpoints(bridge);
            if (!endpoints) continue;
            const { ax, ay, bx, by } = endpoints;

            const closest = MapGenerator.getClosestPointOnSegment(x, y, ax, ay, bx, by);
            const distToSegment = Math.hypot(x - closest.x, y - closest.y);
            if (distToSegment < 25) { // Bridge width/2 + margin
                return { bridge, start: { x: ax, y: ay }, end: { x: bx, y: by } };
            }
        }
        return null;
    }

    // Helper to check if position is valid for unit type
    isValidPosition(x: number, y: number, type: string): boolean {
        const shouldLogValidPos = ENABLE_VALID_POSITION_LOGS && type === 'builder';
        // Map Boundary Check
        if (x < 0 || x > this.map.width || y < 0 || y > this.map.height) {
            if (shouldLogValidPos) console.log(`[ValidPos] Builder OUT OF BOUNDS: ${x},${y}`);
            return false;
        }

        // Check High Ground Collision (Obstacles)
        const isAirUnit = this.isAirUnitType(type);
        if (this.map.highGrounds && !isAirUnit) {
            for (const hg of this.map.highGrounds) {
                // Optimization: Bounding Box check
                if (x < hg.x - hg.radius || x > hg.x + hg.radius || y < hg.y - hg.radius || y > hg.y + hg.radius) continue;

                if (MapGenerator.isPointInPolygon(x, y, hg.points)) {
                    if (shouldLogValidPos) console.log(`[ValidPos] Builder HIT HIGH GROUND: ${x},${y}`);
                    return false; // Blocked for everyone
                }
            }
        }

        let isLand = false;

        for (const island of this.map.islands) {
            // Optimization: Bounding Box / Radius check
            if (x < island.x - island.radius - 50 || x > island.x + island.radius + 50 || y < island.y - island.radius - 50 || y > island.y + island.radius + 50) continue;

            if (island.points) {
                // Add buffer for movement to prevent getting stuck on edges
                // Check if point is inside OR within small distance of edge
                if (MapGenerator.isPointInPolygon(x, y, island.points)) {
                    isLand = true;
                    break;
                }
                // Buffer check (expensive but necessary for smooth movement near edges)
                // Only do it if we are very close to the center or radius
                const distToCenter = Math.hypot(x - island.x, y - island.y);
                if (distToCenter < island.radius + 10) {
                    const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
                    if (Math.hypot(x - closest.x, y - closest.y) < 1) { // Strict tolerance for invisible walls
                        isLand = true;
                        break;
                    }
                }
            } else {
                if (Math.hypot(x - island.x, y - island.y) <= island.radius) { // Strict radius
                    isLand = true;
                    break;
                }
            }
        }

        if (this.isLandUnitType(type)) {
            // Building Collision Check for Land Units
            // Find the island we are on (or moving to)
            const currentIsland = this.map.islands.find(i => {
                if (i.points) return MapGenerator.isPointInPolygon(x, y, i.points);
                return Math.hypot(x - i.x, y - i.y) <= i.radius + 15;
            });

            if (currentIsland) {
                // Check collision with buildings
                // Farm radius is 30. Most buildings are ~30-40.
                // We use a safe collision radius of 25 to prevent walking through center but allow getting close.
                const hitBuilding = currentIsland.buildings.some(b => {
                    if (b.type === 'bridge_node' || b.type === 'wall_node' || b.type === 'mine') return false;

                    // Base is larger (approx 50-60 radius visual)
                    // Farm is 30
                    // Others ~30
                    const bRadius = this.getBuildingCollisionRadius(b.type, type);
                    // Relaxed buffer for builders to prevent getting stuck/spawn failure
                    const buffer = type === 'builder' ? 2 : 5;

                    // Allow Builders to walk through OWN buildings to prevent getting stuck
                    if (type === 'builder') return false;

                    return Math.hypot(x - (currentIsland.x + (b.x || 0)), y - (currentIsland.y + (b.y || 0))) < bRadius + buffer;
                });

                if (hitBuilding) {
                    if (shouldLogValidPos) console.log(`[ValidPos] Builder HIT BUILDING on Island ${currentIsland.id}`);
                    return false;
                }
            }

            if (this.map.bridges && !['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(type)) {
                for (const bridge of this.map.bridges) {
                    if (bridge.type !== 'wall') continue;
                    const endpoints = this.getBridgeEndpoints(bridge);
                    if (!endpoints) continue;
                    const { ax, ay, bx, by } = endpoints;

                    const closest = MapGenerator.getClosestPointOnSegment(x, y, ax, ay, bx, by);
                    const distToWall = Math.hypot(x - closest.x, y - closest.y);
                    if (distToWall < 26) {
                        return false;
                    }
                }
            }

            const onBridge = this.isPointOnBridge(x, y);
            if (!isLand && !onBridge) {
                if (shouldLogValidPos) {
                    console.log(`[ValidPos] Builder IN WATER (Not Land, Not Bridge): ${x},${y}`);
                    const nearest = this.map.islands.map(i => ({
                        id: i.id,
                        dist: Math.hypot(x - i.x, y - i.y),
                        radius: i.radius,
                        hasPoints: !!i.points
                    })).sort((a, b) => a.dist - b.dist)[0];
                    console.log(`[ValidPos] Nearest Island: ${nearest.id} dist=${nearest.dist.toFixed(1)} rad=${nearest.radius} points=${nearest.hasPoints}`);
                }
                return false;
            }
            return true;
        } else if (['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(type)) {
            return !isLand;
        } else if (['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type)) {
            return true; // Air units can go anywhere
        }
        return true;
    }


    upgradeBuilding(playerId: string, buildingId: string): boolean {
        const player = this.players.get(playerId);
        if (!player) return false;

        for (const island of this.map.islands) {
            const building = island.buildings.find(b => b.id === buildingId);
            if (building) {
                if (building.ownerId !== playerId) return false;

                // Base Upgrade (Tier 2 / Tesla)
                if (building.type === 'base') {
                    if (player.resources.gold >= 500) {
                        player.resources.gold -= 500;
                        building.maxHealth *= 2;
                        building.health = building.maxHealth; // Heal on upgrade? Sure
                        building.hasTesla = true;
                        building.level = (building.level || 1) + 1;
                        return true;
                    }
                }
                // Add future upgrades here
                return false;
            }
        }
        return false;
    }

    startGameLoop(io: any, roomId: string) {
        this.io = io;
        this.roomId = roomId;
        this.lastTickTime = Date.now();
        this.economySecondAccumulator = 0;
        // Run loop at 20 Hz (50ms)
        this.gameLoopInterval = setInterval(() => {
            if (this.gameEnded) return;

            if (this.status === 'voting') {
                if (Date.now() >= this.voteEndTime) {
                    this.finalizeMapAndStart(io, roomId);
                } else {
                    io.to(roomId).emit('votingUpdate', {
                        timeLeft: Math.max(0, this.voteEndTime - Date.now()),
                        votes: Array.from(this.mapVotes.entries())
                    });
                }
                return;
            }

            if (this.status === 'waiting') {
                return;
            }

            const now = Date.now();
            const deltaTime = (now - this.lastTickTime) / 1000; // in seconds
            this.lastTickTime = now;

            // Debug movement
            // if (Math.random() < 0.05) {
            //     const mover = this.units.find(u => u.status === 'moving');
            //     if (mover) {
            //         console.log(`Unit ${mover.id} moving: speed=${mover.speed} dt=${deltaTime} pos=${mover.x.toFixed(1)},${mover.y.toFixed(1)} target=${mover.targetX},${mover.targetY}`);
            //     }
            // }

            // Bot Updates (Every tick, let bots throttle themselves)
            if (!this.requireHumanReadyForBotStart || this.botsReleasedForMatch) {
                this.bots.forEach(bot => {
                    try {
                        bot.update(this);
                    } catch (e) {
                        console.error(`Bot ${bot.playerId} update failed:`, e);
                    }
                });
            } else {
                this.bots.forEach(bot => {
                    bot.debugState.currentGoal = 'WAITING_FOR_PLAYERS';
                    bot.debugState.lastDecision = 'Holding until all human players finish match load';
                });
            }

            this.advanceEconomy(deltaTime);
            this.advanceConstructionRepairAndRecruitment(deltaTime);

            // Unit Movement Logic
            this.units.forEach(unit => {
                if (unit.status === 'moving') {
                    let targetX = unit.targetX;
                    let targetY = unit.targetY;

                    // NaN Safety Check
                    if (isNaN(unit.x) || isNaN(unit.y)) {
                        // Reset to safe spot? Or delete?
                        // Try to find a safe island
                        const safeIsland = this.map.islands.find(i => i.ownerId === unit.ownerId) || this.map.islands[0];
                        unit.x = safeIsland.x;
                        unit.y = safeIsland.y;
                        unit.status = 'idle';
                        return;
                    }

                    if (unit.targetIslandId) {
                        const target = this.map.islands.find(i => i.id === unit.targetIslandId);
                        if (target) {
                            targetX = target.x;
                            targetY = target.y;
                        } else {
                            unit.status = 'idle';
                            return;
                        }
                    }

                    // Path Navigation (Obstacle Avoidance)
                    let activeTargetX = targetX;
                    let activeTargetY = targetY;

                    if (unit.path && unit.path.length > 0) {
                        const pt = unit.path[0];
                        if (Math.hypot(unit.x - pt.x, unit.y - pt.y) < 30) { // Reached waypoint
                            unit.path.shift();
                            if (unit.path.length > 0) {
                                activeTargetX = unit.path[0].x;
                                activeTargetY = unit.path[0].y;
                            }
                        } else {
                            activeTargetX = pt.x;
                            activeTargetY = pt.y;
                        }
                    }

                    if (activeTargetX !== undefined && activeTargetY !== undefined) {
                        let dx = activeTargetX - unit.x;
                        let dy = activeTargetY - unit.y;
                        let dist = Math.hypot(dx, dy);

                        // Physics Movement (Tight & Direct)

                        // Determine Desired Direction
                        let dirX = 0, dirY = 0;
                        let shouldMove = false;

                        // Direct Pathing (No Steering/Momentum)
                        let moveX = 0;
                        let moveY = 0;

                        if (dist > 2) {
                            dirX = dx / dist;
                            dirY = dy / dist;
                            shouldMove = true;
                        }

                        if (shouldMove) {
                            moveX = dirX * unit.speed * deltaTime;
                            moveY = dirY * unit.speed * deltaTime;
                        }

                        if (!shouldMove) {
                            if (targetX !== undefined && targetY !== undefined && Math.hypot(targetX - unit.x, targetY - unit.y) < 5) {
                                unit.x = targetX;
                                unit.y = targetY;
                            }
                            unit.status = 'idle';
                            unit.targetIslandId = undefined;
                        } else {
                            // Wall Collision Check (Simple)
                            let blocked = false;
                            let nextX = unit.x + moveX;
                            let nextY = unit.y + moveY;

                            // Terrain Check (Prevent walking on water / boats on land)
                            if (!this.isValidPosition(nextX, nextY, unit.type)) {
                                // Obstacle Avoidance: Polygon Edge Sliding
                                let slid = false;

                                let obstaclePoints: { x: number, y: number }[] | undefined = undefined;
                                // Note: Flying units are handled by isValidPosition returning true usually, but if they are restricted by map bounds, they might hit this.
                                // We treat 'aircraft_carrier' as water unit. 'mothership' is flying.
                                const isWaterUnit = ['raft', 'scout_boat', 'gunship', 'destroyer', 'pirate_ship', 'oil_tanker', 'construction_ship', 'aircraft_carrier'].includes(unit.type);

                                if (isWaterUnit) {
                                    // Water unit hitting land (Island)
                                    const hitIsland = this.map.islands.find(i => {
                                        if (Math.hypot(nextX - i.x, nextY - i.y) > i.radius + 50) return false;
                                        return i.points && MapGenerator.isPointInPolygon(nextX, nextY, i.points);
                                    });
                                    if (hitIsland) obstaclePoints = hitIsland.points;
                                } else {
                                    // Land unit hitting water (Leaving Island)
                                    // Find current island
                                    const currentIsland = this.map.islands.find(i => {
                                        if (Math.hypot(unit.x - i.x, unit.y - i.y) > i.radius + 50) return false;
                                        return i.points && MapGenerator.isPointInPolygon(unit.x, unit.y, i.points);
                                    });
                                    if (currentIsland) obstaclePoints = currentIsland.points;
                                }

                                if (obstaclePoints) {
                                    const edge = MapGenerator.getClosestEdge(unit.x, unit.y, obstaclePoints);

                                    let ex = edge.p2.x - edge.p1.x;
                                    let ey = edge.p2.y - edge.p1.y;
                                    const len = Math.hypot(ex, ey);
                                    if (len > 0) {
                                        ex /= len;
                                        ey /= len;

                                        // Project velocity onto edge tangent
                                        const dot = moveX * ex + moveY * ey;
                                        const slideX = ex * dot;
                                        const slideY = ey * dot;

                                        // Check if this slide is valid
                                        if (this.isValidPosition(unit.x + slideX, unit.y + slideY, unit.type)) {
                                            nextX = unit.x + slideX;
                                            nextY = unit.y + slideY;
                                            slid = true;
                                        }
                                    }
                                }

                                if (!slid) {
                                    // Fallback to Axis Sliding (Legacy)
                                    if (this.isValidPosition(nextX, unit.y, unit.type)) {
                                        nextY = unit.y;
                                        slid = true;
                                    } else if (this.isValidPosition(unit.x, nextY, unit.type)) {
                                        nextX = unit.x;
                                        slid = true;
                                    }
                                }

                                if (!slid) {
                                    // Pathfinding Logic: Go Around
                                    if (obstaclePoints && (!unit.path || unit.path.length === 0) && targetX !== undefined && targetY !== undefined) {
                                        const path = MapGenerator.findPathAround({ x: unit.x, y: unit.y }, { x: targetX, y: targetY }, obstaclePoints);
                                        if (path.length > 0) {
                                            unit.path = path;
                                        }
                                    }

                                    // Strict Barrier Logic: Stop
                                    blocked = true;
                                    // Keep status as moving so it follows path next tick
                                    // unit.status = 'idle'; 

                                    // Don't update nextX/nextY (stay at current valid pos)
                                    nextX = unit.x;
                                    nextY = unit.y;
                                }
                            }

                            // Check collision with Wall structures
                            if (!blocked && this.map.bridges && !['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(unit.type)) {
                                for (const bridge of this.map.bridges) {
                                    if (bridge.type === 'gate') {
                                        continue; // Gates are passable openings in the wall loop
                                    }
                                    if (bridge.type !== 'wall') {
                                        continue; // Bridges don't block
                                    }

                                    const endpoints = this.getBridgeEndpoints(bridge);
                                    if (!endpoints) continue;
                                    const { ax, ay, bx, by } = endpoints;

                                    // Intersection check (Segment-Segment)
                                    if (MapGenerator.segmentsIntersect(unit.x, unit.y, nextX, nextY, ax, ay, bx, by)) {
                                        blocked = true;
                                        unit.status = 'idle';
                                        break;
                                    }
                                }
                            }

                            if (!blocked) {
                                this.setUnitFacingFromVector(unit, nextX - unit.x, nextY - unit.y);
                                unit.x = nextX;
                                unit.y = nextY;
                            }
                        }
                    }
                }
            });


            this.applyUnitSeparation();
            this.processNavalMineTriggers(now);
            this.resolveCombat(io, roomId);
            this.processDamageOverTime(deltaTime, now);
            this.processPlayerAssetCollapse(now);
            this.cleanupDeadEntities(); // Ensure stale bots are removed
            this.checkIslandCapture();

            // Increment tick counter for split emission
            this.tickCounter++;

            const simplifiedUnits = this.units.map(u => ({
                id: u.id,
                ownerId: u.ownerId,
                type: u.type,
                x: Math.round(u.x),
                y: Math.round(u.y),
                status: u.status,
                health: Math.round(u.health),
                maxHealth: u.maxHealth,
                speed: u.speed,
                damage: u.damage,
                range: u.range,
                fireRate: u.fireRate,
                facingAngle: u.facingAngle ?? 0,
                cargo: u.cargo ? u.cargo.map(c => ({ type: c.type })) : [],
                recruitmentQueue: u.recruitmentQueue
            }));

            // Split Emission Strategy:
            // Even Ticks: Broadcast to EVERYONE (Slow update ~15Hz)
            // Odd Ticks: Broadcast to HOST/LOCAL only (Fast update ~30Hz)

            if (this.tickCounter % 2 === 0) {
                // Slow Update (Base Room)
                io.to(roomId).emit('playersData', Array.from(this.players.values()));
                io.to(roomId).emit('unitsData', simplifiedUnits);

                // Flush Projectiles (Batch) - Only on slow ticks to save bandwidth
                if (this.pendingProjectiles.length > 0) {
                    io.to(roomId).emit('projectilesBatch', this.pendingProjectiles);
                    this.pendingProjectiles = [];
                }
            } else {
                // Fast Update (Fast Room - Host/Local only)
                io.to(roomId + '_fast').emit('unitsData', simplifiedUnits);
            }

            // Throttle map data (heavy) - Emit every 500ms -> 1000ms
            if (now - this.lastMapEmitTime > 1000) {
                this.emitVisibleMapData(io, roomId);
                io.to(roomId).emit('buildingHitboxes', this.getBuildingHitboxSnapshot());
                this.emitHumanHqStatuses(io);
                this.lastMapEmitTime = now;
            }

            // Debug Data Emission (Throttle to ~2Hz)
            if (this.tickCounter % 15 === 0) {
                const debugData = this.getDebugState();
                if (debugData.length > 0) {
                    io.to(roomId).emit('botDebugData', debugData);
                }
            }

            this.checkMatchEnd();

            if (this.matchState === 'ENDED' && this.playerCollapseStates.size === 0) {
                this.stopGameLoop();
            }
        }, 33); // ~30Hz (33ms) -> Remote gets 15Hz, Local gets 30Hz
    }

    damageBuilding(building: any, damage: number) {
        const owner = this.players.get(building.ownerId || (this.map.oilSpots.find(s => s.occupiedBy === building.id) as any)?.ownerId || '');
        if (owner?.godMode) return;

        building.health -= damage;

        // Emit Event
        if (building.ownerId && this.io && this.roomId) {
            let worldX = building.x;
            let worldY = building.y;

            if ('realX' in building) {
                worldX = building.realX;
                worldY = building.realY;
            } else {
                const island = this.map.islands.find(i => i.buildings.includes(building));
                if (island) {
                    worldX = island.x + (building.x || 0);
                    worldY = island.y + (building.y || 0);
                } else {
                    const spot = this.map.oilSpots.find(s => (s as any).building === building);
                    if (spot) {
                        worldX = spot.x;
                        worldY = spot.y;
                    }
                }
            }

            const payload = {
                entityId: building.id,
                entityType: building.type,
                ownerId: building.ownerId,
                worldX: worldX,
                worldY: worldY,
                damageAmount: damage,
                hpAfter: building.health,
                timestamp: Date.now()
            };

            if (this.isOwnerOnlyBuilding(building)) {
                this.io.to(building.ownerId).emit('buildingDamaged', payload);
            } else {
                this.io.to(this.roomId).emit('buildingDamaged', payload);
            }
        }
    }

    getDebugState() {
        return this.bots.map(bot => ({
            playerId: bot.playerId,
            difficulty: bot.difficulty,
            ...bot.debugState
        }));
    }

    stopGameLoop() {
        this.clearStartupHqCheck();
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }
    }
}
