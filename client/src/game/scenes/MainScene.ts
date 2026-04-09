import Phaser from 'phaser';
import { socket } from '../../services/socket';
import { soundEffectsManager } from '../../audio/soundEffects';
import { settingsManager } from '../SettingsManager';
import type { Settings } from '../SettingsManager';
import type { Building, GameMap, Island, Player, Unit } from '../../types/game';
import { createUnitArt, getUnitArtScale, getUnitWeaponMuzzleOffset, resolveUnitFacingTransform } from '../rendering/unitArt';
import type { UnitArtRenderMode } from '../rendering/unitArt';
import { createBuildingArt } from '../rendering/buildingArt';
import { addOuterOutlineToArtContainer, applySkinToArtContainer, createMotionTrailSegment, getMotionTrailStyle } from '../rendering/skinEffects';
import { SKIN_DEFINITIONS_BY_ID, type SkinId, type SkinLoadout } from '../../utils/playerSkins';

interface MenuProjectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    type: 'bullet' | 'missile';
    color: number;
    trail: {x: number, y: number, alpha: number, size: number}[];
    scale: number;
    // Movement Props
    wobblePhase: number;
    turnRate: number;
    speed: number;
    initialVy: number;
}

interface BuildingAudioSnapshot {
    id: string;
    type: Building['type'];
    ownerId: string | null;
    x: number;
    y: number;
}

interface EconomyBurstEvent {
    buildingId: string;
    x: number;
    y: number;
    gold: number;
    oil: number;
}

type PlacementValidation = {
    valid: boolean;
    reason: string;
};

type PredictedMoveState = {
    targetX: number;
    targetY: number;
    speed: number;
    type: string;
    intentId: string;
    path?: { x: number; y: number }[];
    vx?: number;
    vy?: number;
};

type UnitTrailState = {
    lastX: number;
    lastY: number;
    emitX: number;
    emitY: number;
};

type MotionTrailSegment = {
    sprite: Phaser.GameObjects.Container;
    bornAt: number;
    lifetimeMs: number;
    baseAlpha: number;
    growth: number;
};

const CLIENT_DEFINITE_PLACEMENT_FAILURE_REASONS = new Set([
    'Map data still loading',
    'Connection not ready',
    'Player data still loading',
    'HQ only spawns at match start'
]);

const SERVER_AUTHORITY_PLACEMENT_TYPES = new Set(['bridge_node', 'naval_mine']);

const BUILDING_COSTS: Record<string, { gold: number; oil: number }> = {
    barracks: { gold: 50, oil: 0 },
    mine: { gold: 30, oil: 0 },
    tower: { gold: 40, oil: 0 },
    dock: { gold: 100, oil: 0 },
    base: { gold: 9999, oil: 9999 },
    oil_rig: { gold: 200, oil: 0 },
    oil_well: { gold: 200, oil: 0 },
    wall: { gold: 10, oil: 0 },
    bridge_node: { gold: 50, oil: 0 },
    wall_node: { gold: 20, oil: 0 },
    farm: { gold: 50, oil: 0 },
    tank_factory: { gold: 500, oil: 50 },
    air_base: { gold: 400, oil: 100 },
    hospital: { gold: 150, oil: 20 },
    repair_dock: { gold: 220, oil: 40 },
    naval_mine: { gold: 120, oil: 20 }
};

const BUILDING_FOOTPRINTS: Record<string, number> = {
    base: 36,
    barracks: 34,
    mine: 24,
    tower: 18,
    dock: 28,
    oil_rig: 24,
    oil_well: 24,
    wall: 10,
    bridge_node: 10,
    wall_node: 10,
    farm: 24,
    tank_factory: 42,
    air_base: 40,
    hospital: 30,
    repair_dock: 32,
    naval_mine: 12
};

const NON_BLOCKING_BUILDING_TYPES = new Set<string>(['mine', 'bridge_node', 'naval_mine']);
const BRIDGE_NODE_LAND_ACCESS_EDGE_PADDING = 18;
const DEFAULT_SKIN_LOADOUT: SkinLoadout = {
    unitSkinId: 'default',
    buildingSkinId: 'default',
};

const WORLD_BUILDING_BASE_DEPTH = 3;
const WORLD_OIL_SPOT_DEPTH = 10;
const WORLD_OIL_RIG_DEPTH = WORLD_OIL_SPOT_DEPTH + 2;
const WORLD_LASER_BEAM_DEPTH = 19;

const blendSceneColor = (from: number, to: number, amount: number): number => {
    const a = Phaser.Display.Color.ValueToColor(from);
    const b = Phaser.Display.Color.ValueToColor(to);
    const t = Phaser.Math.Clamp(amount, 0, 1);
    return Phaser.Display.Color.GetColor(
        Math.round(a.red + (b.red - a.red) * t),
        Math.round(a.green + (b.green - a.green) * t),
        Math.round(a.blue + (b.blue - a.blue) * t)
    );
};

export class MainScene extends Phaser.Scene {
  private islandsGroup!: Phaser.GameObjects.Group;
  private unitsGroup!: Phaser.GameObjects.Group;

  // Menu Animation Props
  private isMenuMode: boolean = false;
  private isSpectating: boolean = false;
  private menuProjectiles: MenuProjectile[] = [];
  private menuSpawnTimer: number = 0;
  private menuGraphics!: Phaser.GameObjects.Graphics;
  private menuExplosions: {x: number, y: number, life: number, maxLife: number, color: number, radius: number}[] = [];
  private mainMenuMusic: Phaser.Sound.BaseSound | null = null;
  private ingameMusic: Phaser.Sound.BaseSound | null = null;

  private unitContainers: Map<string, Phaser.GameObjects.Container> = new Map();
  private players: Map<string, Player> = new Map();
  private selectedUnitIds: Set<string> = new Set();
  private selectedBuildingIds: Set<string> = new Set();
  private selectedNodeIds: Set<string> = new Set();
  private currentUnits: Unit[] = [];
  private infantryLodActive: boolean = false;
  private attackFacingOverrides: Map<string, { angle: number; expiresAt: number }> = new Map();
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private isSelecting: boolean = false;
  private selectionStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  
  private placementMode: boolean = false;
  private placementType: string | null = null;
  private placementGhost: Phaser.GameObjects.Container | null = null;
  private placementStatusText: Phaser.GameObjects.Text | null = null;
  private targetSelectionMode: boolean = false;
  private targetSelectionCallback: ((x: number, y: number) => void) | null = null;
  
  // Visuals
    private tumbleweeds: { sprite: Phaser.GameObjects.Shape, dx: number, dy: number, life: number, maxLife: number, poly: Phaser.Geom.Polygon, bounds: Phaser.Geom.Rectangle }[] = [];
    private weatherParticles: { sprite: Phaser.GameObjects.Shape, dx: number, dy: number, type: string, life: number, maxLife: number, poly: Phaser.Geom.Polygon, bounds: Phaser.Geom.Rectangle }[] = [];
    private oilAnimations: { x: number, y: number, pulse: Phaser.GameObjects.Arc, timer: number, id: string }[] = [];
    private goldSparkles: { sprite: Phaser.GameObjects.Star, timer: number, speed: number }[] = [];
    private oilSpotVisuals: Map<string, { main: Phaser.GameObjects.Shape, pulse: Phaser.GameObjects.Shape, ping?: Phaser.GameObjects.Rectangle }> = new Map();
    private revealedOilSpots: Set<string> = new Set();
    private unitUpdates: Map<string, { x: number, y: number, time: number }[]> = new Map();
    private keyCache: Map<string, Phaser.Input.Keyboard.Key> = new Map();
    private lastCameraX: number = 0;
    private lastCameraY: number = 0;
    private showOilScanner: boolean = false;
    private analyser: AnalyserNode | null = null;
    private dataArray: Uint8Array | null = null;

    private cameraInitialized: boolean = false;
    private currentMap: GameMap | null = null;
  private currentMapVersion: string | null = null;
  private currentMapStateSignature: string | null = null;
  private activeSkinLoadout: SkinLoadout = { ...DEFAULT_SKIN_LOADOUT };
  private unitTrailStates: Map<string, UnitTrailState> = new Map();
  private motionTrailSegments: MotionTrailSegment[] = [];
  private knownBuildingAudioState: Map<string, BuildingAudioSnapshot> = new Map();
  private buildingAudioPrimed: boolean = false;
  private rangeGraphics!: Phaser.GameObjects.Graphics;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private scannerOverlay!: Phaser.GameObjects.Graphics;
  private isComposing: boolean = false;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private debugTextGroup!: Phaser.GameObjects.Group;
    private showDebugView: boolean = false;
    private lastDebugData: any[] = [];

    // Audio Alert Handler
    private handleBuildingDamage = (data: any) => {
        if (data.ownerId === socket.id) {
            const isHQ = data.entityType === 'base';
            if (isHQ) {
                const volume = soundEffectsManager.getEffectVolume('damageAlertHq', 0.4);
                if (volume > 0) {
                    this.sound.play('explosion', { volume, rate: 1.5 });
                }
            } else {
                const volume = soundEffectsManager.getEffectVolume('damageAlertBuilding', 0.1);
                if (volume > 0) {
                    this.sound.play('shoot', { volume, rate: 3.0 });
                }
            }
        }
    };

    // Client-Side Prediction
  private predictedMoves: Map<string, PredictedMoveState> = new Map();
  private lastCommandTime: number = 0;

  constructor() {
    super('MainScene');
  }

  private registerAttackFacing(attackerId: string | undefined, x1: number, y1: number, x2: number, y2: number, duration = 240) {
    if (!attackerId) return;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    this.attackFacingOverrides.set(attackerId, {
      angle,
      expiresAt: Date.now() + duration
    });
  }

  private getDesiredFacingAngle(unit: Unit): number | undefined {
    const override = this.attackFacingOverrides.get(unit.id);
    if (override) {
      if (override.expiresAt > Date.now()) return override.angle;
      this.attackFacingOverrides.delete(unit.id);
    }

    const prediction = this.predictedMoves.get(unit.id);
    if (prediction && prediction.vx !== undefined && prediction.vy !== undefined) {
      if (Math.hypot(prediction.vx, prediction.vy) > 5) {
        return Math.atan2(prediction.vy, prediction.vx);
      }
    }

    if (typeof unit.facingAngle === 'number') {
      return unit.facingAngle;
    }

    const history = this.unitUpdates.get(unit.id);
    if (history && history.length >= 2) {
      const current = history[history.length - 1];
      const previous = history[history.length - 2];
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (Math.hypot(dx, dy) > 1) {
        return Math.atan2(dy, dx);
      }
    }

    return undefined;
  }

  private rotateUnitArt(container: Phaser.GameObjects.Container, targetAngle: number | undefined, dtSec: number, snap = false) {
    const art = container.getByName('art') as Phaser.GameObjects.Container | null;
    if (!art || typeof targetAngle !== 'number' || Number.isNaN(targetAngle)) return;

    const facing = resolveUnitFacingTransform(targetAngle);
    if (!facing) return;
    const baseScale = Number(art.getData('baseScale')) || Math.abs(art.scaleY || art.scaleX || 1);
    const nextScaleX = facing.mirrored ? -baseScale : baseScale;
    const currentMirrored = (art.scaleX || 0) < 0;

    if (snap) {
      art.scaleX = nextScaleX;
      art.rotation = facing.rotation;
      return;
    }

    if (currentMirrored !== facing.mirrored) {
      art.scaleX = nextScaleX;
      art.rotation = facing.rotation;
      return;
    }

    art.scaleX = nextScaleX;
    art.rotation = Phaser.Math.Angle.RotateTo(art.rotation, facing.rotation, 8 * dtSec);
  }

  private isCrowdInfantryType(type: string) {
    return type === 'soldier' || type === 'sniper' || type === 'rocketeer' || type === 'builder';
  }

  private shouldUseInfantryLod(units: Unit[] = this.currentUnits) {
    const infantryCount = units.reduce(
      (count, unit) => count + (this.isCrowdInfantryType(unit.type) ? 1 : 0),
      0
    );
    const zoom = this.cameras.main?.zoom ?? 1;

    if (this.infantryLodActive) {
      return zoom <= 0.62 || infantryCount >= 72 || (infantryCount >= 44 && zoom <= 0.78);
    }

    return zoom <= 0.5 || infantryCount >= 96 || (infantryCount >= 56 && zoom <= 0.72);
  }

  private syncUnitDetailMode(units: Unit[] = this.currentUnits) {
    const shouldUseLod = this.shouldUseInfantryLod(units);
    if (shouldUseLod === this.infantryLodActive) return false;
    this.infantryLodActive = shouldUseLod;
    return true;
  }

  private getUnitRenderMode(unit: Unit, isSelected: boolean): UnitArtRenderMode {
    if (!isSelected && this.infantryLodActive && this.isCrowdInfantryType(unit.type)) {
      return 'lod';
    }

    return 'full';
  }

  private clearPlacementMode() {
    this.placementMode = false;
    this.placementType = null;

    if (this.placementGhost) {
      this.placementGhost.destroy();
      this.placementGhost = null;
    }

    if (this.placementStatusText) {
      this.placementStatusText.destroy();
      this.placementStatusText = null;
    }
  }

  private getPlacementSupportUnitTypes(type: string): string[] {
    if (type === 'naval_mine' || type === 'oil_rig') return ['construction_ship'];
    if (type === 'bridge_node') return ['builder', 'construction_ship'];
    return ['builder'];
  }

  private getPlacementSupportRange(type: string): number {
    if (type === 'oil_rig') return 150;
    if (type === 'naval_mine') return 180;
    if (type === 'bridge_node') return 220;
    return 400;
  }

  private getPlacementSupportLabel(type: string): string {
    const allowedTypes = this.getPlacementSupportUnitTypes(type);
    if (allowedTypes.length === 2) return 'builder or construction ship';
    return allowedTypes[0] === 'construction_ship' ? 'construction ship' : 'builder';
  }

  private getBuildingCost(type: string) {
    return BUILDING_COSTS[type] ?? { gold: 0, oil: 0 };
  }

  private getBuildingFootprintRadius(type: string): number {
    return BUILDING_FOOTPRINTS[type] ?? 30;
  }

  private isNonBlockingBuildingType(type: string): boolean {
    return NON_BLOCKING_BUILDING_TYPES.has(type);
  }

