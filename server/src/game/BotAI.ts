import { GameState, Unit, Player } from './GameState';
import { Island } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';
import { AttackManager } from './AttackManager';
import { BaseDefenseBuilder } from './BaseDefenseBuilder';

// --- CONFIGURATION TABLES ---
const THINK_INTERVALS = [2000, 1700, 1400, 1200, 1000, 850, 700, 600, 500, 400]; // ms
const MAX_APM = [25, 35, 45, 60, 75, 90, 110, 130, 155, 180];
const EXPAND_WEIGHTS = [0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20, 1.30, 1.45, 1.55];
const ATTACK_WEIGHTS = [0.35, 0.50, 0.65, 0.80, 0.95, 1.10, 1.25, 1.40, 1.50, 1.65];
const MIN_ARMY_PERC = [0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40];
const PLAYER_TARGET_BIAS = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80];
const BUILD_DELAY_MIN = [5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 500];
const BUILD_DELAY_MAX = [10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000];
const ATTACK_START_TIME = [90, 90, 90, 90, 90, 90, 60, 60, 60, 45]; // Sec

export const DifficultyConfig = (level: number) => {
    const i = Math.max(0, Math.min(9, level - 1));
    return {
        thinkInterval: THINK_INTERVALS[i],
        maxApm: MAX_APM[i],
        expandWeight: EXPAND_WEIGHTS[i],
        attackWeight: ATTACK_WEIGHTS[i],
        minArmyPerc: MIN_ARMY_PERC[i],
        playerBias: PLAYER_TARGET_BIAS[i],
        buildDelayMin: BUILD_DELAY_MIN[i],
        buildDelayMax: BUILD_DELAY_MAX[i],
        attackStartTime: ATTACK_START_TIME[i]
    };
};

export class BotAI {
  playerId: string;
  difficulty: number; // 1-10
  
  // Timing & State
  startTime: number;
  lastActionTime: number = 0;
  lastMeaningfulActionTime: number = 0;
  actionInterval: number; // Based on ThinkInterval
  timeToAirPhase: number;
  
  // Build Delay State
  lastBuildTime: number = 0;
  currentBuildDelay: number = 0;
  minBuildDelay: number;
  maxBuildDelay: number;
  
  // APM System
  apmTokens: number = 0;
  maxApmTokens: number;
  lastApmRefill: number = 0;
  
  // Strategy State
  private usedUnitIds: Set<string> = new Set();
  private revealedSpots: Set<string> = new Set();
  private oilSecured: boolean = false;
  private firstOilOnlineTime: number | null = null;
  private defenceReserveGold: number = 0;
  private openingStartedAt: number | null = null;
  private openingFirstActionAt: number | null = null;
  private unitLastPositions: Map<string, { x: number; y: number; lastMoveTime: number }> = new Map();
  private lastGateAutoTime: number = 0;
  
  // Debug State
  public debugState: any = {
      goalScores: [],
      currentGoal: 'Idle',
      apm: 0,
      nextThink: 0,
      lastDecision: '',
      target: null,
      intents: [], // Stores current tick's intents for visualization
      logs: []
  };

  public attackManager: AttackManager;
  public baseDefenseBuilder: BaseDefenseBuilder;

  // Air Commander State
    private airState = {
        mode: 'GATHER' as 'GATHER' | 'ATTACK',
        rallyPoint: null as { x: number, y: number } | null,
        targetEntityId: null as string | null,
        lastSquadCheck: 0
    };

    // Naval Commander State
    private navalState = {
        mode: 'NAVAL_BUILD_FLEET' as 'NAVAL_DEFEND_HOME' | 'NAVAL_ESCORT_OIL' | 'NAVAL_BUILD_FLEET' | 'NAVAL_STRIKE' | 'NAVAL_RESET',
        rallyPoint: null as { x: number, y: number } | null,
        targetEntityId: null as string | null,
        homeDefenders: new Set<string>(), // IDs of units assigned to home defence
        fleet: new Set<string>() // IDs of units in the main fleet
    };

    private logEvent(type: string, data: any) {
      const event = {
          type,
          tick: Date.now(),
          ...data
      };
      this.debugState.logs.push(event);
      if (this.debugState.logs.length > 50) this.debugState.logs.shift(); // Keep last 50
  }

  constructor(playerId: string, difficulty: number = 5) {
    this.playerId = playerId;
    this.difficulty = Math.max(1, Math.min(10, difficulty));
    this.startTime = Date.now();
    this.lastMeaningfulActionTime = this.startTime;
    
    const levelIdx = this.difficulty - 1;
    
    // 1. Difficulty Scaling
    this.actionInterval = THINK_INTERVALS[levelIdx];
    this.maxApmTokens = MAX_APM[levelIdx];
    this.apmTokens = this.maxApmTokens; // Start full
    this.minBuildDelay = BUILD_DELAY_MIN[levelIdx];
    this.maxBuildDelay = BUILD_DELAY_MAX[levelIdx];
    this.setNextBuildDelay();
    
    // Air Phase: 600 - (level-1)*(510/9)
    const airSec = 600 - (levelIdx) * (510 / 9);
    this.timeToAirPhase = airSec * 1000;

    this.attackManager = new AttackManager(this);
    this.baseDefenseBuilder = new BaseDefenseBuilder(this);

    console.log(`Bot ${playerId} (Diff ${difficulty}) Init: Think=${this.actionInterval}ms, MaxAPM=${this.maxApmTokens}, AirStart=${Math.round(airSec)}s`);
  }

  update(gameState: GameState) {
    const now = Date.now();

    // 1. Refill APM (Token Bucket)
    const timeDelta = now - this.lastApmRefill;
    if (timeDelta > 100) { // Update APM tokens periodically
         const tokensPerSec = this.maxApmTokens / 60;
         const tokensToAdd = tokensPerSec * (timeDelta / 1000);
         this.apmTokens = Math.min(this.maxApmTokens, this.apmTokens + tokensToAdd);
         this.lastApmRefill = now;
    }
    
    this.debugState.apm = Math.floor(this.apmTokens);
    this.debugState.nextThink = Math.max(0, (this.lastActionTime + this.actionInterval) - now);

    // C2: Aggression State Debug
    const config = DifficultyConfig(this.difficulty);
    const elapsedSec = (now - this.startTime) / 1000;
    const aggressionActive = elapsedSec >= config.attackStartTime;
    
    this.debugState.aggressionState = {
        elapsedTime: Math.floor(elapsedSec),
        attackStartTimeSec: config.attackStartTime,
        aggressionActive: aggressionActive,
        currentTargetType: this.debugState.attackManager?.targetType || 'None',
        playerBias: config.playerBias,
        attackWeight: config.attackWeight
    };

    // 2. Think Interval Check
    if (now - this.lastActionTime < this.actionInterval) return;
    this.lastActionTime = now;
    
    // 3. Reset Per-Tick State
    this.usedUnitIds.clear();
    this.debugState.intents = []; // Clear previous intents
    const player = gameState.players.get(this.playerId);
    if (!player) return;
    const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
    const myUnits = gameState.units.filter(u => u.ownerId === this.playerId);
    if (myIslands.length === 0 && myUnits.length === 0) return; // Dead

    // Let base defences act first with fresh APM/resources
    if (this.openingStartedAt === null) {
        this.openingStartedAt = now;
        console.log(`[BOT_OPENING] bot=${this.playerId} startedAt=${this.openingStartedAt}`);
    }
    const beforeDefenceActions = this.baseDefenseBuilder.debugState.lastAction;
    this.baseDefenseBuilder.tick(gameState, now);
    if (!this.openingFirstActionAt && this.baseDefenseBuilder.debugState.lastAction !== beforeDefenceActions) {
        this.openingFirstActionAt = now;
        console.log(`[BOT_OPENING] bot=${this.playerId} firstAction=${this.baseDefenseBuilder.debugState.lastAction} at=${this.openingFirstActionAt}`);
    }

    // 4. Update oil state and calculate Goal Scores
    this.updateOilSecured(gameState, player, myIslands, now);
    const scores = this.calculateGoalScores(gameState, player, myUnits);
    this.debugState.goalScores = scores;
    
    // Pick Winner
    const winner = scores.reduce((prev, current) => (prev.score > current.score) ? prev : current);
    
    if (this.debugState.currentGoal !== winner.goal) {
        this.logEvent('DECISION_MADE', { 
            goal: winner.goal, 
            score: winner.score,
            top3: scores.sort((a,b) => b.score - a.score).slice(0,3)
        });
    }
    
    this.debugState.currentGoal = winner.goal;
    
    // 5. Execute Strategy (Rate Limited by APM)
    // We try to execute the winner first. If we have APM, we might do secondary tasks.
    // For simplicity, we just run the logic blocks. The blocks themselves should check APM.
    
    if (winner.goal === 'EXPAND') {
        this.runMapStrategy(gameState, player, myIslands, myUnits);
        // If spare APM, maybe micro army a bit?
        if (this.apmTokens > 5) this.manageArmy(gameState, player, myUnits, myIslands);
    } else if (winner.goal === 'ATTACK') {
        this.manageArmy(gameState, player, myUnits, myIslands);
        // If spare APM, keep building?
        if (this.apmTokens > 5) this.runMapStrategy(gameState, player, myIslands, myUnits);
    } else {
        // DEFEND / IDLE
        this.manageArmy(gameState, player, myUnits, myIslands);
        this.runMapStrategy(gameState, player, myIslands, myUnits);
    }
    
    this.manageAirStrategy(gameState, player, myIslands, myUnits);
    this.attackManager.update(gameState, myUnits);
    this.detectAndHandleStuckUnits(gameState, myUnits, now);

    this.considerHQUpgrade(gameState, player);
    this.updateProgressionDebug(gameState, player, myIslands, myUnits, now);
    this.enforceCombatMinimum(gameState, player, myIslands, myUnits, now);
    this.enforceIdleRecovery(gameState, player, myIslands, myUnits, now);

    // Debug Event
    // if (Math.random() < 0.05) {
    //     // console.log(`Bot ${this.playerId} [${this.difficulty}] Decision: ${winner.goal} (${winner.score.toFixed(1)}) APM: ${this.apmTokens.toFixed(1)}`);
    // }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  private detectAndHandleStuckUnits(gameState: GameState, myUnits: Unit[], now: number) {
      const stuckCandidates: { unit: Unit; wallBridgeId: string; wallCenter: { x: number; y: number } }[] = [];
      const moveThreshold = 5;
      const stuckDuration = 1500;
      const wallProximityRadius = 80;

      const ownWalls = gameState.map.bridges.filter(
          b => b.ownerId === this.playerId && (b.type === 'wall' || b.type === 'gate')
      );
      if (ownWalls.length === 0) return;

      for (const u of myUnits) {
          if (!this.isCombatUnitType(u.type)) continue;
          if (u.status !== 'moving') continue;

          const prev = this.unitLastPositions.get(u.id);
          if (!prev) {
              this.unitLastPositions.set(u.id, { x: u.x, y: u.y, lastMoveTime: now });
              continue;
          }

          const distMoved = Math.hypot(u.x - prev.x, u.y - prev.y);
          if (distMoved > moveThreshold) {
              this.unitLastPositions.set(u.id, { x: u.x, y: u.y, lastMoveTime: now });
              continue;
          }

          if (now - prev.lastMoveTime < stuckDuration) continue;

          let closestBridge: any = null;
          let closestDist = Infinity;
          let closestCenter = { x: u.x, y: u.y };

          for (const bridge of ownWalls) {
              const iA = gameState.map.islands.find(i => i.id === bridge.islandAId);
              const iB = gameState.map.islands.find(i => i.id === bridge.islandBId);
              if (!iA || !iB) continue;
              const nA = iA.buildings.find(b => b.id === bridge.nodeAId);
              const nB = iB.buildings.find(b => b.id === bridge.nodeBId);
              if (!nA || !nB) continue;

              const ax = iA.x + (nA.x || 0);
              const ay = iA.y + (nA.y || 0);
              const bx = iB.x + (nB.x || 0);
              const by = iB.y + (nB.y || 0);

              const vx = bx - ax;
              const vy = by - ay;
              const wx = u.x - ax;
              const wy = u.y - ay;
              const lenSq = vx * vx + vy * vy || 1;
              let t = (wx * vx + wy * vy) / lenSq;
              if (t < 0) t = 0;
              if (t > 1) t = 1;
              const px = ax + vx * t;
              const py = ay + vy * t;
              const d = Math.hypot(u.x - px, u.y - py);

              if (d < closestDist) {
                  closestDist = d;
                  closestBridge = bridge;
                  closestCenter = { x: (ax + bx) / 2, y: (ay + by) / 2 };
              }
          }

          if (!closestBridge) continue;
          if (closestDist > wallProximityRadius) continue;

          stuckCandidates.push({ unit: u, wallBridgeId: closestBridge.id, wallCenter: closestCenter });
      }

      if (stuckCandidates.length === 0) return;

      const byBridge: Map<string, { center: { x: number; y: number }; units: Unit[] }> = new Map();
      for (const c of stuckCandidates) {
          let entry = byBridge.get(c.wallBridgeId);
          if (!entry) {
              entry = { center: c.wallCenter, units: [] };
              byBridge.set(c.wallBridgeId, entry);
          }
          entry.units.push(c.unit);
      }

      let bestBridgeId: string | null = null;
      let best = { center: { x: 0, y: 0 }, units: [] as Unit[] };
      for (const [id, entry] of byBridge.entries()) {
          if (entry.units.length >= 2 && entry.units.length > best.units.length) {
              bestBridgeId = id;
              best = entry;
          }
      }

      if (!bestBridgeId) return;

      const nowMs = now;
      if (nowMs - this.lastGateAutoTime < 20000) return;

      const targetBridge = gameState.map.bridges.find(b => b.id === bestBridgeId);
      if (!targetBridge) return;

      const hasNearbyGate = gameState.map.bridges.some(b => {
          if (b.type !== 'gate') return false;
          const iA = gameState.map.islands.find(i => i.id === b.islandAId);
          const iB = gameState.map.islands.find(i => i.id === b.islandBId);
          if (!iA || !iB) return false;
          const nA = iA.buildings.find(x => x.id === b.nodeAId);
          const nB = iB.buildings.find(x => x.id === b.nodeBId);
          if (!nA || !nB) return false;
          const ax = iA.x + (nA.x || 0);
          const ay = iA.y + (nA.y || 0);
          const bx = iB.x + (nB.x || 0);
          const by = iB.y + (nB.y || 0);
          const gx = (ax + bx) / 2;
          const gy = (ay + by) / 2;
          const d = Math.hypot(gx - best.center.x, gy - best.center.y);
          return d <= 200;
      });

      if (hasNearbyGate) return;

      const beforeType = targetBridge.type;
      if (beforeType === 'wall') {
          gameState.convertWallToGate(this.playerId, targetBridge.nodeAId, targetBridge.nodeBId);
          const afterBridge = gameState.map.bridges.find(b => b.id === targetBridge.id);
          const success = !!afterBridge && afterBridge.type === 'gate';
          this.lastGateAutoTime = nowMs;
          console.log(
              `[GATE_AUTO] bot=${this.playerId} stuckUnits=${best.units.length} upgradedGateAt=${best.center.x.toFixed(
                  0
              )},${best.center.y.toFixed(0)} success=${success}`
          );

          if (success) {
              best.units.forEach(u => {
                  if (this.usedUnitIds.has(u.id)) return;
                  this.moveUnitSafe(gameState, u.id, best.center.x, best.center.y);
              });
          }
      }
  }

