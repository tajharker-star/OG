import Phaser from 'phaser';
import type { Building } from '../../types/game';
import { createUnitArt } from './unitArt';

export const BUILDING_PREVIEW_TYPES: Building['type'][] = [
  'base',
  'barracks',
  'tank_factory',
  'air_base',
  'hospital',
  'repair_dock',
  'dock',
  'tower',
  'mine',
  'oil_rig',
  'oil_well',
  'farm',
  'wall',
  'bridge_node',
  'wall_node',
  'naval_mine'
];

export const BUILDING_PREVIEW_LABELS: Record<Building['type'], string> = {
  base: 'HQ Command',
  barracks: 'Barracks',
  tank_factory: 'Tank Factory',
  air_base: 'Air Base',
  hospital: 'Hospital',
  repair_dock: 'Repair Dock',
  dock: 'Dock',
  tower: 'Guard Tower',
  mine: 'Gold Mine',
  oil_rig: 'Oil Rig',
  oil_well: 'Oil Well',
  farm: 'Farm',
  wall: 'Wall',
  bridge_node: 'Bridge Node',
  wall_node: 'Wall Node',
  naval_mine: 'Naval Mine'
};

const BUILDING_ART_CACHE_VERSION = 1;

function shouldCacheBuildingArt(type: Building['type'] | string, data?: Building) {
  if (data?.isConstructing) return false;
  if ((data?.recruitmentQueue?.length || 0) > 0) return false;
  if (type === 'base' && data?.hasTesla) return false;
  return !['repair_dock', 'oil_rig', 'naval_mine', 'oil_well'].includes(type);
}

function getBuildingTextureKey(type: Building['type'] | string, color: number) {
  return `building-art:v${BUILDING_ART_CACHE_VERSION}:${type}:${color.toString(16)}`;
}

function mixColor(base: number, target: number, t: number) {
  const baseColor = Phaser.Display.Color.ValueToColor(base);
  const targetColor = Phaser.Display.Color.ValueToColor(target);
  const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(baseColor, targetColor, 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b);
}

function lighten(color: number, amount: number) {
  return mixColor(color, 0xffffff, amount);
}

function darken(color: number, amount: number) {
  return mixColor(color, 0x000000, amount);
}

function markAuraLine<T extends Phaser.GameObjects.GameObject>(object: T) {
  if ('setData' in object && typeof object.setData === 'function') {
    object.setData('skinAuraLine', true);
  }
  return object;
}

function createAuraStrip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha = 0.42,
  rotation = 0
) {
  const strip = scene.add.rectangle(x, y, width, height, color, alpha);
  if (rotation) strip.setRotation(rotation);
  return markAuraLine(strip);
}

function createAuraLine(
  scene: Phaser.Scene,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha = 0.46,
  width = 1
) {
  const line = scene.add.line(0, 0, x1, y1, x2, y2, color, alpha);
  line.setLineWidth(width, width);
  return markAuraLine(line);
}

