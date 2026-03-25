import { GameState, Unit, Player } from './GameState';
import { BotAI, DifficultyConfig } from './BotAI';
import { Island, MapGenerator } from './MapGenerator';

export type AttackState = 'BUILD_ARMY' | 'RALLY' | 'ASSAULT' | 'REASSESS' | 'RESET';

const ENABLE_ATTACK_DIAGNOSTICS = process.env.DEBUG_ATTACK_MANAGER === '1';

export class AttackManager {
    private bot: BotAI;
    private state: AttackState = 'BUILD_ARMY';
    
    // Army Management
    private combatUnits: Set<string> = new Set(); // Current army roster
    private currentTargetBase: { id: string, x: number, y: number, ownerId?: string, type: string } | null = null;
    private rallyPoint: { x: number, y: number } | null = null;
    
    private lastAttackTime: number = 0;
    private stateStartTime: number = 0;
    private lastOrderTime: number = 0;
    private lastTickLog: number = 0;
    private lastAssaultIssued: number = 0;
    private stateResetCount: number = 0;
    private ordersIssuedCount: number = 0;
    private ordersAppliedCount: number = 0;
    private lastOrderBlocked: boolean = false;
    private lastPathOk: boolean = true;
    private lastBlockReason: string = 'INIT';
    private lastTransitionReason: string = 'INIT';
    private lastFortificationHpEstimate: number = 0;
    private lastRequiredAssaultPower: number = 0;
    private lastRosterAssaultPower: number = 0;
    private lastRequiredUnitsFromPower: number = 0;
    
    // Config per difficulty
    private minArmySize: number;
    private maxWaitTime: number;
    private attackStartTimeSec: number;

    constructor(bot: BotAI) {
        this.bot = bot;
        this.stateStartTime = Date.now();
        this.lastAttackTime = Date.now(); // Start timer from now

        const config = DifficultyConfig(bot.difficulty);
        this.attackStartTimeSec = config.attackStartTime;

        // 3) Army Grouping Rules Config
        // L1–2: 6, L3–4: 8, L5–6: 10, L7–8: 12, L9: 14, L10: 16
        if (bot.difficulty <= 2) this.minArmySize = 6;
        else if (bot.difficulty <= 4) this.minArmySize = 8;
        else if (bot.difficulty <= 6) this.minArmySize = 10;
        else if (bot.difficulty <= 8) this.minArmySize = 12;
        else if (bot.difficulty <= 9) this.minArmySize = 14;
        else this.minArmySize = 16;

        const coordinationBonus =
            bot.strategyProfile.coordinationWeight >= 0.9
                ? 2
                : bot.strategyProfile.coordinationWeight >= 0.55
                    ? 1
                    : 0;
        const aggressionBonus = bot.strategyProfile.aggressionWeight >= 1.5 ? 1 : 0;
        this.minArmySize = Math.max(4, this.minArmySize - coordinationBonus - aggressionBonus);

        // Failsafe time
        // L1: 360s, L5: 240s, L10: 120s
        if (bot.difficulty <= 1) this.maxWaitTime = 360000;
        else if (bot.difficulty <= 5) this.maxWaitTime = 240000;
        else this.maxWaitTime = 120000;

        if (bot.strategyProfile.coordinationWeight >= 0.9) {
            this.maxWaitTime = Math.min(this.maxWaitTime, 75000);
        } else if (bot.strategyProfile.coordinationWeight >= 0.55) {
            this.maxWaitTime = Math.min(this.maxWaitTime, 90000);
        }

        // High tiers should mass a real deathball before failsafe release.
        if (bot.difficulty >= 8) {
            this.maxWaitTime = Math.max(this.maxWaitTime, 110000);
        }
    }