  private markAction(now: number) {
      this.lastMeaningfulActionTime = now;
      this.debugState.lastActionTime = now;
  }

  private setNextBuildDelay() {
      this.currentBuildDelay = Math.random() * (this.maxBuildDelay - this.minBuildDelay) + this.minBuildDelay;
  }

  private canBuild(now: number): boolean {
      if (now - this.lastBuildTime >= this.currentBuildDelay) {
          return true;
      }
      return false;
  }

  private onBuild(now: number) {
      this.lastBuildTime = now;
      this.setNextBuildDelay();
      this.markAction(now);
  }

  // ==========================================
  // DECISION LOGIC
  // ==========================================
  
  private calculateGoalScores(gameState: GameState, player: Player, myUnits: Unit[]) {
      const levelIdx = this.difficulty - 1;
      const expandWeight = EXPAND_WEIGHTS[levelIdx];
      const attackWeight = ATTACK_WEIGHTS[levelIdx];
      const minArmyPerc = MIN_ARMY_PERC[levelIdx];

      // --- EXPAND SCORE ---
      // Base: 50
      // Boosts: High Resources, Idle Builders, No Buildings
      let expandScore = 50;
      if (player.resources.gold > 500) expandScore += 20;
      if (myUnits.some(u => u.type === 'builder' && u.status === 'idle')) expandScore += 30;
      expandScore *= expandWeight;

      // --- ATTACK SCORE ---
      // Base: Army Strength
      // Gate: Must have MinArmy% (Relative to some arbitrary cap, say 20 units for now)
      const combatUnits = myUnits.filter(u => !['builder', 'construction_ship', 'oil_seeker', 'ferry'].includes(u.type));
      const armySize = combatUnits.length;
      const armyCap = 20; // Soft cap for calculation
      const armyPerc = armySize / armyCap;
      
      let attackScore = 0;
      if (armyPerc >= minArmyPerc) {
          attackScore = (armyPerc * 100); // 0-100+
          attackScore *= attackWeight;
      }
      
      // --- DEFEND SCORE ---
      // If under attack (units taking damage or enemies near base)
      let defendScore = 0;
      // Simple check: Any enemies near my buildings?
      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const myBuildings = gameState.map.islands
          .filter(i => i.ownerId === this.playerId)
          .flatMap(i => i.buildings);
          
      for (const enemy of enemies) {
          for (const b of myBuildings) {
              if (Math.hypot(enemy.x - (b.x||0) - (b as any).islandX, enemy.y - (b.y||0) - (b as any).islandY) < 500) {
                  defendScore = 200; // Emergency Priority
                  break;
              }
          }
          if (defendScore > 0) break;
      }

      return [
          { goal: 'EXPAND', score: expandScore },
          { goal: 'ATTACK', score: attackScore },
          { goal: 'DEFEND', score: defendScore }
      ];
  }

  // ==========================================
  // MAP STRATEGIES
  // ==========================================

  private runMapStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      this.manageBaseDefences(gameState, player, myIslands);