  private getEffectivePlacementFootprintRadius(type: string): number {
    if (this.isNonBlockingBuildingType(type)) return 0;

    const baseRadius = this.getBuildingFootprintRadius(type);
    const mapType = this.currentMap?.mapType;

    if (type === 'air_base') {
      if (mapType === 'islands') return Math.max(14, Math.round(baseRadius * 0.5));
      return Math.max(22, Math.round(baseRadius * 0.7));
    }

    if (mapType === 'islands') {
      if (['barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'dock', 'hospital', 'repair_dock'].includes(type)) {
        return Math.max(9, Math.round(baseRadius * 0.68));
      }
      if (type === 'wall' || type === 'wall_node') {
        return Math.max(5, Math.round(baseRadius * 0.7));
      }
    }

    return baseRadius;
  }

  private getBuildingPlacementPadding(type: string): number {
    if (this.isNonBlockingBuildingType(type)) return 0;

    const mapType = this.currentMap?.mapType;
    if (type === 'air_base') return mapType === 'islands' ? 0 : 2;
    if (mapType === 'islands' && ['wall', 'wall_node'].includes(type)) return 1;
    if (type === 'wall_node' || type === 'wall') return 2;
    if (mapType === 'islands' && ['air_base', 'barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'dock', 'hospital', 'repair_dock'].includes(type)) {
      return 0;
    }

    return 4;
  }

  private isPointOnLand(x: number, y: number) {
    if (!this.currentMap) return false;

    return this.currentMap.islands.some(island => {
      return this.isPointOnIslandSurface(island, x, y);
    });
  }

  private isPointOnIslandSurface(island: Island, x: number, y: number) {
    if (island.points) {
      return this.isPointInPolygon({ x, y }, island.points);
    }
    return Math.hypot(x - island.x, y - island.y) <= island.radius;
  }

  private getIslandShorelineProbe(
    island: Island,
    x: number,
    y: number,
    tolerance = 20
  ): { edgeX: number; edgeY: number; outwardX: number; outwardY: number } | null {
    if (island.points && island.points.length > 2) {
      if (!this.isPointInPolygon({ x, y }, island.points)) {
        return null;
      }

      const closest = this.getClosestPointOnPolygon({ x, y }, island.points);
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

  private isPointOnExposedIslandShoreline(island: Island, x: number, y: number, tolerance = 20) {
    if (!this.currentMap) return false;

    const probe = this.getIslandShorelineProbe(island, x, y, tolerance);
    if (!probe) return false;

    const probeDistances = [6, 12, 18];
    return probeDistances.some(distance => {
      const probeX = probe.edgeX + probe.outwardX * distance;
      const probeY = probe.edgeY + probe.outwardY * distance;
      return !this.isPointOnLand(probeX, probeY);
    });
  }

  private getDockPlacementIslandCandidates(x: number, y: number) {
    if (!this.currentMap) return [] as Island[];

    return this.currentMap.islands
      .filter(island => this.isPointOnExposedIslandShoreline(island, x, y))
      .sort((left, right) => left.radius - right.radius);
  }

  private hasDockWaterSpawnSpace(x: number, y: number) {
    const radii = [40, 60, 80, 100, 120, 150, 180, 200];
    for (const radius of radii) {
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        const testX = x + Math.cos(angle) * radius;
        const testY = y + Math.sin(angle) * radius;
        if (!this.isPointOnLand(testX, testY)) {
          return true;
        }
      }
    }

    return false;
  }

  private getClosestOilSpot(x: number, y: number, maxDistance = 40) {
    if (!this.currentMap) return null;

    const nearby = this.currentMap.oilSpots
      .map(spot => ({ spot, distance: Math.hypot(spot.x - x, spot.y - y) }))
      .filter(entry => entry.distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance);

    return nearby[0]?.spot ?? null;
  }

  private getHighGroundAtPoint(x: number, y: number) {
    if (!this.currentMap?.highGrounds) return null;

    return this.currentMap.highGrounds.find(highGround => {
      if (
        x < highGround.x - highGround.radius ||
        x > highGround.x + highGround.radius ||
        y < highGround.y - highGround.radius ||
        y > highGround.y + highGround.radius
      ) {
        return false;
      }

      return this.isPointInPolygon({ x, y }, highGround.points);
    }) ?? null;
  }

  private isPointInsideHighGround(x: number, y: number) {
    return !!this.getHighGroundAtPoint(x, y);
  }

  private getPlacementIslandCandidates(x: number, y: number): Island[] {
    if (!this.currentMap) return [];

    return this.currentMap.islands
      .filter(island => {
        if (island.points) return this.isPointInPolygon({ x, y }, island.points);
        return Math.hypot(x - island.x, y - island.y) < island.radius + 50;
      })
      .sort((left, right) => left.radius - right.radius);
  }

  private getPlacementSurfaceIslandCandidates(x: number, y: number): Island[] {
    if (!this.currentMap) return [];

    return this.currentMap.islands
      .filter(island => {
        if (island.points) return this.isPointInPolygon({ x, y }, island.points);
        return Math.hypot(x - island.x, y - island.y) <= island.radius;
      })
      .sort((left, right) => left.radius - right.radius);
  }

  private getBuildSupportUnitsInRange(type: string, x: number, y: number): Unit[] {
    const allowedTypes = new Set(this.getPlacementSupportUnitTypes(type));
    const range = this.getPlacementSupportRange(type);

    return this.currentUnits.filter(unit =>
      unit.ownerId === socket.id &&
      allowedTypes.has(unit.type) &&
      Math.hypot(unit.x - x, unit.y - y) <= range
    );
  }

  private getNodeView(nodeId: string): { building: any; x: number; y: number; island?: Island } | null {
    if (!this.currentMap) return null;

    for (const island of this.currentMap.islands) {
      const building = island.buildings.find(candidate => candidate.id === nodeId);
      if (!building) continue;
      return {
        building,
        island,
        x: island.x + (building.x || 0),
        y: island.y + (building.y || 0)
      };
    }

    for (const building of this.currentMap.waterBuildings || []) {
      if (building.id !== nodeId) continue;
      return {
        building,
        x: building.x || 0,
        y: building.y || 0
      };
    }

    return null;
  }

  private getBridgeEndpoints(bridge: GameMap['bridges'][number]): { ax: number; ay: number; bx: number; by: number } | null {
    const nodeA = this.getNodeView(bridge.nodeAId);
    const nodeB = this.getNodeView(bridge.nodeBId);
    if (!nodeA || !nodeB) return null;

    return {
      ax: nodeA.x,
      ay: nodeA.y,
      bx: nodeB.x,
      by: nodeB.y
    };
  }

  private isBridgeNodeWaypoint(point?: { x: number; y: number }, tolerance: number = 12): boolean {
    if (!point || !this.currentMap) return false;

    for (const island of this.currentMap.islands) {
      for (const building of island.buildings) {
        if (building.type !== 'bridge_node' || building.isConstructing || building.health <= 0) continue;
        const nodeX = island.x + (building.x || 0);
        const nodeY = island.y + (building.y || 0);
        if (Math.hypot(point.x - nodeX, point.y - nodeY) <= tolerance) {
          return true;
        }
      }
    }

    for (const building of this.currentMap.waterBuildings || []) {
      if (building.type !== 'bridge_node' || building.isConstructing || building.health <= 0) continue;
      const nodeX = building.x || 0;
      const nodeY = building.y || 0;
      if (Math.hypot(point.x - nodeX, point.y - nodeY) <= tolerance) {
        return true;
      }
    }

    return false;
  }

  private getWaypointArrivalThreshold(point?: { x: number; y: number }) {
    return this.isBridgeNodeWaypoint(point) ? 8 : 24;
  }

  private getIslandContainingPoint(x: number, y: number, buffer: number = 35): Island | null {
    if (!this.currentMap) return null;

    const island = this.currentMap.islands.find(candidate => {
      if (candidate.points) {
        if (this.isPointInPolygon({ x, y }, candidate.points)) return true;
        const closest = this.getClosestPointOnPolygon({ x, y }, candidate.points);
        return Math.hypot(x - closest.x, y - closest.y) <= buffer;
      }
      return Math.hypot(x - candidate.x, y - candidate.y) <= candidate.radius + buffer;
    });

    return island || null;
  }

  private getTraversalNeighbors(token: string): string[] {
    if (!this.currentMap) return [];

    if (token.startsWith('island:')) {
      const islandId = token.slice('island:'.length);
      const island = this.currentMap.islands.find(candidate => candidate.id === islandId);
      if (!island) return [];

      return island.buildings
        .filter(building => building.type === 'bridge_node' && !building.isConstructing && building.health > 0)
        .map(building => `node:${building.id}`);
    }

    const nodeId = token.slice('node:'.length);
    const node = this.getNodeView(nodeId);
    if (!node || node.building.type !== 'bridge_node' || node.building.isConstructing || node.building.health <= 0) {
      return [];
    }

    const neighbors: string[] = [];
    if (node.island) {
      neighbors.push(`island:${node.island.id}`);
    }

    this.currentMap.bridges.forEach(bridge => {
      if (bridge.type !== 'bridge') return;
      if (bridge.nodeAId === nodeId) neighbors.push(`node:${bridge.nodeBId}`);
      if (bridge.nodeBId === nodeId) neighbors.push(`node:${bridge.nodeAId}`);
    });

    return neighbors;
  }

  private findTraversalPathBetweenTokens(startTokens: string[], endToken: string): string[] | null {
    if (startTokens.length === 0) return null;
    if (startTokens.includes(endToken)) return [endToken];

    const queue: Array<{ token: string; path: string[] }> = [];
    const visited = new Set<string>();

    startTokens.forEach(token => {
      queue.push({ token, path: [token] });
      visited.add(token);
    });

    while (queue.length > 0) {
      const { token, path } = queue.shift()!;
      if (token === endToken) return path;

      for (const neighbor of this.getTraversalNeighbors(token)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push({ token: neighbor, path: [...path, neighbor] });
      }
    }

    return null;
  }

  private buildPredictedBridgeWaypointPath(unit: Unit, target: { x: number; y: number }): { x: number; y: number }[] {
    if (!this.currentMap) return [];
    if (!['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'oil_seeker', 'missile_launcher'].includes(unit.type)) {
      return [];
    }

    const startIsland = this.getIslandContainingPoint(unit.x, unit.y, 45);
    const endIsland = this.getIslandContainingPoint(target.x, target.y, 45);
    if (!startIsland || !endIsland || startIsland.id === endIsland.id) return [];

    const traversalPath = this.findTraversalPathBetweenTokens([`island:${startIsland.id}`], `island:${endIsland.id}`);
    if (!Array.isArray(traversalPath) || traversalPath.length < 2) return [];

    const waypoints: { x: number; y: number }[] = [];
    traversalPath.forEach(token => {
      if (!token.startsWith('node:')) return;
      const node = this.getNodeView(token.slice('node:'.length));
      if (!node) return;
      waypoints.push(this.getAdjustedTarget(unit.type, node.x, node.y));
    });

    const filtered: { x: number; y: number }[] = [];
    waypoints.forEach(point => {
      const previous = filtered[filtered.length - 1];
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 16) {
        filtered.push(point);
      }
    });

    return filtered;
  }

  private getBridgeChainPaths(bridges: GameMap['bridges']) {
    const bridgeSegments = bridges.filter(bridge => bridge.type === 'bridge');
    const adjacency = new Map<string, string[]>();
    const visitedEdges = new Set<string>();
    const chains: { points: { x: number; y: number }[]; ownerId: string }[] = [];

    const edgeKey = (a: string, b: string) => [a, b].sort().join('::');

    bridgeSegments.forEach(bridge => {
      const nodeA = this.getNodeView(bridge.nodeAId);
      const nodeB = this.getNodeView(bridge.nodeBId);
      if (!nodeA || !nodeB) return;

      adjacency.set(bridge.nodeAId, [...(adjacency.get(bridge.nodeAId) || []), bridge.nodeBId]);
      adjacency.set(bridge.nodeBId, [...(adjacency.get(bridge.nodeBId) || []), bridge.nodeAId]);
    });

    const startNodeIds = [
      ...Array.from(adjacency.entries())
        .filter(([, neighbors]) => neighbors.length <= 1)
        .map(([nodeId]) => nodeId),
      ...Array.from(adjacency.keys())
    ];

    startNodeIds.forEach(startNodeId => {
      const startNeighbors = adjacency.get(startNodeId) || [];
      const hasUnvisitedEdge = startNeighbors.some(neighbor => !visitedEdges.has(edgeKey(startNodeId, neighbor)));
      if (!hasUnvisitedEdge) return;

      const firstNode = this.getNodeView(startNodeId);
      if (!firstNode) return;

      const points = [{ x: firstNode.x, y: firstNode.y }];
      const firstBridge = bridgeSegments.find(bridge =>
        bridge.nodeAId === startNodeId || bridge.nodeBId === startNodeId
      );
      let ownerId = firstBridge?.ownerId || '';
      let previousNodeId: string | null = null;
      let currentNodeId: string | null = startNodeId;

      while (currentNodeId) {
        const activeNodeId = currentNodeId;
        const neighbors: string[] = (adjacency.get(activeNodeId) || []).filter(neighbor => {
          if (neighbor === previousNodeId) return false;
          return !visitedEdges.has(edgeKey(activeNodeId, neighbor));
        });

        if (neighbors.length === 0) break;

        const nextNodeId: string = neighbors[0];
        visitedEdges.add(edgeKey(activeNodeId, nextNodeId));

        const bridge = bridgeSegments.find(candidate =>
          (candidate.nodeAId === activeNodeId && candidate.nodeBId === nextNodeId) ||
          (candidate.nodeAId === nextNodeId && candidate.nodeBId === activeNodeId)
        );
        if (bridge?.ownerId) ownerId = bridge.ownerId;

        const nextNode = this.getNodeView(nextNodeId);
        if (!nextNode) break;
        points.push({ x: nextNode.x, y: nextNode.y });

        previousNodeId = activeNodeId;
        currentNodeId = nextNodeId;
      }

      if (points.length >= 2) {
        chains.push({ points, ownerId });
      }
    });

    return chains;
  }

  private isValidBridgeNodeWaterPlacement(x: number, y: number): boolean {
    if (!this.currentMap) return false;

    const footprint = this.getBuildingFootprintRadius('bridge_node');
    const onLand = this.isPointOnLand(x, y);
    if (onLand) return false;
    if (x < footprint || x > this.currentMap.width - footprint || y < footprint || y > this.currentMap.height - footprint) return false;
    if (this.isPointInsideHighGround(x, y)) return false;

    const blockedOilSpot = this.currentMap.oilSpots.some(spot =>
      Math.hypot(spot.x - x, spot.y - y) < spot.radius + 10
    );
    if (blockedOilSpot) return false;

    const minSpacing = Math.max(18, footprint * 2);
    return !(this.currentMap.waterBuildings || []).some(building =>
      ['bridge_node', 'naval_mine', 'oil_rig'].includes(building.type) &&
      Math.hypot((building.x || 0) - x, (building.y || 0) - y) < minSpacing
    );
  }

  private hasBridgeNodeLandAccessClearance(island: Island, absX: number, absY: number): boolean {
    if (!this.isPointOnIslandSurface(island, absX, absY)) {
      return false;
    }

    if (island.points) {
      const closest = this.getClosestPointOnPolygon({ x: absX, y: absY }, island.points);
      return Math.hypot(absX - closest.x, absY - closest.y) >= BRIDGE_NODE_LAND_ACCESS_EDGE_PADDING;
    }

    const edgeDistance = island.radius - Math.hypot(absX - island.x, absY - island.y);
    return edgeDistance >= BRIDGE_NODE_LAND_ACCESS_EDGE_PADDING;
  }

  private isPlacementClearOnIsland(island: Island, buildingType: string, absX: number, absY: number): boolean {
    const footprint = this.getEffectivePlacementFootprintRadius(buildingType);
    const nonBlocking = this.isNonBlockingBuildingType(buildingType);

    if (
      absX < footprint ||
      absX > this.currentMap!.width - footprint ||
      absY < footprint ||
      absY > this.currentMap!.height - footprint
    ) {
      return false;
    }

    if (this.currentMap?.highGrounds) {
      for (const highGround of this.currentMap.highGrounds) {
        if (
          absX < highGround.x - highGround.radius - footprint ||
          absX > highGround.x + highGround.radius + footprint ||
          absY < highGround.y - highGround.radius - footprint ||
          absY > highGround.y + highGround.radius + footprint
        ) {
          continue;
        }

        if (this.isPointInPolygon({ x: absX, y: absY }, highGround.points)) {
          return false;
        }

        const closest = this.getClosestPointOnPolygon({ x: absX, y: absY }, highGround.points);
        const highGroundEdgePadding = nonBlocking ? 0 : footprint + 4;
        if (Math.hypot(absX - closest.x, absY - closest.y) < highGroundEdgePadding) {
          return false;
        }
      }
    }

    if (buildingType !== 'dock' && buildingType !== 'oil_rig') {
      if (buildingType === 'bridge_node' && !this.hasBridgeNodeLandAccessClearance(island, absX, absY)) {
        return false;
      }

      const edgePadding = nonBlocking
        ? 0
        : this.currentMap?.mapType === 'islands'
          ? ['air_base', 'barracks', 'tank_factory', 'tower', 'farm', 'oil_well', 'hospital', 'repair_dock'].includes(buildingType)
            ? Math.max(1, Math.round(footprint * 0.15))
            : Math.max(1, Math.round(footprint * 0.25))
          : footprint + 4;

      if (island.points) {
        if (!this.isPointInPolygon({ x: absX, y: absY }, island.points)) {
          return false;
        }

        const closest = this.getClosestPointOnPolygon({ x: absX, y: absY }, island.points);
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
      const existingFootprint = this.getEffectivePlacementFootprintRadius(existing.type);
      const requiredSeparation =
        footprint +
        existingFootprint +
        Math.max(this.getBuildingPlacementPadding(buildingType), this.getBuildingPlacementPadding(existing.type));

      if (requiredSeparation <= 0) return false;
      return Math.hypot(absX - existingX, absY - existingY) < requiredSeparation;
    });
  }

  private evaluatePlacement(type: string, x: number, y: number): PlacementValidation {
    if (!this.currentMap) {
      return { valid: false, reason: 'Map data still loading' };
    }

    if (!socket.id) {
      return { valid: false, reason: 'Connection not ready' };
    }

    const player = this.players.get(socket.id);
    if (!player) {
      return { valid: false, reason: 'Player data still loading' };
    }

    if (type === 'base') {
      return { valid: false, reason: 'HQ only spawns at match start' };
    }

    if (type !== 'naval_mine' && type !== 'oil_rig' && this.isPointInsideHighGround(x, y)) {
      return { valid: false, reason: 'Cannot build on high ground' };
    }

    const cost = this.getBuildingCost(type);
    if (player.resources.gold < cost.gold || player.resources.oil < cost.oil) {
      const missingGold = Math.max(0, cost.gold - player.resources.gold);
      const missingOil = Math.max(0, cost.oil - player.resources.oil);
      const missingParts = [];
      if (missingGold > 0) missingParts.push(`${missingGold}g`);
      if (missingOil > 0) missingParts.push(`${missingOil}o`);
      return {
        valid: false,
        reason: `Insufficient funds${missingParts.length > 0 ? ` (${missingParts.join(', ')})` : ''}`
      };
    }

    if (type === 'naval_mine') {
      if (!this.isValidNavalMinePlacement(x, y)) {
        return { valid: false, reason: 'Naval mines need open water and spacing' };
      }

      if (this.getBuildSupportUnitsInRange(type, x, y).length === 0) {
        return { valid: false, reason: 'Requires nearby construction ship' };
      }

      return { valid: true, reason: 'Ready to build' };
    }

    const oilSpot = this.getClosestOilSpot(x, y);
    if (type === 'oil_rig') {
      if (!oilSpot || oilSpot.occupiedBy || oilSpot.id.startsWith('hidden_oil_') || oilSpot.id.startsWith('oil_revealed_')) {
        return { valid: false, reason: 'Oil rigs must be placed on a free water oil spot' };
      }

      const hasConstructionShip = this.currentUnits.some(unit =>
        unit.ownerId === socket.id &&
        unit.type === 'construction_ship' &&
        Math.hypot(unit.x - oilSpot.x, unit.y - oilSpot.y) < 150
      );
      if (!hasConstructionShip) {
        return { valid: false, reason: 'Requires nearby construction ship' };
      }

      const tooClose = this.currentMap.oilSpots.some(other =>
        other.id !== oilSpot.id &&
        other.occupiedBy &&
        Math.hypot(other.x - oilSpot.x, other.y - oilSpot.y) < 80
      );
      if (tooClose) {
        return { valid: false, reason: 'Too close to another oil rig' };
      }

      return { valid: true, reason: 'Ready to build' };
    }

    const island = type === 'bridge_node'
      ? this.getPlacementSurfaceIslandCandidates(x, y)[0]
      : type === 'dock'
        ? this.getDockPlacementIslandCandidates(x, y)[0]
        : this.getPlacementIslandCandidates(x, y)[0];
    if (!island) {
      if (type === 'bridge_node') {
        if (!this.isValidBridgeNodeWaterPlacement(x, y)) {
          return { valid: false, reason: 'Bridge nodes need open water and spacing' };
        }
        if (this.getBuildSupportUnitsInRange(type, x, y).length === 0) {
          return { valid: false, reason: 'Requires nearby builder or construction ship' };
        }
        return { valid: true, reason: 'Ready to build' };
      }
      if (type === 'dock') {
        return { valid: false, reason: 'Docks must be placed on a shoreline' };
      }
      return { valid: false, reason: 'Must be placed on land' };
    }

    const isSharedMap = this.currentMap.mapType === 'desert' || this.currentMap.mapType === 'grasslands';
    const enemyOwnedIsland = !!island.ownerId && island.ownerId !== socket.id;
    const allowNeutralBridgeNode = !island.ownerId && type === 'bridge_node';
    const hasForwardBridgeFoothold =
      !island.ownerId &&
      island.buildings.some(building => building.ownerId === socket.id && building.type === 'bridge_node');
    const neutralIslandAllowed = isSharedMap || allowNeutralBridgeNode || hasForwardBridgeFoothold;
    if (!enemyOwnedIsland && island.ownerId !== socket.id && !neutralIslandAllowed) {
      return {
        valid: false,
        reason: type === 'bridge_node'
          ? 'Bridge nodes can claim neutral land'
          : 'Need a bridge foothold on neutral land'
      };
    }

    if (type === 'dock') {
      if (!this.isValidDockPlacement(x, y)) {
        return { valid: false, reason: 'Docks must be placed on a shoreline' };
      }
      if (!this.hasDockWaterSpawnSpace(x, y)) {
        return { valid: false, reason: 'Dock needs open water for ship launch' };
      }
    }

    if (type === 'bridge_node' && !this.hasBridgeNodeLandAccessClearance(island, x, y)) {
      return { valid: false, reason: 'Too close to island edge for bridge access' };
    }

    if (type === 'mine') {
      const freeSpot = island.goldSpots.find(spot =>
        !spot.occupiedBy &&
        Math.hypot(island.x + spot.x - x, island.y + spot.y - y) < 100
      );
      if (!freeSpot) {
        return { valid: false, reason: 'Must be placed on an empty gold deposit' };
      }
    }

    if (type === 'oil_well') {
      if (!oilSpot || oilSpot.occupiedBy || oilSpot.radius < 30) {
        return { valid: false, reason: 'Must be placed on a visible land oil spot' };
      }
    }

    if (type === 'farm' && island.type !== 'forest' && island.type !== 'grasslands') {
      return { valid: false, reason: 'Farms need forest or grasslands terrain' };
    }

    if (!this.isPlacementClearOnIsland(island, type, x, y)) {
      return { valid: false, reason: 'Cannot place here' };
    }

    if (this.getBuildSupportUnitsInRange(type, x, y).length === 0) {
      return {
        valid: false,
        reason: `Requires nearby ${this.getPlacementSupportLabel(type)}`
      };
    }

    return { valid: true, reason: 'Ready to build' };
  }

  private updatePlacementPreview(x: number, y: number) {
    if (!this.placementGhost || !this.placementType) return;

    this.placementGhost.setPosition(x, y);
    const validation = this.evaluatePlacement(this.placementType, x, y);
    const deferToServer = this.shouldDeferPlacementValidationToServer(this.placementType, validation);

    this.placementGhost.list.forEach((child: any) => {
      if (child.setTint && child.clearTint) {
        if (validation.valid) {
          child.clearTint();
        } else if (deferToServer) {
          child.setTint(0xffc857);
        } else {
          child.setTint(0xff4d4d);
        }
      }
    });

    if (!this.placementStatusText) {
      this.placementStatusText = this.add.text(x, y - 54, '', {
        fontSize: '13px',
        fontFamily: 'monospace',
        color: '#7cffb2',
        backgroundColor: 'rgba(0,0,0,0.72)',
        padding: { left: 8, right: 8, top: 4, bottom: 4 }
      });
      this.placementStatusText.setOrigin(0.5, 1);
      this.placementStatusText.setDepth(210);
      this.placementStatusText.setStroke('#061015', 3);
    }

    this.placementStatusText.setPosition(x, y - 54);
    this.placementStatusText.setText(
      validation.valid
        ? validation.reason
        : deferToServer
          ? `Server will verify: ${validation.reason}`
          : `Invalid: ${validation.reason}`
    );
    this.placementStatusText.setColor(
      validation.valid ? '#7cffb2' : deferToServer ? '#ffd27d' : '#ff7d7d'
    );
  }

  private shouldDeferPlacementValidationToServer(type: string, validation: PlacementValidation): boolean {
    if (validation.valid) return false;
    if (!SERVER_AUTHORITY_PLACEMENT_TYPES.has(type)) return false;
    if (CLIENT_DEFINITE_PLACEMENT_FAILURE_REASONS.has(validation.reason)) return false;
    if (validation.reason.startsWith('Insufficient funds')) return false;
    if (validation.reason.startsWith('Requires nearby')) return false;
    return validation.reason === 'Cannot place here' ||
      validation.reason === 'Bridge nodes need open water and spacing' ||
      validation.reason === 'Naval mines need open water and spacing';
  }

  private tryPlaceCurrentBuilding(screenX: number, screenY: number, keepPlacementMode = false): boolean {
    if (!this.placementMode || !this.placementGhost) return false;

    const worldPoint = this.cameras.main.getWorldPoint(screenX, screenY);
    const validation = this.placementType
      ? this.evaluatePlacement(this.placementType, worldPoint.x, worldPoint.y)
      : { valid: false, reason: 'Invalid placement' };
    const deferToServer = this.placementType
      ? this.shouldDeferPlacementValidationToServer(this.placementType, validation)
      : false;

    if (!validation.valid && !deferToServer) {
      this.updatePlacementPreview(worldPoint.x, worldPoint.y);
      return true;
    }

    socket.emit('build', {
      x: worldPoint.x,
      y: worldPoint.y,
      type: this.placementType
    });

    if (!keepPlacementMode) {
      this.clearPlacementMode();
    }

    return true;
  }

  private getMapStateSignature(mapData: GameMap) {
    const buildingState = mapData.islands
      .flatMap(island =>
        island.buildings.map(building => {
          const queue = building.recruitmentQueue?.[0];
          const queueState = queue
            ? `${queue.unitType}:${Math.round(queue.progress)}:${Math.round(queue.totalTime)}:${building.recruitmentQueue?.length || 0}`
            : 'none';
          return [
            island.id,
            building.id,
            building.type,
            building.ownerId ?? island.ownerId ?? '',
            Math.round(building.health),
            Math.round(building.maxHealth),
            building.isConstructing ? 1 : 0,
            Math.round(building.constructionProgress ?? 0),
            building.hasTesla ? 1 : 0,
            Math.round(building.radiationStacks ?? 0),
            Math.round(building.radiationUntil ?? 0),
            queueState
          ].join(':');
        })
      )
      .join('|');

    const oilState = mapData.oilSpots
      .map(spot => {
        const building = spot.building;
        const queue = building?.recruitmentQueue?.[0];
        const queueState = queue
          ? `${queue.unitType}:${Math.round(queue.progress)}:${Math.round(queue.totalTime)}:${building?.recruitmentQueue?.length || 0}`
          : 'none';

        return [
          spot.id,
          spot.occupiedBy ?? '',
          spot.ownerId ?? '',
          building?.id ?? '',
          building?.type ?? '',
          Math.round(building?.health ?? 0),
          Math.round(building?.maxHealth ?? 0),
          building?.isConstructing ? 1 : 0,
          Math.round(building?.constructionProgress ?? 0),
          Math.round(building?.radiationStacks ?? 0),
          Math.round(building?.radiationUntil ?? 0),
          queueState
        ].join(':');
      })
      .join('|');

    const waterBuildingState = (mapData.waterBuildings || [])
      .map(building => [
        building.id,
        building.type,
        building.ownerId ?? '',
        Math.round(building.x ?? 0),
        Math.round(building.y ?? 0),
        Math.round(building.health),
        Math.round(building.maxHealth),
        building.isConstructing ? 1 : 0,
        Math.round(building.constructionProgress ?? 0),
        Math.round(building.radiationStacks ?? 0),
        Math.round(building.radiationUntil ?? 0)
      ].join(':'))
      .join('|');

    const bridgeState = (mapData.bridges || [])
      .map(bridge => [
        bridge.id,
        bridge.type,
        bridge.nodeAId,
        bridge.nodeBId,
        bridge.ownerId ?? '',
        Math.round(bridge.health ?? 0),
        Math.round(bridge.maxHealth ?? 0)
      ].join(':'))
      .join('|');

    return `${buildingState}#${oilState}#${waterBuildingState}#${bridgeState}`;
  }

  private getSpatialSoundLocation(x: number, y: number) {
    const zoom = this.cameras.main.zoom || 1;
    return {
      x,
      y,
      listenerX: this.cameras.main.scrollX + this.cameras.main.width / (2 * zoom),
      listenerY: this.cameras.main.scrollY + this.cameras.main.height / (2 * zoom),
      viewportWidth: this.cameras.main.width,
      viewportHeight: this.cameras.main.height,
      zoom
    };
  }

  private spawnEconomyBurst(burst: EconomyBurstEvent) {
    const lines: Array<{ text: string; color: string }> = [];
    if (burst.gold > 0) {
      lines.push({ text: `+${Math.round(burst.gold)} gold`, color: '#ffe27a' });
    }
    if (burst.oil > 0) {
      lines.push({ text: `+${Math.round(burst.oil)} oil`, color: '#8be8ff' });
    }
    if (lines.length === 0) return;

    const container = this.add.container(
      burst.x + Phaser.Math.Between(-10, 10),
      burst.y - 26
    );
    container.setDepth(145);

    lines.forEach((line, index) => {
      const label = this.add.text(0, index * 16, line.text, {
        fontSize: '14px',
        fontStyle: 'bold',
        fontFamily: 'Trebuchet MS, sans-serif',
        color: line.color,
        stroke: '#091019',
        strokeThickness: 4,
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: '#000000',
          blur: 6,
          fill: true
        }
      });
      label.setOrigin(0.5, 0.5);
      container.add(label);
    });

    const totalHeight = (lines.length - 1) * 16;
    container.iterate((child: Phaser.GameObjects.GameObject) => {
      if ('y' in child) {
        (child as Phaser.GameObjects.Text).y -= totalHeight / 2;
      }
    });

    this.tweens.add({
      targets: container,
      y: container.y - 34,
      alpha: 0,
      duration: 1400,
      ease: 'Cubic.easeOut',
      onComplete: () => container.destroy()
    });

    this.tweens.add({
      targets: container,
      scaleX: 1.04,
      scaleY: 1.04,
      duration: 220,
      yoyo: true,
      ease: 'Sine.easeOut'
    });
  }

  private collectBuildingAudioSnapshots(mapData: GameMap) {
    const next = new Map<string, BuildingAudioSnapshot>();

    mapData.islands.forEach(island => {
      island.buildings.forEach(building => {
        next.set(building.id, {
          id: building.id,
          type: building.type,
          ownerId: building.ownerId ?? island.ownerId ?? null,
          x: island.x + (building.x ?? 0),
          y: island.y + (building.y ?? 0)
        });
      });
    });

    mapData.oilSpots.forEach(spot => {
      const oilBuilding = (spot as { building?: Building; ownerId?: string | null }).building;
      if (!spot.occupiedBy || !oilBuilding) {
        return;
      }

      next.set(oilBuilding.id, {
        id: oilBuilding.id,
        type: oilBuilding.type,
        ownerId: oilBuilding.ownerId ?? (spot as { ownerId?: string | null }).ownerId ?? null,
        x: spot.x,
        y: spot.y
      });
    });

    (mapData.waterBuildings || []).forEach(building => {
      next.set(building.id, {
        id: building.id,
        type: building.type,
        ownerId: building.ownerId ?? null,
        x: building.x ?? 0,
        y: building.y ?? 0
      });
    });

    return next;
  }

  private syncBuildingPlacementAudio(mapData: GameMap) {
    const nextSnapshot = this.collectBuildingAudioSnapshots(mapData);

    if (!this.buildingAudioPrimed) {
      this.knownBuildingAudioState = nextSnapshot;
      this.buildingAudioPrimed = true;
      return;
    }

    nextSnapshot.forEach(snapshot => {
      if (this.knownBuildingAudioState.has(snapshot.id)) {
        return;
      }

      const ownership = snapshot.ownerId === socket.id
        ? 'self'
        : snapshot.ownerId
          ? 'enemy'
          : 'neutral';

      soundEffectsManager.playBuildingPlacement(
        snapshot.type,
        ownership,
        this.getSpatialSoundLocation(snapshot.x, snapshot.y)
      );
    });

    this.knownBuildingAudioState = nextSnapshot;
  }

  private resolveCombatSoundSource(data: {
    attackerId?: string;
    type: string;
  }) {
    if (data.type === 'tesla') {
      return 'tesla' as const;
    }

    if (data.attackerId) {
      const attacker = this.currentUnits.find(unit => unit.id === data.attackerId);
      if (attacker) {
        return attacker.type;
      }
    }

    if (data.type === 'rocket_missile') {
      return 'aircraft_carrier' as const;
    }

    if (data.type === 'rocketeer_rocket') {
      return 'rocketeer' as const;
    }

    if (data.type === 'cannon_ball') {
      return 'pirate_ship' as const;
    }

    if (data.type === 'heavy_plane_bomb') {
      return 'heavy_plane' as const;
    }

    if (data.type === 'bullet') {
      return 'tower' as const;
    }

    return 'unknown' as const;
  }

  private handleProjectileEvent(data: {
    attackerId?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    type: string;
    speed: number;
    radius?: number;
  }, playSound = true) {
    if (data.type === 'naval_mine_blast') {
      this.renderNavalMineBlast(data.x2, data.y2, data.radius ?? 180);
      return;
    }

    const attackAngle = Math.atan2(data.y2 - data.y1, data.x2 - data.x1);
    const projectileOrigin = this.getProjectileOrigin(data.attackerId, data.x1, data.y1, attackAngle);
    const originX = projectileOrigin.x;
    const originY = projectileOrigin.y;

    this.registerAttackFacing(
      data.attackerId,
      originX,
      originY,
      data.x2,
      data.y2,
      data.type === 'rocket_missile'
        ? 420
        : data.type === 'rocketeer_rocket'
          ? 320
          : data.type === 'heavy_plane_bomb'
            ? 380
          : data.type === 'cannon_ball'
            ? 320
            : 220
    );

    if (playSound) {
      soundEffectsManager.playUnitFire(
        this.resolveCombatSoundSource(data),
        this.getSpatialSoundLocation(originX, originY)
      );
    }

    if (data.type === 'tesla') {
      const graphics = this.add.graphics();
      graphics.lineStyle(2, 0x00FFFF);
      graphics.setDepth(100);

      const points = [];
      const segments = 8;
      const dx = data.x2 - originX;
      const dy = data.y2 - originY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normalX = -dy / dist;
      const normalY = dx / dist;

      points.push({ x: originX, y: originY });
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const px = originX + dx * t;
        const py = originY + dy * t;
        const offset = (Math.random() - 0.5) * 20;
        points.push({
          x: px + normalX * offset,
          y: py + normalY * offset
        });
      }
      points.push({ x: data.x2, y: data.y2 });

      graphics.strokePoints(points);

      this.tweens.add({
        targets: graphics,
        alpha: 0,
        duration: 150,
        onComplete: () => graphics.destroy()
      });

      return;
    }

    if (data.type === 'rocket_missile' || data.type === 'rocketeer_rocket') {
      const isRocketeerRocket = data.type === 'rocketeer_rocket';
      const impactColors = this.getProjectileImpactColors(data.attackerId, {
        core: isRocketeerRocket ? 0xff6f3f : 0xff4500,
        glow: isRocketeerRocket ? 0xffb472 : 0xff9345,
        ring: 0xffffc8,
        smoke: 0x353c45,
        sparkA: 0xffd27a,
        sparkB: 0xfff0d0,
      });
      const rocket = this.add.rectangle(
        originX,
        originY,
        isRocketeerRocket ? 12 : 16,
        isRocketeerRocket ? 4 : 6,
        isRocketeerRocket ? 0x60707c : 0x444444
      );
      rocket.setStrokeStyle(1, 0x000000);
      rocket.setDepth(100);

      const angle = Math.atan2(data.y2 - originY, data.x2 - originX);
      rocket.rotation = angle;

      const dist = Math.hypot(data.x2 - originX, data.y2 - originY);
      const duration = (dist / data.speed) * 1000;

      this.tweens.add({
        targets: rocket,
        x: data.x2,
        y: data.y2,
        duration,
        onComplete: () => {
          const explosion = this.add.circle(data.x2, data.y2, isRocketeerRocket ? 14 : 20, impactColors.core);
          explosion.setDepth(101);

          this.tweens.add({
            targets: explosion,
            scale: isRocketeerRocket ? 3.2 : 6,
            alpha: 0,
            duration: isRocketeerRocket ? 260 : 500,
            onComplete: () => explosion.destroy()
          });

          const glow = this.add.circle(data.x2, data.y2, isRocketeerRocket ? 12 : 20, impactColors.glow, 0.26);
          glow.setDepth(100.5);
          this.tweens.add({
            targets: glow,
            scale: isRocketeerRocket ? 3.4 : 5.8,
            alpha: 0,
            duration: isRocketeerRocket ? 260 : 420,
            onComplete: () => glow.destroy()
          });

          const ring = this.add.circle(data.x2, data.y2, isRocketeerRocket ? 12 : 20, 0xFFFFFF);
          ring.setStrokeStyle(4, impactColors.ring);
          ring.setFillStyle(0xFFFFFF, 0);
          ring.setDepth(101);

          this.tweens.add({
            targets: ring,
            scale: isRocketeerRocket ? 2.8 : 5,
            alpha: 0,
            duration: isRocketeerRocket ? 220 : 300,
            onComplete: () => ring.destroy()
          });

          if (isRocketeerRocket) {
            for (let i = 0; i < 4; i++) {
              const spark = this.add.circle(data.x2, data.y2, 2, i % 2 === 0 ? impactColors.sparkA ?? impactColors.core : impactColors.sparkB ?? impactColors.ring);
              spark.setDepth(101);
              const sparkAngle = (Math.PI * 2 * i) / 4 + Math.random() * 0.4;
              this.tweens.add({
                targets: spark,
                x: data.x2 + Math.cos(sparkAngle) * Phaser.Math.Between(12, 24),
                y: data.y2 + Math.sin(sparkAngle) * Phaser.Math.Between(12, 24),
                alpha: 0,
                scale: 0.2,
                duration: 180,
                onComplete: () => spark.destroy()
              });
            }
          }

          rocket.destroy();
        }
      });

      return;
    }

    if (data.type === 'heavy_plane_bomb') {
      const blastRadius = data.radius ?? 90;
      const impactColors = this.getProjectileImpactColors(data.attackerId, {
        core: 0xff9c3a,
        glow: 0xffc16b,
        ring: 0xffe29a,
        smoke: 0x31373d,
        sparkA: 0xffd27a,
        sparkB: 0xff7a2f,
      });
      const bomb = this.add.circle(originX, originY, 4, 0x3e464f);
      bomb.setStrokeStyle(1, 0x0d1217);
      bomb.setDepth(100);

      const shadow = this.add.ellipse(data.x2, data.y2, 10, 5, 0x000000, 0.12);
      shadow.setDepth(99);
      shadow.setScale(0.3);

      const adjustedDist = Math.hypot(data.x2 - originX, data.y2 - originY);
      const duration = (adjustedDist / data.speed) * 1000;
      const arcHeight = Math.min(40, Math.max(16, adjustedDist * 0.1));
      const arc = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(originX, originY),
        new Phaser.Math.Vector2((originX + data.x2) / 2, (originY + data.y2) / 2 - arcHeight),
        new Phaser.Math.Vector2(data.x2, data.y2)
      );
      const arcState = { t: 0 };

      this.tweens.add({
        targets: shadow,
        scaleX: 1,
        scaleY: 1,
        alpha: 0.2,
        duration
      });

      this.tweens.add({
        targets: arcState,
        t: 1,
        duration,
        onUpdate: () => {
          const point = arc.getPoint(arcState.t);
          bomb.setPosition(point.x, point.y);
          bomb.setScale(0.85 + arcState.t * 0.45);
        },
        onComplete: () => {
          const explosion = this.add.circle(data.x2, data.y2, 16, impactColors.core, 0.92);
          explosion.setDepth(101);

          this.tweens.add({
            targets: explosion,
            scale: Math.max(3.4, blastRadius / 18),
            alpha: 0,
            duration: 360,
            onComplete: () => explosion.destroy()
          });

          const glow = this.add.circle(data.x2, data.y2, Math.max(18, blastRadius * 0.22), impactColors.glow, 0.28);
          glow.setDepth(100.5);
          this.tweens.add({
            targets: glow,
            scale: Math.max(3.6, blastRadius / 16),
            alpha: 0,
            duration: 340,
            onComplete: () => glow.destroy()
          });

          const ring = this.add.circle(data.x2, data.y2, 14, 0xffffff, 0);
          ring.setStrokeStyle(3, impactColors.ring, 0.95);
          ring.setDepth(101);
          this.tweens.add({
            targets: ring,
            scale: Math.max(4.2, blastRadius / 14),
            alpha: 0,
            duration: 320,
            onComplete: () => ring.destroy()
          });

          for (let i = 0; i < 6; i++) {
            const ember = this.add.circle(data.x2, data.y2, 2.2, i % 2 === 0 ? impactColors.sparkA ?? impactColors.core : impactColors.sparkB ?? impactColors.ring);
            ember.setDepth(101);
            const emberAngle = (Math.PI * 2 * i) / 6 + Math.random() * 0.35;
            this.tweens.add({
              targets: ember,
              x: data.x2 + Math.cos(emberAngle) * Phaser.Math.Between(18, 34),
              y: data.y2 + Math.sin(emberAngle) * Phaser.Math.Between(18, 34),
              alpha: 0,
              scale: 0.15,
              duration: 240,
              onComplete: () => ember.destroy()
            });
          }

          const smoke = this.add.circle(data.x2, data.y2, 10, impactColors.smoke ?? 0x31373d, 0.55);
          smoke.setDepth(100);
          this.tweens.add({
            targets: smoke,
            y: data.y2 - 10,
            scale: 2.1,
            alpha: 0,
            duration: 420,
            onComplete: () => smoke.destroy()
          });

          shadow.destroy();
          bomb.destroy();
        }
      });

      return;
    }

    if (data.type === 'cannon_ball') {
      const impactColors = this.getProjectileImpactColors(data.attackerId, {
        core: 0xd7dde4,
        glow: 0xf2f7ff,
        ring: 0xf2f7ff,
        smoke: 0x353e46,
      });
      const cannonBall = this.add.circle(originX, originY, 4, 0x1f2730);
      cannonBall.setStrokeStyle(1, 0x0a1016);
      cannonBall.setDepth(100);

      const dist = Math.hypot(data.x2 - originX, data.y2 - originY);
      const duration = (dist / data.speed) * 1000;
      const arcHeight = Math.min(85, Math.max(24, dist * 0.22));
      const arc = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(originX, originY),
        new Phaser.Math.Vector2((originX + data.x2) / 2, (originY + data.y2) / 2 - arcHeight),
        new Phaser.Math.Vector2(data.x2, data.y2)
      );
      const arcState = { t: 0 };

      this.tweens.add({
        targets: arcState,
        t: 1,
        duration,
        onUpdate: () => {
          const point = arc.getPoint(arcState.t);
          cannonBall.setPosition(point.x, point.y);
        },
        onComplete: () => {
          const splash = this.add.circle(data.x2, data.y2, 9, impactColors.core, 0.8);
          splash.setDepth(101);
          splash.setStrokeStyle(2, impactColors.ring);
          this.tweens.add({
            targets: splash,
            scale: 2.2,
            alpha: 0,
            duration: 220,
            onComplete: () => splash.destroy()
          });

          const glow = this.add.circle(data.x2, data.y2, 10, impactColors.glow, 0.18);
          glow.setDepth(100.5);
          this.tweens.add({
            targets: glow,
            scale: 2,
            alpha: 0,
            duration: 220,
            onComplete: () => glow.destroy()
          });

          const smoke = this.add.circle(data.x2, data.y2, 6, impactColors.smoke ?? 0x353e46, 0.7);
          smoke.setDepth(101);
          this.tweens.add({
            targets: smoke,
            y: data.y2 - 8,
            scale: 1.8,
            alpha: 0,
            duration: 260,
            onComplete: () => smoke.destroy()
          });

          cannonBall.destroy();
        }
      });

      return;
    }

