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
        this.updateTargets(difficulty);

        // Opening defence targets (fast, light)
        let openingTowerTarget = 1;
        let openingNodeTarget = 4;
        if (difficulty >= 5) {
            openingTowerTarget = 2;
            openingNodeTarget = 6;
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

        const towersCurrent = baseIsland.buildings.filter(b => b.type === 'tower').length;
        const nodesCurrent = baseIsland.buildings.filter(b => b.type === 'wall_node').length;
        this.debugState.towersBuilt = towersCurrent;
        this.debugState.wallNodesPlaced = nodesCurrent;

        let neededTowers = 0;
        let neededNodes = 0;
        if (this.bot.difficulty <= 3) {
            neededTowers = 2;
            neededNodes = 6;
        } else if (this.bot.difficulty <= 6) {
            neededTowers = 3;
            neededNodes = 8;
        } else if (this.bot.difficulty <= 8) {
            neededTowers = 5;
            neededNodes = 10;
        } else {
            neededTowers = 6;
            neededNodes = 12;
        }

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
            if (this.debugState.wallNodesPlaced < openingNodeTarget) {
                this.debugState.openingState = 'PLACE_NODES_OPENING';
            } else {
                if (this.connectWalls(gameState, player, baseIsland, budgetPerc)) {
                    this.debugState.openingWallsConnected = this.debugState.wallConnectionsMade;
                    return;
                }
                if (this.debugState.wallConnectionsMade > 0) {
                    this.debugState.openingState = 'UPGRADE_GATE_OPENING';
                } else {
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
                if (this.debugState.wallNodesPlaced >= Math.max(4, this.debugState.wallNodesTarget)) {
                    this.phase = 'CONNECT_WALLS';
                }
            }

            if (this.phase === 'CONNECT_WALLS') {
                if (this.debugState.wallNodesPlaced < 4) {
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

        // 1) Tower test: find any buildable land 300–600 from HQ
        let towerPlaced = false;
        let towerReason = 'UNKNOWN';
        let towerPos = { x: hqX, y: hqY };

        if (!hasTowerResources) {
            towerReason = 'INSUFFICIENT_RESOURCES';
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> FAIL reason=${towerReason} pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
        } else if (!this.bot.consumeApm(1)) {
            towerReason = 'NO_APM';
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> FAIL reason=${towerReason} pos=${hqX.toFixed(0)},${hqY.toFixed(0)}`);
        } else {
            for (let attempt = 0; attempt < 30 && !towerPlaced; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 300 + Math.random() * 300; // 300–600
                const tx = hqX + Math.cos(angle) * dist;
                const ty = hqY + Math.sin(angle) * dist;

                const ok = gameState.buildStructure(this.bot.playerId, builder.id, 'tower', tx, ty);
                if (ok) {
                    towerPlaced = true;
                    towerReason = 'OK';
                    towerPos = { x: tx, y: ty };
                    console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> OK reason=${towerReason} pos=${tx.toFixed(0)},${ty.toFixed(0)}`);
                    break;
                }
            }

            if (!towerPlaced && towerReason === 'UNKNOWN') {
                // If we had resources and APM but never found a spot, assume terrain/ownership issue
                towerReason = 'INVALID_TERRAIN_OR_OWNERSHIP';
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} tower place -> FAIL reason=${towerReason} pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
            }
        }

        // 2) Wall node A/B: same 300–600 ring
        const nodeIds: string[] = [];

        const tryPlaceWallNode = (label: 'A' | 'B') => {
            if (!hasWallResources) {
                const reason = 'INSUFFICIENT_RESOURCES';
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode ${label} -> FAIL reason=${reason} pos=${hqX.toFixed(0)},${hqY.toFixed(0)} gold=${player.resources.gold}`);
                return;
            }

            if (!this.bot.consumeApm(1)) {
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode ${label} -> FAIL reason=NO_APM pos=${hqX.toFixed(0)},${hqY.toFixed(0)}`);
                return;
            }

            let placed = false;
            let px = hqX;
            let py = hqY;

            for (let attempt = 0; attempt < 30 && !placed; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 300 + Math.random() * 300;
                const nx = hqX + Math.cos(angle) * dist;
                const ny = hqY + Math.sin(angle) * dist;

                const ok = gameState.buildStructure(this.bot.playerId, builder.id, 'wall_node', nx, ny);
                if (ok) {
                    placed = true;
                    px = nx;
                    py = ny;
                    console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode ${label} -> OK reason=OK pos=${nx.toFixed(0)},${ny.toFixed(0)}`);

                    // Find the node id we just created
                    const built = baseIsland.buildings.find(b => 
                        b.type === 'wall_node' && 
                        Math.hypot((baseIsland.x + (b.x || 0)) - nx, (baseIsland.y + (b.y || 0)) - ny) < 60
                    );
                    if (built) nodeIds.push(built.id);
                    break;
                }
            }

            if (!placed) {
                console.log(`[DEF_SMOKE] bot=${this.bot.playerId} wallnode ${label} -> FAIL reason=INVALID_TERRAIN_OR_OWNERSHIP pos=${px.toFixed(0)},${py.toFixed(0)}`);
            }
        };

        tryPlaceWallNode('A');
        tryPlaceWallNode('B');

        // 3) Connection test A-B
        if (nodeIds.length < 2) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=INSUFFICIENT_NODES nodes=${nodeIds.length}`);
            return;
        }

        const nodeA = baseIsland.buildings.find(b => b.id === nodeIds[0]);
        const nodeB = baseIsland.buildings.find(b => b.id === nodeIds[1]);

        if (!nodeA || !nodeB) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=NODES_NOT_FOUND`);
            return;
        }

        const ax = baseIsland.x + (nodeA.x || 0);
        const ay = baseIsland.y + (nodeA.y || 0);
        const bx = baseIsland.x + (nodeB.x || 0);
        const by = baseIsland.y + (nodeB.y || 0);
        const dist = Math.hypot(ax - bx, ay - by);

        if (dist > 350) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=OUT_OF_RANGE dist=${dist.toFixed(1)}`);
            return;
        }

        if (!this.bot.consumeApm(1)) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=NO_APM`);
            return;
        }

        const beforeCount = gameState.map.bridges.length;
        gameState.connectNodes(this.bot.playerId, nodeIds[0], nodeIds[1]);
        const afterCount = gameState.map.bridges.length;

        if (afterCount > beforeCount) {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> OK reason=OK`);
        } else {
            console.log(`[DEF_SMOKE] bot=${this.bot.playerId} connect A-B -> FAIL reason=UNKNOWN`);
        }
    }

    private updateTargets(difficulty: number) {
        // Towers
        if (difficulty <= 2) this.debugState.towersTarget = 2;
        else if (difficulty <= 4) this.debugState.towersTarget = 3;
        else if (difficulty <= 6) this.debugState.towersTarget = 4;
        else if (difficulty <= 8) this.debugState.towersTarget = 6;
        else if (difficulty <= 9) this.debugState.towersTarget = 7;
        else this.debugState.towersTarget = 8;

        // Wall Nodes
        if (difficulty <= 2) this.debugState.wallNodesTarget = 4;
        else if (difficulty <= 4) this.debugState.wallNodesTarget = 6;
        else if (difficulty <= 6) this.debugState.wallNodesTarget = 8;
        else if (difficulty <= 8) this.debugState.wallNodesTarget = 10;
        else if (difficulty <= 9) this.debugState.wallNodesTarget = 12;
        else this.debugState.wallNodesTarget = 14;

        this.debugState.wallConnectionsExpected = this.debugState.wallNodesTarget;
    }

    private getRingRadius(hqRadius: number): { ringMin: number; ringMax: number; ringRadius: number } {
        const minDistFromHQ = hqRadius + 40;
        const maxDistFromHQ = hqRadius + 170;
        const preferred = hqRadius + 110;
        const ringRadius = Math.max(minDistFromHQ, Math.min(preferred, maxDistFromHQ));
        return { ringMin: minDistFromHQ, ringMax: maxDistFromHQ, ringRadius };
    }

    private getFootprintRadius(type: string): number {
        if (type === 'base') return 140;
        if (type === 'tower') return 80;
        if (type === 'wall_node') return 50;
        if (type === 'dock') return 90;
        if (type === 'mine') return 60;
        return 40;
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
        const clampedMin = Math.max(40, minDist);
        const clampedMax = Math.max(clampedMin + 20, Math.min(maxDist, island.radius + 40));
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

                const relX = x - island.x;
                const relY = y - island.y;
                const distIsland = Math.hypot(relX, relY);

                if (island.points && island.points.length > 0) {
                    const inside = MapGenerator.isPointInPolygon(x, y, island.points);
                    if (!inside) {
                        recordReject('REJECT_WATER');
                        continue;
                    }
                    const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
                    const edgeDist = Math.hypot(x - closest.x, y - closest.y);
                    if (edgeDist < 30) {
                        recordReject('REJECT_OUT_OF_BOUNDS');
                        continue;
                    }
                } else {
                    const maxIslandRadius = Math.max(0, island.radius - 30);
                    if (distIsland > maxIslandRadius) {
                        recordReject('REJECT_OUT_OF_BOUNDS');
                        continue;
                    }
                }

                for (const b of island.buildings) {
                    const bx = island.x + (b.x || 0);
                    const by = island.y + (b.y || 0);
                    const d = Math.hypot(bx - x, by - y);

                    let threshold = 80;
                    if (gameState.mapType === 'islands' && type === 'tower' && b.type === 'base') {
                        threshold = 40;
                    }

                    if (d < threshold) {
                        recordReject('REJECT_COLLISION_WITH_BUILDING');
                        rejected = true;
                        break;
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
        const currentTowers = island.buildings.filter(b => b.type === 'tower').length;
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
        const isIslands = gameState.mapType === 'islands';

        if (isIslands) {
            const hqRadius = this.getFootprintRadius('base');
            const ring = this.getRingRadius(hqRadius);
            const desired = this.debugState.towersTarget;
            const existingTowers = island.buildings.filter(b => b.type === 'tower');
            const stats = { tried: 0, reasons: {} as Record<string, number> };
            const candidates = this.findNearestBuildableLandPositions(
                gameState,
                island,
                hqX,
                hqY,
                'tower',
                desired,
                ring.ringMin,
                ring.ringMax,
                stats
            );
            const reasonsSummary = Object.entries(stats.reasons)
                .map(([k, v]) => `${k}:${v}`)
                .join(',');
            console.log(
                `[TOWER_CANDIDATES] bot=${this.bot.playerId} map=${gameState.mapType} tried=${stats.tried} valid=${candidates.length} reasons={${reasonsSummary}}`
            );
            if (candidates.length === 0) {
                this.debugState.lastSkipReason = 'NO_LAND_TOWER_CANDIDATES';
                return false;
            }
            const plannedTowers: { id: string | null; x: number; y: number; angle: number }[] = [];
            for (const c of candidates) {
                const already = existingTowers.some(t => {
                    const tx = island.x + (t.x || 0);
                    const ty = island.y + (t.y || 0);
                    return Math.hypot(tx - c.x, ty - c.y) < this.getFootprintRadius('tower');
                });
                if (already) continue;
                if (this.bot.consumeApm(1)) {
                    gameState.buildStructure(this.bot.playerId, builder.id, 'tower', c.x, c.y);
                    this.debugState.lastAction = 'Build Tower (Islands)';
                    this.lastActionTime = now;
                    this.debugState.lastBuilderId = builder.id;
                    plannedTowers.push({ id: null, x: c.x, y: c.y, angle: c.angle });
                    this.debugState.defenceTowers = plannedTowers;
                    return true;
                }
            }
            this.debugState.lastSkipReason = 'NO_TOWER_SLOT_ISLANDS';
            return false;
        }

        const hqRadius = this.getFootprintRadius('base');
        const ring = this.getRingRadius(hqRadius);
        const nodeCount = this.debugState.wallNodesTarget || this.debugState.towersTarget || 1;
        const nodeStep = (Math.PI * 2) / nodeCount;
        const towerRadius = Math.max(ring.ringMin, ring.ringRadius - 30);

        const plannedTowers: { id: string | null, x: number, y: number, angle: number }[] = [];

        for (let i = 0; i < this.debugState.towersTarget; i++) {
            const angle = i * nodeStep + nodeStep * 0.5;
            const tx = hqX + Math.cos(angle) * towerRadius;
            const ty = hqY + Math.sin(angle) * towerRadius;

            const dist = Math.hypot(tx - hqX, ty - hqY);
            console.log(
                `[DEF_RADIUS] bot=${this.bot.playerId} placed=Tower dist=${dist.toFixed(
                    1
                )} min=${ring.ringMin.toFixed(1)} max=${ring.ringMax.toFixed(1)}`
            );

            if (!gameState.isValidPosition(tx, ty, 'builder')) {
                this.debugState.lastSkipReason = 'NOT_LAND_TOWER';
                continue;
            }

            const occupied = island.buildings.some(b => Math.hypot((island.x + (b.x || 0)) - tx, (island.y + (b.y || 0)) - ty) < this.getFootprintRadius('tower'));
            if (!occupied) {
                if (this.bot.consumeApm(1)) {
                    gameState.buildStructure(this.bot.playerId, builder.id, 'tower', tx, ty);
                    this.debugState.lastAction = `Build Tower ${i + 1}`;
                    this.lastActionTime = now;
                    this.debugState.lastBuilderId = builder.id;
                    plannedTowers.push({ id: null, x: tx, y: ty, angle });
                    this.debugState.defenceTowers = plannedTowers;
                    return true;
                }
            } else {
                this.debugState.skip_invalid_placement++;
                this.debugState.lastSkipReason = 'INVALID_PLACEMENT';
            }
        }

        return false;
    }

    private buildWallNodes(gameState: GameState, player: Player, island: Island, budgetPerc: number): boolean {
        const existingNodes = island.buildings.filter(b => b.type === 'wall_node');
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

        const isIslands = gameState.mapType === 'islands';

        if (isIslands) {
            const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.bot.playerId);
            if (!base) {
                this.debugState.lastSkipReason = 'NO_BASE_FOR_WALL_NODES';
                return false;
            }
            const hqX = island.x + (base.x || 0);
            const hqY = island.y + (base.y || 0);
            const hqRadius = this.getFootprintRadius('base');
            const ring = this.getRingRadius(hqRadius);
            const desired = this.debugState.wallNodesTarget;
            const candidates = this.findNearestBuildableLandPositions(
                gameState,
                island,
                hqX,
                hqY,
                'wall_node',
                desired,
                ring.ringMin,
                ring.ringMax
            );
            if (candidates.length === 0) {
                this.debugState.lastSkipReason = 'NO_LAND_WALL_NODE_CANDIDATES';
                return false;
            }
            for (const c of candidates) {
                const already = existingNodes.some(n => {
                    const nx = island.x + (n.x || 0);
                    const ny = island.y + (n.y || 0);
                    return Math.hypot(nx - c.x, ny - c.y) < 40;
                });
                if (already) continue;
                if (this.bot.consumeApm(1)) {
                    gameState.buildStructure(this.bot.playerId, builder.id, 'wall_node', c.x, c.y);
                    this.debugState.lastAction = 'Build Wall Node (Islands)';
                    this.lastActionTime = now;
                    this.debugState.lastBuilderId = builder.id;
                    this.debugState.wallNodesPlaced = existingNodes.length + 1;
                    this.debugState.defenceNodes = island.buildings
                        .filter(b => b.type === 'wall_node')
                        .map(b => {
                            const nx = island.x + (b.x || 0);
                            const ny = island.y + (b.y || 0);
                            const angle = Math.atan2(ny - hqY, nx - hqX);
                            return { id: b.id || null, x: nx, y: ny, angle };
                        });
                    return true;
                }
            }
            this.debugState.lastSkipReason = 'NO_WALL_NODE_SLOT_ISLANDS';
            return false;
        }

        if (!this.wallRingState.planned || this.wallRingState.nodePositions.length !== this.debugState.wallNodesTarget) {
            this.planWallRing(island);
        }

        this.wallRingState.nodePositions.forEach(p => {
            const match = existingNodes.find(n => Math.hypot((island.x + (n.x||0)) - p.x, (island.y + (n.y||0)) - p.y) < 50);
            if (match) {
                p.built = true;
                p.id = match.id;
            } else {
                p.built = false;
                p.id = undefined;
            }
        });

        const target = this.wallRingState.nodePositions.find(p => !p.built);
        if (target) {
            let wx = target.x;
            let wy = target.y;

            if (!gameState.isValidPosition(wx, wy, 'builder')) {
                let fixed = false;
                const offsets = [
                    { dx: 0, dy: 0 },
                    { dx: 30, dy: 0 }, { dx: -30, dy: 0 },
                    { dx: 0, dy: 30 }, { dx: 0, dy: -30 },
                    { dx: 30, dy: 30 }, { dx: -30, dy: 30 },
                    { dx: 30, dy: -30 }, { dx: -30, dy: -30 }
                ];
                for (const o of offsets) {
                    const fx = wx + o.dx;
                    const fy = wy + o.dy;
                    if (gameState.isValidPosition(fx, fy, 'builder')) {
                        wx = fx;
                        wy = fy;
                        fixed = true;
                        break;
                    }
                }

                if (!fixed) {
                    console.log(`[BUILD_REJECT] type=wall_node reason=NOT_LAND pos=${wx.toFixed(0)},${wy.toFixed(0)}`);
                    this.debugState.lastSkipReason = 'NOT_LAND_WALL_NODE';
                    return false;
                }
            }

            if (this.bot.consumeApm(1)) {
                gameState.buildStructure(this.bot.playerId, builder.id, 'wall_node', wx, wy);
                this.debugState.lastAction = `Build Wall Node`;
                this.lastActionTime = now;
                this.debugState.lastBuilderId = builder.id;
                target.x = wx;
                target.y = wy;
                target.built = true; 
                this.debugState.defenceNodes = this.wallRingState.nodePositions.map(p => ({
                    id: p.id || null,
                    x: p.x,
                    y: p.y,
                    angle: p.angle
                }));
                return true;
            }
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
        const ring = this.getRingRadius(hqRadius);
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
        const nodes = island.buildings.filter(
            b => b.type === 'wall_node' && b.ownerId === this.bot.playerId && !(b as any).isConstructing
        );
        if (nodes.length < 4) {
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

        const hqRadius = this.getFootprintRadius('base');
        const minR = hqRadius + 40;
        const maxR = hqRadius + 190;

        const ringNodes = nodes.filter(n => {
            const nx = island.x + (n.x || 0);
            const ny = island.y + (n.y || 0);
            const d = Math.hypot(nx - hqX, ny - hqY);
            return d >= minR && d <= maxR;
        });

        if (ringNodes.length < 4) {
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
            const hqRadius = this.getFootprintRadius('base');
            const ring = this.getRingRadius(hqRadius);
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
        const nodes = island.buildings.filter(b => b.type === 'wall_node');
        if (nodes.length < 2) return false;

        const sortedNodes = nodes.map(n => {
            const angle = Math.atan2((island.y + (n.y || 0)) - island.y, (island.x + (n.x || 0)) - island.x);
            return { node: n, angle };
        }).sort((a, b) => a.angle - b.angle);

        for (let i = 0; i < sortedNodes.length; i++) {
            const current = sortedNodes[i].node;
            const next = sortedNodes[(i + 1) % sortedNodes.length].node;

            const bridge = gameState.map.bridges.find(b =>
                ((b.nodeAId === current.id && b.nodeBId === next.id) ||
                 (b.nodeAId === next.id && b.nodeBId === current.id)) &&
                b.ownerId === this.bot.playerId &&
                b.type === 'wall'
            );

            if (!bridge) continue;

            const player = gameState.players.get(this.bot.playerId);
            if (!player || player.resources.gold < 50) {
                this.debugState.lastSkipReason = 'INSUFFICIENT_RESOURCES_GATE';
                return false;
            }

            gameState.convertWallToGate(this.bot.playerId, current.id, next.id);
            this.debugState.lastAction = `Upgrade Gate ${current.id}-${next.id}`;
            this.debugState.wallConnectionsMade = this.debugState.wallConnectionsExpected;
            return true;
        }

        return false;
    }

    public getPlan() {
        return this.debugState;
    }
}