      if (gameState.mapType === 'islands') {
          this.runIslandsStrategy(gameState, player, myIslands, myUnits);
      } else if (gameState.mapType === 'grasslands') {
          this.runGrasslandsStrategy(gameState, player, myIslands, myUnits);
      } else if (gameState.mapType === 'desert') {
          this.runDesertStrategy(gameState, player, myIslands, myUnits);
      } else {
          this.runIslandsStrategy(gameState, player, myIslands, myUnits);
      }
  }

  private runIslandsStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);

      workingIslands.forEach(island => {
          // 1. Gold Mines
          this.buildAvailableMines(gameState, player, island);

          // 2. Dock
          const docks = island.buildings.filter(b => b.type === 'dock').length;
          // Cap: L1-3=1, L4-6=2, L7-8=3, L9-10=4
          let dockCap = 1;
          if (this.difficulty >= 9) dockCap = 4;
          else if (this.difficulty >= 7) dockCap = 3;
          else if (this.difficulty >= 4) dockCap = 2;

          if (docks < dockCap && this.canAfford(player, 'dock')) {
               this.ensureBuilderAndBuild(gameState, island, 'dock');
          }
      });

      // 3. Naval Economy (Construction Ships)
      const hasDock = myIslands.some(i => i.buildings.some(b => b.type === 'dock'));
      if (hasDock) {
          const consShips = myUnits.filter(u => u.type === 'construction_ship').length;
          const desiredShips = Math.max(1, Math.floor(this.difficulty / 3));
          
          if (consShips < desiredShips) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
          }
      }

      // 4. Oil Expansion
      this.manageOffshoreOil(gameState, player, myUnits);

      // 5. Naval Military
      if (this.hasStableOil(player)) {
          const destroyers = myUnits.filter(u => u.type === 'destroyer').length;
          const carriers = myUnits.filter(u => u.type === 'aircraft_carrier').length;
          
          // "destroyers-before-carriers decreases with level (L8-10 only 2-3)"
          let destroyerThreshold = 6;
          if (this.difficulty >= 8) destroyerThreshold = 3;
          else if (this.difficulty >= 5) destroyerThreshold = 4;
          
          // Build Destroyers until threshold
          if (destroyers < destroyerThreshold) {
              this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
          }
          
          // Then Carriers (if High Diff) or more Destroyers
          if (this.difficulty >= 6) {
              const carrierCap = Math.max(1, Math.floor(this.difficulty / 3));
              if (destroyers >= destroyerThreshold && carriers < carrierCap) {
                  this.recruitUnitType(gameState, player, myIslands, 'aircraft_carrier', 'dock');
              }
          } else {
              // Low diff just keeps building destroyers slowly
              if (destroyers < 10) {
                  this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
              }
          }
      }
  }

  private runGrasslandsStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      // 1. Move to Water
      const builders = myUnits.filter(u => u.type === 'builder');
      builders.forEach(b => {
           if (b.status !== 'idle') return;
           const hasDock = myIslands.some(i => i.buildings.some(build => build.type === 'dock'));
           if (!hasDock) {
               const nearestOil: any = this.findNearestUnoccupiedOil(gameState, b.x, b.y, false);
               if (nearestOil) {
                   const dist = Math.hypot(nearestOil.x - b.x, nearestOil.y - b.y);
                   if (dist > 300) {
                       this.moveUnitSafe(gameState, b.id, nearestOil.x, nearestOil.y);
                   }
               }
           }
      });

      // 2. Economy
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      workingIslands.forEach(island => {
          this.buildAvailableMines(gameState, player, island);
          
          const nearbyOil = gameState.map.oilSpots?.some(s => Math.hypot(s.x - island.x, s.y - island.y) < island.radius + 800);
          if (nearbyOil) {
              const docks = island.buildings.filter(b => b.type === 'dock').length;
              // "second dock at level>=6"
              const dockCap = this.difficulty >= 6 ? 2 : 1;
              
              if (docks < dockCap && this.canAfford(player, 'dock')) {
                  this.ensureBuilderAndBuild(gameState, island, 'dock');
              }
          }
      });

      // 3. Oil Expansion
      const hasDock = myIslands.some(i => i.buildings.some(b => b.type === 'dock'));
      if (hasDock) {
           const consShips = myUnits.filter(u => u.type === 'construction_ship').length;
           if (consShips < 2) {
               this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
           }
      }
      this.manageOffshoreOil(gameState, player, myUnits);

      // 4. Defend Oil
      // "destroyersPerOil = clamp(1+floor(level/7),1,2)"
      const destroyersPerOil = Math.min(2, Math.max(1, 1 + Math.floor(this.difficulty / 7)));
      const oilRigs = gameState.map.oilSpots.filter(s => (s as any).ownerId === this.playerId).length;
      const desiredDestroyers = oilRigs * destroyersPerOil;
      
      const destroyers = myUnits.filter(u => u.type === 'destroyer').length;
      if (destroyers < desiredDestroyers && this.hasStableOil(player)) {
          this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
      }

      // 5. Land Army
      workingIslands.forEach(island => {
          const barracks = island.buildings.filter(b => b.type === 'barracks').length;
          if (barracks < 2 && this.canAfford(player, 'barracks')) {
              this.ensureBuilderAndBuild(gameState, island, 'barracks');
          }
          if (this.difficulty >= 5) {
               const factories = island.buildings.filter(b => b.type === 'tank_factory').length;
               if (factories < 2 && this.canAfford(player, 'tank_factory')) {
                   this.ensureBuilderAndBuild(gameState, island, 'tank_factory');
               }
          }
      });
      this.recruitLandArmy(gameState, player, myIslands, myUnits);
  }

  private runDesertStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      
      workingIslands.forEach(island => this.buildAvailableMines(gameState, player, island));

      // "always exactly 2 builders total"
      const builders = myUnits.filter(u => u.type === 'builder').length;
      const totalBuilders = gameState.units.filter(u => u.ownerId === this.playerId && u.type === 'builder').length;
      const cap = this.getBuilderCap();
      if (builders < 2 && totalBuilders < cap && player.resources.gold >= 150) {
          const base = myIslands.find(i => i.buildings.some(b => b.type === 'base'));
          if (base) {
              const baseB = base.buildings.find(b => b.type === 'base');
              if (baseB && this.consumeApm(1)) {
                  gameState.recruitUnit(this.playerId, base.id, 'builder', baseB.id);
                  this.markAction(Date.now());
              }
          }
      }

      workingIslands.forEach(island => {
          const barracks = island.buildings.filter(b => b.type === 'barracks').length;
          if (barracks === 0 && builders >= 2 && this.canAfford(player, 'barracks')) {
              this.ensureBuilderAndBuild(gameState, island, 'barracks');
          }
      });

      const hasBarracks = myIslands.some(i => i.buildings.some(b => b.type === 'barracks'));
      if (hasBarracks) {
          const seekers = myUnits.filter(u => u.type === 'oil_seeker').length;
          if (seekers < 1) {
              this.recruitUnitType(gameState, player, myIslands, 'oil_seeker', 'barracks');
          }
          this.manageOnshoreOil(gameState, player, myUnits, myIslands);
      }

      if (this.hasStableOil(player)) {
          this.recruitLandArmy(gameState, player, myIslands, myUnits);
      }
  }

  // ==========================================
  // UNIVERSAL HELPERS
  // ==========================================

  private getBuilderCap(): number {
      if (this.difficulty <= 3) return 2;
      if (this.difficulty <= 7) return 3;
      return 4;
  }

  private getCombatUnitMinimum(): number {
      if (this.difficulty <= 1) return 5;
      if (this.difficulty <= 2) return 6;
      if (this.difficulty <= 4) return 8;
      if (this.difficulty <= 6) return 9;
      if (this.difficulty <= 8) return 12;
      if (this.difficulty === 9) return 14;
      return 15;
  }

  private getDesiredTowerCount(): number {
      if (this.difficulty <= 2) return 2;
      if (this.difficulty <= 4) return 3;
      if (this.difficulty <= 6) return 4;
      if (this.difficulty <= 8) return 6;
      if (this.difficulty === 9) return 7;
      return 8;
  }

  private isCombatUnitType(type: string): boolean {
      const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
      if (workers.includes(type)) return false;
      return true;
  }

  private playerHasOilBuilding(gameState: GameState, myIslands: Island[]): boolean {
      const hasIslandOil = myIslands.some(i => 
          i.buildings.some(b => b.type === 'oil_rig' || b.type === 'oil_well')
      );
      if (hasIslandOil) return true;
      return gameState.map.oilSpots.some(s => (s as any).ownerId === this.playerId);
  }

  private considerHQUpgrade(gameState: GameState, player: Player) {
      const now = Date.now();
      const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
      const baseIsland = myIslands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.playerId));
      if (!baseIsland) return;

      const base = baseIsland.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId);
      if (!base) return;

      const currentLevel = (base as any).level || 1;
      if (currentLevel >= 2) return;

      const elapsedSec = (now - this.startTime) / 1000;
      const elapsedMin = elapsedSec / 60;

      const hasOilIncome = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);

      let reserveGold = 200;
      if (this.difficulty >= 5) reserveGold = 300;
      if (this.difficulty >= 8) reserveGold = 400;

      const requiredGold = 500 + reserveGold;
      const canUpgradeNow = player.resources.gold >= requiredGold && (hasOilIncome || elapsedMin > 6);

      if (!canUpgradeNow) return;
      if (!this.consumeApm(1)) return;

      const success = gameState.upgradeBuilding(this.playerId, (base as any).id);
      if (success) {
          this.logEvent('HQ_UPGRADE', { levelBefore: currentLevel, elapsedSec });
          this.markAction(now);
      }
  }

  private enforceCombatMinimum(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[], now: number) {
      const config = DifficultyConfig(this.difficulty);
      const elapsedSec = (now - this.startTime) / 1000;
      if (elapsedSec < config.attackStartTime) return;

      const combatUnits = myUnits.filter(u => this.isCombatUnitType(u.type)).length;
      const minCombat = this.getCombatUnitMinimum();

      if (!this.debugState.progression) this.debugState.progression = {};
      this.debugState.progression.combat = {
          current: combatUnits,
          minimum: minCombat,
          elapsedSec: Math.floor(elapsedSec),
          attackStartTimeSec: config.attackStartTime
      };

      if (combatUnits >= minCombat) return;

      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      if (workingIslands.length === 0) return;

      let hasBarracks = false;
      workingIslands.forEach(i => {
          if (i.buildings.some(b => b.type === 'barracks')) hasBarracks = true;
      });

      if (!hasBarracks && this.canAfford(player, 'barracks')) {
          this.ensureBuilderAndBuild(gameState, workingIslands[0], 'barracks');
      }

      if (this.difficulty >= 5) {
          let hasFactory = false;
          workingIslands.forEach(i => {
              if (i.buildings.some(b => b.type === 'tank_factory')) hasFactory = true;
          });
          if (!hasFactory && this.canAfford(player, 'tank_factory')) {
              this.ensureBuilderAndBuild(gameState, workingIslands[0], 'tank_factory');
          }
      }

      this.recruitLandArmy(gameState, player, workingIslands, myUnits);
  }

  private enforceIdleRecovery(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[], now: number) {
      const idleSec = (now - this.lastMeaningfulActionTime) / 1000;
      if (!this.debugState.progression) this.debugState.progression = {};

      if (!this.debugState.progression.idle) {
          this.debugState.progression.idle = {
              idleSeconds: Math.floor(idleSec),
              threshold: 30,
              forcedObjective: 'NONE'
          };
      } else {
          this.debugState.progression.idle.idleSeconds = Math.floor(idleSec);
          this.debugState.progression.idle.threshold = 30;
      }

      if (idleSec < 30) return;

      const hasOilIncome = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const combatUnits = myUnits.filter(u => this.isCombatUnitType(u.type)).length;
      const minCombat = this.getCombatUnitMinimum();
      const defenceState = this.baseDefenseBuilder.debugState;
      const desiredTowers = this.getDesiredTowerCount();

      const baseIsland = gameState.map.islands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.playerId));
      const base = baseIsland ? baseIsland.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId) : undefined;
      const hqLevel = base ? ((base as any).level || 1) : 1;
      const elapsedSec = (now - this.startTime) / 1000;

      let forcedObjective = 'NONE';

      if (!hasOilIncome) {
          forcedObjective = 'OIL';
          if (baseIsland) {
              const docks = baseIsland.buildings.filter(b => b.type === 'dock').length;
              if (docks === 0 && this.canAfford(player, 'dock')) {
                  this.ensureBuilderAndBuild(gameState, baseIsland, 'dock');
              } else {
                  const consShips = myUnits.filter(u => u.type === 'construction_ship').length;
                  if (consShips === 0 && this.canAfford(player, 'construction_ship')) {
                      this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
                  }
              }
          }
      } else if (combatUnits < minCombat) {
          forcedObjective = 'COMBAT';
          this.enforceCombatMinimum(gameState, player, myIslands, myUnits, now);
      } else if (defenceState.towersBuilt < desiredTowers) {
          forcedObjective = 'DEFENCE';
          this.manageBaseDefences(gameState, player, myIslands);
      } else if (hqLevel < 2 && (this.hasStableOil(player) || elapsedSec > 360)) {
          forcedObjective = 'HQ_UPGRADE';
          this.considerHQUpgrade(gameState, player);
      }

      this.debugState.progression.idle.forcedObjective = forcedObjective;
  }

  private updateProgressionDebug(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[], now: number) {
      const idleSec = (now - this.lastMeaningfulActionTime) / 1000;
      const builderCap = this.getBuilderCap();
      const totalBuilders = gameState.units.filter(u => u.ownerId === this.playerId && u.type === 'builder').length;
      const combatUnits = myUnits.filter(u => this.isCombatUnitType(u.type)).length;
      const minCombat = this.getCombatUnitMinimum();
      const mapType = (gameState as any).mapType || (gameState.map as any).mapType || 'unknown';

      const defence = this.baseDefenseBuilder.debugState;
      const myBaseIsland = gameState.map.islands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.playerId));
      const base = myBaseIsland ? myBaseIsland.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId) : undefined;
      const hqLevel = base ? ((base as any).level || 1) : 1;

      const hasOilIncome = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);

      const docks = myIslands.some(i => i.buildings.some(b => b.type === 'dock'));
      const ships = myUnits.some(u => u.type === 'construction_ship');
      const oilBuildings = myIslands.some(i => i.buildings.some(b => b.type === 'oil_rig' || b.type === 'oil_well'));

      let oilState = 'NONE';
      if (!docks && !ships && !oilBuildings) oilState = 'NONE';
      else if (docks && !ships && !oilBuildings) oilState = 'DOCK';
      else if (ships && !oilBuildings) oilState = 'SHIP';
      else oilState = 'RIG';

      if (!this.debugState.progression) this.debugState.progression = {};
      const progression = this.debugState.progression;

      progression.mapType = mapType;
      progression.builders = {
          count: totalBuilders,
          cap: builderCap
      };
      progression.oil = {
          state: oilState,
          gold: player.resources.gold,
          oil: player.resources.oil,
          secured: this.oilSecured
      };
      progression.combat = {
          current: combatUnits,
          minimum: minCombat
      };
      progression.defence = {
          towersBuilt: defence.towersBuilt,
          towersTarget: defence.towersTarget,
          wallNodesPlaced: defence.wallNodesPlaced,
          wallNodesTarget: defence.wallNodesTarget,
          wallConnections: defence.wallConnectionsMade,
          wallConnectionsExpected: defence.wallConnectionsExpected,
          status: defence.status,
          lastAction: defence.lastAction,
          lastSkipReason: defence.lastSkipReason,
          lastBuilderId: defence.lastBuilderId
      };
      progression.hq = {
          level: hqLevel,
          hasOilIncome: hasOilIncome,
          gold: player.resources.gold,
          elapsedSec: Math.floor((now - this.startTime) / 1000)
      };

      if (!progression.idle) {
          progression.idle = {
              idleSeconds: Math.floor(idleSec),
              threshold: 30,
              forcedObjective: 'NONE'
          };
      } else {
          progression.idle.idleSeconds = Math.floor(idleSec);
          progression.idle.threshold = 30;
      }
  }

  private manageAirStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const isAirPhase = Date.now() - this.startTime > this.timeToAirPhase;
      if (!isAirPhase) return;

      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      let airBaseCount = 0;
      myIslands.forEach(i => airBaseCount += i.buildings.filter(b => b.type === 'air_base').length);

      if (airBaseCount < 2) {
          workingIslands.forEach(island => {
              if (this.canAfford(player, 'air_base')) {
                   const existing = island.buildings.filter(b => b.type === 'air_base').length;
                   if (existing < 1) {
                       this.ensureBuilderAndBuild(gameState, island, 'air_base');
                   }
              }
          });
      }

      // Recruit Motherships (Mobile Bases)
      const motherships = myUnits.filter(u => u.type === 'mothership').length;
      const planesCount = myUnits.filter(u => ['light_plane', 'heavy_plane'].includes(u.type)).length;
      // 1 Mothership per 8 planes, max 3
      const desiredMotherships = Math.max(1, Math.floor(planesCount / 8));
      const msCap = Math.min(3, 1 + Math.floor(this.difficulty / 3));
      
      if (motherships < msCap && motherships < desiredMotherships) {
           this.recruitUnitType(gameState, player, myIslands, 'mothership', 'air_base');
      }

      // Recruit Planes (Prioritize Motherships & Carriers)
      this.recruitUnitType(gameState, player, myIslands, 'heavy_plane', 'mothership');
      this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'mothership');
      this.recruitUnitType(gameState, player, myIslands, 'heavy_plane', 'aircraft_carrier');
      this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'aircraft_carrier');

      this.recruitUnitType(gameState, player, myIslands, 'heavy_plane', 'air_base');
      this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'air_base');
  }

    private manageAirForce(gameState: GameState, _player: Player, myUnits: Unit[]) {
        const airUnits = myUnits.filter(u => ['light_plane', 'heavy_plane', 'helicopter'].includes(u.type));
        const motherships = myUnits.filter(u => u.type === 'mothership');
        const carriers = myUnits.filter(u => u.type === 'aircraft_carrier');
        
        if (airUnits.length === 0 && motherships.length === 0 && carriers.length === 0) return;

        // Logic:
        // 1. Group up (Mothership/Carrier is rally point)
        // 2. Attack if swarm is large enough
        
        // Update Mode
        const swarmSize = airUnits.length;
        let attackThreshold = 6;
        if (this.difficulty >= 7) attackThreshold = 10;
        
        if (this.airState.mode === 'GATHER') {
            // Strict Grouping Check
            let grouped = false;
            
            // Find Rally Point
            let rally: {x: number, y: number} | null = null;
            if (motherships.length > 0) rally = motherships[0];
            else if (carriers.length > 0) rally = carriers[0];
            else {
                 const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
                 const airbase = myIslands.find(i => i.buildings.some(b => b.type === 'air_base'));
                 if (airbase) rally = airbase;
                 else if (myIslands.length > 0) rally = myIslands[0];
            }

            if (swarmSize >= attackThreshold) {
                if (rally) {
                    const farUnits = airUnits.filter(u => Math.hypot(u.x - rally.x, u.y - rally.y) > 400);
                    if (farUnits.length <= Math.ceil(swarmSize * 0.2)) {
                         grouped = true;
                    }
                } else {
                    grouped = true;
                }
            }

            if (grouped) {
                this.airState.mode = 'ATTACK';
                this.logEvent('AIR_MODE', { mode: 'ATTACK', size: swarmSize });
            }
        } else {
            if (swarmSize < attackThreshold * 0.5) {
                this.airState.mode = 'GATHER';
                this.logEvent('AIR_MODE', { mode: 'GATHER', size: swarmSize });
            }
        }

        // Execution
        const target = this.findAirTarget(gameState);

        // Motherships
        motherships.forEach(ms => {
             if (this.usedUnitIds.has(ms.id)) return;
             
             // If aggressive (level 10), mothership moves up with the swarm to spawn units closer
             const isAggressive = this.difficulty >= 10;
             
             if (this.airState.mode === 'ATTACK' && target) {
                 if (isAggressive) {
                     // Move to just outside enemy range (e.g., 600-800 distance)
                     const dist = Math.hypot(target.x - ms.x, target.y - ms.y);
                     const optimalRange = 800; // Safe distance to spawn units
                     
                     if (dist > optimalRange + 100) {
                         this.moveUnitSafe(gameState, ms.id, target.x, target.y);
                         this.logAirOrder(ms, 'MOVE_UP', 'TARGET', target, 'MothershipSupport', false);
                     } else if (dist < optimalRange - 100) {
                         // Back off if too close
                         const angle = Math.atan2(ms.y - target.y, ms.x - target.x);
                         const retreatX = target.x + Math.cos(angle) * optimalRange;
                         const retreatY = target.y + Math.sin(angle) * optimalRange;
                         this.moveUnitSafe(gameState, ms.id, retreatX, retreatY);
                     }
                 } else {
                     // Standard behavior: Keep distance / Kite
                     const dist = Math.hypot(target.x - ms.x, target.y - ms.y);
                     if (dist > ms.range * 0.8) {
                         this.moveUnitSafe(gameState, ms.id, target.x, target.y);
                     }
                 }
             } else {
                 // Stay near base
                 const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
                 if (myIslands.length > 0) {
                     const home = myIslands[0];
                     const dist = Math.hypot(home.x - ms.x, home.y - ms.y);
                     if (dist > 300) {
                         this.moveUnitSafe(gameState, ms.id, home.x, home.y);
                     }
                 }
             }
        });

        // Planes
        airUnits.forEach(plane => {
            if (this.usedUnitIds.has(plane.id)) return;
            
            if (this.airState.mode === 'ATTACK' && target) {
                this.logAirOrder(plane, 'ATTACK', 'TARGET', target, 'SwarmAttack', false);
                this.moveUnitSafe(gameState, plane.id, target.x, target.y);
            } else {
                // Gather at Mothership (Priority) or Carrier or Home
                let rally: {x: number, y: number} | null = null;
                if (motherships.length > 0) {
                    const ms = motherships[0];
                    rally = { x: ms.x, y: ms.y };
                } else if (carriers.length > 0) {
                    const c = carriers[0];
                    rally = { x: c.x, y: c.y };
                } else {
                    // Find Airbase
                    const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
                    const airbase = myIslands.find(i => i.buildings.some(b => b.type === 'air_base'));
                    if (airbase) rally = { x: airbase.x, y: airbase.y };
                    else if (myIslands.length > 0) rally = { x: myIslands[0].x, y: myIslands[0].y };
                }
                
                if (rally) {
                     // Circle around rally
                     const angle = (Date.now() / 1000) + (parseInt(plane.id.slice(-4), 16));
                     const rx = rally.x + Math.cos(angle) * 200; // Tighter formation (200)
                     const ry = rally.y + Math.sin(angle) * 200;
                     
                     const dist = Math.hypot(rx - plane.x, ry - plane.y);
                     if (dist > 50) { // More responsive
                        this.moveUnitSafe(gameState, plane.id, rx, ry);
                     }
                }
            }
        });
    }

    private isBaseUnderAttack(gameState: GameState): boolean {
        // Check if any significant building is taking damage or has enemies nearby
        const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
        
        for (const island of myIslands) {
            // Check Buildings Health
            const damagedBuildings = island.buildings.some(b => b.health < b.maxHealth * 0.9);
            if (damagedBuildings) {
                // Confirm it's enemy damage (enemy unit nearby)
                const enemyNearby = gameState.units.some(u => 
                    u.ownerId !== this.playerId && 
                    Math.hypot(u.x - island.x, u.y - island.y) < 800
                );
                if (enemyNearby) return true;
            }
        }
        return false;
    }

    private manageNavalCommander(gameState: GameState, player: Player, myUnits: Unit[]) {
        const navalUnits = myUnits.filter(u => ['destroyer', 'battleship', 'aircraft_carrier', 'submarine'].includes(u.type));
        if (navalUnits.length === 0) return;

        // 1. Assign Defenders vs Fleet
        // "Leave defenders at home" rule
        let requiredDefenders = 0;
        if (this.difficulty <= 3) requiredDefenders = 1;
        else if (this.difficulty <= 6) requiredDefenders = 2;
        else if (this.difficulty <= 9) requiredDefenders = 3;
        else requiredDefenders = 4;

        // EMERGENCY DEFENCE: If under attack, recall fleet!
        const underAttack = this.isBaseUnderAttack(gameState);
        if (underAttack) {
             requiredDefenders = navalUnits.length; // RECALL EVERYONE
             this.logEvent('NAVAL_MODE', { mode: 'EMERGENCY_DEFENCE', units: navalUnits.length });
        }

        // Reset assignments each tick or manage persistency?
        // Persistency is better to stop unit shuffling.
        // Clean up dead units
        const livingIds = new Set(navalUnits.map(u => u.id));
        [...this.navalState.homeDefenders].forEach(id => { if (!livingIds.has(id)) this.navalState.homeDefenders.delete(id); });
        [...this.navalState.fleet].forEach(id => { if (!livingIds.has(id)) this.navalState.fleet.delete(id); });

        // Assign new units
        navalUnits.forEach(u => {
            if (!this.navalState.homeDefenders.has(u.id) && !this.navalState.fleet.has(u.id)) {
                if (this.navalState.homeDefenders.size < requiredDefenders) {
                    this.navalState.homeDefenders.add(u.id);
                } else {
                    this.navalState.fleet.add(u.id);
                }
            }
        });

        // 2. Manage Home Defenders
        this.navalState.homeDefenders.forEach(id => {
            const unit = navalUnits.find(u => u.id === id);
            if (!unit || this.usedUnitIds.has(id)) return;
            
            // Patrol around Dock/Base
            const patrolCenter = this.findHomePatrolCenter(gameState);
            if (!patrolCenter) return;

            // Check for nearby enemies
            const nearbyEnemy = this.findNearbyEnemy(gameState, patrolCenter, 900); // 900 radius
            if (nearbyEnemy) {
                 const dist = Math.hypot(nearbyEnemy.x - unit.x, nearbyEnemy.y - unit.y);
                 if (dist > unit.range * 0.8) {
                     this.moveUnitSafe(gameState, unit.id, nearbyEnemy.x, nearbyEnemy.y);
                     this.logDestroyerOrder(unit, 'DEFEND', 'ENEMY', nearbyEnemy, 'HomeDefence', false);
                 }
            } else {
                // Patrol Circle
                const angle = (Date.now() / 5000) + (parseInt(unit.id.slice(-4), 16) % 10);
                const patrolX = patrolCenter.x + Math.cos(angle) * 600;
                const patrolY = patrolCenter.y + Math.sin(angle) * 600;
                
                const dist = Math.hypot(patrolX - unit.x, patrolY - unit.y);
                if (dist > 200) {
                    this.moveUnitSafe(gameState, unit.id, patrolX, patrolY);
                    this.logDestroyerOrder(unit, 'PATROL', 'HOME', {x: patrolX, y: patrolY}, 'Patrol', false);
                }
            }
        });

        // 3. Manage Main Fleet
        const fleetUnits = navalUnits.filter(u => this.navalState.fleet.has(u.id));
        if (fleetUnits.length === 0) return;

        // Fleet Grouping Logic
        let waveThreshold = 3;
        if (this.difficulty >= 4) waveThreshold = 5;
        if (this.difficulty >= 7) waveThreshold = 7;
        if (this.difficulty >= 10) waveThreshold = 9;

        if (this.navalState.mode === 'NAVAL_BUILD_FLEET') {
            const rally = this.getNavalRallyPoint(gameState, fleetUnits[0]);
            
            // Check if grouped (Strict Grouping)
            let grouped = false;
            if (rally && fleetUnits.length >= waveThreshold) {
                const farUnits = fleetUnits.filter(u => Math.hypot(u.x - rally.x, u.y - rally.y) > 500);
                if (farUnits.length <= Math.ceil(fleetUnits.length * 0.2)) { // 80% are within 500px
                    grouped = true;
                }
            }

            if (grouped) {
                this.navalState.mode = 'NAVAL_STRIKE';
                this.logEvent('NAVAL_MODE', { mode: 'STRIKE', size: fleetUnits.length });
            } else {
                // Gather at rally
                if (rally) {
                    fleetUnits.forEach(u => {
                        if (this.usedUnitIds.has(u.id)) return;
                        
                        // Spread out slightly at rally
                        const angle = (parseInt(u.id.slice(-4), 16) % 360) * (Math.PI / 180);
                        const rx = rally.x + Math.cos(angle) * 100;
                        const ry = rally.y + Math.sin(angle) * 100;

                        const dist = Math.hypot(rx - u.x, ry - u.y);
                        if (dist > 200) {
                            this.moveUnitSafe(gameState, u.id, rx, ry);
                            this.logDestroyerOrder(u, 'GATHER', 'RALLY', {x: rx, y: ry}, 'BuildFleet', false);
                        }
                    });
                }
            }
        } else if (this.navalState.mode === 'NAVAL_STRIKE') {
            // Retreat Logic:
            // Low Diff: Retreat at 40%
            // High Diff (10): FIGHT TO THE DEATH (0%)
            let retreatThreshold = 0.4;
            if (this.difficulty >= 10) retreatThreshold = 0.0; // Never retreat
            else if (this.difficulty >= 7) retreatThreshold = 0.2;

            if (fleetUnits.length < waveThreshold * retreatThreshold) {
                this.navalState.mode = 'NAVAL_BUILD_FLEET';
                this.logEvent('NAVAL_MODE', { mode: 'RETREAT', size: fleetUnits.length });
                return;
            }

            // General Fleet Target
            const fleetTarget = this.findHighValueNavalTarget(gameState, fleetUnits[0], player);
            
            if (fleetTarget) {
                fleetUnits.forEach(u => {
                    if (this.usedUnitIds.has(u.id)) return;

                    // Specialized Targeting
                    let myTarget = fleetTarget;
                    if (u.type === 'submarine') {
                        const subTarget = this.findHighValueNavalTarget(gameState, u, player);
                        if (subTarget) myTarget = subTarget;
                    }

                    if (myTarget.x === 0 && myTarget.y === 0) return;

                    // Specialized Movement
                    if (u.type === 'aircraft_carrier') {
                        // Keep distance (Long Range)
                        const dist = Math.hypot(myTarget.x - u.x, myTarget.y - u.y);
                        if (dist > u.range * 0.9) {
                             this.moveUnitSafe(gameState, u.id, myTarget.x, myTarget.y);
                             this.logDestroyerOrder(u, 'STRIKE', myTarget.type, myTarget, 'CarrierSupport', false);
                        }
                    } else {
                        // Standard Attack
                        const dist = Math.hypot(myTarget.x - u.x, myTarget.y - u.y);
                        if (dist > u.range * 0.8) {
                            this.moveUnitSafe(gameState, u.id, myTarget.x, myTarget.y);
                            this.logDestroyerOrder(u, 'STRIKE', myTarget.type, myTarget, 'FleetStrike', false);
                        }
                    }
                });
            } else {
                 this.navalState.mode = 'NAVAL_BUILD_FLEET'; // No targets
            }
        }
    }

    private findHomePatrolCenter(gameState: GameState): {x: number, y: number} | null {
        // Prefer Dock -> Base -> First Island
        const myIslands = gameState.map.islands.filter(i => i.ownerId === this.playerId);
        for (const i of myIslands) {
            if (i.buildings.some(b => b.type === 'dock')) return { x: i.x, y: i.y };
        }
        for (const i of myIslands) {
            if (i.buildings.some(b => b.type === 'base')) return { x: i.x, y: i.y };
        }
        if (myIslands.length > 0) return { x: myIslands[0].x, y: myIslands[0].y };
        return null;
    }

    private findNearbyEnemy(gameState: GameState, center: {x: number, y: number}, radius: number): {x: number, y: number} | null {
        const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
        let best: Unit | null = null;
        let minD = Infinity;
        
        for (const e of enemies) {
            const d = Math.hypot(e.x - center.x, e.y - center.y);
            if (d < radius && d < minD) {
                minD = d;
                best = e;
            }
        }
        return best ? { x: best.x, y: best.y } : null;
    }

    private findHighValueNavalTarget(gameState: GameState, unit: Unit, player: Player): {x: number, y: number, type: string} | null {
         // Destroyer Priority: Hunt Submarines
         if (unit.type === 'destroyer') {
             const submarines = gameState.units.filter(u => u.ownerId !== this.playerId && u.type === 'submarine');
             if (submarines.length > 0) {
                 const best = this.findClosest(unit, submarines);
                 return { x: best.x, y: best.y, type: 'SUB_HUNT' };
             }
         }

         // Submarine Priority: Hunt Capital Ships
         if (unit.type === 'submarine') {
             const capitalShips = gameState.units.filter(u => u.ownerId !== this.playerId && ['battleship', 'aircraft_carrier', 'mothership'].includes(u.type));
             if (capitalShips.length > 0) {
                 const best = this.findClosest(unit, capitalShips);
                 return { x: best.x, y: best.y, type: 'CAPITAL_HUNT' };
             }
         }

         // STRATEGIC PRIORITY
         
         // 1. Decapitate Strike (Level 10+)
         if (this.difficulty >= 10) {
             const enemyBases = gameState.map.islands
                 .filter(i => i.ownerId && i.ownerId !== this.playerId && i.buildings.some(b => b.type === 'base'))
                 .map(i => ({ x: i.x, y: i.y, type: 'HQ_STRIKE' }));
             
             if (enemyBases.length > 0) {
                 const best = this.findClosest(unit, enemyBases);
                 return { x: best.x, y: best.y, type: 'HQ_STRIKE' };
             }
         }

         // 2. Resource Denial (If low on oil OR Level 8+)
         if (player.resources.oil < 1000 || this.difficulty >= 8) {
             const enemyOil = gameState.map.oilSpots.filter(s => (s as any).occupiedBy && (s as any).ownerId && (s as any).ownerId !== this.playerId);
             if (enemyOil.length > 0) {
                 const best = this.findClosest(unit, enemyOil);
                 return { x: best.x, y: best.y, type: 'OIL_RIG' };
             }
         }
         
         // 3. Enemy Docks / Carriers / Construction Ships
         const priorityUnits = gameState.units.filter(u => u.ownerId !== this.playerId && ['dock', 'aircraft_carrier', 'construction_ship'].includes(u.type));
         if (priorityUnits.length > 0) {
             const best = this.findClosest(unit, priorityUnits);
             return { x: best.x, y: best.y, type: 'PRIORITY_UNIT' };
         }

         // 4. Enemy Islands (Base Assault)
         const enemyIslands = gameState.map.islands.filter(i => i.ownerId && i.ownerId !== this.playerId);
         if (enemyIslands.length > 0) {
             const bestIsland = this.findClosest(unit, enemyIslands);
             return { x: bestIsland.x, y: bestIsland.y, type: 'ISLAND_ASSAULT' };
         }
         
         // 5. Any Enemy Unit
         const generalTarget = this.findTarget(gameState, unit);
         return generalTarget ? { ...generalTarget, type: 'GENERAL' } : null;
    }

    private findClosest(unit: Unit, items: any[]): any {
        let best = items[0];
        let minD = Infinity;
        items.forEach(i => {
             const d = Math.hypot(i.x - unit.x, i.y - unit.y);
             if (d < minD) { minD = d; best = i; }
        });
        return best;
    }

    private manageBaseDefences(gameState: GameState, player: Player, myIslands: Island[]) {
        // Check timing
        const elapsedMin = (Date.now() - this.startTime) / 60000;
        let startMin = 6;
        if (this.difficulty >= 5) startMin = 3;
        if (this.difficulty >= 10) startMin = 1;
        
        if (elapsedMin < startMin) return;

        // Cap check
        let maxDefences = 2;
        if (this.difficulty >= 3) maxDefences = 3;
        if (this.difficulty >= 5) maxDefences = 4;
        if (this.difficulty >= 7) maxDefences = 6;
        if (this.difficulty >= 9) maxDefences = 7;
        if (this.difficulty >= 10) maxDefences = 8;

        // Count existing
        let currentDefences = 0;
        myIslands.forEach(i => {
            currentDefences += i.buildings.filter(b => b.type === 'tower').length;
        });

        if (currentDefences >= maxDefences) return;

        // Build Logic
        // Prefer: Ring 1 (HQ), Ring 2 (Prod), Ring 3 (Res)
        // Find best island (Base > Factory > Mine)
        
        const baseIsland = myIslands.find(i => i.buildings.some(b => b.type === 'base'));
        if (baseIsland && this.canAfford(player, 'tower')) { 
             // Try to build tower near base
             this.orderBuilderToDefend(gameState, player, baseIsland);
        }
    }

    private orderBuilderToDefend(gameState: GameState, player: Player, island: Island) {
        const builder = gameState.units.find(u => u.ownerId === this.playerId && u.type === 'builder' && u.status === 'idle');
        if (!builder) return;

        const existingDefences = island.buildings.filter(b => b.type === 'tower').length;
        
        let minR = 250, maxR = 350;
        if (existingDefences >= 2) { minR = 400; maxR = 500; }
        if (existingDefences >= 4) { minR = 550; maxR = 650; }

        // Scan for a valid spot
        let bestSpot: {x: number, y: number} | null = null;
        let bestDist = Infinity;

        // Try 16 angles for better coverage
        const steps = 16;
        for (let i = 0; i < steps; i++) {
            const angle = (i * Math.PI * 2 / steps) + (Date.now() / 10000); // Rotate slowly
            const dist = (minR + maxR) / 2;
            const bx = island.x + Math.cos(angle) * dist;
            const by = island.y + Math.sin(angle) * dist;

            // Simple collision check (avoid building on top of other buildings)
            // b.x/b.y are relative to island. bx/by are absolute.
            const overlap = island.buildings.some(b => Math.hypot((island.x + (b.x||0)) - bx, (island.y + (b.y||0)) - by) < 80);
            if (overlap) continue;
            
            // Distance from builder
            const d = Math.hypot(bx - builder.x, by - builder.y);
            
            // Prioritize spots close to builder
            if (d < bestDist) {
                bestDist = d;
                bestSpot = { x: bx, y: by };
            }
        }

        if (bestSpot) {
            if (this.consumeApm(1)) {
                 if (this.canAfford(player, 'tower')) {
                     if (!gameState.isValidPosition(bestSpot.x, bestSpot.y, 'builder')) {
                         console.log(`[BUILD_REJECT] type=tower reason=NOT_LAND pos=${bestSpot.x.toFixed(0)},${bestSpot.y.toFixed(0)}`);
                         return;
                     }
                     if (bestDist <= 400) {
                         gameState.buildStructure(this.playerId, builder.id, 'tower', bestSpot.x, bestSpot.y);
                         this.logEvent('BUILD_DEFENCE', { type: 'tower', x: bestSpot.x, y: bestSpot.y });
                         this.debugState.intents.push({
                             type: 'build',
                             unitId: builder.id,
                             from: { x: builder.x, y: builder.y },
                             to: bestSpot,
                             buildType: 'tower'
                         });
                     } else {
                         this.moveUnitSafe(gameState, builder.id, bestSpot.x, bestSpot.y);
                         this.logEvent('MOVE_TO_BUILD', { x: bestSpot.x, y: bestSpot.y });
                     }
                     return;
                 }
            }
        }
    }


  private findAirTarget(gameState: GameState): {x: number, y: number} | null {
      // 1. Level 10 Aggression: Prioritize Humans
      if (this.difficulty >= 10) {
          const humans = Array.from(gameState.players.values()).filter(p => !p.isBot && p.id !== this.playerId);
          if (humans.length > 0) {
              // Find human buildings
              const humanBuildings = gameState.map.islands
                  .filter(i => humans.some(h => h.id === i.ownerId))
                  .flatMap(i => i.buildings.map(b => ({...b, x: i.x + (b.x||0), y: i.y + (b.y||0)})));
              
              if (humanBuildings.length > 0) {
                  // Pick random or closest
                  const target = humanBuildings[Math.floor(Math.random() * humanBuildings.length)];
                  return { x: target.x, y: target.y };
              }
              
              // Find human units
              const humanUnits = gameState.units.filter(u => humans.some(h => h.id === u.ownerId));
              if (humanUnits.length > 0) {
                  const target = humanUnits[0];
                  return { x: target.x, y: target.y };
              }
          }
      }

      // 2. Standard Targeting (Closest Enemy)
      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const enemyBuildings = gameState.map.islands
          .filter(i => i.ownerId && i.ownerId !== this.playerId)
          .flatMap(i => i.buildings.map(b => ({...b, x: i.x + (b.x||0), y: i.y + (b.y||0)})));

      const all = [...enemies, ...enemyBuildings];
      if (all.length === 0) return null;

      // Pick closest to center or random
      const target = all[Math.floor(Math.random() * all.length)];
      if (target.x === 0 && target.y === 0) return null; // Avoid (0,0)
      return { x: target.x, y: target.y };
  }

  private logAirOrder(unit: Unit, order: string, targetType: string, pos: {x:number, y:number}, reason: string, fallback: boolean) {
      this.logEvent('AIR_ORDER', { unitId: unit.id, order, targetType, pos, reason, fallback });
      this.debugState.intents.push({
          type: 'debug_line',
          unitId: unit.id,
          from: { x: unit.x, y: unit.y },
          to: pos,
          color: 'cyan', 
          label: `${order} ${reason}`
      });
  }

  public requestMove(gameState: GameState, unitId: string, x: number, y: number) {
      this.botMoveUnit(gameState, unitId, x, y, 'bot_move_', true);
  }

  private manageArmy(gameState: GameState, player: Player, myUnits: Unit[], myIslands: Island[]) {
      // DEPRECATED: Logic moved to AttackManager
      // this.manageAirForce(gameState, player, myUnits);
      // this.manageNavalCommander(gameState, player, myUnits);
      
      // Kept empty to satisfy existing calls in update() without breaking logic flow
      // The AttackManager now handles all combat unit movement.
  }

  private getNavalRallyPoint(gameState: GameState, unit: Unit): {x: number, y: number} | null {
       // Find nearest dock
       let bestDock: any = null;
       let minD = Infinity;
       
       gameState.map.islands.forEach(i => {
           if (i.ownerId === this.playerId) {
               const dock = i.buildings.find(b => b.type === 'dock');
               if (dock) {
                   const d = Math.hypot(i.x - unit.x, i.y - unit.y);
                   if (d < minD) { minD = d; bestDock = i; }
               }
           }
       });

       if (bestDock) {
            const angle = Math.random() * Math.PI * 2;
            const dist = bestDock.radius + 200;
            return { x: bestDock.x + Math.cos(angle) * dist, y: bestDock.y + Math.sin(angle) * dist };
       }
       return null;
   }

  private logDestroyerOrder(unit: Unit, orderType: string, targetType: string, targetPos: {x: number, y: number}, reason: string, fallbackUsed: boolean) {
      this.logEvent('DESTROYER_ORDER', {
          unitId: unit.id,
          orderType,
          targetType,
          targetPos,
          reason,
          fallbackUsed
      });
      
      this.debugState.intents.push({
          type: 'debug_line',
          unitId: unit.id,
          from: { x: unit.x, y: unit.y }, 
          to: targetPos,
          color: 'red',
          label: `${targetType} ${Math.round(targetPos.x)},${Math.round(targetPos.y)}`
      });
  }

  private findTarget(gameState: GameState, unit: Unit): {x: number, y: number} | null {
      const levelIdx = this.difficulty - 1;
      const playerBias = PLAYER_TARGET_BIAS[levelIdx];
      
      let bestTarget = null;
      let highestScore = -Infinity;

      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const enemyBuildings: any[] = [];
      gameState.map.islands.forEach(i => {
          if (i.ownerId && i.ownerId !== this.playerId) {
              i.buildings.forEach(b => enemyBuildings.push({...b, islandX: i.x, islandY: i.y}));
          }
      });

      const allTargets = [...enemies, ...enemyBuildings];

      allTargets.forEach(t => {
          const tx = t.x || (t as any).islandX + (t.x||0);
          const ty = t.y || (t as any).islandY + (t.y||0);
          
          let score = 0;
          const dist = Math.hypot(tx - unit.x, ty - unit.y);
          score -= dist; // Closer is better

          // Bias towards Human Players
          const ownerId = t.ownerId || (t as any).ownerId;
          const owner = gameState.players.get(ownerId);
          if (owner && !owner.isBot) {
              score += (playerBias * 5000); 
          }

          // Bias towards Economy
          if (['mine', 'oil_rig', 'oil_well', 'dock'].includes(t.type)) {
              score += 1000;
          }

          if (score > highestScore) {
              highestScore = score;
              bestTarget = {x: tx, y: ty};
          }
      });

      return bestTarget;
  }

  // --- ACTIONS ---

  public consumeApm(cost: number): boolean {
      if (this.apmTokens >= cost) {
          this.apmTokens -= cost;
          return true;
      }
      this.logEvent('RATE_LIMIT', { needed: cost, available: this.apmTokens });
      return false;
  }

  private getUnitDomain(type: string): 'LAND' | 'WATER' | 'AIR' {
      if (['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien', 'helicopter'].includes(type)) {
          return 'AIR';
      }
      if (['destroyer', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier', 'raft', 'scout_boat', 'gunship', 'oil_tanker'].includes(type)) {
          return 'WATER';
      }
      return 'LAND';
  }

  private isDirectLine(gameState: GameState, unit: Unit, target: { x: number, y: number }, pathLength: number): boolean {
      if (pathLength > 2) return false;
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = unit.x + (target.x - unit.x) * t;
          const y = unit.y + (target.y - unit.y) * t;
          if (!gameState.isValidPosition(x, y, unit.type)) {
              return false;
          }
      }
      return true;
  }

  private findNearestPassableCell(gameState: GameState, unit: Unit, cellSize: number, cols: number, rows: number, startCol: number, startRow: number): { col: number, row: number } | null {
      const isPassable = (c: number, r: number) => {
          const wx = c * cellSize + cellSize * 0.5;
          const wy = r * cellSize + cellSize * 0.5;
          return gameState.isValidPosition(wx, wy, unit.type);
      };
      if (startCol >= 0 && startCol < cols && startRow >= 0 && startRow < rows && isPassable(startCol, startRow)) {
          return { col: startCol, row: startRow };
      }
      const maxRadius = 4;
      let best: { col: number, row: number } | null = null;
      let bestDist = Infinity;
      for (let radius = 1; radius <= maxRadius; radius++) {
          for (let dr = -radius; dr <= radius; dr++) {
              for (let dc = -radius; dc <= radius; dc++) {
                  const c = startCol + dc;
                  const r = startRow + dr;
                  if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
                  if (!isPassable(c, r)) continue;
                  const dx = c - startCol;
                  const dy = r - startRow;
                  const d2 = dx * dx + dy * dy;
                  if (d2 < bestDist) {
                      bestDist = d2;
                      best = { col: c, row: r };
                  }
              }
          }
          if (best) return best;
      }
      return null;
  }

  private findGridPath(gameState: GameState, unit: Unit, target: { x: number, y: number }): { x: number, y: number }[] {
      const map = gameState.map;
      const cellSize = 80;
      const cols = Math.max(1, Math.ceil(map.width / cellSize));
      const rows = Math.max(1, Math.ceil(map.height / cellSize));

      const clampIndex = (v: number, max: number) => {
          if (v < 0) return 0;
          if (v >= max) return max - 1;
          return v;
      };

      let startCol = clampIndex(Math.floor(unit.x / cellSize), cols);
      let startRow = clampIndex(Math.floor(unit.y / cellSize), rows);
      let goalCol = clampIndex(Math.floor(target.x / cellSize), cols);
      let goalRow = clampIndex(Math.floor(target.y / cellSize), rows);

      const startCell = this.findNearestPassableCell(gameState, unit, cellSize, cols, rows, startCol, startRow);
      const goalCell = this.findNearestPassableCell(gameState, unit, cellSize, cols, rows, goalCol, goalRow);
      if (!startCell || !goalCell) {
          return [];
      }
      startCol = startCell.col;
      startRow = startCell.row;
      goalCol = goalCell.col;
      goalRow = goalCell.row;

      const isPassable = (c: number, r: number) => {
          const wx = c * cellSize + cellSize * 0.5;
          const wy = r * cellSize + cellSize * 0.5;
          return gameState.isValidPosition(wx, wy, unit.type);
      };

      const key = (c: number, r: number) => `${c},${r}`;
      const h = (c: number, r: number) => {
          const dx = Math.abs(c - goalCol);
          const dy = Math.abs(r - goalRow);
          return Math.max(dx, dy);
      };

      type Node = { col: number; row: number; g: number; f: number };

      const open: Node[] = [];
      const gScore: number[][] = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
      const cameFrom = new Map<string, { col: number; row: number }>();
      const closed = new Set<string>();

      gScore[startRow][startCol] = 0;
      open.push({ col: startCol, row: startRow, g: 0, f: h(startCol, startRow) });

      const directions = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1]
      ];

      let iterations = 0;
      const maxIterations = cols * rows * 4;

      while (open.length > 0 && iterations < maxIterations) {
          iterations++;
          let bestIndex = 0;
          let bestF = open[0].f;
          for (let i = 1; i < open.length; i++) {
              if (open[i].f < bestF) {
                  bestF = open[i].f;
                  bestIndex = i;
              }
          }
          const current = open.splice(bestIndex, 1)[0];
          const ck = key(current.col, current.row);
          if (closed.has(ck)) continue;
          closed.add(ck);

          if (current.col === goalCol && current.row === goalRow) {
              const pathCells: { col: number; row: number }[] = [];
              let cursor: { col: number; row: number } | undefined = { col: current.col, row: current.row };
              while (cursor) {
                  pathCells.push(cursor);
                  const prev = cameFrom.get(key(cursor.col, cursor.row));
                  cursor = prev;
              }
              pathCells.reverse();
              const result: { x: number, y: number }[] = [];
              for (const c of pathCells) {
                  const wx = c.col * cellSize + cellSize * 0.5;
                  const wy = c.row * cellSize + cellSize * 0.5;
                  result.push({ x: wx, y: wy });
              }
              return result;
          }

          for (const d of directions) {
              const nc = current.col + d[0];
              const nr = current.row + d[1];
              if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
              if (!isPassable(nc, nr)) continue;
              if (d[0] !== 0 && d[1] !== 0) {
                  const c1 = current.col + d[0];
                  const r1 = current.row;
                  const c2 = current.col;
                  const r2 = current.row + d[1];
                  if (!isPassable(c1, r1) || !isPassable(c2, r2)) continue;
              }
              const nk = key(nc, nr);
              if (closed.has(nk)) continue;
              const stepCost = d[0] !== 0 && d[1] !== 0 ? Math.SQRT2 : 1;
              const tentativeG = current.g + stepCost;
              if (tentativeG < gScore[nr][nc]) {
                  gScore[nr][nc] = tentativeG;
                  cameFrom.set(nk, { col: current.col, row: current.row });
                  const f = tentativeG + h(nc, nr);
                  open.push({ col: nc, row: nr, g: tentativeG, f });
              }
          }
      }

      return [];
  }

  private findNearestReachablePoint(gameState: GameState, unit: Unit, target: { x: number, y: number }): { x: number, y: number } | null {
      const radiusSteps = [40, 80, 120, 160, 200];
      for (const r of radiusSteps) {
          const samples = 16;
          for (let i = 0; i < samples; i++) {
              const angle = (i / samples) * Math.PI * 2;
              const x = target.x + Math.cos(angle) * r;
              const y = target.y + Math.sin(angle) * r;
              if (x < 0 || x > gameState.map.width || y < 0 || y > gameState.map.height) continue;
              if (gameState.isValidPosition(x, y, unit.type)) {
                  return { x, y };
              }
          }
      }
      return null;
  }

  private computePathForUnit(gameState: GameState, unit: Unit, target: { x: number, y: number }): { x: number, y: number }[] {
      const domain = this.getUnitDomain(unit.type);
      if (domain === 'AIR') {
          return [target];
      }
      const rawPath = this.findGridPath(gameState, unit, target);
      if (rawPath.length === 0) {
          return [];
      }
      if (rawPath.length <= 2) {
          return rawPath;
      }
      const simplified: { x: number, y: number }[] = [];
      let lastDx = 0;
      let lastDy = 0;
      for (let i = 0; i < rawPath.length; i++) {
          const p = rawPath[i];
          if (i === 0 || i === rawPath.length - 1) {
              simplified.push(p);
          } else {
              const prev = rawPath[i - 1];
              const next = rawPath[i + 1];
              const dx1 = Math.sign(p.x - prev.x);
              const dy1 = Math.sign(p.y - prev.y);
              const dx2 = Math.sign(next.x - p.x);
              const dy2 = Math.sign(next.y - p.y);
              if (dx1 === dx2 && dy1 === dy2 && (dx1 !== 0 || dy1 !== 0)) {
                  continue;
              }
              if (dx1 === lastDx && dy1 === lastDy && simplified.length > 0) {
                  simplified[simplified.length - 1] = p;
              } else {
                  simplified.push(p);
                  lastDx = dx1;
                  lastDy = dy1;
              }
          }
      }
      return simplified;
  }

  private botMoveUnit(gameState: GameState, unitId: string, x: number, y: number, intentPrefix: string, consumeApmFlag: boolean) {
      const unit = gameState.units.find(u => u.id === unitId);
      if (!unit) return;

      const adjusted = gameState.adjustTarget(unit.type, x, y);
      let path = this.computePathForUnit(gameState, unit, adjusted);

      if (path.length === 0) {
          const fallback = this.findNearestReachablePoint(gameState, unit, adjusted);
          if (fallback) {
              path = this.computePathForUnit(gameState, unit, fallback);
          }
          if (path.length === 0) {
              path = [adjusted];
          }
      }

      const domain = this.getUnitDomain(unit.type);
      const directLine = this.isDirectLine(gameState, unit, adjusted, path.length);

      this.logEvent('BOT_PATH', {
          unitId: unit.id,
          type: unit.type,
          domain,
          directLine,
          pathPoints: path.length,
          start: { x: unit.x, y: unit.y },
          goal: adjusted
      });

      if (path.length > 1) {
          unit.path = path.slice(1);
          for (let i = 0; i < path.length - 1; i++) {
              const from = i === 0 ? { x: unit.x, y: unit.y } : path[i];
              const to = path[i + 1];
              this.debugState.intents.push({
                  type: 'debug_line',
                  unitId: unit.id,
                  from,
                  to,
                  color: 'white',
                  label: 'PATH'
              });
          }
      } else {
          unit.path = undefined;
      }

      if (consumeApmFlag && !this.consumeApm(1)) return;

      this.executeMove(gameState, unitId, adjusted.x, adjusted.y, intentPrefix);
  }

  private executeMove(gameState: GameState, unitId: string, x: number, y: number, intentPrefix: string) {
      if (x < 0 || x > gameState.map.width || y < 0 || y > gameState.map.height) {
          this.logEvent('MOVE_ERROR', { unitId, x, y, reason: 'Out of bounds' });
          return;
      }
      
      if (Math.abs(x) < 1 && Math.abs(y) < 1) {
          this.logEvent('MOVE_ERROR', { unitId, x, y, reason: 'Zero Coords' });
          return;
      }

      const unit = gameState.units.find(u => u.id === unitId);
      if (unit) {
          if (unit.targetX !== undefined && unit.targetY !== undefined) {
              const dist = Math.hypot(unit.targetX - x, unit.targetY - y);
              if (dist < 10) {
                  this.usedUnitIds.add(unitId);
                  return;
              }
          }

          gameState.handleMoveIntent(this.playerId, unitId, intentPrefix + Date.now(), x, y);
          this.usedUnitIds.add(unitId);
          
          this.debugState.intents.push({
              type: 'move',
              unitId: unit.id,
              from: { x: unit.x, y: unit.y },
              to: { x, y }
          });
      }
  }

  private moveUnitSafe(gameState: GameState, unitId: string, x: number, y: number) {
      this.botMoveUnit(gameState, unitId, x, y, 'bot_move_', true);
  }

  public requestMovePriority(gameState: GameState, unitId: string, x: number, y: number) {
      this.botMoveUnit(gameState, unitId, x, y, 'bot_prio_', false);
  }

  private buildAvailableMines(gameState: GameState, player: Player, island: Island) {
      const availableGoldSpots = island.goldSpots.filter(s => !s.occupiedBy).length;
      if (availableGoldSpots > 0 && this.canAfford(player, 'mine')) {
          this.ensureBuilderAndBuild(gameState, island, 'mine');
      }
  }

  private manageOffshoreOil(gameState: GameState, player: Player, myUnits: Unit[]) {
      const myConsShips = myUnits.filter(u => u.type === 'construction_ship' && u.status === 'idle');
      if (myConsShips.length === 0) return;

      const spots = gameState.map.oilSpots?.filter(s => !(s as any).occupiedBy && !s.id.startsWith('hidden')) || [];
      
      myConsShips.forEach(ship => {
          if (this.usedUnitIds.has(ship.id)) return;

          let target: any = null;
          let minDist = Infinity;
          spots.forEach(s => {
              const d = Math.hypot(s.x - ship.x, s.y - ship.y);
              if (d < minDist) {
                  minDist = d;
                  target = s;
              }
          });

          if (target) {
              if (minDist < 100) {
                  if (this.consumeApm(1)) {
                      gameState.buildStructure(this.playerId, target.id, 'oil_rig');
                      this.usedUnitIds.add(ship.id);
                      this.markAction(Date.now());
                  }
              } else {
                  this.moveUnitSafe(gameState, ship.id, target.x, target.y);
              }
          }
      });
  }

  private manageOnshoreOil(gameState: GameState, player: Player, myUnits: Unit[], myIslands: Island[]) {
      myIslands.forEach(island => {
           const visibleOil = gameState.map.oilSpots?.filter(s => 
               (!s.id.startsWith('hidden') || this.revealedSpots.has(s.id)) &&
               Math.hypot(s.x - island.x, s.y - island.y) < island.radius + 100 && 
               !(s as any).occupiedBy
           ) || [];

           if (visibleOil.length > 0 && this.canAfford(player, 'oil_well')) {
                const target = visibleOil[0];
                this.ensureBuilderAndBuild(gameState, island, 'oil_well', target.x, target.y);
           }
      });
  }

  private recruitUnitType(gameState: GameState, player: Player, myIslands: Island[], type: string, buildingType: string) {
      if (!this.canAfford(player, type)) return;
      if (!this.consumeApm(1)) return;

      if (gameState.mapType === 'islands') {
          if (buildingType === 'barracks' || buildingType === 'tank_factory') {
              console.log(`[ISLANDS_RULE] denied production ${type} from ${buildingType} reason=LAND_RECRUITMENT_DISABLED`);
              this.logEvent('ISLANDS_RULE', { action: 'DENY_PRODUCTION', unitType: type, buildingType, reason: 'LAND_RECRUITMENT_DISABLED' });
              return;
          }
      }

      // Check Mobile Bases (Units)
      if (['mothership', 'aircraft_carrier'].includes(buildingType)) {
          const mobileBases = gameState.units.filter(u => 
              u.ownerId === this.playerId && 
              u.type === buildingType && 
              (!u.recruitmentQueue || u.recruitmentQueue.length < 5)
          );
          
          if (mobileBases.length > 0) {
              const base = mobileBases[0]; // Pick first available
              // Use 'mobile' as islandId or null, GameState handles it if buildingId is provided
              gameState.recruitUnit(this.playerId, base.targetIslandId || 'mobile', type, base.id);
              this.logEvent('PRODUCTION_ORDER', { type, buildingId: base.id, source: 'MobileBase' });
              this.markAction(Date.now());
              return;
          }
      }

      for (const island of myIslands) {
          const building = island.buildings.find(b => 
              b.type === buildingType && 
              !b.isConstructing && 
              (!b.recruitmentQueue || b.recruitmentQueue.length < 5)
          );

          if (building) {
              gameState.recruitUnit(this.playerId, island.id, type, building.id);
              this.logEvent('PRODUCTION_ORDER', { type, buildingId: building.id });
              this.markAction(Date.now());
              return;
          }
      }
  }
  
  private recruitLandArmy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (this.difficulty >= 4 && this.canAfford(player, 'tank')) {
          this.recruitUnitType(gameState, player, myIslands, 'tank', 'tank_factory');
      }
      
      if (this.canAfford(player, 'soldier')) {
           this.recruitUnitType(gameState, player, myIslands, 'soldier', 'barracks');
      }
  }

  private hasStableOil(player: Player): boolean {
      return player.resources.oil > 50;
  }

  private canAfford(player: Player, type: string): boolean {
      const data = BuildingData[type] || UnitData[type];
      if (!data) return false;
      const reserve = this.defenceReserveGold || 0;
      const spendableGold = player.resources.gold - reserve;
      return spendableGold >= data.cost.gold && player.resources.oil >= data.cost.oil;
  }

  private updateOilSecured(gameState: GameState, player: Player, myIslands: Island[], now: number) {
      let rigCount = 0;
      myIslands.forEach(island => {
          rigCount += island.buildings.filter(b => b.type === 'oil_rig' || b.type === 'oil_well').length;
      });
      rigCount += gameState.map.oilSpots.filter(s => (s as any).ownerId === this.playerId).length;

      if (rigCount <= 0) {
          this.oilSecured = false;
          this.firstOilOnlineTime = null;
          return;
      }

      if (this.firstOilOnlineTime === null) {
          this.firstOilOnlineTime = now;
      }

      let desiredRigs = 1;
      if (this.difficulty >= 4 && this.difficulty <= 6) desiredRigs = 2;
      else if (this.difficulty >= 7 && this.difficulty <= 8) desiredRigs = 3;
      else if (this.difficulty >= 9) desiredRigs = 4;

      if (rigCount >= desiredRigs) {
          this.oilSecured = true;
          return;
      }

      if (this.firstOilOnlineTime && now - this.firstOilOnlineTime > 120000) {
          this.oilSecured = true;
      }
  }

  private ensureBuilderAndBuild(gameState: GameState, island: Island, type: string, x?: number, y?: number) {
      // Build Delay Check
      if (!this.canBuild(Date.now())) return;

      if (gameState.mapType === 'islands' && (type === 'barracks' || type === 'tank_factory')) {
          console.log(`[ISLANDS_RULE] denied build ${type} reason=LAND_RECRUITMENT_DISABLED`);
          this.logEvent('ISLANDS_RULE', { action: 'DENY_BUILD', buildingType: type, reason: 'LAND_RECRUITMENT_DISABLED' });
          return;
      }

      const builders = gameState.units.filter(u => u.ownerId === this.playerId && u.type === 'builder' && u.status === 'idle');
      // Filter builders on this island
      const onIsland = builders.filter(b => Math.hypot(b.x - island.x, b.y - island.y) < island.radius + 100);

      if (onIsland.length > 0) {
          const builder = onIsland[0];
          
          if (this.consumeApm(1)) {
              this.onBuild(Date.now());

              if (x !== undefined && y !== undefined) {
                  // Specific pos
                  gameState.buildStructure(this.playerId, builder.id, type as any, x, y);
                  this.logEvent('BUILD_ORDER', { type, builderId: builder.id, x, y });
                  this.debugState.intents.push({
                      type: 'build',
                      unitId: builder.id,
                      from: { x: builder.x, y: builder.y },
                      to: { x, y },
                      buildType: type
                  });
              } else {
                  // Auto pos
                  // Simple radial search for valid spot
                  const angle = Math.random() * Math.PI * 2;
                  const dist = Math.random() * (island.radius - 20);
                  const bx = island.x + Math.cos(angle) * dist;
                  const by = island.y + Math.sin(angle) * dist;
                  gameState.buildStructure(this.playerId, builder.id, type as any, bx, by);
                  this.logEvent('BUILD_ORDER', { type, builderId: builder.id, x: bx, y: by });
                  this.debugState.intents.push({
                      type: 'build',
                      unitId: builder.id,
                      from: { x: builder.x, y: builder.y },
                      to: { x: bx, y: by },
                      buildType: type
                  });
              }
          }
      } else {
          // Recruit builder?
          const totalBuilders = gameState.units.filter(u => u.ownerId === this.playerId && u.type === 'builder').length;
          const cap = this.getBuilderCap();
          if (totalBuilders >= cap) return;
          const base = island.buildings.find(b => b.type === 'base');
          if (base && this.canAfford(gameState.players.get(this.playerId)!, 'builder')) {
              this.recruitUnitType(gameState, gameState.players.get(this.playerId)!, [island], 'builder', 'base');
          }
      }
  }
  
  private findNearestUnoccupiedOil(gameState: GameState, x: number, y: number, allowHidden: boolean) {
       let best = null;
       let minDist = Infinity;
       gameState.map.oilSpots.forEach(s => {
           if ((s as any).occupiedBy) return;
           if (!allowHidden && s.id.startsWith('hidden') && !this.revealedSpots.has(s.id)) return;
           
           const d = Math.hypot(s.x - x, s.y - y);
           if (d < minDist) {
               minDist = d;
               best = s;
           }
       });
       return best;
  }
  
  private getWorkingIslands(gameState: GameState, myIslands: Island[], myUnits: Unit[]): Island[] {
      const builders = myUnits.filter(u => u.type === 'builder');
      const workingIslands = new Set<Island>([...myIslands]);
      builders.forEach(b => {
          const island = gameState.map.islands.find(i => Math.hypot(i.x - b.x, i.y - b.y) < i.radius + 100);
          if (island) workingIslands.add(island);
      });
      return Array.from(workingIslands);
  }
}
