import { GameState, Unit, Player } from './GameState';
import { BotAI, DifficultyConfig } from './BotAI';

export type AttackState = 'BUILD_ARMY' | 'RALLY' | 'ASSAULT' | 'REASSESS' | 'RESET';

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

        // Failsafe time
        // L1: 360s, L5: 240s, L10: 120s
        if (bot.difficulty <= 1) this.maxWaitTime = 360000;
        else if (bot.difficulty <= 5) this.maxWaitTime = 240000;
        else this.maxWaitTime = 120000;
    }

    public update(gameState: GameState, myUnits: Unit[]) {
        const allCombatUnits = myUnits.filter(u => this.isCombatUnit(u));
        
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
                else if (armySize < this.minArmySize) blockReason = 'INSUFFICIENT_ARMY';
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

             console.log(
                 `[MOBILISE_DIAG] botId=${this.bot.playerId} lvl=${this.bot.difficulty} state=${this.state}` +
                 ` groupCombat=${armySize} req=${this.minArmySize}` +
                 ` elapsed=${elapsedGameTime.toFixed(1)} atkStart=${this.attackStartTimeSec}` +
                 ` rallyPct=${rallyPctStr} rallySec=${rallySec}` +
                 ` targetHQ=${targetId} targetDist=${targetDist}` +
                 ` lastOrderSec=${lastOrderSec}` +
                 ` orderBlocked=${orderBlocked} blockReason=${blockReason}` +
                 ` stateResets=${this.stateResetCount}` +
                 ` pathOk=${pathOk}` +
                 ` ordersIssued=${this.ordersIssuedCount} ordersApplied=${this.ordersAppliedCount}`
             );
             this.lastTickLog = now;
             this.lastOrderBlocked = false;
        }

        if (armySize === 0 && this.state !== 'BUILD_ARMY' && this.state !== 'RESET') {
             console.log(`Bot ${this.bot.playerId} Army wiped out -> Resetting`);
             this.transitionTo('RESET');
             return;
        }

        switch (this.state) {
            case 'BUILD_ARMY':
                // 3) Make “Mobilise Trigger” explicit (no ambiguity)
                // If elapsed >= attackStartTimeSec AND combatGroupSize >= requiredGroupSize AND target != null
                const timeInBuild = Date.now() - this.stateStartTime;
                const isFailsafe = timeInBuild > this.maxWaitTime && armySize > 0;

                if ((elapsedGameTime >= this.attackStartTimeSec && armySize >= this.minArmySize) || isFailsafe) {
                     if (isFailsafe) console.log(`[AttackManager] Bot ${this.bot.playerId} Failsafe Triggered: Moving to RALLY with ${armySize} units (Wait: ${Math.floor(timeInBuild/1000)}s)`);

                     const target = this.pickEnemyHQTarget(gameState);
                     if (target) {
                         this.currentTargetBase = target;
                         this.transitionTo('RALLY'); // MOBILISE
                     } else {
                         // Force find any target
                         const fallback = this.findHighValueTarget(gameState);
                         if (fallback) {
                             this.currentTargetBase = fallback;
                             this.transitionTo('RALLY');
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
                this.transitionTo('BUILD_ARMY');
                break;
        }

        // Debug Overlay Data Update
        this.updateDebugState(armySize, Date.now() - this.lastAttackTime);
    }

    private transitionTo(newState: AttackState) {
        console.log(`Bot ${this.bot.playerId} AttackManager: ${this.state} -> ${newState}`);
        this.state = newState;
        this.stateStartTime = Date.now();
        
        if (newState === 'BUILD_ARMY') {
            this.currentTargetBase = null;
            this.rallyPoint = null;
        }
        if (newState === 'ASSAULT') {
            this.lastAssaultIssued = 0; // Reset to force immediate order
        }
    }

    private handleRallyState(gameState: GameState, units: Unit[], rallyPct: number) {
        // 1. Pick Target if none
        if (!this.currentTargetBase) {
            this.currentTargetBase = this.pickEnemyHQTarget(gameState);
            if (!this.currentTargetBase) {
                // No targets? Wait.
                this.transitionTo('RESET');
                return;
            }
        }

        // 2. Pick Rally Point if none
        if (!this.rallyPoint) {
            this.rallyPoint = this.calculateRallyPoint(gameState, this.currentTargetBase);
        }

        const rally = this.rallyPoint!;
        
        const now = Date.now();
        if (now - this.lastOrderTime > 3000) {
            units.forEach(u => {
                const dist = Math.hypot(u.x - rally.x, u.y - rally.y);
                if (dist > 300 || u.status === 'idle') { 
                     this.issueOrder(gameState, u, rally.x, rally.y, 'RALLY');
                }
            });
            this.lastOrderTime = now;
            this.ordersIssuedCount++;
        }

        // 4. Check Transition (Explicit Assault Trigger)
        // If rallyPct >= 55% OR rallyTime >= 8s
        const timeInState = Date.now() - this.stateStartTime;
        
        if (rallyPct >= 0.55 || timeInState > 8000) { 
            console.log(`[AttackManager] Rally Complete: Pct=${rallyPct.toFixed(2)} Time=${timeInState}ms`);
            this.transitionTo('ASSAULT');
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
                 this.transitionTo('REASSESS'); 
                 return;
            }
            
            this.transitionTo('REASSESS');
            return;
        }

        const target = this.currentTargetBase!;

        const now = Date.now();
        if (now - this.lastOrderTime > 4000) { 
            units.forEach(u => {
                this.issueOrder(gameState, u, target.x, target.y, 'ASSAULT');
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
                 units.forEach(u => {
                    this.issueOrder(gameState, u, target.x, target.y, 'ASSAULT_FORCED');
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
            this.transitionTo('ASSAULT');
        } else {
            // No enemies left at all -> Reset/Idle
            this.transitionTo('RESET');
        }
    }

    // --- Helpers ---

    private isCombatUnit(u: Unit): boolean {
        // Explicit Exclusion List (Workers/Support)
        const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
        
        // If it's a worker, it is NOT a combat unit
        if (workers.includes(u.type)) return false;
        
        // Explicit Inclusion List (Combat) - strictly for documentation/verification
        // soldier, sniper, rocketeer, tank, humvee, missile_launcher, destroyer, 
        // light_plane, heavy_plane, aircraft_carrier, mothership, alien_scout, heavy_alien
        
        return true;
    }
    
    private isWorkerUnit(u: Unit): boolean {
        const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
        return workers.includes(u.type);
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

    private calculateRallyPoint(gameState: GameState, target: {x: number, y: number}): {x: number, y: number} {
        // 5) Rally Logic
        const myBase = this.findBaseForPlayer(gameState, this.bot.playerId);
        const startX = myBase ? myBase.x : 0;
        const startY = myBase ? myBase.y : 0;
        
        const angle = Math.atan2(target.y - startY, target.x - startX);
        const distToTarget = Math.hypot(target.x - startX, target.y - startY);
        
        // User Requirement: Rally briefly AT BASE
        // Rally 300-500px outside base in direction of target
        const rallyDist = Math.min(distToTarget - 100, 400); 
        
        return {
            x: startX + Math.cos(angle) * rallyDist,
            y: startY + Math.sin(angle) * rallyDist
        };
    }

    private isValidTarget(gameState: GameState, target: { id: string, type: string } | null): boolean {
        if (!target) return false;
        
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

    private updateDebugState(armySize: number, timeSinceLastAttack: number) {
        // 7) Debug Overlay
        this.bot.debugState.attackManager = {
            state: this.state,
            armySize: armySize,
            requiredSize: this.minArmySize,
            timeSinceAttack: Math.floor(timeSinceLastAttack / 1000),
            targetId: this.currentTargetBase?.id || 'None',
            targetType: this.currentTargetBase?.type || 'None',
            rally: this.rallyPoint,
            targetPos: this.currentTargetBase ? {x: this.currentTargetBase.x, y: this.currentTargetBase.y} : null
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