    public update(gameState: GameState, myUnits: Unit[]) {
        const allCombatUnits = myUnits.filter(u => this.isCombatUnit(u));
        const requiredArmySize = this.getRequiredArmySize(gameState, allCombatUnits);
        
        // Update Roster (add new units)
        allCombatUnits.forEach(u => {
            if (!this.combatUnits.has(u.id)) {
                this.combatUnits.add(u.id);
            }
        });
        
        // Prune dead units
        const livingIds = new Set(allCombatUnits.map(u => u.id));
        for (const id of this.combatUnits) {
            if (!livingIds.has(id)) this.combatUnits.delete(id);
        }

        const armySize = this.combatUnits.size;
        const elapsedGameTime = (Date.now() - this.bot.startTime) / 1000;
        
        let rallyPct = 0;
        if (this.state === 'RALLY' && this.rallyPoint) {
             const rally = this.rallyPoint;
             let gathered = 0;
             // Check units that are actually in the roster and alive
             let rosterCount = 0;
             for(const id of this.combatUnits) {
                 const u = myUnits.find(unit => unit.id === id);
                 if (u) {
                     rosterCount++;
                     const dist = Math.hypot(u.x - rally.x, u.y - rally.y);
                     if (dist < 350) gathered++; // Increased radius slightly
                 }
             }
             if (rosterCount > 0) rallyPct = gathered / rosterCount;
        }

        if (Date.now() - this.lastTickLog > 2000) {
             const now = Date.now();
             let blockReason = 'NONE';
             if (this.state === 'BUILD_ARMY') {
                if (elapsedGameTime < this.attackStartTimeSec) blockReason = 'WAITING_ATTACK_START_TIME';
                else if (armySize < requiredArmySize) blockReason = 'INSUFFICIENT_ARMY';
                else if (!this.currentTargetBase) blockReason = 'NO_TARGET';
             } else if (this.state === 'RALLY') {
                 if (rallyPct < 0.55 && (now - this.stateStartTime) < 8000) blockReason = 'RALLY_IN_PROGRESS';
             } else if (this.state === 'ASSAULT') {
                 if (!this.isValidTarget(gameState, this.currentTargetBase)) blockReason = 'TARGET_INVALID';
             }

             const targetId = this.currentTargetBase ? this.currentTargetBase.id : 'none';
             let targetDist = 0;
             if (this.currentTargetBase) {
                 const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
                 if (myBase) {
                     targetDist = Math.round(Math.hypot(this.currentTargetBase.x - myBase.x, this.currentTargetBase.y - myBase.y));
                 }
             }

             const lastOrderSec = ((now - this.lastOrderTime) / 1000).toFixed(1);
             const rallySec = this.state === 'RALLY' ? ((now - this.stateStartTime) / 1000).toFixed(1) : '0.0';
             const rallyPctStr = this.state === 'RALLY' ? (rallyPct * 100).toFixed(0) : '0';
             const orderBlocked = this.lastOrderBlocked ? 'yes' : 'no';
             const pathOk = this.lastPathOk ? 'yes' : 'no';

             if (ENABLE_ATTACK_DIAGNOSTICS) {
                 console.log(
                     `[MOBILISE_DIAG] botId=${this.bot.playerId} lvl=${this.bot.difficulty} state=${this.state}` +
                     ` groupCombat=${armySize} req=${requiredArmySize}` +
                     ` elapsed=${elapsedGameTime.toFixed(1)} atkStart=${this.attackStartTimeSec}` +
                     ` rallyPct=${rallyPctStr} rallySec=${rallySec}` +
                     ` targetHQ=${targetId} targetDist=${targetDist}` +
                     ` lastOrderSec=${lastOrderSec}` +
                     ` orderBlocked=${orderBlocked} blockReason=${blockReason}` +
                     ` stateResets=${this.stateResetCount}` +
                     ` pathOk=${pathOk}` +
                     ` ordersIssued=${this.ordersIssuedCount} ordersApplied=${this.ordersAppliedCount}`
                 );
             }
             this.lastTickLog = now;
             this.lastOrderBlocked = false;
             this.lastBlockReason = blockReason;
        }

        if (armySize === 0 && this.state !== 'BUILD_ARMY' && this.state !== 'RESET') {
             console.log(`Bot ${this.bot.playerId} Army wiped out -> Resetting`);
             this.transitionTo('RESET', 'ARMY_WIPED');
             return;
        }

        switch (this.state) {
            case 'BUILD_ARMY':
                // 3) Make “Mobilise Trigger” explicit (no ambiguity)
                // If elapsed >= attackStartTimeSec AND combatGroupSize >= requiredGroupSize AND target != null
                const timeInBuild = Date.now() - this.stateStartTime;
                const failsafeArmyFloor =
                    this.bot.difficulty >= 9
                        ? Math.max(8, Math.ceil(requiredArmySize * 0.75))
                        : this.bot.difficulty >= 6
                            ? Math.max(6, Math.ceil(requiredArmySize * 0.65))
                            : Math.max(4, Math.ceil(requiredArmySize * 0.55));
                const isFailsafe = timeInBuild > this.maxWaitTime && armySize >= failsafeArmyFloor;

                if ((elapsedGameTime >= this.attackStartTimeSec && armySize >= requiredArmySize) || isFailsafe) {
                     if (isFailsafe) {
                         console.log(
                             `[AttackManager] Bot ${this.bot.playerId} Failsafe Triggered: Moving to RALLY with ${armySize} units (required=${requiredArmySize}, floor=${failsafeArmyFloor}, wait=${Math.floor(timeInBuild/1000)}s)`
                         );
                     }

                     const target = this.pickEnemyHQTarget(gameState);
                     if (target) {
                         this.currentTargetBase = target;
                         this.transitionTo('RALLY', isFailsafe ? 'FAILSAFE_TARGET_ACQUIRED' : 'TARGET_ACQUIRED'); // MOBILISE
                     } else {
                         // Force find any target
                         const fallback = this.findHighValueTarget(gameState);
                         if (fallback) {
                             this.currentTargetBase = fallback;
                             this.transitionTo('RALLY', 'FALLBACK_TARGET_ACQUIRED');
                         }
                     }
                }
                break;

            case 'RALLY':
                this.handleRallyState(gameState, allCombatUnits, rallyPct);
                break;

            case 'ASSAULT':
                this.handleAssaultState(gameState, allCombatUnits);
                break;

            case 'REASSESS':
                this.handleReassessState(gameState);
                break;

            case 'RESET':
                this.transitionTo('BUILD_ARMY', 'RESET_COMPLETE');
                break;
        }

        // Debug Overlay Data Update
        this.updateDebugState(armySize, requiredArmySize, Date.now() - this.lastAttackTime);
    }

    private transitionTo(newState: AttackState, reason: string = 'UNSPECIFIED') {
        console.log(`Bot ${this.bot.playerId} AttackManager: ${this.state} -> ${newState}`);
        this.state = newState;
        this.stateStartTime = Date.now();
        this.lastTransitionReason = reason;
        if (newState === 'RESET') {
            this.stateResetCount += 1;
        }
        
        if (newState === 'BUILD_ARMY') {
            this.currentTargetBase = null;
            this.rallyPoint = null;
        }
        if (newState === 'ASSAULT') {
            this.lastAssaultIssued = 0; // Reset to force immediate order
        }
    }

    private getRallyOrderInterval(): number {
        if (this.bot.strategyProfile.coordinationWeight >= 0.95) return 2000;
        if (this.bot.strategyProfile.coordinationWeight >= 0.8) return 2500;
        return 3000;
    }

    private getAssaultOrderInterval(): number {
        if (this.bot.strategyProfile.coordinationWeight >= 0.95) return 2500;
        if (this.bot.strategyProfile.coordinationWeight >= 0.8) return 3200;
        return 4000;
    }

    private getRallyTimeoutMs(): number {
        if (this.bot.strategyProfile.coordinationWeight >= 0.95) return 5000;
        if (this.bot.strategyProfile.coordinationWeight >= 0.8) return 6500;
        return 8000;
    }

    private getRallyCompletionThreshold(): number {
        if (this.bot.strategyProfile.coordinationWeight >= 0.95) return 0.5;
        return 0.55;
    }

    private getRequiredArmySize(gameState: GameState, allCombatUnits: Unit[]): number {
        const floor = this.getMapArmyFloor(gameState.mapType);
        const cap = this.getMapArmyCap(gameState.mapType);

        const targetBase =
            this.currentTargetBase && this.currentTargetBase.type === 'base'
                ? this.currentTargetBase
                : this.findNearestEnemyBase(gameState);

        if (!targetBase) {
            this.lastFortificationHpEstimate = 0;
            this.lastRequiredAssaultPower = floor * 100;
            this.lastRosterAssaultPower = this.getTotalAssaultPower(allCombatUnits);
            this.lastRequiredUnitsFromPower = floor;
            return floor;
        }

        const fortificationHp = this.estimateFortificationHp(gameState, targetBase);
        const rosterPower = this.getTotalAssaultPower(allCombatUnits);
        const averageUnitPower =
            allCombatUnits.length > 0
                ? rosterPower / allCombatUnits.length
                : this.getFallbackUnitPower(gameState.mapType);
        const hpSafetyFactor =
            this.bot.difficulty >= 10 ? 1.65 :
            this.bot.difficulty >= 8 ? 1.5 :
            this.bot.difficulty >= 6 ? 1.38 :
            this.bot.difficulty >= 4 ? 1.28 : 1.18;
        let requiredAssaultPower = fortificationHp * hpSafetyFactor;
        if (gameState.mapType === 'islands') {
            requiredAssaultPower *= this.bot.difficulty >= 8 ? 0.88 : 0.94;
        }

        let requiredUnitsFromPower = Math.ceil(requiredAssaultPower / Math.max(55, averageUnitPower));
        if (this.bot.difficulty <= 2) requiredUnitsFromPower = Math.ceil(requiredUnitsFromPower * 0.72);
        else if (this.bot.difficulty <= 4) requiredUnitsFromPower = Math.ceil(requiredUnitsFromPower * 0.84);

        const requiredArmySize = Math.max(floor, Math.min(cap, requiredUnitsFromPower));

        this.lastFortificationHpEstimate = Math.round(fortificationHp);
        this.lastRequiredAssaultPower = Math.round(requiredAssaultPower);
        this.lastRosterAssaultPower = Math.round(rosterPower);
        this.lastRequiredUnitsFromPower = requiredUnitsFromPower;

        return requiredArmySize;
    }

