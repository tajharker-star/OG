import { GameState, Unit, Player } from './GameState';
import { Island, MapGenerator } from './MapGenerator';
import { BotAI } from './BotAI';
import { BuildingData } from './data/Registry';

export class BaseDefenseBuilder {
    private bot: BotAI;
    private lastTickTime: number = 0;
    private lastActionTime: number = 0;
    private phase: 'PLACE_TOWERS' | 'PLACE_NODES' | 'CONNECT_WALLS' | 'UPGRADE_GATE' = 'PLACE_TOWERS';
    
    // Debug State
    public debugState = {
        status: 'WAITING',
        towersBuilt: 0,
        towersTarget: 0,
        wallNodesPlaced: 0,
        wallNodesTarget: 0,
        wallConnectionsMade: 0,
        wallConnectionsExpected: 0,
        openingState: 'PLACE_TOWERS_OPENING' as 'PLACE_TOWERS_OPENING' | 'PLACE_NODES_OPENING' | 'CONNECT_WALLS_OPENING' | 'UPGRADE_GATE_OPENING' | 'DONE',
        openingTowersBuilt: 0,
        openingNodesPlaced: 0,
        openingWallsConnected: 0,
        openingGateUpgraded: 0,
        lastAction: 'None',
        nextAction: 'None',
        lastSkipReason: 'None',
        lastBuilderId: null as string | null,
        plannedNodes: [] as {x: number, y: number}[],
        plannedConnections: [] as {x1: number, y1: number, x2: number, y2: number}[],
        ringRadius: 0,
        maxAngularGap: 0,
        defenceNodes: [] as {id: string | null, x: number, y: number, angle: number}[],
        defenceTowers: [] as {id: string | null, x: number, y: number, angle: number}[],
        skip_no_builder: 0,
        skip_builder_busy: 0,
        skip_insufficient_resources: 0,
        skip_before_start_time: 0,
        skip_threat_not_met: 0,
        skip_invalid_placement: 0,
        skip_no_base: 0,
        skip_eco_wait: 0,
        skip_connect_failed: 0
    };

    // State tracking for persistent tasks
    private wallRingState: {
        planned: boolean;
        centerX: number;
        centerY: number;
        ringRadius: number;
        nodePositions: {x: number, y: number, built: boolean, id?: string, angle: number}[];
    } = { planned: false, centerX: 0, centerY: 0, ringRadius: 0, nodePositions: [] };

    // Smoke Test State
    private smokeTestDone = false;
    private lastLogTime = 0;
    private lastWallConnectAttempt = 0;
    private wallConnectRetryCount = 0;

    constructor(bot: BotAI) {
        this.bot = bot;
    }