function addBuildingDesignLines(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  type: Building['type'] | string,
  accent: number
) {
  const details: Phaser.GameObjects.GameObject[] = [];

  switch (type) {
    case 'mine':
      details.push(
        createAuraStrip(scene, 0, -4, 18, 0.9, accent, 0.3),
        createAuraStrip(scene, 0, -15, 14, 0.85, accent, 0.28),
      );
      break;
    case 'tower':
      details.push(
        createAuraStrip(scene, 0, -1, 1.2, 16, accent, 0.32),
        createAuraStrip(scene, 0, -13, 12, 0.9, accent, 0.26),
      );
      break;
    case 'barracks':
      details.push(
        createAuraStrip(scene, 0, -8.8, 18, 0.95, accent, 0.32),
        createAuraStrip(scene, 0, -1, 16, 0.8, accent, 0.24),
      );
      break;
    case 'hospital':
      details.push(
        createAuraStrip(scene, 0, -7, 16, 0.9, accent, 0.32),
        createAuraStrip(scene, -12, 1, 1, 8, accent, 0.24),
        createAuraStrip(scene, 12, 1, 1, 8, accent, 0.24),
      );
      break;
    case 'repair_dock':
      details.push(
        createAuraStrip(scene, 8, 7, 10, 0.8, accent, 0.3),
        createAuraLine(scene, -10, -8, 7, -8, accent, 0.28, 0.9),
      );
      break;
    case 'dock':
      details.push(
        createAuraStrip(scene, 0, 4, 14, 0.8, accent, 0.3),
        createAuraStrip(scene, -10, -10, 6, 0.85, accent, 0.24),
      );
      break;
    case 'base':
      details.push(
        createAuraStrip(scene, 0, -3, 14, 1, accent, 0.34),
        createAuraStrip(scene, -13, 4, 1, 8, accent, 0.24),
        createAuraStrip(scene, 13, 4, 1, 8, accent, 0.24),
      );
      break;
    case 'oil_rig':
      details.push(
        createAuraStrip(scene, 0, 2, 14, 0.8, accent, 0.32),
        createAuraLine(scene, -5, -10, 5, -10, accent, 0.26, 0.9),
      );
      break;
    case 'naval_mine':
      details.push(
        createAuraStrip(scene, 0, 0, 10, 0.9, accent, 0.3),
        createAuraStrip(scene, 0, 0, 0.9, 10, accent, 0.24),
      );
      break;
    case 'oil_well':
      details.push(
        createAuraStrip(scene, 0, -9, 14, 0.9, accent, 0.32),
        createAuraStrip(scene, 11, 7, 1, 7, accent, 0.24),
      );
      break;
    case 'farm':
      details.push(
        createAuraStrip(scene, -10, -13, 10, 0.8, accent, 0.26),
        createAuraStrip(scene, 10, -4, 1, 10, accent, 0.22),
      );
      break;
    case 'wall':
      details.push(createAuraStrip(scene, 0, 0, 18, 0.8, accent, 0.24));
      break;
    case 'bridge_node':
      details.push(
        createAuraStrip(scene, 0, 0, 7, 0.9, accent, 0.24, Math.PI / 4),
        createAuraStrip(scene, 0, 0, 7, 0.9, accent, 0.18, -Math.PI / 4),
      );
      break;
    case 'wall_node':
      details.push(
        createAuraStrip(scene, 0, 2, 7, 0.9, accent, 0.26),
        createAuraStrip(scene, 0, -7, 12, 0.85, accent, 0.22),
      );
      break;
    case 'tank_factory':
      details.push(
        createAuraStrip(scene, 6, 4, 18, 0.9, accent, 0.3),
        createAuraStrip(scene, 0, -7, 18, 0.9, accent, 0.24),
      );
      break;
    case 'air_base':
      details.push(
        createAuraStrip(scene, 5, 8, 18, 0.85, accent, 0.28),
        createAuraStrip(scene, -10, -12, 14, 0.85, accent, 0.24),
        createAuraStrip(scene, 3, -8, 10, 0.75, accent, 0.18),
      );
      break;
    default:
      break;
  }

  if (details.length) {
    container.add(details);
  }
}

function getRecruitmentProgress(data?: Building) {
  const item = data?.recruitmentQueue?.[0];
  if (!item) return 0;
  if (!item.totalTime) return 0;
  return Phaser.Math.Clamp(item.progress / item.totalTime, 0, 1);
}

function getRecruitmentPreviewUnit(type: Building['type'], data?: Building) {
  const queuedType = data?.recruitmentQueue?.[0]?.unitType;
  if (queuedType) return queuedType;

  switch (type) {
    case 'base':
      return 'builder';
    case 'barracks':
      return 'soldier';
    case 'tank_factory':
      return 'tank';
    case 'air_base':
      return 'light_plane';
    case 'dock':
      return 'destroyer';
    default:
      return null;
  }
}

function addConstructionEffect(scene: Phaser.Scene, container: Phaser.GameObjects.Container, accent: number, data?: Building) {
  if (!data?.isConstructing) return;

  const scaffold = scene.add.graphics();
  scaffold.lineStyle(1, lighten(accent, 0.4), 0.65);
  scaffold.strokeRect(-20, -20, 40, 40);
  scaffold.lineBetween(-18, -12, 18, -12);
  scaffold.lineBetween(-18, 0, 18, 0);
  scaffold.lineBetween(-18, 12, 18, 12);
  scaffold.lineBetween(-12, -18, -12, 18);
  scaffold.lineBetween(12, -18, 12, 18);
  container.add(scaffold);

  scene.tweens.add({
    targets: scaffold,
    alpha: 0.22,
    duration: 700,
    yoyo: true,
    repeat: -1
  });
}