    private getMapArmyFloor(mapType: string): number {
        if (mapType === 'desert') {
            if (this.bot.difficulty >= 9) return Math.min(this.minArmySize, 12);
            if (this.bot.difficulty >= 7) return Math.min(this.minArmySize, 10);
            if (this.bot.difficulty >= 5) return Math.min(this.minArmySize, 8);
            return Math.min(this.minArmySize, 6);
        }

        if (mapType === 'grasslands') {
            const mapFloor =
                this.bot.difficulty >= 10 ? 16 :
                this.bot.difficulty >= 9 ? 14 :
                this.bot.difficulty >= 8 ? 12 :
                this.bot.difficulty >= 7 ? 10 :
                this.bot.difficulty >= 5 ? 8 : 6;
            return Math.min(this.minArmySize, mapFloor);
        }

        if (mapType === 'islands') {
            const fleetFloor =
                this.bot.difficulty >= 10 ? 10 :
                this.bot.difficulty >= 9 ? 9 :
                this.bot.difficulty >= 8 ? 8 :
                this.bot.difficulty >= 7 ? 7 :
                this.bot.difficulty >= 5 ? 5 : 3;
            return Math.min(this.minArmySize, fleetFloor);
        }

        return this.minArmySize;
    }

    private getMapArmyCap(mapType: string): number {
        if (mapType === 'islands') {
            if (this.bot.difficulty >= 10) return 100;
            if (this.bot.difficulty >= 9) return 90;
            if (this.bot.difficulty >= 7) return 72;
            if (this.bot.difficulty >= 5) return 58;
            return 42;
        }

        if (this.bot.difficulty >= 10) return 145;
        if (this.bot.difficulty >= 9) return 125;
        if (this.bot.difficulty >= 7) return 100;
        if (this.bot.difficulty >= 5) return 78;
        if (this.bot.difficulty >= 3) return 58;
        return 42;
    }