    public tick(gameState: GameState, now: number) {
        // Run once per second to save CPU
        if (now - this.lastTickTime < 1000) return;
        this.lastTickTime = now;

        if (now - this.lastLogTime > 10000) {
             const mapType = gameState.mapType || this.bot.debugState.progression?.mapType || 'unknown';
             const towers = `${this.debugState.towersBuilt}/${this.debugState.towersTarget}`;
             const nodes = `${this.debugState.wallNodesPlaced}/${this.debugState.wallNodesTarget}`;
             const walls = `${this.debugState.wallConnectionsMade}/${this.debugState.wallConnectionsExpected}`;
             const skip = this.debugState.lastSkipReason || this.debugState.status;
             const builder = this.debugState.lastBuilderId || 'none';
             const goal = this.bot.debugState.currentGoal || 'UNKNOWN';
             const reserve = (this.bot as any).defenceReserveGold || 0;
             const spendableGold = Math.max(0, gameState.players.get(this.bot.playerId)?.resources.gold || 0 - reserve);
             console.log(`[DEFENCE] bot=${this.bot.playerId} goal=${goal} map=${mapType} status=${this.debugState.status} towers=${towers} nodes=${nodes} conn=${walls} skip=${skip} builder=${builder} phase=${this.phase} reserve=${reserve} spendable=${spendableGold}`);
             this.lastLogTime = now;
        }

        const player = gameState.players.get(this.bot.playerId);
        if (!player) return;

        const matchElapsedMs = Date.now() - gameState.startTime;
        if (matchElapsedMs >= 10000 && !this.smokeTestDone) {
            this.runSmokeTest(gameState, player);
            this.smokeTestDone = true;
        }

        // 1. Check Start Conditions
        const difficulty = this.bot.difficulty;

        // Threat radius (used for threat override and logging)
        let threatRadius = 900;
        if (difficulty >= 5) threatRadius = 1100;
        if (difficulty >= 8) threatRadius = 1400;

        const baseIsland = gameState.map.islands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.bot.playerId));
        if (!baseIsland) {
            this.debugState.status = 'NO_BASE';
            this.debugState.skip_no_base++;
            this.debugState.lastSkipReason = 'NO_BASE';
            return;
        }

        const enemyNearby = gameState.units.some(u => 
            u.ownerId !== this.bot.playerId && 
            Math.hypot(u.x - baseIsland.x, u.y - baseIsland.y) < threatRadius
        );

        this.debugState.status = 'ACTIVE';

        // 2. Budget share for defences
        // Defences are cheap; allow them to consume full gold while incomplete.
        let budgetPerc = 1.0;

        // 3. Targets (full plan)
        this.updateTargets(difficulty, gameState.mapType);
        if (gameState.mapType === 'islands') {
            const islandPlan = this.getIslandEdgeNodePlan(gameState, baseIsland, this.debugState.wallNodesTarget);
            this.debugState.wallNodesTarget = islandPlan.length;
            this.debugState.wallConnectionsExpected = islandPlan.length;
            this.debugState.plannedNodes = islandPlan.map(node => ({ x: node.x, y: node.y }));
            this.wallRingState.nodePositions = islandPlan.map(node => ({
                x: node.x,
                y: node.y,
                angle: node.angle,
                built: false
            }));
            this.wallRingState.planned = islandPlan.length > 0;
        }

        // Opening defence targets (fast, light)
        let openingTowerTarget = Math.max(1, Math.min(2, this.debugState.towersTarget));
        let openingNodeTarget = Math.max(4, Math.min(6, this.debugState.wallNodesTarget));
        if (gameState.mapType === 'islands') {
            openingTowerTarget = Math.max(1, Math.min(2, this.debugState.towersTarget));
            openingNodeTarget = this.debugState.wallNodesTarget;
        }

        // 3b. Compute defence budget reserve (bounded so spendableGold is never negative)
        const towerCostStats = BuildingData['tower'];
        const nodeCostStats = BuildingData['wall_node'];
        const towerCost = typeof towerCostStats.cost === 'number'
            ? towerCostStats.cost
            : (towerCostStats.cost as any).gold ?? towerCostStats.cost.gold;
        const nodeCost = typeof nodeCostStats.cost === 'number'
            ? nodeCostStats.cost
            : (nodeCostStats.cost as any).gold ?? nodeCostStats.cost.gold;

        const towersCurrent = baseIsland.buildings.filter(
            b => b.type === 'tower' && b.ownerId === this.bot.playerId
        ).length;
        const nodesCurrent = baseIsland.buildings.filter(
            b => b.type === 'wall_node' && b.ownerId === this.bot.playerId
        ).length;
        this.debugState.towersBuilt = towersCurrent;
        this.debugState.wallNodesPlaced = nodesCurrent;

        const openingRemainingTowers = Math.max(0, openingTowerTarget - towersCurrent);
        const openingRemainingNodes = Math.max(0, openingNodeTarget - nodesCurrent);

        let reserveGold = 0;
        const gold = player.resources.gold;
        const openingCost = openingRemainingTowers * towerCost + openingRemainingNodes * nodeCost;
        reserveGold = Math.min(Math.max(openingCost, 0), Math.max(gold, 0));
        (this.bot as any).defenceReserveGold = reserveGold;

        // Opening Defence FSM (runs at start, then we fall back to normal plan)
        if (this.debugState.openingState === 'PLACE_TOWERS_OPENING') {
            if (this.buildTowers(gameState, player, baseIsland, budgetPerc)) {
                this.debugState.openingTowersBuilt = this.debugState.towersBuilt;
                return;
            }
            if (this.debugState.towersBuilt >= openingTowerTarget) {
                this.debugState.openingState = 'PLACE_NODES_OPENING';
            }
        }

        if (this.debugState.openingState === 'PLACE_NODES_OPENING') {
            if (this.buildWallNodes(gameState, player, baseIsland, budgetPerc)) {
                this.debugState.openingNodesPlaced = this.debugState.wallNodesPlaced;
                return;
            }
            if (this.debugState.wallNodesPlaced >= openingNodeTarget) {
                this.debugState.openingState = 'CONNECT_WALLS_OPENING';
            }
        }

        if (this.debugState.openingState === 'CONNECT_WALLS_OPENING') {
            const openingConnectThreshold = gameState.mapType === 'islands'
                ? Math.min(3, Math.max(0, openingNodeTarget))
                : openingNodeTarget;
            if (this.debugState.wallNodesPlaced < openingConnectThreshold) {
                this.debugState.openingState = 'PLACE_NODES_OPENING';
            } else {
                if (this.connectWalls(gameState, player, baseIsland, budgetPerc)) {
                    this.debugState.openingWallsConnected = this.debugState.wallConnectionsMade;
                    return;
                }
                if (this.debugState.wallConnectionsMade > 0) {
                    this.debugState.openingState = 'UPGRADE_GATE_OPENING';
                } else {
                    this.phase = 'CONNECT_WALLS';
                    this.debugState.openingState = 'DONE';
                }
            }
        }

        if (this.debugState.openingState === 'UPGRADE_GATE_OPENING') {
            if (this.upgradeGate(gameState, baseIsland)) {
                this.debugState.openingGateUpgraded++;
                this.debugState.openingState = 'DONE';
                return;
            }
            this.debugState.openingState = 'DONE';
        }

        // After opening is DONE, use full plan sequencing if needed
        if (this.debugState.openingState === 'DONE') {
            if (this.phase === 'PLACE_TOWERS') {
                if (this.buildTowers(gameState, player, baseIsland, budgetPerc)) return;
                if (this.debugState.towersBuilt >= this.debugState.towersTarget) {
                    this.phase = 'PLACE_NODES';
                }
            }

            if (this.phase === 'PLACE_NODES') {
                if (this.buildWallNodes(gameState, player, baseIsland, budgetPerc)) return;
                const phaseNodeTarget = gameState.mapType === 'islands'
                    ? Math.max(3, this.debugState.wallNodesTarget)
                    : this.getWallConnectNodeThreshold();
                if (this.debugState.wallNodesPlaced >= phaseNodeTarget) {
                    this.phase = 'CONNECT_WALLS';
                }
            }

            if (this.phase === 'CONNECT_WALLS') {
                const reconnectThreshold = gameState.mapType === 'islands' ? 3 : 4;
                if (this.debugState.wallNodesPlaced < reconnectThreshold) {
                    this.phase = 'PLACE_NODES';
                } else {
                    if (this.connectWalls(gameState, player, baseIsland, budgetPerc)) return;
                    if (this.debugState.wallConnectionsMade >= this.debugState.wallConnectionsExpected) {
                        this.phase = 'UPGRADE_GATE';
                    }
                }
            }

            if (this.phase === 'UPGRADE_GATE') {
                if (this.upgradeGate(gameState, baseIsland)) return;
                this.phase = 'PLACE_TOWERS';
            }
        }
    }

    private runSmokeTest(gameState: GameState, player: Player) {
        const mapType = gameState.mapType || 'unknown';
        const baseIsland = gameState.map.islands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.bot.playerId));
        if (!baseIsland) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} step=INIT -> FAIL reason=NO_BASE map=${mapType}`);
            return;
        }

        const hq = baseIsland.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        const hqX = hq ? baseIsland.x + (hq.x || 0) : baseIsland.x;
        const hqY = hq ? baseIsland.y + (hq.y || 0) : baseIsland.y;

        const hasBuilderUnit = gameState.units.some(u => u.ownerId === this.bot.playerId && u.type === 'builder');
        if (!hasBuilderUnit) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} step=INIT -> FAIL reason=BUILDER_REQUIRED map=${mapType}`);
            return;
        }

        const builder = this.getFreeBuilder(gameState, baseIsland, true);
        if (!builder) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} step=INIT -> FAIL reason=BUILDER_BUSY map=${mapType}`);
            return;
        }

        const towerStats = BuildingData['tower'];
        const wallStats = BuildingData['wall_node'];

        const hasTowerResources = player.resources.gold >= (towerStats.cost.gold || 0) &&
                                  player.resources.oil >= (towerStats.cost.oil || 0);
        const hasWallResources = player.resources.gold >= (wallStats.cost.gold || 0) &&
                                 player.resources.oil >= (wallStats.cost.oil || 0);

        const hqRadius = this.getFootprintRadius('base');
        const towerRing = this.getRingRadius(hqRadius, 'tower');
        const towerCandidates = hasTowerResources
            ? this.findNearestBuildableLandPositions(gameState, baseIsland, hqX, hqY, 'tower', 1, towerRing.ringMin, towerRing.ringMax)
            : [];

        if (!hasTowerResources) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> FAIL reason=INSUFFICIENT_RESOURCES pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
        } else if (towerCandidates.length === 0) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> FAIL reason=NO_VALID_SLOT pos=${hqX.toFixed(0)},${hqY.toFixed(0)}`);
        } else {
            const tower = towerCandidates[0];
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> OK reason=SIM_OK pos=${tower.x.toFixed(0)},${tower.y.toFixed(0)} builder=${builder.id}`);
        }

        const nodeRing = this.getRingRadius(hqRadius, 'wall_node');
        const nodeCandidates = hasWallResources
            ? this.findNearestBuildableLandPositions(gameState, baseIsland, hqX, hqY, 'wall_node', 2, nodeRing.ringMin, nodeRing.ringMax)
            : [];

        if (!hasWallResources) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode A -> FAIL reason=INSUFFICIENT_RESOURCES pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode B -> FAIL reason=INSUFFICIENT_RESOURCES pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=INSUFFICIENT_NODES nodes=0`);
            return;
        }

        if (nodeCandidates.length < 2) {
            if (nodeCandidates.length >= 1) {
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode A -> OK reason=SIM_OK pos=${nodeCandidates[0].x.toFixed(0)},${nodeCandidates[0].y.toFixed(0)}`);
            } else {
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode A -> FAIL reason=NO_VALID_SLOT pos=${hqX.toFixed(0)},${hqY.toFixed(0)}`);
            }
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode B -> FAIL reason=NO_VALID_SLOT pos=${hqX.toFixed(0)},${hqY.toFixed(0)}`);
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=INSUFFICIENT_NODES nodes=${nodeCandidates.length}`);
            return;
        }

        console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode A -> OK reason=SIM_OK pos=${nodeCandidates[0].x.toFixed(0)},${nodeCandidates[0].y.toFixed(0)}`);
        console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode B -> OK reason=SIM_OK pos=${nodeCandidates[1].x.toFixed(0)},${nodeCandidates[1].y.toFixed(0)}`);

        const connectionDistance = Math.hypot(nodeCandidates[0].x - nodeCandidates[1].x, nodeCandidates[0].y - nodeCandidates[1].y);
        if (connectionDistance > 350) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=OUT_OF_RANGE dist=${connectionDistance.toFixed(1)}`);
            return;
        }

        console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> OK reason=SIM_OK dist=${connectionDistance.toFixed(1)}`);
    }

    private updateTargets(difficulty: number, mapType?: string) {
        const profileTargets = this.bot.getDefenceTargets(mapType);
        this.debugState.towersTarget = profileTargets.towers;
        this.debugState.wallNodesTarget = profileTargets.wallNodes;

        this.debugState.wallConnectionsExpected = this.debugState.wallNodesTarget;
    }

    private getWallConnectNodeThreshold(): number {
        return Math.max(4, Math.min(this.debugState.wallNodesTarget, 6));
    }

    private getRingRadius(hqRadius: number, structureType: 'tower' | 'wall_node'): { ringMin: number; ringMax: number; ringRadius: number } {
        const structureRadius = this.getFootprintRadius(structureType);
        const minDistFromHQ = hqRadius + structureRadius + 12;
        const preferred = minDistFromHQ + (structureType === 'tower' ? 18 : 28);
        const maxDistFromHQ = minDistFromHQ + (structureType === 'tower' ? 80 : 120);
        const ringRadius = Math.max(minDistFromHQ, Math.min(preferred, maxDistFromHQ));
        return { ringMin: minDistFromHQ, ringMax: maxDistFromHQ, ringRadius };
    }

    private getFootprintRadius(type: string): number {
        const configured = BuildingData[type]?.radius;
        if (typeof configured === 'number') return configured;
        if (type === 'base') return 36;
        if (type === 'tower') return 18;
        if (type === 'wall_node' || type === 'bridge_node' || type === 'wall') return 10;
        if (type === 'dock') return 28;
        if (type === 'mine') return 24;
        return 30;
    }

    private resolveBuildIsland(gameState: GameState, x: number, y: number): Island | null {
        const matches = gameState.map.islands.filter(candidate => {
            if (candidate.points) {
                return MapGenerator.isPointInPolygon(x, y, candidate.points);
            }
            return Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius + 50;
        });

        matches.sort((left, right) => left.radius - right.radius);
        return matches[0] || null;
    }

    private normalizeAngle(angle: number): number {
        let normalized = angle;
        while (normalized <= -Math.PI) normalized += Math.PI * 2;
        while (normalized > Math.PI) normalized -= Math.PI * 2;
        return normalized;
    }

    private angularDistance(a: number, b: number): number {
        return Math.abs(this.normalizeAngle(a - b));
    }

    private sampleIslandCoastline(
        gameState: GameState,
        island: Island,
        insideOffset: number,
        sampleSpacing: number = 18
    ): { edgeX: number; edgeY: number; x: number; y: number }[] {
        const samples: { edgeX: number; edgeY: number; x: number; y: number }[] = [];

        const pushSample = (edgeX: number, edgeY: number) => {
            const dx = edgeX - island.x;
            const dy = edgeY - island.y;
            const length = Math.hypot(dx, dy) || 1;
            const x = edgeX - (dx / length) * insideOffset;
            const y = edgeY - (dy / length) * insideOffset;

            if (island.points && !MapGenerator.isPointInPolygon(x, y, island.points)) {
                return;
            }

            if (samples.some(sample => Math.hypot(sample.x - x, sample.y - y) < 8)) {
                return;
            }

            samples.push({ edgeX, edgeY, x, y });
        };

        if (island.points && island.points.length > 1) {
            for (let i = 0; i < island.points.length; i++) {
                const start = island.points[i];
                const end = island.points[(i + 1) % island.points.length];
                const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
                const steps = Math.max(2, Math.ceil(segmentLength / sampleSpacing));

                for (let step = 0; step < steps; step++) {
                    const t = step / steps;
                    const edgeX = start.x + (end.x - start.x) * t;
                    const edgeY = start.y + (end.y - start.y) * t;
                    pushSample(edgeX, edgeY);
                }
            }
            return samples;
        }

        const angleSamples = 36;
        const radius = Math.max(0, island.radius);
        for (let i = 0; i < angleSamples; i++) {
            const angle = (i / angleSamples) * Math.PI * 2;
            const edgeX = island.x + Math.cos(angle) * radius;
            const edgeY = island.y + Math.sin(angle) * radius;
            pushSample(edgeX, edgeY);
        }
        return samples;
    }

    private hasDockWaterSpawn(gameState: GameState, absX: number, absY: number): boolean {
        const radii = [40, 60, 80, 100, 120, 150, 180, 200];
        for (const radius of radii) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const tx = absX + Math.cos(angle) * radius;
                const ty = absY + Math.sin(angle) * radius;
                if (gameState.isValidPosition(tx, ty, 'destroyer')) {
                    return true;
                }
            }
        }
        return false;
    }

    private isDockPlacementCandidate(gameState: GameState, island: Island, absX: number, absY: number): boolean {
        if (!gameState.isBuildingPlacementClearOnIsland(island, 'dock', absX, absY)) {
            return false;
        }

        if (island.points) {
            if (!gameState.isPointOnExposedIslandShoreline(island, absX, absY)) {
                return false;
            }
        } else {
            if (!gameState.isPointOnExposedIslandShoreline(island, absX, absY)) {
                return false;
            }
        }

        return this.hasDockWaterSpawn(gameState, absX, absY);
    }

    public getPreferredDockPlacement(gameState: GameState, island: Island): { x: number; y: number; angle: number } | null {
        const existingDock = island.buildings.find(
            building => building.type === 'dock' && building.ownerId === this.bot.playerId
        );
        if (existingDock) {
            const absX = island.x + (existingDock.x || 0);
            const absY = island.y + (existingDock.y || 0);
            return {
                x: absX,
                y: absY,
                angle: Math.atan2(absY - island.y, absX - island.x)
            };
        }

        const shorelineSamples = this.sampleIslandCoastline(gameState, island, 14, 14);
        if (shorelineSamples.length === 0) {
            return null;
        }

        const nearestOil = gameState.map.oilSpots.reduce<{ x: number; y: number } | null>((best, spot) => {
            if (spot.occupiedBy && !String(spot.occupiedBy).startsWith('oil_')) {
                return best;
            }

            const currentDistance = Math.hypot(spot.x - island.x, spot.y - island.y);
            if (!best) {
                return { x: spot.x, y: spot.y };
            }

            const bestDistance = Math.hypot(best.x - island.x, best.y - island.y);
            return currentDistance < bestDistance ? { x: spot.x, y: spot.y } : best;
        }, null);

        let bestCandidate: { x: number; y: number; angle: number; score: number } | null = null;
        for (const sample of shorelineSamples) {
            if (!this.isDockPlacementCandidate(gameState, island, sample.x, sample.y)) {
                continue;
            }

            let score = 0;
            if (nearestOil) {
                score += Math.hypot(sample.x - nearestOil.x, sample.y - nearestOil.y);
            }

            const crowdingPenalty = island.buildings.reduce((acc, building) => {
                if (!building.ownerId || building.ownerId !== this.bot.playerId) return acc;
                const buildingX = island.x + (building.x || 0);
                const buildingY = island.y + (building.y || 0);
                return acc + Math.max(0, 120 - Math.hypot(sample.x - buildingX, sample.y - buildingY));
            }, 0);
            score += crowdingPenalty * 2;

            if (!bestCandidate || score < bestCandidate.score) {
                bestCandidate = {
                    x: sample.x,
                    y: sample.y,
                    angle: Math.atan2(sample.y - island.y, sample.x - island.x),
                    score
                };
            }
        }

        if (!bestCandidate) {
            return null;
        }

        return {
            x: bestCandidate.x,
            y: bestCandidate.y,
            angle: bestCandidate.angle
        };
    }

    private getIslandGateHalfAngle(island: Island): number {
        const dockRadius = this.getFootprintRadius('dock');
        const effectiveRadius = Math.max(40, island.radius - dockRadius);
        return Math.max(0.32, Math.min(0.72, (dockRadius * 1.6) / effectiveRadius));
    }

    private getIslandEdgeNodePlan(
        gameState: GameState,
        island: Island,
        targetCount: number
    ): { x: number; y: number; angle: number }[] {
        const base = island.buildings.find(building => building.type === 'base' && building.ownerId === this.bot.playerId);
        if (!base || targetCount <= 0) {
            return [];
        }

        const hqX = island.x + (base.x || 0);
        const hqY = island.y + (base.y || 0);
        const dockPlacement = this.getPreferredDockPlacement(gameState, island);
        const gapCenterAngle = dockPlacement
            ? Math.atan2(dockPlacement.y - hqY, dockPlacement.x - hqX)
            : 0;
        const gapHalfAngle = this.getIslandGateHalfAngle(island);
        const nodeSpacing = this.getFootprintRadius('wall_node') * 2 + 4;
        const shorelineSamples = this.sampleIslandCoastline(
            gameState,
            island,
            this.getFootprintRadius('wall_node') + 6,
            16
        );

        const candidates: { x: number; y: number; angle: number }[] = [];
        for (const sample of shorelineSamples) {
            if (!gameState.isBuildingPlacementClearOnIsland(island, 'wall_node', sample.x, sample.y)) {
                continue;
            }

            const angle = Math.atan2(sample.y - hqY, sample.x - hqX);
            if (dockPlacement && this.angularDistance(angle, gapCenterAngle) < gapHalfAngle) {
                continue;
            }

            if (candidates.some(candidate => Math.hypot(candidate.x - sample.x, candidate.y - sample.y) < nodeSpacing)) {
                continue;
            }

            candidates.push({ x: sample.x, y: sample.y, angle });
        }

        if (candidates.length === 0) {
            return [];
        }

        candidates.sort((left, right) => left.angle - right.angle);
        const desiredCount = Math.min(targetCount, candidates.length);
        const selected: { x: number; y: number; angle: number }[] = [];
        const usedIndexes = new Set<number>();
        const stride = candidates.length / desiredCount;

        for (let i = 0; i < desiredCount; i++) {
            let index = Math.floor(i * stride);
            while (usedIndexes.has(index) && index < candidates.length - 1) {
                index++;
            }
            if (usedIndexes.has(index)) {
                break;
            }
            usedIndexes.add(index);
            selected.push(candidates[index]);
        }

        if (selected.length < Math.min(4, candidates.length)) {
            return candidates.slice(0, Math.min(targetCount, candidates.length));
        }

        return selected;
    }

    private findNearestBuildableLandPositions(
        gameState: GameState,
        island: Island,
        centerX: number,
        centerY: number,
        type: 'tower' | 'wall_node',
        count: number,
        minDist: number,
        maxDist: number,
        stats?: { tried: number; reasons: Record<string, number> }
    ): { x: number; y: number; angle: number }[] {
        const footprint = this.getFootprintRadius(type);
        const clampedMin = Math.max(footprint + 8, minDist);
        const clampedMax = Math.max(clampedMin + 20, maxDist);
        const radii: number[] = [];
        const step = 40;
        for (let r = clampedMin; r <= clampedMax; r += step) {
            radii.push(r);
        }
        if (radii.length === 0) radii.push(clampedMin);

        const candidates: { x: number; y: number; angle: number; dist: number }[] = [];
        const angleSamples = 32;

        const maxLogged = 50;

        const recordReject = (reason: string) => {
            if (!stats) return;
            if (stats.tried > maxLogged) return;
            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        };

        for (const r of radii) {
            for (let i = 0; i < angleSamples; i++) {
                const angle = (i * Math.PI * 2) / angleSamples;
                const x = centerX + Math.cos(angle) * r;
                const y = centerY + Math.sin(angle) * r;

                if (stats && stats.tried < maxLogged) {
                    stats.tried++;
                }

                let rejected = false;

                const dxCenter = x - centerX;
                const dyCenter = y - centerY;
                const distCenter = Math.hypot(dxCenter, dyCenter);
                if (distCenter < clampedMin) {
                    recordReject('REJECT_TOO_CLOSE_TO_HQ');
                    continue;
                }

                if (!gameState.isBuildingPlacementClearOnIsland(island, type, x, y)) {
                    recordReject('REJECT_INVALID_FOOTPRINT');
                    rejected = true;
                }

                if (!rejected) {
                    const resolvedIsland = this.resolveBuildIsland(gameState, x, y);
                    if (resolvedIsland && resolvedIsland.id !== island.id) {
                        recordReject('REJECT_WRONG_OVERLAY_ISLAND');
                        rejected = true;
                    }
                }

                if (rejected) continue;

                const dist = Math.hypot(x - centerX, y - centerY);
                candidates.push({ x, y, angle, dist });
            }
        }

        if (candidates.length === 0) return [];

        candidates.sort((a, b) => a.dist - b.dist);

        const result: { x: number; y: number; angle: number }[] = [];
        const usedAngles: number[] = [];
        const target = Math.max(1, count);
        const minAngleGap = (Math.PI * 2) / (target * 1.5);

        for (const c of candidates) {
            const tooClose = usedAngles.some(a => {
                let diff = Math.abs(a - c.angle);
                if (diff > Math.PI) diff = Math.PI * 2 - diff;
                return diff < minAngleGap;
            });
            if (tooClose) continue;
            result.push({ x: c.x, y: c.y, angle: c.angle });
            usedAngles.push(c.angle);
            if (result.length >= target) break;
        }

        if (result.length === 0 && candidates.length > 0) {
            const c = candidates[0];
            result.push({ x: c.x, y: c.y, angle: c.angle });
        }

        return result;
    }

    private getFreeBuilder(gameState: GameState, island: Island, force: boolean = false): Unit | null {
        // Find all builders on island
        const builders = gameState.units.filter(u => 
            u.ownerId === this.bot.playerId && 
            u.type === 'builder' && 
            Math.hypot(u.x - island.x, u.y - island.y) < island.radius + 200
        );

        if (builders.length === 0) {
            this.debugState.skip_no_builder++;
            return null;
        }

        // A5: Builder Reservation Logic
        // If we have >= 2 builders, we can steal one even if busy (simulating reservation)
        // If we have 1 builder, we must respect idle unless force/timeout
        
        // Timeout check (if defense stalled for 2 mins)
        // We'll track last action time. If > 2 mins ago, force = true
        // (Caller should handle force flag based on timeout, but we can double check logic here)
        
        const idleBuilder = builders.find(u => u.status === 'idle');
        if (idleBuilder) return idleBuilder;

        return builders[0];
    }

    private buildTowers(gameState: GameState, player: Player, island: Island, budgetPerc: number): boolean {
        const currentTowers = island.buildings.filter(b => b.type === 'tower' && b.ownerId === this.bot.playerId).length;
        this.debugState.towersBuilt = currentTowers;

        if (currentTowers >= this.debugState.towersTarget) return false;

        const cost = BuildingData['tower'].cost;
        const towerCost = typeof cost === 'number' ? cost : (cost as any).gold || 100;
        if (player.resources.gold * budgetPerc < towerCost) {
            this.debugState.nextAction = 'Waiting for Gold (Tower)';
            this.debugState.skip_insufficient_resources++;
            this.debugState.lastSkipReason = 'INSUFFICIENT_RESOURCES_TOWER';
            return false; // Waiting for money
        }

        const now = Date.now();
        const stalled = this.lastActionTime > 0 && (now - this.lastActionTime) > 60000;

        const builder = this.getFreeBuilder(gameState, island, stalled);
        if (!builder) {
             this.debugState.nextAction = 'Waiting for Builder';
             this.debugState.lastSkipReason = 'NO_BUILDER';
             return false;
        }

        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        if (!base) {
            this.debugState.lastSkipReason = 'NO_BASE_FOR_TOWERS';
            return false;
        }

        const hqX = island.x + (base.x || 0);
        const hqY = island.y + (base.y || 0);
        const hqRadius = this.getFootprintRadius('base');
        const ring = this.getRingRadius(hqRadius, 'tower');
        const stats = { tried: 0, reasons: {} as Record<string, number> };
        const candidates = this.findNearestBuildableLandPositions(
            gameState,
            island,
            hqX,
            hqY,
            'tower',
            this.debugState.towersTarget,
            ring.ringMin,
            ring.ringMax,
            stats
        );

        if (candidates.length === 0) {
            this.debugState.lastSkipReason = 'NO_LAND_TOWER_CANDIDATES';
            return false;
        }

        for (const candidate of candidates) {
            if (!this.bot.consumeApm(1)) {
                this.debugState.lastSkipReason = 'NO_APM_TOWER';
                return false;
            }

            if (gameState.buildStructure(this.bot.playerId, builder.id, 'tower', candidate.x, candidate.y)) {
                this.debugState.lastAction = 'Build Tower';
                this.lastActionTime = now;
                this.debugState.lastBuilderId = builder.id;
                this.debugState.defenceTowers = island.buildings
                    .filter(b => b.type === 'tower' && b.ownerId === this.bot.playerId)
                    .map(b => {
                        const tx = island.x + (b.x || 0);
                        const ty = island.y + (b.y || 0);
                        return { id: b.id || null, x: tx, y: ty, angle: Math.atan2(ty - hqY, tx - hqX) };
                    });
                return true;
            }

            this.debugState.skip_invalid_placement++;
            this.debugState.lastSkipReason = 'INVALID_TOWER_PLACEMENT';
        }

        return false;
    }

    private buildWallNodes(gameState: GameState, player: Player, island: Island, budgetPerc: number): boolean {
        const existingNodes = island.buildings.filter(b => b.type === 'wall_node' && b.ownerId === this.bot.playerId);
        this.debugState.wallNodesPlaced = existingNodes.length;
        if (existingNodes.length >= this.debugState.wallNodesTarget) return false;

        const cost = BuildingData['wall_node'].cost; // Assuming wall_node has cost
        const nodeCost = typeof cost === 'number' ? cost : (cost as any).gold || 50;
        if (player.resources.gold * budgetPerc < nodeCost) {
            this.debugState.nextAction = 'Waiting for Gold (WallNode)';
            this.debugState.skip_insufficient_resources++;
            this.debugState.lastSkipReason = 'INSUFFICIENT_RESOURCES_WALL_NODE';
            return false;
        }

        const now = Date.now();
        const stalled = this.lastActionTime > 0 && (now - this.lastActionTime) > 60000;

        const builder = this.getFreeBuilder(gameState, island, stalled);
        if (!builder) {
            this.debugState.lastSkipReason = 'NO_BUILDER';
            return false;
        }

        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        if (!base) {
            this.debugState.lastSkipReason = 'NO_BASE_FOR_WALL_NODES';
            return false;
        }

        const hqX = island.x + (base.x || 0);
        const hqY = island.y + (base.y || 0);
        const candidates = gameState.mapType === 'islands'
            ? this.getIslandEdgeNodePlan(gameState, island, this.debugState.wallNodesTarget)
            : (() => {
                const hqRadius = this.getFootprintRadius('base');
                const ring = this.getRingRadius(hqRadius, 'wall_node');
                return this.findNearestBuildableLandPositions(
                    gameState,
                    island,
                    hqX,
                    hqY,
                    'wall_node',
                    this.debugState.wallNodesTarget,
                    ring.ringMin,
                    ring.ringMax
                );
            })();

        if (candidates.length === 0) {
            this.debugState.lastSkipReason = 'NO_LAND_WALL_NODE_CANDIDATES';
            return false;
        }

        for (const candidate of candidates) {
            const alreadyCovered = existingNodes.some(node => {
                const nodeX = island.x + (node.x || 0);
                const nodeY = island.y + (node.y || 0);
                return Math.hypot(nodeX - candidate.x, nodeY - candidate.y) < this.getFootprintRadius('wall_node') * 2 + 6;
            });
            if (alreadyCovered) {
                continue;
            }

            if (!this.bot.consumeApm(1)) {
                this.debugState.lastSkipReason = 'NO_APM_WALL_NODE';
                return false;
            }

            if (gameState.buildStructure(this.bot.playerId, builder.id, 'wall_node', candidate.x, candidate.y)) {
                this.debugState.lastAction = 'Build Wall Node';
                this.lastActionTime = now;
                this.debugState.lastBuilderId = builder.id;
                this.debugState.wallNodesPlaced = existingNodes.length + 1;
                this.debugState.defenceNodes = island.buildings
                    .filter(b => b.type === 'wall_node' && b.ownerId === this.bot.playerId)
                    .map(b => {
                        const nx = island.x + (b.x || 0);
                        const ny = island.y + (b.y || 0);
                        return { id: b.id || null, x: nx, y: ny, angle: Math.atan2(ny - hqY, nx - hqX) };
                    });
                return true;
            }

            this.debugState.lastSkipReason = 'INVALID_WALL_NODE_PLACEMENT';
        }

        return false;
    }

    private planWallRing(island: Island) {
        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        if (!base) {
            this.wallRingState.planned = false;
            this.wallRingState.nodePositions = [];
            return;
        }
        const hqX = island.x + (base.x || 0);
        const hqY = island.y + (base.y || 0);
        const hqRadius = this.getFootprintRadius('base');
        const ring = this.getRingRadius(hqRadius, 'wall_node');
        const count = this.debugState.wallNodesTarget;
        if (count <= 0) {
            this.wallRingState.planned = false;
            this.wallRingState.nodePositions = [];
            return;
        }
        const ringRadius = ring.ringRadius;
        this.wallRingState.centerX = hqX;
        this.wallRingState.centerY = hqY;
        this.wallRingState.ringRadius = ringRadius;
        this.debugState.ringRadius = ringRadius;
        this.wallRingState.nodePositions = [];
        for (let i = 0; i < count; i++) {
            const angle = (i * Math.PI * 2) / count;
            const wx = hqX + Math.cos(angle) * ringRadius;
            const wy = hqY + Math.sin(angle) * ringRadius;
            this.wallRingState.nodePositions.push({ x: wx, y: wy, built: false, angle });
        }
        this.wallRingState.planned = true;
        this.debugState.plannedNodes = this.wallRingState.nodePositions;
        this.debugState.defenceNodes = this.wallRingState.nodePositions.map(p => ({
            id: p.id || null,
            x: p.x,
            y: p.y,
            angle: p.angle
        }));
    }

    private connectWalls(gameState: GameState, player: Player, island: Island, budgetPerc: number): boolean {
        const minimumNodes = gameState.mapType === 'islands' ? 3 : 4;
        const nodes = island.buildings.filter(
            b => b.type === 'wall_node' && b.ownerId === this.bot.playerId && !(b as any).isConstructing
        );
        if (nodes.length < minimumNodes) {
            this.debugState.lastSkipReason = 'NOT_ENOUGH_NODES';
            return false;
        }

        if (player.resources.gold < 10) {
            this.debugState.lastSkipReason = 'INSUFFICIENT_RESOURCES_CONNECT';
            return false;
        }

        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        if (!base) {
            this.debugState.lastSkipReason = 'NO_BASE_FOR_CONNECT';
            return false;
        }

        const hqX = island.x + (base.x || 0);
        const hqY = island.y + (base.y || 0);

        const ringNodes = gameState.mapType === 'islands'
            ? nodes
            : (() => {
                const hqRadius = this.getFootprintRadius('base');
                const nodeRing = this.getRingRadius(hqRadius, 'wall_node');
                const minR = nodeRing.ringMin - 10;
                const maxR = nodeRing.ringMax + 20;
                return nodes.filter(n => {
                    const nx = island.x + (n.x || 0);
                    const ny = island.y + (n.y || 0);
                    const distance = Math.hypot(nx - hqX, ny - hqY);
                    return distance >= minR && distance <= maxR;
                });
            })();

        if (ringNodes.length < minimumNodes) {
            this.debugState.lastSkipReason = 'NOT_ENOUGH_RING_NODES';
            return false;
        }

        let minDistToHQ = Infinity;
        let maxDistToHQ = 0;
        for (const n of ringNodes) {
            const nx = island.x + (n.x || 0);
            const ny = island.y + (n.y || 0);
            const d = Math.hypot(nx - hqX, ny - hqY);
            if (d < minDistToHQ) minDistToHQ = d;
            if (d > maxDistToHQ) maxDistToHQ = d;
        }

        console.log(
            `[WALL_SET] bot=${this.bot.playerId} nodes=${ringNodes.length} minDistToHQ=${minDistToHQ.toFixed(
                1
            )} maxDistToHQ=${maxDistToHQ.toFixed(1)}`
        );

        const sortedNodes = ringNodes
            .map(n => {
                const angle = Math.atan2((island.y + (n.y || 0)) - hqY, (island.x + (n.x || 0)) - hqX);
                return { node: n, angle };
            })
            .sort((a, b) => a.angle - b.angle);

        const nodeIds = sortedNodes.map(s => s.node.id as string).filter(id => !!id);

        console.log(
            `[CONNECT_LOOP_ATTEMPT] bot=${this.bot.playerId} env=server nodeCount=${nodeIds.length} ids=[${nodeIds.join(
                ','
            )}]`
        );

        const now = Date.now();
        if (
            now - this.lastWallConnectAttempt < 3000 &&
            this.debugState.wallConnectionsExpected > 0 &&
            this.debugState.wallConnectionsMade >= this.debugState.wallConnectionsExpected
        ) {
            this.debugState.lastSkipReason = 'CONNECT_COOLDOWN';
            return false;
        }
        this.lastWallConnectAttempt = now;

        let connectionsMade = 0;
        const expectedSegments = sortedNodes.length;

        if (sortedNodes.length >= 2) {
            const ring = gameState.mapType === 'islands'
                ? { ringRadius: island.radius - this.getFootprintRadius('wall_node') }
                : this.getRingRadius(this.getFootprintRadius('base'), 'wall_node');
            const angles = sortedNodes.map(s => s.angle);
            let maxGap = 0;
            let totalDist = 0;
            let linkCount = 0;

            for (let i = 0; i < sortedNodes.length; i++) {
                const current = sortedNodes[i].node;
                const next = sortedNodes[(i + 1) % sortedNodes.length].node;
                const gap =
                    i === sortedNodes.length - 1
                        ? (angles[0] + Math.PI * 2) - angles[i]
                        : angles[i + 1] - angles[i];
                if (gap > maxGap) maxGap = gap;

                const cx = island.x + (current.x || 0);
                const cy = island.y + (current.y || 0);
                const nx = island.x + (next.x || 0);
                const ny = island.y + (next.y || 0);
                const linkDist = Math.hypot(cx - nx, cy - ny);
                totalDist += linkDist;
                linkCount++;
            }

            const maxGapDeg = (maxGap * 180) / Math.PI;
            const avgLinkDist = linkCount > 0 ? totalDist / linkCount : 0;
            console.log(
                `[DEF_RING] bot=${this.bot.playerId} N=${sortedNodes.length} targetR=${ring.ringRadius.toFixed(
                    1
                )} maxGapDeg=${maxGapDeg.toFixed(1)} avgLinkDist=${avgLinkDist.toFixed(1)}`
            );
        }

        console.log(
            `[BOT_WALL_CONNECT] bot=${this.bot.playerId} nodes=${nodeIds.length} selected=${nodeIds.length} action=ENSURE_LOOP`
        );

        const result = (gameState as any).ensureWallLoop(this.bot.playerId, nodeIds) as {
            createdCount: number;
            existingCount: number;
            failedCount: number;
        };

        const segs = result.createdCount + result.existingCount;
        this.debugState.wallConnectionsMade = segs;
        this.debugState.wallConnectionsExpected = sortedNodes.length;

        if (segs < sortedNodes.length) {
            this.wallConnectRetryCount++;
            if (this.wallConnectRetryCount > 2) {
                this.debugState.lastSkipReason = 'CONNECT_RETRIES_EXHAUSTED';
                this.debugState.wallConnectionsMade = sortedNodes.length;
                this.debugState.wallConnectionsExpected = sortedNodes.length;
            }
        } else {
            this.wallConnectRetryCount = 0;
        }

        return segs > 0;
    }

    private upgradeGate(gameState: GameState, island: Island): boolean {
        const existingGate = gameState.map.bridges.find(bridge =>
            bridge.ownerId === this.bot.playerId &&
            bridge.type === 'gate' &&
            (bridge.islandAId === island.id || bridge.islandBId === island.id)
        );
        if (existingGate) {
            return false;
        }

        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
        const centerX = base ? island.x + (base.x || 0) : island.x;
        const centerY = base ? island.y + (base.y || 0) : island.y;
        const nodes = island.buildings.filter(b => b.type === 'wall_node' && b.ownerId === this.bot.playerId);
        if (nodes.length < 2) return false;

        const sortedNodes = nodes.map(n => {
            const angle = Math.atan2((island.y + (n.y || 0)) - centerY, (island.x + (n.x || 0)) - centerX);
            return { node: n, angle };
        }).sort((a, b) => a.angle - b.angle);

        const preferredPairs = sortedNodes.map((entry, index) => {
            const nextEntry = sortedNodes[(index + 1) % sortedNodes.length];
            const gap = index === sortedNodes.length - 1
                ? (sortedNodes[0].angle + Math.PI * 2) - entry.angle
                : nextEntry.angle - entry.angle;
            return {
                current: entry.node,
                next: nextEntry.node,
                gap
            };
        }).sort((left, right) => right.gap - left.gap);

        for (const pair of preferredPairs) {
            const bridge = gameState.map.bridges.find(b =>
                ((b.nodeAId === pair.current.id && b.nodeBId === pair.next.id) ||
                 (b.nodeAId === pair.next.id && b.nodeBId === pair.current.id)) &&
                b.ownerId === this.bot.playerId &&
                b.type === 'wall'
            );

            if (!bridge) continue;

            const player = gameState.players.get(this.bot.playerId);
            if (!player || player.resources.gold < 50) {
                this.debugState.lastSkipReason = 'INSUFFICIENT_RESOURCES_GATE';
                return false;
            }

            gameState.convertWallToGate(this.bot.playerId, pair.current.id, pair.next.id);
            this.debugState.lastAction = `Upgrade Gate ${pair.current.id}-${pair.next.id}`;
            this.debugState.wallConnectionsMade = this.debugState.wallConnectionsExpected;
            return true;
        }

        return false;
    }

    public getPlan() {
        return this.debugState;
    }
}