function addRecruitmentEffect(scene: Phaser.Scene, container: Phaser.GameObjects.Container, type: Building['type'], accent: number, data?: Building) {
  if (!data?.recruitmentQueue || data.recruitmentQueue.length === 0) return;

  const progress = getRecruitmentProgress(data);
  const previewUnit = getRecruitmentPreviewUnit(type, data);
  const ghostColor = lighten(accent, 0.35);
  const pulseColor = lighten(accent, 0.6);

  if ((type === 'base' || type === 'barracks') && previewUnit) {
    const pad = scene.add.ellipse(0, 15, 28, 9, pulseColor, 0.18);
    const emitterCore = scene.add.rectangle(0, 10, 8, 4, pulseColor, 0.32);
    const emitterBeamLeft = scene.add.line(-5, 7, 0, 0, -4, -10, pulseColor, 0.28);
    const emitterBeamRight = scene.add.line(5, 7, 0, 0, 4, -10, pulseColor, 0.28);
    const scanner = scene.add.rectangle(0, 2, 20, 26, pulseColor, 0.14);
    const ghost = createUnitArt(scene, 0, 6, previewUnit, ghostColor, false);
    ghost.setScale(0.28 + progress * 0.05);
    ghost.alpha = 0.45;
    container.add([pad, emitterCore, emitterBeamLeft, emitterBeamRight, scanner, ghost]);

    scene.tweens.add({
      targets: scanner,
      y: 12,
      alpha: 0.04,
      duration: 850,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    scene.tweens.add({
      targets: ghost,
      y: 2,
      alpha: 0.72,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    return;
  }

  if (type === 'tank_factory' && previewUnit) {
    const conveyor = scene.add.rectangle(9, 12, 22, 3, pulseColor, 0.18);
    const gantryBeam = scene.add.rectangle(8, 2, 20, 2, pulseColor, 0.15);
    const bayGlow = scene.add.rectangle(9, 9, 18, 10, pulseColor, 0.18);
    const ghost = createUnitArt(scene, 7, 8, previewUnit, ghostColor, false);
    ghost.setScale(0.34 + progress * 0.04);
    ghost.alpha = 0.38;
    container.add([conveyor, gantryBeam, bayGlow, ghost]);

    scene.tweens.add({
      targets: bayGlow,
      alpha: 0.45,
      duration: 450,
      yoyo: true,
      repeat: -1
    });

    scene.tweens.add({
      targets: ghost,
      x: 12,
      alpha: 0.68,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    return;
  }

  if (type === 'air_base' && previewUnit) {
    const launchRail = scene.add.rectangle(2, 7, 28, 2, pulseColor, 0.18);
    const runwaySweep = scene.add.rectangle(4, 7, 30, 5, pulseColor, 0.1);
    const fuelGlow = scene.add.ellipse(-12, -10, 12, 12, pulseColor, 0.16);
    const ghost = createUnitArt(scene, -4, -7, previewUnit, ghostColor, false);
    ghost.setScale(0.28 + progress * 0.05);
    ghost.alpha = 0.34;
    container.add([launchRail, runwaySweep, fuelGlow, ghost]);

    scene.tweens.add({
      targets: runwaySweep,
      x: 14,
      alpha: 0.32,
      duration: 650,
      yoyo: true,
      repeat: -1
    });

    scene.tweens.add({
      targets: fuelGlow,
      alpha: 0.42,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 800,
      yoyo: true,
      repeat: -1
    });

    scene.tweens.add({
      targets: ghost,
      y: -16,
      alpha: 0.78,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    return;
  }

  if (type === 'dock' && previewUnit) {
    const wake = scene.add.ellipse(0, 14, 26, 8, pulseColor, 0.16);
    const slipway = scene.add.rectangle(0, 10, 20, 3, pulseColor, 0.14);
    const sonar = scene.add.ellipse(0, 14, 14, 5, pulseColor, 0.22);
    const ghost = createUnitArt(scene, 0, 4, previewUnit, ghostColor, false);
    ghost.setScale(0.22 + progress * 0.03);
    ghost.alpha = 0.36;
    container.add([wake, slipway, sonar, ghost]);

    scene.tweens.add({
      targets: sonar,
      scaleX: 1.7,
      scaleY: 1.5,
      alpha: 0,
      duration: 1200,
      repeat: -1
    });

    scene.tweens.add({
      targets: ghost,
      y: 1,
      alpha: 0.62,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }
}

function createVectorBuildingArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: Building['type'] | string,
  color: number,
  data?: Building
) {
  const container = scene.add.container(x, y);
  container.setData('buildingArtType', type);
  const accent = lighten(color, 0.18);
  const hull = darken(accent, 0.62);
  const panel = darken(accent, 0.38);
  const trim = lighten(accent, 0.26);
  const metal = 0x69768a;
  const windowColor = 0x9ddcff;
  const shadowWidth = type === 'wall' ? 32 : type === 'bridge_node' || type === 'wall_node' ? 24 : 42;
  const shadowHeight = type === 'wall' ? 10 : type === 'bridge_node' || type === 'wall_node' ? 12 : 14;
  const shadow = scene.add.ellipse(0, 17, shadowWidth, shadowHeight, 0x000000, 0.16);
  shadow.setData('skinEffectIgnore', true);
  container.add(shadow);

  if (type === 'mine') {
    const rim = scene.add.ellipse(0, 2, 30, 24, 0x47311d);
    const pit = scene.add.ellipse(0, 3, 28, 22, 0x20140d, 1);
    const platform = scene.add.rectangle(0, -8, 28, 6, 0x7f6248);
    const deck = scene.add.rectangle(0, -4, 26, 10, 0x6a5038);
    const railLeft = scene.add.rectangle(-8, 8, 3, 18, 0x4d3929);
    const railRight = scene.add.rectangle(8, 8, 3, 18, 0x4d3929);
    const braceLeft = scene.add.line(-6, -5, 0, 0, -6, 11, 0x59412d);
    const braceRight = scene.add.line(6, -5, 0, 0, 6, 11, 0x59412d);
    const crossbar = scene.add.rectangle(0, -15, 24, 3, metal);
    const hoist = scene.add.rectangle(0, -12, 6, 16, metal);
    const cable = scene.add.line(0, -4, 0, 0, 0, 10, 0x1a1a1a);
    const ore = scene.add.circle(0, 7, 5, 0xe2b44a);
    const beaconMast = scene.add.rectangle(10, -11, 2, 9, metal);
    const beaconHousing = scene.add.rectangle(10, -15, 6, 4, darken(accent, 0.28));
    const beacon = scene.add.circle(10, -15, 2, accent);
    container.add([
      rim, pit, platform, deck, railLeft, railRight, braceLeft, braceRight,
      crossbar, hoist, cable, ore, beaconMast, beaconHousing, beacon
    ]);
  } else if (type === 'tower') {
    const plinth = scene.add.rectangle(0, 12, 24, 6, darken(hull, 0.08));
    const footing = scene.add.rectangle(0, 8, 20, 10, hull);
    const column = scene.add.rectangle(0, -1, 14, 22, panel);
    const parapet = scene.add.rectangle(0, -13, 20, 6, trim);
    const slit1 = scene.add.rectangle(-4, -2, 2, 9, windowColor);
    const slit2 = scene.add.rectangle(4, -2, 2, 9, windowColor);
    const turretBase = scene.add.rectangle(0, -10, 11, 5, 0x293342);
    const turret = scene.add.circle(0, -9, 5, 0x111927);
    const barrel = scene.add.rectangle(8, -9, 12, 3, 0x1c2737);
    container.add([plinth, footing, column, parapet, slit1, slit2, turretBase, turret, barrel]);
  } else if (type === 'barracks') {
    const slab = scene.add.rectangle(0, 13, 38, 6, darken(hull, 0.08));
    const base = scene.add.rectangle(0, 5, 34, 20, hull);
    const roof = scene.add.polygon(0, -7, [-20, 4, 0, -12, 20, 4], panel);
    const awning = scene.add.rectangle(0, -1, 24, 6, trim);
    const awningPostLeft = scene.add.rectangle(-8, 4, 2, 8, metal);
    const awningPostRight = scene.add.rectangle(8, 4, 2, 8, metal);
    const door = scene.add.rectangle(0, 8, 9, 10, 0x101720);
    const window1 = scene.add.rectangle(-10, 4, 6, 6, windowColor);
    const window2 = scene.add.rectangle(10, 4, 6, 6, windowColor);
    const bannerPole = scene.add.rectangle(15, -12, 2, 14, metal);
    const bannerBracket = scene.add.rectangle(17, -12, 4, 2, metal);
    const banner = scene.add.polygon(19, -12, [0, 0, 10, 2, 0, 8], accent);
    container.add([slab, base, roof, awning, awningPostLeft, awningPostRight, door, window1, window2, bannerPole, bannerBracket, banner]);
  } else if (type === 'hospital') {
    const slab = scene.add.rectangle(0, 13, 40, 6, darken(hull, 0.08));
    const base = scene.add.rectangle(0, 5, 36, 20, hull);
    const roof = scene.add.rectangle(0, -7, 30, 10, panel);
    const roofCap = scene.add.rectangle(0, -12, 20, 3, trim);
    const wingLeft = scene.add.rectangle(-12, 1, 8, 14, darken(panel, 0.12));
    const wingRight = scene.add.rectangle(12, 1, 8, 14, darken(panel, 0.12));
    const door = scene.add.rectangle(0, 9, 8, 10, 0x111927);
    const crossVertical = scene.add.rectangle(0, -4, 4, 14, accent);
    const crossHorizontal = scene.add.rectangle(0, -4, 14, 4, accent);
    const windowLeft = scene.add.rectangle(-8, 3, 5, 5, windowColor);
    const windowRight = scene.add.rectangle(8, 3, 5, 5, windowColor);
    const beaconMast = scene.add.rectangle(14, -11, 2, 7, metal);
    const beaconBase = scene.add.rectangle(14, -14, 6, 3, darken(panel, 0.18));
    const beacon = scene.add.circle(14, -17, 2.4, accent);
    container.add([
      slab, base, roof, roofCap, wingLeft, wingRight, door, crossVertical, crossHorizontal,
      windowLeft, windowRight, beaconMast, beaconBase, beacon
    ]);
  } else if (type === 'repair_dock') {
    const foundation = scene.add.rectangle(0, 13, 40, 6, darken(hull, 0.08));
    const floor = scene.add.rectangle(0, 6, 36, 18, hull);
    const gantryBase = scene.add.rectangle(-10, -3, 8, 16, panel);
    const gantryArm = scene.add.line(-10, -10, 0, 0, 18, -8, trim);
    const gantryHook = scene.add.line(8, -8, 0, 0, 0, 12, trim);
    const servicePad = scene.add.rectangle(8, 7, 14, 8, darken(panel, 0.1));
    const toolRack = scene.add.rectangle(0, -8, 14, 6, metal);
    const workLampStem = scene.add.rectangle(5, -4, 2, 7, metal);
    const workLampHead = scene.add.rectangle(8, -8, 8, 3, accent);
    const weldGlow = scene.add.ellipse(10, 7, 9, 5, accent, 0.24);
    const weldCore = scene.add.circle(10, 7, 1.8, lighten(accent, 0.3));
    const beacon = scene.add.circle(-14, -10, 3, accent);
    const beaconMast = scene.add.rectangle(-14, -8, 2, 8, metal);
    container.add([
      foundation, floor, gantryBase, gantryArm, gantryHook, servicePad, toolRack,
      workLampStem, workLampHead, weldGlow, weldCore, beaconMast, beacon
    ]);
    scene.tweens.add({
      targets: [weldGlow, weldCore],
      alpha: 0.18,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 520,
      yoyo: true,
      repeat: -1
    });
  } else if (type === 'dock') {
    const foundation = scene.add.rectangle(0, 13, 38, 6, 0x5b4836);
    const pier = scene.add.rectangle(0, 2, 34, 20, 0x6f563f);
    const slip = scene.add.rectangle(0, 4, 20, 10, 0x21384c);
    const pilingLeft = scene.add.rectangle(-10, 11, 4, 10, 0x4b392c);
    const pilingRight = scene.add.rectangle(10, 11, 4, 10, 0x4b392c);
    const bollard1 = scene.add.circle(-12, -6, 3, 0x31251a);
    const bollard2 = scene.add.circle(12, -6, 3, 0x31251a);
    const craneBase = scene.add.rectangle(-10, -2, 6, 12, metal);
    const craneCab = scene.add.rectangle(-10, -10, 8, 5, panel);
    const craneArm = scene.add.line(-10, -8, 0, 0, 12, -10, accent);
    const craneBrace = scene.add.line(-10, -3, 0, 0, 10, -10, metal);
    const craneCable = scene.add.line(2, -14, 0, 0, 0, 10, 0x0f1720);
    const navMast = scene.add.rectangle(11, -9, 2, 6, metal);
    const navLight = scene.add.circle(11, -13, 2.4, accent);
    container.add([
      foundation, pier, slip, pilingLeft, pilingRight, bollard1, bollard2,
      craneBase, craneCab, craneArm, craneBrace, craneCable, navMast, navLight
    ]);
  } else if (type === 'base') {
    const podium = scene.add.rectangle(0, 14, 42, 6, darken(hull, 0.08));
    const lower = scene.add.rectangle(0, 7, 38, 20, hull);
    const upper = scene.add.rectangle(0, -3, 26, 18, panel);
    const crown = scene.add.rectangle(0, -14, 18, 6, trim);
    const bunkerLeft = scene.add.rectangle(-13, 4, 8, 12, darken(panel, 0.15));
    const bunkerRight = scene.add.rectangle(13, 4, 8, 12, darken(panel, 0.15));
    const buttressLeft = scene.add.polygon(-10, 3, [-4, 6, -2, -4, 2, -4, 4, 6], darken(hull, 0.12));
    const buttressRight = scene.add.polygon(10, 3, [-4, 6, -2, -4, 2, -4, 4, 6], darken(hull, 0.12));
    const core = scene.add.rectangle(0, 0, 10, 10, accent);
    const commandFrame = scene.add.rectangle(0, -2, 18, 14, darken(accent, 0.22));
    const radarStem = scene.add.rectangle(11, -18, 2, 8, metal);
    const radarPivot = scene.add.rectangle(11, -20, 6, 3, metal);
    const radarDish = scene.add.ellipse(11, -22, 12, 7, lighten(accent, 0.55), 1);
    const antennaBase = scene.add.rectangle(-12, -14, 6, 4, darken(panel, 0.18));
    const antenna = scene.add.rectangle(-12, -18, 2, 10, metal);
    const beacon = scene.add.circle(-12, -24, 3, accent);
    const window1 = scene.add.rectangle(-6, -4, 4, 5, windowColor);
    const window2 = scene.add.rectangle(6, -4, 4, 5, windowColor);
    container.add([podium, lower, upper, crown, bunkerLeft, bunkerRight, buttressLeft, buttressRight, commandFrame, core, radarStem, radarPivot, radarDish, antennaBase, antenna, beacon, window1, window2]);

    if (data?.hasTesla) {
      const coilBase = scene.add.rectangle(0, -18, 10, 4, 0x2d3546);
      const ring1 = scene.add.ellipse(0, -22, 14, 5, 0x6cf9ff, 0.45);
      const ring2 = scene.add.ellipse(0, -27, 10, 4, 0x6cf9ff, 0.35);
      const arcBall = scene.add.circle(0, -31, 3, 0xffffff);
      container.add([coilBase, ring1, ring2, arcBall]);
      scene.tweens.add({
        targets: [ring1, ring2, arcBall],
        alpha: 0.2,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 500,
        yoyo: true,
        repeat: -1
      });
    }
  } else if (type === 'oil_rig') {
    const legs = [
      scene.add.rectangle(-10, 13, 4, 10, 0x233142),
      scene.add.rectangle(0, 13, 4, 10, 0x233142),
      scene.add.rectangle(10, 13, 4, 10, 0x233142)
    ];
    const platform = scene.add.rectangle(0, 6, 30, 18, hull);
    const deck = scene.add.rectangle(0, 2, 24, 10, 0x2a3443);
    const derrickCap = scene.add.rectangle(0, -12, 16, 3, trim);
    const derrickLeft = scene.add.line(-5, -10, 0, 18, 8, 0, trim);
    const derrickRight = scene.add.line(5, -10, 0, 18, -8, 0, trim);
    const cross1 = scene.add.line(0, -10, -6, 0, 6, 0, trim);
    const cross2 = scene.add.line(0, -2, -7, 0, 7, 0, trim);
    const flareStack = scene.add.rectangle(9, -6, 4, 12, 0x3b4655);
    const flame = scene.add.circle(9, -14, 3, 0xff9f45);
    const pipe = scene.add.rectangle(0, 12, 5, 9, 0x111927);
    container.add([...legs, platform, deck, derrickCap, derrickLeft, derrickRight, cross1, cross2, flareStack, flame, pipe]);
    scene.tweens.add({
      targets: flame,
      scaleX: 1.35,
      scaleY: 1.35,
      alpha: 0.45,
      duration: 450,
      yoyo: true,
      repeat: -1
    });
  } else if (type === 'naval_mine') {
    const wake = scene.add.ellipse(0, 11, 30, 12, 0x163247, 0.34);
    const shadow = scene.add.ellipse(0, 6, 20, 8, 0x08131d, 0.42);
    const shellOuter = scene.add.circle(0, 0, 11, darken(hull, 0.08));
    const shellInner = scene.add.circle(0, 0, 8, hull);
    const core = scene.add.circle(0, 0, 4.5, accent);
    const spokes: Phaser.GameObjects.GameObject[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const spikeLength = index % 2 === 0 ? 8.5 : 6.5;
      const spikeWidth = index % 2 === 0 ? 3.8 : 3;
      const spike = scene.add.triangle(
        Math.cos(angle) * 11.8,
        Math.sin(angle) * 11.8,
        -spikeLength, 0,
        spikeLength * 0.15, -spikeWidth,
        spikeLength * 0.15, spikeWidth,
        trim,
        0.96
      );
      spike.setRotation(angle);
      spokes.push(spike);
    }
    const highlight = scene.add.ellipse(-3, -3, 7, 5, lighten(accent, 0.4), 0.82);
    const pulse = scene.add.circle(0, 0, 5.5, lighten(accent, 0.35), 0.54);
    container.add([wake, shadow, ...spokes, shellOuter, shellInner, core, highlight, pulse]);
    scene.tweens.add({
      targets: pulse,
      alpha: 0.12,
      scaleX: 1.65,
      scaleY: 1.65,
      duration: 760,
      yoyo: true,
      repeat: -1
    });
  } else if (type === 'oil_well') {
    const foundation = scene.add.rectangle(0, 13, 34, 6, darken(hull, 0.08));
    const base = scene.add.rectangle(0, 7, 30, 18, hull);
    const towerLeft = scene.add.line(-5, -6, 0, 16, 8, -10, trim);
    const towerRight = scene.add.line(5, -6, 0, 16, -8, -10, trim);
    const pivot = scene.add.circle(0, -9, 3, metal);
    const beam = scene.add.rectangle(0, -9, 20, 4, accent);
    const head = scene.add.circle(10, -9, 4, accent);
    const linkArm = scene.add.line(4, -9, 0, 0, 6, 9, metal);
    const counter = scene.add.rectangle(-9, -4, 6, 9, metal);
    const pipeRun = scene.add.rectangle(5, 11, 12, 3, 0x1c2737);
    const tank = scene.add.ellipse(11, 7, 11, 13, 0x476079);
    container.add([foundation, base, towerLeft, towerRight, pivot, beam, head, linkArm, counter, pipeRun, tank]);
    scene.tweens.add({
      targets: [beam, head],
      angle: { from: -11, to: 11 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  } else if (type === 'farm') {
    const foundation = scene.add.rectangle(0, 13, 36, 6, 0x4a5c31);
    const field = scene.add.rectangle(0, 6, 34, 20, 0x59713a);
    const row1 = scene.add.rectangle(-8, 8, 4, 18, 0x40572b);
    const row2 = scene.add.rectangle(0, 8, 4, 18, 0x40572b);
    const row3 = scene.add.rectangle(8, 8, 4, 18, 0x40572b);
    const barn = scene.add.rectangle(-10, -6, 13, 12, 0x8f4236);
    const roof = scene.add.polygon(-10, -13, [-10, 3, 0, -8, 10, 3], 0x6e261d);
    const silo = scene.add.rectangle(10, -4, 8, 16, 0xc1c7d0);
    const cap = scene.add.ellipse(10, -12, 8, 5, 0x929aa7);
    const fence = scene.add.rectangle(2, -1, 28, 2, 0xd7c8a1);
    const pipe = scene.add.rectangle(4, -4, 8, 2, 0x8e99a5);
    container.add([foundation, field, row1, row2, row3, barn, roof, silo, cap, fence, pipe]);
  } else if (type === 'wall') {
    const footing = scene.add.rectangle(0, 5, 28, 4, darken(hull, 0.08));
    const slab = scene.add.rectangle(0, 0, 26, 9, hull);
    const seam1 = scene.add.rectangle(-8, 0, 6, 2, trim);
    const seam2 = scene.add.rectangle(0, -1, 6, 2, trim);
    const seam3 = scene.add.rectangle(8, 0, 6, 2, trim);
    container.add([footing, slab, seam1, seam2, seam3]);
  } else if (type === 'bridge_node') {
    const foundation = scene.add.circle(0, 4, 11, darken(hull, 0.08));
    const outer = scene.add.circle(0, 0, 10, hull);
    const inner = scene.add.circle(0, 0, 5, accent);
    const brace = scene.add.line(0, 0, -4, -4, 4, 4, trim);
    container.add([foundation, outer, inner, brace]);
  } else if (type === 'wall_node') {
    const footing = scene.add.rectangle(0, 9, 20, 4, darken(hull, 0.08));
    const block = scene.add.rectangle(0, 0, 18, 18, hull);
    const cap = scene.add.rectangle(0, -7, 20, 4, trim);
    const core = scene.add.rectangle(0, 2, 8, 8, accent);
    container.add([footing, block, cap, core]);
  } else if (type === 'tank_factory') {
    const slab = scene.add.rectangle(0, 14, 44, 6, darken(hull, 0.08));
    const floor = scene.add.rectangle(0, 7, 40, 20, hull);
    const bay = scene.add.rectangle(6, 4, 28, 16, panel);
    const bayFrame = scene.add.rectangle(6, 4, 30, 18, darken(panel, 0.12));
    const roof = scene.add.rectangle(0, -7, 34, 16, 0x4f5e37);
    const vent1 = scene.add.rectangle(-9, -10, 6, 4, windowColor);
    const vent2 = scene.add.rectangle(0, -10, 6, 4, windowColor);
    const vent3 = scene.add.rectangle(9, -10, 6, 4, windowColor);
    const smokestack1 = scene.add.rectangle(-14, -16, 5, 12, 0x202734);
    const smokestack2 = scene.add.rectangle(-7, -16, 5, 12, 0x202734);
    const door = scene.add.rectangle(12, 9, 12, 10, 0x151b24);
    const gantry = scene.add.rectangle(-15, 8, 4, 12, accent);
    const gantryArm = scene.add.rectangle(-10, 3, 12, 2, accent);
    const gantryBrace = scene.add.rectangle(-12, 6, 2, 8, accent);
    container.add([slab, floor, bayFrame, bay, roof, vent1, vent2, vent3, smokestack1, smokestack2, door, gantry, gantryArm, gantryBrace]);
  } else if (type === 'air_base') {
    const slab = scene.add.rectangle(0, 14, 44, 6, darken(hull, 0.08));
    const tarmac = scene.add.rectangle(0, 7, 42, 20, hull);
    const runway = scene.add.rectangle(5, 8, 28, 7, 0x1b2431);
    const runwayLine = scene.add.rectangle(5, 8, 18, 1, 0xffffff);
    const hangar = scene.add.rectangle(-10, -5, 18, 14, panel);
    const hangarFrame = scene.add.rectangle(-10, -5, 20, 16, darken(panel, 0.14));
    const hangarRoof = scene.add.polygon(-10, -12, [-12, 4, 0, -8, 12, 4], trim);
    const tower = scene.add.rectangle(14, -6, 9, 16, metal);
    const towerGlass = scene.add.rectangle(14, -13, 10, 6, windowColor);
    const beaconMast = scene.add.rectangle(14, -18, 2, 7, metal);
    const beacon = scene.add.circle(14, -22, 2.4, accent);
    const serviceBridge = scene.add.rectangle(3, -8, 16, 3, panel);
    container.add([slab, tarmac, runway, runwayLine, hangarFrame, hangar, hangarRoof, tower, towerGlass, serviceBridge, beaconMast, beacon]);
  } else {
    const fallback = scene.add.rectangle(0, 0, 24, 24, hull);
    const core = scene.add.rectangle(0, 0, 10, 10, accent);
    container.add([fallback, core]);
  }

  addBuildingDesignLines(scene, container, type as Building['type'], accent);
  addConstructionEffect(scene, container, accent, data);
  addRecruitmentEffect(scene, container, type as Building['type'], accent, data);

  return container;
}

function createCachedBuildingArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: Building['type'] | string,
  color: number
) {
  const key = getBuildingTextureKey(type, color);
  if (!scene.textures.exists(key)) {
    const tempContainer = createVectorBuildingArt(scene, 0, 0, type, color);
    const bounds = tempContainer.getBounds();
    const padding = 10;
    const width = Math.max(40, Math.ceil(bounds.width + padding * 2));
    const height = Math.max(40, Math.ceil(bounds.height + padding * 2));
    const renderTexture = scene.make.renderTexture({ width, height }, false);
    const drawX = width * 0.5 - bounds.centerX;
    const drawY = height * 0.5 - bounds.centerY;

    renderTexture.draw(tempContainer, drawX, drawY);
    renderTexture.saveTexture(key);
    renderTexture.destroy();
    tempContainer.destroy();
  }

  const container = scene.add.container(x, y);
  container.setData('buildingArtType', type);
  const sprite = scene.add.image(0, 0, key);
  sprite.setOrigin(0.5, 0.5);
  container.add(sprite);
  return container;
}

export function createBuildingArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: Building['type'] | string,
  color: number,
  data?: Building
) {
  if (shouldCacheBuildingArt(type, data)) {
    return createCachedBuildingArt(scene, x, y, type, color);
  }

  return createVectorBuildingArt(scene, x, y, type, color, data);
}