    const dist = Math.hypot(data.x2 - originX, data.y2 - originY);
    const duration = (dist / data.speed) * 1000;

    const attacker = data.attackerId ? this.currentUnits.find((unit) => unit.id === data.attackerId) : undefined;
    const attackerType = attacker?.type;
    const isAlienScout = attackerType === 'alien_scout';
    const isHeavyAlien = attackerType === 'heavy_alien';
    const impactColors = this.getProjectileImpactColors(data.attackerId, {
      core: isHeavyAlien ? 0xf2ddff : isAlienScout ? 0xc5fff7 : 0xffc661,
      glow: isHeavyAlien ? 0xc085ff : isAlienScout ? 0x6ffff1 : 0xffefb6,
      ring: isHeavyAlien ? 0xf7e8ff : isAlienScout ? 0xdbfff8 : 0xffefb6,
      smoke: isHeavyAlien ? 0x281f35 : undefined,
      sparkA: isHeavyAlien ? 0xeeb8ff : isAlienScout ? 0x8ffff7 : undefined,
      sparkB: isHeavyAlien ? 0xffffff : isAlienScout ? 0xffffff : undefined,
    });

    if (isAlienScout || isHeavyAlien) {
      const projectile = this.add.container(originX, originY);
      projectile.setDepth(100);
      projectile.setRotation(Math.atan2(data.y2 - originY, data.x2 - originX));

      const halo = this.add.circle(0, 0, isHeavyAlien ? 9.5 : 6.2, impactColors.glow, isHeavyAlien ? 0.28 : 0.24);
      halo.setBlendMode(Phaser.BlendModes.ADD);
      const shell = this.add.circle(0, 0, isHeavyAlien ? 5.2 : 3.7, impactColors.glow, 0.88);
      shell.setStrokeStyle(1, impactColors.ring, 0.82);
      const core = this.add.circle(0, 0, isHeavyAlien ? 2.6 : 1.9, impactColors.core, 0.96);
      const spine = this.add.rectangle(isHeavyAlien ? -3.4 : -2.2, 0, isHeavyAlien ? 7 : 4.8, isHeavyAlien ? 1.6 : 1.2, impactColors.ring, 0.72);
      projectile.add([halo, shell, spine, core]);

      this.tweens.add({
        targets: projectile,
        x: data.x2,
        y: data.y2,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          halo.setScale(1 + Math.sin(this.time.now * 0.025) * 0.08);
        },
        onComplete: () => {
          const impactGlow = this.add.circle(data.x2, data.y2, isHeavyAlien ? 18 : 12, impactColors.glow, 0.28);
          impactGlow.setBlendMode(Phaser.BlendModes.ADD);
          impactGlow.setDepth(100.5);
          const impactBurst = this.add.circle(data.x2, data.y2, isHeavyAlien ? 11 : 7, impactColors.core, 0.92);
          impactBurst.setDepth(101);
          const impactRing = this.add.circle(data.x2, data.y2, isHeavyAlien ? 10 : 7, impactColors.ring, 0);
          impactRing.setStrokeStyle(isHeavyAlien ? 3 : 2, impactColors.ring, 0.95);
          impactRing.setDepth(101);

          this.tweens.add({
            targets: impactBurst,
            scale: isHeavyAlien ? 2.25 : 1.8,
            alpha: 0,
            duration: isHeavyAlien ? 180 : 140,
            onComplete: () => impactBurst.destroy()
          });
          this.tweens.add({
            targets: impactGlow,
            scale: isHeavyAlien ? 2.8 : 2.2,
            alpha: 0,
            duration: isHeavyAlien ? 240 : 180,
            onComplete: () => impactGlow.destroy()
          });
          this.tweens.add({
            targets: impactRing,
            scale: isHeavyAlien ? 2.5 : 2,
            alpha: 0,
            duration: isHeavyAlien ? 220 : 170,
            onComplete: () => impactRing.destroy()
          });

          if (isHeavyAlien) {
            for (let i = 0; i < 4; i += 1) {
              const spark = this.add.circle(data.x2, data.y2, 2.1, i % 2 === 0 ? (impactColors.sparkA ?? impactColors.core) : (impactColors.sparkB ?? impactColors.ring), 0.92);
              spark.setDepth(101);
              const sparkAngle = (Math.PI * 2 * i) / 4 + Math.random() * 0.25;
              this.tweens.add({
                targets: spark,
                x: data.x2 + Math.cos(sparkAngle) * Phaser.Math.Between(10, 20),
                y: data.y2 + Math.sin(sparkAngle) * Phaser.Math.Between(10, 20),
                scale: 0.2,
                alpha: 0,
                duration: 170,
                onComplete: () => spark.destroy(),
              });
            }
          }

          projectile.destroy();
        }
      });

