import { GameState, Unit, Player } from './GameState';
import { Island, MapGenerator } from './MapGenerator';
import { BuildingData, UnitData } from './data/Registry';
import { AttackManager } from './AttackManager';
import { BaseDefenseBuilder } from './BaseDefenseBuilder';
import {
    BotMatchPhase,
    BotStrategyProfile,
    canDeployCapitalShips,
    getFallbackBotStrategyProfile,
    resolveBotMatchPhase
} from './bot-difficulties/BotStrategyProfile';

// --- CONFIGURATION TABLES ---
const THINK_INTERVALS = [2000, 1650, 1350, 1150, 950, 800, 650, 550, 450, 350]; // ms
const MAX_APM = [25, 40, 55, 70, 85, 105, 125, 145, 165, 190];
const EXPAND_WEIGHTS = [0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20, 1.30, 1.45, 1.55];
const ATTACK_WEIGHTS = [0.35, 0.50, 0.65, 0.80, 0.95, 1.10, 1.25, 1.40, 1.55, 1.75];
const MIN_ARMY_PERC = [0.86, 0.80, 0.75, 0.70, 0.64, 0.58, 0.52, 0.47, 0.42, 0.37];
const PLAYER_TARGET_BIAS = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80];
const BUILD_DELAY_MIN = [5000, 4200, 3400, 2600, 2100, 1700, 1300, 950, 700, 450];
const BUILD_DELAY_MAX = [10000, 8500, 7000, 5600, 4600, 3600, 2800, 2000, 1400, 900];
const ATTACK_START_TIME = [100, 95, 90, 85, 80, 75, 65, 55, 50, 45]; // Sec
const BOT_BASIC_INFANTRY_TYPES = ['soldier', 'sniper', 'rocketeer'] as const;
const BOT_BASIC_INFANTRY_CAP = 10;

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
  public readonly strategyProfile: BotStrategyProfile;
  private readonly baseActionInterval: number;
  private readonly baseMinBuildDelay: number;
  private readonly baseMaxBuildDelay: number;
  private readonly baseMaxApmTokens: number;
  private loadFactor: number = 0;
  
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
  private firstAirBaseBuiltAt: number | null = null;
  private nextMothershipSavingsAt: number | null = null;
  private mothershipSavingsActive: boolean = false;
  private unitLastPositions: Map<string, { x: number; y: number; lastMoveTime: number }> = new Map();
  private recentMoveOrders: Map<string, { x: number; y: number; issuedAt: number }> = new Map();
  private lastGateAutoTime: number = 0;
  private buildRetryCooldownUntil: Map<string, number> = new Map();
  private recruitSelectionCursor: Map<string, number> = new Map();
  private islandPlacementFailures: Map<string, { count: number; lastFailedAt: number; types: Set<string> }> = new Map();
  private capitalRepairRetreatIds: Set<string> = new Set();
  
  // Debug State
  public debugState: any = {
      goalScores: [],
      currentGoal: 'Idle',
      apm: 0,
      nextThink: 0,
      lastDecision: '',
      lastDecisionScore: 0,
      target: null,
      intents: [], // Stores current tick's intents for visualization
      logs: [],
      production: {}
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
        buildFleetStartedAt: 0,
        lastRallyRefreshAt: 0,
        homeDefenders: new Set<string>(), // IDs of units assigned to home defence
        fleet: new Set<string>() // IDs of units in the main fleet
    };

    private logEvent(type: string, data: any) {
      const event = {
          eventType: type,
          tick: Date.now(),
          ...data
      };
      this.debugState.logs.push(event);
      if (this.debugState.logs.length > 50) this.debugState.logs.shift(); // Keep last 50
  }

  constructor(playerId: string, difficulty: number = 5, strategyProfile?: BotStrategyProfile) {
    this.playerId = playerId;
    this.difficulty = Math.max(1, Math.min(10, difficulty));
    this.strategyProfile = strategyProfile || getFallbackBotStrategyProfile(this.difficulty);
    this.startTime = Date.now();
    this.lastMeaningfulActionTime = this.startTime;
    
    const levelIdx = this.difficulty - 1;
    
    // 1. Difficulty Scaling
    this.baseActionInterval = THINK_INTERVALS[levelIdx];
    this.baseMaxApmTokens = MAX_APM[levelIdx];
    this.baseMinBuildDelay = BUILD_DELAY_MIN[levelIdx];
    this.baseMaxBuildDelay = BUILD_DELAY_MAX[levelIdx];
    this.actionInterval = this.baseActionInterval;
    this.maxApmTokens = this.baseMaxApmTokens;
    this.apmTokens = this.maxApmTokens; // Start full
    this.minBuildDelay = this.baseMinBuildDelay;
    this.maxBuildDelay = this.baseMaxBuildDelay;
    this.setNextBuildDelay();
    
    // Air Phase: 600 - (level-1)*(510/9)
    const airSec = 600 - (levelIdx) * (510 / 9);
    this.timeToAirPhase = airSec * 1000;

    this.attackManager = new AttackManager(this);
    this.baseDefenseBuilder = new BaseDefenseBuilder(this);

    this.debugState.strategyProfile = {
        controllerId: this.strategyProfile.controllerId,
        category: this.strategyProfile.category,
        level: this.strategyProfile.level
    };

    console.log(`Bot ${playerId} (Diff ${difficulty}) Init: Think=${this.actionInterval}ms, MaxAPM=${this.maxApmTokens}, AirStart=${Math.round(airSec)}s controller=${this.strategyProfile.controllerId}`);
  }

  public getMatchPhase(now: number = Date.now()): BotMatchPhase {
      return resolveBotMatchPhase(now - this.startTime);
  }

  public resetMatchStartTime(startTime: number = Date.now()) {
      this.startTime = startTime;
      this.lastActionTime = 0;
      this.lastMeaningfulActionTime = startTime;
      this.lastBuildTime = 0;
      this.lastApmRefill = startTime;
      this.openingStartedAt = null;
      this.openingFirstActionAt = null;
      this.firstAirBaseBuiltAt = null;
      this.nextMothershipSavingsAt = null;
      this.mothershipSavingsActive = false;
      this.recentMoveOrders.clear();
      this.debugState.currentGoal = 'WAITING_FOR_PLAYERS';
      this.debugState.lastDecision = 'Match start synchronized to human-ready gate';
      this.setLoadFactor(0);
  }

  public setLoadFactor(loadFactor: number) {
      const clamped = Math.max(0, Math.min(1, loadFactor));
      if (Math.abs(clamped - this.loadFactor) < 0.01) return;

      this.loadFactor = clamped;
      const actionIntervalScale = 1 + clamped * 2.1;
      const apmScale = Math.max(0.22, 1 - clamped * 0.74);
      const buildDelayScale = 1 + clamped * 1.05;

      this.actionInterval = Math.round(this.baseActionInterval * actionIntervalScale);
      this.maxApmTokens = Math.max(8, Math.round(this.baseMaxApmTokens * apmScale));
      this.minBuildDelay = Math.round(this.baseMinBuildDelay * buildDelayScale);
      this.maxBuildDelay = Math.round(this.baseMaxBuildDelay * buildDelayScale);
      this.currentBuildDelay = Math.max(this.currentBuildDelay, this.minBuildDelay);
      this.apmTokens = Math.min(this.apmTokens, this.maxApmTokens);

      this.debugState.simulationLoad = Number(clamped.toFixed(2));
      this.debugState.thinkInterval = this.actionInterval;
      this.debugState.maxApm = this.maxApmTokens;
  }

  public hasAssignedUnitOrder(unitId: string): boolean {
      return this.usedUnitIds.has(unitId);
  }

  public getDefenceTargets(mapType?: string, now: number = Date.now()): { towers: number; wallNodes: number } {
      const phase = this.getMatchPhase(now);
      const wallTauntBonus =
          phase === 'EARLY'
              ? (this.difficulty >= 7 ? 1 : 0)
              : (this.difficulty >= 8 ? 2 : this.difficulty >= 5 ? 1 : 0);
      const wallTarget = (baseTarget: number) => Math.max(0, baseTarget + wallTauntBonus);
      if (mapType === 'grasslands' && this.difficulty <= 3 && phase === 'EARLY') {
          return {
              towers: Math.min(1, this.strategyProfile.towers),
              wallNodes: Math.min(4, wallTarget(this.strategyProfile.wallNodes))
          };
      }

      if (mapType === 'grasslands' && this.difficulty >= 10) {
          if (phase === 'EARLY') {
              return {
                  towers: Math.min(2, this.strategyProfile.towers),
                  wallNodes: Math.min(6, wallTarget(this.strategyProfile.wallNodes))
              };
          }
          if (phase === 'MID') {
              return {
                  towers: Math.min(4, this.strategyProfile.towers),
                  wallNodes: Math.min(9, wallTarget(this.strategyProfile.wallNodes))
              };
          }
      }

      return {
          towers: this.strategyProfile.towers,
          wallNodes: wallTarget(this.strategyProfile.wallNodes)
      };
  }

  public getStrategySnapshot(mapType: string = 'random', now: number = Date.now()) {
      const phase = this.getMatchPhase(now);
      const defenceTargets = this.getDefenceTargets(mapType, now);
      return {
          controllerId: this.strategyProfile.controllerId,
          difficulty: this.difficulty,
          phase,
          mapType,
          resourceClaims: this.getDesiredResourceClaims(phase),
          towers: this.getDesiredTowerCount(),
          wallNodes: defenceTargets.wallNodes,
          recruitmentBuildings: this.getDesiredRecruitmentBuildingCount(mapType, phase, true),
          airBases: this.getDesiredAirBaseCount(mapType, true, phase),
          capitalShipsUnlocked: canDeployCapitalShips(this.strategyProfile.capitalShipTiming, phase)
      };
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
    this.debugState.simulationLoad = Number(this.loadFactor.toFixed(2));
    this.debugState.thinkInterval = this.actionInterval;
    this.debugState.maxApm = this.maxApmTokens;

    // C2: Aggression State Debug
    const config = DifficultyConfig(this.difficulty);
    const elapsedSec = (now - this.startTime) / 1000;
    const aggressionActive = elapsedSec >= config.attackStartTime;
    const phase = this.getMatchPhase(now);
    
    this.debugState.aggressionState = {
        phase,
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
    const myIslands = this.getControlledIslands(gameState);
    const myUnits = gameState.units.filter(u => u.ownerId === this.playerId);
    if (myIslands.length === 0 && myUnits.length === 0) return; // Dead
    this.refreshRevealedOilSpots(gameState, myUnits);

    this.protectBuildersNearEnemyFire(gameState, myUnits, myIslands);

    // Let base defences act first with fresh APM/resources
    if (this.openingStartedAt === null) {
        this.openingStartedAt = now;
        console.log(`[BOT_OPENING] bot=${this.playerId} startedAt=${this.openingStartedAt}`);
    }
    const beforeDefenceActions = this.baseDefenseBuilder.debugState.lastAction;
    const shouldDelayOpeningDefences = this.shouldDelayBaseDefencesOpening(gameState, myIslands, myUnits, now);
    if (!shouldDelayOpeningDefences) {
        this.baseDefenseBuilder.tick(gameState, now);
    }
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
    this.debugState.lastDecision = winner.goal;
    this.debugState.lastDecisionScore = Number(winner.score.toFixed(2));
    
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

    if (this.difficulty >= 7) {
        if (winner.goal !== 'ATTACK' && this.apmTokens > 1) {
            this.manageArmy(gameState, player, myUnits, myIslands);
        }
        if (winner.goal !== 'EXPAND' && this.apmTokens > 1) {
            this.runMapStrategy(gameState, player, myIslands, myUnits);
        }
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
              const endpoints = gameState.getBridgeEndpoints(bridge);
              if (!endpoints) continue;
              const { ax, ay, bx, by } = endpoints;

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
          const endpoints = gameState.getBridgeEndpoints(b);
          if (!endpoints) return false;
          const { ax, ay, bx, by } = endpoints;
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

  private protectBuildersNearEnemyFire(gameState: GameState, myUnits: Unit[], myIslands: Island[]) {
      const workers = myUnits.filter(
          unit => ['builder', 'construction_ship', 'oil_seeker'].includes(unit.type) && !this.usedUnitIds.has(unit.id)
      );
      if (workers.length === 0) return;

      const fallbackRetreat = this.getHomeRetreatPoint(gameState, myIslands);
      if (!fallbackRetreat) return;

      const enemyThreats = this.getEnemyThreatZones(gameState, true);
      if (enemyThreats.length === 0) return;

      workers.forEach(worker => {
          const localThreat = this.estimateThreatAtPoint(worker.x, worker.y, enemyThreats);
          if (localThreat < 2.5) return;

          const retreatPoint = this.getThreatAwareApproachPoint(
              gameState,
              worker,
              fallbackRetreat.x,
              fallbackRetreat.y,
              enemyThreats,
              true
          );
          this.moveUnitSafe(gameState, worker.id, retreatPoint.x, retreatPoint.y);
      });
  }

  private getHomeRetreatPoint(gameState: GameState, myIslands: Island[]): { x: number; y: number } | null {
      for (const island of myIslands) {
          const dock = island.buildings.find(building => building.type === 'dock' && building.ownerId === this.playerId);
          if (dock) {
              return { x: island.x + (dock.x || 0), y: island.y + (dock.y || 0) };
          }
      }

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return null;
      const base = baseIsland.buildings.find(building => building.type === 'base' && building.ownerId === this.playerId);
      if (!base) return { x: baseIsland.x, y: baseIsland.y };

      return {
          x: baseIsland.x + (base.x || 0),
          y: baseIsland.y + (base.y || 0)
      };
  }

  private getBaseRepairRetreatPoint(
      gameState: GameState,
      myIslands: Island[]
  ): { x: number; y: number; range: number } | null {
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (baseIsland) {
          const baseRepairDock = baseIsland.buildings.find(
              building => building.type === 'repair_dock' && building.ownerId === this.playerId && !building.isConstructing
          );
          if (baseRepairDock) {
              return {
                  x: baseIsland.x + (baseRepairDock.x || 0),
                  y: baseIsland.y + (baseRepairDock.y || 0),
                  range: baseRepairDock.range || BuildingData.repair_dock?.range || 220
              };
          }
      }

      for (const island of myIslands) {
          const repairDock = island.buildings.find(
              building => building.type === 'repair_dock' && building.ownerId === this.playerId && !building.isConstructing
          );
          if (repairDock) {
              return {
                  x: island.x + (repairDock.x || 0),
                  y: island.y + (repairDock.y || 0),
                  range: repairDock.range || BuildingData.repair_dock?.range || 220
              };
          }
      }

      const fallback = this.getHomeRetreatPoint(gameState, myIslands);
      if (!fallback) return null;
      return {
          x: fallback.x,
          y: fallback.y,
          range: BuildingData.repair_dock?.range || 220
      };
  }

  private getCapitalRepairHoldPoint(
      retreatPoint: { x: number; y: number; range: number },
      unitId: string
  ): { x: number; y: number } {
      const hash = Array.from(unitId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const angle = (hash % 360) * (Math.PI / 180);
      const maxOffset = Math.max(26, retreatPoint.range - 34);
      const radius = Math.min(maxOffset, 34 + (hash % 4) * 12);
      return {
          x: retreatPoint.x + Math.cos(angle) * radius,
          y: retreatPoint.y + Math.sin(angle) * radius
      };
  }

  private shouldCapitalShipRetreat(
      gameState: GameState,
      unit: Unit,
      now: number,
      enemyThreats: Array<{ x: number; y: number; range: number; weight: number }>
  ): boolean {
      const healthRatio = unit.health / Math.max(1, unit.maxHealth);
      const burning = this.isUnitTakingDamageOverTime(unit, now);
      const threatScore = this.estimateThreatAtPoint(unit.x, unit.y, enemyThreats);
      const nearbyThreat = gameState.units.some(enemy =>
          enemy.ownerId !== this.playerId &&
          enemy.health > 0 &&
          !['builder', 'construction_ship', 'oil_seeker', 'ferry'].includes(enemy.type) &&
          Math.hypot(enemy.x - unit.x, enemy.y - unit.y) <= Math.max(260, (enemy.range || 0) + 80)
      );
      const criticalThreshold = 0.3;
      const pressureThreshold =
          this.difficulty >= 9 ? 0.42 :
          this.difficulty >= 7 ? 0.36 :
          0.32;
      const releaseThreshold = 0.92;
      const threatThreshold =
          gameState.mapType === 'islands'
              ? (this.difficulty >= 9 ? 7 : 9)
              : (this.difficulty >= 9 ? 9 : 11);
      const underPressure = threatScore >= threatThreshold || nearbyThreat;

      if (healthRatio <= criticalThreshold) return true;
      if (burning) return true;
      if (healthRatio <= pressureThreshold && underPressure) return true;
      if (this.capitalRepairRetreatIds.has(unit.id) && healthRatio < releaseThreshold) return true;
      return false;
  }

  private getEnemyThreatZones(
      gameState: GameState,
      includeUnitThreats: boolean = true
  ): Array<{ x: number; y: number; range: number; weight: number }> {
      const threats: Array<{ x: number; y: number; range: number; weight: number }> = [];

      gameState.map.islands.forEach(island => {
          island.buildings.forEach(building => {
              if (!building.ownerId || building.ownerId === this.playerId) return;
              const stats = BuildingData[building.type];
              const damage = (stats as any)?.damage;
              if (!stats?.range || !damage || damage <= 0) return;
              threats.push({
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  range: stats.range + 55,
                  weight: building.type === 'tower' || building.type === 'base' ? 1.6 : 1.25
              });
          });
      });

      if (includeUnitThreats) {
          gameState.units.forEach(unit => {
              if (unit.ownerId === this.playerId || unit.health <= 0) return;
              const stats = UnitData[unit.type];
              if (!stats || !stats.range || !stats.damage || stats.damage <= 0) return;
              threats.push({
                  x: unit.x,
                  y: unit.y,
                  range: stats.range + (stats.range > 180 ? 45 : 25),
                  weight: stats.range > 220 ? 1.45 : 1.1
              });
          });
      }

      return threats;
  }

  private estimateThreatAtPoint(
      x: number,
      y: number,
      threats: Array<{ x: number; y: number; range: number; weight: number }>
  ): number {
      let score = 0;
      threats.forEach(threat => {
          const d = Math.hypot(x - threat.x, y - threat.y);
          if (d <= threat.range) {
              score += (4 + (threat.range - d) / 35) * threat.weight;
              return;
          }
          const bleedRange = threat.range + 140;
          if (d <= bleedRange) {
              score += ((bleedRange - d) / 90) * threat.weight;
          }
      });
      return score;
  }

  private estimateThreatAlongRoute(
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      threats: Array<{ x: number; y: number; range: number; weight: number }>
  ): number {
      const steps = 6;
      let score = 0;
      for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const px = fromX + (toX - fromX) * t;
          const py = fromY + (toY - fromY) * t;
          score += this.estimateThreatAtPoint(px, py, threats);
      }
      return score / steps;
  }

  private getThreatAwareApproachPoint(
      gameState: GameState,
      unit: { type: string; x: number; y: number },
      targetX: number,
      targetY: number,
      threats: Array<{ x: number; y: number; range: number; weight: number }>,
      preferSafety: boolean = false
  ): { x: number; y: number } {
      const directPoint = gameState.adjustTarget(unit.type, targetX, targetY);
      if (threats.length === 0) return directPoint;

      const directThreat = this.estimateThreatAlongRoute(unit.x, unit.y, directPoint.x, directPoint.y, threats);
      const directThreshold = preferSafety ? 0.8 : 1.4;
      if (directThreat <= directThreshold) {
          return directPoint;
      }

      const dx = directPoint.x - unit.x;
      const dy = directPoint.y - unit.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 90) return directPoint;

      const nx = dx / distance;
      const ny = dy / distance;
      const px = -ny;
      const py = nx;
      const sideLeg = Math.min(260, Math.max(130, distance * 0.32));
      const midDist = Math.min(340, Math.max(120, distance * 0.5));

      const candidates = [
          { x: unit.x + nx * midDist + px * sideLeg, y: unit.y + ny * midDist + py * sideLeg },
          { x: unit.x + nx * midDist - px * sideLeg, y: unit.y + ny * midDist - py * sideLeg },
          { x: directPoint.x - nx * 120 + px * sideLeg * 0.7, y: directPoint.y - ny * 120 + py * sideLeg * 0.7 },
          { x: directPoint.x - nx * 120 - px * sideLeg * 0.7, y: directPoint.y - ny * 120 - py * sideLeg * 0.7 },
          directPoint
      ];

      let best = directPoint;
      let bestScore = Number.POSITIVE_INFINITY;
      candidates.forEach(candidate => {
          const adjusted = gameState.adjustTarget(unit.type, candidate.x, candidate.y);
          const legOne = this.estimateThreatAlongRoute(unit.x, unit.y, adjusted.x, adjusted.y, threats);
          const legTwo = this.estimateThreatAlongRoute(adjusted.x, adjusted.y, directPoint.x, directPoint.y, threats);
          const pointThreat = this.estimateThreatAtPoint(adjusted.x, adjusted.y, threats);
          const distPenalty =
              Math.hypot(adjusted.x - unit.x, adjusted.y - unit.y) / 520 +
              Math.hypot(directPoint.x - adjusted.x, directPoint.y - adjusted.y) / 360;
          const score = legOne * 1.5 + legTwo + pointThreat + distPenalty;
          if (score < bestScore) {
              bestScore = score;
              best = adjusted;
          }
      });

      return best;
  }

  private pickSafestOilSpot(
      origin: { x: number; y: number },
      spots: Array<{ id: string; x: number; y: number }>,
      threats: Array<{ x: number; y: number; range: number; weight: number }>,
      reservedSpotIds: Set<string>
  ): { id: string; x: number; y: number } | null {
      let best: { id: string; x: number; y: number } | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      spots.forEach(spot => {
          if (reservedSpotIds.has(spot.id)) return;
          const travelDistance = Math.hypot(spot.x - origin.x, spot.y - origin.y);
          const pointThreat = this.estimateThreatAtPoint(spot.x, spot.y, threats);
          const routeThreat = this.estimateThreatAlongRoute(origin.x, origin.y, spot.x, spot.y, threats);
          const score = travelDistance + pointThreat * 240 + routeThreat * 360;
          if (score < bestScore) {
              bestScore = score;
              best = spot;
          }
      });

      return best;
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
      const phase = this.getMatchPhase();
      const myIslands = this.getControlledIslands(gameState);
      const mineClaims = this.getOwnedMineCount(myIslands);
      const oilClaims = this.getOwnedOilStructureCount(gameState, myIslands);
      const desiredClaims = this.getDesiredResourceClaims(phase);
      const desiredOilClaims = this.getDesiredOilClaimCount(gameState, gameState.mapType, phase);
      const oilShortfall = Math.max(0, desiredOilClaims - oilClaims);
      const readyAirBaseCount = myIslands.reduce(
          (count, island) =>
              count + island.buildings.filter(
                  building => building.ownerId === this.playerId && building.type === 'air_base' && !building.isConstructing
              ).length,
          0
      );
      const oilOnlineForCapital = this.hasStableOil(player) || oilClaims > 0 || player.resources.oil >= 600;
      const desiredMotherships = this.getDesiredMothershipCount(phase, readyAirBaseCount, oilOnlineForCapital);
      const currentMothershipCount = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'mothership');
      const mothershipDeficit = Math.max(0, desiredMotherships - currentMothershipCount);
      const capitalEconomyUrgency = desiredMotherships > 0 && oilShortfall > 0;
      const capitalStrikeAdvantage = this.hasMothershipStrikeAdvantage(gameState, myUnits);
      const highTierCapitalFocus =
          this.difficulty >= 9 &&
          phase !== 'EARLY' &&
          desiredMotherships > 0 &&
          mothershipDeficit > 0;
      const defenceTargets = this.getDefenceTargets(gameState.mapType);
      const defenceReady =
          this.baseDefenseBuilder.debugState.towersBuilt >= Math.max(1, defenceTargets.towers) &&
          this.baseDefenseBuilder.debugState.wallNodesPlaced >= Math.max(3, defenceTargets.wallNodes) &&
          this.baseDefenseBuilder.debugState.wallConnectionsMade >= 1;

      // --- EXPAND SCORE ---
      // Base: 50
      // Boosts: High Resources, Idle Builders, No Buildings
      let expandScore = 50;
      if (player.resources.gold > 500) expandScore += 20;
      if (myUnits.some(u => u.type === 'builder' && u.status === 'idle')) expandScore += 30;
      if (mineClaims + oilClaims < desiredClaims) expandScore += 45;
      if (oilShortfall > 0) expandScore += 35 + Math.min(90, oilShortfall * 18);
      if (this.difficulty >= 9 && oilShortfall > 0) {
          expandScore += 45 + oilShortfall * 22;
      }
      if (capitalEconomyUrgency) expandScore += 30 + this.difficulty * 6;
      if (highTierCapitalFocus) {
          expandScore += 70 + mothershipDeficit * 32;
      }
      if (capitalStrikeAdvantage) {
          expandScore *= 0.62;
      }
      if (phase === 'EARLY') expandScore += 30;
      if (phase === 'LATE') expandScore -= 20;
      if (this.difficulty >= 10 && phase === 'MID') expandScore *= 0.82;
      if (this.difficulty >= 10 && this.debugState?.attackManager?.state === 'ASSAULT') expandScore *= 0.7;
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
      if (phase === 'EARLY') attackScore *= 0.25;
      if (phase === 'MID') attackScore *= 0.9 + this.strategyProfile.aggressionWeight * 0.15;
      if (phase === 'LATE') attackScore *= 1.15 + this.strategyProfile.aggressionWeight * 0.2;
      if (!defenceReady && phase !== 'LATE') attackScore *= this.difficulty >= 9 ? 0.85 : 0.5;
      if (this.difficulty >= 9 && phase !== 'EARLY') {
          if (armySize >= this.getCombatUnitMinimum()) attackScore += 80;
          if (this.debugState?.attackManager?.state === 'ASSAULT') attackScore += 110;
      }
      if (oilShortfall >= 2 && phase !== 'LATE' && this.difficulty >= 6) {
          attackScore *= this.difficulty >= 9 ? 0.88 : 0.74;
      }
      if (capitalEconomyUrgency && phase !== 'LATE') {
          attackScore *= this.difficulty >= 8 ? 0.9 : 0.78;
      }
      if (highTierCapitalFocus) {
          attackScore *= this.difficulty >= 10 ? 0.58 : 0.68;
      }
      if (capitalStrikeAdvantage) {
          attackScore = attackScore * 1.4 + 240;
      }
      
      // --- DEFEND SCORE ---
      // If under attack (units taking damage or enemies near base)
      let defendScore = 0;
      // Simple check: Any enemies near my buildings?
      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const myBuildings = this.getControlledIslands(gameState)
          .flatMap(i => i.buildings
              .filter(b => b.ownerId === this.playerId)
              .map(b => ({ x: i.x + (b.x || 0), y: i.y + (b.y || 0) })));
          
      for (const enemy of enemies) {
          for (const b of myBuildings) {
              if (Math.hypot(enemy.x - b.x, enemy.y - b.y) < 500) {
                  defendScore = 200; // Emergency Priority
                  break;
              }
          }
          if (defendScore > 0) break;
      }
      if (!defenceReady) {
          defendScore = Math.max(defendScore, phase === 'EARLY' ? 170 : 120);
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

      this.manageSupportBuildings(gameState, player, myIslands, myUnits);
  }

  private runIslandsStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const phase = this.getMatchPhase();
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      const visibleOilSpots = (gameState.map.oilSpots || []).filter(spot => !spot.id.startsWith('hidden')).length;
      const navalEconomyRequired = visibleOilSpots > 0;
      const hasReadyDock = myIslands.some(i => this.islandHasReadyOwnedBuildingOfType(i, 'dock'));
      const constructionShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'construction_ship');
      const dockCap = navalEconomyRequired
          ? this.getDesiredDockCount(gameState.mapType, ownedOilStructures > 0 || constructionShips > 0)
          : 0;

      workingIslands.forEach(island => {
          this.buildAvailableMines(gameState, player, island);
      });
      let totalDocks = workingIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'dock'), 0);
      const dockBuildOrder = this.prioritizeStructureBuildIslands(gameState, workingIslands, 'dock');
      for (const island of dockBuildOrder) {
          if (totalDocks >= dockCap) break;
          const docks = this.countOwnedBuildingsOfType(island, 'dock');
          const hasFoothold = island.buildings.some(building => building.type === 'bridge_node' && building.ownerId === this.playerId);
          const perIslandDockCap =
              this.difficulty >= 10 ? (hasFoothold ? 3 : 2) :
              this.difficulty >= 8 ? 2 :
              1;
          if (docks >= perIslandDockCap) continue;
          if (this.canAfford(player, 'dock') && this.ensureBuilderAndBuild(gameState, island, 'dock')) {
              totalDocks += 1;
          }
      }
      this.manageLandBridgeExpansion(gameState, player, myIslands, myUnits);
      this.manageIslandsForwardBuilderStaging(gameState, player, myIslands, myUnits);
      this.manageIslandsBridgeheadDefences(gameState, player, myIslands, myUnits);

      if (hasReadyDock && navalEconomyRequired) {
          const economyShipTarget = Math.max(1, Math.ceil(visibleOilSpots / 2));
          const desiredShips = ownedOilStructures > 0
              ? Math.max(1, Math.min(this.difficulty >= 9 ? 6 : 4, Math.max(Math.floor(this.difficulty / 3), economyShipTarget)))
              : (this.difficulty >= 8 ? 2 : 1);

          if (constructionShips < desiredShips) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
          }
      }
      this.managePirateShipPressure(gameState, player, myIslands, myUnits, hasReadyDock, ownedOilStructures);

      if (navalEconomyRequired) {
          this.manageOffshoreOil(gameState, player, myUnits);
      }
      this.manageOilRigDefenceStructures(gameState, player, myIslands);
      this.manageNavalMineDefence(gameState, player, myIslands, myUnits);

      if (ownedOilStructures <= 0) {
          return;
      }

      if (this.hasStableOil(player)) {
          const destroyers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'destroyer');
          const carriers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'aircraft_carrier');
          
          // "destroyers-before-carriers decreases with level (L8-10 only 2-3)"
          let destroyerThreshold = 6;
          if (this.difficulty >= 8) destroyerThreshold = 3;
          else if (this.difficulty >= 5) destroyerThreshold = 4;
          
          // Build Destroyers until threshold
          if (destroyers < destroyerThreshold) {
              this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
          }
          const sustainedDestroyerCap =
              this.difficulty >= 10 ? 20 :
              this.difficulty >= 8 ? 16 :
              this.difficulty >= 6 ? 14 :
              this.difficulty >= 4 ? 12 :
              this.difficulty >= 2 ? 11 : 9;
          
          const carrierUnlocked = canDeployCapitalShips(this.strategyProfile.capitalShipTiming, phase);

          // Then one carrier once the economy, fleet, and timing are ready
          if (this.difficulty >= 2 && carrierUnlocked) {
              const carrierCap = 1;
              if (destroyers >= destroyerThreshold && carriers < carrierCap) {
                  this.recruitUnitType(gameState, player, myIslands, 'aircraft_carrier', 'dock');
              }
              if (destroyers < sustainedDestroyerCap) {
                  this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
              }
          } else {
              // Low diff keeps building destroyers, but higher low tiers still out-scale predecessors.
              if (destroyers < sustainedDestroyerCap) {
                  this.recruitUnitType(gameState, player, myIslands, 'destroyer', 'dock');
              }
          }
      }
  }

  private managePirateShipPressure(
      gameState: GameState,
      player: Player,
      myIslands: Island[],
      myUnits: Unit[],
      hasReadyDock: boolean,
      ownedOilStructures: number
  ) {
      if (!hasReadyDock) return;

      const phase = this.getMatchPhase();
      const pirateShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'pirate_ship');
      const enemyOilCount = (gameState.map.oilSpots || []).filter(
          spot => (spot as any).ownerId && (spot as any).ownerId !== this.playerId
      ).length;

      let desiredPirates = 0;
      if (this.difficulty <= 3) {
          if (phase === 'EARLY') desiredPirates = 3 + this.difficulty; // L1-L3 rush with 4-6 pirates
          else if (phase === 'MID') desiredPirates = 4 + this.difficulty;
          else desiredPirates = 3 + Math.max(1, this.difficulty - 1);
      } else if (this.difficulty >= 8) {
          const oilRaidMode =
              enemyOilCount > 0 &&
              (phase === 'EARLY' || ownedOilStructures === 0 || enemyOilCount > ownedOilStructures);
          if (oilRaidMode) {
              desiredPirates = this.difficulty >= 10 ? 5 : 4;
          } else if (phase !== 'EARLY') {
              desiredPirates = this.difficulty >= 10 ? 3 : 2;
          }
      } else if (phase !== 'LATE' && (gameState.mapType === 'islands' || enemyOilCount > 0)) {
          desiredPirates = 2;
      }

      if (gameState.mapType !== 'islands') {
          desiredPirates = Math.min(desiredPirates, this.difficulty <= 3 ? 4 : 3);
      }

      if (pirateShips >= desiredPirates) return;

      const maxOrdersPerThink = this.difficulty <= 3 ? 3 : this.difficulty >= 8 ? 2 : 1;
      const orders = Math.max(1, Math.min(maxOrdersPerThink, desiredPirates - pirateShips));
      for (let order = 0; order < orders; order += 1) {
          if (!this.canAfford(player, 'pirate_ship')) break;
          this.recruitUnitType(gameState, player, myIslands, 'pirate_ship', 'dock');
      }
  }

  private runGrasslandsStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      const totalBuilders = this.getBuilderCountIncludingQueue(gameState, myIslands, myUnits);
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      const oilOnline = this.hasStableOil(player) || ownedOilStructures > 0;
      const elapsedMs = Date.now() - this.startTime;
      const offshoreOilSpots = (gameState.map.oilSpots || []).filter(spot => !this.isOilSpotOnLand(gameState, spot.x, spot.y));
      const hasOffshoreOil = offshoreOilSpots.length > 0;
      const dockCap = hasOffshoreOil ? this.getDesiredDockCount(gameState.mapType, oilOnline) : 0;
      const barracksCap = this.getDesiredBarracksCount(gameState.mapType, oilOnline);
      const factoryCap = this.getDesiredFactoryCount(gameState.mapType, oilOnline);
      const openingBarracksTarget =
          this.difficulty >= 10 && !oilOnline
              ? Math.min(3, Math.max(2, barracksCap))
              : this.difficulty >= 9
                  ? Math.min(3, Math.max(2, barracksCap))
                  : this.difficulty >= 2
                      ? Math.min(2, Math.max(1, barracksCap))
                      : 1;
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      const orderedWorkingIslands = [...workingIslands].sort((a, b) => {
          if (baseIsland) {
              if (a.id === baseIsland.id) return -1;
              if (b.id === baseIsland.id) return 1;
              const distA = Math.hypot(a.x - baseIsland.x, a.y - baseIsland.y);
              const distB = Math.hypot(b.x - baseIsland.x, b.y - baseIsland.y);
              return distA - distB;
          }
          return a.id.localeCompare(b.id);
      });

      const openingBuilderTarget =
          this.difficulty >= 10 ? 4 : this.difficulty >= 2 ? 3 : 2;
      if (totalBuilders < Math.min(this.getBuilderCap(), openingBuilderTarget)) {
          if (baseIsland && this.canAfford(player, 'builder')) {
              this.recruitUnitType(gameState, player, [baseIsland], 'builder', 'base');
          }
      }
      if (baseIsland && totalBuilders < 2) {
          const baseBuilding = baseIsland.buildings.find(building => building.type === 'base' && building.ownerId === this.playerId);
          const builderCost = UnitData.builder?.cost?.gold ?? 150;
          if (baseBuilding && player.resources.gold >= builderCost && this.consumeApm(1)) {
              gameState.recruitUnit(this.playerId, baseIsland.id, 'builder', baseBuilding.id);
              this.markAction(Date.now());
          }
      }

      this.stageGrasslandsForwardBuilders(gameState, myIslands, myUnits);
      this.manageGrasslandsForwardExpansion(gameState, player, myIslands, myUnits);
      this.manageLandBridgeExpansion(gameState, player, myIslands, myUnits);

      // Start land oil claims as early as possible so production can scale past soldier-only openings.
      this.manageOnshoreOil(gameState, player, myUnits, orderedWorkingIslands);

      orderedWorkingIslands.forEach(island => {
          this.buildAvailableMines(gameState, player, island);
      });

      let totalDocks = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'dock'), 0);
      if (dockCap > 0) {
          const dockBuildOrder = [...orderedWorkingIslands].sort((a, b) => {
              const distA = offshoreOilSpots.length
                  ? Math.min(...offshoreOilSpots.map(spot => Math.hypot(spot.x - a.x, spot.y - a.y)))
                  : Number.POSITIVE_INFINITY;
              const distB = offshoreOilSpots.length
                  ? Math.min(...offshoreOilSpots.map(spot => Math.hypot(spot.x - b.x, spot.y - b.y)))
                  : Number.POSITIVE_INFINITY;
              return distA - distB;
          });

          for (const island of dockBuildOrder) {
              if (totalDocks >= dockCap) break;
              if (this.canAfford(player, 'dock') && this.ensureBuilderAndBuild(gameState, island, 'dock')) {
                  totalDocks += 1;
              }
          }
      }

      const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
      if (hasReadyDock && hasOffshoreOil) {
          const constructionShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'construction_ship');
          const desiredShips =
              this.difficulty >= 10 ? 4 :
              this.difficulty >= 7 ? 3 :
              this.difficulty >= 4 ? 2 : 1;
          const noOilYet = ownedOilStructures <= 0 || !oilOnline;
          const pressureShips = noOilYet && elapsedMs < 240000 ? Math.max(desiredShips, this.difficulty >= 7 ? 3 : 2) : desiredShips;
          if (constructionShips < desiredShips) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
          } else if (constructionShips < pressureShips) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
          }
          this.manageOffshoreOil(gameState, player, myUnits);
      }
      this.managePirateShipPressure(gameState, player, myIslands, myUnits, hasReadyDock, ownedOilStructures);

      let totalBarracks = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'barracks'), 0);
      for (const island of orderedWorkingIslands) {
          if (totalBarracks >= openingBarracksTarget) break;
          if (this.canAfford(player, 'barracks') && this.ensureBuilderAndBuild(gameState, island, 'barracks')) {
              totalBarracks += 1;
          }
      }

      const hasReadyBarracks = myIslands.some(i => this.islandHasReadyOwnedBuildingOfType(i, 'barracks'));
      let landOpeningReady = false;
      if (hasReadyBarracks) {
          const constructionShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'construction_ship');
          const offshoreBootstrapPending = hasOffshoreOil && hasReadyDock && !oilOnline;
          const shipReserveGold =
              offshoreBootstrapPending && constructionShips === 0 ? (UnitData.construction_ship?.cost?.gold ?? 100) : 0;
          const rigReserveGold = offshoreBootstrapPending ? (BuildingData.oil_rig?.cost?.gold ?? 200) : 0;
          const economyReserveGold = shipReserveGold + rigReserveGold;
          const soldiers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'soldier');
          const baseOpeningSoldierTarget =
              this.difficulty >= 9 ? 6 : this.difficulty >= 7 ? 5 : this.difficulty >= 5 ? 4 : this.difficulty >= 2 ? 4 : 2;
          const openingSoldierTarget = offshoreBootstrapPending
              ? Math.min(this.difficulty >= 8 ? 2 : 1, baseOpeningSoldierTarget)
              : baseOpeningSoldierTarget;
          landOpeningReady = soldiers >= openingSoldierTarget && totalBarracks >= openingBarracksTarget;
          if (soldiers < openingSoldierTarget && player.resources.gold > economyReserveGold) {
              this.recruitUnitType(gameState, player, myIslands, 'soldier', 'barracks');
          }
      }

      if ((landOpeningReady || hasReadyDock) && hasOffshoreOil) {
          this.manageOffshoreOil(gameState, player, myUnits);
      }
      this.manageOilRigDefenceStructures(gameState, player, myIslands);

      let totalFactories = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'tank_factory'), 0);
      for (const island of orderedWorkingIslands) {
          const factoryRush =
              this.difficulty >= 7 &&
              oilOnline &&
              factoryCap > 0 &&
              totalFactories < Math.min(factoryCap, this.difficulty >= 9 ? 2 : 1);

          if (factoryRush && totalBarracks >= Math.min(2, barracksCap) && this.canAfford(player, 'tank_factory') && this.ensureBuilderAndBuild(gameState, island, 'tank_factory')) {
              totalFactories += 1;
          }

          if (hasReadyBarracks && totalBarracks < barracksCap && (!factoryRush || totalBarracks < 2) && this.canAfford(player, 'barracks') && this.ensureBuilderAndBuild(gameState, island, 'barracks')) {
              totalBarracks += 1;
          }
          if ((this.difficulty >= 5 && oilOnline) || (this.difficulty === 2 && factoryCap > 0)) {
               if (totalFactories < factoryCap && this.canAfford(player, 'tank_factory') && this.ensureBuilderAndBuild(gameState, island, 'tank_factory')) {
                   totalFactories += 1;
               }
          }
      }
      this.recruitLandArmy(gameState, player, myIslands, myUnits);
  }

  private runDesertStrategy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);

      // "always exactly 2 builders total"
      const builders = myUnits.filter(u => u.type === 'builder').length;
      const totalBuilders = this.getBuilderCountIncludingQueue(gameState, myIslands, myUnits);
      const cap = this.getBuilderCap();
      if (builders < 2 && totalBuilders < cap && player.resources.gold >= 150) {
          const base = this.getOwnedBaseIsland(gameState, myIslands);
          if (base) {
              const baseB = base.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId);
              if (baseB && this.consumeApm(1)) {
                  gameState.recruitUnit(this.playerId, base.id, 'builder', baseB.id);
                  this.markAction(Date.now());
              }
          }
      }

      const openingBarracksTarget = this.difficulty >= 2 ? Math.min(2, this.strategyProfile.recruitmentBuildings) : 1;
      workingIslands.forEach(island => {
          const barracks = this.countOwnedBuildingsOfType(island, 'barracks');
          if (barracks < openingBarracksTarget && builders >= 2 && this.canAfford(player, 'barracks')) {
              this.ensureBuilderAndBuild(gameState, island, 'barracks');
          }
      });

      const hasReadyBarracks = myIslands.some(i => this.islandHasReadyOwnedBuildingOfType(i, 'barracks'));
      if (hasReadyBarracks) {
          this.manageDesertOilSeeking(gameState, player, myIslands, myUnits);
          this.manageOnshoreOil(gameState, player, myUnits, myIslands);
          const hasOilClaimStarted = this.playerHasOilBuilding(gameState, myIslands) || this.hasStableOil(player);
          if (hasOilClaimStarted) {
              workingIslands.forEach(island => this.buildAvailableMines(gameState, player, island));
          }
      }

      if (hasReadyBarracks) {
          const soldiers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'soldier');
          const openingSoldierTarget =
              this.difficulty >= 9 ? 7 : this.difficulty >= 7 ? 6 : this.difficulty >= 5 ? 4 : 3;
          if (soldiers < openingSoldierTarget) {
              this.recruitUnitType(gameState, player, myIslands, 'soldier', 'barracks');
          }
      }

      const oilEconomyOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const oilStockpileReady =
          player.resources.oil >= (this.difficulty >= 9 ? 600 : this.difficulty >= 7 ? 750 : 900);
      const oilOnline = oilEconomyOnline || oilStockpileReady;
      if (oilOnline) {
          const barracksCap = this.getDesiredBarracksCount(gameState.mapType, oilOnline);
          const factoryCap = this.getDesiredFactoryCount(gameState.mapType, oilOnline);

          workingIslands.forEach(island => {
              const barracks = this.countOwnedBuildingsOfType(island, 'barracks');
              const factories = this.countOwnedBuildingsOfType(island, 'tank_factory');
              const factoryRush =
                  this.difficulty >= 7 &&
                  factoryCap > 0 &&
                  factories < Math.min(factoryCap, this.difficulty >= 9 ? 2 : 1);

              if (factoryRush && barracks >= Math.min(2, barracksCap) && this.canAfford(player, 'tank_factory')) {
                  this.ensureBuilderAndBuild(gameState, island, 'tank_factory');
              }

              if (barracks < barracksCap && (!factoryRush || barracks < 2) && this.canAfford(player, 'barracks')) {
                  this.ensureBuilderAndBuild(gameState, island, 'barracks');
              }

              if (factoryCap > 0) {
                  if (factories < factoryCap && this.canAfford(player, 'tank_factory')) {
                      this.ensureBuilderAndBuild(gameState, island, 'tank_factory');
                  }
              }
          });

          this.recruitLandArmy(gameState, player, myIslands, myUnits);
      }
  }

  private manageDesertOilSeeking(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (gameState.mapType !== 'desert') return;

      const hiddenSpots = (gameState.map.oilSpots || []).filter(
          spot => spot.id.startsWith('hidden') && !(spot as any).occupiedBy
      );
      if (hiddenSpots.length === 0) return;

      const unrevealedSpots = hiddenSpots.filter(spot => !this.revealedSpots.has(spot.id));
      if (unrevealedSpots.length === 0) return;

      const visibleOpenOil = (gameState.map.oilSpots || []).filter(
          spot => this.isOilSpotVisible(spot) && !(spot as any).occupiedBy
      ).length;
      const oilSeekers = myUnits.filter(unit => unit.type === 'oil_seeker');
      const oilSeekerCount = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'oil_seeker');
      const desiredSeekers = this.difficulty >= 8 && hiddenSpots.length >= 3 ? 2 : 1;
      const soldiers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'soldier');
      const scoutPressure = visibleOpenOil === 0 && this.getOwnedOilStructureCount(gameState, myIslands) === 0;

      if (
          oilSeekerCount < desiredSeekers &&
          this.canAfford(player, 'oil_seeker') &&
          (scoutPressure || soldiers >= (this.difficulty >= 8 ? 1 : 2))
      ) {
          this.recruitUnitType(gameState, player, myIslands, 'oil_seeker', 'barracks');
      }

      if (oilSeekers.length === 0) return;

      const enemyThreats = this.getEnemyThreatZones(gameState, true);
      const reservedSpotIds = new Set<string>();
      oilSeekers.forEach(seeker => {
          if (this.usedUnitIds.has(seeker.id)) return;

          const target = this.pickSafestOilSpot(seeker, unrevealedSpots, enemyThreats, reservedSpotIds);
          if (!target) return;

          reservedSpotIds.add(target.id);
          const approachPoint = this.getThreatAwareApproachPoint(gameState, seeker, target.x, target.y, enemyThreats, true);
          this.moveUnitSafe(gameState, seeker.id, approachPoint.x, approachPoint.y);
      });
  }

  // ==========================================
  // UNIVERSAL HELPERS
  // ==========================================

  private getBuilderCap(): number {
      return this.strategyProfile.builderCap;
  }

  private getCombatUnitMinimum(): number {
      return this.strategyProfile.minCombatUnits;
  }

  private getDesiredTowerCount(): number {
      return this.strategyProfile.towers;
  }

  private getDesiredDockCount(mapType: string, navalExpansionOnline: boolean): number {
      const phase = this.getMatchPhase();
      const phaseCap = phase === 'EARLY' ? 1 : phase === 'MID' ? Math.max(1, this.strategyProfile.dockCount - 1) : this.strategyProfile.dockCount;

      if (mapType === 'islands') {
          if (this.difficulty >= 10) {
              if (phase === 'EARLY') return Math.max(2, Math.min(3, this.strategyProfile.dockCount));
              if (phase === 'MID') return Math.max(5, this.strategyProfile.dockCount);
              return Math.max(5, this.strategyProfile.dockCount);
          }
          if (!navalExpansionOnline) return 1;
          if (this.difficulty >= 8 && phase !== 'EARLY') {
              return Math.max(3, phaseCap);
          }
          return Math.max(1, phaseCap);
      }

      if (mapType === 'grasslands') {
          const baseDockCount =
              this.difficulty >= 10 ? 4 :
              this.difficulty >= 8 ? 3 :
              this.difficulty >= 4 ? 2 : 1;
          if (phase === 'EARLY') {
              return this.difficulty >= 7 ? 2 : 1;
          }
          if (phase === 'MID') {
              return this.difficulty >= 8 ? baseDockCount : Math.max(1, baseDockCount - 1);
          }
          return Math.max(1, baseDockCount);
      }

      return 0;
  }

  private getDesiredRecruitmentBuildingCount(mapType: string, phase: BotMatchPhase, oilOnline: boolean): number {
      if (mapType === 'islands') return 0;
      if (this.difficulty >= 10 && (mapType === 'grasslands' || mapType === 'desert')) {
          if (phase === 'EARLY') return Math.max(3, Math.min(this.strategyProfile.recruitmentBuildings, 4));
          if (phase === 'MID') return Math.max(5, Math.min(this.strategyProfile.recruitmentBuildings, 5));
          return Math.max(5, this.strategyProfile.recruitmentBuildings);
      }
      if (!oilOnline) {
          if (mapType === 'grasslands' && phase === 'EARLY') {
              if (this.difficulty === 3) return 2;
              if (this.difficulty === 7 || this.difficulty === 8) return 2;
          }
          if (mapType === 'grasslands' && this.difficulty >= 10) {
              return phase === 'EARLY'
                  ? Math.max(2, Math.min(this.strategyProfile.recruitmentBuildings, 3))
                  : Math.max(3, Math.min(this.strategyProfile.recruitmentBuildings, 4));
          }
          if (mapType === 'desert' && this.difficulty >= 2) {
              return phase === 'EARLY'
                  ? 1
                  : Math.max(1, Math.min(this.strategyProfile.recruitmentBuildings, this.difficulty >= 7 ? 3 : 2));
          }
          if (mapType === 'grasslands' && this.difficulty >= 9) {
              return phase === 'EARLY'
                  ? 2
                  : Math.max(2, Math.min(this.strategyProfile.recruitmentBuildings, 3));
          }
          if (mapType === 'grasslands' && phase !== 'EARLY' && this.difficulty >= 4) {
              return Math.max(1, Math.min(this.strategyProfile.recruitmentBuildings, 2));
          }
          if (mapType === 'grasslands' && phase !== 'EARLY' && this.difficulty >= 2) {
              return 2;
          }
          return 1;
      }
      if (phase === 'EARLY') return Math.max(1, this.strategyProfile.recruitmentBuildings - 1);
      if (phase === 'MID') return Math.max(1, this.strategyProfile.recruitmentBuildings);
      return this.strategyProfile.recruitmentBuildings;
  }

  private getDesiredBarracksCount(mapType: string, oilOnline: boolean): number {
      return this.getDesiredRecruitmentBuildingCount(mapType, this.getMatchPhase(), oilOnline);
  }

  private getDesiredFactoryCount(mapType: string, oilOnline: boolean): number {
      if (this.difficulty >= 10 && (mapType === 'grasslands' || mapType === 'desert')) {
          if (!oilOnline) return 1;
          const phase = this.getMatchPhase();
          if (phase === 'EARLY') return Math.max(2, Math.min(this.strategyProfile.factoryCount, 3));
          if (phase === 'MID') return Math.max(5, Math.min(this.strategyProfile.factoryCount, 5));
          return Math.max(5, this.strategyProfile.factoryCount);
      }
      if (this.difficulty >= 3 && this.difficulty < 10 && mapType !== 'islands') {
          if (!oilOnline) return 0;
          const phase = this.getMatchPhase();
          if (phase === 'EARLY') return 0;
          if (phase === 'MID') return 1;
          return Math.min(2, Math.max(1, this.strategyProfile.factoryCount));
      }
      if (this.difficulty === 2 && mapType !== 'islands') {
          const phase = this.getMatchPhase();
          if (phase === 'EARLY') return 0;
          return 1;
      }
      if (!oilOnline && mapType === 'grasslands' && this.difficulty >= 10) {
          return 1;
      }
      if (!oilOnline || mapType === 'islands' || this.difficulty < 4) return 0;
      const phase = this.getMatchPhase();
      if (phase === 'EARLY') return Math.min(1, this.strategyProfile.factoryCount);
      if (phase === 'MID') return Math.max(1, this.strategyProfile.factoryCount - 1);
      return this.strategyProfile.factoryCount;
  }

  private getDesiredAirBaseCount(mapType: string, oilOnline: boolean, phase: BotMatchPhase = this.getMatchPhase()): number {
      if (!oilOnline) return 0;
      if (phase === 'EARLY') {
          if (this.difficulty >= 10) {
              return 1;
          }
          if (this.difficulty >= 9) {
              return 1;
          }
          return 0;
      }
      if (mapType === 'islands') {
          if (phase === 'MID') {
              if (this.difficulty >= 10) return 3;
              if (this.difficulty >= 9) return Math.max(2, Math.min(3, this.strategyProfile.airBases + 1));
              if (this.difficulty >= 8) return Math.max(1, Math.min(2, this.strategyProfile.airBases));
              if (this.difficulty >= 6) return 1;
              return 0;
          }
          if (this.difficulty >= 10) return 3;
          if (this.difficulty >= 9) return Math.max(2, Math.min(3, this.strategyProfile.airBases + 1));
          return Math.max(1, this.strategyProfile.airBases);
      }
      if (phase === 'MID') {
          if (this.difficulty >= 10) return 3;
          if (this.difficulty >= 9) return Math.max(2, Math.min(3, this.strategyProfile.airBases + 1));
          if (this.difficulty >= 7) return Math.max(1, Math.min(2, this.strategyProfile.airBases));
          if (this.difficulty >= 5) return Math.min(1, this.strategyProfile.airBases);
          return 0;
      }
      if (this.difficulty >= 10) return Math.max(3, this.strategyProfile.airBases);
      if (this.difficulty >= 9) return Math.max(2, Math.min(3, this.strategyProfile.airBases + 1));
      if (this.difficulty >= 7) return Math.max(1, this.strategyProfile.airBases);
      return Math.max(1, this.strategyProfile.airBases);
  }

  private getDesiredMothershipCount(phase: BotMatchPhase, readyAirBaseCount: number, oilOnline: boolean): number {
      if (!oilOnline || readyAirBaseCount <= 0) return 0;

      if (phase === 'EARLY') {
          if (this.difficulty >= 10 && readyAirBaseCount >= 1) return 1;
          if (this.difficulty >= 9 && readyAirBaseCount >= 1) return 1;
          return 0;
      }

      if (phase === 'MID') {
          if (this.difficulty >= 10) return Math.min(3, Math.max(3, readyAirBaseCount));
          if (this.difficulty >= 9) return Math.min(3, Math.max(2, readyAirBaseCount));
          if (this.difficulty >= 7) return Math.min(2, Math.max(1, readyAirBaseCount));
          if (this.difficulty >= 5) return 1;
          return 0;
      }

      const lateCap =
          this.difficulty >= 10 ? 3 :
          this.difficulty >= 9 ? 3 :
          this.difficulty >= 8 ? 3 :
          this.difficulty >= 5 ? 2 : 1;
      const lateFloor =
          this.difficulty >= 10 ? 2 :
          this.difficulty >= 9 ? 2 :
          1;
      return Math.min(lateCap, Math.max(lateFloor, readyAirBaseCount));
  }

  private getDedicatedMothershipAirBaseCount(readyAirBaseCount: number, desiredMothershipCount: number): number {
      if (readyAirBaseCount <= 0 || desiredMothershipCount <= 0) return 0;
      if (this.difficulty >= 10) return Math.min(3, readyAirBaseCount, desiredMothershipCount);
      if (this.difficulty >= 9) return Math.min(2, readyAirBaseCount, desiredMothershipCount);
      if (this.difficulty >= 8) return Math.min(2, readyAirBaseCount, desiredMothershipCount);
      return 1;
  }

  private getMothershipSavingsIntervalMs(): number {
      const maxIntervalMs = 10 * 60 * 1000;
      const minIntervalMs = 3 * 60 * 1000;
      const normalizedDifficulty = Math.max(0, Math.min(9, this.difficulty - 1)) / 9;
      return Math.round(maxIntervalMs - (maxIntervalMs - minIntervalMs) * normalizedDifficulty);
  }

  private getCapitalFocusReserve(
      desiredMothershipCount: number,
      currentMothershipCount: number,
      savingsActive: boolean
  ): { oil: number; gold: number } {
      const deficit = Math.max(0, desiredMothershipCount - currentMothershipCount);
      if (deficit <= 0) {
          return { oil: 0, gold: 0 };
      }

      const mothershipOilCost = UnitData.mothership?.cost?.oil ?? 1000;
      const mothershipGoldCost = UnitData.mothership?.cost?.gold ?? 2000;
      const reserveFactor = savingsActive
          ? this.difficulty >= 10
              ? 1.35
              : this.difficulty >= 9
                  ? 1.2
                  : 1
          : this.difficulty >= 10
              ? 1.1
              : this.difficulty >= 9
                  ? 0.95
              : this.difficulty >= 7
                  ? 0.5
                  : this.difficulty >= 4
                      ? 0.35
                      : 0.2;

      return {
          oil: Math.ceil(mothershipOilCost * reserveFactor),
          gold: Math.ceil(mothershipGoldCost * reserveFactor)
      };
  }

  private getDesiredResourceClaims(phase: BotMatchPhase): number {
      if (phase === 'EARLY') return this.strategyProfile.resourceClaims;
      if (phase === 'MID') return this.strategyProfile.resourceClaims;
      return this.strategyProfile.resourceClaims + (this.difficulty >= 8 ? 1 : 0);
  }

  private getDesiredOilClaimCount(
      gameState: GameState,
      _mapType: string,
      phase: BotMatchPhase = this.getMatchPhase()
  ): number {
      const visibleSpots = (gameState.map.oilSpots || []).filter(spot => this.isOilSpotVisible(spot));
      const totalSpots = visibleSpots.length;
      if (totalSpots <= 0) return 0;

      const earlyFraction =
          this.difficulty <= 3 ? 0.45 :
          this.difficulty <= 6 ? 0.6 :
          this.difficulty <= 8 ? 0.75 : 1.0;
      const midFraction =
          this.difficulty <= 3 ? 0.75 :
          this.difficulty <= 6 ? 0.9 :
          this.difficulty <= 8 ? 1.0 : 1.0;

      if (phase === 'EARLY') {
          return Math.max(1, Math.min(totalSpots, Math.ceil(totalSpots * earlyFraction)));
      }
      if (phase === 'MID') {
          return Math.max(1, Math.min(totalSpots, Math.ceil(totalSpots * midFraction)));
      }
      return totalSpots;
  }

  private isOilSpotVisible(spot: { id: string }): boolean {
      return !spot.id.startsWith('hidden') || this.revealedSpots.has(spot.id);
  }

  private refreshRevealedOilSpots(gameState: GameState, myUnits: Unit[]) {
      const liveSpotIds = new Set((gameState.map.oilSpots || []).map(spot => spot.id));
      Array.from(this.revealedSpots).forEach(id => {
          if (!liveSpotIds.has(id)) {
              this.revealedSpots.delete(id);
          }
      });

      if (gameState.mapType !== 'desert') return;

      const seekers = myUnits.filter(unit => unit.type === 'oil_seeker');
      if (seekers.length === 0) return;

      const range = Math.max(gameState.map.width, gameState.map.height) / 4;
      (gameState.map.oilSpots || []).forEach(spot => {
          if (!spot.id.startsWith('hidden') || this.revealedSpots.has(spot.id)) return;
          const detected = seekers.some(seeker => Math.hypot(spot.x - seeker.x, spot.y - seeker.y) <= range);
          if (detected) {
              this.revealedSpots.add(spot.id);
          }
      });
  }

  private getOwnedMineCount(myIslands: Island[]): number {
      return myIslands.reduce((count, island) => {
          return count + island.buildings.filter(building => building.type === 'mine' && building.ownerId === this.playerId).length;
      }, 0);
  }

  private getOwnedRecruitmentBuildingCount(myIslands: Island[]): number {
      return myIslands.reduce((count, island) => {
          return count + island.buildings.filter(building => {
              return building.ownerId === this.playerId && (building.type === 'barracks' || building.type === 'tank_factory' || building.type === 'dock');
          }).length;
      }, 0);
  }

  private getAirCapitalForceScore(units: Unit[]): number {
      const weights: Record<string, number> = {
          mothership: 2500,
          aircraft_carrier: 1600,
          heavy_alien: 700,
          heavy_plane: 380,
          alien_scout: 220,
          light_plane: 130,
          destroyer: 180,
          pirate_ship: 80,
          missile_launcher: 260,
          rocketeer: 110,
          tower: 240,
          base: 180
      };

      return units.reduce((sum, unit) => {
          const base = weights[unit.type] ?? 0;
          if (base <= 0) return sum;
          const healthRatio = Math.max(0.35, Math.min(1.05, unit.health / Math.max(1, unit.maxHealth)));
          return sum + base * healthRatio;
      }, 0);
  }

  private hasMothershipStrikeAdvantage(gameState: GameState, myUnits: Unit[]): boolean {
      if (this.difficulty < 9) return false;

      const myMotherships = myUnits.filter(unit => unit.type === 'mothership');
      if (myMotherships.length < 2) return false;

      const enemyUnits = gameState.units.filter(unit => unit.ownerId !== this.playerId);
      const enemyCapitalShips = enemyUnits.filter(unit => ['mothership', 'aircraft_carrier'].includes(unit.type)).length;
      const enemyResponders = enemyUnits.filter(unit =>
          ['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien', 'mothership', 'aircraft_carrier', 'destroyer', 'pirate_ship', 'missile_launcher', 'rocketeer'].includes(unit.type)
      );
      const myCapitalForce = this.getAirCapitalForceScore(
          myUnits.filter(unit =>
              ['mothership', 'aircraft_carrier', 'heavy_alien', 'alien_scout', 'heavy_plane', 'light_plane'].includes(unit.type)
          )
      );
      const enemyResponseForce = this.getAirCapitalForceScore(enemyResponders);
      const enemyBuildings = this.getEnemyBuildings(gameState);
      const enemyBases = enemyBuildings.filter(building => building.type === 'base');
      if (enemyBases.length === 0) return false;

      const enemyBaseOwnerIds = new Set(enemyBases.map(base => base.ownerId).filter((id): id is string => !!id));
      const nearbyAirDefences = enemyBuildings.filter(building =>
          !!building.ownerId &&
          enemyBaseOwnerIds.has(building.ownerId) &&
          ['tower', 'air_base', 'dock', 'repair_dock'].includes(building.type)
      );
      const defencePressure = nearbyAirDefences.reduce((sum, building) => {
          const weight =
              building.type === 'tower' ? 220 :
              building.type === 'air_base' ? 140 :
              building.type === 'dock' ? 70 : 40;
          return sum + weight;
      }, 0);

      return enemyCapitalShips === 0 && myCapitalForce >= (enemyResponseForce + defencePressure) * 1.2;
  }

  private updateMothershipSavingsMode(
      now: number,
      readyAirBaseCount: number,
      mothershipCount: number,
      desiredMothershipCount: number
  ): boolean {
      if (readyAirBaseCount <= 0) {
          this.firstAirBaseBuiltAt = null;
          this.nextMothershipSavingsAt = null;
          this.mothershipSavingsActive = false;
          return false;
      }

      if (this.firstAirBaseBuiltAt === null) {
          this.firstAirBaseBuiltAt = now;
          this.nextMothershipSavingsAt = now + this.getMothershipSavingsIntervalMs();
      }

      if (desiredMothershipCount <= mothershipCount) {
          this.mothershipSavingsActive = false;
          return false;
      }

      if (this.nextMothershipSavingsAt === null) {
          this.nextMothershipSavingsAt = now + this.getMothershipSavingsIntervalMs();
      }

      if (!this.mothershipSavingsActive && this.nextMothershipSavingsAt !== null && now >= this.nextMothershipSavingsAt) {
          this.mothershipSavingsActive = true;
      }

      return this.mothershipSavingsActive;
  }

  private completeMothershipSavingsMode(now: number) {
      this.mothershipSavingsActive = false;
      this.nextMothershipSavingsAt = now + this.getMothershipSavingsIntervalMs();
  }

  private getBuilderCountIncludingQueue(gameState: GameState, myIslands: Island[], myUnits: Unit[]): number {
      return this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'builder');
  }

  private isCombatUnitType(type: string): boolean {
      const workers = ['builder', 'construction_ship', 'oil_seeker', 'ferry'];
      if (workers.includes(type)) return false;
      return true;
  }

  private getControlledIslands(gameState: GameState): Island[] {
      return gameState.map.islands.filter(i =>
          i.ownerId === this.playerId || i.buildings.some(b => b.ownerId === this.playerId)
      );
  }

  private islandHasOwnedBuildingOfType(island: Island, type: string): boolean {
      return island.buildings.some(b => b.type === type && b.ownerId === this.playerId);
  }

  private islandHasReadyOwnedBuildingOfType(island: Island, type: string): boolean {
      return island.buildings.some(b => b.type === type && b.ownerId === this.playerId && !b.isConstructing);
  }

  private countOwnedBuildingsOfType(island: Island, type: string): number {
      return island.buildings.filter(b => b.type === type && b.ownerId === this.playerId).length;
  }

  private getBridgeFootholdIslands(gameState: GameState, islands?: Island[]): Island[] {
      const candidates = islands ?? this.getControlledIslands(gameState);
      return candidates.filter(island =>
          island.buildings.some(building => building.ownerId === this.playerId && building.type === 'bridge_node')
      );
  }

  private getStructureBuildPriority(gameState: GameState, island: Island, structureType: string): number {
      const hasBase = island.buildings.some(building => building.type === 'base' && building.ownerId === this.playerId);
      const hasFoothold = island.buildings.some(building => building.type === 'bridge_node' && building.ownerId === this.playerId);
      const isForwardFoothold = hasFoothold && !hasBase;
      const enemyBase = this.getEnemyBuildings(gameState)
          .filter(building => building.type === 'base')
          .reduce((best, current) => {
              if (!best) return current;
              const bestDist = Math.hypot(best.x - island.x, best.y - island.y);
              const currentDist = Math.hypot(current.x - island.x, current.y - island.y);
              return currentDist < bestDist ? current : best;
          }, null as { id: string; x: number; y: number; ownerId?: string; type: string } | null);
      const enemyBaseDistance = enemyBase ? Math.hypot(enemyBase.x - island.x, enemyBase.y - island.y) : 2000;
      const nearbyOil = (gameState.map.oilSpots || []).filter(
          spot => Math.hypot(spot.x - island.x, spot.y - island.y) <= island.radius + 220
      ).length;
      const readyDock = this.islandHasReadyOwnedBuildingOfType(island, 'dock');
      const readyAirBase = this.islandHasReadyOwnedBuildingOfType(island, 'air_base');
      const enemyOwner = !!island.ownerId && island.ownerId !== this.playerId;

      let score = nearbyOil * 120;
      if (hasBase) score += 120;
      if (isForwardFoothold) score += 180;
      if (enemyOwner) score += 140;
      score += Math.max(0, 1100 - enemyBaseDistance) * 0.18;

      if (structureType === 'dock') {
          score += isForwardFoothold ? 420 : 0;
          score += enemyOwner ? 140 : 0;
          score += readyDock ? -260 : 220;
          score += Math.max(0, 900 - enemyBaseDistance) * 0.34;
      } else if (structureType === 'air_base') {
          score += isForwardFoothold ? 620 : 0;
          score += enemyOwner ? 200 : 0;
          score += readyDock ? 220 : -180;
          score += readyAirBase ? -340 : 280;
          score += Math.max(0, 1100 - enemyBaseDistance) * 0.42;
      } else if (structureType === 'repair_dock') {
          score += isForwardFoothold ? 360 : 0;
          score += enemyOwner ? 120 : 0;
          score += readyDock || readyAirBase ? 180 : -120;
          score += Math.max(0, 980 - enemyBaseDistance) * 0.24;
      } else if (structureType === 'hospital') {
          score += hasBase ? 260 : -220;
          score += isForwardFoothold ? -140 : 0;
      } else if (structureType === 'tower') {
          score += isForwardFoothold ? 280 : 0;
          score += enemyOwner ? 160 : 0;
          score += Math.max(0, 980 - enemyBaseDistance) * 0.28;
      }

      score -= this.countOwnedBuildingsOfType(island, structureType) * 260;
      return score;
  }

  private prioritizeStructureBuildIslands(gameState: GameState, islands: Island[], structureType: string): Island[] {
      return [...islands].sort((left, right) => {
          const rightScore = this.getStructureBuildPriority(gameState, right, structureType);
          const leftScore = this.getStructureBuildPriority(gameState, left, structureType);
          if (rightScore !== leftScore) return rightScore - leftScore;
          return left.id.localeCompare(right.id);
      });
  }

  private recordIslandPlacementFailure(islandId: string, buildingType: string, now: number = Date.now()) {
      const existing = this.islandPlacementFailures.get(islandId);
      if (!existing || now - existing.lastFailedAt > 90000) {
          this.islandPlacementFailures.set(islandId, {
              count: 1,
              lastFailedAt: now,
              types: new Set([buildingType])
          });
          return;
      }

      existing.count = Math.min(12, existing.count + 1);
      existing.lastFailedAt = now;
      existing.types.add(buildingType);
  }

  private clearIslandPlacementFailures(islandId: string) {
      this.islandPlacementFailures.delete(islandId);
  }

  private getIslandPlacementFailurePressure(islandId: string, now: number = Date.now()): number {
      const entry = this.islandPlacementFailures.get(islandId);
      if (!entry) return 0;
      if (now - entry.lastFailedAt > 90000) {
          this.islandPlacementFailures.delete(islandId);
          return 0;
      }
      return entry.count + Math.max(0, entry.types.size - 1);
  }

  private islandHasBuildSpaceForType(gameState: GameState, island: Island, buildingType: string): boolean {
      return !!this.findAutoBuildPosition(gameState, island, buildingType);
  }

  private islandCanRelieveExpansionPressure(gameState: GameState, island: Island): boolean {
      if (island.radius < 90) return false;
      return (
          this.islandHasBuildSpaceForType(gameState, island, 'dock') ||
          this.islandHasBuildSpaceForType(gameState, island, 'air_base') ||
          this.islandHasBuildSpaceForType(gameState, island, 'tower') ||
          this.islandHasBuildSpaceForType(gameState, island, 'repair_dock')
      );
  }

  private shouldForceIslandsBridgeExpansion(gameState: GameState, player: Player, myIslands: Island[]): boolean {
      if (gameState.mapType !== 'islands' || this.difficulty < 7) return false;

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return false;

      const phase = this.getMatchPhase();
      const oilOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands) || player.resources.oil >= 120;
      const desiredAirBases = this.getDesiredAirBaseCount(gameState.mapType, oilOnline, phase);
      const baseHasAirBaseSpace = this.islandHasBuildSpaceForType(gameState, baseIsland, 'air_base');
      const baseHasDockSpace = this.islandHasBuildSpaceForType(gameState, baseIsland, 'dock');
      const baseHasRepairSpace = this.islandHasBuildSpaceForType(gameState, baseIsland, 'repair_dock');
      const basePlacementPressure = this.getIslandPlacementFailurePressure(baseIsland.id);
      const defencePlacementBlocked = [
          'NO_LAND_TOWER_CANDIDATES',
          'NO_LAND_WALL_NODE_CANDIDATES',
          'INVALID_TOWER_PLACEMENT',
          'INVALID_WALL_NODE_PLACEMENT'
      ].includes(this.baseDefenseBuilder.debugState.lastSkipReason);
      const baseStructureLoad = baseIsland.buildings.filter(building =>
          building.ownerId === this.playerId &&
          ['base', 'tower', 'wall_node', 'dock', 'repair_dock', 'hospital', 'air_base', 'bridge_node'].includes(building.type)
      ).length;
      const baseBuildPressure =
          (baseHasDockSpace ? 0 : 1) +
          (baseHasRepairSpace ? 0 : 1) +
          (oilOnline && !baseHasAirBaseSpace ? 2 : 0) +
          Math.min(2, Math.floor(basePlacementPressure / 2)) +
          (defencePlacementBlocked ? 2 : 0) +
          (baseStructureLoad >= (this.difficulty >= 10 ? 8 : this.difficulty >= 8 ? 7 : 6) ? 1 : 0);
      const currentAirBaseSites = myIslands.filter(island => this.islandHasBuildSpaceForType(gameState, island, 'air_base')).length;
      const bridgeFootholdCount = this.getBridgeFootholdIslands(gameState, myIslands).filter(island => island.id !== baseIsland.id).length;
      const readyDockCount = myIslands.reduce(
          (count, island) => count + (this.islandHasReadyOwnedBuildingOfType(island, 'dock') ? 1 : 0),
          0
      );
      const constructionShips = this.countUnitsIncludingQueue(
          gameState,
          myIslands,
          gameState.units.filter(unit => unit.ownerId === this.playerId),
          'construction_ship'
      );
      const expansionTargets = gameState.map.islands.filter(island => {
          if (island.id === baseIsland.id) return false;
          if (island.ownerId && island.ownerId !== this.playerId) return false;
          if (this.hasBridgeBetweenIslands(gameState, baseIsland.id, island.id)) return false;
          return this.islandCanRelieveExpansionPressure(gameState, island);
      });

      if (expansionTargets.length === 0) return false;
      if (baseBuildPressure >= 3 && (readyDockCount > 0 || constructionShips > 0)) return true;
      if (basePlacementPressure >= 2 && (readyDockCount > 0 || constructionShips > 0)) return true;
      if (oilOnline && currentAirBaseSites < Math.max(1, desiredAirBases)) return true;
      if (bridgeFootholdCount === 0 && readyDockCount > 0 && phase !== 'EARLY') return true;
      if (this.difficulty >= 9 && !baseHasAirBaseSpace && (player.resources.oil >= 80 || oilOnline)) return true;
      if (this.difficulty >= 10 && baseIsland.buildings.length >= 6 && constructionShips > 0) return true;
      return false;
  }

  private isUnitTakingDamageOverTime(unit: Unit, now: number = Date.now()): boolean {
      const effects = (((unit as any).damageOverTimeEffects || []) as Array<{ endsAt: number }>).filter(
          effect => effect.endsAt > now
      );
      return effects.length > 0 || (((unit as any).burningUntil || 0) > now);
  }

  private getOwnedBaseIsland(gameState: GameState, islands?: Island[]): Island | undefined {
      const candidates = islands ?? this.getControlledIslands(gameState);
      return candidates.find(i =>
          i.buildings.some(
              b => b.type === 'base' && (b.ownerId === this.playerId || (!b.ownerId && i.ownerId === this.playerId))
          )
      );
  }

  private getEnemyBuildings(gameState: GameState): { id: string; x: number; y: number; ownerId?: string; type: string }[] {
      const enemyBuildings: { id: string; x: number; y: number; ownerId?: string; type: string }[] = [];

      gameState.map.islands.forEach(island => {
          island.buildings.forEach(building => {
              const ownerId = building.ownerId || island.ownerId;
              if (!ownerId || ownerId === this.playerId) return;

              enemyBuildings.push({
                  id: building.id,
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  ownerId,
                  type: building.type
              });
          });
      });

      return enemyBuildings;
  }

  private playerHasOilBuilding(gameState: GameState, myIslands: Island[]): boolean {
      const hasIslandOil = myIslands.some(i => 
          i.buildings.some(b => (b.type === 'oil_rig' || b.type === 'oil_well') && b.ownerId === this.playerId)
      );
      if (hasIslandOil) return true;
      return gameState.map.oilSpots.some(s => (s as any).ownerId === this.playerId);
  }

  private considerHQUpgrade(gameState: GameState, player: Player) {
      const now = Date.now();
      const myIslands = this.getControlledIslands(gameState);
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
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
      const fallbackUpgradeMinutes =
          this.difficulty >= 8 ? 3 :
          this.difficulty >= 4 ? 3.5 :
          this.difficulty >= 2 ? 4 : 6;
      const canUpgradeNow = player.resources.gold >= requiredGold && (hasOilIncome || elapsedMin > fallbackUpgradeMinutes);

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

      if (gameState.mapType === 'islands') {
          const navalCombat = myUnits.filter(unit => ['destroyer', 'pirate_ship', 'aircraft_carrier', 'submarine'].includes(unit.type)).length;
          const navalMinimum = this.difficulty >= 8 ? 6 : this.difficulty >= 5 ? 5 : 4;
          if (navalCombat < navalMinimum) {
              const hasDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
              const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
              if (!hasDock && baseIsland && this.canAfford(player, 'dock')) {
                  this.ensureBuilderAndBuild(gameState, baseIsland, 'dock');
              } else {
                  const phase = this.getMatchPhase();
                  const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
                  const enemyOilExists = (gameState.map.oilSpots || []).some(
                      spot => (spot as any).ownerId && (spot as any).ownerId !== this.playerId
                  );
                  const piratePreferred =
                      (this.difficulty <= 3 && phase === 'EARLY') ||
                      (this.difficulty >= 8 && enemyOilExists && ownedOilStructures <= 0);
                  const navalType = piratePreferred ? 'pirate_ship' : 'destroyer';
                  this.recruitUnitType(gameState, player, myIslands, navalType, 'dock');
              }
          }
          return;
      }

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
          if (gameState.mapType === 'islands') {
              if (baseIsland) {
                  const docks = this.countOwnedBuildingsOfType(baseIsland, 'dock');
                  if (docks === 0 && this.canAfford(player, 'dock')) {
                      this.ensureBuilderAndBuild(gameState, baseIsland, 'dock');
                  } else {
                      const consShips = myUnits.filter(u => u.type === 'construction_ship').length;
                      if (consShips === 0 && this.canAfford(player, 'construction_ship')) {
                          this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
                      }
                  }
              }
          } else {
              const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
              this.manageOnshoreOil(gameState, player, myUnits, workingIslands);
              if (gameState.mapType === 'grasslands') {
                  this.stageGrasslandsForwardBuilders(gameState, myIslands, myUnits);
                  this.manageGrasslandsForwardExpansion(gameState, player, myIslands, myUnits);
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
      const phase = this.getMatchPhase(now);
      const builderCap = this.getBuilderCap();
      const totalBuilders = this.getBuilderCountIncludingQueue(gameState, myIslands, myUnits);
      const combatUnits = myUnits.filter(u => this.isCombatUnitType(u.type)).length;
      const minCombat = this.getCombatUnitMinimum();
      const mapType = (gameState as any).mapType || (gameState.map as any).mapType || 'unknown';

      const defence = this.baseDefenseBuilder.debugState;
      const myBaseIsland = gameState.map.islands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.playerId));
      const base = myBaseIsland ? myBaseIsland.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId) : undefined;
      const hqLevel = base ? ((base as any).level || 1) : 1;

      const hasOilIncome = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const desiredBarracks = this.getDesiredBarracksCount(gameState.mapType, hasOilIncome);
      const desiredFactories = this.getDesiredFactoryCount(gameState.mapType, hasOilIncome);
      const actualBarracks = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'barracks'), 0);
      const actualFactories = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'tank_factory'), 0);
      const queuedBarracksUnits =
          this.countQueuedUnitsOfType(gameState, myIslands, 'soldier') +
          this.countQueuedUnitsOfType(gameState, myIslands, 'rocketeer');
      const queuedFactoryUnits =
          this.countQueuedUnitsOfType(gameState, myIslands, 'tank') +
          this.countQueuedUnitsOfType(gameState, myIslands, 'missile_launcher');

      const docks = myIslands.some(i => this.islandHasOwnedBuildingOfType(i, 'dock'));
      const ships = myUnits.some(u => u.type === 'construction_ship');
      const oilBuildings = myIslands.some(i =>
          i.buildings.some(b => (b.type === 'oil_rig' || b.type === 'oil_well') && b.ownerId === this.playerId)
      );

      let oilState = 'NONE';
      if (!docks && !ships && !oilBuildings) oilState = 'NONE';
      else if (docks && !ships && !oilBuildings) oilState = 'DOCK';
      else if (ships && !oilBuildings) oilState = 'SHIP';
      else oilState = 'RIG';

      if (!this.debugState.progression) this.debugState.progression = {};
      const progression = this.debugState.progression;

      progression.mapType = mapType;
      progression.phase = phase;
      progression.profile = {
          controllerId: this.strategyProfile.controllerId,
          category: this.strategyProfile.category,
          level: this.strategyProfile.level
      };
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
      this.debugState.production = {
          barracks: {
              actual: actualBarracks,
              desired: desiredBarracks,
              queuedUnits: queuedBarracksUnits
          },
          factories: {
              actual: actualFactories,
              desired: desiredFactories,
              queuedUnits: queuedFactoryUnits
          }
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
      const now = Date.now();
      const phase = this.getMatchPhase(now);
      const isAirPhase = now - this.startTime > this.timeToAirPhase || phase !== 'EARLY';
      if (!isAirPhase) {
          this.debugState.airStrategy = { phase, isAirPhase, reason: 'NOT_AIR_PHASE' };
          return;
      }

      const workingIslands = this.getWorkingIslands(gameState, myIslands, myUnits);
      const oilEconomyOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const oilStockpileReady =
          player.resources.oil >= (this.difficulty >= 9 ? 600 : this.difficulty >= 7 ? 750 : 900);
      const oilOnline = oilEconomyOnline || oilStockpileReady;
      let airBaseCount = 0;
      myIslands.forEach(i => airBaseCount += this.countOwnedBuildingsOfType(i, 'air_base'));
      const fieldedCapitalShips = myUnits.filter(unit => unit.type === 'mothership' || unit.type === 'aircraft_carrier').length;
      const fieldedMothershipIds = myUnits
          .filter(unit => unit.ownerId === this.playerId && unit.type === 'mothership')
          .map(unit => unit.id);
      const lowOilAirFallback =
          this.difficulty >= 8 &&
          phase !== 'EARLY' &&
          (airBaseCount > 0 || fieldedCapitalShips > 0 || player.resources.oil >= 180);
      let desiredAirBases = this.getDesiredAirBaseCount(gameState.mapType, oilOnline, phase);
      const eliteAirRush =
          this.difficulty >= 10 &&
          gameState.mapType !== 'islands' &&
          oilEconomyOnline;
      if (eliteAirRush) {
          // Level 10 should field dual airbases as soon as oil production is online.
          desiredAirBases = Math.max(desiredAirBases, 2);
      }
      if (desiredAirBases <= 0 && lowOilAirFallback) {
          const fallbackMinimum = this.difficulty >= 10 && phase === 'LATE' ? 2 : 1;
          desiredAirBases = Math.max(airBaseCount, fallbackMinimum);
      }
      if (desiredAirBases <= 0) {
          this.debugState.airStrategy = {
              phase,
              isAirPhase,
              oilEconomyOnline,
              oilStockpileReady,
              oilOnline,
              desiredAirBases,
              airBaseCount,
              fieldedCapitalShips,
              lowOilAirFallback,
              reason: 'AIRBASE_DESIRED_ZERO'
          };
          return;
      }

      const defenceTargets = this.getDefenceTargets(gameState.mapType);
      const defenceReady =
          this.baseDefenseBuilder.debugState.towersBuilt >= Math.max(1, Math.min(defenceTargets.towers, 2)) &&
          this.baseDefenseBuilder.debugState.wallNodesPlaced >= Math.max(4, Math.min(defenceTargets.wallNodes, 6)) &&
          (this.baseDefenseBuilder.debugState.wallConnectionsMade >= 1 || phase === 'LATE');
      const relaxedAirDefenceReady =
          this.baseDefenseBuilder.debugState.towersBuilt >= 1 &&
          this.baseDefenseBuilder.debugState.wallNodesPlaced >= 4;
      const hasForwardDockFoothold =
          gameState.mapType === 'islands' &&
          myIslands.some(island =>
              !island.buildings.some(building => building.type === 'base' && building.ownerId === this.playerId) &&
              this.islandHasReadyOwnedBuildingOfType(island, 'dock')
          );
      const highTierAirPush = this.difficulty >= 7 && oilOnline && phase !== 'EARLY';
      const recruitmentBuildings = this.getOwnedRecruitmentBuildingCount(myIslands);
      const requiredRecruitmentBuildings = phase === 'LATE'
          ? Math.max(1, Math.min(this.difficulty >= 7 ? 2 : 1, this.strategyProfile.recruitmentBuildings))
          : (this.difficulty >= 10 ? 2 : 1);
      const recruitmentReady =
          recruitmentBuildings >= requiredRecruitmentBuildings ||
          (highTierAirPush && recruitmentBuildings >= 1) ||
          (eliteAirRush && recruitmentBuildings >= 1);
      const canStartAirbaseBuild =
          defenceReady ||
          (highTierAirPush && relaxedAirDefenceReady) ||
          eliteAirRush ||
          (
              gameState.mapType === 'islands' &&
              this.difficulty >= 9 &&
              oilOnline &&
              hasForwardDockFoothold &&
              recruitmentBuildings >= 2
          );

      if (!canStartAirbaseBuild || !recruitmentReady) {
          this.debugState.airStrategy = {
              phase,
              isAirPhase,
              oilEconomyOnline,
              oilStockpileReady,
              oilOnline,
              desiredAirBases,
              defenceReady,
              relaxedAirDefenceReady,
              recruitmentBuildings,
              requiredRecruitmentBuildings,
              recruitmentReady,
              canStartAirbaseBuild,
              reason: 'AIR_PREREQUISITES_BLOCKED'
          };
          return;
      }

      let attemptedAirBaseBuild = false;
      let successfulAirBaseBuild = false;
      const canBuildAdditionalAirBase =
          oilOnline ||
          (this.difficulty >= 10 &&
              phase !== 'EARLY' &&
              player.resources.oil >= (BuildingData.air_base?.cost?.oil ?? 100));
      const airBaseBuildOrder = this.prioritizeStructureBuildIslands(gameState, workingIslands, 'air_base');

      if (airBaseCount < desiredAirBases && canBuildAdditionalAirBase) {
          airBaseBuildOrder.forEach(island => {
              if (airBaseCount >= desiredAirBases) return;
              if (this.canAfford(player, 'air_base')) {
                   const existing = this.countOwnedBuildingsOfType(island, 'air_base');
                   if (existing < 1) {
                       attemptedAirBaseBuild = true;
                       if (this.ensureBuilderAndBuild(gameState, island, 'air_base')) {
                           airBaseCount += 1;
                           successfulAirBaseBuild = true;
                       }
                   }
              }
          });

          if (airBaseCount < desiredAirBases) {
              const baseIsland =
                  airBaseBuildOrder.find(island =>
                      island.buildings.some(building => building.type === 'base' && building.ownerId === this.playerId)
                  ) || this.getOwnedBaseIsland(gameState, workingIslands);
              if (baseIsland && this.canAfford(player, 'air_base')) {
                  const existing = this.countOwnedBuildingsOfType(baseIsland, 'air_base');
                  if (existing < desiredAirBases) {
                      attemptedAirBaseBuild = true;
                  }
                  if (existing < desiredAirBases && this.ensureBuilderAndBuild(gameState, baseIsland, 'air_base')) {
                      airBaseCount += 1;
                      successfulAirBaseBuild = true;
                  }
              }
          }
      }

      const readyAirBaseIds = myIslands
          .flatMap(island =>
              island.buildings
                  .filter(
                      building =>
                          building.ownerId === this.playerId &&
                          building.type === 'air_base' &&
                          !building.isConstructing
                  )
                  .map(building => building.id)
          )
          .sort((a, b) => a.localeCompare(b));

      const motherships = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'mothership');
      const carriers = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'aircraft_carrier');
      const desiredMotherships = this.getDesiredMothershipCount(phase, readyAirBaseIds.length, oilEconomyOnline || oilStockpileReady);
      const dedicatedMothershipBaseCount = this.getDedicatedMothershipAirBaseCount(readyAirBaseIds.length, desiredMotherships);
      const capitalShipsUnlocked = canDeployCapitalShips(this.strategyProfile.capitalShipTiming, phase);
      const capitalShipDefenceReady = defenceReady || (this.difficulty >= 8 && relaxedAirDefenceReady);
      const capitalShipInfrastructureReady =
          capitalShipsUnlocked &&
          capitalShipDefenceReady &&
          recruitmentBuildings >= requiredRecruitmentBuildings &&
          readyAirBaseIds.length >= 1 &&
          (oilEconomyOnline || player.resources.oil >= Math.max(160, (UnitData.mothership?.cost?.oil ?? 1000) * 0.25));
      const mothershipAirBaseIds =
          readyAirBaseIds.slice(0, Math.max(1, dedicatedMothershipBaseCount));
      const strikeAirBaseIds = readyAirBaseIds.slice(dedicatedMothershipBaseCount);
      const strikeAirBasePool = strikeAirBaseIds.length > 0 ? strikeAirBaseIds : readyAirBaseIds;
      const hasDedicatedMothershipBase =
          dedicatedMothershipBaseCount >= 1 && readyAirBaseIds.length > dedicatedMothershipBaseCount;
      const mothershipSavingsActive =
          this.updateMothershipSavingsMode(now, readyAirBaseIds.length, motherships, desiredMotherships);
      const mothershipReserve = this.getCapitalFocusReserve(desiredMotherships, motherships, mothershipSavingsActive);
      const mothershipReserveOil = mothershipReserve.oil;
      const mothershipReserveGold = mothershipReserve.gold;
      const capitalShipReady = capitalShipInfrastructureReady;
      const mothershipOilCost = UnitData.mothership?.cost?.oil ?? 1000;
      const mothershipGoldCost = UnitData.mothership?.cost?.gold ?? 2000;
      const alienScoutOilCost = UnitData.alien_scout?.cost?.oil ?? 50;
      const alienScoutGoldCost = UnitData.alien_scout?.cost?.gold ?? 150;
      const heavyAlienOilCost = UnitData.heavy_alien?.cost?.oil ?? 400;
      const heavyAlienGoldCost = UnitData.heavy_alien?.cost?.gold ?? 800;
      const highTierMothershipPriorityMode =
          this.difficulty >= 9 &&
          capitalShipReady &&
          desiredMotherships > motherships;
      const shouldHardSaveForMothership =
          (mothershipSavingsActive || highTierMothershipPriorityMode) &&
          desiredMotherships > motherships;
      const canSpendAirBudget = (oilCost: number, goldCost: number): boolean => {
          if (shouldHardSaveForMothership) return false;
          if (desiredMotherships <= motherships) return true;
          return (
              player.resources.oil - oilCost >= mothershipReserveOil &&
              player.resources.gold - goldCost >= mothershipReserveGold
          );
      };

      let orderedMotherships = false;
      if (capitalShipReady && motherships < desiredMotherships) {
          const mothershipOrderBursts = Math.min(
              desiredMotherships - motherships,
              Math.max(1, dedicatedMothershipBaseCount)
          );
          for (let burst = 0; burst < mothershipOrderBursts; burst += 1) {
              if (!this.canAfford(player, 'mothership')) break;
              const mothershipsBeforeOrder = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'mothership');
              this.recruitUnitType(
                  gameState,
                  player,
                  myIslands,
                  'mothership',
                  'air_base',
                  mothershipAirBaseIds
              );
              const mothershipsAfterOrder = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'mothership');
              if (mothershipsAfterOrder <= mothershipsBeforeOrder) break;
              orderedMotherships = true;
          }
      }

      if (orderedMotherships) {
          this.completeMothershipSavingsMode(now);
      }

      const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
      const carrierAllowedByCapitalPlan =
          this.difficulty < 9 ||
          desiredMotherships <= 0 ||
          motherships >= Math.min(1, desiredMotherships);
      if (!shouldHardSaveForMothership && capitalShipReady && hasReadyDock && carriers < 1 && carrierAllowedByCapitalPlan) {
          this.recruitUnitType(gameState, player, myIslands, 'aircraft_carrier', 'dock');
      }

      const lowOilAirMode =
          !oilEconomyOnline ||
          player.resources.oil < (this.difficulty >= 10 ? 360 : this.difficulty >= 8 ? 260 : 200);
      let airProductionBursts = lowOilAirMode
          ? (this.difficulty >= 10 ? 7 : this.difficulty >= 8 ? 4 : 2)
          : (
              this.difficulty >= 10 ? 6 :
              this.difficulty >= 8 ? 3 :
              this.difficulty >= 6 ? 2 : 1
          );
      const mothershipDeficit = Math.max(0, desiredMotherships - motherships);
      if (mothershipSavingsActive || mothershipDeficit > 0) {
          airProductionBursts = Math.min(
              airProductionBursts,
              this.difficulty <= 3 ? 0 : 1
          );
      }
      if (highTierMothershipPriorityMode) {
          const preserveCapitalResources =
              player.resources.oil < mothershipOilCost + 240 ||
              player.resources.gold < mothershipGoldCost + 600 ||
              orderedMotherships;
          if (preserveCapitalResources) {
              airProductionBursts = 0;
          } else {
              airProductionBursts = Math.min(airProductionBursts, this.difficulty >= 10 ? 0 : 1);
          }
      }
      if (shouldHardSaveForMothership) {
          airProductionBursts = 0;
      }

      const preferAlienBroodMode =
          this.difficulty >= 9 &&
          fieldedMothershipIds.length > 0 &&
          (player.resources.oil >= 1000 || motherships >= Math.min(2, desiredMotherships));

      for (let burst = 0; burst < airProductionBursts; burst += 1) {
          if (canSpendAirBudget(UnitData.light_plane?.cost?.oil ?? 20, UnitData.light_plane?.cost?.gold ?? 100)) {
              this.recruitUnitType(
                  gameState,
                  player,
                  myIslands,
                  'light_plane',
                  'air_base',
                  strikeAirBasePool
              );
          }
          if (!preferAlienBroodMode) {
              this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'mothership');
              this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'aircraft_carrier');
          }

          if (
              (!lowOilAirMode || player.resources.oil >= (this.difficulty >= 10 ? 220 : 180)) &&
              canSpendAirBudget(UnitData.heavy_plane?.cost?.oil ?? 100, UnitData.heavy_plane?.cost?.gold ?? 250)
          ) {
              this.recruitUnitType(
                  gameState,
                  player,
                  myIslands,
                  'heavy_plane',
                  'air_base',
                  strikeAirBasePool
              );
              if (!preferAlienBroodMode) {
                  this.recruitUnitType(gameState, player, myIslands, 'heavy_plane', 'mothership');
                  this.recruitUnitType(gameState, player, myIslands, 'heavy_plane', 'aircraft_carrier');
              }
          }

          if (canSpendAirBudget(UnitData.light_plane?.cost?.oil ?? 20, UnitData.light_plane?.cost?.gold ?? 100)) {
              this.recruitUnitType(
                  gameState,
                  player,
                  myIslands,
                  'light_plane',
                  'air_base',
                  strikeAirBasePool
              );
          }
          if (!preferAlienBroodMode) {
              this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'mothership');
              this.recruitUnitType(gameState, player, myIslands, 'light_plane', 'aircraft_carrier');
          }
      }

      const highTierOilOverflow =
          this.difficulty >= 9 &&
          fieldedMothershipIds.length > 0 &&
          player.resources.oil >= 1000 &&
          motherships >= Math.min(3, desiredMotherships);
      let queuedAlienScouts = 0;
      let queuedHeavyAliens = 0;
      if (highTierOilOverflow) {
          const currentAlienScouts = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'alien_scout');
          const currentHeavyAliens = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'heavy_alien');
          const alienScoutCap = this.difficulty >= 10 ? 10 : 8;
          const heavyAlienCap = this.difficulty >= 10 ? 5 : 4;
          const alienBurstCap = this.difficulty >= 10 ? 4 : 3;
          for (let burst = 0; burst < alienBurstCap; burst += 1) {
              const totalHeavyAliens = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'heavy_alien');
              const totalAlienScouts = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'alien_scout');
              const preferHeavyAlien =
                  totalHeavyAliens < heavyAlienCap &&
                  player.resources.oil >= heavyAlienOilCost &&
                  player.resources.gold >= heavyAlienGoldCost;
              if (preferHeavyAlien) {
                  const before = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'heavy_alien');
                  this.recruitUnitType(gameState, player, myIslands, 'heavy_alien', 'mothership', fieldedMothershipIds);
                  const after = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'heavy_alien');
                  if (after > before) {
                      queuedHeavyAliens += 1;
                      continue;
                  }
              }

              if (
                  totalAlienScouts < alienScoutCap &&
                  player.resources.oil >= alienScoutOilCost &&
                  player.resources.gold >= alienScoutGoldCost
              ) {
                  const before = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'alien_scout');
                  this.recruitUnitType(gameState, player, myIslands, 'alien_scout', 'mothership', fieldedMothershipIds);
                  const after = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'alien_scout');
                  if (after > before) {
                      queuedAlienScouts += 1;
                  }
              }
          }
      }

      const mothershipSavingsCountdownMs =
          this.nextMothershipSavingsAt !== null
              ? Math.max(0, this.nextMothershipSavingsAt - now)
              : null;

      this.debugState.airStrategy = {
          phase,
          isAirPhase,
          oilEconomyOnline,
          oilStockpileReady,
          oilOnline,
          desiredAirBases,
          airBaseCount,
          attemptedAirBaseBuild,
          successfulAirBaseBuild,
          defenceReady,
          relaxedAirDefenceReady,
          recruitmentBuildings,
          requiredRecruitmentBuildings,
          recruitmentReady,
          canStartAirbaseBuild,
          canBuildAdditionalAirBase,
          capitalShipReady,
          capitalShipInfrastructureReady,
          desiredMotherships,
          mothershipDeficit,
          dedicatedMothershipBaseCount,
          hasDedicatedMothershipBase,
          mothershipAirBaseIds,
          strikeAirBaseIds: strikeAirBasePool,
          mothershipSavingsActive,
          highTierMothershipPriorityMode,
          shouldHardSaveForMothership,
          mothershipReserveOil,
          mothershipReserveGold,
          mothershipSavingsCountdownMs,
          fieldedCapitalShips,
          lowOilAirFallback,
          lowOilAirMode,
          orderedMotherships,
          highTierOilOverflow,
          queuedAlienScouts,
          queuedHeavyAliens
      };
  }

    private manageAirForce(gameState: GameState, player: Player, myUnits: Unit[]) {
        const now = Date.now();
        const phase = this.getMatchPhase(now);
        const airUnits = myUnits.filter(u => ['light_plane', 'heavy_plane', 'helicopter'].includes(u.type));
        const motherships = myUnits.filter(u => u.type === 'mothership');
        const carriers = myUnits.filter(u => u.type === 'aircraft_carrier');
        const capitalShips = [...motherships, ...carriers];
        const capitalStrikeAdvantage = this.hasMothershipStrikeAdvantage(gameState, myUnits);
        const enemyThreats = capitalShips.length > 0 ? this.getEnemyThreatZones(gameState) : [];

        if (airUnits.length === 0 && capitalShips.length === 0) return;

        const mapThresholdAdjustment = gameState.mapType === 'islands' ? -2 : 0;
        const oilReadyForCapitalRequirement =
            this.hasStableOil(player) ||
            player.resources.oil >= (this.difficulty >= 10 ? 260 : this.difficulty >= 8 ? 340 : 400);
        let attackThreshold =
            this.difficulty >= 10 ? 20 :
            this.difficulty >= 9 ? 17 :
            this.difficulty >= 8 ? 15 :
            this.difficulty >= 7 ? 13 :
            this.difficulty >= 5 ? 10 : 7;
        if (this.difficulty >= 9 && phase !== 'EARLY' && !oilReadyForCapitalRequirement) {
            attackThreshold = Math.min(attackThreshold, 8);
        }
        attackThreshold = Math.max(5, attackThreshold + mapThresholdAdjustment);

        const requiredCapitalShips =
            this.difficulty >= 8 && phase === 'LATE' && oilReadyForCapitalRequirement ? 1 : 0;
        if (requiredCapitalShips === 0 && this.difficulty >= 9 && phase !== 'EARLY') {
            attackThreshold = Math.min(attackThreshold, 5);
        }
        if (capitalStrikeAdvantage) {
            attackThreshold = Math.min(attackThreshold, 2);
        }
        const capitalReady = capitalShips.length >= requiredCapitalShips;

        // Find Rally Point
        const myIslands = this.getControlledIslands(gameState);
        const capitalRepairRetreat = this.getBaseRepairRetreatPoint(gameState, myIslands);
        let rally: { x: number; y: number } | null = null;
        if (motherships.length > 0) rally = { x: motherships[0].x, y: motherships[0].y };
        else if (carriers.length > 0) rally = { x: carriers[0].x, y: carriers[0].y };
        else {
            const airbase = myIslands.find(i => this.islandHasOwnedBuildingOfType(i, 'air_base'));
            if (airbase) rally = { x: airbase.x, y: airbase.y };
            else if (myIslands.length > 0) {
                const home = this.getOwnedBaseIsland(gameState, myIslands) || myIslands[0];
                rally = { x: home.x, y: home.y };
            }
        }

        if (this.airState.mode === 'GATHER') {
            let grouped = false;
            const farCapitalCount = rally
                ? capitalShips.filter(u => Math.hypot(u.x - rally.x, u.y - rally.y) > 700).length
                : 0;
            if (airUnits.length >= attackThreshold && capitalReady) {
                if (rally) {
                    const farAir = airUnits.filter(u => Math.hypot(u.x - rally!.x, u.y - rally!.y) > 440);
                    const farCapital = capitalShips.filter(u => Math.hypot(u.x - rally!.x, u.y - rally!.y) > 560);
                    grouped =
                        farAir.length <= Math.ceil(airUnits.length * 0.28) &&
                        (requiredCapitalShips === 0 || farCapital.length === 0);
                } else {
                    grouped = true;
                }
            }
            if (
                !grouped &&
                capitalStrikeAdvantage &&
                motherships.length >= 2 &&
                (!rally || farCapitalCount === 0)
            ) {
                grouped = true;
            }

            if (grouped) {
                this.airState.mode = 'ATTACK';
                this.logEvent('AIR_MODE', {
                    mode: 'ATTACK',
                    size: airUnits.length,
                    threshold: attackThreshold,
                    capitalShips: capitalShips.length
                });
            }
        } else {
            const regroupThreshold = this.difficulty >= 8 ? 0.42 : 0.5;
            if (
                airUnits.length < Math.ceil(attackThreshold * regroupThreshold) ||
                (requiredCapitalShips > 0 && !capitalReady)
            ) {
                this.airState.mode = 'GATHER';
                this.logEvent('AIR_MODE', {
                    mode: 'GATHER',
                    size: airUnits.length,
                    threshold: attackThreshold,
                    capitalShips: capitalShips.length
                });
            }
        }

        const target = this.findAirTarget(gameState);
        this.debugState.airCommander = {
            mode: this.airState.mode,
            phase,
            swarmSize: airUnits.length,
            attackThreshold,
            capitalShips: capitalShips.length,
            requiredCapitalShips,
            capitalReady,
            capitalStrikeAdvantage,
            oilReadyForCapitalRequirement,
            target: target ? { x: Math.round(target.x), y: Math.round(target.y) } : null
        };

        motherships.forEach(ms => {
            if (this.usedUnitIds.has(ms.id)) return;
            const healthRatio = ms.health / Math.max(1, ms.maxHealth);
            if (this.shouldCapitalShipRetreat(gameState, ms, now, enemyThreats)) {
                this.capitalRepairRetreatIds.add(ms.id);
            } else if (healthRatio >= 0.92) {
                this.capitalRepairRetreatIds.delete(ms.id);
            }
            if (this.capitalRepairRetreatIds.has(ms.id) && capitalRepairRetreat) {
                const holdPoint = this.getCapitalRepairHoldPoint(capitalRepairRetreat, ms.id);
                const retreatPoint = this.getThreatAwareApproachPoint(
                    gameState,
                    ms,
                    holdPoint.x,
                    holdPoint.y,
                    enemyThreats,
                    true
                );
                this.moveUnitSafe(gameState, ms.id, retreatPoint.x, retreatPoint.y);
                this.logAirOrder(ms, 'RETREAT', 'REPAIR_DOCK', retreatPoint, 'CapitalLowHp', false);
                return;
            }
            if (this.airState.mode === 'ATTACK' && target) {
                const desiredOffset = this.difficulty >= 9 ? 720 : 820;
                const dist = Math.hypot(target.x - ms.x, target.y - ms.y);
                if (dist > desiredOffset + 120) {
                    this.moveUnitSafe(gameState, ms.id, target.x, target.y);
                    this.logAirOrder(ms, 'MOVE_UP', 'TARGET', target, 'MothershipSupport', false);
                } else if (dist < desiredOffset - 120) {
                    const angle = Math.atan2(ms.y - target.y, ms.x - target.x);
                    const retreatX = target.x + Math.cos(angle) * desiredOffset;
                    const retreatY = target.y + Math.sin(angle) * desiredOffset;
                    this.moveUnitSafe(gameState, ms.id, retreatX, retreatY);
                }
            } else if (rally) {
                const dist = Math.hypot(rally.x - ms.x, rally.y - ms.y);
                if (dist > 320) this.moveUnitSafe(gameState, ms.id, rally.x, rally.y);
            }
        });

        carriers.forEach(carrier => {
            if (this.usedUnitIds.has(carrier.id)) return;
            const healthRatio = carrier.health / Math.max(1, carrier.maxHealth);
            if (this.shouldCapitalShipRetreat(gameState, carrier, now, enemyThreats)) {
                this.capitalRepairRetreatIds.add(carrier.id);
            } else if (healthRatio >= 0.92) {
                this.capitalRepairRetreatIds.delete(carrier.id);
            }
            if (this.capitalRepairRetreatIds.has(carrier.id) && capitalRepairRetreat) {
                const holdPoint = this.getCapitalRepairHoldPoint(capitalRepairRetreat, carrier.id);
                const retreatPoint = this.getThreatAwareApproachPoint(
                    gameState,
                    carrier,
                    holdPoint.x,
                    holdPoint.y,
                    enemyThreats,
                    true
                );
                this.moveUnitSafe(gameState, carrier.id, retreatPoint.x, retreatPoint.y);
                this.logAirOrder(carrier, 'RETREAT', 'REPAIR_DOCK', retreatPoint, 'CapitalLowHp', false);
                return;
            }
            if (this.airState.mode === 'ATTACK' && target) {
                const desiredOffset = gameState.mapType === 'islands' ? 840 : 920;
                const dist = Math.hypot(target.x - carrier.x, target.y - carrier.y);
                if (dist > desiredOffset + 150) {
                    this.moveUnitSafe(gameState, carrier.id, target.x, target.y);
                    this.logAirOrder(carrier, 'MOVE_UP', 'TARGET', target, 'CarrierEscort', false);
                } else if (dist < desiredOffset - 150) {
                    const angle = Math.atan2(carrier.y - target.y, carrier.x - target.x);
                    const retreatX = target.x + Math.cos(angle) * desiredOffset;
                    const retreatY = target.y + Math.sin(angle) * desiredOffset;
                    this.moveUnitSafe(gameState, carrier.id, retreatX, retreatY);
                }
            } else if (rally) {
                const dist = Math.hypot(rally.x - carrier.x, rally.y - carrier.y);
                if (dist > 340) this.moveUnitSafe(gameState, carrier.id, rally.x, rally.y);
            }
        });

        airUnits.forEach(plane => {
            if (this.usedUnitIds.has(plane.id)) return;

            if (this.airState.mode === 'ATTACK' && target) {
                this.logAirOrder(plane, 'ATTACK', 'TARGET', target, 'SwarmAttack', false);
                this.moveUnitSafe(gameState, plane.id, target.x, target.y);
                return;
            }

            if (!rally) return;
            const idSeedRaw = plane.id.replace(/\D/g, '').slice(-4);
            const idSeed = Number.parseInt(idSeedRaw || '1', 10);
            const angle = (now / 900) + idSeed;
            const orbitRadius = this.difficulty >= 8 ? 160 : 200;
            const rx = rally.x + Math.cos(angle) * orbitRadius;
            const ry = rally.y + Math.sin(angle) * orbitRadius;
            const dist = Math.hypot(rx - plane.x, ry - plane.y);
            if (dist > 45) {
                this.moveUnitSafe(gameState, plane.id, rx, ry);
            }
        });
    }

    private isBaseUnderAttack(gameState: GameState): boolean {
        const myBaseIslands = this.getControlledIslands(gameState).filter(island =>
            island.buildings.some(building => building.type === 'base' && building.ownerId === this.playerId)
        );
        if (myBaseIslands.length === 0) return false;

        return myBaseIslands.some(island => {
            const base = island.buildings.find(building => building.type === 'base' && building.ownerId === this.playerId);
            if (!base) return false;
            const baseX = island.x + (base.x || 0);
            const baseY = island.y + (base.y || 0);
            const threatRadius = gameState.mapType === 'islands' ? 620 : 850;
            const nearbyEnemies = gameState.units.filter(
                unit => unit.ownerId !== this.playerId && Math.hypot(unit.x - baseX, unit.y - baseY) < threatRadius
            );
            if (nearbyEnemies.length === 0) return false;

            const capitalNearby = nearbyEnemies.some(unit => ['aircraft_carrier', 'mothership', 'destroyer', 'pirate_ship'].includes(unit.type));
            const damagedBase = base.health < base.maxHealth * 0.94;
            if (damagedBase) return true;

            if (gameState.mapType === 'islands') {
                return capitalNearby || nearbyEnemies.length >= 3;
            }

            return capitalNearby || nearbyEnemies.length >= 2;
        });
    }

    private manageNavalCommander(gameState: GameState, player: Player, myUnits: Unit[]) {
        const navalUnits = myUnits.filter(u => ['destroyer', 'pirate_ship', 'battleship', 'aircraft_carrier', 'submarine'].includes(u.type));
        if (navalUnits.length === 0) return;

        // 1. Assign Defenders vs Fleet
        // "Leave defenders at home" rule
        let requiredDefenders = 0;
        if (this.difficulty <= 3) requiredDefenders = 1;
        else if (this.difficulty <= 6) requiredDefenders = 2;
        else if (this.difficulty <= 9) requiredDefenders = 3;
        else requiredDefenders = 4;

        const ownedOilSpots = gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.playerId).length;
        const threatenedOil = this.findThreatenedOwnedOilPoint(gameState);
        if (ownedOilSpots > 0 && threatenedOil) {
            requiredDefenders += Math.min(2, Math.ceil(ownedOilSpots / 3));
        }
        requiredDefenders = Math.min(requiredDefenders, navalUnits.length);

        // EMERGENCY DEFENCE: If under attack, recall fleet!
        const underAttack = this.isBaseUnderAttack(gameState);
        if (underAttack) {
             requiredDefenders = Math.max(requiredDefenders, Math.ceil(navalUnits.length * 0.6));
             requiredDefenders = Math.min(requiredDefenders, navalUnits.length);
             this.logEvent('NAVAL_MODE', { mode: 'EMERGENCY_DEFENCE', units: navalUnits.length });
        }

        // Reset assignments each tick or manage persistency?
        // Persistency is better to stop unit shuffling.
        // Clean up dead units
        const livingIds = new Set(navalUnits.map(u => u.id));
        [...this.navalState.homeDefenders].forEach(id => { if (!livingIds.has(id)) this.navalState.homeDefenders.delete(id); });
        [...this.navalState.fleet].forEach(id => { if (!livingIds.has(id)) this.navalState.fleet.delete(id); });

        // Rebalance defender/fleet split based on the current required defender count.
        while (this.navalState.homeDefenders.size > requiredDefenders) {
            const demoteId = this.navalState.homeDefenders.values().next().value as string | undefined;
            if (!demoteId) break;
            this.navalState.homeDefenders.delete(demoteId);
            this.navalState.fleet.add(demoteId);
        }
        while (this.navalState.homeDefenders.size < requiredDefenders) {
            const promote = navalUnits.find(
                unit => !this.navalState.homeDefenders.has(unit.id) && !this.navalState.fleet.has(unit.id)
            );
            if (!promote) break;
            this.navalState.homeDefenders.add(promote.id);
        }

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
        const ownedOilPatrolPoints = this.getOwnedOilPatrolPoints(gameState);
        this.navalState.homeDefenders.forEach(id => {
            const unit = navalUnits.find(u => u.id === id);
            if (!unit || this.usedUnitIds.has(id)) return;
            
            // Patrol around Dock/Base
            const patrolCenter = ownedOilPatrolPoints.length > 0
                ? ownedOilPatrolPoints[Math.abs(parseInt(unit.id.slice(-4), 16)) % ownedOilPatrolPoints.length]
                : this.findHomePatrolCenter(gameState);
            if (!patrolCenter) return;

            // Check for nearby enemies
            const nearbyEnemy = this.findNearbyEnemy(gameState, patrolCenter, gameState.mapType === 'islands' ? 620 : 900);
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
            const now = Date.now();
            if (this.navalState.buildFleetStartedAt <= 0) {
                this.navalState.buildFleetStartedAt = now;
            }
            if (
                !this.navalState.rallyPoint ||
                now - this.navalState.lastRallyRefreshAt > 20000
            ) {
                this.navalState.rallyPoint = this.getNavalRallyPoint(gameState, fleetUnits[0]);
                this.navalState.lastRallyRefreshAt = now;
            }
            const rally = this.navalState.rallyPoint;
            
            // Check if grouped (Strict Grouping)
            let grouped = false;
            if (rally && fleetUnits.length >= waveThreshold) {
                const farUnits = fleetUnits.filter(u => Math.hypot(u.x - rally.x, u.y - rally.y) > 500);
                if (farUnits.length <= Math.ceil(fleetUnits.length * 0.2)) { // 80% are within 500px
                    grouped = true;
                }
            }
            const buildFleetTimeSec = (now - this.navalState.buildFleetStartedAt) / 1000;
            const timedStrikeDelaySec =
                this.difficulty >= 9 ? 10 :
                this.difficulty >= 7 ? 12 :
                this.difficulty >= 4 ? 15 :
                this.difficulty >= 2 ? 16 : 22;
            const timedStrikeReady =
                buildFleetTimeSec >= timedStrikeDelaySec &&
                fleetUnits.length >= Math.max(3, Math.floor(waveThreshold * 0.6));

            if (grouped || timedStrikeReady) {
                this.navalState.mode = 'NAVAL_STRIKE';
                this.navalState.rallyPoint = null;
                this.navalState.buildFleetStartedAt = 0;
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
                this.navalState.rallyPoint = null;
                this.navalState.buildFleetStartedAt = Date.now();
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
                 this.navalState.rallyPoint = null;
                 this.navalState.buildFleetStartedAt = Date.now();
            }
        }
    }

    private findHomePatrolCenter(gameState: GameState): {x: number, y: number} | null {
        const threatenedOil = this.findThreatenedOwnedOilPoint(gameState);
        if (threatenedOil) return threatenedOil;

        const ownedOilSpot = gameState.map.oilSpots.find(spot => (spot as any).ownerId === this.playerId);
        if (ownedOilSpot) return { x: ownedOilSpot.x, y: ownedOilSpot.y };

        // Prefer Dock -> Base -> First Island
        const myIslands = this.getControlledIslands(gameState);
        for (const i of myIslands) {
            if (this.islandHasOwnedBuildingOfType(i, 'dock')) return { x: i.x, y: i.y };
        }
        for (const i of myIslands) {
            if (this.islandHasOwnedBuildingOfType(i, 'base')) return { x: i.x, y: i.y };
        }
        if (myIslands.length > 0) return { x: myIslands[0].x, y: myIslands[0].y };
        return null;
    }

    private getOwnedOilPatrolPoints(gameState: GameState): { x: number; y: number }[] {
        const points: { x: number; y: number }[] = [];
        const threatened = this.findThreatenedOwnedOilPoint(gameState);
        if (threatened) points.push(threatened);

        const ownedOilSpots = gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.playerId);
        ownedOilSpots.forEach(spot => points.push({ x: spot.x, y: spot.y }));

        const fallback = this.findHomePatrolCenter(gameState);
        if (fallback) points.push(fallback);

        const deduped: { x: number; y: number }[] = [];
        points.forEach(point => {
            if (deduped.some(existing => Math.hypot(existing.x - point.x, existing.y - point.y) < 90)) return;
            deduped.push(point);
        });
        return deduped;
    }

    private findThreatenedOwnedOilPoint(gameState: GameState): { x: number; y: number } | null {
        const ownedOilSpots = gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.playerId);
        if (ownedOilSpots.length === 0) return null;

        let bestX = 0;
        let bestY = 0;
        let bestScore = -1;

        for (const spot of ownedOilSpots) {
            const nearbyEnemies = gameState.units.filter(
                unit => unit.ownerId !== this.playerId && Math.hypot(unit.x - spot.x, unit.y - spot.y) <= 700
            );
            if (nearbyEnemies.length === 0) continue;
            const closestThreat = Math.min(...nearbyEnemies.map(unit => Math.hypot(unit.x - spot.x, unit.y - spot.y)));
            const score = nearbyEnemies.length * 100 + Math.max(0, 700 - closestThreat);
            if (score > bestScore) {
                bestScore = score;
                bestX = spot.x;
                bestY = spot.y;
            }
        }

        if (bestScore < 0) return null;
        return { x: bestX, y: bestY };
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
         const phase = this.getMatchPhase();
         const assaultingBase = this.debugState?.attackManager?.state === 'ASSAULT';
         const ownedOilCount = gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.playerId).length;
         const enemyOil = gameState.map.oilSpots.filter(spot =>
             (spot as any).occupiedBy && (spot as any).ownerId && (spot as any).ownerId !== this.playerId
         );
         const enemyOilCount = enemyOil.length;
         const enemyBases = this.getEnemyBuildings(gameState)
             .filter(b => b.type === 'base')
             .map(b => ({ x: b.x, y: b.y, type: 'HQ_STRIKE' }));

         if (unit.type === 'pirate_ship') {
             if (enemyOilCount > 0 && (phase === 'EARLY' || this.difficulty >= 8)) {
                 const bestOil = this.findClosest(unit, enemyOil);
                 return { x: bestOil.x, y: bestOil.y, type: 'PIRATE_OIL_RAID' };
             }
             if (this.difficulty <= 3 && phase === 'EARLY' && enemyBases.length > 0) {
                 const bestBase = this.findClosest(unit, enemyBases);
                 return { x: bestBase.x, y: bestBase.y, type: 'PIRATE_BASE_RUSH' };
             }
         }

         // 1. Primary objective: strike enemy HQ once we have a working fleet or the assault manager is active.
         if (enemyBases.length > 0) {
             const committedToBaseStrike =
                 assaultingBase ||
                 phase !== 'EARLY' ||
                 this.difficulty >= 6 ||
                 ownedOilCount > 0 ||
                 player.resources.oil >= 900;
             if (committedToBaseStrike) {
                 const best = this.findClosest(unit, enemyBases);
                 return { x: best.x, y: best.y, type: 'HQ_STRIKE' };
             }
         }

         // 2. Economy denial when behind on oil or under oil pressure.
         if (enemyOilCount > 0) {
             const behindOnOil = ownedOilCount === 0 || enemyOilCount > ownedOilCount;
             const lowOilThreshold =
                 this.difficulty >= 7 ? 1800 :
                 this.difficulty >= 4 ? 1400 :
                 this.difficulty >= 2 ? 900 : 700;
             const shouldDenyOil = behindOnOil || player.resources.oil < lowOilThreshold || this.difficulty >= 5;
             const denyWindow =
                 phase !== 'LATE' ||
                 this.difficulty >= 8 ||
                 enemyOilCount >= ownedOilCount;
             if (shouldDenyOil && denyWindow && !assaultingBase) {
                 const best = this.findClosest(unit, enemyOil);
                 return { x: best.x, y: best.y, type: 'OIL_DENIAL' };
             }
         }

         // 3. Enemy docks/carriers and support ships.
         const priorityTargets = [
             ...gameState.units.filter(u => u.ownerId !== this.playerId && ['aircraft_carrier', 'construction_ship'].includes(u.type)),
             ...this.getEnemyBuildings(gameState).filter(building => building.type === 'dock')
         ];
         if (priorityTargets.length > 0) {
             const best = this.findClosest(unit, priorityTargets as any[]);
             return { x: best.x, y: best.y, type: 'PRIORITY_UNIT' };
         }

         // 4. Enemy Islands (Base Assault)
         const enemyBuildings = this.getEnemyBuildings(gameState);
         if (enemyBuildings.length > 0) {
             const bestBuilding = this.findClosest(unit, enemyBuildings);
             return { x: bestBuilding.x, y: bestBuilding.y, type: 'ISLAND_ASSAULT' };
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
        const phase = this.getMatchPhase();
        const hasRecruitment = myIslands.some(island =>
            island.buildings.some(building =>
                building.ownerId === this.playerId && (building.type === 'barracks' || building.type === 'dock')
            )
        );
        const hasEconomy = this.getOwnedMineCount(myIslands) > 0 || this.getOwnedOilStructureCount(gameState, myIslands) > 0;
        if (phase === 'EARLY' && (!hasRecruitment || !hasEconomy)) return;
        const hasOilIncome = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
        if (gameState.mapType === 'grasslands' && phase === 'EARLY' && !hasOilIncome) return;

        const maxDefences = this.getDefenceTargets(gameState.mapType).towers;

        // Count existing
        let currentDefences = 0;
        myIslands.forEach(i => {
            currentDefences += i.buildings.filter(b => b.type === 'tower' && b.ownerId === this.playerId).length;
        });

        if (currentDefences >= maxDefences) return;

        // Build Logic
        // Prefer: Ring 1 (HQ), Ring 2 (Prod), Ring 3 (Res)
        // Find best island (Base > Factory > Mine)
        
        const baseIsland = myIslands.find(i => i.buildings.some(b => b.type === 'base' && b.ownerId === this.playerId));
        if (baseIsland && this.canAfford(player, 'tower')) { 
             // Try to build tower near base
             this.orderBuilderToDefend(gameState, player, baseIsland);
        }
    }

    private orderBuilderToDefend(gameState: GameState, player: Player, island: Island) {
        const builder = gameState.units.find(u => u.ownerId === this.playerId && u.type === 'builder' && u.status === 'idle');
        if (!builder) return;

        const existingDefences = island.buildings.filter(b => b.type === 'tower' && b.ownerId === this.playerId).length;
        const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId);
        const hqX = base ? island.x + (base.x || 0) : island.x;
        const hqY = base ? island.y + (base.y || 0) : island.y;
        const baseRadius = gameState.getBuildingFootprintRadius('base');
        const towerRadius = gameState.getBuildingFootprintRadius('tower');

        let minR = baseRadius + towerRadius + 12;
        let maxR = minR + 80;
        if (existingDefences >= 2) { minR += 24; maxR += 36; }
        if (existingDefences >= 4) { minR += 36; maxR += 48; }

        // Scan for a valid spot
        let bestSpot: {x: number, y: number} | null = null;
        let bestDist = Infinity;

        // Try 16 angles for better coverage
        const steps = 16;
        for (let i = 0; i < steps; i++) {
            const angle = (i * Math.PI * 2 / steps) + (Date.now() / 10000); // Rotate slowly
            const dist = minR + ((maxR - minR) * ((i % 4) / 3));
            const bx = hqX + Math.cos(angle) * dist;
            const by = hqY + Math.sin(angle) * dist;

            if (!gameState.isBuildingPlacementClearOnIsland(island, 'tower', bx, by)) continue;
            
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
      const phase = this.getMatchPhase();
      const myUnits = gameState.units.filter(unit => unit.ownerId === this.playerId);
      const capitalStrikeAdvantage = this.hasMothershipStrikeAdvantage(gameState, myUnits);
      const enemyBuildings = this.getEnemyBuildings(gameState);
      const enemyBases = enemyBuildings.filter(building => building.type === 'base');
      if (capitalStrikeAdvantage && enemyBases.length > 0) {
          const myIslands = this.getControlledIslands(gameState);
          const home = this.getOwnedBaseIsland(gameState, myIslands) || myIslands[0] || null;
          if (!home) {
              return { x: enemyBases[0].x, y: enemyBases[0].y };
          }

          let bestBase = enemyBases[0];
          let bestScore = -Infinity;
          enemyBases.forEach(base => {
              const distance = Math.hypot(base.x - home.x, base.y - home.y);
              const score = -distance;
              if (score > bestScore) {
                  bestScore = score;
                  bestBase = base;
              }
          });
          return { x: bestBase.x, y: bestBase.y };
      }

      const managerTarget = this.debugState?.attackManager?.targetPos;
      if (
          managerTarget &&
          Number.isFinite(managerTarget.x) &&
          Number.isFinite(managerTarget.y)
      ) {
          return { x: managerTarget.x, y: managerTarget.y };
      }

      if (enemyBases.length > 0 && (phase !== 'EARLY' || this.difficulty >= 8)) {
          const myIslands = this.getControlledIslands(gameState);
          const home = this.getOwnedBaseIsland(gameState, myIslands) || myIslands[0] || null;
          if (!home) {
              return { x: enemyBases[0].x, y: enemyBases[0].y };
          }

          let bestBase = enemyBases[0];
          let bestScore = -Infinity;
          enemyBases.forEach(base => {
              const distance = Math.hypot(base.x - home.x, base.y - home.y);
              const score = -distance;
              if (score > bestScore) {
                  bestScore = score;
                  bestBase = base;
              }
          });
          return { x: bestBase.x, y: bestBase.y };
      }

      // Level 10 Aggression: Prioritize Humans
      if (this.difficulty >= 10) {
          const humans = Array.from(gameState.players.values()).filter(p => !p.isBot && p.id !== this.playerId);
          if (humans.length > 0) {
              // Find human buildings
              const humanIds = new Set(humans.map(h => h.id));
              const humanBuildings = enemyBuildings.filter(b => b.ownerId && humanIds.has(b.ownerId));
              
              if (humanBuildings.length > 0) {
                  const target = humanBuildings[0];
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

      if (this.difficulty >= 9) {
          const strategicBuildings = enemyBuildings.filter(building =>
              ['base', 'barracks', 'tank_factory', 'dock', 'air_base'].includes(building.type)
          );
          if (strategicBuildings.length > 0) {
              const target = strategicBuildings[0];
              return { x: target.x, y: target.y };
          }
      }

      // Standard fallback targeting
      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const all = [...enemies, ...enemyBuildings];
      if (all.length === 0) return null;

      const myIslands = this.getControlledIslands(gameState);
      const home = this.getOwnedBaseIsland(gameState, myIslands) || myIslands[0] || null;
      if (!home) {
          const target = all[0];
          if (target.x === 0 && target.y === 0) return null;
          return { x: target.x, y: target.y };
      }

      let bestTarget = all[0];
      let bestDistance = Math.hypot(bestTarget.x - home.x, bestTarget.y - home.y);
      all.forEach(candidate => {
          const distance = Math.hypot(candidate.x - home.x, candidate.y - home.y);
          if (distance < bestDistance) {
              bestDistance = distance;
              bestTarget = candidate;
          }
      });

      const target = bestTarget;
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
      this.manageArmyHealing(gameState, myUnits, myIslands);
      this.manageNavalCommander(gameState, player, myUnits);
      this.manageAirForce(gameState, player, myUnits);
  }

  private isHospitalUnitType(type: string): boolean {
      return ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(type);
  }

  private manageSupportBuildings(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (myIslands.length === 0) return;

      const phase = this.getMatchPhase();
      const oilOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const readyBarracks = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'barracks'));
      const hasRepairableArmy = myUnits.some(unit => this.isCombatUnitType(unit.type) && !this.isHospitalUnitType(unit.type));
      const existingHospitals = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'hospital'), 0);
      const existingRepairDocks = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'repair_dock'), 0);
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      const orderedIslands = [...myIslands].sort((left, right) => {
          if (baseIsland) {
              if (left.id === baseIsland.id) return -1;
              if (right.id === baseIsland.id) return 1;
          }
          return left.id.localeCompare(right.id);
      });
      const hospitalBuildOrder = this.prioritizeStructureBuildIslands(gameState, orderedIslands, 'hospital');
      const repairDockBuildOrder = this.prioritizeStructureBuildIslands(gameState, orderedIslands, 'repair_dock');

      let hospitalTarget = 0;
      let repairDockTarget = 0;

      if (gameState.mapType !== 'islands') {
          if (readyBarracks || phase !== 'EARLY' || this.difficulty >= 7) {
              hospitalTarget =
                  this.difficulty >= 10 ? (phase === 'EARLY' ? 1 : 2) :
                  this.difficulty >= 7 ? (phase === 'LATE' ? 2 : 1) :
                  phase === 'LATE' ? 1 : 0;
          }

          if (hasRepairableArmy || phase !== 'EARLY') {
              repairDockTarget =
                  this.difficulty >= 9 ? 2 :
                  this.difficulty >= 4 ? 1 : 0;
          }
      } else {
          const hasGroundArmy = myUnits.some(unit =>
              ['soldier', 'sniper', 'rocketeer', 'tank', 'humvee', 'missile_launcher'].includes(unit.type)
          );
          if (readyBarracks || hasGroundArmy || (phase !== 'EARLY' && this.difficulty >= 7)) {
              hospitalTarget =
                  this.difficulty >= 10 ? (phase === 'EARLY' ? 1 : 2) :
                  this.difficulty >= 8 ? 1 :
                  this.difficulty >= 6 && phase === 'LATE' ? 1 : 0;
          }
          repairDockTarget =
              this.difficulty >= 10 ? (phase === 'EARLY' ? 1 : 2) :
              this.difficulty >= 7 ? 1 : 0;
      }

      if (!oilOnline && phase === 'EARLY') {
          if (this.difficulty <= 3) {
              hospitalTarget = 0;
              repairDockTarget = 0;
          } else if (this.difficulty <= 6) {
              hospitalTarget = Math.min(hospitalTarget, 1);
              repairDockTarget = Math.min(repairDockTarget, 1);
          }
      }

      let hospitalsBuilt = existingHospitals;
      while (hospitalsBuilt < hospitalTarget) {
          if (!this.canAfford(player, 'hospital')) break;

          let built = false;
          for (const island of hospitalBuildOrder) {
              if (this.ensureBuilderAndBuild(gameState, island, 'hospital')) {
                  hospitalsBuilt += 1;
                  built = true;
                  break;
              }
          }
          if (!built) break;
      }

      let repairDocksBuilt = existingRepairDocks;
      while (repairDocksBuilt < repairDockTarget) {
          if (!this.canAfford(player, 'repair_dock')) break;

          let built = false;
          for (const island of repairDockBuildOrder) {
              if (this.ensureBuilderAndBuild(gameState, island, 'repair_dock')) {
                  repairDocksBuilt += 1;
                  built = true;
                  break;
              }
          }
          if (!built) break;
      }
  }

  private manageArmyHealing(gameState: GameState, myUnits: Unit[], myIslands: Island[]) {
      const now = Date.now();
      const hospitalPoints: Array<{ x: number; y: number; range: number }> = [];
      const repairPoints: Array<{ x: number; y: number; range: number }> = [];

      myIslands.forEach(island => {
          island.buildings.forEach(building => {
              if (building.ownerId !== this.playerId || building.isConstructing) return;
              const point = {
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  range: building.range || BuildingData[building.type]?.range || 220
              };
              if (building.type === 'hospital') hospitalPoints.push(point);
              if (building.type === 'repair_dock') repairPoints.push(point);
          });
      });

      if (hospitalPoints.length === 0 && repairPoints.length === 0) return;

      const retreatThreshold =
          this.difficulty <= 3 ? 0.78 :
          this.difficulty <= 6 ? 0.68 :
          this.difficulty <= 8 ? 0.6 : 0.52;
      const dangerOverrideThreshold = this.difficulty >= 8 ? 0.45 : 0.4;
      const dangerRadius = gameState.mapType === 'islands' ? 320 : 280;
      let healOrdersIssued = 0;
      const maxHealOrders =
          this.difficulty >= 9 ? 10 :
          this.difficulty >= 6 ? 5 : 3;
      const unitsByPriority = [...myUnits].sort((left, right) => {
          const rightBurning = this.isUnitTakingDamageOverTime(right, now) ? 1 : 0;
          const leftBurning = this.isUnitTakingDamageOverTime(left, now) ? 1 : 0;
          if (rightBurning !== leftBurning) return rightBurning - leftBurning;
          const leftHealthRatio = left.health / Math.max(1, left.maxHealth);
          const rightHealthRatio = right.health / Math.max(1, right.maxHealth);
          return leftHealthRatio - rightHealthRatio;
      });

      unitsByPriority.forEach(unit => {
          if (healOrdersIssued >= maxHealOrders) return;
          if (this.usedUnitIds.has(unit.id)) return;
          if (!this.isCombatUnitType(unit.type)) return;
          const burning = this.isUnitTakingDamageOverTime(unit, now);
          if (!burning && unit.health >= unit.maxHealth) return;

          const healPoints =
              burning && !this.isHospitalUnitType(unit.type) && repairPoints.length > 0
                  ? repairPoints
                  : this.isHospitalUnitType(unit.type)
                      ? hospitalPoints
                      : repairPoints;
          if (healPoints.length === 0) return;

          const healthRatio = unit.health / Math.max(1, unit.maxHealth);
          if (!burning && healthRatio > retreatThreshold) return;

          const threatened = gameState.units.some(enemy =>
              enemy.ownerId !== this.playerId &&
              Math.hypot(enemy.x - unit.x, enemy.y - unit.y) <= dangerRadius
          );
          if (!burning && threatened && healthRatio > dangerOverrideThreshold) return;

          const closest = healPoints.reduce((best, point) => {
              if (!best) return point;
              const bestDist = Math.hypot(best.x - unit.x, best.y - unit.y);
              const currentDist = Math.hypot(point.x - unit.x, point.y - unit.y);
              return currentDist < bestDist ? point : best;
          }, healPoints[0]);

          if (Math.hypot(closest.x - unit.x, closest.y - unit.y) <= Math.max(60, closest.range - 20)) return;

          const distanceToHeal = Math.hypot(closest.x - unit.x, closest.y - unit.y);
          if (distanceToHeal < 90) return;

          const hash = Array.from(unit.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
          const offsetAngle = (hash % 360) * (Math.PI / 180);
          const offsetRadius = 28 + (hash % 5) * 10;
          const targetX = closest.x + Math.cos(offsetAngle) * offsetRadius;
          const targetY = closest.y + Math.sin(offsetAngle) * offsetRadius;
          this.moveUnitSafe(gameState, unit.id, targetX, targetY);
          healOrdersIssued += 1;
      });
  }

  private getNavalRallyPoint(gameState: GameState, unit: Unit): {x: number, y: number} | null {
       // Find nearest dock
       let bestDock: any = null;
       let minD = Infinity;
       
       this.getControlledIslands(gameState).forEach(i => {
           const dock = i.buildings.find(b => b.type === 'dock' && b.ownerId === this.playerId);
           if (dock) {
               const d = Math.hypot(i.x - unit.x, i.y - unit.y);
               if (d < minD) { minD = d; bestDock = i; }
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
      const phase = this.getMatchPhase();
      
      let bestTarget = null;
      let highestScore = -Infinity;

      const enemies = gameState.units.filter(u => u.ownerId !== this.playerId);
      const enemyBuildings: any[] = this.getEnemyBuildings(gameState);

      const allTargets = [...enemies, ...enemyBuildings];

      allTargets.forEach(t => {
          const tx = t.x;
          const ty = t.y;
          
          let score = 0;
          const dist = Math.hypot(tx - unit.x, ty - unit.y);
          score -= dist; // Closer is better

          // Bias towards Human Players
          const ownerId = t.ownerId || (t as any).ownerId;
          const owner = gameState.players.get(ownerId);
          if (owner && !owner.isBot) {
              score += (playerBias * 5000); 
          }

          if (t.type === 'base') {
              score += phase === 'LATE' ? 2600 : 1800;
          } else if (['barracks', 'tank_factory', 'air_base', 'dock'].includes(t.type)) {
              score += phase === 'MID' || phase === 'LATE' ? 1700 : 1200;
          } else if (['mine', 'oil_rig', 'oil_well'].includes(t.type)) {
              score += phase === 'EARLY' ? 1200 : 900;
          }

          if (phase === 'LATE' && this.strategyProfile.coordinationWeight >= 0.8) {
              score += 250;
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
      if (['destroyer', 'pirate_ship', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier', 'raft', 'scout_boat', 'gunship', 'oil_tanker'].includes(type)) {
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
      const isSharedLandPath =
          this.getUnitDomain(unit.type) === 'LAND' &&
          ['grasslands', 'desert'].includes(gameState.mapType);
      const cellSize =
          this.getUnitDomain(unit.type) === 'LAND'
              ? (isSharedLandPath ? (this.difficulty >= 7 ? 36 : 40) : 48)
              : 80;
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

  private getIslandSurfaceDepth(gameState: GameState, island: Island, x: number, y: number, buffer: number = 0): number {
      if (island.points && island.points.length > 2) {
          const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
          const edgeDistance = Math.hypot(x - closest.x, y - closest.y);
          if (MapGenerator.isPointInPolygon(x, y, island.points)) {
              return edgeDistance;
          }
          return buffer - edgeDistance;
      }

      return island.radius - Math.hypot(x - island.x, y - island.y) + buffer;
  }

  private getIslandContainingPoint(gameState: GameState, x: number, y: number, buffer: number = 35): Island | null {
      const candidates = gameState.map.islands.filter(candidate => {
          if (candidate.points) {
              if (MapGenerator.isPointInPolygon(x, y, candidate.points)) return true;
              const closest = MapGenerator.getClosestPointOnPolygon(x, y, candidate.points);
              return Math.hypot(x - closest.x, y - closest.y) <= buffer;
          }
          return Math.hypot(x - candidate.x, y - candidate.y) <= candidate.radius + buffer;
      });
      if (candidates.length === 0) return null;

      const ranked = candidates.sort((left, right) => {
          const leftDepth = this.getIslandSurfaceDepth(gameState, left, x, y, buffer);
          const rightDepth = this.getIslandSurfaceDepth(gameState, right, x, y, buffer);
          if (leftDepth !== rightDepth) return rightDepth - leftDepth;

          const leftCenterDist = Math.hypot(x - left.x, y - left.y);
          const rightCenterDist = Math.hypot(x - right.x, y - right.y);
          if (leftCenterDist !== rightCenterDist) return leftCenterDist - rightCenterDist;

          return left.radius - right.radius;
      });

      return ranked[0] || null;
  }

  private getBridgeEndpoints(gameState: GameState, bridge: any): { ax: number; ay: number; bx: number; by: number } | null {
      return gameState.getBridgeEndpoints(bridge);
  }

  private buildBridgeWaypointPath(gameState: GameState, unit: Unit, target: { x: number, y: number }): { x: number, y: number }[] {
      if (this.getUnitDomain(unit.type) !== 'LAND') return [];

      const startIsland = this.getIslandContainingPoint(gameState, unit.x, unit.y, 45);
      const endIsland = this.getIslandContainingPoint(gameState, target.x, target.y, 45);
      if (!startIsland || !endIsland || startIsland.id === endIsland.id) return [];

      const findTraversalPathFn = (gameState as any).findIslandTraversalPath;
      if (typeof findTraversalPathFn !== 'function') return [];

      const traversalPath = findTraversalPathFn.call(gameState, startIsland.id, endIsland.id) as string[] | null;
      if (!Array.isArray(traversalPath) || traversalPath.length < 2) return [];

      const waypoints: { x: number; y: number }[] = [];

      traversalPath.forEach(token => {
          if (!token.startsWith('node:')) return;
          const nodeId = token.slice('node:'.length);
          const context = gameState.getNodeContext(nodeId);
          if (!context) return;
          waypoints.push(gameState.adjustTarget(unit.type, context.x, context.y));
      });

      waypoints.push(target);
      const filtered: { x: number; y: number }[] = [];
      waypoints.forEach(point => {
          const prev = filtered[filtered.length - 1];
          if (!prev || Math.hypot(prev.x - point.x, prev.y - point.y) > 16) {
              filtered.push(point);
          }
      });

      return filtered;
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

      const bridgeWaypoints = this.buildBridgeWaypointPath(gameState, unit, target);
      if (bridgeWaypoints.length > 1) {
          return bridgeWaypoints;
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
      const now = Date.now();
      const activeMoveTarget =
          unit.status === 'moving' &&
          typeof unit.targetX === 'number' &&
          typeof unit.targetY === 'number' &&
          Math.hypot(unit.targetX - adjusted.x, unit.targetY - adjusted.y) <= (this.loadFactor >= 0.55 ? 34 : 18);
      const recentMove = this.recentMoveOrders.get(unitId);
      const recentDuplicate =
          !!recentMove &&
          Math.hypot(recentMove.x - adjusted.x, recentMove.y - adjusted.y) <= 22 &&
          (now - recentMove.issuedAt) <= (this.loadFactor >= 0.7 ? 1800 : 900);

      if (activeMoveTarget || recentDuplicate) {
          this.usedUnitIds.add(unitId);
          return;
      }

      const skipBotPathPlanning =
          this.loadFactor >= 0.58 ||
          (this.loadFactor >= 0.34 && this.isCombatUnitType(unit.type));
      let path = skipBotPathPlanning ? [adjusted] : this.computePathForUnit(gameState, unit, adjusted);

      if (path.length === 0) {
          const fallback = this.findNearestReachablePoint(gameState, unit, adjusted);
          if (fallback) {
              path = skipBotPathPlanning ? [fallback] : this.computePathForUnit(gameState, unit, fallback);
          }
          if (path.length === 0) {
              path = [adjusted];
          }
      }

      const domain = this.getUnitDomain(unit.type);
      const directLine = this.isDirectLine(gameState, unit, adjusted, path.length);

      if (this.loadFactor < 0.55) {
          this.logEvent('BOT_PATH', {
              unitId: unit.id,
              type: unit.type,
              domain,
              directLine,
              pathPoints: path.length,
              start: { x: unit.x, y: unit.y },
              goal: adjusted
          });
      }

      if (!skipBotPathPlanning && path.length > 1) {
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
              const sameTargetThreshold = this.loadFactor >= 0.55 ? 22 : 10;
              if (dist < sameTargetThreshold) {
                  this.usedUnitIds.add(unitId);
                  return;
              }
          }

          gameState.handleMoveIntent(this.playerId, unitId, intentPrefix + Date.now(), x, y);
          this.recentMoveOrders.set(unitId, { x, y, issuedAt: Date.now() });
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
      const unit = gameState.units.find(candidate => candidate.id === unitId);
      const bypassApm =
          !!unit &&
          this.difficulty >= 9 &&
          this.isCombatUnitType(unit.type) &&
          this.debugState?.attackManager?.state === 'ASSAULT';
      this.botMoveUnit(gameState, unitId, x, y, 'bot_move_', !bypassApm);
  }

  public requestMovePriority(gameState: GameState, unitId: string, x: number, y: number) {
      this.botMoveUnit(gameState, unitId, x, y, 'bot_prio_', false);
  }

  private buildAvailableMines(gameState: GameState, player: Player, island: Island) {
      const phase = this.getMatchPhase();
      const myIslands = this.getControlledIslands(gameState);
      const ownedMines = this.getOwnedMineCount(myIslands);
      const desiredClaims = this.getDesiredResourceClaims(phase);
      if (ownedMines >= desiredClaims && phase !== 'LATE') return;

      const availableGoldSpots = island.goldSpots.filter(s => !s.occupiedBy).length;
      if (availableGoldSpots > 0 && this.canAfford(player, 'mine')) {
          this.ensureBuilderAndBuild(gameState, island, 'mine');
      }
  }

  private isIslandNearOffshoreOil(gameState: GameState, island: Island): boolean {
      return (gameState.map.oilSpots || []).some(spot =>
          !spot.id.startsWith('hidden') && Math.hypot(spot.x - island.x, spot.y - island.y) < island.radius + 800
      );
  }

  private getOwnedOilStructureCount(gameState: GameState, myIslands: Island[]): number {
      let ownedOil = 0;
      myIslands.forEach(island => {
          ownedOil += island.buildings.filter(
              b => (b.type === 'oil_rig' || b.type === 'oil_well') && b.ownerId === this.playerId
          ).length;
      });
      ownedOil += gameState.map.oilSpots.filter(spot => (spot as any).ownerId === this.playerId).length;
      return ownedOil;
  }

  private countQueuedUnitsOfType(gameState: GameState, myIslands: Island[], type: string): number {
      let queued = 0;

      myIslands.forEach(island => {
          island.buildings.forEach(building => {
              if (building.ownerId !== this.playerId || !building.recruitmentQueue) return;
              queued += building.recruitmentQueue.filter(entry => entry.unitType === type).length;
          });
      });

      gameState.units.forEach(unit => {
          if (unit.ownerId !== this.playerId || !unit.recruitmentQueue) return;
          queued += unit.recruitmentQueue.filter(entry => entry.unitType === type).length;
      });

      return queued;
  }

  private countUnitsIncludingQueue(gameState: GameState, myIslands: Island[], myUnits: Unit[], type: string): number {
      const liveUnits = myUnits.filter(unit => unit.type === type).length;
      return liveUnits + this.countQueuedUnitsOfType(gameState, myIslands, type);
  }

  private isBasicInfantryType(type: string): boolean {
      return (BOT_BASIC_INFANTRY_TYPES as readonly string[]).includes(type);
  }

  private getBasicInfantryCountIncludingQueue(gameState: GameState, myIslands: Island[], myUnits: Unit[]): number {
      return BOT_BASIC_INFANTRY_TYPES.reduce(
          (count, unitType) => count + this.countUnitsIncludingQueue(gameState, myIslands, myUnits, unitType),
          0
      );
  }

  private getBasicInfantrySoftCap(gameState: GameState, player: Player, myIslands: Island[]): number {
      if (this.difficulty <= 6) return BOT_BASIC_INFANTRY_CAP;

      const phase = this.getMatchPhase();
      const oilOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const readyFactories = myIslands.reduce(
          (count, island) =>
              count +
              island.buildings.filter(
                  building => building.ownerId === this.playerId && building.type === 'tank_factory' && !building.isConstructing
              ).length,
          0
      );
      const readyAirBases = myIslands.reduce(
          (count, island) =>
              count +
              island.buildings.filter(
                  building => building.ownerId === this.playerId && building.type === 'air_base' && !building.isConstructing
              ).length,
          0
      );
      const capitalUnitsOnline = gameState.units.some(
          unit => unit.ownerId === this.playerId && (unit.type === 'mothership' || unit.type === 'aircraft_carrier')
      );
      const techOnline = oilOnline || readyFactories > 0 || readyAirBases > 0 || capitalUnitsOnline;

      if (this.difficulty >= 10) {
          if (techOnline) return phase === 'EARLY' ? 2 : 1;
          return 3;
      }
      if (this.difficulty >= 9) {
          if (techOnline) return phase === 'EARLY' ? 3 : 2;
          return 4;
      }
      if (techOnline) return phase === 'EARLY' ? 4 : 3;
      return 5;
  }

  private findAutoBuildPosition(gameState: GameState, island: Island, buildingType: string): { x: number; y: number } | null {
      if (buildingType === 'dock') {
          const preferredDock = this.baseDefenseBuilder.getPreferredDockPlacement(gameState, island);
          if (preferredDock) {
              return { x: preferredDock.x, y: preferredDock.y };
          }
      }

      const localBase = island.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId);
      const localAnchorBuilding =
          localBase ||
          island.buildings.find(
              b =>
                  b.ownerId === this.playerId &&
                  ['bridge_node', 'dock', 'air_base', 'repair_dock', 'tower'].includes(b.type)
          );
      const anchorX = localAnchorBuilding ? island.x + (localAnchorBuilding.x || 0) : island.x;
      const anchorY = localAnchorBuilding ? island.y + (localAnchorBuilding.y || 0) : island.y;
      const targetFootprint = gameState.getBuildingPlacementRadius(buildingType);
      const baseFootprint = localBase ? gameState.getBuildingPlacementRadius('base') : 0;
      const isSupportBuilding = ['hospital', 'repair_dock'].includes(buildingType);
      const isProductionBuilding = ['barracks', 'tank_factory', 'air_base'].includes(buildingType) || isSupportBuilding;
      let minDistance = Math.max(targetFootprint + 20, baseFootprint + targetFootprint + 12);
      if (isProductionBuilding && gameState.mapType === 'islands') {
          minDistance = Math.max(targetFootprint + 4, baseFootprint + Math.max(4, Math.floor(targetFootprint * 0.35)));
      }
      if (isProductionBuilding && ['desert', 'grasslands'].includes(gameState.mapType) && this.difficulty >= 8) {
          minDistance = Math.max(targetFootprint + 8, baseFootprint + Math.max(6, Math.floor(targetFootprint * 0.55)));
      }
      const islandLimit = Math.max(
          minDistance + 60,
          island.radius - targetFootprint - (isProductionBuilding ? 18 : 10)
      );
      const preferredMaxDistance = buildingType === 'air_base'
          ? Math.max(minDistance + 420, Math.min(islandLimit, minDistance + (this.difficulty >= 8 ? 780 : 620)))
          : ['barracks', 'tank_factory', 'hospital', 'repair_dock'].includes(buildingType)
              ? Math.max(minDistance + 360, Math.min(islandLimit, minDistance + (this.difficulty >= 8 ? 700 : 560)))
              : Math.max(minDistance + 220, Math.min(islandLimit, minDistance + 300));
      const ringCount = buildingType === 'air_base'
          ? (this.difficulty >= 8 ? 26 : 20)
          : ['barracks', 'tank_factory', 'hospital', 'repair_dock'].includes(buildingType)
              ? (this.difficulty >= 8 ? 24 : 18)
              : 8;
      const angleSteps = isProductionBuilding ? (this.difficulty >= 8 ? 44 : 32) : 20;
      const duelProductionSite = isProductionBuilding
          ? this.findDuelProductionBuildPosition(gameState, island, buildingType, anchorX, anchorY, minDistance, islandLimit)
          : null;
      if (duelProductionSite) {
          return duelProductionSite;
      }

      const accept = (x: number, y: number) => {
          return gameState.isBuildingPlacementClearOnIsland(island, buildingType, x, y);
      };

      for (let ring = 0; ring < ringCount; ring++) {
          const distance = minDistance + ring * 36;
          for (let step = 0; step < angleSteps; step++) {
              const angle = (step / angleSteps) * Math.PI * 2 + ring * 0.17;
              const x = anchorX + Math.cos(angle) * distance;
              const y = anchorY + Math.sin(angle) * distance;
              if (accept(x, y)) return { x, y };
          }
      }

      if (!island.points) {
          const stride = isProductionBuilding ? 46 : 64;
          const radialLimit = Math.max(minDistance + 40, Math.min(island.radius - targetFootprint - 6, preferredMaxDistance + 120));
          for (let x = island.x - radialLimit; x <= island.x + radialLimit; x += stride) {
              for (let y = island.y - radialLimit; y <= island.y + radialLimit; y += stride) {
                  if (Math.hypot(x - island.x, y - island.y) > radialLimit) continue;
                  if (Math.hypot(x - anchorX, y - anchorY) < minDistance) continue;
                  if (accept(x, y)) return { x, y };
              }
          }
      }

      if (island.points) {
          const xs = island.points.map(p => p.x);
          const ys = island.points.map(p => p.y);
          const polyPadding = gameState.mapType === 'islands' ? Math.max(1, Math.round(targetFootprint * 0.2)) : 4;
          const minX = Math.max(targetFootprint, Math.min(...xs) + targetFootprint + polyPadding);
          const maxX = Math.min(gameState.map.width - targetFootprint, Math.max(...xs) - targetFootprint - polyPadding);
          const minY = Math.max(targetFootprint, Math.min(...ys) + targetFootprint + polyPadding);
          const maxY = Math.min(gameState.map.height - targetFootprint, Math.max(...ys) - targetFootprint - polyPadding);

          for (let attempt = 0; attempt < 48; attempt++) {
              const x = minX + Math.random() * Math.max(1, maxX - minX);
              const y = minY + Math.random() * Math.max(1, maxY - minY);
              if (accept(x, y)) return { x, y };
          }
      } else {
          for (let attempt = 0; attempt < 48; attempt++) {
              const angle = Math.random() * Math.PI * 2;
              const distance = minDistance + Math.random() * Math.max(20, Math.min(preferredMaxDistance, Math.max(minDistance + 20, island.radius - targetFootprint - 8)) - minDistance);
              const x = anchorX + Math.cos(angle) * distance;
              const y = anchorY + Math.sin(angle) * distance;
              if (accept(x, y)) return { x, y };
          }
      }

      if (isProductionBuilding && ['desert', 'grasslands'].includes(gameState.mapType) && this.difficulty >= 8) {
          const stride = 34;
          const radialLimit = Math.max(minDistance + 30, Math.min(island.radius - targetFootprint - 8, preferredMaxDistance + 180));
          for (let x = island.x - radialLimit; x <= island.x + radialLimit; x += stride) {
              for (let y = island.y - radialLimit; y <= island.y + radialLimit; y += stride) {
                  if (Math.hypot(x - island.x, y - island.y) > radialLimit) continue;
                  if (Math.hypot(x - anchorX, y - anchorY) < minDistance) continue;
                  if (accept(x, y)) return { x, y };
              }
          }
      }

      return null;
  }

  private findDuelProductionBuildPosition(
      gameState: GameState,
      island: Island,
      buildingType: string,
      anchorX: number,
      anchorY: number,
      minDistance: number,
      islandLimit: number
  ): { x: number; y: number } | null {
      if (!['desert', 'grasslands'].includes(gameState.mapType)) return null;

      const enemyBases = this.getEnemyBuildings(gameState).filter(building => building.type === 'base');
      const nearestEnemy = enemyBases.reduce((best, current) => {
          if (!best) return current;
          const bestDist = Math.hypot(best.x - anchorX, best.y - anchorY);
          const currentDist = Math.hypot(current.x - anchorX, current.y - anchorY);
          return currentDist < bestDist ? current : best;
      }, enemyBases[0] || null);

      const frontAngle = nearestEnemy
          ? Math.atan2(nearestEnemy.y - anchorY, nearestEnemy.x - anchorX)
          : 0;
      const rearAngle = frontAngle + Math.PI;
      const sideBias = buildingType === 'tank_factory' ? 1.05 : buildingType === 'air_base' ? 0.82 : 0.58;
      const sectorAngles = [
          rearAngle,
          rearAngle + sideBias,
          rearAngle - sideBias,
          rearAngle + Math.PI / 2,
          rearAngle - Math.PI / 2,
          rearAngle + 1.7,
          rearAngle - 1.7
      ];
      if (this.difficulty >= 9) {
          sectorAngles.push(
              frontAngle + Math.PI / 2,
              frontAngle - Math.PI / 2,
              frontAngle + 2.2,
              frontAngle - 2.2
          );
      }
      const productionTypes = new Set(['base', 'barracks', 'tank_factory', 'air_base', 'hospital', 'repair_dock']);
      const ownedProductionBuildings = island.buildings.filter(
          building => building.ownerId === this.playerId && productionTypes.has(building.type)
      );
      const accept = (x: number, y: number) => gameState.isBuildingPlacementClearOnIsland(island, buildingType, x, y);
      const productionPressure = ownedProductionBuildings.length;

      let bestCandidate: { x: number; y: number; score: number } | null = null;
      const maxDistance = Math.max(minDistance + 60, islandLimit);
      for (let distance = minDistance + 40; distance <= maxDistance; distance += 44) {
          for (const baseAngle of sectorAngles) {
              for (let offsetIndex = -1; offsetIndex <= 1; offsetIndex++) {
                  const angle = baseAngle + offsetIndex * 0.18;
                  const x = anchorX + Math.cos(angle) * distance;
                  const y = anchorY + Math.sin(angle) * distance;
                  if (!accept(x, y)) continue;

                  let spacingScore = 0;
                  ownedProductionBuildings.forEach(building => {
                      const bx = island.x + (building.x || 0);
                      const by = island.y + (building.y || 0);
                      spacingScore += Math.min(260, Math.hypot(x - bx, y - by));
                  });

                  const angleToCandidate = Math.atan2(y - anchorY, x - anchorX);
                  const frontDelta = Math.abs(Math.atan2(Math.sin(angleToCandidate - frontAngle), Math.cos(angleToCandidate - frontAngle)));
                  const rearDelta = Math.abs(Math.atan2(Math.sin(angleToCandidate - rearAngle), Math.cos(angleToCandidate - rearAngle)));
                  const forwardPenaltyScale = productionPressure >= 4 ? 120 : 260;
                  const rearBonusScale = productionPressure >= 4 ? 90 : 140;
                  const forwardPenalty = Math.max(0, 1.1 - frontDelta) * forwardPenaltyScale;
                  const rearBonus = Math.max(0, 1.4 - rearDelta) * rearBonusScale;
                  const distanceBonus = productionPressure >= 4 ? distance * 0.35 : distance;
                  const score = spacingScore + rearBonus + distanceBonus - forwardPenalty;

                  if (!bestCandidate || score > bestCandidate.score) {
                      bestCandidate = { x, y, score };
                  }
              }
          }
      }

      return bestCandidate ? { x: bestCandidate.x, y: bestCandidate.y } : null;
  }

  private manageOffshoreOil(gameState: GameState, player: Player, myUnits: Unit[]) {
      const myIslands = this.getControlledIslands(gameState);
      const desiredOilClaims = this.getDesiredOilClaimCount(gameState, gameState.mapType);
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      if (ownedOilStructures >= desiredOilClaims) return;

      const myConsShips = myUnits.filter(u => u.type === 'construction_ship');
      if (myConsShips.length === 0) return;
      if (!this.canAfford(player, 'oil_rig')) return;

      const spots = gameState.map.oilSpots?.filter(s => !(s as any).occupiedBy && !s.id.startsWith('hidden')) || [];
      if (spots.length === 0) return;

      const enemyThreats = this.getEnemyThreatZones(gameState, true);
      const reservedSpotIds = new Set<string>();

      myConsShips.forEach(ship => {
          if (this.usedUnitIds.has(ship.id)) return;

          const currentThreat = this.estimateThreatAtPoint(ship.x, ship.y, enemyThreats);
          const retreatThreatLimit = this.difficulty >= 10 ? 70 : this.difficulty >= 8 ? 45 : 16;
          if (currentThreat > retreatThreatLimit && ship.health < ship.maxHealth * 0.7) {
              const retreat = this.getHomeRetreatPoint(gameState, myIslands);
              if (retreat) {
                  const retreatPoint = this.getThreatAwareApproachPoint(gameState, ship, retreat.x, retreat.y, enemyThreats, true);
                  this.moveUnitSafe(gameState, ship.id, retreatPoint.x, retreatPoint.y);
              }
              return;
          }

          const target = this.pickSafestOilSpot(ship, spots, enemyThreats, reservedSpotIds);
          if (!target) return;
          reservedSpotIds.add(target.id);

          const distanceToTarget = Math.hypot(target.x - ship.x, target.y - ship.y);
          const targetThreat = this.estimateThreatAtPoint(target.x, target.y, enemyThreats);
          const buildThreatLimit = this.difficulty >= 10 ? 80 : this.difficulty >= 8 ? 55 : 18;
          if (distanceToTarget < 150 && (targetThreat <= buildThreatLimit || ship.health >= ship.maxHealth * 0.6)) {
              const built = gameState.buildStructure(this.playerId, target.id, 'oil_rig');
              this.logEvent('OFFSHORE_RIG_ATTEMPT', {
                  shipId: ship.id,
                  spotId: target.id,
                  built,
                  distanceToTarget,
                  targetThreat,
                  gold: player.resources.gold,
                  oil: player.resources.oil
              });
              if (built) {
                  this.usedUnitIds.add(ship.id);
                  this.markAction(Date.now());
              }
              return;
          }

          const approachPoint = this.getThreatAwareApproachPoint(gameState, ship, target.x, target.y, enemyThreats);
          this.moveUnitSafe(gameState, ship.id, approachPoint.x, approachPoint.y);
      });
  }

  private manageOnshoreOil(gameState: GameState, player: Player, myUnits: Unit[], myIslands: Island[]) {
      const desiredOilClaims = this.getDesiredOilClaimCount(gameState, gameState.mapType);
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      if (ownedOilStructures >= desiredOilClaims) return;

      if (!this.canAfford(player, 'oil_well')) return;

      const enemyThreats = this.getEnemyThreatZones(gameState, true);
      const builders = myUnits.filter(unit => unit.type === 'builder');
      const reservedSpotIds = new Set<string>();
      const oilSearchBonus =
          this.difficulty >= 9 ? 420 :
          this.difficulty >= 7 ? 260 : 100;

      myIslands.forEach(island => {
          const visibleOil = gameState.map.oilSpots?.filter(s =>
              this.isOilSpotVisible(s) &&
              Math.hypot(s.x - island.x, s.y - island.y) < island.radius + oilSearchBonus &&
              !(s as any).occupiedBy &&
              !reservedSpotIds.has(s.id)
          ) || [];
          if (visibleOil.length === 0) return;

          const islandBuilders = builders.filter(
              builder => !this.usedUnitIds.has(builder.id) && Math.hypot(builder.x - island.x, builder.y - island.y) < island.radius + 140
          );
          const base = this.getOwnedBaseIsland(gameState, [island])?.buildings.find(
              b => b.type === 'base' && b.ownerId === this.playerId
          );
          const anchorX = base ? island.x + (base.x || 0) : island.x;
          const anchorY = base ? island.y + (base.y || 0) : island.y;
          const origin = islandBuilders[0] ? { x: islandBuilders[0].x, y: islandBuilders[0].y } : { x: anchorX, y: anchorY };
          const target = this.pickSafestOilSpot(origin, visibleOil, enemyThreats, reservedSpotIds);
          if (!target) return;
          reservedSpotIds.add(target.id);

          const targetThreat = this.estimateThreatAtPoint(target.x, target.y, enemyThreats);
          const noOilYet = ownedOilStructures <= 0;
          const threatLimit = noOilYet
              ? (this.difficulty <= 3 ? 38 : this.difficulty <= 6 ? 28 : this.difficulty >= 9 ? 80 : 26)
              : (this.difficulty >= 9 ? 55 : 18);
          if (targetThreat > threatLimit) {
              if (islandBuilders.length > 0) {
                  const retreat = this.getHomeRetreatPoint(gameState, myIslands);
                  if (retreat) {
                      const builder = islandBuilders[0];
                      const retreatPoint = this.getThreatAwareApproachPoint(gameState, builder, retreat.x, retreat.y, enemyThreats, true);
                      this.moveUnitSafe(gameState, builder.id, retreatPoint.x, retreatPoint.y);
                  }
              }
              return;
          }

          if (islandBuilders.length > 0) {
              const closestBuilder = islandBuilders.reduce((best, candidate) => {
                  if (!best) return candidate;
                  const bestDist = Math.hypot(best.x - target.x, best.y - target.y);
                  const candidateDist = Math.hypot(candidate.x - target.x, candidate.y - target.y);
                  return candidateDist < bestDist ? candidate : best;
              }, islandBuilders[0]);
              const distance = Math.hypot(closestBuilder.x - target.x, closestBuilder.y - target.y);
              if (distance > 240) {
                  const approachPoint = this.getThreatAwareApproachPoint(gameState, closestBuilder, target.x, target.y, enemyThreats);
                  this.moveUnitSafe(gameState, closestBuilder.id, approachPoint.x, approachPoint.y);
                  return;
              }
          }

          this.ensureBuilderAndBuild(gameState, island, 'oil_well', target.x, target.y);
      });
  }

  private manageOilRigDefenceStructures(gameState: GameState, player: Player, myIslands: Island[]) {
      if (this.difficulty < 5) return;

      const ownedOilSpots = (gameState.map.oilSpots || []).filter(spot => (spot as any).ownerId === this.playerId);
      if (ownedOilSpots.length === 0) return;
      if (!this.canAfford(player, 'tower')) return;

      const ownedIslands = myIslands.filter(island => island.ownerId === this.playerId);
      if (ownedIslands.length === 0) return;

      const existingTowers = ownedIslands.reduce(
          (count, island) => count + island.buildings.filter(building => building.ownerId === this.playerId && building.type === 'tower').length,
          0
      );
      const baseTowerTarget = this.getDefenceTargets(gameState.mapType).towers;
      const maxExtraOilTowers = this.difficulty >= 9 ? 3 : this.difficulty >= 7 ? 2 : 1;
      const maxOilDefenseTowers = baseTowerTarget + maxExtraOilTowers;
      if (existingTowers >= maxOilDefenseTowers) return;

      const enemyBaseTargets = this.getEnemyBuildings(gameState).filter(building => building.type === 'base');

      for (const spot of ownedOilSpots) {
          const nearbyEnemyUnits = gameState.units.filter(
              unit => unit.ownerId !== this.playerId && Math.hypot(unit.x - spot.x, unit.y - spot.y) <= 700
          );
          const enemyBaseNearby = enemyBaseTargets.some(target => Math.hypot(target.x - spot.x, target.y - spot.y) <= 1000);
          if (nearbyEnemyUnits.length === 0 && !enemyBaseNearby && this.difficulty < 9) continue;

          const nearbyOwnedIslands = ownedIslands
              .map(island => ({
                  island,
                  dist: Math.hypot(island.x - spot.x, island.y - spot.y)
              }))
              .filter(entry => entry.dist <= entry.island.radius + 420)
              .sort((a, b) => a.dist - b.dist);
          if (nearbyOwnedIslands.length === 0) continue;

          const candidate = nearbyOwnedIslands[0].island;
          const towerNearSpot = candidate.buildings.some(building => {
              if (building.ownerId !== this.playerId || building.type !== 'tower') return false;
              const absX = candidate.x + (building.x || 0);
              const absY = candidate.y + (building.y || 0);
              return Math.hypot(absX - spot.x, absY - spot.y) <= 340;
          });
          if (towerNearSpot) continue;

          if (this.ensureBuilderAndBuild(gameState, candidate, 'tower')) {
              return;
          }
      }
  }

  private manageNavalMineDefence(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (gameState.mapType !== 'islands') return;
      if (this.difficulty < 7) return;

      const ownedOilSpots = (gameState.map.oilSpots || []).filter(spot => (spot as any).ownerId === this.playerId);
      const existingMines = (gameState.map.waterBuildings || []).filter(
          building => building.type === 'naval_mine' && building.ownerId === this.playerId
      );
      const mineCap = this.difficulty >= 10 ? 8 : this.difficulty >= 8 ? 6 : 4;
      if (existingMines.length >= mineCap) return;

      const ships = myUnits
          .filter(unit => unit.type === 'construction_ship' && unit.status !== 'fighting' && !this.usedUnitIds.has(unit.id))
          .sort((left, right) => left.health - right.health);
      if (ships.length === 0) {
          const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
          if (hasReadyDock && this.canAfford(player, 'construction_ship')) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
          }
          return;
      }

      if (!this.canAfford(player, 'naval_mine')) return;

      const enemyThreats = this.getEnemyThreatZones(gameState, true);
      const enemyBase = this.getEnemyBuildings(gameState).find(building => building.type === 'base');
      const enemyWaterUnits = gameState.units.filter(
          unit => unit.ownerId !== this.playerId && ['destroyer', 'pirate_ship', 'ferry', 'construction_ship', 'aircraft_carrier', 'oil_rig'].includes(unit.type)
      );
      const mineAnchors: Array<{ x: number; y: number; radius: number; priority: number; type: string }> = [];

      ownedOilSpots.forEach(spot => {
          mineAnchors.push({
              x: spot.x,
              y: spot.y,
              radius: 95,
              priority: 380,
              type: 'oil'
          });
      });
      this.getBridgeFootholdIslands(gameState, myIslands).forEach(island => {
          island.buildings.forEach(building => {
              if (building.ownerId !== this.playerId || building.isConstructing || building.type !== 'bridge_node') return;
              mineAnchors.push({
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  radius: 88,
                  priority: island.ownerId && island.ownerId !== this.playerId ? 300 : 220,
                  type: 'bridge'
              });
          });
      });
      (gameState.map.waterBuildings || []).forEach(building => {
          if (building.ownerId !== this.playerId || building.isConstructing || building.type !== 'bridge_node') return;
          mineAnchors.push({
              x: building.x || 0,
              y: building.y || 0,
              radius: 92,
              priority: 420,
              type: 'bridge'
          });
      });
      myIslands.forEach(island => {
          island.buildings.forEach(building => {
              if (building.ownerId !== this.playerId || building.isConstructing || building.type !== 'dock') return;
              mineAnchors.push({
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  radius: 130,
                  priority: 320,
                  type: 'dock'
              });
          });
      });

      if (mineAnchors.length === 0) return;

      const sortedAnchors = mineAnchors.sort((left, right) => {
          const leftEnemyDist = enemyBase ? Math.hypot(enemyBase.x - left.x, enemyBase.y - left.y) : 1500;
          const rightEnemyDist = enemyBase ? Math.hypot(enemyBase.x - right.x, enemyBase.y - right.y) : 1500;
          const leftScore = left.priority + Math.max(0, 1100 - leftEnemyDist) * 0.18;
          const rightScore = right.priority + Math.max(0, 1100 - rightEnemyDist) * 0.18;
          return rightScore - leftScore;
      });

      const hasMineNearPoint = (x: number, y: number) => (gameState.map.waterBuildings || []).some(building =>
          building.type === 'naval_mine' &&
          Math.hypot((building.x || 0) - x, (building.y || 0) - y) < (BuildingData.naval_mine?.minSpacing ?? 110)
      );

      for (const anchor of sortedAnchors) {
          const minesNearAnchor = existingMines.filter(
              building => Math.hypot((building.x || 0) - anchor.x, (building.y || 0) - anchor.y) <= 190
          ).length;
          const perAnchorCap = anchor.type === 'bridge' ? 1 : 2;
          if (minesNearAnchor >= perAnchorCap) continue;

          const nearestEnemyShip = enemyWaterUnits.reduce((best, current) => {
              if (!best) return current;
              const bestDist = Math.hypot(best.x - anchor.x, best.y - anchor.y);
              const currentDist = Math.hypot(current.x - anchor.x, current.y - anchor.y);
              return currentDist < bestDist ? current : best;
          }, enemyWaterUnits[0] || null);
          const reference = nearestEnemyShip || enemyBase || { x: gameState.map.width / 2, y: gameState.map.height / 2 };
          const baseAngle = Math.atan2(reference.y - anchor.y, reference.x - anchor.x);
          const candidateAngles = [baseAngle, baseAngle + 0.55, baseAngle - 0.55, baseAngle + 1.1, baseAngle - 1.1];

          for (const angle of candidateAngles) {
              const targetX = anchor.x + Math.cos(angle) * anchor.radius;
              const targetY = anchor.y + Math.sin(angle) * anchor.radius;

              if (hasMineNearPoint(targetX, targetY)) continue;

              const ship = ships.reduce((best, current) => {
                  if (!best) return current;
                  const bestDist = Math.hypot(best.x - targetX, best.y - targetY);
                  const currentDist = Math.hypot(current.x - targetX, current.y - targetY);
                  return currentDist < bestDist ? current : best;
              }, ships[0]);
              if (!this.consumeApm(1)) return;
              const built = gameState.buildStructure(this.playerId, ship.id, 'naval_mine' as any, targetX, targetY);
              if (built) {
                  this.usedUnitIds.add(ship.id);
                  this.markAction(Date.now());
                  this.logEvent('NAVAL_MINE_BUILD', {
                      workerId: ship.id,
                      x: targetX,
                      y: targetY,
                      anchorType: anchor.type
                  });
                  return;
              }

              const approachPoint = this.getThreatAwareApproachPoint(gameState, ship, targetX, targetY, enemyThreats, true);
              const navigableApproachPoint = this.findNearestNavigablePoint(gameState, 'construction_ship', approachPoint.x, approachPoint.y);
              if (navigableApproachPoint) {
                  this.moveUnitSafe(gameState, ship.id, navigableApproachPoint.x, navigableApproachPoint.y);
                  this.usedUnitIds.add(ship.id);
                  return;
              }
          }
      }
  }

  private getQueueDepth(queue?: Array<unknown>): number {
      return Array.isArray(queue) ? queue.length : 0;
  }

  private selectLeastQueuedRoundRobin<T extends { id: string; queueDepth: number }>(key: string, candidates: T[]): T {
      const minQueueDepth = candidates.reduce((min, candidate) => Math.min(min, candidate.queueDepth), Number.POSITIVE_INFINITY);
      const tied = candidates
          .filter(candidate => candidate.queueDepth === minQueueDepth)
          .sort((a, b) => a.id.localeCompare(b.id));
      const cursor = this.recruitSelectionCursor.get(key) || 0;
      const selected = tied[cursor % tied.length];
      this.recruitSelectionCursor.set(key, (cursor + 1) % Math.max(1, tied.length));
      return selected;
  }

  private recruitUnitType(
      gameState: GameState,
      player: Player,
      myIslands: Island[],
      type: string,
      buildingType: string,
      preferredBuildingIds?: string[]
  ): void {
      if (!this.canAfford(player, type)) return;
      const oilCost = UnitData[type]?.cost?.oil ?? 0;
      if (this.mothershipSavingsActive && type !== 'mothership' && oilCost > 0) {
          return;
      }
      const myUnits = gameState.units.filter(unit => unit.ownerId === this.playerId);
      if (this.isBasicInfantryType(type)) {
          const totalBasicInfantry = this.getBasicInfantryCountIncludingQueue(gameState, myIslands, myUnits);
          const infantryCap = Math.min(
              BOT_BASIC_INFANTRY_CAP,
              this.getBasicInfantrySoftCap(gameState, player, myIslands)
          );
          if (totalBasicInfantry >= infantryCap) {
              this.logEvent('PRODUCTION_CAP', {
                  type,
                  cap: infantryCap,
                  group: 'basic_infantry',
                  totalBasicInfantry
              });
              return;
          }
      }
      const combatUnits = myUnits.filter(unit => this.isCombatUnitType(unit.type)).length;
      const phase = this.getMatchPhase();
      const isCombatRecruit =
          !['builder', 'construction_ship', 'oil_seeker', 'ferry'].includes(type);
      const assaultReinforcementThreshold = Math.max(
          this.getCombatUnitMinimum() * 2,
          Math.max(4, this.strategyProfile.openingCombatTarget * 3)
      );
      const emergencyEconomyRecruit =
          type === 'construction_ship' &&
          (gameState.mapType === 'grasslands' || gameState.mapType === 'islands') &&
          !this.hasStableOil(player);
      const highTierAirRecruit =
          this.difficulty >= 8 &&
          phase !== 'EARLY' &&
          ['light_plane', 'heavy_plane'].includes(type) &&
          ['air_base', 'mothership', 'aircraft_carrier'].includes(buildingType);
      const bypassRecruitApm =
          emergencyEconomyRecruit ||
          highTierAirRecruit ||
          (
              isCombatRecruit &&
              (
                  combatUnits < this.getCombatUnitMinimum() ||
                  (phase === 'EARLY' && combatUnits < Math.max(2, this.strategyProfile.openingCombatTarget)) ||
                  (this.debugState?.attackManager?.state === 'ASSAULT' && combatUnits < assaultReinforcementThreshold)
              )
          );

      if (gameState.mapType === 'islands') {
          if (buildingType === 'barracks' || buildingType === 'tank_factory') {
              console.log(`[ISLANDS_RULE] denied production ${type} from ${buildingType} reason=LAND_RECRUITMENT_DISABLED`);
              this.logEvent('ISLANDS_RULE', { action: 'DENY_PRODUCTION', unitType: type, buildingType, reason: 'LAND_RECRUITMENT_DISABLED' });
              return;
          }
      }

      const maxQueueDepth = highTierAirRecruit ? 6 : 5;

      // Check Mobile Bases (Units)
      if (['mothership', 'aircraft_carrier'].includes(buildingType)) {
          const mobileBases = gameState.units
              .filter(u =>
                  u.ownerId === this.playerId &&
                  u.type === buildingType &&
                  this.getQueueDepth(u.recruitmentQueue) < maxQueueDepth
              )
              .map(base => ({
                  id: base.id,
                  queueDepth: this.getQueueDepth(base.recruitmentQueue),
                  base
              }));
          
          if (mobileBases.length > 0) {
              const key = `${buildingType}:${type}:mobile`;
              const selected = this.selectLeastQueuedRoundRobin(key, mobileBases);
              const base = selected.base;
              // Use 'mobile' as islandId or null, GameState handles it if buildingId is provided
              if (!bypassRecruitApm && !this.consumeApm(1)) return;
              gameState.recruitUnit(this.playerId, base.targetIslandId || 'mobile', type, base.id);
              this.logEvent('PRODUCTION_ORDER', { type, buildingId: base.id, source: 'MobileBase' });
              this.markAction(Date.now());
              return;
          }
      }

      const buildingCandidates: Array<{
          id: string;
          queueDepth: number;
          islandId: string;
          buildingId: string;
      }> = [];

      const preferredSet =
          preferredBuildingIds && preferredBuildingIds.length > 0
              ? new Set(preferredBuildingIds)
              : null;

      for (const island of myIslands) {
          island.buildings.forEach(building => {
              if (building.type !== buildingType) return;
              if (building.ownerId !== this.playerId) return;
              if (building.isConstructing) return;
              if (preferredSet && !preferredSet.has(building.id)) return;
              const queueDepth = this.getQueueDepth(building.recruitmentQueue);
              if (queueDepth >= maxQueueDepth) return;
              buildingCandidates.push({
                  id: building.id,
                  queueDepth,
                  islandId: island.id,
                  buildingId: building.id
              });
          });
      }

      if (buildingCandidates.length === 0 && preferredSet) {
          return this.recruitUnitType(gameState, player, myIslands, type, buildingType);
      }

      if (buildingCandidates.length === 0) return;

      const key = `${buildingType}:${type}:building`;
      const selected = this.selectLeastQueuedRoundRobin(key, buildingCandidates);
      if (!bypassRecruitApm && !this.consumeApm(1)) return;
      gameState.recruitUnit(this.playerId, selected.islandId, type, selected.buildingId);
      this.logEvent('PRODUCTION_ORDER', { type, buildingId: selected.buildingId });
      this.markAction(Date.now());
  }
  
  private recruitLandArmy(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      const phase = this.getMatchPhase();
      const oilOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const hasOffshoreOil =
          gameState.mapType === 'grasslands' &&
          (gameState.map.oilSpots || []).some(spot => !this.isOilSpotOnLand(gameState, spot.x, spot.y));
      const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
      const constructionShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'construction_ship');
      const offshoreOilOwned =
          hasOffshoreOil &&
          (gameState.map.oilSpots || []).some(
              spot => !this.isOilSpotOnLand(gameState, spot.x, spot.y) && (spot as any).ownerId === this.playerId
          );
      const offshoreBootstrapPending = hasOffshoreOil && hasReadyDock && !oilOnline && !offshoreOilOwned;
      const shipReserveGold =
          offshoreBootstrapPending && constructionShips === 0 ? (UnitData.construction_ship?.cost?.gold ?? 100) : 0;
      const rigReserveGold = offshoreBootstrapPending ? (BuildingData.oil_rig?.cost?.gold ?? 200) : 0;
      const economyReserveGold = Math.max(shipReserveGold + rigReserveGold, rigReserveGold);
      const currentFactories = myIslands.reduce(
          (count, island) => count + this.countOwnedBuildingsOfType(island, 'tank_factory'),
          0
      );
      const desiredFactories = this.getDesiredFactoryCount(gameState.mapType, oilOnline);
      const factoryShortfall = Math.max(0, desiredFactories - currentFactories);
      const reserveFactoryOil = factoryShortfall > 0 ? Math.min(200, Math.max(50, factoryShortfall * 60)) : 0;
      const soldierCount = myUnits.filter(unit => unit.type === 'soldier').length;
      const rocketeerCount = myUnits.filter(unit => unit.type === 'rocketeer').length;
      const tankCount = myUnits.filter(unit => unit.type === 'tank').length;
      const missileCount = myUnits.filter(unit => unit.type === 'missile_launcher').length;
      const tankCountIncludingQueue = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'tank');
      const missileCountIncludingQueue = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'missile_launcher');
      const basicInfantryCount = this.getBasicInfantryCountIncludingQueue(gameState, myIslands, myUnits);
      const basicInfantrySoftCap = this.getBasicInfantrySoftCap(gameState, player, myIslands);
      const readyAirBaseCount = myIslands.reduce(
          (count, island) =>
              count + island.buildings.filter(
                  building => building.ownerId === this.playerId && building.type === 'air_base' && !building.isConstructing
              ).length,
          0
      );
      const desiredMothershipCount = this.getDesiredMothershipCount(phase, readyAirBaseCount, oilOnline || player.resources.oil >= 600);
      const mothershipCount = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'mothership');
      const mothershipOilCost = UnitData.mothership?.cost?.oil ?? 1000;
      const mothershipGoldCost = UnitData.mothership?.cost?.gold ?? 2000;
      let soldierOrders = 1;
      let rocketeerOrders = 0;
      let tankOrders = 0;
      let missileLauncherOrders = 0;

      if (this.difficulty === 2) {
          soldierOrders = 4;
          rocketeerOrders = oilOnline ? 1 : 0;
          tankOrders = phase === 'EARLY' ? 0 : 1;
      }
      else if (this.difficulty === 3) {
          soldierOrders = 4;
          rocketeerOrders = 2;
          tankOrders = phase === 'EARLY' ? 0 : 1;
      }
      else if (this.difficulty <= 5) {
          soldierOrders = 2;
          rocketeerOrders = 1;
          tankOrders = 1;
      } else if (this.difficulty === 6) {
          soldierOrders = 2;
          rocketeerOrders = 2;
          tankOrders = 2;
          missileLauncherOrders = 1;
      } else if (this.difficulty === 7) {
          soldierOrders = 1;
          rocketeerOrders = 1;
          tankOrders = 3;
          missileLauncherOrders = 2;
      } else if (this.difficulty <= 9) {
          soldierOrders = 0;
          rocketeerOrders = 1;
          tankOrders = 3;
          missileLauncherOrders = 2;
      } else {
          soldierOrders = 0;
          rocketeerOrders = 1;
          tankOrders = 4;
          missileLauncherOrders = 2;
      }

      if (phase === 'MID') {
          if (this.difficulty <= 5) soldierOrders += 1;
          if (this.difficulty >= 3 && this.difficulty <= 6) rocketeerOrders += 1;
          if (this.difficulty >= 5) tankOrders += 1;
          if (this.difficulty >= 7) missileLauncherOrders += 1;
      }
      if (phase === 'LATE') {
          soldierOrders += this.difficulty <= 6 ? 1 : 0;
          if (this.difficulty >= 4 && this.difficulty <= 6) rocketeerOrders += 1;
          if (this.difficulty >= 4) tankOrders += this.difficulty >= 9 ? 2 : 1;
          if (this.difficulty >= 8) missileLauncherOrders += this.difficulty >= 10 ? 2 : 1;
      }

      const airInfrastructureOnline =
          myIslands.some(island => this.countOwnedBuildingsOfType(island, 'air_base') > 0) ||
          myUnits.some(unit => unit.type === 'mothership' || unit.type === 'aircraft_carrier');
      const highTierMothershipPriority =
          this.difficulty >= 9 &&
          readyAirBaseCount > 0 &&
          desiredMothershipCount > mothershipCount;
      if (this.difficulty >= 9 && phase !== 'EARLY' && airInfrastructureOnline) {
          const lowOilForAir = player.resources.oil < (this.difficulty >= 10 ? 300 : 220);
          if (lowOilForAir) {
              missileLauncherOrders = 0;
              tankOrders = 0;
              rocketeerOrders = Math.min(rocketeerOrders, 1);
              soldierOrders = Math.min(soldierOrders, 1);
          } else if (this.difficulty >= 10) {
              soldierOrders = Math.min(soldierOrders, 2);
          }
      }

      if (factoryShortfall > 0 && this.difficulty >= 4) {
          if (this.difficulty >= 8) {
              rocketeerOrders = 0;
          } else {
              rocketeerOrders = Math.min(rocketeerOrders, 1);
          }
      }

      if (currentFactories === 0 && desiredFactories > 0) {
          missileLauncherOrders = 0;
          tankOrders = 0;
      }

      if (this.difficulty >= 7) {
          const armoredCount = tankCount + missileCount;
          if (soldierCount > armoredCount * 2 + 8) {
              soldierOrders = Math.min(soldierOrders, 1);
          }
      }
      if (this.difficulty >= 9 && oilOnline && currentFactories > 0) {
          const antiArmorCount = rocketeerCount + missileCount;
          if (antiArmorCount < Math.max(4, Math.floor((tankCount + soldierCount) * 0.35))) {
              rocketeerOrders += 1;
              if (this.difficulty >= 10) missileLauncherOrders += 1;
          }
      }
      if (offshoreBootstrapPending) {
          soldierOrders = 0;
          rocketeerOrders = 0;
      }

      if (this.difficulty >= 10 && gameState.mapType !== 'islands' && oilOnline) {
          const currentAirBases = myIslands.reduce(
              (count, island) => count + this.countOwnedBuildingsOfType(island, 'air_base'),
              0
          );
          const desiredAirBaseBootstrap = 2;
          if (currentAirBases < desiredAirBaseBootstrap) {
              const missingAirBases = desiredAirBaseBootstrap - currentAirBases;
              const reserveOilForAirBases = missingAirBases * (BuildingData.air_base?.cost?.oil ?? 100);
              const reserveGoldForAirBases = missingAirBases * (BuildingData.air_base?.cost?.gold ?? 400);
              const shouldReserveForAirBases =
                  player.resources.oil <= reserveOilForAirBases + 120 ||
                  player.resources.gold <= reserveGoldForAirBases + 700;
              if (shouldReserveForAirBases) {
                  missileLauncherOrders = 0;
                  tankOrders = 0;
                  rocketeerOrders = Math.min(rocketeerOrders, 1);
              }
          }
      }

      if (this.mothershipSavingsActive) {
          const mothershipOilCost = UnitData.mothership?.cost?.oil ?? 1000;
          const mothershipGoldCost = UnitData.mothership?.cost?.gold ?? 2000;
          const preserveThresholdOil = mothershipOilCost + 120;
          const preserveThresholdGold = mothershipGoldCost + 400;
          if (player.resources.oil < preserveThresholdOil || player.resources.gold < preserveThresholdGold) {
              missileLauncherOrders = 0;
              tankOrders = 0;
              rocketeerOrders = Math.min(rocketeerOrders, 1);
              soldierOrders = Math.min(soldierOrders, 2);
          }
      }

      if (highTierMothershipPriority) {
          const missileEscortCap = this.difficulty >= 10 ? 5 : 4;
          const tankEscortCap =
              this.difficulty >= 10
                  ? (phase === 'EARLY' ? 1 : 2)
                  : (phase === 'EARLY' ? 1 : 2);
          const remainingMissiles = Math.max(0, missileEscortCap - missileCountIncludingQueue);
          const remainingTanks = Math.max(0, tankEscortCap - tankCountIncludingQueue);
          const preserveMothershipBudget =
              this.mothershipSavingsActive ||
              player.resources.oil < mothershipOilCost + 220 ||
              player.resources.gold < mothershipGoldCost + 500;

          soldierOrders = 0;
          rocketeerOrders = 0;

          if (preserveMothershipBudget) {
              tankOrders = 0;
              missileLauncherOrders = 0;
          } else {
              missileLauncherOrders = Math.min(missileLauncherOrders, remainingMissiles);
              tankOrders = Math.min(tankOrders, remainingTanks);
          }
      }

      let remainingBasicInfantryBudget = Math.max(
          0,
          Math.min(BOT_BASIC_INFANTRY_CAP, basicInfantrySoftCap) - basicInfantryCount
      );
      if (remainingBasicInfantryBudget <= 0) {
          soldierOrders = 0;
          rocketeerOrders = 0;
      } else if (this.difficulty >= 7) {
          rocketeerOrders = Math.min(rocketeerOrders, remainingBasicInfantryBudget);
          remainingBasicInfantryBudget -= rocketeerOrders;
          soldierOrders = Math.min(soldierOrders, remainingBasicInfantryBudget);
      } else {
          soldierOrders = Math.min(soldierOrders, remainingBasicInfantryBudget);
          remainingBasicInfantryBudget -= soldierOrders;
          rocketeerOrders = Math.min(rocketeerOrders, remainingBasicInfantryBudget);
      }

      for (let i = 0; i < missileLauncherOrders; i++) {
          if (this.difficulty >= 6 && this.canAfford(player, 'missile_launcher')) {
              this.recruitUnitType(gameState, player, myIslands, 'missile_launcher', 'tank_factory');
          }
      }

      for (let i = 0; i < tankOrders; i++) {
          if (this.difficulty >= 2 && this.canAfford(player, 'tank')) {
              this.recruitUnitType(gameState, player, myIslands, 'tank', 'tank_factory');
          }
      }

      for (let i = 0; i < rocketeerOrders; i++) {
          if (economyReserveGold > 0 && player.resources.gold <= economyReserveGold) break;
          if (reserveFactoryOil > 0 && player.resources.oil <= reserveFactoryOil) break;
          if (this.difficulty >= 2 && this.canAfford(player, 'rocketeer')) {
              this.recruitUnitType(gameState, player, myIslands, 'rocketeer', 'barracks');
          }
      }

      for (let i = 0; i < soldierOrders; i++) {
          if (economyReserveGold > 0 && player.resources.gold <= economyReserveGold) break;
          if (this.canAfford(player, 'soldier')) {
              this.recruitUnitType(gameState, player, myIslands, 'soldier', 'barracks');
          }
      }
  }

  private hasStableOil(_player: Player): boolean {
      return this.oilSecured || this.firstOilOnlineTime !== null;
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
          rigCount += island.buildings.filter(b => (b.type === 'oil_rig' || b.type === 'oil_well') && b.ownerId === this.playerId).length;
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

      const desiredRigs = Math.max(1, this.getDesiredResourceClaims(this.getMatchPhase()));

      if (rigCount >= desiredRigs) {
          this.oilSecured = true;
          return;
      }

      if (this.firstOilOnlineTime && now - this.firstOilOnlineTime > 120000) {
          this.oilSecured = true;
      }
  }

  private shouldBypassBuildThrottle(gameState: GameState, type: string): boolean {
      if (!['barracks', 'tank_factory', 'dock', 'air_base', 'hospital', 'repair_dock'].includes(type)) return false;

      const myIslands = this.getControlledIslands(gameState);
      const player = gameState.players.get(this.playerId);
      if (!player) return false;
      const oilEconomyOnline = this.hasStableOil(player) || this.playerHasOilBuilding(gameState, myIslands);
      const oilStockpileReady =
          player.resources.oil >= (this.difficulty >= 9 ? 600 : this.difficulty >= 7 ? 750 : 900);
      const oilOnline = oilEconomyOnline || oilStockpileReady;
      const phase = this.getMatchPhase();

      if (type === 'barracks') {
          const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'barracks'), 0);
          return current < this.getDesiredBarracksCount(gameState.mapType, oilOnline);
      }

      if (type === 'tank_factory') {
          const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'tank_factory'), 0);
          return current < this.getDesiredFactoryCount(gameState.mapType, oilOnline);
      }

      if (type === 'dock') {
          const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'dock'), 0);
          return current < this.getDesiredDockCount(gameState.mapType, oilOnline);
      }

      if (type === 'hospital') {
          const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'hospital'), 0);
          const target = gameState.mapType === 'islands'
              ? 0
              : this.difficulty >= 10
                  ? (phase === 'EARLY' ? 1 : 2)
                  : this.difficulty >= 7
                      ? (phase === 'LATE' ? 2 : 1)
                      : phase === 'LATE'
                          ? 1 : 0;
          return current < target;
      }

      if (type === 'repair_dock') {
          const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'repair_dock'), 0);
          const target = gameState.mapType === 'islands'
              ? (this.difficulty >= 7 ? 1 : 0)
              : this.difficulty >= 9
                  ? 2
                  : this.difficulty >= 4 ? 1 : 0;
          return current < target;
      }

      const current = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'air_base'), 0);
      return current < this.getDesiredAirBaseCount(gameState.mapType, oilOnline, phase);
  }

  private requiresLocalIslandBuilder(gameState: GameState, type: string): boolean {
      if (gameState.mapType !== 'islands') return false;
      return !['bridge_node', 'naval_mine'].includes(type);
  }

  private getIslandBuilderTransferTarget(
      gameState: GameState,
      island: Island,
      buildSite?: { x: number; y: number }
  ): { x: number; y: number } {
      const baseIsland = this.getOwnedBaseIsland(gameState);
      if (baseIsland && island.id !== baseIsland.id) {
          return this.getIslandsForwardBuilderStagingPoint(gameState, island, baseIsland);
      }

      if (buildSite) {
          return gameState.adjustTarget('builder', buildSite.x, buildSite.y);
      }

      return gameState.adjustTarget('builder', island.x, island.y);
  }

  private ensureBuilderAndBuild(gameState: GameState, island: Island, type: string, x?: number, y?: number): boolean {
      const now = Date.now();
      const bypassAirBaseApm = type === 'air_base' && this.difficulty >= 8 && this.getMatchPhase(now) !== 'EARLY';
      const retryKey = `${island.id}:${type}`;
      const retryUntil = this.buildRetryCooldownUntil.get(retryKey) || 0;
      if (now < retryUntil) return false;
      const bypassBuildThrottle = this.shouldBypassBuildThrottle(gameState, type);
      const requiresLocalBuilder = this.requiresLocalIslandBuilder(gameState, type);
      if (!bypassBuildThrottle && !this.canBuild(now)) return false;

      if (gameState.mapType === 'islands' && (type === 'barracks' || type === 'tank_factory')) {
          console.log(`[ISLANDS_RULE] denied build ${type} reason=LAND_RECRUITMENT_DISABLED`);
          this.logEvent('ISLANDS_RULE', { action: 'DENY_BUILD', buildingType: type, reason: 'LAND_RECRUITMENT_DISABLED' });
          return false;
      }

      const allowedWorkerTypes = new Set(this.getBuildWorkerTypes(type));
      const builderPool = gameState.units.filter(
          u =>
              u.ownerId === this.playerId &&
              allowedWorkerTypes.has(u.type) &&
              u.status !== 'fighting' &&
              !this.usedUnitIds.has(u.id)
      );
      const idleBuilders = builderPool.filter(u => u.status === 'idle');
      const candidateBuilders = idleBuilders.length > 0 ? idleBuilders : builderPool;
      const onIsland = candidateBuilders.filter(b => Math.hypot(b.x - island.x, b.y - island.y) < island.radius + 100);

      if (onIsland.length > 0) {
          const builder = onIsland[0];

          const buildSite = x !== undefined && y !== undefined
              ? { x, y }
              : this.findAutoBuildPosition(gameState, island, type);
          if (!buildSite) {
              this.recordIslandPlacementFailure(island.id, type, now);
              if (!requiresLocalBuilder && type === 'air_base' && (bypassAirBaseApm || this.consumeApm(1))) {
                  const autoBuilt = gameState.buildStructure(this.playerId, island.id, type as any);
                  if (autoBuilt) {
                      this.clearIslandPlacementFailures(island.id);
                      this.buildRetryCooldownUntil.delete(retryKey);
                      this.onBuild(now);
                      this.logEvent('BUILD_ORDER', { type, builderId: builder.id, fallback: 'island_auto_no_site' });
                      this.debugState.intents.push({
                          type: 'build',
                          unitId: builder.id,
                          from: { x: builder.x, y: builder.y },
                          to: { x: island.x, y: island.y },
                          buildType: type
                      });
                      return true;
                  }
              }
              this.buildRetryCooldownUntil.set(retryKey, now + 2200);
              return false;
          }
          if (!bypassAirBaseApm && !this.consumeApm(1)) return false;

          let success = gameState.buildStructure(this.playerId, builder.id, type as any, buildSite.x, buildSite.y);
          if (!success) {
              this.recordIslandPlacementFailure(island.id, type, now);
              if (!requiresLocalBuilder && type === 'air_base' && (bypassAirBaseApm || this.consumeApm(1))) {
                  const autoBuilt = gameState.buildStructure(this.playerId, island.id, type as any);
                  if (autoBuilt) {
                      this.clearIslandPlacementFailures(island.id);
                      this.buildRetryCooldownUntil.delete(retryKey);
                      this.onBuild(now);
                      this.logEvent('BUILD_ORDER', {
                          type,
                          builderId: builder.id,
                          x: buildSite.x,
                          y: buildSite.y,
                          fallback: 'island_auto_after_manual_fail'
                      });
                      this.debugState.intents.push({
                          type: 'build',
                          unitId: builder.id,
                          from: { x: builder.x, y: builder.y },
                          to: { x: island.x, y: island.y },
                          buildType: type
                      });
                      return true;
                  }
              }
              this.moveUnitSafe(gameState, builder.id, buildSite.x, buildSite.y);
              const cooldownMs = type === 'dock' ? 6500 : type === 'bridge_node' ? 700 : 1800;
              this.buildRetryCooldownUntil.set(retryKey, now + cooldownMs);
              return false;
          }

          this.clearIslandPlacementFailures(island.id);
          this.buildRetryCooldownUntil.delete(retryKey);
          this.onBuild(now);
          this.logEvent('BUILD_ORDER', { type, builderId: builder.id, x: buildSite.x, y: buildSite.y });
          this.debugState.intents.push({
              type: 'build',
              unitId: builder.id,
              from: { x: builder.x, y: builder.y },
              to: { x: buildSite.x, y: buildSite.y },
              buildType: type
          });
          return true;
      } else {
          if (!requiresLocalBuilder && type === 'air_base' && (bypassAirBaseApm || this.consumeApm(1))) {
              const autoBuilt = gameState.buildStructure(this.playerId, island.id, type as any);
              if (autoBuilt) {
                  this.clearIslandPlacementFailures(island.id);
                  this.buildRetryCooldownUntil.delete(retryKey);
                  this.onBuild(now);
                  this.logEvent('BUILD_ORDER', { type, builderId: null, fallback: 'island_auto_no_local_builder' });
                  return true;
              }
          }

          const remoteBuildSite = x !== undefined && y !== undefined
              ? { x, y }
              : this.findAutoBuildPosition(gameState, island, type);
          const availableBuilders = gameState.units
              .filter(
                  unit =>
                      unit.ownerId === this.playerId &&
                      allowedWorkerTypes.has(unit.type) &&
                      unit.status !== 'fighting' &&
                      !this.usedUnitIds.has(unit.id)
              );
          if (remoteBuildSite && availableBuilders.length > 0) {
              const nearestBuilder = availableBuilders.reduce((best, candidate) => {
                  if (!best) return candidate;
                  const bestDist = Math.hypot(best.x - remoteBuildSite.x, best.y - remoteBuildSite.y);
                  const candidateDist = Math.hypot(candidate.x - remoteBuildSite.x, candidate.y - remoteBuildSite.y);
                  return candidateDist < bestDist ? candidate : best;
              }, availableBuilders[0]);
              const moveTarget = requiresLocalBuilder
                  ? this.getIslandBuilderTransferTarget(gameState, island, remoteBuildSite)
                  : remoteBuildSite;
              this.moveUnitSafe(gameState, nearestBuilder.id, moveTarget.x, moveTarget.y);
              this.buildRetryCooldownUntil.set(retryKey, now + 1200);
          } else if (!remoteBuildSite) {
              this.recordIslandPlacementFailure(island.id, type, now);
              this.buildRetryCooldownUntil.set(retryKey, now + 2000);
          }

          const ownedIslands = this.getControlledIslands(gameState);
          const ownedUnits = gameState.units.filter(u => u.ownerId === this.playerId);
          const totalBuilders = this.getBuilderCountIncludingQueue(gameState, ownedIslands, ownedUnits);
          const cap =
              gameState.mapType === 'grasslands' && this.difficulty >= 10
                  ? Math.min(this.getBuilderCap(), 4)
                  : this.getBuilderCap();
          if (totalBuilders >= cap) return false;
          const base = island.buildings.find(b => b.type === 'base' && b.ownerId === this.playerId);
          if (type === 'bridge_node' && gameState.mapType === 'islands') {
              const hasReadyDock = ownedIslands.some(candidate => this.islandHasReadyOwnedBuildingOfType(candidate, 'dock'));
              if (hasReadyDock && this.canAfford(gameState.players.get(this.playerId)!, 'construction_ship')) {
                  this.recruitUnitType(gameState, gameState.players.get(this.playerId)!, ownedIslands, 'construction_ship', 'dock');
                  return true;
              }
          }
          if (base && this.canAfford(gameState.players.get(this.playerId)!, 'builder')) {
              this.recruitUnitType(gameState, gameState.players.get(this.playerId)!, [island], 'builder', 'base');
          }
          return false;
      }
  }

  private shouldDelayBaseDefencesOpening(gameState: GameState, myIslands: Island[], myUnits: Unit[], now: number): boolean {
      const elapsedMs = now - this.startTime;
      const phase = this.getMatchPhase(now);
      const readyBarracks = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'barracks'));
      const readyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
      const combatUnits = myUnits.filter(u => this.isCombatUnitType(u.type)).length;
      const constructionShips = myUnits.filter(u => u.type === 'construction_ship').length;
      const navalCombat = myUnits.filter(u => ['destroyer', 'pirate_ship', 'aircraft_carrier'].includes(u.type)).length;
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      const ownedMines = this.getOwnedMineCount(myIslands);
      const desiredClaims = Math.max(1, this.getDesiredResourceClaims(phase));
      const claimedEconomy = ownedMines + ownedOilStructures;
      const economyReady = claimedEconomy >= desiredClaims || elapsedMs > 90000;

      if (gameState.mapType === 'desert') {
          return (!economyReady || !readyBarracks || combatUnits < this.strategyProfile.openingCombatTarget) && elapsedMs < 120000;
      }

      if (gameState.mapType === 'grasslands') {
          if (this.difficulty >= 10) {
              return false;
          }
          if (this.difficulty >= 9) {
              const requiredOpeningCombat = Math.min(4, this.strategyProfile.openingCombatTarget);
              return (!economyReady || !readyBarracks || combatUnits < requiredOpeningCombat) && elapsedMs < 30000;
          }
          if (this.difficulty >= 7) {
              const requiredOpeningCombat = Math.min(4, this.strategyProfile.openingCombatTarget);
              return (!economyReady || !readyBarracks || combatUnits < requiredOpeningCombat) && elapsedMs < 45000;
          }
          if (this.difficulty === 3) {
              const requiredOpeningCombat = Math.min(2, this.strategyProfile.openingCombatTarget);
              return (!economyReady || !readyBarracks || combatUnits < requiredOpeningCombat) && elapsedMs < 60000;
          }
          return (!economyReady || !readyBarracks || combatUnits < this.strategyProfile.openingCombatTarget) && elapsedMs < 120000;
      }

      if (gameState.mapType === 'islands') {
          const navalEconomyOnline = readyDock && (constructionShips > 0 || ownedOilStructures > 0);
          return (!economyReady || !navalEconomyOnline || navalCombat < this.strategyProfile.openingFleetTarget) && elapsedMs < 120000;
      }

      return false;
  }

  private isOilSpotOnLand(gameState: GameState, x: number, y: number): boolean {
      return gameState.map.islands.some(island => {
          if (island.points) return MapGenerator.isPointInPolygon(x, y, island.points);
          return Math.hypot(x - island.x, y - island.y) <= island.radius;
      });
  }

  private hasBridgeBetweenIslands(gameState: GameState, islandAId: string, islandBId: string): boolean {
      const path = gameState.findIslandPath(islandAId, islandBId);
      return Array.isArray(path) && path.length > 1;
  }

  private getDirectionalBridgeNode(sourceIsland: Island, targetIsland: Island): any | null {
      const desiredAngle = Math.atan2(targetIsland.y - sourceIsland.y, targetIsland.x - sourceIsland.x);
      const nodes = sourceIsland.buildings.filter(
          building => building.type === 'bridge_node' && building.ownerId === this.playerId
      );
      if (nodes.length === 0) return null;

      let best: any = nodes[0];
      let bestDelta = Number.POSITIVE_INFINITY;
      nodes.forEach(node => {
          const absX = sourceIsland.x + (node.x || 0);
          const absY = sourceIsland.y + (node.y || 0);
          const nodeAngle = Math.atan2(absY - sourceIsland.y, absX - sourceIsland.x);
          const delta = Math.abs(Math.atan2(Math.sin(nodeAngle - desiredAngle), Math.cos(nodeAngle - desiredAngle)));
          if (delta < bestDelta) {
              bestDelta = delta;
              best = node;
          }
      });
      return best;
  }

  private getBridgeNodePlacement(gameState: GameState, sourceIsland: Island, targetIsland: Island): { x: number; y: number } {
      const angle = Math.atan2(targetIsland.y - sourceIsland.y, targetIsland.x - sourceIsland.x);
      const inwardClearance = 24;
      if (sourceIsland.points && sourceIsland.points.length > 2) {
          const probeX = sourceIsland.x + Math.cos(angle) * (sourceIsland.radius + 120);
          const probeY = sourceIsland.y + Math.sin(angle) * (sourceIsland.radius + 120);
          const edge = MapGenerator.getClosestPointOnPolygon(probeX, probeY, sourceIsland.points);
          return {
              x: edge.x - Math.cos(angle) * inwardClearance,
              y: edge.y - Math.sin(angle) * inwardClearance
          };
      }

      const edgeRadius = Math.max(18, sourceIsland.radius - inwardClearance);
      return {
          x: sourceIsland.x + Math.cos(angle) * edgeRadius,
          y: sourceIsland.y + Math.sin(angle) * edgeRadius
      };
  }

  private getOwnedBridgeNodeNearPoint(
      gameState: GameState,
      x: number,
      y: number,
      maxDist: number = 70
  ): { id: string; x: number; y: number; isConstructing?: boolean } | null {
      const candidates: Array<{ id: string; x: number; y: number; isConstructing?: boolean }> = [];

      gameState.map.islands.forEach(island => {
          island.buildings.forEach(building => {
              if (building.type !== 'bridge_node' || building.ownerId !== this.playerId) return;
              candidates.push({
                  id: building.id,
                  x: island.x + (building.x || 0),
                  y: island.y + (building.y || 0),
                  isConstructing: building.isConstructing
              });
          });
      });

      (gameState.map.waterBuildings || []).forEach(building => {
          if (building.type !== 'bridge_node' || building.ownerId !== this.playerId) return;
          candidates.push({
              id: building.id,
              x: building.x || 0,
              y: building.y || 0,
              isConstructing: building.isConstructing
          });
      });

      let best: { id: string; x: number; y: number; isConstructing?: boolean } | null = null;
      let bestDist = maxDist;
      candidates.forEach(candidate => {
          const dist = Math.hypot(candidate.x - x, candidate.y - y);
          if (dist > bestDist) return;
          best = candidate;
          bestDist = dist;
      });

      return best;
  }

  private areBridgeNodesDirectlyConnected(gameState: GameState, nodeAId: string, nodeBId: string): boolean {
      return gameState.map.bridges.some(bridge =>
          bridge.type === 'bridge' &&
          (
              (bridge.nodeAId === nodeAId && bridge.nodeBId === nodeBId) ||
              (bridge.nodeAId === nodeBId && bridge.nodeBId === nodeAId)
          )
      );
  }

  private resolveBridgeChainWaterPoint(
      gameState: GameState,
      start: { x: number; y: number },
      end: { x: number; y: number },
      t: number
  ): { x: number; y: number } | null {
      const baseX = start.x + (end.x - start.x) * t;
      const baseY = start.y + (end.y - start.y) * t;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;
      const offsets = [0, 36, -36, 72, -72, 110, -110, 150, -150];

      for (const offset of offsets) {
          const candidateX = baseX + nx * offset;
          const candidateY = baseY + ny * offset;
          if (this.isOilSpotOnLand(gameState, candidateX, candidateY)) continue;
          if (!gameState.isValidPosition(candidateX, candidateY, 'construction_ship')) continue;
          return { x: candidateX, y: candidateY };
      }

      return null;
  }

  private getAdaptiveBridgeSegmentLimit(): number {
      return Math.min(
          780,
          this.difficulty >= 10 ? 460 :
          this.difficulty >= 9 ? 520 :
          this.difficulty >= 8 ? 580 :
          640
      );
  }

  private getAdaptiveBridgeSplitPatterns(): number[][] {
      return [
          [0.5],
          [1 / 3, 2 / 3],
          [0.25, 0.5, 0.75],
          [0.2, 0.4, 0.6, 0.8]
      ];
  }

  private areBridgePlanPointsNear(
      left: { x: number; y: number },
      right: { x: number; y: number },
      tolerance: number = 24
  ): boolean {
      return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance;
  }

  private buildAdaptiveBridgeSegmentPlan(
      gameState: GameState,
      start: { x: number; y: number; island?: Island },
      end: { x: number; y: number; island?: Island },
      depth: number = 0
  ): Array<{ x: number; y: number; island?: Island }> | null {
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      const maxSegmentLength = this.getAdaptiveBridgeSegmentLimit();

      if (dist <= maxSegmentLength) {
          return [end];
      }

      if (depth >= 7) {
          return null;
      }

      for (const splitPattern of this.getAdaptiveBridgeSplitPatterns()) {
          const splitPoints: Array<{ x: number; y: number }> = [];
          let patternFailed = false;

          for (const t of splitPattern) {
              const point = this.resolveBridgeChainWaterPoint(gameState, start, end, t);
              if (!point) {
                  patternFailed = true;
                  break;
              }

              const duplicatePoint =
                  this.areBridgePlanPointsNear(point, start) ||
                  this.areBridgePlanPointsNear(point, end) ||
                  splitPoints.some(existing => this.areBridgePlanPointsNear(existing, point));
              if (duplicatePoint) {
                  patternFailed = true;
                  break;
              }

              splitPoints.push(point);
          }

          if (patternFailed || splitPoints.length === 0) continue;

          const checkpoints: Array<{ x: number; y: number; island?: Island }> = [
              start,
              ...splitPoints,
              end
          ];
          const planned: Array<{ x: number; y: number; island?: Island }> = [];
          let segmentFailed = false;

          for (let index = 0; index < checkpoints.length - 1; index++) {
              const segmentPlan = this.buildAdaptiveBridgeSegmentPlan(
                  gameState,
                  checkpoints[index],
                  checkpoints[index + 1],
                  depth + 1
              );
              if (!segmentPlan) {
                  segmentFailed = true;
                  break;
              }
              planned.push(...segmentPlan);
          }

          if (!segmentFailed) {
              return planned;
          }
      }

      return null;
  }

  private buildIslandBridgeChainPlan(
      gameState: GameState,
      sourceIsland: Island,
      targetIsland: Island
  ): Array<{ x: number; y: number; island?: Island }> | null {
      const sourceNodePos = this.getBridgeNodePlacement(gameState, sourceIsland, targetIsland);
      const targetNodePos = this.getBridgeNodePlacement(gameState, targetIsland, sourceIsland);
      const span = Math.hypot(targetNodePos.x - sourceNodePos.x, targetNodePos.y - sourceNodePos.y);
      if (span < 120) return null;
      const start = { x: sourceNodePos.x, y: sourceNodePos.y, island: sourceIsland };
      const end = { x: targetNodePos.x, y: targetNodePos.y, island: targetIsland };
      const segmentPlan = this.buildAdaptiveBridgeSegmentPlan(gameState, start, end);
      if (!segmentPlan) return null;

      return [start, ...segmentPlan];
  }

  private manageIslandsBridgeChainExpansion(
      gameState: GameState,
      player: Player,
      myIslands: Island[],
      myUnits: Unit[]
  ): boolean {
      if (gameState.mapType !== 'islands' || this.difficulty < 7) return false;
      if (myIslands.length === 0) return false;

      const elapsedMs = Date.now() - this.startTime;
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      const totalOilSpots = Math.max(1, gameState.map.oilSpots.length);
      const ownedOilRatio = ownedOilStructures / totalOilSpots;
      const allNeutralOilClaimed = gameState.map.oilSpots.every(spot => !!(spot as any).ownerId);
      const midGameMs = 180000;
      const bridgeExpansionUrgent = this.shouldForceIslandsBridgeExpansion(gameState, player, myIslands);
      const economyReady =
          ownedOilRatio >= 0.75 ||
          (allNeutralOilClaimed && ownedOilRatio >= 0.5) ||
          elapsedMs >= midGameMs;
      if (!economyReady && !bridgeExpansionUrgent) return false;

      const enemyBase = this.getEnemyBuildings(gameState).find(building => building.type === 'base');
      const enemyBaseIsland = gameState.map.islands.find(island =>
          island.buildings.some(building => building.type === 'base' && building.ownerId && building.ownerId !== this.playerId)
      );
      const canPressureEnemyBridgeheads = this.difficulty >= 9 && (elapsedMs >= 210000 || (bridgeExpansionUrgent && ownedOilStructures > 0));
      const bridgeSources = this.getBridgeExpansionSourceIslands(gameState, myIslands);

      let bestPlan: {
          source: Island;
          target: Island;
          score: number;
          nodes: Array<{ x: number; y: number; island?: Island }>;
      } | null = null;

      bridgeSources.forEach(source => {
          gameState.map.islands.forEach(target => {
              if (source.id === target.id) return;
              if (this.hasBridgeBetweenIslands(gameState, source.id, target.id)) return;
              if (target.ownerId && target.ownerId !== this.playerId && !canPressureEnemyBridgeheads) return;
              if (Math.hypot(target.x - source.x, target.y - source.y) <= target.radius + source.radius + 70) return;

              const nodes = this.buildIslandBridgeChainPlan(gameState, source, target);
              if (!nodes) return;

              const nearbyOil = (gameState.map.oilSpots || []).filter(
                  spot => Math.hypot(spot.x - target.x, spot.y - target.y) < target.radius + 210
              ).length;
              const buildRoom = Math.max(0, target.radius * 2 - target.buildings.length * 18);
              const enemyBaseBonus = enemyBaseIsland && target.id === enemyBaseIsland.id ? 320 : 0;
              const enemyOwnedBonus = target.ownerId && target.ownerId !== this.playerId ? 220 : 0;
              const sourceBaseBonus = source.buildings.some(building => building.type === 'base' && building.ownerId === this.playerId) ? 70 : 0;
              const spanPenalty = nodes.length * 75 + Math.hypot(source.x - target.x, source.y - target.y) * 0.12;
              const pressureBonus = enemyBase
                  ? Math.max(0, 1100 - Math.hypot(target.x - enemyBase.x, target.y - enemyBase.y)) * 0.24
                  : 0;
              const expansionReliefBonus = bridgeExpansionUrgent
                  ? (this.islandHasBuildSpaceForType(gameState, target, 'air_base') ? 260 : 0) +
                    (this.islandHasBuildSpaceForType(gameState, target, 'dock') ? 180 : 0) +
                    buildRoom * 1.15 +
                    (!target.ownerId ? 160 : target.ownerId === this.playerId ? 100 : 0)
                  : 0;
              const score =
                  nearbyOil * 180 +
                  buildRoom * 1.4 +
                  enemyBaseBonus +
                  enemyOwnedBonus +
                  sourceBaseBonus +
                  pressureBonus -
                  0 +
                  expansionReliefBonus -
                  spanPenalty +
                  (!target.ownerId ? 140 : target.ownerId === this.playerId ? 40 : 0);

              if (!bestPlan || score > bestPlan.score) {
                  bestPlan = { source, target, score, nodes };
              }
          });
      });

      if (!bestPlan) return false;
      const selectedPlan = bestPlan as {
          source: Island;
          target: Island;
          score: number;
          nodes: Array<{ x: number; y: number; island?: Island }>;
      };

      const readyNodes = selectedPlan.nodes.map((point: { x: number; y: number }) =>
          this.getOwnedBridgeNodeNearPoint(gameState, point.x, point.y)
      );

      for (let index = 0; index < selectedPlan.nodes.length; index++) {
          if (readyNodes[index]) continue;
          if (!this.canAfford(player, 'bridge_node')) return true;

          const point = selectedPlan.nodes[index];
          const shipAction = this.manageConstructionShipBridgeBuild(gameState, player, myUnits, myIslands, point);
          if (shipAction) {
              this.logEvent('BRIDGE_CHAIN_PLAN', {
                  sourceIsland: selectedPlan.source.id,
                  targetIsland: selectedPlan.target.id,
                  segmentIndex: index,
                  x: point.x,
                  y: point.y
              });
              return true;
          }

          if (point.island && point.island.ownerId === this.playerId) {
              this.ensureBuilderAndBuild(gameState, point.island, 'bridge_node', point.x, point.y);
              return true;
          }

          return false;
      }

      if (readyNodes.some((node: { isConstructing?: boolean } | null) => node?.isConstructing)) return true;

      for (let index = 0; index < readyNodes.length - 1; index++) {
          const nodeA = readyNodes[index];
          const nodeB = readyNodes[index + 1];
          if (!nodeA || !nodeB) return true;
          if (this.areBridgeNodesDirectlyConnected(gameState, nodeA.id, nodeB.id)) continue;
          if (!this.consumeApm(1)) return true;

          gameState.connectNodes(this.playerId, nodeA.id, nodeB.id);
          this.logEvent('BRIDGE_CHAIN_CONNECT', {
              sourceIsland: selectedPlan.source.id,
              targetIsland: selectedPlan.target.id,
              segmentIndex: index,
              nodeA: nodeA.id,
              nodeB: nodeB.id
          });
          this.markAction(Date.now());
          return true;
      }

      return false;
  }

  private findNearestNavigablePoint(
      gameState: GameState,
      unitType: string,
      x: number,
      y: number,
      radii: number[] = [35, 55, 75, 95, 120, 150, 180],
      samples: number = 24
  ): { x: number; y: number } | null {
      if (gameState.isValidPosition(x, y, unitType)) {
          return { x, y };
      }

      for (const radius of radii) {
          for (let i = 0; i < samples; i++) {
              const angle = (i / samples) * Math.PI * 2;
              const tx = x + Math.cos(angle) * radius;
              const ty = y + Math.sin(angle) * radius;
              if (tx < 0 || tx > gameState.map.width || ty < 0 || ty > gameState.map.height) continue;
              if (gameState.isValidPosition(tx, ty, unitType)) {
                  return { x: tx, y: ty };
              }
          }
      }

      return null;
  }

  private getClosestIdleBuilderToPoint(myUnits: Unit[], x: number, y: number): Unit | null {
      const candidates = myUnits.filter(
          unit => unit.type === 'builder' && unit.status !== 'fighting' && !this.usedUnitIds.has(unit.id)
      );
      if (candidates.length === 0) return null;

      return candidates.reduce((best, candidate) => {
          if (!best) return candidate;
          const bestDist = Math.hypot(best.x - x, best.y - y);
          const candidateDist = Math.hypot(candidate.x - x, candidate.y - y);
          return candidateDist < bestDist ? candidate : best;
      }, candidates[0]);
  }

  private getBuildWorkerTypes(type: string): string[] {
      if (type === 'bridge_node' || type === 'naval_mine') {
          return ['builder', 'construction_ship'];
      }
      return ['builder'];
  }

  private manageConstructionShipBridgeBuild(
      gameState: GameState,
      player: Player,
      myUnits: Unit[],
      myIslands: Island[],
      nodePos: { x: number; y: number }
  ): boolean {
      const ships = myUnits
          .filter(unit => unit.type === 'construction_ship' && unit.status !== 'fighting' && !this.usedUnitIds.has(unit.id))
          .sort((left, right) =>
              Math.hypot(left.x - nodePos.x, left.y - nodePos.y) - Math.hypot(right.x - nodePos.x, right.y - nodePos.y)
          );
      const ship = ships[0];

      if (!ship) {
          const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
          if (hasReadyDock && this.canAfford(player, 'construction_ship')) {
              this.recruitUnitType(gameState, player, myIslands, 'construction_ship', 'dock');
              return true;
          }
          return false;
      }

      if (!this.consumeApm(1)) return false;
      const built = gameState.buildStructure(this.playerId, ship.id, 'bridge_node' as any, nodePos.x, nodePos.y);
      if (built) {
          this.usedUnitIds.add(ship.id);
          this.markAction(Date.now());
          this.logEvent('BRIDGE_NODE_BUILD', { workerId: ship.id, method: 'construction_ship', x: nodePos.x, y: nodePos.y });
          return true;
      }

      const approachPoint = this.findNearestNavigablePoint(gameState, 'construction_ship', nodePos.x, nodePos.y);
      if (!approachPoint) return false;

      this.moveUnitSafe(gameState, ship.id, approachPoint.x, approachPoint.y);
      this.usedUnitIds.add(ship.id);
      return true;
  }

  private manageBridgeFerryTransport(
      gameState: GameState,
      player: Player,
      source: Island,
      targetNodePos: { x: number; y: number },
      sourceNodePos: { x: number; y: number },
      myUnits: Unit[],
      myIslands: Island[]
  ): boolean {
      const builderRange = 400;
      const builderNearTarget = myUnits.some(
          unit => unit.type === 'builder' && Math.hypot(unit.x - targetNodePos.x, unit.y - targetNodePos.y) <= builderRange
      );
      if (builderNearTarget) return false;

      const unclaimedOffshoreOilExists =
          gameState.mapType === 'grasslands' &&
          (gameState.map.oilSpots || []).some(
              spot => !this.isOilSpotOnLand(gameState, spot.x, spot.y) && !(spot as any).ownerId
          );
      const offshoreBootstrapShips = this.countUnitsIncludingQueue(gameState, myIslands, myUnits, 'construction_ship');
      if (unclaimedOffshoreOilExists && offshoreBootstrapShips === 0) {
          return false;
      }

      const ferries = myUnits.filter(unit => unit.type === 'ferry');
      let ferry = ferries.find(unit => (unit.cargo || []).some(cargo => cargo.type === 'builder' && cargo.ownerId === this.playerId)) || ferries[0];

      if (!ferry) {
          const hasReadyDock = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'dock'));
          if (!hasReadyDock) {
              if (this.canAfford(player, 'dock')) {
                  this.ensureBuilderAndBuild(gameState, source, 'dock');
                  return true;
              }
              return false;
          }

          if (this.canAfford(player, 'ferry')) {
              this.recruitUnitType(gameState, player, myIslands, 'ferry', 'dock');
              return true;
          }
          return false;
      }

      const loadedBuilder = (ferry.cargo || []).find(cargo => cargo.type === 'builder' && cargo.ownerId === this.playerId);
      if (!loadedBuilder) {
          const builder = this.getClosestIdleBuilderToPoint(myUnits, sourceNodePos.x, sourceNodePos.y);
          if (!builder) return false;

          const ferryPickupPoint = this.findNearestNavigablePoint(gameState, 'ferry', builder.x, builder.y);
          if (ferryPickupPoint && Math.hypot(ferry.x - ferryPickupPoint.x, ferry.y - ferryPickupPoint.y) > 90) {
              this.moveUnitSafe(gameState, ferry.id, ferryPickupPoint.x, ferryPickupPoint.y);
          }

          const builderDist = Math.hypot(builder.x - ferry.x, builder.y - ferry.y);
          if (builderDist > 85) {
              this.moveUnitSafe(gameState, builder.id, ferry.x, ferry.y);
              return true;
          }

          if (!this.consumeApm(1)) return false;
          gameState.loadUnits(this.playerId, ferry.id, [builder.id]);
          this.usedUnitIds.add(ferry.id);
          return true;
      }

      const ferryDropPoint = this.findNearestNavigablePoint(gameState, 'ferry', targetNodePos.x, targetNodePos.y);
      if (!ferryDropPoint) return false;

      const dropDist = Math.hypot(ferry.x - ferryDropPoint.x, ferry.y - ferryDropPoint.y);
      if (dropDist > (ferry.range || 100) - 8) {
          this.moveUnitSafe(gameState, ferry.id, ferryDropPoint.x, ferryDropPoint.y);
          return true;
      }

      if (!this.consumeApm(1)) return false;
      gameState.unloadUnits(this.playerId, ferry.id, targetNodePos.x, targetNodePos.y);
      this.usedUnitIds.add(ferry.id);
      return true;
  }

  private manageLandBridgeExpansion(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (!['grasslands', 'islands'].includes(gameState.mapType)) return;
      if (myIslands.length === 0) return;
      const builders = myUnits.filter(unit => unit.type === 'builder');
      const constructionShips = myUnits.filter(unit => unit.type === 'construction_ship');
      if (builders.length === 0 && constructionShips.length === 0) return;

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return;
      const elapsedMs = Date.now() - this.startTime;
      const readyBarracks = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'barracks'));
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);

      if (gameState.mapType === 'islands' && this.difficulty >= 7) {
          if (this.hasUnsettledIslandsBridgeFoothold(gameState, myIslands)) return;

          const handledChainExpansion = this.manageIslandsBridgeChainExpansion(gameState, player, myIslands, myUnits);
          if (handledChainExpansion) return;

          const totalOilSpots = Math.max(1, gameState.map.oilSpots.length);
          const ownedOilRatio = ownedOilStructures / totalOilSpots;
          const allNeutralOilClaimed = gameState.map.oilSpots.every(spot => !!(spot as any).ownerId);
          const bridgeExpansionUrgent = this.shouldForceIslandsBridgeExpansion(gameState, player, myIslands);
          const economyReady =
              ownedOilRatio >= 0.75 ||
              (allNeutralOilClaimed && ownedOilRatio >= 0.5) ||
              elapsedMs >= 180000;
          if (!economyReady && !bridgeExpansionUrgent) return;
      }

      if (gameState.mapType === 'grasslands') {
          // Keep opening pressure on economy/army first, then expand bridge network aggressively.
          if (this.difficulty <= 3 && !readyBarracks && elapsedMs < 30000) return;
          if (this.difficulty >= 8 && ownedOilStructures <= 0 && elapsedMs < 12000) return;
      }
      const canPressureEnemyBridgeheads =
          gameState.mapType === 'islands' &&
          this.difficulty >= 9 &&
          (ownedOilStructures > 0 || elapsedMs >= 90000);

      const enemyBase = this.getEnemyBuildings(gameState).find(building => building.type === 'base');
      const enemyBaseIsland = gameState.map.islands.find(island =>
          island.buildings.some(building => building.type === 'base' && building.ownerId && building.ownerId !== this.playerId)
      );
      const hasEnemyObjective = !!enemyBase && !!enemyBaseIsland;
      const pathFn = (gameState as any).findIslandPath;
      const getIslandPath = (fromIslandId: string, toIslandId: string): string[] | null => {
          if (typeof pathFn !== 'function') return null;
          const path = pathFn.call(gameState, fromIslandId, toIslandId);
          return Array.isArray(path) ? (path as string[]) : null;
      };

      if (hasEnemyObjective && enemyBaseIsland) {
          const existingPath = getIslandPath(baseIsland.id, enemyBaseIsland.id);
          if (existingPath && existingPath.length > 0) return;
      }

      const objectiveX = enemyBase?.x ?? gameState.map.width / 2;
      const objectiveY = enemyBase?.y ?? gameState.map.height / 2;
      const getBridgeTargetAccess = (sourceIsland: Island, targetIsland: Island) => {
          const targetNodePos = this.getBridgeNodePlacement(gameState, targetIsland, sourceIsland);
          const builderInRange = [...builders, ...constructionShips].some(
              builder => Math.hypot(builder.x - targetNodePos.x, builder.y - targetNodePos.y) <= 400
          );
          const landOverlap =
              Math.hypot(targetIsland.x - sourceIsland.x, targetIsland.y - sourceIsland.y) <=
              targetIsland.radius + sourceIsland.radius + 70;
          return {
              targetNodePos,
              builderInRange,
              landOverlap,
              ferryRequired: !builderInRange && !landOverlap
          };
      };

      const candidateTargets = gameState.map.islands.filter(island => {
          if (gameState.mapType === 'islands') {
              return !island.ownerId || island.ownerId === this.playerId || canPressureEnemyBridgeheads;
          }
          if (island.ownerId && island.ownerId !== this.playerId) return false;
          return true;
      });
      if (candidateTargets.length === 0) return;
      const bridgeSources = this.getBridgeExpansionSourceIslands(gameState, myIslands);

      let bestPair: {
          source: Island;
          target: Island;
          score: number;
          targetNodePos: { x: number; y: number };
          sourceNodePos: { x: number; y: number };
          ferryRequired: boolean;
      } | null = null;
      bridgeSources.forEach(source => {
          candidateTargets.forEach(target => {
              if (source.id === target.id) return;
              if (this.hasBridgeBetweenIslands(gameState, source.id, target.id)) return;
              const access = getBridgeTargetAccess(source, target);
              if (access.landOverlap) return;
              const existingPairPath = getIslandPath(source.id, target.id);
              if (existingPairPath && existingPairPath.length > 1) return;
              const sourceNodePos = this.getBridgeNodePlacement(gameState, source, target);
              if (access.ferryRequired && target.ownerId && target.ownerId !== this.playerId && !canPressureEnemyBridgeheads) return;

              const span = Math.hypot(source.x - target.x, source.y - target.y);
              if (span < 120 || span > 760) return;

              const sourceObjectiveDist = Math.hypot(source.x - objectiveX, source.y - objectiveY);
              const targetObjectiveDist = Math.hypot(target.x - objectiveX, target.y - objectiveY);
              if (hasEnemyObjective && targetObjectiveDist >= sourceObjectiveDist - 20) return;

              const nearbyOil = (gameState.map.oilSpots || []).filter(
                  spot => Math.hypot(spot.x - target.x, spot.y - target.y) < target.radius + 180
              ).length;
              const builderCoverage = [...builders, ...constructionShips]
                  .filter(builder => Math.hypot(builder.x - target.x, builder.y - target.y) < target.radius + 220).length;
              const closestConnectionBoost = Math.max(0, 900 - span);
              const enemyBridgeheadBonus = target.ownerId && target.ownerId !== this.playerId ? 240 : 0;
              const enemyBaseBridgeBonus = enemyBaseIsland && target.id === enemyBaseIsland.id ? 260 : 0;
              const ferryPenalty = access.ferryRequired ? (target.ownerId && target.ownerId !== this.playerId ? 80 : 220) : 0;
              const score = hasEnemyObjective
                  ? (sourceObjectiveDist - targetObjectiveDist) * 1.8 + nearbyOil * 120 + builderCoverage * 40 + closestConnectionBoost - span * 0.35 - ferryPenalty + enemyBridgeheadBonus + enemyBaseBridgeBonus + (target.ownerId === this.playerId ? 20 : 60)
                  : nearbyOil * 130 + builderCoverage * 35 + closestConnectionBoost - span * 0.3 - ferryPenalty + enemyBridgeheadBonus + enemyBaseBridgeBonus + (target.ownerId === this.playerId ? 40 : 80);

              if (!bestPair || score > bestPair.score) {
                  bestPair = {
                      source,
                      target,
                      score,
                      targetNodePos: access.targetNodePos,
                      sourceNodePos,
                      ferryRequired: access.ferryRequired
                  };
              }
          });
      });

      if (!bestPair) return;
      const selectedPair = bestPair as {
          source: Island;
          target: Island;
          score: number;
          targetNodePos: { x: number; y: number };
          sourceNodePos: { x: number; y: number };
          ferryRequired: boolean;
      };
      const source = selectedPair.source;
      const target = selectedPair.target;
      const sourceNodePos = selectedPair.sourceNodePos;
      const targetNodePos = selectedPair.targetNodePos;

      const sourceNode = this.getDirectionalBridgeNode(source, target);
      const targetNode = this.getDirectionalBridgeNode(target, source);

      if (!sourceNode && this.canAfford(player, 'bridge_node')) {
          if (gameState.mapType === 'islands') {
              const shipAction = this.manageConstructionShipBridgeBuild(gameState, player, myUnits, myIslands, sourceNodePos);
              if (shipAction) return;
          }
          this.ensureBuilderAndBuild(gameState, source, 'bridge_node', sourceNodePos.x, sourceNodePos.y);
          return;
      }

      if (!targetNode && gameState.mapType === 'islands' && this.canAfford(player, 'bridge_node')) {
          const shipAction = this.manageConstructionShipBridgeBuild(gameState, player, myUnits, myIslands, targetNodePos);
          if (shipAction) return;
      }

      if (!targetNode && selectedPair.ferryRequired) {
          const ferryAction = this.manageBridgeFerryTransport(
              gameState,
              player,
              source,
              targetNodePos,
              sourceNodePos,
              myUnits,
              myIslands
          );
          if (ferryAction) return;
      }

      if (!targetNode && this.canAfford(player, 'bridge_node')) {
          this.ensureBuilderAndBuild(gameState, target, 'bridge_node', targetNodePos.x, targetNodePos.y);
          return;
      }

      if (!sourceNode || !targetNode) return;
      if (sourceNode.isConstructing || targetNode.isConstructing) return;
      if (this.hasBridgeBetweenIslands(gameState, source.id, target.id)) return;
      if (!this.consumeApm(1)) return;

      gameState.connectNodes(this.playerId, sourceNode.id, targetNode.id);
      this.logEvent('BRIDGE_CONNECT', {
          fromIsland: source.id,
          toIsland: target.id,
          nodeA: sourceNode.id,
          nodeB: targetNode.id
      });
      this.markAction(Date.now());
  }
  
  private findNearestUnoccupiedOil(gameState: GameState, x: number, y: number, allowHidden: boolean) {
       let best = null;
       let minDist = Infinity;
       gameState.map.oilSpots.forEach(s => {
           if ((s as any).occupiedBy) return;
           if (!allowHidden && !this.isOilSpotVisible(s)) return;
           
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

  private getIslandsForwardBuilderStagingPoint(
      gameState: GameState,
      targetIsland: Island,
      fromIsland: Island
  ): { x: number; y: number } {
      const footholdNode = this.getDirectionalBridgeNode(targetIsland, fromIsland);
      if (footholdNode) {
          const nodeX = targetIsland.x + (footholdNode.x || 0);
          const nodeY = targetIsland.y + (footholdNode.y || 0);
          const towardCenterX = nodeX + (targetIsland.x - nodeX) * 0.45;
          const towardCenterY = nodeY + (targetIsland.y - nodeY) * 0.45;
          return gameState.adjustTarget('builder', towardCenterX, towardCenterY);
      }

      return this.findForwardIslandStagingPoint(gameState, targetIsland, fromIsland);
  }

  private manageIslandsForwardBuilderStaging(
      gameState: GameState,
      player: Player,
      myIslands: Island[],
      myUnits: Unit[]
  ) {
      if (gameState.mapType !== 'islands' || this.difficulty < 7) return;

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return;

      const footholds = this.getBridgeFootholdIslands(gameState, myIslands)
          .filter(island => island.id !== baseIsland.id && !!gameState.findIslandTraversalPath(baseIsland.id, island.id));
      if (footholds.length === 0) return;

      const builders = myUnits.filter(unit => unit.type === 'builder' && !this.usedUnitIds.has(unit.id));
      const totalBuilders = myUnits.filter(unit => unit.type === 'builder').length;
      const orderedFootholds = [...footholds].sort((left, right) => {
          const rightScore =
              this.getStructureBuildPriority(gameState, right, 'air_base') +
              this.getStructureBuildPriority(gameState, right, 'dock');
          const leftScore =
              this.getStructureBuildPriority(gameState, left, 'air_base') +
              this.getStructureBuildPriority(gameState, left, 'dock');
          return rightScore - leftScore;
      });

      for (const targetIsland of orderedFootholds) {
          const localBuilders = myUnits.filter(
              unit => unit.type === 'builder' && Math.hypot(unit.x - targetIsland.x, unit.y - targetIsland.y) < targetIsland.radius + 110
          );
          const desiredForwardBuilders =
              this.difficulty >= 10
                  ? this.islandHasOwnedBuildingOfType(targetIsland, 'air_base') || this.islandHasOwnedBuildingOfType(targetIsland, 'dock')
                      ? 2
                      : 1
                  : 1;
          if (localBuilders.length >= desiredForwardBuilders) continue;

          const stagingPoint = this.getIslandsForwardBuilderStagingPoint(gameState, targetIsland, baseIsland);
          const movableBuilders = builders
              .filter(builder => Math.hypot(builder.x - baseIsland.x, builder.y - baseIsland.y) < baseIsland.radius + 150)
              .sort((a, b) => {
                  const distA = Math.hypot(a.x - stagingPoint.x, a.y - stagingPoint.y);
                  const distB = Math.hypot(b.x - stagingPoint.x, b.y - stagingPoint.y);
                  return distA - distB;
              });

          if (movableBuilders.length > 0) {
              const builder = movableBuilders[0];
              this.moveUnitSafe(gameState, builder.id, stagingPoint.x, stagingPoint.y);
              this.logEvent('ISLANDS_FORWARD_STAGE', {
                  unitId: builder.id,
                  islandId: targetIsland.id,
                  x: stagingPoint.x,
                  y: stagingPoint.y
              });
              return;
          }

          if (totalBuilders < this.getBuilderCap() && this.canAfford(player, 'builder')) {
              this.recruitUnitType(gameState, player, [baseIsland], 'builder', 'base');
              return;
          }
      }
  }

  private manageIslandsBridgeheadDefences(
      gameState: GameState,
      player: Player,
      myIslands: Island[],
      myUnits: Unit[]
  ) {
      if (gameState.mapType !== 'islands' || this.difficulty < 8) return;
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return;

      const forwardIslands = this.prioritizeStructureBuildIslands(
          gameState,
          this.getBridgeFootholdIslands(gameState, myIslands).filter(island => island.id !== baseIsland.id),
          'tower'
      );

      for (const island of forwardIslands) {
          const activeForwardBase =
              this.islandHasReadyOwnedBuildingOfType(island, 'dock') ||
              this.islandHasReadyOwnedBuildingOfType(island, 'air_base') ||
              myUnits.some(unit => Math.hypot(unit.x - island.x, unit.y - island.y) < island.radius + 100);
          if (!activeForwardBase) continue;
          if (this.countOwnedBuildingsOfType(island, 'tower') > 0) continue;
          if (!this.canAfford(player, 'tower')) return;
          if (this.ensureBuilderAndBuild(gameState, island, 'tower')) return;
      }
  }

  private hasUnsettledIslandsBridgeFoothold(gameState: GameState, myIslands: Island[]): boolean {
      if (gameState.mapType !== 'islands') return false;
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return false;

      return this.getBridgeFootholdIslands(gameState, myIslands)
          .filter(island => island.id !== baseIsland.id && !!gameState.findIslandTraversalPath(baseIsland.id, island.id))
          .some(island =>
              !this.islandHasOwnedBuildingOfType(island, 'dock') &&
              !this.islandHasOwnedBuildingOfType(island, 'air_base')
          );
  }

  private getBridgeExpansionSourceIslands(gameState: GameState, myIslands: Island[]): Island[] {
      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      return myIslands.filter(island => {
          if (baseIsland && island.id === baseIsland.id) return true;
          return (
              this.islandHasOwnedBuildingOfType(island, 'base') ||
              this.islandHasOwnedBuildingOfType(island, 'dock') ||
              this.islandHasOwnedBuildingOfType(island, 'air_base')
          );
      });
  }

  private stageGrasslandsForwardBuilders(gameState: GameState, myIslands: Island[], myUnits: Unit[]) {
      if (gameState.mapType !== 'grasslands') return;
      if (this.difficulty < 4) return;

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return;

      const readyBarracks = myIslands.some(island => this.islandHasReadyOwnedBuildingOfType(island, 'barracks'));
      if (!readyBarracks) return;

      const elapsedMs = Date.now() - this.startTime;
      const soldiers = myUnits.filter(unit => unit.type === 'soldier').length;
      const homeTowers = this.baseDefenseBuilder.debugState.towersBuilt;
      const homeMines = this.getOwnedMineCount(myIslands);
      const totalBuilders = myUnits.filter(unit => unit.type === 'builder').length;
      const ownedOilStructures = this.getOwnedOilStructureCount(gameState, myIslands);
      if (this.difficulty >= 10) {
          const canLaunchForward =
              homeMines >= 1 &&
              totalBuilders >= 3 &&
              (ownedOilStructures > 0 || elapsedMs >= 60000) &&
              (elapsedMs >= 12000 || soldiers >= 3 || homeTowers >= 2);
          if (!canLaunchForward) return;
      }

      const targetIsland = this.getGrasslandsForwardIsland(gameState, myIslands, baseIsland);
      if (!targetIsland) return;
      const builders = myUnits.filter(unit => unit.type === 'builder' && !this.usedUnitIds.has(unit.id));
      if (builders.length === 0) return;

      const buildersOnTarget = builders.filter(builder => Math.hypot(builder.x - targetIsland.x, builder.y - targetIsland.y) < targetIsland.radius + 80);
      const desiredForwardBuilders = this.difficulty >= 10 ? 2 : 1;
      if (buildersOnTarget.length >= desiredForwardBuilders) return;

      const movableBuilders = builders
          .filter(builder => Math.hypot(builder.x - baseIsland.x, builder.y - baseIsland.y) < baseIsland.radius + 140)
          .sort((a, b) => {
              const distA = Math.hypot(a.x - targetIsland.x, a.y - targetIsland.y);
              const distB = Math.hypot(b.x - targetIsland.x, b.y - targetIsland.y);
              return distA - distB;
          });
      if (movableBuilders.length === 0) return;

      const builder = movableBuilders[0];
      const stagingPoint = this.findForwardIslandStagingPoint(gameState, targetIsland, baseIsland);
      this.moveUnitSafe(gameState, builder.id, stagingPoint.x, stagingPoint.y);
      this.logEvent('FORWARD_STAGE', {
          unitId: builder.id,
          islandId: targetIsland.id,
          x: stagingPoint.x,
          y: stagingPoint.y
      });
  }

  private manageGrasslandsForwardExpansion(gameState: GameState, player: Player, myIslands: Island[], myUnits: Unit[]) {
      if (gameState.mapType !== 'grasslands' || this.difficulty < 4) return;

      const baseIsland = this.getOwnedBaseIsland(gameState, myIslands);
      if (!baseIsland) return;

      const elapsedMs = Date.now() - this.startTime;
      if (this.difficulty >= 10) {
          const soldiers = myUnits.filter(unit => unit.type === 'soldier').length;
          const homeMines = this.getOwnedMineCount(myIslands);
          const canLaunchForward =
              homeMines >= 1 &&
              (elapsedMs >= 12000 || soldiers >= 3 || this.baseDefenseBuilder.debugState.towersBuilt >= 2);
          if (!canLaunchForward) return;
      }

      const targetIsland = this.getGrasslandsForwardIsland(gameState, myIslands, baseIsland);
      if (!targetIsland) return;

      const buildersOnTarget = myUnits.filter(unit =>
          unit.type === 'builder' && Math.hypot(unit.x - targetIsland.x, unit.y - targetIsland.y) < targetIsland.radius + 120
      );
      if (buildersOnTarget.length === 0) return;

      this.manageOnshoreOil(gameState, player, myUnits, [targetIsland]);
      const forwardOilStarted =
          this.hasStableOil(player) ||
          this.playerHasOilBuilding(gameState, [targetIsland]) ||
          this.playerHasOilBuilding(gameState, myIslands);
      if (!forwardOilStarted && this.difficulty >= 10) {
          return;
      }

      this.buildAvailableMines(gameState, player, targetIsland);

      const ownedBarracks = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'barracks'), 0);
      const targetBarracks = this.countOwnedBuildingsOfType(targetIsland, 'barracks');
      const totalBarracks = ownedBarracks;
      const maxForwardBarracks =
          this.difficulty >= 10 && !forwardOilStarted
              ? 0
              : !forwardOilStarted
              ? 1
              : this.strategyProfile.recruitmentBuildings >= 3
                  ? 2
                  : 1;
      const preOilBarracksCap =
          this.difficulty >= 10 && !forwardOilStarted
              ? Math.min(2, this.strategyProfile.recruitmentBuildings)
              : this.strategyProfile.recruitmentBuildings;
      if (
          totalBarracks < preOilBarracksCap &&
          targetBarracks < maxForwardBarracks &&
          this.canAfford(player, 'barracks')
      ) {
          this.ensureBuilderAndBuild(gameState, targetIsland, 'barracks');
      }

      const forwardOilOnline =
          this.hasStableOil(player) ||
          this.playerHasOilBuilding(gameState, myIslands) ||
          this.playerHasOilBuilding(gameState, [targetIsland]);
      const desiredFactories = this.getDesiredFactoryCount(gameState.mapType, forwardOilOnline);
      const ownedFactories = myIslands.reduce((count, island) => count + this.countOwnedBuildingsOfType(island, 'tank_factory'), 0);
      if (
          desiredFactories > 0 &&
          forwardOilStarted &&
          ownedFactories < desiredFactories &&
          this.countOwnedBuildingsOfType(targetIsland, 'tank_factory') === 0 &&
          this.canAfford(player, 'tank_factory')
      ) {
          this.ensureBuilderAndBuild(gameState, targetIsland, 'tank_factory');
      }
  }

  private getGrasslandsForwardIsland(gameState: GameState, myIslands: Island[], baseIsland: Island): Island | null {
      const neutralTargets = gameState.map.islands
          .filter(island => !island.ownerId && !myIslands.some(owned => owned.id === island.id))
          .sort((a, b) => {
              const distA = Math.hypot(a.x - baseIsland.x, a.y - baseIsland.y);
              const distB = Math.hypot(b.x - baseIsland.x, b.y - baseIsland.y);
              return distA - distB;
          });
      return neutralTargets[0] || null;
  }

  private findForwardIslandStagingPoint(gameState: GameState, targetIsland: Island, fromIsland: Island): { x: number; y: number } {
      const angle = Math.atan2(targetIsland.y - fromIsland.y, targetIsland.x - fromIsland.x);
      const preferred = {
          x: targetIsland.x - Math.cos(angle) * Math.max(40, targetIsland.radius * 0.35),
          y: targetIsland.y - Math.sin(angle) * Math.max(40, targetIsland.radius * 0.35)
      };
      return gameState.adjustTarget('builder', preferred.x, preferred.y);
  }
}