    private findNearestEnemyBase(gameState: GameState): { id: string; x: number; y: number; ownerId?: string; type: string } | null {
        const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
        const startX = myBase ? myBase.x : 0;
        const startY = myBase ? myBase.y : 0;
        const enemyBases: Array<{ id: string; x: number; y: number; ownerId?: string; type: string }> = [];

        gameState.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (building.type !== 'base') return;
                if (!building.ownerId || building.ownerId === this.bot.playerId) return;
                enemyBases.push({
                    id: building.id,
                    x: island.x + (building.x || 0),
                    y: island.y + (building.y || 0),
                    ownerId: building.ownerId,
                    type: 'base'
                });
            });
        });

        if (enemyBases.length === 0) return null;
        return this.findNearest(enemyBases, startX, startY);
    }

    private estimateFortificationHp(
        gameState: GameState,
        targetBase: { id: string; x: number; y: number; ownerId?: string; type: string }
    ): number {
        let baseHealth = 2000;
        let targetIsland: Island | null = null;
        let targetOwnerId = targetBase.ownerId;

        for (const island of gameState.map.islands) {
            const building = island.buildings.find(candidate => candidate.id === targetBase.id);
            if (!building) continue;
            baseHealth = Math.max(0, building.health ?? 0);
            targetIsland = island;
            targetOwnerId = building.ownerId || targetOwnerId;
            break;
        }

        if (!targetOwnerId) return baseHealth;

        let towerHealth = 0;
        const towerRadius = gameState.mapType === 'islands' ? 950 : 1100;
        gameState.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (building.type !== 'tower' || building.ownerId !== targetOwnerId) return;
                const bx = island.x + (building.x || 0);
                const by = island.y + (building.y || 0);
                const inRadius = Math.hypot(bx - targetBase.x, by - targetBase.y) <= towerRadius;
                const sameIsland = !!targetIsland && island.id === targetIsland.id;
                if (!inRadius && !sameIsland) return;
                towerHealth += Math.max(0, building.health ?? 0);
            });
        });

        return Math.max(0, baseHealth + towerHealth);
    }

    private getUnitAssaultPower(unit: Unit): number {
        const typePower: Record<string, number> = {
            soldier: 70,
            sniper: 110,
            rocketeer: 185,
            tank: 380,
            humvee: 240,
            missile_launcher: 460,
            light_plane: 220,
            heavy_plane: 520,
            pirate_ship: 420,
            destroyer: 760,
            submarine: 680,
            battleship: 1100,
            aircraft_carrier: 1900,
            mothership: 2400
        };

        const base = typePower[unit.type] ?? 130;
        const healthRatio = Math.max(0.3, Math.min(1.1, unit.health / Math.max(1, unit.maxHealth)));
        return base * healthRatio;
    }

    private getTotalAssaultPower(units: Unit[]): number {
        return units.reduce((sum, unit) => sum + this.getUnitAssaultPower(unit), 0);
    }

    private getFallbackUnitPower(mapType: string): number {
        if (mapType === 'islands') return 210;
        if (mapType === 'desert') return 140;
        return 130;
    }

    private handleRallyState(gameState: GameState, units: Unit[], rallyPct: number) {
        // 1. Pick Target if none
        if (!this.currentTargetBase) {
            this.currentTargetBase = this.pickEnemyHQTarget(gameState);
            if (!this.currentTargetBase) {
                // No targets? Wait.
                this.transitionTo('RESET', 'NO_TARGET_DURING_RALLY');
                return;
            }
        }

        // 2. Pick Rally Point if none
        if (!this.rallyPoint) {
            this.rallyPoint = this.calculateRallyPoint(gameState, this.currentTargetBase);
        }

        const rally = this.rallyPoint!;
        
        const now = Date.now();
        if (now - this.lastOrderTime > this.getRallyOrderInterval()) {
            units.forEach(u => {
                const rallyPoint = this.getRallyOrderPoint(gameState, u, rally);
                const dist = Math.hypot(u.x - rallyPoint.x, u.y - rallyPoint.y);
                if (dist > 300 || u.status === 'idle') { 
                     this.issueOrder(gameState, u, rallyPoint.x, rallyPoint.y, 'RALLY');
                }
            });
            this.lastOrderTime = now;
            this.ordersIssuedCount++;
        }

        // 4. Check Transition (Explicit Assault Trigger)
        // If rallyPct >= 55% OR rallyTime >= 8s
        const timeInState = Date.now() - this.stateStartTime;
        const rallyThreshold = this.getRallyCompletionThreshold();
        const rallyTimeoutMs = this.getRallyTimeoutMs();
        
        if (rallyPct >= rallyThreshold || timeInState > rallyTimeoutMs) { 
            console.log(`[AttackManager] Rally Complete: Pct=${rallyPct.toFixed(2)} Time=${timeInState}ms`);
            this.transitionTo('ASSAULT', rallyPct >= rallyThreshold ? 'RALLY_THRESHOLD_MET' : 'RALLY_TIMEOUT');
        }
    }

    private handleAssaultState(gameState: GameState, units: Unit[]) {
        // 1. Validate Target
        if (!this.isValidTarget(gameState, this.currentTargetBase)) {
            // Target destroyed or invalid
            // 2.1 Minimum Dwell Time Check
            const timeInAssault = Date.now() - this.stateStartTime;
            if (timeInAssault < 10000 && this.combatUnits.size >= 3) {
                 // Force find new target immediately without resetting
                 this.transitionTo('REASSESS', 'TARGET_INVALID_EARLY_REASSESS'); 
                 return;
            }
            
            this.transitionTo('REASSESS', 'TARGET_INVALID');
            return;
        }

        const target = this.currentTargetBase!;
        const homeBase = this.findBaseForPlayer(gameState, this.bot.playerId);
        const homeThreat = homeBase ? this.findHomeThreat(gameState, homeBase, 900) : null;
        let reserveUnits: Unit[] = [];
        let assaultUnits = units;

        if (
            homeBase &&
            homeThreat &&
            this.bot.difficulty >= 9 &&
            gameState.mapType !== 'islands' &&
            units.length >= 14
        ) {
            // Keep only a small reaction force at home; the rest commits to base-kill pushes.
            const reserveCount = Math.min(
                Math.max(2, Math.floor(units.length * 0.14)),
                Math.max(0, units.length - 10)
            );
            const sortedByHome = [...units].sort((a, b) => {
                const distA = Math.hypot(a.x - homeBase.x, a.y - homeBase.y);
                const distB = Math.hypot(b.x - homeBase.x, b.y - homeBase.y);
                return distA - distB;
            });
            reserveUnits = sortedByHome.slice(0, Math.min(reserveCount, Math.max(0, units.length - 6)));
            assaultUnits = sortedByHome.slice(reserveUnits.length);
            if (assaultUnits.length === 0) {
                assaultUnits = units;
                reserveUnits = [];
            }
        }

        const now = Date.now();
        if (now - this.lastOrderTime > this.getAssaultOrderInterval()) { 
            reserveUnits.forEach(u => {
                if (!homeBase) return;
                const defendPoint = homeThreat
                    ? this.getAssaultPoint(gameState, u, homeThreat)
                    : this.getRallyOrderPoint(gameState, u, { x: homeBase.x, y: homeBase.y });
                this.issueOrder(gameState, u, defendPoint.x, defendPoint.y, 'ASSAULT_HOME_RESERVE');
            });
            assaultUnits.forEach(u => {
                const assaultPoint = this.getAssaultPoint(gameState, u, target);
                this.issueOrder(gameState, u, assaultPoint.x, assaultPoint.y, 'ASSAULT');
            });
            this.lastOrderTime = now;
            this.lastAssaultIssued = now;
            this.ordersIssuedCount++;
        }
        
        const sinceOrder = Date.now() - this.lastAssaultIssued;
        if (sinceOrder > 2000 && sinceOrder < 3000) {
            let idleCount = 0;
            units.forEach(u => {
                 if (u.status === 'idle') idleCount++;
            });
            
            const idleThreshold = units.length * 0.4;
            if (idleCount > idleThreshold) {
                this.lastOrderBlocked = true;
                this.lastPathOk = false;
                console.log(`[AttackManager] Anti-Idle Triggered: ${idleCount} units idle. Re-issuing orders.`);
                const nowForce = Date.now();
                reserveUnits.forEach(u => {
                    if (!homeBase) return;
                    const defendPoint = homeThreat
                        ? this.getAssaultPoint(gameState, u, homeThreat)
                        : this.getRallyOrderPoint(gameState, u, { x: homeBase.x, y: homeBase.y });
                    this.issueOrder(gameState, u, defendPoint.x, defendPoint.y, 'ASSAULT_HOME_RESERVE_FORCED');
                });
                assaultUnits.forEach(u => {
                    const assaultPoint = this.getAssaultPoint(gameState, u, target);
                    this.issueOrder(gameState, u, assaultPoint.x, assaultPoint.y, 'ASSAULT_FORCED');
                });
                this.lastOrderTime = nowForce;
                this.lastAssaultIssued = nowForce;
                this.ordersIssuedCount++;
            } else if (units.length > 0) {
                 this.ordersAppliedCount++;
                 this.lastPathOk = true;
            }
        }
    }

    private handleReassessState(gameState: GameState) {
        // AttackUntilWin Loop: Pick new target immediately
        this.currentTargetBase = this.pickEnemyHQTarget(gameState);
        
        if (this.currentTargetBase) {
            // Found a target -> Continue Assault
            this.transitionTo('ASSAULT', 'REASSESS_TARGET_FOUND');
        } else {
            // No enemies left at all -> Reset/Idle
            this.transitionTo('RESET', 'REASSESS_NO_TARGET');
        }
    }

    // --- Helpers ---

    private isCombatUnit(u: Unit): boolean {
        // Explicit Exclusion List (Workers/Support)
        const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
        
        // If it's a worker, it is NOT a combat unit
        if (workers.includes(u.type)) return false;
        
        // Treat all non-workers as combat-capable so AttackManager instrumentation
        // reflects naval/air assaults and does not stall in BUILD_ARMY on islands.
        return true;
    }
    
    private isWorkerUnit(u: Unit): boolean {
        const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
        return workers.includes(u.type);
    }

    private isLandCombatUnit(type: string): boolean {
        return ['soldier', 'sniper', 'rocketeer', 'tank', 'humvee', 'missile_launcher'].includes(type);
    }

    private findIslandForPoint(gameState: GameState, x: number, y: number): Island | null {
        for (const island of gameState.map.islands) {
            if (island.points) {
                if (MapGenerator.isPointInPolygon(x, y, island.points)) {
                    return island;
                }

                const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
                if (Math.hypot(x - closest.x, y - closest.y) < 35) {
                    return island;
                }
                continue;
            }

            if (Math.hypot(x - island.x, y - island.y) <= island.radius + 35) {
                return island;
            }
        }

        return null;
    }

    private islandsHaveGroundPath(gameState: GameState, fromIsland: Island, toIsland: Island): boolean {
        if (fromIsland.id === toIsland.id) return true;
        return !!gameState.findIslandPath(fromIsland.id, toIsland.id);
    }

    private clampPointToIslandInterior(
        island: Island,
        targetX: number,
        targetY: number,
        inset: number
    ): { x: number; y: number } {
        if (island.points && island.points.length > 2) {
            if (MapGenerator.isPointInPolygon(targetX, targetY, island.points)) {
                return { x: targetX, y: targetY };
            }

            const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, island.points);
            const angle = Math.atan2(closest.y - island.y, closest.x - island.x);
            return {
                x: closest.x - Math.cos(angle) * inset,
                y: closest.y - Math.sin(angle) * inset
            };
        }

        const dx = targetX - island.x;
        const dy = targetY - island.y;
        const dist = Math.hypot(dx, dy) || 1;
        const radius = Math.max(30, island.radius - inset);
        if (dist <= radius) {
            return { x: targetX, y: targetY };
        }

        return {
            x: island.x + (dx / dist) * radius,
            y: island.y + (dy / dist) * radius
        };
    }

    private findNearestValidPoint(
        gameState: GameState,
        unitType: string,
        origin: { x: number; y: number },
        preferredIsland: Island | null = null
    ): { x: number; y: number } {
        const seed = preferredIsland
            ? this.clampPointToIslandInterior(preferredIsland, origin.x, origin.y, 28)
            : gameState.adjustTarget(unitType, origin.x, origin.y);

        if (gameState.isValidPosition(seed.x, seed.y, unitType)) {
            return seed;
        }

        const radii = [24, 48, 72, 96, 132, 168, 220];
        for (const radius of radii) {
            for (let i = 0; i < 20; i++) {
                const angle = (i / 20) * Math.PI * 2;
                const probe = {
                    x: seed.x + Math.cos(angle) * radius,
                    y: seed.y + Math.sin(angle) * radius
                };
                const candidate = preferredIsland
                    ? this.clampPointToIslandInterior(preferredIsland, probe.x, probe.y, 20)
                    : gameState.adjustTarget(unitType, probe.x, probe.y);
                if (gameState.isValidPosition(candidate.x, candidate.y, unitType)) {
                    return candidate;
                }
            }
        }

        return seed;
    }

    private getRallyOrderPoint(
        gameState: GameState,
        unit: Unit,
        rally: { x: number; y: number }
    ): { x: number; y: number } {
        if (!this.isLandCombatUnit(unit.type)) {
            return this.findNearestValidPoint(gameState, unit.type, rally);
        }

        const unitIsland = this.findIslandForPoint(gameState, unit.x, unit.y);
        return this.findNearestValidPoint(gameState, unit.type, rally, unitIsland);
    }

    private getBridgeEndpoints(gameState: GameState, bridge: any): { ax: number; ay: number; bx: number; by: number } | null {
        return gameState.getBridgeEndpoints(bridge);
    }

    private isLineBlockedByEnemyWalls(
        gameState: GameState,
        from: { x: number; y: number },
        to: { x: number; y: number },
        enemyOwnerId: string
    ): boolean {
        return gameState.map.bridges.some(bridge => {
            if (bridge.ownerId !== enemyOwnerId || bridge.type !== 'wall') return false;
            const endpoints = this.getBridgeEndpoints(gameState, bridge);
            if (!endpoints) return false;
            return MapGenerator.segmentsIntersect(
                from.x,
                from.y,
                to.x,
                to.y,
                endpoints.ax,
                endpoints.ay,
                endpoints.bx,
                endpoints.by
            );
        });
    }

    private findGateEntryPoint(
        gameState: GameState,
        target: { x: number; y: number; ownerId?: string; type: string }
    ): { x: number; y: number } | null {
        if (target.type !== 'base' || !target.ownerId) return null;

        const gates = gameState.map.bridges.filter(bridge => bridge.ownerId === target.ownerId && bridge.type === 'gate');
        if (gates.length === 0) return null;

        let bestGate: { x: number; y: number; score: number } | null = null;
        for (const gate of gates) {
            const endpoints = this.getBridgeEndpoints(gameState, gate);
            if (!endpoints) continue;

            const midpoint = {
                x: (endpoints.ax + endpoints.bx) * 0.5,
                y: (endpoints.ay + endpoints.by) * 0.5
            };
            const towardBaseX = target.x - midpoint.x;
            const towardBaseY = target.y - midpoint.y;
            const towardBaseDist = Math.hypot(towardBaseX, towardBaseY) || 1;
            const entryPoint = {
                x: midpoint.x + (towardBaseX / towardBaseDist) * 24,
                y: midpoint.y + (towardBaseY / towardBaseDist) * 24
            };
            const score = Math.hypot(entryPoint.x - target.x, entryPoint.y - target.y);
            if (!bestGate || score < bestGate.score) {
                bestGate = { x: entryPoint.x, y: entryPoint.y, score };
            }
        }

        if (!bestGate) return null;
        return { x: bestGate.x, y: bestGate.y };
    }

    private findGatePassagePoint(
        gameState: GameState,
        unit: Unit,
        target: { x: number; y: number; ownerId?: string; type: string }
    ): { x: number; y: number } | null {
        if (target.type !== 'base' || !target.ownerId) return null;

        const gates = gameState.map.bridges.filter(bridge => bridge.ownerId === target.ownerId && bridge.type === 'gate');
        if (gates.length === 0) return null;

        let bestGate: { midpoint: { x: number; y: number }; inner: { x: number; y: number }; score: number } | null = null;
        for (const gate of gates) {
            const endpoints = this.getBridgeEndpoints(gameState, gate);
            if (!endpoints) continue;

            const midpoint = {
                x: (endpoints.ax + endpoints.bx) * 0.5,
                y: (endpoints.ay + endpoints.by) * 0.5
            };
            const towardBaseX = target.x - midpoint.x;
            const towardBaseY = target.y - midpoint.y;
            const towardBaseDist = Math.hypot(towardBaseX, towardBaseY) || 1;
            const inner = {
                x: midpoint.x + (towardBaseX / towardBaseDist) * 96,
                y: midpoint.y + (towardBaseY / towardBaseDist) * 96
            };
            const score =
                Math.hypot(unit.x - midpoint.x, unit.y - midpoint.y) * 0.7 +
                Math.hypot(target.x - midpoint.x, target.y - midpoint.y);
            if (!bestGate || score < bestGate.score) {
                bestGate = { midpoint, inner, score };
            }
        }

        if (!bestGate) return null;

        const distToMidpoint = Math.hypot(unit.x - bestGate.midpoint.x, unit.y - bestGate.midpoint.y);
        const distToInner = Math.hypot(unit.x - bestGate.inner.x, unit.y - bestGate.inner.y);
        if (distToInner <= 140) {
            return { x: target.x, y: target.y };
        }
        if (distToMidpoint <= 120) {
            return bestGate.inner;
        }
        return bestGate.midpoint;
    }

    private findNearestEnemyWallNode(
        gameState: GameState,
        target: { x: number; y: number; ownerId?: string; type: string }
    ): { x: number; y: number } | null {
        if (!target.ownerId) return null;

        let bestNode: { x: number; y: number; dist: number } | null = null;
        for (const island of gameState.map.islands) {
            for (const building of island.buildings) {
                if (building.ownerId !== target.ownerId || building.type !== 'wall_node') continue;
                const absX = island.x + (building.x || 0);
                const absY = island.y + (building.y || 0);
                const dist = Math.hypot(absX - target.x, absY - target.y);
                if (!bestNode || dist < bestNode.dist) {
                    bestNode = { x: absX, y: absY, dist };
                }
            }
        }

        if (!bestNode) return null;
        return { x: bestNode.x, y: bestNode.y };
    }

    // Universal Target Selection (User Requirement 1 & 2)
    private pickEnemyHQTarget(gameState: GameState): { id: string, x: number, y: number, ownerId?: string, type: string } | null {
        const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
        const startX = myBase ? myBase.x : 0;
        const startY = myBase ? myBase.y : 0;

        // 1. Identify all enemy bases (Scan Map)
        const enemyBases: { id: string, x: number, y: number, ownerId: string, type: string, isBot: boolean }[] = [];
        let totalEnemyHQs = 0;
        
        gameState.map.islands.forEach(i => {
             // Look for any base not owned by me
             const base = i.buildings.find(b => b.type === 'base' && b.ownerId && b.ownerId !== this.bot.playerId);
             if (base && base.ownerId) {
                 totalEnemyHQs++;
                 const player = gameState.players.get(base.ownerId);
                 const isBot = player?.isBot ?? true; 
                 
                 enemyBases.push({ 
                     id: base.id, 
                     x: i.x + (base.x||0), 
                     y: i.y + (base.y||0), 
                     ownerId: base.ownerId, 
                     type: 'base',
                     isBot: isBot
                 });
             }
        });

        // B4: Log if null
        if (enemyBases.length === 0) {
            console.log(`[AttackManager] Bot ${this.bot.playerId} pickEnemyHQTarget: 0 targets found. Total HQs detected: ${totalEnemyHQs} (Reason: All friendly/dead or filtered)`);
            return this.findHighValueTarget(gameState);
        }

        if (this.state === 'ASSAULT' && this.bot.difficulty >= 8) {
            return this.findNearest(enemyBases, startX, startY);
        }

        const phase = this.bot.getMatchPhase();
        const myOilCount = this.getOwnedOilStructureCount(gameState);
        const enemyOilTargets = this.getEnemyOilInfrastructureTargets(gameState);
        const enemyEconomicTargets = [
            ...enemyOilTargets,
            ...this.getEnemyLandEconomicTargets(gameState)
        ];
        const elapsedSec = (Date.now() - this.bot.startTime) / 1000;
        const shouldHarassEconomy =
            this.bot.difficulty >= 5 &&
            this.bot.difficulty <= 8 &&
            gameState.mapType === 'islands' &&
            enemyEconomicTargets.length > 0 &&
            (
                (phase === 'EARLY' && myOilCount <= 0) ||
                (phase === 'MID' && elapsedSec < 150 && myOilCount <= 0)
            );
        if (shouldHarassEconomy) {
            return this.findNearest(enemyEconomicTargets, startX, startY);
        }

        if (enemyOilTargets.length > 0 && phase !== 'EARLY' && this.bot.difficulty >= 6) {
            return this.findNearest(enemyOilTargets, startX, startY);
        }

        // 2. Pools
        const humanBases = enemyBases.filter(b => !b.isBot);
        const botBases = enemyBases.filter(b => b.isBot);

        // 3. Selection Policy (User Requirement 3)
        // Difficulty >= 8: Prioritize Humans
        if (this.bot.difficulty >= 8) {
            if (humanBases.length > 0) return this.findNearest(humanBases, startX, startY);
            if (botBases.length > 0) return this.findNearest(botBases, startX, startY);
        }

        // Default: Nearest Enemy (Human or Bot)
        // C3: Ensure player aggression doesn't halt after players die (botBases are valid targets)
        return this.findNearest(enemyBases, startX, startY);
    }

    private getOwnedOilStructureCount(gameState: GameState): number {
        return gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.bot.playerId).length;
    }

    private getEnemyLandEconomicTargets(gameState: GameState): Array<{ id: string; x: number; y: number; ownerId?: string; type: string }> {
        const targets: Array<{ id: string; x: number; y: number; ownerId?: string; type: string }> = [];

        gameState.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (!building.ownerId || building.ownerId === this.bot.playerId) return;
                if (!['oil_well', 'mine', 'dock', 'barracks', 'tank_factory'].includes(building.type)) return;
                targets.push({
                    id: building.id,
                    x: island.x + (building.x || 0),
                    y: island.y + (building.y || 0),
                    ownerId: building.ownerId,
                    type: building.type
                });
            });
        });

        return targets;
    }

    private getEnemyOilInfrastructureTargets(gameState: GameState): Array<{ id: string; x: number; y: number; ownerId?: string; type: string }> {
        const targets: Array<{ id: string; x: number; y: number; ownerId?: string; type: string }> = [];

        gameState.map.islands.forEach(island => {
            island.buildings.forEach(building => {
                if (!building.ownerId || building.ownerId === this.bot.playerId) return;
                if (!['oil_well', 'oil_rig'].includes(building.type)) return;
                targets.push({
                    id: building.id,
                    x: island.x + (building.x || 0),
                    y: island.y + (building.y || 0),
                    ownerId: building.ownerId,
                    type: building.type
                });
            });
        });

        if (gameState.mapType === 'islands') {
            gameState.map.oilSpots.forEach(spot => {
                const ownerId = (spot as any).ownerId;
                const occupiedBy = (spot as any).occupiedBy;
                if (!ownerId || ownerId === this.bot.playerId || !occupiedBy) return;
                targets.push({
                    id: `oil_spot_${spot.id}`,
                    x: spot.x,
                    y: spot.y,
                    ownerId,
                    type: 'oil_spot'
                });
            });
        }

        return targets;
    }

    private findNearest<T extends {x: number, y: number}>(targets: T[], startX: number, startY: number): T {
        let best = targets[0];
        let minD = Infinity;
        
        for (const t of targets) {
            const d = Math.hypot(t.x - startX, t.y - startY);
            if (d < minD) {
                minD = d;
                best = t;
            }
        }
        return best;
    }
    
    private findBaseForPlayer(gameState: GameState, playerId: string) {
        for (const i of gameState.map.islands) {
            const base = i.buildings.find(b => b.type === 'base' && b.ownerId === playerId);
            if (base) return { id: base.id, x: i.x + (base.x||0), y: i.y + (base.y||0), ownerId: playerId, type: 'base' };
        }
        return null;
    }

    private findHighValueTarget(gameState: GameState) {
        const enemyEconomicTargets = [
            ...this.getEnemyOilInfrastructureTargets(gameState),
            ...this.getEnemyLandEconomicTargets(gameState)
        ];
        if (this.bot.difficulty >= 6 && enemyEconomicTargets.length > 0) {
            const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
            const startX = myBase ? myBase.x : 0;
            const startY = myBase ? myBase.y : 0;
            return this.findNearest(enemyEconomicTargets, startX, startY);
        }

        // Fallback: Random enemy building or unit
        const enemies = gameState.units.filter(u => u.ownerId !== this.bot.playerId);
        if (enemies.length > 0) return { id: enemies[0].id, x: enemies[0].x, y: enemies[0].y, ownerId: enemies[0].ownerId, type: enemies[0].type };
        
        // Check islands
        for (const i of gameState.map.islands) {
             if (i.ownerId && i.ownerId !== this.bot.playerId) {
                 if (i.buildings.length > 0) {
                     const b = i.buildings[0];
                     return { id: b.id, x: i.x + (b.x||0), y: i.y + (b.y||0), ownerId: i.ownerId, type: b.type };
                 }
             }
        }
        return null;
    }

    private findHomeThreat(
        gameState: GameState,
        homeBase: { id: string; x: number; y: number; ownerId?: string; type: string },
        radius: number
    ): { id: string; x: number; y: number; ownerId?: string; type: string } | null {
        const enemyUnits = gameState.units
            .filter(unit => unit.ownerId !== this.bot.playerId)
            .map(unit => ({ id: unit.id, x: unit.x, y: unit.y, ownerId: unit.ownerId, type: unit.type }))
            .filter(unit => Math.hypot(unit.x - homeBase.x, unit.y - homeBase.y) <= radius);

        if (enemyUnits.length > 0) {
            return this.findNearest(enemyUnits, homeBase.x, homeBase.y);
        }

        const enemyBuildings = gameState.map.islands
            .flatMap(island =>
                island.buildings
                    .filter(building => building.ownerId && building.ownerId !== this.bot.playerId)
                    .map(building => ({
                        id: building.id,
                        x: island.x + (building.x || 0),
                        y: island.y + (building.y || 0),
                        ownerId: building.ownerId,
                        type: building.type
                    }))
            )
            .filter(building => Math.hypot(building.x - homeBase.x, building.y - homeBase.y) <= radius);

        if (enemyBuildings.length > 0) {
            return this.findNearest(enemyBuildings, homeBase.x, homeBase.y);
        }

        return null;
    }

    private calculateRallyPoint(gameState: GameState, target: {x: number, y: number}): {x: number, y: number} {
        // 5) Rally Logic
        const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
        const startX = myBase ? myBase.x : 0;
        const startY = myBase ? myBase.y : 0;
        
        const angle = Math.atan2(target.y - startY, target.x - startX);
        const distToTarget = Math.hypot(target.x - startX, target.y - startY);
        
        const baseIsland = myBase ? this.findIslandForPoint(gameState, startX, startY) : null;
        const maxRallyDist = baseIsland ? Math.max(120, baseIsland.radius - 80) : 400;
        const rallyDist = Math.max(120, Math.min(distToTarget - 100, maxRallyDist));
        const coalitionWeight = this.bot.strategyProfile.coordinationWeight;
        const hash = Array.from(this.bot.playerId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const side = coalitionWeight >= 0.7 ? ((hash % 3) - 1) * 140 : 0;
        const perpendicularX = -Math.sin(angle);
        const perpendicularY = Math.cos(angle);

        const rally = {
            x: startX + Math.cos(angle) * rallyDist + perpendicularX * side,
            y: startY + Math.sin(angle) * rallyDist + perpendicularY * side
        };

        if (baseIsland) {
            return this.findNearestValidPoint(gameState, 'soldier', rally, baseIsland);
        }

        return rally;
    }

    private isValidTarget(gameState: GameState, target: { id: string, type: string } | null): boolean {
        if (!target) return false;

        if (target.type === 'oil_spot') {
            const spotId = target.id.startsWith('oil_spot_') ? target.id.replace('oil_spot_', '') : target.id;
            const spot = gameState.map.oilSpots.find(candidate => candidate.id === spotId);
            if (!spot) return false;
            const ownerId = (spot as any).ownerId;
            const occupiedBy = (spot as any).occupiedBy;
            return !!ownerId && ownerId !== this.bot.playerId && !!occupiedBy;
        }
        
        // Check if entity exists
        // Unit?
        const u = gameState.units.find(u => u.id === target.id);
        if (u) return true;
        
        // Building?
        for (const i of gameState.map.islands) {
            const b = i.buildings.find(b => b.id === target.id);
            if (b) return true;
        }
        
        return false;
    }

    private issueOrder(gameState: GameState, unit: Unit, x: number, y: number, type: string) {
        if (this.isWorkerUnit(unit)) {
             if (this.combatUnits.has(unit.id)) {
                 console.log(`[AttackManager] Removed non-combat unit from group unitId=${unit.id} type=${unit.type}`);
                 this.combatUnits.delete(unit.id);
             }
             return; // Block order
        }

        if (x < 0 || x > gameState.map.width || y < 0 || y > gameState.map.height) return;
        
        this.bot.requestMovePriority(gameState, unit.id, x, y);
    }

    private getAssaultPoint(
        gameState: GameState,
        unit: Unit,
        target: { x: number; y: number; ownerId?: string; type: string }
    ): { x: number; y: number } {
        const isNavalAssaultUnit = ['destroyer', 'pirate_ship', 'submarine', 'battleship', 'aircraft_carrier'].includes(unit.type);
        if (isNavalAssaultUnit && target.type === 'base') {
            const navalPoint = this.getNavalBaseAssaultPoint(gameState, unit, target);
            if (navalPoint) return navalPoint;
        }

        let effectiveTarget = { x: target.x, y: target.y };
        let breachApproach = false;
        if (
            this.isLandCombatUnit(unit.type) &&
            target.ownerId &&
            target.type === 'base' &&
            this.isLineBlockedByEnemyWalls(
                gameState,
                { x: unit.x, y: unit.y },
                { x: target.x, y: target.y },
                target.ownerId
            )
        ) {
            const gateEntry = this.findGatePassagePoint(gameState, unit, target);
            const breachTarget = gateEntry || this.findNearestEnemyWallNode(gameState, target);
            if (breachTarget) {
                effectiveTarget = breachTarget;
                breachApproach = !(breachTarget.x === target.x && breachTarget.y === target.y);
            }
        }

        const unitIsland = this.isLandCombatUnit(unit.type)
            ? this.findIslandForPoint(gameState, unit.x, unit.y)
            : null;
        const targetIsland = this.isLandCombatUnit(unit.type)
            ? this.findIslandForPoint(gameState, effectiveTarget.x, effectiveTarget.y)
            : null;

        if (
            this.isLandCombatUnit(unit.type) &&
            unitIsland &&
            targetIsland &&
            !this.islandsHaveGroundPath(gameState, unitIsland, targetIsland)
        ) {
            return this.findNearestValidPoint(gameState, unit.type, effectiveTarget, unitIsland);
        }

        const dx = effectiveTarget.x - unit.x;
        const dy = effectiveTarget.y - unit.y;
        const dist = Math.hypot(dx, dy) || 1;
        let desiredOffset = Math.max(45, Math.min(unit.range * 0.75, 140));
        const isRangedSiegeUnit = unit.type === 'rocketeer' || unit.type === 'missile_launcher';

        if (unit.type === 'aircraft_carrier') desiredOffset = 360;
        else if (unit.type === 'mothership') desiredOffset = 280;
        else if (unit.type === 'destroyer') desiredOffset = Math.max(desiredOffset, 180);
        else if (unit.type === 'pirate_ship') desiredOffset = Math.max(desiredOffset, 150);
        else if (unit.type === 'light_plane' || unit.type === 'heavy_plane') desiredOffset = Math.max(80, Math.min(unit.range * 0.65, 140));
        else if (breachApproach) desiredOffset = 0;
        else if (this.isLandCombatUnit(unit.type) && target.type === 'base') {
            desiredOffset = isRangedSiegeUnit
                ? Math.max(desiredOffset, Math.min(unit.range * 0.85, 180))
                : Math.min(desiredOffset, 20);
        }

        const coalitionWeight = this.bot.strategyProfile.coordinationWeight;
        const hash = Array.from(unit.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const laneOffset = breachApproach
            ? ((hash % 5) - 2) * 22
            : coalitionWeight >= 0.7
                ? ((hash % 3) - 1) * 70
                : 0;
        const normalX = -dy / dist;
        const normalY = dx / dist;

        const primary = {
            x: effectiveTarget.x - (dx / dist) * desiredOffset + normalX * laneOffset,
            y: effectiveTarget.y - (dy / dist) * desiredOffset + normalY * laneOffset
        };
        const primaryCandidate = this.findNearestValidPoint(gameState, unit.type, primary, targetIsland || unitIsland);
        if (gameState.isValidPosition(primaryCandidate.x, primaryCandidate.y, unit.type)) {
            return primaryCandidate;
        }

        const radii = [desiredOffset, desiredOffset + 30, desiredOffset + 60, desiredOffset + 90];
        for (const radius of radii) {
            for (let i = 0; i < 16; i++) {
                const angle = (i / 16) * Math.PI * 2;
                const candidate = {
                    x: effectiveTarget.x + Math.cos(angle) * radius,
                    y: effectiveTarget.y + Math.sin(angle) * radius
                };
                const resolvedCandidate = this.findNearestValidPoint(gameState, unit.type, candidate, targetIsland || unitIsland);
                if (gameState.isValidPosition(resolvedCandidate.x, resolvedCandidate.y, unit.type)) {
                    return resolvedCandidate;
                }
            }
        }

        return this.findNearestValidPoint(gameState, unit.type, effectiveTarget, targetIsland || unitIsland);
    }

    private getNavalBaseAssaultPoint(
        gameState: GameState,
        unit: Unit,
        target: { x: number; y: number; ownerId?: string; type: string }
    ): { x: number; y: number } | null {
        const preferredRadii = [
            Math.max(70, unit.range * 0.5),
            Math.max(85, unit.range * 0.6),
            Math.max(100, unit.range * 0.7),
            Math.max(120, unit.range * 0.8)
        ];

        let best: { x: number; y: number; score: number } | null = null;
        for (const radius of preferredRadii) {
            for (let i = 0; i < 32; i++) {
                const angle = (i / 32) * Math.PI * 2;
                const probe = {
                    x: target.x + Math.cos(angle) * radius,
                    y: target.y + Math.sin(angle) * radius
                };
                const candidate = this.findNearestValidPoint(gameState, unit.type, probe);
                if (!gameState.isValidPosition(candidate.x, candidate.y, unit.type)) continue;

                const toTarget = Math.hypot(candidate.x - target.x, candidate.y - target.y);
                const desiredStrikeRange = Math.min(Math.max(95, unit.range * 0.66), unit.range * 0.82);
                const strikeRangePenalty = Math.abs(toTarget - desiredStrikeRange) * 1.35;
                const rangePenalty = toTarget > unit.range * 0.9 ? (toTarget - unit.range * 0.9) * 5 : 0;
                const score =
                    Math.hypot(candidate.x - unit.x, candidate.y - unit.y) +
                    strikeRangePenalty +
                    rangePenalty;
                if (!best || score < best.score) {
                    best = { x: candidate.x, y: candidate.y, score };
                }
            }
        }

        if (!best) return null;
        return { x: best.x, y: best.y };
    }

    private updateDebugState(armySize: number, requiredArmySize: number, timeSinceLastAttack: number) {
        // 7) Debug Overlay
        const now = Date.now();
        this.bot.debugState.attackManager = {
            state: this.state,
            armySize: armySize,
            requiredSize: requiredArmySize,
            timeSinceAttack: Math.floor(timeSinceLastAttack / 1000),
            targetId: this.currentTargetBase?.id || 'None',
            targetType: this.currentTargetBase?.type || 'None',
            rally: this.rallyPoint,
            targetPos: this.currentTargetBase ? {x: this.currentTargetBase.x, y: this.currentTargetBase.y} : null,
            blockReason: this.lastBlockReason,
            stateTimeSec: Math.floor((now - this.stateStartTime) / 1000),
            lastOrderSec: this.lastOrderTime > 0 ? Number(((now - this.lastOrderTime) / 1000).toFixed(1)) : null,
            ordersIssued: this.ordersIssuedCount,
            ordersApplied: this.ordersAppliedCount,
            lastOrderBlocked: this.lastOrderBlocked,
            lastPathOk: this.lastPathOk,
            lastTransitionReason: this.lastTransitionReason,
            fortificationHpEstimate: this.lastFortificationHpEstimate,
            requiredAssaultPower: this.lastRequiredAssaultPower,
            rosterAssaultPower: this.lastRosterAssaultPower,
            requiredUnitsFromPower: this.lastRequiredUnitsFromPower
        };
        
        // Draw debug lines
        if (this.currentTargetBase && this.bot.debugState.intents) {
             const myBase = {x:0, y:0}; // rough approximation
             this.bot.debugState.intents.push({
                 type: 'debug_line',
                 from: myBase,
                 to: {x: this.currentTargetBase.x, y: this.currentTargetBase.y},
                 color: 'red',
                 label: 'Target'
             });
        }
    }
}