      return;
    }

    const bullet = this.add.circle(originX, originY, 3, 0xFFFF00);
    bullet.setStrokeStyle(1, 0xFFAA00);
    bullet.setDepth(100);

    this.tweens.add({
      targets: bullet,
      x: data.x2,
      y: data.y2,
      duration,
      onComplete: () => {
        const impact = this.add.circle(data.x2, data.y2, 5, impactColors.core);
        const impactGlow = this.add.circle(data.x2, data.y2, 8, impactColors.glow, 0.26);
        impactGlow.setDepth(100.5);
        this.tweens.add({
          targets: impact,
          scale: 0,
          alpha: 0,
          duration: 100,
          onComplete: () => impact.destroy()
        });
        this.tweens.add({
          targets: impactGlow,
          scale: 1.8,
          alpha: 0,
          duration: 120,
          onComplete: () => impactGlow.destroy()
        });
        bullet.destroy();
      }
    });
  }

  preload() {
    this.load.audio('defcat_main_menu', 'assets/audio/defcat_new_menu.mp3');
    this.load.audio('ingame_music', 'assets/audio/cut_the_wire.mp3');
    this.load.audio('shoot', 'assets/audio/shoot.wav');
    this.load.audio('explosion', 'assets/audio/explosion.wav');
    this.load.audio('recruit', 'assets/audio/recruit.wav');
    this.load.audio('move_land', 'assets/audio/move_land.wav');
    this.load.audio('move_water', 'assets/audio/move_water.wav');
    this.load.audio('move_air', 'assets/audio/move_air.wav');
  }

  create() {
    this.cameras.main.setBackgroundColor('#006994'); // Ocean color

    // Apply initial settings
    const settings = settingsManager.getSettings();
    this.sound.volume = settings.audio.masterVolume;
    this.game.loop.targetFps = settings.graphics.targetFps || 60;

    // Audio
    this.mainMenuMusic = this.sound.add('defcat_main_menu', { loop: true, volume: settings.audio.musicVolume });
    this.ingameMusic = this.sound.add('ingame_music', { loop: true, volume: settings.audio.musicVolume });

    // Setup Audio Analyser for Shake Effect
    if (this.sound instanceof Phaser.Sound.WebAudioSoundManager) {
        try {
            this.analyser = this.sound.context.createAnalyser();
            this.analyser.fftSize = 256;
            // Connect master volume to analyser (fan-out)
            const manager = this.sound as any;
            if (manager.masterVolumeNode) {
                manager.masterVolumeNode.connect(this.analyser);
            }
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        } catch (e) {
            console.warn('Audio Analyser setup failed:', e);
        }
    }

    this.islandsGroup = this.add.group();
    this.unitsGroup = this.add.group();
    
    // Graphics for ranges (below units)
    this.rangeGraphics = this.add.graphics();
    this.rangeGraphics.setDepth(5);
    
    // Graphics for paths (below units)
    this.pathGraphics = this.add.graphics();
    this.pathGraphics.setDepth(5);

    // NEW: Global Overlay for Oil Scanner Pings (Depth 1000 - Above EVERYTHING)
    this.scannerOverlay = this.add.graphics();
    this.scannerOverlay.setDepth(1000);

    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(100); // Draw on top

    this.menuGraphics = this.add.graphics();
    this.menuGraphics.setDepth(200);

    // Debug Graphics
    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(2000);
    this.debugTextGroup = this.add.group();
    this.debugTextGroup.setDepth(2001);

    // Listen for Debug Data
    socket.on('botDebugData', (data: any[]) => {
        this.lastDebugData = data;
    });

    // Listen for Building Damage (Audio Alerts)
    socket.on('buildingDamaged', this.handleBuildingDamage);
    socket.on('economyBurst', (bursts: EconomyBurstEvent[]) => {
        bursts.forEach((burst) => this.spawnEconomyBurst(burst));
    });

    // Toggle Debug View
    window.addEventListener('toggle-debug-view', ((e: CustomEvent) => {
        this.showDebugView = e.detail.show;
        if (!this.showDebugView) {
            this.debugGraphics.clear();
        }
    }) as EventListener);

    // Menu Mode Handler
    window.addEventListener('game-menu-mode', ((e: CustomEvent) => {
        this.setMenuMode(e.detail);
        if (e.detail) {
            // Enter Menu: Stop Ingame, Play Menu
            if (this.ingameMusic && this.ingameMusic.isPlaying) {
                this.ingameMusic.stop();
            }
            if (this.mainMenuMusic && !this.mainMenuMusic.isPlaying) {
                this.mainMenuMusic.play();
            }
        } else {
            // Enter Game: Stop Menu, Play Ingame
            if (this.mainMenuMusic && this.mainMenuMusic.isPlaying) {
                this.mainMenuMusic.stop();
            }
            if (this.ingameMusic && !this.ingameMusic.isPlaying) {
                this.ingameMusic.play();
            }
        }
    }) as EventListener);

    const initialSkinLoadout = (window as Window & { agSkinLoadout?: SkinLoadout }).agSkinLoadout;
    if (initialSkinLoadout) {
        this.activeSkinLoadout = {
            unitSkinId: initialSkinLoadout.unitSkinId || 'default',
            buildingSkinId: initialSkinLoadout.buildingSkinId || 'default',
        };
    }

    window.addEventListener('ag:skin-loadout-changed', ((e: CustomEvent<SkinLoadout>) => {
        const nextLoadout = e.detail;
        if (!nextLoadout) return;

        const sameUnitSkin = nextLoadout.unitSkinId === this.activeSkinLoadout.unitSkinId;
        const sameBuildingSkin = nextLoadout.buildingSkinId === this.activeSkinLoadout.buildingSkinId;
        if (sameUnitSkin && sameBuildingSkin) return;

        this.activeSkinLoadout = {
            unitSkinId: nextLoadout.unitSkinId || 'default',
            buildingSkinId: nextLoadout.buildingSkinId || 'default',
        };

        if (this.currentUnits.length > 0) {
            this.renderUnits(this.currentUnits);
        }
        if (this.currentMap) {
            this.renderMap(this.currentMap);
        }
    }) as EventListener);

    // Spectator Mode Handler
    window.addEventListener('enable-spectator-mode', (() => {
        this.isSpectating = true;
        this.isMenuMode = false; // Ensure we are not in menu mode (so camera works)
        
        // Clear Selection
        this.selectedUnitIds.clear();
        this.selectedBuildingIds.clear();
        this.selectedNodeIds.clear();
        window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
        window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));

        // Disable Placement
        if (this.placementMode) {
            this.clearPlacementMode();
        }

        // Disable Selection Box
        this.isSelecting = false;
        if (this.selectionGraphics) this.selectionGraphics.clear();

        console.log('[MainScene] Spectator Mode Enabled');
    }) as EventListener);

    // Toggle Oil Scanner
    window.addEventListener('toggle-oil-scanner', ((e: CustomEvent) => {
        this.showOilScanner = e.detail.show;
        if (!this.showOilScanner) {
            // Cleanup visuals immediately
            this.rangeGraphics.clear();
            
            // Note: We do NOT hide revealed spots anymore. 
            // Once revealed, they stay revealed (Client-side persistence)
            // This allows players to build on them even if they turn off the scanner view.
        } else {
            // Force update immediately
            this.updateOilScanner();
        }
    }) as EventListener);

    // Initial State
    // Default to true (Menu Mode) if undefined to prevent flashing game state before App controls it
    // But if we are already playing (reloaded page into game), App might set it to false quickly.
    // We check the global flag set by App.tsx
    this.isMenuMode = (window as any).gameMenuMode !== false; 
    
    if (this.isMenuMode) {
        this.setMenuMode(true);
        if (this.mainMenuMusic && !this.mainMenuMusic.isPlaying) {
            this.mainMenuMusic.play();
        }
        if (this.ingameMusic && this.ingameMusic.isPlaying) {
            this.ingameMusic.stop();
        }
    } else {
        // If not in menu mode, ensure we are ready to render
        this.setMenuMode(false);
        if (this.mainMenuMusic && this.mainMenuMusic.isPlaying) {
            this.mainMenuMusic.stop();
        }
        if (this.ingameMusic && !this.ingameMusic.isPlaying) {
            this.ingameMusic.play();
        }
    }

    // Listen for settings changes
    const onSettingsChange = (newSettings: Settings) => {
        this.sound.volume = newSettings.audio.masterVolume;
        if (this.mainMenuMusic) {
            (this.mainMenuMusic as any).setVolume(newSettings.audio.musicVolume);
        }
        if (this.ingameMusic) {
            (this.ingameMusic as any).setVolume(newSettings.audio.musicVolume);
        }
        this.game.loop.targetFps = newSettings.graphics.targetFps || 60;
        
        // Re-render map to apply graphics settings (particles, weather)
        if (this.currentMap) {
            this.renderMap(this.currentMap);
            // Also re-render units to update their ranges/details if needed
            this.renderUnits(this.currentUnits);
        }
    };
    settingsManager.on('change', onSettingsChange);
    this.events.on('shutdown', () => {
        settingsManager.off('change', onSettingsChange);
        socket.off('buildingDamaged', this.handleBuildingDamage);
        socket.off('economyBurst');
    });

    this.input.mouse!.disableContextMenu();

    // IME Composition Handlers (Chinese Input Optimization)
    window.addEventListener('compositionstart', () => {
        this.isComposing = true;
    });
    window.addEventListener('compositionend', () => {
        this.isComposing = false;
    });

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
        // Ignore game inputs if typing in an input field OR using IME (Chinese/Japanese/etc) OR Spectating
        if (this.isComposing || this.isSpectating) return;
        if ((event.target as HTMLElement).tagName === 'INPUT') return;

        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        const binds = settingsManager.getSettings().keybinds;

        if (key === binds.clearSelection) {
            this.selectedUnitIds.clear();
            this.selectedBuildingIds.clear();
            this.selectedNodeIds.clear();
            
            this.renderUnits(this.currentUnits);
            if (this.currentMap) this.renderMap(this.currentMap);

            window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                detail: { unitIds: [] } 
            }));
            window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                detail: { buildingIds: [] } 
            }));
            window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                detail: { nodes: [] } 
            }));
        } else if (key === binds.loadFerry) {
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            
            // Find ferry at mouse position
            const ferry = this.currentUnits.find(u => 
                u.type === 'ferry' && 
                u.ownerId === socket.id &&
                Math.hypot(u.x - worldPoint.x, u.y - worldPoint.y) < 40
            );

            if (ferry) {
                 const unitIdsToLoad = Array.from(this.selectedUnitIds).filter(id => {
                     const u = this.currentUnits.find(unit => unit.id === id);
                     // Basic validation (land unit)
                     return u && ['soldier', 'sniper', 'rocketeer', 'builder'].includes(u.type);
                 });
                 
                 if (unitIdsToLoad.length > 0) {
                     socket.emit('load', { ferryId: ferry.id, unitIds: unitIdsToLoad });
                 }
            }
        } else if (key === binds.unloadFerry) {
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            
            this.selectedUnitIds.forEach(id => {
                const unit = this.currentUnits.find(u => u.id === id);
                if (unit && unit.type === 'ferry') {
                     socket.emit('unload', { ferryId: unit.id, x: worldPoint.x, y: worldPoint.y });
                }
            });
        } else if (key === binds.cancel) {
            if (this.placementMode) {
                this.clearPlacementMode();
            }
            if (this.targetSelectionMode) {
                this.targetSelectionMode = false;
                this.targetSelectionCallback = null;
                this.input.setDefaultCursor('default');
            }
            if (this.selectedUnitIds.size > 0) {
                this.selectedUnitIds.clear();
                this.renderUnits(this.currentUnits);
                window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                    detail: { unitIds: [] } 
                }));
            }
        }
    });

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    // Cleanup when starting a new game (Fixes Ghost Units)
    const handleGameStartCleanup = () => {
        console.log('[MainScene] Clearing Game State for New Game');
        this.currentUnits = [];
        this.clearPlacementMode();
        this.motionTrailSegments.forEach((segment) => segment.sprite.destroy());
        this.motionTrailSegments = [];
        this.unitTrailStates.clear();
        this.unitContainers.clear();
        this.unitUpdates.clear();
        this.attackFacingOverrides.clear();
        this.unitsGroup.clear(true, true);
        this.selectedUnitIds.clear();
        this.selectedBuildingIds.clear();
        this.selectedNodeIds.clear();
        this.cameraInitialized = false; // Reset camera so it centers on new base
        this.currentMapVersion = null; // Force map re-render
        this.currentMapStateSignature = null;
        this.knownBuildingAudioState.clear();
        this.buildingAudioPrimed = false;
        this.goldSparkles = [];
        window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
        window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
    };

    socket.on('gameStarted', handleGameStartCleanup);
    socket.on('joinedRoom', () => {
        // Only clear if joining a non-lobby room or if we want to reset state
        // Usually safe to clear when switching rooms
        // handleGameStartCleanup(); // DISABLED: Causing resets on reconnect/sync
    });

    socket.on('playersData', (players: Player[]) => {
      this.players.clear();
      players.forEach(p => this.players.set(p.id, p));
      if (this.placementMode) {
          const pointer = this.input.activePointer;
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.updatePlacementPreview(worldPoint.x, worldPoint.y);
      }
    });

            socket.on('mapData', (mapData: GameMap) => {
            const mapStateSignature = this.getMapStateSignature(mapData);
            const mapVersion = mapData.version;
            if (
                mapVersion &&
                mapVersion === this.currentMapVersion &&
                mapStateSignature === this.currentMapStateSignature
            ) {
                return;
            }
            
            if (!this.isMenuMode) {
                this.syncBuildingPlacementAudio(mapData);
            }

            this.currentMapVersion = mapVersion || null;
            this.currentMapStateSignature = mapStateSignature;
            this.currentMap = mapData;
            if (this.isMenuMode) return;
            this.renderMap(mapData);
            if (this.placementMode) {
                const pointer = this.input.activePointer;
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                this.updatePlacementPreview(worldPoint.x, worldPoint.y);
            }

            if (!this.cameraInitialized) {
                if (this.centerCameraOnBase()) {
                    this.cameraInitialized = true;
                }
            }
            
            setTimeout(() => {
                if (this.isMenuMode) return;
                if (!socket.id) return;
                if (!this.currentMap || this.currentMap.islands.length === 0) return;
                const me = this.players.get(socket.id);
                if (me && ((me as any).canBuildHQ === false || me.status === 'eliminated' || (me as any).hqSpawnedOnce)) return;

                const bases = this.currentMap?.islands.flatMap(i => i.buildings.filter(b => b.type === 'base'));
                console.log(`[SpawnSanity] Checking for HQ. SocketID: ${socket.id}. Total Bases: ${bases?.length}`);

                const myBase = this.currentMap?.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
                if (!myBase) {
                    console.warn('[SpawnSanity] HQ not visible in current client map snapshot yet. Requesting a fresh sync instead of forcing a respawn.', socket.id);
                    
                    const errorText = this.add.text(this.scale.width/2, 100, 'SYNCING HQ ASSIGNMENT...', {
                        fontSize: '28px',
                        color: '#ffff00',
                        backgroundColor: '#000000'
                    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);

                    socket.emit('request_game_state');

                    setTimeout(() => {
                         const retryBase = this.currentMap?.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
                         if (retryBase) {
                             errorText.destroy();
                             console.log('[SpawnSanity] HQ appeared after fresh state sync.');
                             this.centerCameraOnBase();
                             return;
                         }

                         errorText.setText('WAITING FOR HQ SYNC...');
                         errorText.setColor('#ffcc66');
                         setTimeout(() => {
                             if (errorText && (errorText as any).active) {
                                 errorText.destroy();
                             }
                         }, 4000);
                    }, 2000);
                } else {
                    console.log('[SpawnSanity] HQ confirmed.');
                }
            }, 5000);
        });

    socket.on('unitsData', (units: Unit[]) => {
      // Audio Logic: Compare old units vs new units
      if (!this.isMenuMode) {
          const oldUnitIds = new Set(this.currentUnits.map(u => u.id));
          const newUnitIds = new Set(units.map(u => u.id));
          const recruitVolume = soundEffectsManager.getEffectVolume('recruit', 0.4);

          // Check for Deaths (in old but not in new)
          this.currentUnits.forEach(u => {
              if (!newUnitIds.has(u.id)) {
                  // Unit died - Play Explosion
                  // Only play if on screen or close? For now, global if not too spammy.
                  // Or use createExplosion which handles sound + visual
                  this.createExplosion(u.x, u.y, u.ownerId === socket.id ? 0x00ff00 : 0xff0000);
              }
          });

          // Check for Recruits (in new but not in old)
          units.forEach(u => {
              if (!oldUnitIds.has(u.id)) {
                  // New unit spawned
                  if (u.ownerId === socket.id && recruitVolume > 0) {
                      try {
                          this.sound.play('recruit', { volume: recruitVolume });
                      } catch (e) {}
                  }
              }
          });
      }

      this.currentUnits = units;
      if (this.isMenuMode) return;

      const now = Date.now();
      units.forEach(u => {
          if (!this.unitUpdates.has(u.id)) {
              this.unitUpdates.set(u.id, []);
              // Initialize with current pos to avoid jump
              this.unitUpdates.get(u.id)!.push({ x: u.x, y: u.y, time: now - 200 }); 
          }
          const history = this.unitUpdates.get(u.id)!;
          history.push({ x: u.x, y: u.y, time: now });
          if (history.length > 20) history.shift();
      });

      this.renderUnits(units);
    });

    socket.on('projectile', (data: { attackerId?: string, x1: number, y1: number, x2: number, y2: number, type: string, speed: number, radius?: number }) => {
        this.handleProjectileEvent(data);
    });

    socket.on('projectilesBatch', (projectiles: { attackerId?: string, x1: number, y1: number, x2: number, y2: number, type: string, speed: number, radius?: number }[]) => {
        projectiles.forEach(projectile => this.handleProjectileEvent(projectile));
    });

    socket.on('laserBeam', (data: { attackerId: string, targetId: string, x1: number, y1: number, x2: number, y2: number, duration: number, color: number }) => {
        const initialAngle = Math.atan2(data.y2 - data.y1, data.x2 - data.x1);
        const initialOrigin = this.getProjectileOrigin(data.attackerId, data.x1, data.y1, initialAngle);
        this.registerAttackFacing(data.attackerId, initialOrigin.x, initialOrigin.y, data.x2, data.y2, data.duration);
        soundEffectsManager.playUnitFire('mothership', this.getSpatialSoundLocation(initialOrigin.x, initialOrigin.y));
        const beamColors = this.getMothershipBeamColors(data.attackerId, data.color);
        const beam = this.add.graphics();
        beam.setDepth(WORLD_LASER_BEAM_DEPTH);

        const impact = this.add.container(data.x2, data.y2);
        impact.setDepth(WORLD_LASER_BEAM_DEPTH + 0.1);

        const impactGlow = this.add.circle(0, 0, 54, beamColors.glowColor, 0.34);
        impactGlow.setBlendMode(Phaser.BlendModes.ADD);
        const impactBurst = this.add.circle(0, 0, 30, beamColors.impactColor, 0.52);
        const impactCore = this.add.circle(0, 0, 16, beamColors.coreColor, 0.94);
        const impactRing = this.add.circle(0, 0, 40, beamColors.beamColor, 0);
        impactRing.setStrokeStyle(4.2, beamColors.beamColor, 0.96);

        const impactSparkHorizontal = this.add.rectangle(0, 0, 48, 3.4, beamColors.flareColor, 0.74);
        const impactSparkVertical = this.add.rectangle(0, 0, 3.4, 48, beamColors.flareColor, 0.74);
        const impactSparkDiagA = this.add.rectangle(0, 0, 42, 2.8, beamColors.flareColor, 0.56);
        impactSparkDiagA.setRotation(Math.PI / 4);
        const impactSparkDiagB = this.add.rectangle(0, 0, 42, 2.8, beamColors.flareColor, 0.56);
        impactSparkDiagB.setRotation(-Math.PI / 4);

        impact.add([
            impactGlow,
            impactBurst,
            impactRing,
            impactSparkHorizontal,
            impactSparkVertical,
            impactSparkDiagA,
            impactSparkDiagB,
            impactCore,
        ]);

        const impactTweens = [
            this.tweens.add({
                targets: impactGlow,
                scale: { from: 0.72, to: 1.28 },
                alpha: { from: 0.28, to: 0.08 },
                duration: 260,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            }),
            this.tweens.add({
                targets: impactBurst,
                scale: { from: 0.7, to: 1.42 },
                alpha: { from: 0.48, to: 0.14 },
                duration: 220,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            }),
            this.tweens.add({
                targets: impactRing,
                scale: { from: 0.62, to: 1.34 },
                alpha: { from: 0.98, to: 0.2 },
                duration: 260,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            }),
            this.tweens.add({
                targets: [impactSparkHorizontal, impactSparkVertical, impactSparkDiagA, impactSparkDiagB],
                alpha: { from: 0.32, to: 0.88 },
                scaleX: { from: 0.84, to: 1.16 },
                scaleY: { from: 0.84, to: 1.16 },
                duration: 180,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            }),
            this.tweens.add({
                targets: impactCore,
                scale: { from: 0.92, to: 1.16 },
                alpha: { from: 0.82, to: 1 },
                duration: 180,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            }),
        ];
        
        const beamState = { width: 7.8, auraPulse: 1, alpha: 1 };
        const impactCoverRadius = 52;

        const drawBeam = () => {
            beam.clear();

            // Dynamic Positions
            let x1 = initialOrigin.x;
            let y1 = initialOrigin.y;
            let x2 = data.x2;
            let y2 = data.y2;

            const target = this.unitContainers.get(data.targetId);
            if (target) {
                x2 = target.x;
                y2 = target.y;
            }

            const attacker = this.unitContainers.get(data.attackerId);
            if (attacker) {
                const liveOrigin = this.getProjectileOrigin(
                    data.attackerId,
                    attacker.x,
                    attacker.y,
                    Math.atan2(y2 - attacker.y, x2 - attacker.x)
                );
                x1 = liveOrigin.x;
                y1 = liveOrigin.y;
            }

            impact.setPosition(x2, y2);

            const dx = x2 - x1;
            const dy = y2 - y1;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const nx = dx / distance;
            const ny = dy / distance;
            const attackerSnapshot = this.getUnitSnapshotById(data.attackerId);
            const startInset = attackerSnapshot?.type === 'mothership' ? 62 : 18;
            const beamStartX = x1 + nx * Math.min(startInset, distance * 0.4);
            const beamStartY = y1 + ny * Math.min(startInset, distance * 0.4);
            const beamEndX = x2 - nx * impactCoverRadius;
            const beamEndY = y2 - ny * impactCoverRadius;
            const outerWidth = beamState.width * (2.7 + beamState.auraPulse * 0.46);
            const midWidth = beamState.width * (1.84 + beamState.auraPulse * 0.24);

            beam.lineStyle(outerWidth, beamColors.glowColor, beamState.alpha * 0.18);
            beam.beginPath();
            beam.moveTo(beamStartX, beamStartY);
            beam.lineTo(beamEndX, beamEndY);
            beam.strokePath();

            beam.lineStyle(midWidth, beamColors.glowColor, beamState.alpha * 0.34);
            beam.beginPath();
            beam.moveTo(beamStartX, beamStartY);
            beam.lineTo(beamEndX, beamEndY);
            beam.strokePath();

            beam.lineStyle(beamState.width, beamColors.beamColor, beamState.alpha * 0.96);
            beam.beginPath();
            beam.moveTo(beamStartX, beamStartY);
            beam.lineTo(beamEndX, beamEndY);
            beam.strokePath();
            
            beam.lineStyle(Math.max(2, beamState.width * 0.34), beamColors.coreColor, beamState.alpha);
            beam.beginPath();
            beam.moveTo(beamStartX, beamStartY);
            beam.lineTo(beamEndX, beamEndY);
            beam.strokePath();
        };

        drawBeam();

        const tween = this.tweens.add({
            targets: beamState,
            width: { from: 7.1, to: 12.2 },
            auraPulse: { from: 0.72, to: 1.24 },
            duration: 180,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            onUpdate: () => {
                if (!beam.scene) {
                    tween.stop();
                    return;
                }
                drawBeam();
            }
        });

        this.time.delayedCall(data.duration, () => {
            tween.stop();
            impactTweens.forEach((impactTween) => impactTween.stop());
            if (beam.scene) {
                this.tweens.add({
                    targets: beamState,
                    alpha: 0,
                    duration: 300,
                    ease: 'Quad.easeOut',
                    onUpdate: () => drawBeam(),
                    onComplete: () => {
                        if (beam.scene) beam.destroy();
                    }
                });
            }
            if (impact.scene) {
                this.tweens.add({
                    targets: impact,
                    alpha: 0,
                    duration: 300,
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        if (impact.scene) impact.destroy();
                    }
                });
            }
        });
    });

    socket.on('abilityEffect', (data: { type: string, unitId: string, oilSpotIds: string[], duration: number, range?: number }) => {
        if (data.type === 'reveal_oil') {
            // Update revealed set
            data.oilSpotIds.forEach(id => this.revealedOilSpots.add(id));
            
            // Dispatch for Minimap
            window.dispatchEvent(new CustomEvent('oil-revealed', { 
                detail: { ids: Array.from(this.revealedOilSpots) } 
            }));

            data.oilSpotIds.forEach(id => {
                const visuals = this.oilSpotVisuals.get(id);
                if (visuals) {
                    visuals.main.setVisible(true);
                    visuals.pulse.setVisible(true);
                    
                    // Pop effect to make it "super easy to see"
                    this.tweens.add({
                        targets: [visuals.main, visuals.pulse],
                        scale: { from: 0, to: 1.5 }, // Scale up 50% larger than normal
                        alpha: { from: 1, to: 0.8 },
                        duration: 500,
                        yoyo: true,
                        repeat: 2,
                        onComplete: () => {
                             // Settle at slightly larger size for visibility
                             visuals.main.setScale(1.2);
                             visuals.pulse.setScale(1.2);
                        }
                    });

                    // Hide after duration
                    this.time.delayedCall(data.duration, () => {
                        // Fade out effect
                        this.tweens.add({
                            targets: [visuals.main, visuals.pulse],
                            alpha: 0,
                            scale: 0,
                            duration: 1000, // 1 second fade out
                            onComplete: () => {
                                this.revealedOilSpots.delete(id);
                                
                                // Check visuals again
                                const currentVisuals = this.oilSpotVisuals.get(id);
                                // Only hide if it's still a hidden spot (not converted to permanent)
                                if (currentVisuals && id.startsWith('hidden_oil_')) {
                                    currentVisuals.main.setVisible(false);
                                    currentVisuals.pulse.setVisible(false);
                                    // Reset scale/alpha for next time
                                    currentVisuals.main.setScale(1);
                                    currentVisuals.main.setAlpha(0.8);
                                    currentVisuals.pulse.setScale(1);
                                }
                                
                                // Dispatch update
                                window.dispatchEvent(new CustomEvent('oil-revealed', { 
                                     detail: { ids: Array.from(this.revealedOilSpots) } 
                                }));
                            }
                        });
                    });
                }
            });
            
            // Visual feedback on unit (expanding ring)
            const unit = this.currentUnits.find(u => u.id === data.unitId);
            if (unit) {
                 const ring = this.add.circle(unit.x, unit.y, 10, 0xFFFF00, 0);
                 ring.setStrokeStyle(2, 0xFFFF00);
                 this.tweens.add({
                     targets: ring,
                     radius: data.range || 300,
                     alpha: 0,
                     duration: 1000,
                     onComplete: () => ring.destroy()
                 });
            }
        }
    });

    // Placement Event
    window.addEventListener('enter-placement-mode', (e: any) => {
        this.clearPlacementMode();
        this.placementMode = true;
        this.placementType = e.detail.type;
        this.placementGhost = this.drawDetailedBuilding(0, 0, this.placementType!, 0xAAFFAA);
        applySkinToArtContainer(this, this.placementGhost, this.activeSkinLoadout.buildingSkinId, 'building');
        this.placementGhost.setAlpha(0.6);
        this.placementGhost.setDepth(200);

        // Visual Hitbox / Exclusion Zone for Farm
        if (this.placementType === 'farm') {
            // Exclusion Zone (80px radius where other farms cannot be)
            const exclusion = this.add.circle(0, 0, 80, 0xFF0000, 0.15);
            exclusion.setStrokeStyle(2, 0xFF0000, 0.5);
            this.placementGhost.add(exclusion);
            
            // Physical Hitbox (30px radius)
            const hitbox = this.add.circle(0, 0, 30, 0x00FF00, 0.2);
            hitbox.setStrokeStyle(2, 0x00FF00, 0.8);
            this.placementGhost.add(hitbox);
        }

        const pointer = this.input.activePointer;
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.updatePlacementPreview(worldPoint.x, worldPoint.y);
    });

    // Ferry Events
    window.addEventListener('load-nearby', (e: any) => {
        const ferryId = e.detail.ferryId;
        const ferry = this.currentUnits.find(u => u.id === ferryId);
        if (ferry) {
             // Find nearby loadable units
             const loadable = this.currentUnits.filter(u => 
                 u.ownerId === socket.id &&
                 ['soldier', 'sniper', 'rocketeer', 'builder'].includes(u.type) &&
                 Math.hypot(u.x - ferry.x, u.y - ferry.y) < 100
             );
             const unitIds = loadable.map(u => u.id);
             if (unitIds.length > 0) {
                 socket.emit('load', { ferryId, unitIds });
             }
        }
    });

    window.addEventListener('enter-unload-mode', (e: any) => {
        const ferryId = e.detail.ferryId;
        this.targetSelectionMode = true;
        this.targetSelectionCallback = (x, y) => {
            socket.emit('unload', { ferryId, x, y });
        };
        // Visual cursor change?
        this.input.setDefaultCursor('crosshair');
    });

    window.addEventListener('request-deselect', (e: any) => {
        const { type, id } = e.detail;
        if (type === 'unit') {
            if (this.selectedUnitIds.has(id)) {
                this.selectedUnitIds.delete(id);
                this.renderUnits(this.currentUnits);
                window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                    detail: { unitIds: Array.from(this.selectedUnitIds) } 
                }));
            }
        } else if (type === 'building') {
            if (this.selectedBuildingIds.has(id)) {
                this.selectedBuildingIds.delete(id);
                if (this.currentMap) this.renderMap(this.currentMap);
                window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                    detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
                }));
            }
        } else if (type === 'node') {
            if (this.selectedNodeIds.has(id)) {
                this.selectedNodeIds.delete(id);
                if (this.currentMap) this.renderMap(this.currentMap);
                window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                    detail: { nodes: Array.from(this.selectedNodeIds) } 
                }));
            }
        }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (this.isSpectating) return;
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        
        if (this.placementMode && this.placementGhost) {
            this.updatePlacementPreview(worldPoint.x, worldPoint.y);
        }

        if (this.isSelecting) {
            const worldStart = this.cameras.main.getWorldPoint(this.selectionStart.x, this.selectionStart.y);
            const worldEnd = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

            this.selectionGraphics.clear();
            this.selectionGraphics.lineStyle(1, 0x00ff00);
            this.selectionGraphics.fillStyle(0x00ff00, 0.3);

            const x = Math.min(worldStart.x, worldEnd.x);
            const y = Math.min(worldStart.y, worldEnd.y);
            const w = Math.abs(worldEnd.x - worldStart.x);
            const h = Math.abs(worldEnd.y - worldStart.y);

            this.selectionGraphics.fillRect(x, y, w, h);
            this.selectionGraphics.strokeRect(x, y, w, h);
        }
    });

    // Input Events
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // Ignore inputs if in menu mode or spectating
        if (this.isMenuMode || this.isSpectating) return;

        if (this.placementMode && this.placementGhost) {
            if (pointer.leftButtonDown()) {
                this.tryPlaceCurrentBuilding(pointer.x, pointer.y, !!pointer.event?.shiftKey);
            } else if (pointer.rightButtonDown()) {
                this.clearPlacementMode();
            }
            return;
        }

        if (this.targetSelectionMode) {
             if (pointer.leftButtonDown()) {
                 const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                 if (this.targetSelectionCallback) {
                     this.targetSelectionCallback(worldPoint.x, worldPoint.y);
                 }
                 this.targetSelectionMode = false;
                 this.targetSelectionCallback = null;
                 this.input.setDefaultCursor('default');
             } else if (pointer.rightButtonDown()) {
                 this.targetSelectionMode = false;
                 this.targetSelectionCallback = null;
                 this.input.setDefaultCursor('default');
             }
             return;
        }

        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        if (pointer.leftButtonDown()) {
             // Move Command (Left click is now move)
             if (this.selectedUnitIds.size > 0) {
                 this.issueMoveCommand(worldPoint.x, worldPoint.y);
             }
        } else if (pointer.rightButtonDown()) {
             // Check if clicking on a unit
             const clickedUnit = this.currentUnits.find(u => 
                u.ownerId === socket.id && 
                Math.hypot(u.x - worldPoint.x, u.y - worldPoint.y) < 30 // Hitbox
             );

             if (clickedUnit) {
                 const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                 
                 if (!isMultiSelect) {
                     this.selectedUnitIds.clear();
                 }

                 // Add to selection (Toggle if multi-select?)
                 // Standard RTS: Click always selects. Shift+Click toggles or adds.
                 // For simplicity, let's just add.
                 this.selectedUnitIds.add(clickedUnit.id);
                 
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                     detail: { unitIds: Array.from(this.selectedUnitIds) } 
                 }));
                 // Don't start box selection if clicked unit
                 return;
             }
             
             // If units are selected and we click ground -> Deselect (standard RTS)
             // But we want to allow drag selection start.
             // So we just fall through to "Start box selection"


             // Otherwise start box selection
             this.isSelecting = true;
             this.selectionStart.set(pointer.x, pointer.y);
        }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (this.isSpectating) return;
        if (this.isSelecting) {
            this.isSelecting = false;
            this.selectionGraphics.clear();
            
            if (pointer.rightButtonReleased()) {
                const worldStart = this.cameras.main.getWorldPoint(this.selectionStart.x, this.selectionStart.y);
                const worldEnd = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                
                const w = Math.abs(worldEnd.x - worldStart.x);
                const h = Math.abs(worldEnd.y - worldStart.y);
                
                if (w > 10 || h > 10) {
                    // Box Selection - Add to selection
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                        this.selectedBuildingIds.clear();
                        this.selectedNodeIds.clear();
                        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                    }

                    const x = Math.min(worldStart.x, worldEnd.x);
                    const y = Math.min(worldStart.y, worldEnd.y);
                    const selectionRect = new Phaser.Geom.Rectangle(x, y, w, h);

                    // Units
                    this.currentUnits.forEach(u => {
                        if (u.ownerId === socket.id) {
                            // Use intersection instead of center point for better feel
                            const unitRect = new Phaser.Geom.Rectangle(u.x - 12, u.y - 12, 24, 24);
                            if (Phaser.Geom.Intersects.RectangleToRectangle(selectionRect, unitRect)) {
                                this.selectedUnitIds.add(u.id);
                            }
                        }
                    });
                    this.renderUnits(this.currentUnits);
                    window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                        detail: { unitIds: Array.from(this.selectedUnitIds) } 
                    }));

                    // Buildings & Nodes
                    if (this.currentMap) {
                        this.currentMap.islands.forEach(island => {
                            // Check all buildings, but only select mine
                            island.buildings.forEach(b => {
                                // Calculate absolute position
                                const bx = island.x + (b.x || 0);
                                const by = island.y + (b.y || 0);
                                
                                // Check if building is mine OR island is mine (fallback)
                                const isMine = b.ownerId === socket.id || island.ownerId === socket.id;

                                if (isMine) {
                                    const bRect = new Phaser.Geom.Rectangle(bx - 12, by - 12, 24, 24);
                                    if (Phaser.Geom.Intersects.RectangleToRectangle(selectionRect, bRect)) {
                                        if (b.type === 'bridge_node' || b.type === 'wall_node') {
                                            this.selectedNodeIds.add(b.id);
                                        } else {
                                            this.selectedBuildingIds.add(b.id);
                                        }
                                    }
                                }
                            });
                        });

                        (this.currentMap.waterBuildings || []).forEach(b => {
                            if (b.ownerId !== socket.id) return;
                            const bx = b.x || 0;
                            const by = b.y || 0;
                            const bRect = new Phaser.Geom.Rectangle(bx - 12, by - 12, 24, 24);
                            if (!Phaser.Geom.Intersects.RectangleToRectangle(selectionRect, bRect)) return;
                            if (b.type === 'bridge_node' || b.type === 'wall_node') {
                                this.selectedNodeIds.add(b.id);
                            } else {
                                this.selectedBuildingIds.add(b.id);
                            }
                        });
                        
                        window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                            detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
                        }));
                        window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                            detail: { nodes: Array.from(this.selectedNodeIds) } 
                        }));
                        this.renderMap(this.currentMap);
                    }
                }
            }
        }
    });

    // Zoom
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
        void pointer;
        void gameObjects;
        void deltaX;
        void deltaZ;
        
        let minZoom = 0.2;
        if (this.currentMap) {
            // Calculate zoom to fit map
            // Add slight padding (0.95) so edges aren't flush
            const minZoomX = this.cameras.main.width / this.currentMap.width;
            const minZoomY = this.cameras.main.height / this.currentMap.height;
            minZoom = Math.max(minZoomX, minZoomY);
        }

        const newZoom = this.cameras.main.zoom - deltaY * 0.001;
        this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, minZoom, 2));
        if (this.currentUnits.length > 0 && this.syncUnitDetailMode(this.currentUnits)) {
            this.renderUnits(this.currentUnits);
        }
    });

    // Steering Update Loop (20Hz)
    this.time.addEvent({
        delay: 50,
        callback: this.sendSteeringUpdates,
        callbackScope: this,
        loop: true
    });
  }

    updateOilScanner() {
        // Detection Logic (ALWAYS RUNS if map exists)
        if (!this.currentMap) return;
        
        const seekers = this.currentUnits.filter(u => u.ownerId === socket.id && u.type === 'oil_seeker');
        
        // Scan Range
        const range = Math.max(this.currentMap.width, this.currentMap.height) * 0.25;

        // Visual Range Rendering moved to renderRangeRings()


        // Determine which spots are currently visible
        const currentlyVisible = new Set<string>();
        
        this.currentMap.oilSpots.forEach(spot => {
            // If not hidden, always visible
            if (!spot.id.startsWith('hidden_oil_')) {
                 currentlyVisible.add(spot.id);
                 return;
            }

            // If already revealed, keep revealed
            if (this.revealedOilSpots.has(spot.id)) {
                currentlyVisible.add(spot.id);
                return;
            }

            let inRange = false;
            for (const s of seekers) {
                if (Math.hypot(spot.x - s.x, spot.y - s.y) <= range) {
                    inRange = true;
                    break;
                }
            }

            if (inRange) {
                currentlyVisible.add(spot.id);
            }
        });

        // Update visuals
        let changed = false;
        
        // Clear overlay every frame to redraw pings
        this.scannerOverlay.clear();
        
        // Show spots that are now visible
        currentlyVisible.forEach(id => {
            // Logic for revealing (One-time state change)
            if (!this.revealedOilSpots.has(id)) {
                const visuals = this.oilSpotVisuals.get(id);
                if (visuals) {
                    visuals.main.setVisible(true);
                    // Use LOCAL coordinates (0,0) for the hit area
                    visuals.main.setInteractive(new Phaser.Geom.Circle(0, 0, visuals.main.radius), Phaser.Geom.Circle.Contains);
                    visuals.pulse.setVisible(true);
                    visuals.main.setAlpha(0.5); // Black oil standard alpha

                    // Hide original ping (we use overlay now)
                    if (visuals.ping) {
                        visuals.ping.setVisible(false); 
                    }
                }
                this.revealedOilSpots.add(id);
                changed = true;
            }

            // Continuous Visuals (Every Frame) - Draw Ping on Overlay if it's a HIDDEN spot
            if (id.startsWith('hidden_oil_')) {
                 const visuals = this.oilSpotVisuals.get(id);
                 if (visuals) {
                     // Pulse Animation for the overlay rect
                     const time = Date.now();
                     const scale = 1 + Math.sin(time * 0.005) * 0.3; // 0.7 to 1.3
                     const size = 30 * scale;
                     const offset = size / 2;

                     // Draw Red Ping Rect
                     this.scannerOverlay.lineStyle(3, 0xFF0000, 1);
                     this.scannerOverlay.strokeRect(visuals.main.x - offset, visuals.main.y - offset, size, size);
                     
                     // Optional: Draw a crosshair or filling
                     this.scannerOverlay.fillStyle(0xFF0000, 0.2);
                     this.scannerOverlay.fillRect(visuals.main.x - offset, visuals.main.y - offset, size, size);
                 }
            }
        });

        if (changed) {
             window.dispatchEvent(new CustomEvent('oil-revealed', { 
                detail: { ids: Array.from(this.revealedOilSpots) } 
            }));
        }
    }

  renderRangeRings() {
      if (!this.rangeGraphics) return;
      this.rangeGraphics.clear();

      // 1. Oil Scanner Ranges
      if (this.currentMap) {
          const seekers = this.currentUnits.filter(u => u.ownerId === socket.id && u.type === 'oil_seeker');
          if (this.showOilScanner || seekers.length > 0) {
              const range = Math.max(this.currentMap.width, this.currentMap.height) * 0.25;
              this.rangeGraphics.lineStyle(2, 0xFF0000, 0.5);
              this.rangeGraphics.fillStyle(0xFF0000, 0.05);
              seekers.forEach(s => {
                  this.rangeGraphics.strokeCircle(s.x, s.y, range);
                  this.rangeGraphics.fillCircle(s.x, s.y, range);
              });
          }
      }

      // 2. Selected Unit Ranges
      if (this.selectedUnitIds.size > 0) {
          this.selectedUnitIds.forEach(id => {
              const unit = this.currentUnits.find(u => u.id === id);
              if (unit && unit.ownerId === socket.id && unit.range && unit.range > 0) {
                  this.rangeGraphics.lineStyle(1, 0xFFFFFF, 0.5); // White ring
                  this.rangeGraphics.strokeCircle(unit.x, unit.y, unit.range);
              }
          });
      }

      // 3. Selected Building Ranges
      if (this.selectedBuildingIds.size > 0 && this.currentMap) {
          this.currentMap.islands.forEach(island => {
              island.buildings.forEach(b => {
                  if (this.selectedBuildingIds.has(b.id)) {
                       // Calculate absolute position
                       const bx = island.x + (b.x || 0);
                       const by = island.y + (b.y || 0);
                       
                       // Check range property
                       const range = b.range || 0;

                       if (range > 0) {
                           this.rangeGraphics.lineStyle(1, 0xFFFFFF, 0.5);
                           this.rangeGraphics.strokeCircle(bx, by, range);
                       }
                  }
              });
          });
      }
  }

  centerCameraOnBase(): boolean {
      if (!this.currentMap) return false;

      // Find player's base
      let myBase: { x: number, y: number } | null = null;
      
      for (const island of this.currentMap.islands) {
          const foundBase = island.buildings.find(b => b.type === 'base' && b.ownerId === socket.id);
          if (foundBase) {
              myBase = {
                  x: island.x + (foundBase.x || 0),
                  y: island.y + (foundBase.y || 0)
              };
              break;
          }
      }

      if (myBase) {
          this.cameras.main.centerOn(myBase.x, myBase.y);
          return true;
      } else {
          // Fallback to island ownership (legacy/classic mode)
          const myIsland = this.currentMap.islands.find(i => i.ownerId === socket.id);
          if (myIsland) {
              this.cameras.main.centerOn(myIsland.x, myIsland.y);
              return true;
          }
      }
      return false;
  }

  private drawDebugOverlays() {
        this.debugGraphics.clear();
        this.debugTextGroup.clear(true, true);
        if (!this.lastDebugData || this.lastDebugData.length === 0) return;
        let index = 0;
        this.lastDebugData.forEach(bot => {
            let color = 0xffffff;
            if (bot.currentGoal === 'EXPAND') color = 0x00ff00;
            else if (bot.currentGoal === 'ATTACK') color = 0xff0000;
            else if (bot.currentGoal === 'DEFEND') color = 0x0000ff;
            if (bot.target) {
                this.debugGraphics.lineStyle(2, color, 0.5);
                this.debugGraphics.strokeCircle(bot.target.x, bot.target.y, 20);
                this.debugGraphics.lineBetween(bot.target.x - 10, bot.target.y, bot.target.x + 10, bot.target.y);
                this.debugGraphics.lineBetween(bot.target.x, bot.target.y - 10, bot.target.x, bot.target.y + 10);
            }
            if (bot.intents && bot.intents.length > 0) {
                bot.intents.forEach((intent: any) => {
                    if (intent.type === 'move') {
                        this.debugGraphics.lineStyle(1, color, 0.3);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        const angle = Phaser.Math.Angle.Between(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        const arrowLen = 10;
                        this.debugGraphics.lineBetween(
                            intent.to.x, intent.to.y,
                            intent.to.x - Math.cos(angle - Math.PI/6) * arrowLen,
                            intent.to.y - Math.sin(angle - Math.PI/6) * arrowLen
                        );
                        this.debugGraphics.lineBetween(
                            intent.to.x, intent.to.y,
                            intent.to.x - Math.cos(angle + Math.PI/6) * arrowLen,
                            intent.to.y - Math.sin(angle + Math.PI/6) * arrowLen
                        );
                    } else if (intent.type === 'build') {
                        this.debugGraphics.lineStyle(2, 0xffff00, 0.5);
                        this.debugGraphics.strokeRect(intent.to.x - 20, intent.to.y - 20, 40, 40);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                    } else if (intent.type === 'debug_line') {
                        const colorHex = intent.color === 'red' ? 0xff0000 : intent.color === 'cyan' ? 0x00ffff : 0xffffff;
                        this.debugGraphics.lineStyle(2, colorHex, 0.8);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        this.debugGraphics.strokeCircle(intent.to.x, intent.to.y, 5);
                        const label = intent.label || `Target: ${Math.round(intent.to.x)}, ${Math.round(intent.to.y)}`;
                        const text = this.add.text(intent.to.x, intent.to.y - 20, label, { fontSize: '12px', color: '#ffffff', backgroundColor: '#000000' });
                        text.setOrigin(0.5);
                        this.debugTextGroup.add(text);
                    }
                });
            }
            const progression = bot.progression || {};
            const defence = progression.defence || {};
            const idle = progression.idle || {};
            const mapType = progression.mapType || 'unknown';
            const towersBuilt = defence.towersBuilt ?? 0;
            const towersTarget = defence.towersTarget ?? 0;
            const wallNodesPlaced = defence.wallNodesPlaced ?? 0;
            const wallNodesTarget = defence.wallNodesTarget ?? 0;
            const wallConnections = defence.wallConnections ?? 0;
            const wallConnectionsExpected = defence.wallConnectionsExpected ?? 0;
            const skipReason = defence.lastSkipReason || 'NONE';
            const defenceStatus =
                (bot.baseDefenseStatus as string) ||
                (bot.baseDefenseStatusRaw as string) ||
                (bot.baseDefenseBuilderStatus as string) ||
                (bot.status as string) ||
                (bot.currentGoal as string) ||
                'UNKNOWN';
            const line = `Defence [${bot.playerId}] map=${mapType} state=${defenceStatus} Towers=${towersBuilt}/${towersTarget} Nodes=${wallNodesPlaced}/${wallNodesTarget} Walls=${wallConnections}/${wallConnectionsExpected} Idle=${idle.idleSeconds ?? 0}s skip=${skipReason}`;
            const overlayText = this.add.text(10, 20 + index * 16, line, { fontSize: '12px', color: '#ffffff', backgroundColor: '#000000' });
            overlayText.setScrollFactor(0);
            overlayText.setDepth(2001);
            this.debugTextGroup.add(overlayText);
            index += 1;
        });
    }

    private getKey(key: string): Phaser.Input.Keyboard.Key {
      if (!this.keyCache.has(key)) {
          this.keyCache.set(key, this.input.keyboard!.addKey(key));
      }
      return this.keyCache.get(key)!;
  }

  update(time: number, delta: number) {
        if (this.showDebugView) {
            this.drawDebugOverlays();
        }
        
        if (this.isMenuMode) {
          this.updateMenuAnimation(time, delta);
          return;
      }

      const dt = delta / 16.66; // Normalize to ~60FPS
      const dtSec = delta / 1000;

      this.updateOilScanner();
      this.renderRangeRings();

    // Unit Interpolation
      const renderTime = Date.now() - 100; // 100ms interpolation delay
      
      this.currentUnits.forEach(unit => {
          const container = this.unitContainers.get(unit.id);
          if (!container) return;

          // 1. Client-Side Prediction Logic
          if (this.predictedMoves.has(unit.id)) {
              const prediction = this.predictedMoves.get(unit.id)!;
              
              // Physics Update (Arcadey: High Accel, Instant Turn)
              const ACCEL = 800; 
              const DECEL = 1600;

              if (prediction.vx === undefined) prediction.vx = 0;
              if (prediction.vy === undefined) prediction.vy = 0;

              let currentSpeed = Math.hypot(prediction.vx, prediction.vy);

              while (prediction.path && prediction.path.length > 0) {
                  const nextWaypoint = prediction.path[0];
                  const threshold = this.getWaypointArrivalThreshold(nextWaypoint);
                  if (Phaser.Math.Distance.Between(container.x, container.y, nextWaypoint.x, nextWaypoint.y) >= threshold) {
                      break;
                  }
                  if (this.isBridgeNodeWaypoint(nextWaypoint)) {
                      container.setPosition(nextWaypoint.x, nextWaypoint.y);
                  }
                  prediction.path.shift();
              }

              const activeTarget = prediction.path && prediction.path.length > 0
                  ? prediction.path[0]
                  : { x: prediction.targetX, y: prediction.targetY };

              const dx = activeTarget.x - container.x;
              const dy = activeTarget.y - container.y;
              const distToTarget = Math.sqrt(dx*dx + dy*dy);
              
              let shouldMove = false;
              let dirX = 0, dirY = 0;

              if (distToTarget > 2) {
                   dirX = dx / distToTarget;
                   dirY = dy / distToTarget;
                   shouldMove = true;
              }

              if (shouldMove) {
                   currentSpeed += ACCEL * dtSec;
                   if (currentSpeed > prediction.speed) currentSpeed = prediction.speed;
                   prediction.vx = dirX * currentSpeed;
                   prediction.vy = dirY * currentSpeed;
              } else {
                   currentSpeed -= DECEL * dtSec;
                   if (currentSpeed < 0) currentSpeed = 0;
                   if (currentSpeed > 0 && Math.hypot(prediction.vx, prediction.vy) > 0.01) {
                        const vAngle = Math.atan2(prediction.vy, prediction.vx);
                        prediction.vx = Math.cos(vAngle) * currentSpeed;
                        prediction.vy = Math.sin(vAngle) * currentSpeed;
                   } else {
                        prediction.vx = 0;
                        prediction.vy = 0;
                   }
              }

              const moveStepX = prediction.vx * dtSec;
              const moveStepY = prediction.vy * dtSec;
              const moveStepDist = Math.hypot(moveStepX, moveStepY);

              if (shouldMove && moveStepDist > distToTarget) {
                  container.setPosition(activeTarget.x, activeTarget.y);
              } else {
                  container.setPosition(container.x + moveStepX, container.y + moveStepY);
              }

              if (!shouldMove && currentSpeed < 1) {
                   container.setPosition(prediction.targetX, prediction.targetY);
                   this.predictedMoves.delete(unit.id);
              }

              // Reconciliation: Check if server disagrees significantly
              const serverDist = Phaser.Math.Distance.Between(container.x, container.y, unit.x, unit.y);
              
              // Dynamic Thresholds based on Connection Type
              // Tunnel/Internet: More lenient to prevent rubber-banding due to latency/jitter
              // Local: Stricter for responsiveness
              const isTunnel = (this.game.registry.get('socket') as any)?.isTunnel; 
              const SNAP_THRESHOLD = isTunnel ? 120 : 60; 
              const SMOOTH_THRESHOLD = isTunnel ? 30 : 15;
              
              // 1. Intent Mismatch
              if (unit.intentId && unit.intentId !== prediction.intentId) {
                  this.predictedMoves.delete(unit.id);
              }
              // 2. Distance Divergence
              else if (serverDist > SNAP_THRESHOLD) { 
                  // Snap back to server authoritative state
                  this.predictedMoves.delete(unit.id);
              } 
              // 3. Smooth Correction
              else if (serverDist > SMOOTH_THRESHOLD) {
                  // Nudge towards server
                  container.x = Phaser.Math.Linear(container.x, unit.x, 0.1);
                  container.y = Phaser.Math.Linear(container.y, unit.y, 0.1);
                  return; // Still use predicted position (but nudged)
              } else {
                  return; // Skip interpolation, use predicted position
              }
          }

          const history = this.unitUpdates.get(unit.id);
          if (!history || history.length < 2) {
               container.setPosition(unit.x, unit.y);
               return;
          }

          // Find the two updates surrounding renderTime
          let p1 = history[0];
          let p2 = history[1];
          
          // If we have history, try to find the segment that contains renderTime
          for (let i = 1; i < history.length; i++) {
              if (history[i].time >= renderTime) {
                  p1 = history[i - 1];
                  p2 = history[i];
                  break;
              }
          }

          // Fix: Prevent sliding from 0,0 by detecting large jumps or invalid start positions
          const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
          
          // If distance is huge (>300) OR we are currently at 0,0 (invalid spawn), snap immediately
          if (dist > 300 || (container.x === 0 && container.y === 0 && p2.x !== 0)) {
               container.setPosition(p2.x, p2.y);
          } else if (p1.time === p2.time || renderTime <= p1.time) {
              container.setPosition(p1.x, p1.y);
          } else if (renderTime >= p2.time) {
               container.setPosition(p2.x, p2.y);
          } else {
              const t = (renderTime - p1.time) / (p2.time - p1.time);
              const x = p1.x + (p2.x - p1.x) * t;
              const y = p1.y + (p2.y - p1.y) * t;
              container.setPosition(x, y);
          }
      });

      this.syncUnitSkinTrails(time, delta);
      this.updateMotionTrailVisuals(time);

      this.currentUnits.forEach(unit => {
          const container = this.unitContainers.get(unit.id);
          if (!container) return;
          this.rotateUnitArt(container, this.getDesiredFacingAngle(unit), dtSec);
      });

      // Tumbleweeds
      this.tumbleweeds.forEach(t => {
          t.sprite.x += t.dx * dt;
          t.sprite.y += t.dy * dt;
          t.sprite.rotation += 0.05 * dt;
          
          t.life -= dtSec;
          if (t.life <= 0) {
              // Respawn
              t.life = 5;
              if (t.bounds && t.poly) {
                  let placed = false;
                  for(let i=0; i<5; i++) {
                      const rx = t.bounds.x + Math.random() * t.bounds.width;
                      const ry = t.bounds.y + Math.random() * t.bounds.height;
                      if (Phaser.Geom.Polygon.Contains(t.poly, rx, ry)) {
                          t.sprite.x = rx;
                          t.sprite.y = ry;
                          placed = true;
                          break;
                      }
                  }
                  if (!placed) {
                      t.sprite.x = t.bounds.centerX;
                      t.sprite.y = t.bounds.centerY;
                  }
              }
          } else {
               // Keep in bounds
               if (t.bounds) {
                   if (t.sprite.x < t.bounds.x) t.sprite.x = t.bounds.right;
                   if (t.sprite.x > t.bounds.right) t.sprite.x = t.bounds.x;
                   if (t.sprite.y < t.bounds.y) t.sprite.y = t.bounds.bottom;
                   if (t.sprite.y > t.bounds.bottom) t.sprite.y = t.bounds.y;
               }
          }
      });

      // Weather Particles (Rain)
      this.weatherParticles.forEach(p => {
          p.sprite.x += p.dx * dt;
          p.sprite.y += p.dy * dt;
          
          p.life -= dtSec;
          if (p.life <= 0) {
              p.life = 5;
              // Respawn
              if (p.bounds && p.poly) {
                  let placed = false;
                  for(let i=0; i<5; i++) {
                      const rx = p.bounds.x + Math.random() * p.bounds.width;
                      const ry = p.bounds.y + Math.random() * p.bounds.height;
                      if (Phaser.Geom.Polygon.Contains(p.poly, rx, ry)) {
                          p.sprite.x = rx;
                          p.sprite.y = ry;
                          placed = true;
                          break;
                      }
                  }
                  if (!placed) {
                      p.sprite.x = p.bounds.centerX;
                      p.sprite.y = p.bounds.centerY;
                  }
              }
          } else {
               // Wrap
               if (p.bounds) {
                  if (p.sprite.y > p.bounds.bottom) p.sprite.y = p.bounds.y;
                  if (p.sprite.x > p.bounds.right) p.sprite.x = p.bounds.x;
                  if (p.sprite.x < p.bounds.x) p.sprite.x = p.bounds.right;
               }
          }
      });
      
      // Oil Animations
      const cycleTime = 5000;
      const activeTime = 3000;
      this.oilAnimations.forEach(anim => {
          // Skip if hidden
          const visuals = this.oilSpotVisuals.get(anim.id);
          if (visuals && !visuals.main.visible) {
              anim.pulse.setVisible(false);
              return;
          }

          anim.timer += delta;
          if (anim.timer >= cycleTime) {
              anim.timer = 0;
          }

          if (anim.timer < activeTime) {
              anim.pulse.setVisible(true);
              const progress = anim.timer / activeTime;
              anim.pulse.setScale(1 + (progress * 1.5)); // 1 -> 2.5
              anim.pulse.setAlpha(1 - progress); // 1 -> 0
          } else {
              anim.pulse.setVisible(false);
          }
      });

      this.goldSparkles.forEach(sparkle => {
          sparkle.timer += delta * sparkle.speed;
          sparkle.sprite.setAlpha(0.35 + Math.sin(sparkle.timer * 0.004) * 0.35);
          sparkle.sprite.setScale(0.7 + Math.sin(sparkle.timer * 0.005) * 0.18);
      });

      // Camera Movement
      // Spectators get faster movement
      const baseSpeed = this.isSpectating ? 40 : 20;
      const binds = settingsManager.getSettings().keybinds;

      // Broadcast FPS (throttled to every ~500ms to avoid React churn)
      if (this.game.loop.frame % 30 === 0) {
          window.dispatchEvent(new CustomEvent('fps-update', { 
              detail: { fps: Math.round(this.game.loop.actualFps) } 
          }));
      }

      // Helper to check key status safely
      const isKeyDown = (key: string) => {
          return this.getKey(key).isDown;
      };

      const shiftMultiplier = isKeyDown('SHIFT') ? 2 : 1;
      const speed = (baseSpeed * shiftMultiplier) / this.cameras.main.zoom; 

      if (isKeyDown(binds.cameraUp) || isKeyDown('W') || isKeyDown('UP')) this.cameras.main.scrollY -= speed;
      if (isKeyDown(binds.cameraDown) || isKeyDown('S') || isKeyDown('DOWN')) this.cameras.main.scrollY += speed;
      if (isKeyDown(binds.cameraLeft) || isKeyDown('A') || isKeyDown('LEFT')) this.cameras.main.scrollX -= speed;
      if (isKeyDown(binds.cameraRight) || isKeyDown('D') || isKeyDown('RIGHT')) this.cameras.main.scrollX += speed;

      if (this.getKey(binds.centerCamera).isDown) {
          this.centerCameraOnBase();
      }

      // Minimap update (throttled to camera movement)
      if (this.cameras.main.scrollX !== this.lastCameraX || this.cameras.main.scrollY !== this.lastCameraY) {
          this.lastCameraX = this.cameras.main.scrollX;
          this.lastCameraY = this.cameras.main.scrollY;
          
          const worldView = this.cameras.main.worldView;
          window.dispatchEvent(new CustomEvent('minimap-update', { 
              detail: { 
                  x: worldView.x, 
                  y: worldView.y, 
                  width: worldView.width, 
                  height: worldView.height 
              } 
          }));
      }

      // Update Path Lines
      this.pathGraphics.clear();
      // Optimization: Only draw paths for selected units to save performance
      if (this.selectedUnitIds.size > 0) {
          this.pathGraphics.fillStyle(0x00FF00, 0.5);
          this.selectedUnitIds.forEach(id => {
              const unit = this.currentUnits.find(u => u.id === id);
              if (unit && unit.ownerId === socket.id && unit.status === 'moving' && unit.targetX !== undefined && unit.targetY !== undefined) {
                  const pathPoints = [{ x: unit.x, y: unit.y }, ...(unit.path || []), { x: unit.targetX, y: unit.targetY }];

                  for (let segmentIndex = 0; segmentIndex < pathPoints.length - 1; segmentIndex++) {
                      const from = pathPoints[segmentIndex];
                      const to = pathPoints[segmentIndex + 1];
                      const dist = Math.hypot(to.x - from.x, to.y - from.y);
                      const points = Math.max(1, Math.min(50, Math.floor(dist / 20)));
                      const dx = (to.x - from.x) / points;
                      const dy = (to.y - from.y) / points;

                      for (let i = 0; i < points; i++) {
                          this.pathGraphics.fillCircle(from.x + dx * i, from.y + dy * i, 2);
                      }
                  }
              }
          });
      }
  }

  issueMoveCommand(x: number, y: number) {
      // Throttle commands (50ms debounce)
      const now = Date.now();
      if (now - this.lastCommandTime < 50) return;
      this.lastCommandTime = now;

        // Play Move Sound
        if (this.selectedUnitIds.size > 0) {
            // Determine dominant unit type in selection
            let landCount = 0;
            let waterCount = 0;
            let airCount = 0;
            
            this.currentUnits.forEach(u => {
                if (this.selectedUnitIds.has(u.id)) {
                    const type = u.type;
                    if (['ship', 'destroyer', 'pirate_ship', 'carrier', 'construction_ship', 'ferry', 'oil_tanker'].includes(type)) {
                        waterCount++;
                    } else if (['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien', 'aircraft_carrier', 'mothership'].includes(type)) {
                        airCount++;
                    } else {
                        landCount++;
                    }
                }
            });

            let soundKey = 'move_land';
            let effectId: 'moveLand' | 'moveWater' | 'moveAir' = 'moveLand';
            if (waterCount > landCount && waterCount > airCount) soundKey = 'move_water';
            if (airCount > landCount && airCount > waterCount) soundKey = 'move_air';
            if (soundKey === 'move_water') effectId = 'moveWater';
            if (soundKey === 'move_air') effectId = 'moveAir';

            const volume = soundEffectsManager.getEffectVolume(effectId, 0.4);

            if (volume > 0) {
                try {
                    this.sound.play(soundKey, { volume });
                } catch (e) {}
            }
        }

        console.log('Issuing move command to:', x, y);
        
        // Process each unit individually for Hybrid Networking (Intent-based)
	        this.selectedUnitIds.forEach(id => {
	            const unit = this.currentUnits.find(u => u.id === id);
	            if (unit) {
	                const intentId = `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	                const adjustedTarget = this.getAdjustedTarget(unit.type, x, y);
	                const predictedPath = this.buildPredictedBridgeWaypointPath(unit, adjustedTarget);
	                
	                // Client-Side Prediction: Start moving immediately
	                // Use bridge-aware waypoints for land moves across bridged islands so the
	                // local preview matches the server route instead of cutting through water.
	                this.predictedMoves.set(id, {
	                    targetX: adjustedTarget.x,
	                    targetY: adjustedTarget.y,
	                    speed: unit.speed || 150, // Default speed if missing
	                    type: unit.type,
	                    intentId: intentId,
	                    path: predictedPath.length > 0 ? predictedPath : undefined
	                });

                // Send Intent
                socket.emit('moveIntent', {
                    unitId: id,
                    intentId: intentId,
                    destX: adjustedTarget.x,
                    destY: adjustedTarget.y,
                    clientTime: Date.now()
                });
            }
        });

      // Visual feedback (Circle at target)
      if (settingsManager.getSettings().graphics.showParticles) {
          const circle = this.add.circle(x, y, 5, 0x00FF00);
          this.tweens.add({
              targets: circle,
              alpha: 0,
              scale: 2,
              duration: 500,
              onComplete: () => circle.destroy()
          });
      }
  }

  sendSteeringUpdates() {
      // Send MOVE_STEER at 20Hz (called from timer)
      this.predictedMoves.forEach((pred, unitId) => {
          const container = this.unitContainers.get(unitId);
          if (container) {
              // Calculate direction
              const dx = pred.targetX - container.x;
              const dy = pred.targetY - container.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist > 1) {
                  const dirX = dx / dist;
                  const dirY = dy / dist;

                  socket.emit('moveSteer', {
                      unitId: unitId,
                      intentId: pred.intentId,
                      dirX: dirX,
                      dirY: dirY
                  });
              }
          }
      });
  }

  getAdjustedTarget(unitType: string, targetX: number, targetY: number): { x: number, y: number } {
        if (!this.currentMap) return { x: targetX, y: targetY };

        // Air units ignore terrain constraints
        const isAirUnit = ['mothership', 'light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(unitType);
        if (isAirUnit) return { x: targetX, y: targetY };

        const highGround = this.getHighGroundAtPoint(targetX, targetY);
        if (highGround) {
            const closest = this.getClosestPointOnPolygon({ x: targetX, y: targetY }, highGround.points);
            const angle = Math.atan2(closest.y - highGround.y, closest.x - highGround.x);
            targetX = closest.x + Math.cos(angle) * 10;
            targetY = closest.y + Math.sin(angle) * 10;
        }

        // Land units (cannot move on water)
        const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'oil_seeker', 'missile_launcher'].includes(unitType);
        
        // Find closest island
        let closestIsland: Island | null = null;
        let minDist = Infinity;

        this.currentMap.islands.forEach(island => {
            const dist = Math.hypot(targetX - island.x, targetY - island.y);
            const distToEdge = dist - island.radius;
            if (distToEdge < minDist) {
                minDist = distToEdge;
                closestIsland = island;
            }
        });

        if (!closestIsland) return { x: targetX, y: targetY };

        const island = closestIsland as Island;

        if (island.points) {
             const inside = this.isPointInPolygon({x: targetX, y: targetY}, island.points);
             
             if (isLandUnit) {
                 if (!inside) {
                     // Snap to closest edge
                     const closest = this.getClosestPointOnPolygon({x: targetX, y: targetY}, island.points);
                     return closest;
                 }
             } else {
                 // Water Unit
                 if (inside) {
                     // Snap to closest edge
                     const closest = this.getClosestPointOnPolygon({x: targetX, y: targetY}, island.points);
                     return closest;
                 }
             }
        } else {
            const dx = targetX - island.x;
            const dy = targetY - island.y;
            const distFromCenter = Math.hypot(dx, dy);

            if (isLandUnit) {
                // If on water (outside radius), snap to edge
                if (distFromCenter > island.radius) {
                    const angle = Math.atan2(dy, dx);
                    return {
                        x: island.x + Math.cos(angle) * (island.radius - 5), // Slight buffer inside
                        y: island.y + Math.sin(angle) * (island.radius - 5)
                    };
                }
            } else {
                // Water units (destroyer, construction_ship, aircraft_carrier, ferry, etc.)
                // If on land (inside radius), snap to edge
                if (distFromCenter < island.radius) {
                    const angle = Math.atan2(dy, dx);
                    return {
                        x: island.x + Math.cos(angle) * (island.radius + 15), // Buffer outside
                        y: island.y + Math.sin(angle) * (island.radius + 15)
                    };
                }
            }
        }

        return { x: targetX, y: targetY };
    }

    private isPointInPolygon(p: {x: number, y: number}, polygon: {x: number, y: number}[]): boolean {
        let isInside = false;
        let minX = polygon[0].x, maxX = polygon[0].x;
        let minY = polygon[0].y, maxY = polygon[0].y;
        for (let n = 1; n < polygon.length; n++) {
            const q = polygon[n];
            minX = Math.min(q.x, minX);
            maxX = Math.max(q.x, maxX);
            minY = Math.min(q.y, minY);
            maxY = Math.max(q.y, maxY);
        }

        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
            return false;
        }

        let i = 0;
        let j = polygon.length - 1;
        for (; i < polygon.length; j = i++) {
            if ( (polygon[i].y > p.y) !== (polygon[j].y > p.y) &&
                    p.x < (polygon[j].x - polygon[i].x) * (p.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x ) {
                isInside = !isInside;
            }
        }
        return isInside;
    }

    private isValidDockPlacement(x: number, y: number): boolean {
        if (!this.currentMap) return false;

        return this.currentMap.islands.some(island => this.isPointOnExposedIslandShoreline(island, x, y));
    }

    private isValidNavalMinePlacement(x: number, y: number): boolean {
        if (!this.currentMap) return false;

        const onLand = this.currentMap.islands.some(island => {
            if (island.points) {
                return this.isPointInPolygon({ x, y }, island.points);
            }
            return Math.hypot(x - island.x, y - island.y) <= island.radius;
        });
        if (onLand) return false;

        const minSpacing = 110;
        return !(this.currentMap.waterBuildings || []).some(building =>
            building.type === 'naval_mine' &&
            Math.hypot((building.x || 0) - x, (building.y || 0) - y) < minSpacing
        );
    }

    private getClosestPointOnPolygon(p: {x: number, y: number}, points: {x: number, y: number}[]): {x: number, y: number} {
        let minD2 = Infinity;
        let closest = points[0];

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            
            const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
            if (l2 === 0) continue;
            
            let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            
            const d2 = (p.x - projX) ** 2 + (p.y - projY) ** 2;
            if (d2 < minD2) {
                minD2 = d2;
                closest = {x: projX, y: projY};
            }
        }
        return closest;
    }

  private getUnitSkinIdForOwner(ownerId?: string | null) {
      return ownerId === socket.id
          ? this.activeSkinLoadout.unitSkinId
          : 'default';
  }

  private getUnitSnapshotById(unitId?: string | null) {
      if (!unitId) return undefined;
      return this.currentUnits.find((unit) => unit.id === unitId);
  }

  private getMothershipBeamColors(attackerId: string, fallbackColor: number) {
      const attacker = this.getUnitSnapshotById(attackerId);
      const skinId = attacker ? this.getUnitSkinIdForOwner(attacker.ownerId) : 'default';
      const palette = SKIN_DEFINITIONS_BY_ID[skinId]?.palette;

      if (!palette || skinId === 'default') {
          return {
              beamColor: fallbackColor,
              glowColor: fallbackColor,
              coreColor: 0xffffff,
              impactColor: blendSceneColor(fallbackColor, 0xffffff, 0.22),
              flareColor: 0xffffff,
          };
      }

      return {
          beamColor: palette.glow,
          glowColor: blendSceneColor(palette.primary, palette.glow, 0.62),
          coreColor: blendSceneColor(palette.secondary, 0xffffff, 0.38),
          impactColor: blendSceneColor(palette.primary, palette.glow, 0.42),
          flareColor: blendSceneColor(palette.secondary, 0xffffff, 0.2),
      };
  }

  private getProjectileImpactColors(
      attackerId: string | undefined,
      defaults: {
          core: number;
          glow: number;
          ring: number;
          smoke?: number;
          sparkA?: number;
          sparkB?: number;
      }
  ) {
      const attacker = this.getUnitSnapshotById(attackerId);
      const skinId = attacker ? this.getUnitSkinIdForOwner(attacker.ownerId) : 'default';
      const palette = SKIN_DEFINITIONS_BY_ID[skinId]?.palette;

      if (!palette || skinId === 'default') {
          return defaults;
      }

      return {
          core: blendSceneColor(defaults.core, palette.primary, 0.62),
          glow: blendSceneColor(defaults.glow, palette.glow, 0.72),
          ring: blendSceneColor(defaults.ring, palette.secondary, 0.58),
          smoke: defaults.smoke !== undefined ? blendSceneColor(defaults.smoke, palette.shadow, 0.36) : undefined,
          sparkA: blendSceneColor(defaults.sparkA ?? defaults.core, palette.glow, 0.64),
          sparkB: blendSceneColor(defaults.sparkB ?? defaults.ring, palette.secondary, 0.52),
      };
  }

  private getUnitRadiationBadgeOffset(unitType: string, displayScale: number) {
      let hpBarY = -12;
      switch (unitType) {
          case 'mothership': hpBarY = -90; break;
          case 'aircraft_carrier': hpBarY = -50; break;
          case 'heavy_alien': hpBarY = -36; break;
          case 'alien_scout': hpBarY = -28; break;
          case 'heavy_plane': hpBarY = -25; break;
          case 'destroyer': hpBarY = -15; break;
          case 'pirate_ship': hpBarY = -15; break;
          case 'construction_ship': hpBarY = -15; break;
          case 'ferry': hpBarY = -15; break;
          case 'missile_launcher': hpBarY = -15; break;
          case 'tank': hpBarY = -15; break;
          case 'humvee': hpBarY = -12; break;
      }

      return (hpBarY * displayScale) - Math.max(14, 18 * displayScale);
  }

  private syncRadiationBadge(
      host: Phaser.GameObjects.Container,
      stacks: number | undefined,
      yOffset: number,
      scale: number = 1
  ) {
      const existing = host.getByName('radiationBadge') as Phaser.GameObjects.Container | null;
      if (!stacks || stacks <= 0) {
          existing?.destroy();
          return;
      }

      let badge = existing;
      if (!badge) {
          badge = this.add.container(0, yOffset);
          badge.setName('radiationBadge');

          const glow = this.add.circle(0, 0, 12, 0x8aff66, 0.22);
          glow.setBlendMode(Phaser.BlendModes.ADD);
          const ring = this.add.circle(0, 0, 10, 0x7dff55, 0);
          ring.setStrokeStyle(1.6, 0xc8ff72, 0.82);
          const symbol = this.add.text(0, -0.5, '☢', {
              fontFamily: 'Trebuchet MS, sans-serif',
              fontSize: '15px',
              color: '#d8ff98',
              fontStyle: 'bold',
              stroke: '#091204',
              strokeThickness: 4,
          }).setOrigin(0.5);
          const stackText = this.add.text(13, 9, `${stacks}`, {
              fontFamily: 'Trebuchet MS, sans-serif',
              fontSize: '10px',
              color: '#f6fff3',
              fontStyle: 'bold',
              stroke: '#091204',
              strokeThickness: 3,
          }).setOrigin(0.5).setName('radiationStackText');

          badge.add([glow, ring, symbol, stackText]);
          badge.setDepth(40);
          host.add(badge);

          this.tweens.add({
              targets: [glow, ring],
              alpha: { from: 0.22, to: 0.62 },
              scaleX: { from: 0.92, to: 1.16 },
              scaleY: { from: 0.92, to: 1.16 },
              duration: 620,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut'
          });
      }

      badge.setPosition(0, yOffset);
      badge.setScale(Math.max(0.82, scale));
      const stackText = badge.getByName('radiationStackText') as Phaser.GameObjects.Text | null;
      stackText?.setText(`${stacks}`);
  }

  private getProjectileOrigin(attackerId: string | undefined, fallbackX: number, fallbackY: number, angleOverride?: number) {
      if (!attackerId) {
          return { x: fallbackX, y: fallbackY };
      }

      const unit = this.getUnitSnapshotById(attackerId);
      const container = this.unitContainers.get(attackerId);
      const art = container?.getByName('art') as Phaser.GameObjects.Container | null;
      if (!unit || !container || !art) {
          return { x: fallbackX, y: fallbackY };
      }

      const localOffset = getUnitWeaponMuzzleOffset(unit.type);
      const facing = resolveUnitFacingTransform(typeof angleOverride === 'number' ? angleOverride : (art.rotation || 0));
      const baseScale = Number(art.getData('baseScale')) || Math.abs(art.scaleY || art.scaleX || 1);
      const scaleX = facing?.mirrored ? -baseScale : (art.scaleX || baseScale);
      const scaleY = art.scaleY || baseScale;
      const scaledX = localOffset.x * scaleX;
      const scaledY = localOffset.y * scaleY;
      const rotation = facing?.rotation ?? (art.rotation || 0);

      return {
          x: container.x + scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation),
          y: container.y + scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation),
      };
  }

  private updateMotionTrailVisuals(time: number) {
      if (this.motionTrailSegments.length === 0) return;

      this.motionTrailSegments = this.motionTrailSegments.filter((segment) => {
          const progress = Phaser.Math.Clamp((time - segment.bornAt) / segment.lifetimeMs, 0, 1);
          if (progress >= 1) {
              segment.sprite.destroy();
              return false;
          }

          const fade = 1 - progress;
          segment.sprite.setAlpha(segment.baseAlpha * fade * fade);
          const scale = 1 + segment.growth * progress;
          segment.sprite.setScale(scale);
          return true;
      });
  }

  private trimMotionTrailSegmentsForSkin(skinId: SkinId) {
      const style = getMotionTrailStyle(skinId);
      if (!style) return;

      const overflow = this.motionTrailSegments.length - style.maxActive;
      if (overflow <= 0) return;

      const toRemove = this.motionTrailSegments.splice(0, overflow);
      toRemove.forEach((segment) => segment.sprite.destroy());
  }

  private syncUnitSkinTrails(time: number, delta: number) {
      const dtSec = delta / 1000;
      const activeUnitIds = new Set(this.currentUnits.map((unit) => unit.id));

      this.unitTrailStates.forEach((_, unitId) => {
          if (!activeUnitIds.has(unitId)) {
              this.unitTrailStates.delete(unitId);
          }
      });

      this.currentUnits.forEach((unit) => {
          const skinId = this.getUnitSkinIdForOwner(unit.ownerId);
          const style = getMotionTrailStyle(skinId);
          const container = this.unitContainers.get(unit.id);
          if (!container) return;

          const currentX = container.x;
          const currentY = container.y;
          const unitScale = Number(container.getData('displayScale')) || getUnitArtScale(unit.type);
          const existingState = this.unitTrailStates.get(unit.id);
          if (!style) {
              this.unitTrailStates.set(unit.id, {
                  lastX: currentX,
                  lastY: currentY,
                  emitX: currentX,
                  emitY: currentY,
              });
              return;
          }

          if (!existingState) {
              this.unitTrailStates.set(unit.id, {
                  lastX: currentX,
                  lastY: currentY,
                  emitX: currentX,
                  emitY: currentY,
              });
              return;
          }

          const dx = currentX - existingState.lastX;
          const dy = currentY - existingState.lastY;
          const dist = Math.hypot(dx, dy);
          const speed = dtSec > 0 ? dist / dtSec : 0;
          const spacing = Math.max(8, style.spacing * unitScale);
          const teleportThreshold = Math.max(140, spacing * 8);

          if (dist > teleportThreshold) {
              existingState.lastX = currentX;
              existingState.lastY = currentY;
              existingState.emitX = currentX;
              existingState.emitY = currentY;
              return;
          }

          if (speed >= style.minSpeed && dist >= 0.65) {
              let anchorX = existingState.emitX;
              let anchorY = existingState.emitY;
              let remainingDx = currentX - anchorX;
              let remainingDy = currentY - anchorY;
              let remainingDist = Math.hypot(remainingDx, remainingDy);
              const angle = Math.atan2(remainingDy, remainingDx);

              while (remainingDist >= spacing) {
                  anchorX += Math.cos(angle) * spacing;
                  anchorY += Math.sin(angle) * spacing;

                  const segment = createMotionTrailSegment(this, skinId, anchorX, anchorY, angle, unitScale);
                  if (segment) {
                      this.motionTrailSegments.push({
                          sprite: segment.container,
                          bornAt: time,
                          lifetimeMs: segment.lifetimeMs,
                          baseAlpha: segment.baseAlpha,
                          growth: segment.growth,
                      });
                      this.unitsGroup.add(segment.container);
                  }

                  remainingDx = currentX - anchorX;
                  remainingDy = currentY - anchorY;
                  remainingDist = Math.hypot(remainingDx, remainingDy);
              }

              existingState.emitX = anchorX;
              existingState.emitY = anchorY;
              this.trimMotionTrailSegmentsForSkin(skinId);
          } else {
              existingState.emitX = currentX;
              existingState.emitY = currentY;
          }

          existingState.lastX = currentX;
          existingState.lastY = currentY;
      });
  }

  private getBuildingSkinIdForOwner(ownerId?: string | null) {
      return ownerId === socket.id
          ? this.activeSkinLoadout.buildingSkinId
          : 'default';
  }

  private getBuildingWorldDepth(type?: string | null) {
      return type === 'oil_rig' ? WORLD_OIL_RIG_DEPTH : WORLD_BUILDING_BASE_DEPTH;
  }

  drawDetailedBuilding(x: number, y: number, type: string, color: number, data?: any): Phaser.GameObjects.Container {
      return createBuildingArt(this, x, y, type as any, color, data);
  }

  drawDetailedUnit(
      x: number,
      y: number,
      type: string,
      color: number,
      isSelected: boolean,
      renderMode: UnitArtRenderMode = 'full',
      skinId?: import('../../utils/playerSkins').SkinId
  ): Phaser.GameObjects.Container {
      return createUnitArt(this, x, y, type, color, isSelected, { renderMode, skinId });
  }

  createUnitContainer(unit: Unit, isMine: boolean, isSelected: boolean) {
      const player = this.players.get(unit.ownerId);
      const color = player ? parseInt(player.color.replace('#', '0x')) : (isMine ? 0xAAAAFF : 0xFFAAAA);
      const renderMode = this.getUnitRenderMode(unit, isSelected);
      const skinId = this.getUnitSkinIdForOwner(unit.ownerId);
      
      const uContainer = this.add.container(unit.x, unit.y);
      const art = this.drawDetailedUnit(0, 0, unit.type, color, isSelected, renderMode, skinId);
      const displayScale = getUnitArtScale(unit.type);
      applySkinToArtContainer(this, art, skinId, 'unit');
      if (isSelected) {
          const outlineColor = skinId !== 'default'
              ? (SKIN_DEFINITIONS_BY_ID[skinId]?.palette.glow ?? 0xfff4ad)
              : 0xfff4ad;
          addOuterOutlineToArtContainer(this, art, 'unit', outlineColor, {
              width: 2.4,
              alpha: 0.96,
              expand: 1.12,
          });
      }
      art.setName('art');
      art.setScale(displayScale);
      art.setData('baseScale', displayScale);
      uContainer.add(art);
      uContainer.setPosition(unit.x, unit.y);
      uContainer.setDepth(20); // Ensure units are above everything else
      uContainer.setData('isSelected', isSelected);
      uContainer.setData('renderMode', renderMode);
      uContainer.setData('unitType', unit.type);
      uContainer.setData('displayScale', displayScale);
      this.unitTrailStates.set(unit.id, {
          lastX: unit.x,
          lastY: unit.y,
          emitX: unit.x,
          emitY: unit.y,
      });
      
      // Add Health Bar to container
      if (unit.maxHealth > 0) {
         const hpPercent = Math.max(0, unit.health / unit.maxHealth);
         let barColor = 0x00FF00; // High (Green)
         if (hpPercent <= 0.3) barColor = 0xFF0000; // Low (Red)
         else if (hpPercent <= 0.6) barColor = 0xFFFF00; // Medium (Yellow)
         
         let hpBarWidth = 16;
         let hpBarY = -12;

         // Dynamic HP Bar Sizing
         switch (unit.type) {
             case 'mothership': hpBarWidth = 120; hpBarY = -90; break;
             case 'aircraft_carrier': hpBarWidth = 140; hpBarY = -50; break;
             case 'heavy_alien': hpBarWidth = 64; hpBarY = -36; break;
             case 'alien_scout': hpBarWidth = 36; hpBarY = -28; break;
             case 'heavy_plane': hpBarWidth = 40; hpBarY = -25; break;
             case 'destroyer': hpBarWidth = 32; hpBarY = -15; break;
             case 'pirate_ship': hpBarWidth = 34; hpBarY = -15; break;
             case 'construction_ship': hpBarWidth = 36; hpBarY = -15; break;
             case 'ferry': hpBarWidth = 32; hpBarY = -15; break;
             case 'missile_launcher': hpBarWidth = 24; hpBarY = -15; break;
             case 'tank': hpBarWidth = 24; hpBarY = -15; break;
             case 'humvee': hpBarWidth = 20; hpBarY = -12; break;
         }

         const scaledHpBarY = hpBarY * displayScale;
         const scaledHpBarWidth = hpBarWidth * displayScale;
         const hpBarBg = this.add.rectangle(0, scaledHpBarY, scaledHpBarWidth + 2, 5, 0x000000, 0.62);
         hpBarBg.setStrokeStyle(1, 0x000000, 1);
         hpBarBg.setName('hpBarBg');
         uContainer.add(hpBarBg);

         const hpBar = this.add.rectangle(0, scaledHpBarY, scaledHpBarWidth * hpPercent, 3, barColor);
         hpBar.setStrokeStyle(1, 0x000000, 1);
         hpBar.setName('hpBar');
         hpBar.setData('maxBarWidth', scaledHpBarWidth);
         uContainer.add(hpBar);
      }

      this.syncRadiationBadge(
          uContainer,
          unit.radiationStacks,
          this.getUnitRadiationBadgeOffset(unit.type, displayScale),
          Math.max(0.86, displayScale)
      );

      // Dynamic Hit Area
      let width = 24;
      let height = 24;
      
      switch (unit.type) {
          case 'mothership': width = 160; height = 160; break;
          case 'aircraft_carrier': width = 180; height = 80; break;
          case 'heavy_alien': width = 94; height = 54; break;
          case 'alien_scout': width = 54; height = 34; break;
          case 'heavy_plane': width = 50; height = 50; break;
          case 'destroyer': width = 40; height = 20; break;
          case 'pirate_ship': width = 42; height = 24; break;
          case 'construction_ship': width = 45; height = 25; break;
          case 'ferry': width = 40; height = 25; break;
          case 'tank':
          case 'missile_launcher':
          case 'humvee': width = 30; height = 30; break;
      }

      const scaledWidth = width * displayScale;
      const scaledHeight = height * displayScale;
      const hitArea = this.add.rectangle(0, 0, scaledWidth, scaledHeight, 0x000000, 0); // Invisible hit area
      uContainer.add(hitArea);
      uContainer.setSize(scaledWidth, scaledHeight);
      uContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

      uContainer.on('pointerdown', (pointer: any) => {
        if (this.placementMode) {
             if (pointer.event) pointer.event.stopPropagation();
             this.tryPlaceCurrentBuilding(pointer.x, pointer.y, !!pointer.event?.shiftKey);
             return;
        }
        if (pointer.rightButtonDown()) {
             // Right Click: Select Unit (Fix for user request)
             pointer.event.stopPropagation(); 
             
             if (unit.ownerId === socket.id) {
                 if (this.selectedUnitIds.has(unit.id)) {
                    // Optional: Deselect if already selected? Or just keep selected.
                    // Usually right click selects single unit, clearing others unless shift held.
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                        this.selectedUnitIds.add(unit.id);
                    }
                 } else {
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                    }
                    this.selectedUnitIds.add(unit.id);
                 }
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                      detail: { unitIds: Array.from(this.selectedUnitIds) } 
                  }));
              }
        } else if (pointer.leftButtonDown()) {
             // Left Click: Move or Attack (if enemy) or Select (if desired, but we want Right Click Select)
             // If we want Left Click to be strictly Move/Action, we should ignore selection here?
             // But if we click a unit with Left Click, standard RTS selects it too usually.
             // Let's keep Left Click Select as fallback/standard, but ensure Right Click works too.
             pointer.event.stopPropagation(); 
             
             if (unit.ownerId === socket.id) {
                 if (this.selectedUnitIds.has(unit.id)) {
                    this.selectedUnitIds.delete(unit.id);
                 } else {
                    this.selectedUnitIds.add(unit.id);
                 }
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                      detail: { unitIds: Array.from(this.selectedUnitIds) } 
                  }));
              }
         }
      });

      uContainer.on('pointerover', () => {
          const event = new CustomEvent('game-hover', { 
              detail: { 
                  x: uContainer.x, y: uContainer.y, 
                  title: unit.type.toUpperCase(),
                  health: unit.health, maxHealth: unit.maxHealth, 
                  damage: unit.damage, speed: unit.speed, attackSpeed: unit.fireRate,
                  owner: unit.ownerId, type: unit.type
              } 
          });
          window.dispatchEvent(event);
      });
      uContainer.on('pointerout', () => {
          window.dispatchEvent(new CustomEvent('game-hover', { detail: null }));
      });

      this.rotateUnitArt(uContainer, this.getDesiredFacingAngle(unit), 1 / 60, true);
      this.unitsGroup.add(uContainer);
      this.unitContainers.set(unit.id, uContainer);
  }

  renderUnits(units: Unit[]) {
    this.currentUnits = units;
    this.syncUnitDetailMode(units);
    this.rangeGraphics.clear();
    
    // Track active unit IDs to remove dead ones later
    const activeUnitIds = new Set<string>();

    units.forEach(unit => {
      activeUnitIds.add(unit.id);
      
      const isMine = unit.ownerId === socket.id;
      const isSelected = this.selectedUnitIds.has(unit.id);
      const renderMode = this.getUnitRenderMode(unit, isSelected);
      
      // Check if unit already exists
      if (this.unitContainers.has(unit.id)) {
          const container = this.unitContainers.get(unit.id)!;
          
          // Update position
          // container.setPosition(unit.x, unit.y); // Handled by interpolation in update()
          
          // Check selection change
          const wasSelected = container.getData('isSelected');
          const previousRenderMode = container.getData('renderMode');
          
          if (wasSelected !== isSelected || previousRenderMode !== renderMode) {
              // Recreate if selection or detail mode changed
              container.destroy();
              this.createUnitContainer(unit, isMine, isSelected);
          } else {
              // Update Health Bar
              const hpBar = container.getByName('hpBar') as Phaser.GameObjects.Rectangle;
              if (hpBar && unit.maxHealth > 0) {
                  const hpPercent = Math.max(0, unit.health / unit.maxHealth);
                  let barColor = 0x00FF00; // High (Green)
                  if (hpPercent <= 0.3) barColor = 0xFF0000; // Low (Red)
                  else if (hpPercent <= 0.6) barColor = 0xFFFF00; // Medium (Yellow)
                  
                  const hpBarWidth = Number(hpBar.getData('maxBarWidth')) || 16;
                  hpBar.width = hpBarWidth * hpPercent;
                  hpBar.fillColor = barColor;
              }

              const displayScale = Number(container.getData('displayScale')) || 1;
              this.syncRadiationBadge(
                  container,
                  unit.radiationStacks,
                  this.getUnitRadiationBadgeOffset(unit.type, displayScale),
                  Math.max(0.86, displayScale)
              );
          }
      } else {
          // Create new unit
          this.createUnitContainer(unit, isMine, isSelected);
      }

      // Draw Range - Moved to renderRangeRings()
      });


      // Cleanup dead units
      this.unitContainers.forEach((container, id) => {
          if (!activeUnitIds.has(id)) {
              container.destroy();
              this.unitContainers.delete(id);
              this.unitUpdates.delete(id);
              this.attackFacingOverrides.delete(id);
              this.unitTrailStates.delete(id);
          }
      });
    }

    drawBiomeDetails(island: Island, points: any[]) {
      const detailGraphics = this.add.graphics();
      detailGraphics.setDepth(1.05);
      this.islandsGroup.add(detailGraphics);

      let detailColor = 0x006400; // Dark Green (Forest Trees)
      if (island.type === 'desert') detailColor = 0x8B4513; // SaddleBrown (Rocks)
      if (island.type === 'snow') detailColor = 0xB0C4DE; // LightSteelBlue (Ice)
      if (island.type === 'grasslands') detailColor = 0x228B22; // ForestGreen (Grass tufts)
      
      const polyGeom = new Phaser.Geom.Polygon(points);
      const bounds = Phaser.Geom.Polygon.GetAABB(polyGeom);
      
      const graphicsSettings = settingsManager.getSettings().graphics;
       let numDetails = 0;

       if (graphicsSettings.showParticles) {
           const density = 0.002; // Base density
           const area = bounds.width * bounds.height; 
           numDetails = Math.floor(area * density);
           
           // Limit total particles based on settings
           const maxParticles = graphicsSettings.maxParticles || 500;
           numDetails = Math.min(numDetails, maxParticles);
       }
 
       detailGraphics.fillStyle(detailColor, 0.5); // Slightly more transparent

      for(let i=0; i<numDetails; i++) {
          const rx = bounds.x + Math.random() * bounds.width;
          const ry = bounds.y + Math.random() * bounds.height;
          
          if (Phaser.Geom.Polygon.Contains(polyGeom, rx, ry)) {
              // Draw small detail
              const size = Math.random() * 4 + 2;
              
              if (island.type === 'desert') {
                  // Rocks (squares) & Dunes (lines)
                  if (Math.random() > 0.7) {
                       detailGraphics.fillStyle(0x8B4513, 0.6); // Darker rock
                       detailGraphics.fillRect(rx, ry, size, size);
                  } else {
                       detailGraphics.fillStyle(0xDEB887, 0.4); // Sand dune shadow
                       detailGraphics.fillCircle(rx, ry, size * 2);
                  }
              } else if (island.type === 'snow') {
                  // Ice chunks (irregular) & Snow piles
                   detailGraphics.fillStyle(0xE0FFFF, 0.7);
                   detailGraphics.fillCircle(rx, ry, size);
              } else if (island.type === 'grasslands') {
                   // Grass tufts & Trees
                   if (Math.random() > 0.8) {
                       // Tree
                       detailGraphics.fillStyle(0x8B4513, 1); // Trunk
                       detailGraphics.fillRect(rx, ry, 4, 8);
                       detailGraphics.fillStyle(0x228B22, 1); // Leaves
                       detailGraphics.fillCircle(rx + 2, ry - 4, size + 4);
                   } else {
                       // Grass
                       detailGraphics.fillStyle(0x006400, 0.4);
                       detailGraphics.fillRect(rx, ry, 2, size);
                   }
              } else {
                  // Forest or Default Island
                  if (island.type === 'forest') {
                      // Forest: Trees
                      detailGraphics.fillStyle(0x006400, 0.6);
                      detailGraphics.fillCircle(rx, ry, size);
                      detailGraphics.fillStyle(0x004d00, 0.8);
                      detailGraphics.fillCircle(rx, ry, size/2);
                  } else {
                      // Default Island: Palm Trees
                      if (Math.random() > 0.7) {
                          // Palm Trunk
                          detailGraphics.lineStyle(2, 0x8B4513);
                          detailGraphics.beginPath();
                          detailGraphics.moveTo(rx, ry);
                          detailGraphics.lineTo(rx + 5, ry - 10);
                          detailGraphics.lineTo(rx + 10, ry - 15);
                          detailGraphics.strokePath();
                          // Palm Leaves
                          detailGraphics.fillStyle(0x32CD32, 1);
                          detailGraphics.fillCircle(rx + 10, ry - 15, size);
                      }
                  }
              }
          }
      }

      // Tumbleweeds (Desert only)
      if (island.type === 'desert' && graphicsSettings.showWeather) {
          const maxP = graphicsSettings.maxParticles || 1000;
          // Calculate density-based count, but cap by global setting roughly?
          // User wants "only have those amounts". Let's assume maxParticles is GLOBAL limit.
          // But here we are iterating islands. We need local limit.
          // Let's approximate: 50 particles per large island if max is high.
          // Or use a strict density.
          
          const area = bounds.width * bounds.height;
          const numTumbleweeds = Math.min(20, Math.floor(area / 10000 * (maxP / 500))); 
          
          for(let k=0; k<numTumbleweeds; k++) {
              const tx = bounds.x + Math.random() * bounds.width;
              const ty = bounds.y + Math.random() * bounds.height;
              if (Phaser.Geom.Polygon.Contains(polyGeom, tx, ty)) {
                   // Tumbleweed visual
                   const tw = this.add.circle(tx, ty, 3, 0x8B4513);
                   tw.setDepth(1.5);
                   this.islandsGroup.add(tw);
                   
                   this.tumbleweeds.push({
                       sprite: tw,
                       dx: (Math.random() - 0.5) * 1.5,
                       dy: (Math.random() - 0.5) * 1.5,
                       life: Math.random() * 5, // Random start life
                       maxLife: 5,
                       poly: polyGeom,
                       bounds: bounds
                   });
              }
          }
      } else if (graphicsSettings.showWeather) {
          // Rain (Non-Desert)
          const maxP = graphicsSettings.maxParticles || 1000;
          
          // Rain density
          const numDrops = Math.floor(island.radius / 5 * (maxP / 500)); 
          
          for(let k=0; k<numDrops; k++) {
              const rx = bounds.x + Math.random() * bounds.width;
              const ry = bounds.y + Math.random() * bounds.height;
              
              if (Phaser.Geom.Polygon.Contains(polyGeom, rx, ry)) {
                   const drop = this.add.rectangle(rx, ry, 1, 4, 0xAAAAFF, 0.6);
                   drop.setDepth(2);
                   this.islandsGroup.add(drop);
                   
                   this.weatherParticles.push({
                       sprite: drop,
                       dx: -0.5, // Slight wind
                       dy: 4 + Math.random() * 2, // Fall speed
                       type: 'rain',
                       life: Math.random() * 5,
                       maxLife: 5,
                       poly: polyGeom,
                       bounds: bounds
                   });
              }
          }
      }

      // Volcano Logic (Deterministic)
      // Only for default 'island' type or unspecified
      if (((island.type as string) === 'island' || island.type === 'forest') && island.radius > 150) {
          // Simple hash for consistency
          let h = 0;
          for(let i=0; i<island.id.length; i++) h = Math.imul(31, h) + island.id.charCodeAt(i) | 0;
          
          if (Math.abs(h) % 6 === 0) {
             // Draw Volcano
             const vx = island.x;
             const vy = island.y;
             const vSize = island.radius * 0.5;
             
             const volcano = this.add.graphics();
             volcano.fillStyle(0x3E2723, 1); // Dark brown cone
             volcano.fillTriangle(vx, vy - vSize, vx - vSize, vy + vSize/2, vx + vSize, vy + vSize/2);
             
             // Lava Cap
             volcano.fillStyle(0xFF4500, 1);
             volcano.fillTriangle(vx, vy - vSize, vx - vSize/4, vy - vSize/2, vx + vSize/4, vy - vSize/2);
             
             volcano.setDepth(1.2);
             this.islandsGroup.add(volcano);
          }
      }
    }

    renderMap(mapData: GameMap) {
        this.currentMap = mapData;
        this.islandsGroup.clear(true, true);
        this.tumbleweeds = [];
        this.weatherParticles = [];
        this.oilAnimations = [];
        this.goldSparkles = [];
        this.oilSpotVisuals.clear();
        // this.revealedOilSpots.clear(); // Persistence Fix: Do not clear revealed spots on re-render

        // Render Oil Spots
        if (mapData.oilSpots) {
            mapData.oilSpots.forEach(spot => {
                const isHiddenSpot = spot.id.startsWith('hidden_oil_');
                const isRevealed = this.revealedOilSpots.has(spot.id);
                const shouldShow = !isHiddenSpot || isRevealed;
                
                // Base Color is ALWAYS BLACK (0x000000)
                const color = 0x000000;
                const alpha = 0.5;

                const circle = this.add.circle(spot.x, spot.y, spot.radius, color, alpha);
                circle.setDepth(10); // Layer 10: Significantly above islands
                circle.setVisible(shouldShow);
                this.islandsGroup.add(circle);
                
                // Red Ping Marker (Only for revealed hidden spots)
                let ping: Phaser.GameObjects.Rectangle | null = null;
                if (isHiddenSpot) {
                     // A red square block "ping" on top
                     ping = this.add.rectangle(spot.x, spot.y, 20, 20, 0xFF0000);
                     ping.setDepth(11); // Above the black spot
                     ping.setVisible(isRevealed); // Only visible if revealed
                     this.islandsGroup.add(ping);
                }
                
                // Pulse Animation (Red waves if hidden/revealed)
                const pulseColor = isHiddenSpot ? 0xFF0000 : 0x000000;
                const pulse = this.add.circle(spot.x, spot.y, spot.radius, pulseColor, 1);
                pulse.setDepth(9.9); // Layer 9.9: Just below the spot
                pulse.setVisible(shouldShow);
                this.islandsGroup.add(pulse);
                
                this.oilAnimations.push({
                    id: spot.id,
                    x: spot.x,
                    y: spot.y,
                    pulse: pulse,
                    timer: Math.random() * 1000 // Random offset
                });
                
                // Add to visuals map for scanner updates
                // We store 'ping' as well so we can toggle it
                this.oilSpotVisuals.set(spot.id, { main: circle, pulse: pulse, ping: ping || undefined });
                
                // Interaction: If hidden, DISABLE interaction initially
                if (isHiddenSpot && !isRevealed) {
                    circle.disableInteractive();
                } else {
                    // Use LOCAL coordinates (0,0) for the hit area, not World coordinates
                    circle.setInteractive(new Phaser.Geom.Circle(0, 0, spot.radius), Phaser.Geom.Circle.Contains);
                }

                circle.on('pointerover', () => {
                    window.dispatchEvent(new CustomEvent('game-hover', { detail: { title: "Oil Spot", type: "Resource" } }));
                });
                circle.on('pointerout', () => window.dispatchEvent(new CustomEvent('game-hover', { detail: null })));

                if (spot.occupiedBy) {
                        const b = (spot as any).building;
                        if (b) {
                            const bContainer = this.drawDetailedBuilding(spot.x, spot.y, b.type, 0x555555, b);
                            applySkinToArtContainer(this, bContainer, this.getBuildingSkinIdForOwner((spot as any).ownerId), 'building');
                        bContainer.setDepth(this.getBuildingWorldDepth(b.type));
                        this.islandsGroup.add(bContainer);
                        this.syncRadiationBadge(bContainer, b.radiationStacks, -34, 0.92);
                        
                        const isMine = (spot as any).ownerId === socket.id;
                        if (b.isConstructing) {
                             const p = b.constructionProgress || 0;
                             const blueBarBg = this.add.rectangle(spot.x, spot.y - 15, 18, 5, 0x000000, 0.62);
                             blueBarBg.setStrokeStyle(1, 0x000000, 1);
                             this.islandsGroup.add(blueBarBg);
                             const blueBar = this.add.rectangle(spot.x, spot.y - 15, 16 * (p/100), 3, 0x0000FF);
                             blueBar.setStrokeStyle(1, 0x000000, 1);
                             this.islandsGroup.add(blueBar);
                        } else {
                             const hpPercent = Math.max(0, b.health / b.maxHealth);
                             const barColor = isMine ? 0x00FF00 : 0xFF0000;
                             const hpBarBg = this.add.rectangle(spot.x, spot.y - 15, 18, 5, 0x000000, 0.62);
                             hpBarBg.setStrokeStyle(1, 0x000000, 1);
                             this.islandsGroup.add(hpBarBg);
                             const hpBar = this.add.rectangle(spot.x, spot.y - 15, 16 * hpPercent, 3, barColor);
                             hpBar.setStrokeStyle(1, 0x000000, 1);
                             this.islandsGroup.add(hpBar);
                        }
                    }
                }
            });
        }

        (mapData.waterBuildings || []).forEach(building => {
            const bx = building.x || 0;
            const by = building.y || 0;
            const owner = building.ownerId ? this.players.get(building.ownerId) : undefined;
            const color = owner ? parseInt(owner.color.replace('#', '0x')) : 0x555555;
            const isMine = building.ownerId === socket.id;

            const bContainer = this.drawDetailedBuilding(bx, by, building.type, color, building);
            applySkinToArtContainer(this, bContainer, this.getBuildingSkinIdForOwner(building.ownerId), 'building');
            bContainer.setDepth(this.getBuildingWorldDepth(building.type));
            this.islandsGroup.add(bContainer);
            this.syncRadiationBadge(bContainer, building.radiationStacks, -34, 0.92);
            bContainer.setSize(24, 24);
            bContainer.setInteractive();

            const isSelected = this.selectedNodeIds.has(building.id) || this.selectedBuildingIds.has(building.id);
            if (isSelected) {
                const skinId = this.getBuildingSkinIdForOwner(building.ownerId);
                const outlineColor = skinId !== 'default'
                    ? (SKIN_DEFINITIONS_BY_ID[skinId]?.palette.glow ?? 0x00FF00)
                    : 0x00FF00;
                addOuterOutlineToArtContainer(this, bContainer, 'building', outlineColor, {
                    width: 2.6,
                    alpha: 0.96,
                    expand: 1.08,
                });
            }

            if (building.isConstructing) {
                const p = building.constructionProgress || 0;
                const blueBarBg = this.add.rectangle(bx, by - 15, 18, 5, 0x000000, 0.62);
                blueBarBg.setStrokeStyle(1, 0x000000, 1);
                this.islandsGroup.add(blueBarBg);
                const blueBar = this.add.rectangle(bx, by - 15, 16 * (p / 100), 3, 0x0000FF);
                blueBar.setStrokeStyle(1, 0x000000, 1);
                this.islandsGroup.add(blueBar);
            } else {
                const hpPercent = Math.max(0, building.health / building.maxHealth);
                const hpBarBg = this.add.rectangle(bx, by - 15, 18, 5, 0x000000, 0.62);
                hpBarBg.setStrokeStyle(1, 0x000000, 1);
                this.islandsGroup.add(hpBarBg);
                const hpBar = this.add.rectangle(bx, by - 15, 16 * hpPercent, 3, isMine ? 0x00FF00 : 0xFF0000);
                hpBar.setStrokeStyle(1, 0x000000, 1);
                this.islandsGroup.add(hpBar);
            }

            bContainer.on('pointerover', () => {
                window.dispatchEvent(new CustomEvent('game-hover', {
                    detail: {
                        title: building.type.charAt(0).toUpperCase() + building.type.slice(1).replace('_', ' '),
                        owner: building.ownerId,
                        type: 'Building',
                        health: building.health,
                        maxHealth: building.maxHealth,
                        id: building.id
                    }
                }));
            });
            bContainer.on('pointerout', () => window.dispatchEvent(new CustomEvent('game-hover', { detail: null })));
            bContainer.on('pointerdown', (pointer: any) => {
                if (this.placementMode) {
                    if (pointer.event) pointer.event.stopPropagation();
                    this.tryPlaceCurrentBuilding(pointer.x, pointer.y, !!pointer.event?.shiftKey);
                    return;
                }
                if (pointer.event) pointer.event.stopPropagation();

                if (building.type === 'bridge_node' || building.type === 'wall_node') {
                    if (building.ownerId !== socket.id) return;
                    if (this.selectedNodeIds.has(building.id)) {
                        this.selectedNodeIds.delete(building.id);
                    } else {
                        this.selectedNodeIds.add(building.id);
                    }
                    window.dispatchEvent(new CustomEvent('node-selection-changed', {
                        detail: { nodes: Array.from(this.selectedNodeIds) }
                    }));
                    this.renderMap(this.currentMap!);
                    return;
                }

                this.selectedBuildingIds.clear();
                this.selectedUnitIds.clear();
                this.selectedNodeIds.clear();
                this.selectedBuildingIds.add(building.id);
                window.dispatchEvent(new CustomEvent('building-selection-changed', {
                    detail: { buildingIds: Array.from(this.selectedBuildingIds) }
                }));
                window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                this.renderMap(this.currentMap!);
            });
        });

    // Render Bridges
    if (mapData.bridges) {
        this.getBridgeChainPaths(mapData.bridges).forEach(chain => {
            const graphics = this.add.graphics();
            graphics.setDepth(2);
            this.islandsGroup.add(graphics);

            graphics.lineStyle(20, 0x8B4513);
            graphics.beginPath();
            graphics.moveTo(chain.points[0].x, chain.points[0].y);
            for (let i = 1; i < chain.points.length; i += 1) {
                graphics.lineTo(chain.points[i].x, chain.points[i].y);
            }
            graphics.strokePath();

            graphics.lineStyle(16, 0xDEB887);
            graphics.beginPath();
            graphics.moveTo(chain.points[0].x, chain.points[0].y);
            for (let i = 1; i < chain.points.length; i += 1) {
                graphics.lineTo(chain.points[i].x, chain.points[i].y);
            }
            graphics.strokePath();

            graphics.lineStyle(1, 0x5C4033);
            for (let i = 0; i < chain.points.length - 1; i += 1) {
                const ax = chain.points[i].x;
                const ay = chain.points[i].y;
                const bx = chain.points[i + 1].x;
                const by = chain.points[i + 1].y;
                const dist = Math.hypot(bx - ax, by - ay);
                const angle = Math.atan2(by - ay, bx - ax);
                const steps = dist / 10;

                for (let step = 0; step < steps; step += 1) {
                    const px = ax + Math.cos(angle) * step * 10;
                    const py = ay + Math.sin(angle) * step * 10;
                    const p1x = px + Math.cos(angle + Math.PI / 2) * 8;
                    const p1y = py + Math.sin(angle + Math.PI / 2) * 8;
                    const p2x = px + Math.cos(angle - Math.PI / 2) * 8;
                    const p2y = py + Math.sin(angle - Math.PI / 2) * 8;
                    graphics.lineBetween(p1x, p1y, p2x, p2y);
                }
            }
        });

        mapData.bridges
            .filter(bridge => bridge.type !== 'bridge')
            .forEach(bridge => {
                const endpoints = this.getBridgeEndpoints(bridge);
                if (endpoints) {
                    const { ax, ay, bx, by } = endpoints;

                    const graphics = this.add.graphics();
                    graphics.setDepth(2);
                    this.islandsGroup.add(graphics);

                    if (bridge.type === 'gate') {
                        // Gate Rendering
                        // Darker, wider base
                        graphics.lineStyle(16, 0x222222);
                        graphics.lineBetween(ax, ay, bx, by);
                        
                        // Wood/Portcullis look in center
                        graphics.lineStyle(10, 0x5D4037); // Dark Wood
                        graphics.lineBetween(ax, ay, bx, by);

                        // Vertical bars (Iron bars)
                        const dist = Math.hypot(bx - ax, by - ay);
                        const angle = Math.atan2(by - ay, bx - ax);
                        const steps = dist / 8; // Dense bars
                        graphics.lineStyle(2, 0x111111);
                        
                        for(let i=0; i<steps; i++) {
                            const px = ax + Math.cos(angle) * i * 8;
                            const py = ay + Math.sin(angle) * i * 8;
                            // Bars perpendicular to wall direction
                            const p1x = px + Math.cos(angle + Math.PI/2) * 5;
                            const p1y = py + Math.sin(angle + Math.PI/2) * 5;
                            const p2x = px + Math.cos(angle - Math.PI/2) * 5;
                            const p2y = py + Math.sin(angle - Math.PI/2) * 5;
                            graphics.lineBetween(p1x, p1y, p2x, p2y);
                        }
                    } else {
                        // Stone Wall
                        graphics.lineStyle(12, 0x444444);
                        graphics.lineBetween(ax, ay, bx, by);
                        graphics.lineStyle(8, 0x888888);
                        graphics.lineBetween(ax, ay, bx, by);
                    }
                }
            });
    }

    // Render High Grounds
    if (mapData.highGrounds) {
        mapData.highGrounds.forEach(hg => {
            const points = hg.points;
            
            // 1. Stroke (Outline)
            const strokeGraphics = this.add.graphics();
            strokeGraphics.lineStyle(6, 0x3E2723); // Very Dark Brown
            strokeGraphics.strokePoints(points, true);
            strokeGraphics.setDepth(1.1); // Above Island Fill (1)
            this.islandsGroup.add(strokeGraphics);

            // 2. Fill
            const fillPoly = this.add.polygon(0, 0, points, 0x795548); // Brown
            fillPoly.setOrigin(0, 0);
            fillPoly.setDepth(1.1);
            this.islandsGroup.add(fillPoly);
        });
    }

    // Render Islands
    mapData.islands.forEach((island: Island) => {
      let color = 0x228B22; // Forest Green
      if (island.type === 'desert') color = 0xF4A460; // Sandy Brown
      if (island.type === 'snow') color = 0xFFFAFA; // Snow

      // Oil Oasis Logic
      if ((island as any).subtype === 'oil_field' || island.id === 'oil_pit') {
          color = 0x222222; // Dark Oil Color
      }

      let points = island.points;
      if (!points) {
          points = [];
          const numPoints = 32;
          for(let i=0; i<numPoints; i++) {
              const angle = (i / numPoints) * Math.PI * 2;
              points.push({
                  x: island.x + Math.cos(angle) * island.radius,
                  y: island.y + Math.sin(angle) * island.radius
              });
          }
      }

      // 1. Stroke (Background, wider)
      const strokeGraphics = this.add.graphics();
      let strokeColor = 0xDAA520;
      let strokeWidth = 3;
      
      if (island.ownerId && this.players.has(island.ownerId)) {
        const owner = this.players.get(island.ownerId)!;
        strokeColor = Phaser.Display.Color.HexStringToColor(owner.color).color;
        strokeWidth = 10; // Thicker for merging
      } else if (island.id === 'high_land') {
        // High Ground Border
        strokeColor = 0x5C4033; // Dark Brown (Cliff edge)
        strokeWidth = 8;
      }
      
      strokeGraphics.lineStyle(strokeWidth, strokeColor);
      strokeGraphics.strokePoints(points, true);
      strokeGraphics.setDepth(0);
      this.islandsGroup.add(strokeGraphics);

      // 2. Fill (Foreground)
      const fillPoly = this.add.polygon(0, 0, points, color);
      fillPoly.setOrigin(0, 0);
      fillPoly.setDepth(1);
      fillPoly.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);
      this.islandsGroup.add(fillPoly);
      
      // Biome Textures / Details
      this.drawBiomeDetails(island, points);

      // Render Gold Spots
      if (island.goldSpots) {
          island.goldSpots.forEach(spot => {
             const gx = island.x + spot.x;
             const gy = island.y + spot.y;
             
             // Detailed Gold Spot visual
             const container = this.add.container(gx, gy);
             container.setDepth(1.1);
             this.islandsGroup.add(container);
             
             // Nuggets
             const n1 = this.add.circle(-4, 2, 3, 0xFFD700);
             const n2 = this.add.circle(4, 0, 4, 0xDAA520);
             const n3 = this.add.circle(0, -4, 3, 0xFFD700);
             
             // Sparkle
             const sparkle = this.add.star(0, -8, 4, 2, 4, 0xFFFFFF);
             this.goldSparkles.push({
                 sprite: sparkle,
                 timer: Math.random() * 1000,
                 speed: 0.8 + Math.random() * 0.6
             });
             
             container.add([n1, n2, n3, sparkle]);
          });
      }

      // Render Buildings
      island.buildings.forEach((b) => {
        // Use relative position if available
        const bx = island.x + (b.x || 0);
        const by = island.y + (b.y || 0);
        
        const bOwnerId = b.ownerId || island.ownerId;
        const bPlayer = bOwnerId ? this.players.get(bOwnerId) : undefined;
        // Use player color by default for base/team coloring
        let bColor = bPlayer ? parseInt(bPlayer.color.replace('#', '0x')) : 0x808080;

        // Specific overrides for resource buildings if unowned
        if (b.type === 'mine' && !bPlayer) bColor = 0xFFD700; // Gold
        if (b.type === 'wall' && !bPlayer) bColor = 0x666666; // Grey
        if ((b.type === 'wall_node' || b.type === 'bridge_node') && !bPlayer) bColor = 0x666666;
        
        const bContainer = this.drawDetailedBuilding(bx, by, b.type, bColor, b);
        applySkinToArtContainer(this, bContainer, this.getBuildingSkinIdForOwner(bOwnerId), 'building');
        bContainer.setDepth(this.getBuildingWorldDepth(b.type));
        this.islandsGroup.add(bContainer);
        this.syncRadiationBadge(bContainer, b.radiationStacks, -34, 0.92);

        bContainer.setSize(24, 24);
        bContainer.setInteractive();

        const isSelected = this.selectedNodeIds.has(b.id) || this.selectedBuildingIds.has(b.id);
        const isHovered = (this as any).hoveredBuildingId === b.id;

        if (isSelected) {
            const skinId = this.getBuildingSkinIdForOwner(bOwnerId);
            const outlineColor = skinId !== 'default'
                ? (SKIN_DEFINITIONS_BY_ID[skinId]?.palette.glow ?? 0x00FF00)
                : 0x00FF00;
            addOuterOutlineToArtContainer(this, bContainer, 'building', outlineColor, {
                width: 2.6,
                alpha: 0.96,
                expand: 1.08,
            });
        }

        // --- BARS IMPLEMENTATION ---
        // Base Dimensions (Larger than before)
        const barW = 32; 
        const barH = 6;  
        
        // Add Construction Bar
        if (b.isConstructing) {
             const p = b.constructionProgress || 0;
             const blueBarBg = this.add.rectangle(0, -20, barW + 2, barH + 2, 0x000000, 0.62);
             blueBarBg.setStrokeStyle(1.25, 0x000000, 1);
             blueBarBg.setName('constructionBarBg');
             bContainer.add(blueBarBg);
             const blueBar = this.add.rectangle(0, -20, barW * (p/100), barH, 0x0000FF);
             blueBar.setStrokeStyle(1.25, 0x000000, 1);
             blueBar.setName('constructionBar');
             blueBar.setData('maxBarWidth', barW);
             bContainer.add(blueBar);
        } else {
             const hpPercent = Math.max(0, b.health / b.maxHealth);
             const isMine = bOwnerId === socket.id;
             const hpColor = isMine ? 0x00FF00 : 0xFF0000;
             const hpBarBg = this.add.rectangle(0, -20, barW + 2, barH + 2, 0x000000, 0.62);
             hpBarBg.setStrokeStyle(1.25, 0x000000, 1);
             hpBarBg.setName('hpBarBg');
             bContainer.add(hpBarBg);
             const hpBar = this.add.rectangle(0, -20, barW * hpPercent, barH, hpColor);
             hpBar.setStrokeStyle(1.25, 0x000000, 1);
             hpBar.setName('hpBar');
             hpBar.setData('maxBarWidth', barW);
             bContainer.add(hpBar);
             
             // Recruitment Bar
             if (b.recruitmentQueue && b.recruitmentQueue.length > 0) {
                 const item = b.recruitmentQueue[0];
                 const rp = Math.min(1, item.progress / item.totalTime);
                 const recBarBg = this.add.rectangle(0, -26, barW + 2, barH + 1, 0x000000, 0.62);
                 recBarBg.setStrokeStyle(1.25, 0x000000, 1);
                 recBarBg.setName('recruitBarBg');
                 bContainer.add(recBarBg);
                 const recBar = this.add.rectangle(0, -26, barW * rp, barH - 1, 0xFFFF00);
                 recBar.setStrokeStyle(1.25, 0x000000, 1);
                 recBar.setName('recruitBar');
                 recBar.setData('maxBarWidth', barW);
                 bContainer.add(recBar);
             }
        }

        // Update function for hover/select
        const updateBars = (active: boolean) => {
            const scale = active ? 1.5 : 1.0; // 50% larger on hover/select
            const cBarBg = bContainer.getByName('constructionBarBg') as Phaser.GameObjects.Rectangle;
            if (cBarBg) {
                cBarBg.setScale(scale);
                cBarBg.y = active ? -26 : -20;
            }
            const cBar = bContainer.getByName('constructionBar') as Phaser.GameObjects.Rectangle;
            if (cBar) {
                cBar.setScale(scale);
                cBar.y = active ? -26 : -20;
            }
            const hBarBg = bContainer.getByName('hpBarBg') as Phaser.GameObjects.Rectangle;
            if (hBarBg) {
                hBarBg.setScale(scale);
                hBarBg.y = active ? -26 : -20;
            }
            const hBar = bContainer.getByName('hpBar') as Phaser.GameObjects.Rectangle;
            if (hBar) {
                hBar.setScale(scale);
                hBar.y = active ? -26 : -20;
            }
            const rBarBg = bContainer.getByName('recruitBarBg') as Phaser.GameObjects.Rectangle;
            if (rBarBg) {
                rBarBg.setScale(scale);
                rBarBg.y = active ? -34 : -26;
            }
            const rBar = bContainer.getByName('recruitBar') as Phaser.GameObjects.Rectangle;
            if (rBar) {
                rBar.setScale(scale);
                rBar.y = active ? -34 : -26;
            }
        };

        // Apply initial state
        if (isSelected || isHovered) {
             updateBars(true);
        }

        bContainer.on('pointerover', () => {
            (this as any).hoveredBuildingId = b.id;
            updateBars(true);
            window.dispatchEvent(new CustomEvent('game-hover', { 
                detail: { 
                    title: b.type.charAt(0).toUpperCase() + b.type.slice(1).replace('_', ' '),
                    owner: b.ownerId || island.ownerId, 
                    type: 'Building',
                    health: b.health,
                    maxHealth: b.maxHealth,
                    id: b.id
                } 
            }));
        });
        bContainer.on('pointerout', () => {
            if ((this as any).hoveredBuildingId === b.id) {
                (this as any).hoveredBuildingId = null;
            }
            if (!isSelected) updateBars(false);
            window.dispatchEvent(new CustomEvent('game-hover', { detail: null }));
        });


        bContainer.on('pointerdown', (pointer: any) => {
          if (this.placementMode) {
              if (pointer.event) pointer.event.stopPropagation();
              this.tryPlaceCurrentBuilding(pointer.x, pointer.y, !!pointer.event?.shiftKey);
              return;
          }
          // Allow selection of any building (for info display)
          // Stop propagation to avoid map click clearing selection
          if (pointer.event) pointer.event.stopPropagation();

          if (b.type === 'bridge_node' || b.type === 'wall_node') {
              const nodeOwner = b.ownerId || island.ownerId;
              if (nodeOwner !== socket.id) {
                  // Enemy node
              } else {
                  if (this.selectedNodeIds.has(b.id)) {
                      this.selectedNodeIds.delete(b.id);
                  } else {
                      this.selectedNodeIds.add(b.id);
                  }
                  
                  const nodes = Array.from(this.selectedNodeIds);
                  window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                      detail: { nodes } 
                  }));
                  
                  this.renderMap(this.currentMap!);
                  return;
              }
          }

          // Handle Building Selection
          const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
          
          if (!isMultiSelect) {
             this.selectedBuildingIds.clear();
             this.selectedUnitIds.clear();
             this.renderUnits(this.currentUnits);
             window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
          }

          if (this.selectedBuildingIds.has(b.id)) {
              if (isMultiSelect) this.selectedBuildingIds.delete(b.id);
          } else {
              this.selectedBuildingIds.add(b.id);
          }

          window.dispatchEvent(new CustomEvent('building-selection-changed', { 
              detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
          }));
          
          // Legacy support
          const event = new CustomEvent('game-selection', { detail: { islandId: island.id, buildingId: b.id, buildingType: b.type } });
          window.dispatchEvent(event);

          this.renderMap(this.currentMap!);
        });
      });

      // Interaction
      fillPoly.on('pointerdown', (pointer: any) => {
        if (this.placementMode) {
            if (pointer.event) pointer.event.stopPropagation();
            this.tryPlaceCurrentBuilding(pointer.x, pointer.y, !!pointer.event?.shiftKey);
            return;
        }
        // Select island
        const event = new CustomEvent('game-selection', { detail: { islandId: island.id } });
        window.dispatchEvent(event);
      });

      // Hover
      fillPoly.on('pointerover', () => {
         // ...
      });
    });
  }

  createExplosion(x: number, y: number, color: number) {
      const menuExplosionDensity = this.isMenuMode
          ? Math.max(0, Math.min(2, settingsManager.getSettings().graphics.menuExplosionDensity ?? 1))
          : 1;

      if (this.isMenuMode && menuExplosionDensity <= 0) {
          return;
      }

      // Play explosion sound
      const volume = soundEffectsManager.getEffectVolume(
          'explosion',
          0.5 * (this.isMenuMode ? menuExplosionDensity : 1)
      );
      if (volume > 0) {
          try {
              this.sound.play('explosion', { 
                  volume,
                  detune: Phaser.Math.Between(-200, 200)
              });
          } catch (e) {
              // Ignore if sound not loaded
          }
      }
      
      // Screen shake
      this.cameras.main.shake(100, 0.005 * (this.isMenuMode ? menuExplosionDensity : 1));

      const baseRadius = this.isMenuMode ? 14 + menuExplosionDensity * 16 : 30;
      const baseLife = this.isMenuMode ? 0.22 + menuExplosionDensity * 0.18 : 0.5;
      this.menuExplosions.push({x, y, life: baseLife, maxLife: baseLife, color, radius: baseRadius});

      const particleCount = this.isMenuMode ? Math.round(8 * menuExplosionDensity) : 8;
      const scatterRange = this.isMenuMode ? 12 + menuExplosionDensity * 18 : 30;
      for(let i=0; i<particleCount; i++) {
           const sparkLife = this.isMenuMode
               ? 0.12 + Math.random() * (0.14 + menuExplosionDensity * 0.12)
               : 0.2 + Math.random() * 0.3;
           const sparkRadius = this.isMenuMode
               ? Phaser.Math.FloatBetween(8, 14 + menuExplosionDensity * 8)
               : Phaser.Math.FloatBetween(12, 24);
           this.menuExplosions.push({
               x: x + Phaser.Math.Between(-scatterRange, scatterRange),
               y: y + Phaser.Math.Between(-scatterRange, scatterRange),
               life: sparkLife,
               maxLife: sparkLife,
               color,
               radius: sparkRadius
           });
      }
  }

  private renderNavalMineBlast(x: number, y: number, radius: number) {
      const volume = soundEffectsManager.getEffectVolume('explosion', 0.55);
      if (volume > 0) {
          try {
              this.sound.play('explosion', {
                  volume,
                  detune: Phaser.Math.Between(-100, 100)
              });
          } catch (e) {}
      }

      this.cameras.main.shake(140, 0.007);

      const flash = this.add.circle(x, y, 24, 0xffc76b, 0.95);
      flash.setDepth(101);
      this.tweens.add({
          targets: flash,
          scale: 4,
          alpha: 0,
          duration: 220,
          onComplete: () => flash.destroy()
      });

      const innerFire = this.add.circle(x, y, 42, 0xff6a2a, 0.7);
      innerFire.setDepth(101);
      innerFire.setScale(0.2);
      this.tweens.add({
          targets: innerFire,
          scale: 1.6,
          alpha: 0,
          duration: 320,
          onComplete: () => innerFire.destroy()
      });

      const shockwave = this.add.circle(x, y, radius, 0xffffff, 0);
      shockwave.setDepth(101);
      shockwave.setStrokeStyle(7, 0xbfefff, 0.95);
      shockwave.setScale(0.12);
      this.tweens.add({
          targets: shockwave,
          scale: 1,
          alpha: 0,
          duration: 360,
          onComplete: () => shockwave.destroy()
      });

      const outerWave = this.add.circle(x, y, radius * 0.78, 0x5dc6ff, 0);
      outerWave.setDepth(100);
      outerWave.setStrokeStyle(4, 0x82d8ff, 0.8);
      outerWave.setScale(0.25);
      this.tweens.add({
          targets: outerWave,
          scale: 1.2,
          alpha: 0,
          duration: 420,
          onComplete: () => outerWave.destroy()
      });

      for (let i = 0; i < 10; i += 1) {
          const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.18;
          const ember = this.add.circle(x, y, Phaser.Math.Between(3, 6), i % 2 === 0 ? 0xffb347 : 0xffe2a8, 0.95);
          ember.setDepth(101);
          this.tweens.add({
              targets: ember,
              x: x + Math.cos(angle) * Phaser.Math.Between(38, 92),
              y: y + Math.sin(angle) * Phaser.Math.Between(38, 92),
              alpha: 0,
              scale: 0.25,
              duration: Phaser.Math.Between(180, 260),
              onComplete: () => ember.destroy()
          });
      }
  }

  setMenuMode(enabled: boolean) {
      this.isMenuMode = enabled;
      if (enabled) {
          // Clear game entities
          if (this.islandsGroup) this.islandsGroup.clear(true, true);
          if (this.unitsGroup) this.unitsGroup.clear(true, true);
          if (this.rangeGraphics) this.rangeGraphics.clear();
          if (this.pathGraphics) this.pathGraphics.clear();
          if (this.selectionGraphics) this.selectionGraphics.clear();
          this.motionTrailSegments.forEach((segment) => segment.sprite.destroy());
          this.motionTrailSegments = [];
          this.unitTrailStates.clear();
          this.unitContainers.clear();
          this.unitUpdates.clear();
          this.currentUnits = []; // Clear local unit cache
          
          this.tumbleweeds = [];
        this.weatherParticles = [];
        this.oilAnimations = [];
        this.goldSparkles = [];
        this.oilSpotVisuals.clear();
        this.revealedOilSpots.clear();
        
        this.cameras.main.setBackgroundColor('#000000'); 
        // Reset camera
        this.cameras.main.setZoom(1);
          this.cameras.main.scrollX = 0;
          this.cameras.main.scrollY = 0;
      } else {
          this.menuProjectiles = [];
          this.menuExplosions = [];
          if (this.menuGraphics) this.menuGraphics.clear();
          this.cameras.main.setBackgroundColor('#006994');
          this.cameras.main.scrollX = 0;
          this.cameras.main.scrollY = 0;

          if (this.currentMap) {
              this.renderMap(this.currentMap);
              // Center camera on player base
              this.centerCameraOnBase();
              if (this.currentUnits && this.currentUnits.length > 0) {
                  this.renderUnits(this.currentUnits);
              }
          }
      }
  }

  updateMenuAnimation(_time: number, delta: number) {
       // Audio Shake Logic
       if (this.analyser && this.dataArray) {
           this.analyser.getByteFrequencyData(this.dataArray as any);
           
           // Calculate bass intensity (Low frequency bins)
          let sum = 0;
          const bassBins = 8; // Focus on deep bass
          for(let i=0; i<bassBins; i++) {
              sum += this.dataArray[i];
          }
          const avg = sum / bassBins;
          
          // Apply shake if loud enough
          // Scale threshold by volume so shake works at lower volumes too
          const currentVol = this.sound.volume;
          const threshold = 120 * currentVol;
          
          if (avg > threshold && currentVol > 0.1) {
              const shakeMultiplier = settingsManager.getSettings().graphics.screenShakeIntensity ?? 1.0;
              const intensity = Math.pow((avg - threshold) / (255 * currentVol - threshold), 2) * 15 * shakeMultiplier; 
              this.cameras.main.scrollX = (Math.random() - 0.5) * intensity;
              this.cameras.main.scrollY = (Math.random() - 0.5) * intensity;
          } else {
              this.cameras.main.scrollX = 0;
              this.cameras.main.scrollY = 0;
          }
      }

      if (!this.menuGraphics) return;
      this.menuGraphics.clear();
      
      const width = this.cameras.main.width / this.cameras.main.zoom;
      const height = this.cameras.main.height / this.cameras.main.zoom;
      const dt = delta / 1000;

      // Spawn
      this.menuSpawnTimer -= delta;
      const settings = settingsManager.getSettings();
      let percent = settings.graphics.menuProjectileMultiplierPercent ?? 100;
      if (percent < 0) percent = 0;
      if (percent > 10000) percent = 10000;
      const density = percent / 100;

      if (density <= 0) {
          this.menuSpawnTimer = 500;
      } else {
          let spawnedCount = 0;
          // Allow multiple spawns per frame for high density, but cap to avoid freeze
          while (this.menuSpawnTimer <= 0 && spawnedCount < 50) {
              spawnedCount++;
              // Add to timer instead of reset to maintain average rate
              this.menuSpawnTimer += Phaser.Math.Between(100, 300) / density;

              const side = Math.random() < 0.5 ? 'left' : 'right';
              const type = Math.random() < 0.7 ? 'bullet' : 'missile';
              const y = Phaser.Math.Between(50, height - 50);
              
              // Play shoot sound (Limit to first spawn of the frame to prevent audio death)
              const menuProjectileVolume = soundEffectsManager.getEffectVolume('menuProjectile', 0.3);
              if (menuProjectileVolume > 0 && spawnedCount === 1) {
                  try {
                      this.sound.play('shoot', {
                          volume: menuProjectileVolume, 
                          detune: Phaser.Math.Between(-100, 100)
                      });
                  } catch (e) {
                      // Ignore
                  }
              }

              const initialVy = type === 'missile' ? Phaser.Math.Between(-50, 50) : 0;
              const vx = side === 'left' ? (type === 'bullet' ? 800 : 400) : (type === 'bullet' ? -800 : -400);

              this.menuProjectiles.push({
                  x: side === 'left' ? -50 : width + 50,
                  y: y,
                  vx: vx,
                  vy: initialVy,
                  type: type,
                  color: side === 'left' ? 0x00ff00 : 0xff0000,
                  trail: [],
                  scale: type === 'missile' ? 2 : 1,
                  wobblePhase: Math.random() * Math.PI * 2,
                  turnRate: type === 'missile' ? Phaser.Math.FloatBetween(-0.5, 0.5) : 0,
                  speed: Math.hypot(vx, initialVy),
                  initialVy: initialVy
              });
          }
      }

      // Update Projectiles
      for (let i = this.menuProjectiles.length - 1; i >= 0; i--) {
          const p = this.menuProjectiles[i];
          
          // Movement Logic
          if (p.type === 'missile') {
               // Wobble (Sine wave on VY)
               p.wobblePhase += dt * 5;
               const wobble = Math.sin(p.wobblePhase) * 100;
               
               // Turn (Curve)
               // Adjust angle slowly
               const currentAngle = Math.atan2(p.vy, p.vx);
               const newAngle = currentAngle + p.turnRate * dt;
               
               p.vx = Math.cos(newAngle) * p.speed;
               p.vy = Math.sin(newAngle) * p.speed + wobble * 0.05; // Add wobble influence
          }

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // Trail Logic
          // Add new trail point
          p.trail.unshift({
              x: p.x, 
              y: p.y, 
              alpha: 1.0, 
              size: p.type === 'missile' ? 10 : 3
          });
          
          // Limit trail length
          if (p.trail.length > 20) p.trail.pop();

          // Bounds check
          if (p.x < -100 || p.x > width + 100 || p.y < -100 || p.y > height + 100) {
              this.menuProjectiles.splice(i, 1);
              continue;
          }

          // Draw Trail
          if (p.trail.length > 1) {
              if (p.type === 'bullet') {
                  // Bullet Tracer (Fading Line)
                  for (let t = 0; t < p.trail.length - 1; t++) {
                      const pt1 = p.trail[t];
                      const pt2 = p.trail[t+1];
                      const alpha = 1 - (t / p.trail.length);
                      
                      this.menuGraphics.lineStyle(pt1.size * alpha, p.color, alpha);
                      this.menuGraphics.beginPath();
                      this.menuGraphics.moveTo(pt1.x, pt1.y);
                      this.menuGraphics.lineTo(pt2.x, pt2.y);
                      this.menuGraphics.strokePath();
                  }
              } else {
                  // Missile Smoke (Expanding Circles)
                  for (let t = 0; t < p.trail.length; t++) {
                      const pt = p.trail[t];
                      // Age the particle
                      const age = t / p.trail.length; // 0 to 1
                      const alpha = (1 - age) * 0.5;
                      const size = pt.size * (1 + age * 2); // Expand over time

                      this.menuGraphics.fillStyle(0x888888, alpha);
                      this.menuGraphics.fillCircle(pt.x, pt.y, size);
                  }
              }
          }

          // Draw Body
          this.menuGraphics.fillStyle(p.color);
          if (p.type === 'bullet') {
               this.menuGraphics.fillCircle(p.x, p.y, 3 * p.scale);
          } else {
               const angle = Math.atan2(p.vy, p.vx);
               const s = p.scale;
               this.menuGraphics.save();
               this.menuGraphics.translateCanvas(p.x, p.y);
               this.menuGraphics.rotateCanvas(angle);

               // Thruster Flame (Flickering)
               this.menuGraphics.fillStyle(0xFFA500); // Orange
               const flameLen = 4 * s + Math.random() * 4 * s;
               this.menuGraphics.fillTriangle(
                   -10 * s, -2 * s, 
                   -10 * s, 2 * s, 
                   -10 * s - flameLen, 0
               );

               // Main Body
               this.menuGraphics.fillStyle(p.color);
               this.menuGraphics.fillRect(-10 * s, -3 * s, 16 * s, 6 * s);

               // Nose Cone (Pointy)
               this.menuGraphics.fillStyle(0xFFFFFF); // White tip
               this.menuGraphics.fillTriangle(
                   6 * s, -3 * s, 
                   6 * s, 3 * s, 
                   14 * s, 0
               );

               // Fins (Top and Bottom)
               this.menuGraphics.fillStyle(0x333333); // Dark Grey Fins
               // Top Fin
               this.menuGraphics.fillTriangle(
                   -10 * s, -3 * s, 
                   -2 * s, -3 * s, 
                   -10 * s, -9 * s
               );
               // Bottom Fin
               this.menuGraphics.fillTriangle(
                   -10 * s, 3 * s, 
                   -2 * s, 3 * s, 
                   -10 * s, 9 * s
               );

               // Detail Stripe
               this.menuGraphics.fillStyle(0x111111);
               this.menuGraphics.fillRect(-4 * s, -3 * s, 2 * s, 6 * s);

               this.menuGraphics.restore();
           }
      }

      // Collisions
      for (let i = 0; i < this.menuProjectiles.length; i++) {
           for (let j = i + 1; j < this.menuProjectiles.length; j++) {
               const p1 = this.menuProjectiles[i];
               const p2 = this.menuProjectiles[j];
               
               // Opposing sides only
               if ((p1.vx > 0 && p2.vx < 0) || (p1.vx < 0 && p2.vx > 0)) {
                   const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
                   if (dist < 20) {
                       // Explosion
                       this.createExplosion((p1.x + p2.x)/2, (p1.y + p2.y)/2, 0xFFFF00);
                       
                       this.menuProjectiles.splice(j, 1);
                       this.menuProjectiles.splice(i, 1);
                       i--;
                       break;
                   }
               }
           }
      }

      // Update Explosions
      for (let i = this.menuExplosions.length - 1; i >= 0; i--) {
          const e = this.menuExplosions[i];
          e.life -= dt;
          if (e.life <= 0) {
              this.menuExplosions.splice(i, 1);
              continue;
          }
          
          this.menuGraphics.fillStyle(e.color, e.life / e.maxLife);
          this.menuGraphics.fillCircle(e.x, e.y, (1 - e.life / e.maxLife) * e.radius);
      }
  }
}
