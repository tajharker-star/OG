import Phaser from 'phaser';
import { SKIN_DEFINITIONS_BY_ID, type SkinId } from '../../utils/playerSkins';

export type RenderableUnitType =
  | 'soldier'
  | 'destroyer'
  | 'pirate_ship'
  | 'construction_ship'
  | 'sniper'
  | 'rocketeer'
  | 'builder'
  | 'ferry'
  | 'tank'
  | 'humvee'
  | 'missile_launcher'
  | 'oil_seeker'
  | 'light_plane'
  | 'heavy_plane'
  | 'alien_scout'
  | 'heavy_alien'
  | 'aircraft_carrier'
  | 'mothership';

export type UnitArtRenderMode = 'full' | 'lod';

export interface CreateUnitArtOptions {
  renderMode?: UnitArtRenderMode;
  skinId?: SkinId;
}

export function resolveUnitFacingTransform(angle: number | undefined) {
  if (typeof angle !== 'number' || Number.isNaN(angle)) {
    return null;
  }

  let rotation = Phaser.Math.Angle.Wrap(angle);
  let mirrored = false;

  if (rotation > Math.PI / 2) {
    rotation -= Math.PI;
    mirrored = true;
  } else if (rotation < -Math.PI / 2) {
    rotation += Math.PI;
    mirrored = true;
  }

  return { rotation, mirrored };
}

export function getUnitArtScale(type: RenderableUnitType | string): number {
  const humanoidScale = 1;
  const standardNonHumanoidScale = 1.3;
  const landVehicleScale = 2;

  switch (type) {
    case 'soldier':
    case 'sniper':
    case 'rocketeer':
    case 'builder':
      return humanoidScale;
    case 'tank':
    case 'humvee':
    case 'oil_seeker':
    case 'missile_launcher':
      return landVehicleScale;
    case 'destroyer':
    case 'pirate_ship':
    case 'construction_ship':
    case 'ferry':
    case 'light_plane':
    case 'heavy_plane':
      return standardNonHumanoidScale;
    case 'alien_scout':
      return 1.24;
    case 'heavy_alien':
      return 1.52;
    case 'aircraft_carrier':
      return 1.06;
    case 'mothership':
      return 1;
    default:
      return 1.18;
  }
}

export const REDESIGNED_UNIT_TYPES: RenderableUnitType[] = [
  'soldier',
  'tank',
  'humvee',
  'oil_seeker',
  'missile_launcher',
  'destroyer',
  'pirate_ship',
  'construction_ship',
  'sniper',
  'rocketeer',
  'ferry',
  'builder',
  'light_plane',
  'heavy_plane',
  'alien_scout',
  'heavy_alien',
  'aircraft_carrier',
  'mothership'
];

export const UNIT_PREVIEW_LABELS: Record<RenderableUnitType, string> = {
  soldier: 'Soldier',
  destroyer: 'Destroyer',
  pirate_ship: 'Pirate Ship',
  construction_ship: 'Construction Ship',
  sniper: 'Sniper',
  rocketeer: 'Rocketeer',
  builder: 'Builder',
  ferry: 'Ferry',
  tank: 'Tank',
  humvee: 'Humvee',
  missile_launcher: 'Missile Launcher',
  oil_seeker: 'Oil Seeker',
  light_plane: 'Light Plane',
  heavy_plane: 'Heavy Plane',
  alien_scout: 'Alien Scout Ship',
  heavy_alien: 'Heavy Alien Ship',
  aircraft_carrier: 'Aircraft Carrier',
  mothership: 'Mothership'
};

const DEFAULT_WEAPON_MUZZLE_OFFSET = { x: 18, y: 0 };

export function getUnitWeaponMuzzleOffset(type: RenderableUnitType | string) {
  switch (type) {
    case 'soldier':
      return { x: 19.5, y: 1.5 };
    case 'tank':
      return { x: 22.4, y: 0 };
    case 'humvee':
      return { x: 5.4, y: 0 };
    case 'oil_seeker':
      return { x: 4.2, y: -5 };
    case 'missile_launcher':
      return { x: 10.5, y: -3.1 };
    case 'destroyer':
      return { x: 17.8, y: 0 };
    case 'pirate_ship':
      return { x: 20.2, y: 0 };
    case 'construction_ship':
      return { x: 10.2, y: 1.2 };
    case 'sniper':
      return { x: 23, y: 1.2 };
    case 'rocketeer':
      return { x: 17, y: -4.2 };
    case 'ferry':
      return { x: 15.6, y: 0 };
    case 'builder':
      return { x: 11.8, y: -6.1 };
    case 'light_plane':
      return { x: 19.2, y: 0 };
    case 'heavy_plane':
      return { x: 20.6, y: 0 };
    case 'alien_scout':
      return { x: 20.8, y: 0 };
    case 'heavy_alien':
      return { x: 29.8, y: 0 };
    case 'aircraft_carrier':
      return { x: 58, y: 0 };
    case 'mothership':
      return { x: 0, y: 0 };
    default:
      return DEFAULT_WEAPON_MUZZLE_OFFSET;
  }
}

const UNIT_ART_CACHE_VERSION = 64;

const CACHED_HUMANOID_TEXTURE_TYPES = new Set<RenderableUnitType>([
  'soldier',
  'sniper',
  'rocketeer',
  'builder'
]);

const OUTLINE = 0x09131b;
const SHADOW = 0x000000;
const HIGHLIGHT = 0xfff4ad;

function clampColor(value: number) {
  return Phaser.Math.Clamp(Math.round(value), 0, 255);
}

function tint(color: number, amount: number) {
  const rgb = Phaser.Display.Color.IntegerToRGB(color);
  return Phaser.Display.Color.GetColor(
    clampColor(rgb.r + amount),
    clampColor(rgb.g + amount),
    clampColor(rgb.b + amount)
  );
}

function shade(color: number, amount: number) {
  return tint(color, -amount);
}

function outline<T extends Phaser.GameObjects.Shape | Phaser.GameObjects.Line>(
  object: T,
  isSelected: boolean,
  width = 1
) {
  object.setStrokeStyle(isSelected ? width + 1 : width, isSelected ? HIGHLIGHT : OUTLINE);
  return object;
}

function addShadow(
  _scene: Phaser.Scene,
  _container: Phaser.GameObjects.Container,
  _x: number,
  _y: number,
  _width: number,
  _height: number,
  _alpha = 0.18
) {
  return null;
}

function markAuraLine<T extends Phaser.GameObjects.GameObject>(object: T) {
  if ('setData' in object && typeof object.setData === 'function') {
    object.setData('skinAuraLine', true);
  }
  return object;
}

function preserveSkinColor<T extends Phaser.GameObjects.GameObject>(object: T) {
  if ('setData' in object && typeof object.setData === 'function') {
    object.setData('skinPreserveColor', true);
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
  alpha = 0.45,
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
  alpha = 0.5,
  width = 1.1
) {
  const line = scene.add.line(0, 0, x1, y1, x2, y2, color, alpha);
  line.setLineWidth(width, width);
  return markAuraLine(line);
}

function addUnitDesignLines(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  type: RenderableUnitType | string,
  lineColor: number
) {
  const details: Phaser.GameObjects.GameObject[] = [];

  switch (type) {
    case 'soldier':
      details.push(
        createAuraStrip(scene, 0.8, 0, 6, 1, lineColor, 0.34),
        createAuraStrip(scene, -7, 0.6, 1, 7, lineColor, 0.28),
      );
      break;
    case 'sniper':
      details.push(
        createAuraStrip(scene, 0.2, -0.6, 7, 1, lineColor, 0.32),
        createAuraStrip(scene, 9.8, -1.3, 6, 0.7, lineColor, 0.34),
      );
      break;
    case 'rocketeer':
      details.push(
        createAuraStrip(scene, 0.5, 0.1, 6.6, 1, lineColor, 0.34),
        createAuraStrip(scene, 9.5, -4.2, 10, 0.7, lineColor, 0.34),
      );
      break;
    case 'builder':
      details.push(
        createAuraStrip(scene, 0, 2, 7, 1, lineColor, 0.34),
        createAuraStrip(scene, -12.2, 4, 5, 0.9, lineColor, 0.34),
      );
      break;
    case 'tank':
      details.push(
        createAuraStrip(scene, 0.2, 0, 8, 0.9, lineColor, 0.36),
        createAuraStrip(scene, -2.8, 0, 2.2, 4.2, lineColor, 0.28),
        createAuraStrip(scene, 15.8, 0, 7, 0.55, lineColor, 0.3),
      );
      break;
    case 'humvee':
      details.push(
        createAuraStrip(scene, 0.1, 0, 5.4, 0.85, lineColor, 0.38),
        createAuraStrip(scene, 3.2, 0, 2.4, 0.6, lineColor, 0.32),
        createAuraStrip(scene, -2.6, 0, 1.1, 4.2, lineColor, 0.28),
      );
      break;
    case 'oil_seeker':
      details.push(
        createAuraStrip(scene, -0.4, 0, 6.6, 0.9, lineColor, 0.38),
        createAuraStrip(scene, 3.6, 0, 2.2, 0.7, lineColor, 0.34),
        createAuraLine(scene, -0.8, -3.6, 2.2, -5.2, lineColor, 0.32, 0.9),
      );
      break;
    case 'missile_launcher':
      details.push(
        createAuraStrip(scene, -0.2, 0, 7.2, 0.8, lineColor, 0.36),
        createAuraStrip(scene, -0.2, -2.8, 6.4, 0.65, lineColor, 0.32),
        createAuraStrip(scene, -0.2, 2.8, 6.4, 0.65, lineColor, 0.32),
        createAuraStrip(scene, 3.5, 0, 2, 0.65, lineColor, 0.3),
      );
      break;
    case 'destroyer':
      details.push(
        createAuraStrip(scene, 0.2, 0, 20, 0.65, lineColor, 0.32),
        createAuraLine(scene, 8.6, -1.7, 13.4, -0.4, lineColor, 0.28, 0.8),
        createAuraLine(scene, 8.6, 1.7, 13.4, 0.4, lineColor, 0.28, 0.8),
      );
      break;
    case 'pirate_ship':
      details.push(
        createAuraStrip(scene, 0, 0, 17, 0.55, lineColor, 0.28),
        createAuraStrip(scene, -6.2, 0, 2.6, 0.55, lineColor, 0.24),
        createAuraStrip(scene, 6.1, 0, 2.6, 0.55, lineColor, 0.24),
      );
      break;
    case 'construction_ship':
      details.push(
        createAuraStrip(scene, 0.6, 0, 15.8, 0.7, lineColor, 0.34),
        createAuraStrip(scene, -7.4, 0, 3.3, 0.7, lineColor, 0.3),
        createAuraLine(scene, 5.4, -2.2, 9.6, -4, lineColor, 0.3, 0.85),
      );
      break;
    case 'ferry':
      details.push(
        createAuraStrip(scene, 0, 0, 21, 0.7, lineColor, 0.34),
        createAuraStrip(scene, 0, -1.8, 10.6, 0.65, lineColor, 0.28),
        createAuraStrip(scene, 14.6, 0, 2.4, 0.7, lineColor, 0.24),
      );
      break;
    case 'light_plane':
      details.push(
        createAuraStrip(scene, 1.2, 0, 13.5, 0.7, lineColor, 0.34),
        createAuraLine(scene, -3.4, -4.6, 3.8, -1.3, lineColor, 0.3, 0.8),
        createAuraLine(scene, -3.4, 4.6, 3.8, 1.3, lineColor, 0.3, 0.8),
      );
      break;
    case 'alien_scout':
      details.push(
        createAuraStrip(scene, 0.6, 0, 18.6, 0.8, lineColor, 0.38),
        createAuraLine(scene, -8.8, -6.4, 7.8, -2.4, lineColor, 0.4, 1),
        createAuraLine(scene, -8.8, 6.4, 7.8, 2.4, lineColor, 0.4, 1),
        createAuraLine(scene, -14.8, 0, -7.4, 0, lineColor, 0.32, 0.9),
      );
      break;
    case 'heavy_alien':
      details.push(
        createAuraStrip(scene, 0.2, 0, 28, 1, lineColor, 0.34),
        createAuraLine(scene, -14.2, -8.8, 14.2, -3.8, lineColor, 0.34, 1.1),
        createAuraLine(scene, -14.2, 8.8, 14.2, 3.8, lineColor, 0.34, 1.1),
        createAuraLine(scene, -12.2, 0, 12.2, 0, lineColor, 0.26, 0.9),
      );
      break;
    case 'aircraft_carrier':
      details.push(
        createAuraStrip(scene, 4, 0, 112, 1.1, lineColor, 0.3),
        createAuraStrip(scene, -47, 0, 14, 1, lineColor, 0.24),
        createAuraStrip(scene, 33, -11, 8, 0.8, lineColor, 0.22),
      );
      break;
    case 'mothership':
      details.push(
        createAuraLine(scene, -18, 0, 18, 0, lineColor, 0.28, 1),
        createAuraLine(scene, 0, -18, 0, 18, lineColor, 0.28, 1),
        createAuraLine(scene, -12.5, -12.5, 12.5, 12.5, lineColor, 0.2, 0.8),
        createAuraLine(scene, -12.5, 12.5, 12.5, -12.5, lineColor, 0.2, 0.8),
      );
      break;
    default:
      break;
  }

  if (details.length) {
    container.add(details);
  }
}

function getCachedUnitTextureKey(
  type: RenderableUnitType,
  color: number,
  isSelected: boolean,
  renderMode: UnitArtRenderMode
) {
  return `unit-art:v${UNIT_ART_CACHE_VERSION}:${type}:${color.toString(16)}:${isSelected ? 1 : 0}:${renderMode}`;
}

function createLodTexture(
  scene: Phaser.Scene,
  key: string,
  type: RenderableUnitType,
  color: number,
  isSelected: boolean
) {
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  const size = 36;
  const centerX = size / 2;
  const outlineColor = isSelected ? HIGHLIGHT : OUTLINE;
  const accentDark = shade(color, 35);
  const accentLight = tint(color, 35);

  graphics.fillStyle(SHADOW, 0.18);
  graphics.fillEllipse(centerX, 28, 18, 7);
  graphics.lineStyle(isSelected ? 3 : 2, outlineColor, 1);

  if (type === 'soldier' || type === 'sniper') {
    graphics.fillStyle(type === 'sniper' ? 0x55614d : 0x56704f, 1);
    graphics.fillRoundedRect(9, 10, 12, 12, 3);
    graphics.strokeRoundedRect(9, 10, 12, 12, 3);
    graphics.fillStyle(type === 'sniper' ? accentDark : 0xf2c49a, 1);
    graphics.fillCircle(17, 8, 4);
    graphics.strokeCircle(17, 8, 4);
    graphics.fillStyle(type === 'sniper' ? 0x141a1f : 0x20282f, 1);
    graphics.fillRoundedRect(18, 14, type === 'sniper' ? 10 : 9, 3, 1);
    graphics.strokeRoundedRect(18, 14, type === 'sniper' ? 10 : 9, 3, 1);
    if (type === 'sniper') {
      graphics.fillStyle(accentLight, 1);
      graphics.fillRoundedRect(20, 11, 6, 2, 1);
      graphics.strokeRoundedRect(20, 11, 6, 2, 1);
    } else {
      graphics.fillStyle(accentLight, 1);
      graphics.fillRect(28, 14, 3, 3);
      graphics.strokeRect(28, 14, 3, 3);
    }
  } else if (type === 'rocketeer') {
    graphics.fillStyle(0x6e7b84, 1);
    graphics.fillRoundedRect(9, 10, 13, 12, 3);
    graphics.strokeRoundedRect(9, 10, 13, 12, 3);
    graphics.fillStyle(0x364047, 1);
    graphics.fillRoundedRect(8, 6, 7, 12, 2);
    graphics.strokeRoundedRect(8, 6, 7, 12, 2);
    graphics.fillStyle(0x334d2d, 1);
    graphics.fillRoundedRect(17, 9, 12, 5, 2);
    graphics.strokeRoundedRect(17, 9, 12, 5, 2);
    graphics.fillStyle(color, 1);
    graphics.fillTriangle(29, 11.5, 33, 9, 33, 14);
    graphics.strokeTriangle(29, 11.5, 33, 9, 33, 14);
    graphics.fillStyle(0xf0c39f, 1);
    graphics.fillCircle(17, 7, 4);
    graphics.strokeCircle(17, 7, 4);
  } else if (type === 'builder') {
    graphics.fillStyle(0x2779c6, 1);
    graphics.fillRoundedRect(10, 10, 12, 12, 3);
    graphics.strokeRoundedRect(10, 10, 12, 12, 3);
    graphics.fillStyle(0xf57c25, 1);
    graphics.fillRect(11, 10, 3, 12);
    graphics.fillRect(18, 10, 3, 12);
    graphics.strokeRect(11, 10, 3, 12);
    graphics.strokeRect(18, 10, 3, 12);
    graphics.fillStyle(0xf1c39c, 1);
    graphics.fillCircle(17, 7, 4);
    graphics.strokeCircle(17, 7, 4);
    graphics.fillStyle(accentLight, 1);
    graphics.fillRoundedRect(22, 8, 3, 10, 1);
    graphics.strokeRoundedRect(22, 8, 3, 10, 1);
    graphics.fillStyle(0xe6eef3, 1);
    graphics.fillRoundedRect(24, 5, 5, 3, 1);
    graphics.strokeRoundedRect(24, 5, 5, 3, 1);
  }

  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function createCachedFullTexture(
  scene: Phaser.Scene,
  key: string,
  type: RenderableUnitType,
  color: number,
  isSelected: boolean
) {
  const tempContainer = createVectorUnitArt(scene, 0, 0, type, color, isSelected);
  const bounds = tempContainer.getBounds();
  const padding = 10;
  const width = Math.max(32, Math.ceil(bounds.width + padding * 2));
  const height = Math.max(32, Math.ceil(bounds.height + padding * 2));
  const renderTexture = scene.make.renderTexture({ width, height }, false);
  const drawX = width * 0.5 - bounds.centerX;
  const drawY = height * 0.5 - bounds.centerY;

  renderTexture.draw(tempContainer, drawX, drawY);
  renderTexture.saveTexture(key);
  renderTexture.destroy();
  tempContainer.destroy();
}

function createCachedUnitArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: RenderableUnitType,
  color: number,
  isSelected: boolean,
  renderMode: UnitArtRenderMode
) {
  const key = getCachedUnitTextureKey(type, color, isSelected, renderMode);
  if (!scene.textures.exists(key)) {
    if (renderMode === 'lod') {
      createLodTexture(scene, key, type, color, isSelected);
    } else {
      createCachedFullTexture(scene, key, type, color, isSelected);
    }
  }

  const container = scene.add.container(x, y);
  container.setData('unitArtType', type);
  const sprite = scene.add.image(0, 0, key);
  sprite.setOrigin(0.5, 0.5);
  container.add(sprite);
  return container;
}

export function createUnitArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: RenderableUnitType | string,
  color: number,
  isSelected: boolean,
  options: CreateUnitArtOptions = {}
): Phaser.GameObjects.Container {
  const renderMode = options.renderMode ?? 'full';
  if (
    CACHED_HUMANOID_TEXTURE_TYPES.has(type as RenderableUnitType)
  ) {
    return createCachedUnitArt(
      scene,
      x,
      y,
      type as RenderableUnitType,
      color,
      isSelected,
      renderMode
    );
  }

  return createVectorUnitArt(scene, x, y, type, color, isSelected, options);
}

function createVectorUnitArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: RenderableUnitType | string,
  color: number,
  isSelected: boolean,
  options: CreateUnitArtOptions = {}
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  container.setData('unitArtType', type);
  const accent = color;
  const accentLight = tint(color, 35);
  const accentDark = shade(color, 45);
  const skinPalette = options.skinId && options.skinId !== 'default'
    ? SKIN_DEFINITIONS_BY_ID[options.skinId]?.palette
    : undefined;

  if (type === 'soldier') {
    addShadow(scene, container, 0, 12, 20, 8);

    const backpack = outline(scene.add.rectangle(-7, 0.5, 5, 10, 0x6d6046), isSelected);
    const rearLeg = outline(scene.add.rectangle(-3, 10, 4, 8, 0x364836), isSelected);
    const frontLeg = outline(scene.add.rectangle(2.5, 10, 4, 8, 0x4e6848), isSelected);
    const hips = outline(scene.add.rectangle(0, 6, 11, 3, 0x2d3b2b), isSelected);
    const torso = outline(scene.add.polygon(
      -1,
      0,
      [-6, -6, 3, -7, 7, -2, 6, 7, -5, 7],
      0x5d7452,
      1
    ), isSelected);
    const chestPlate = outline(scene.add.polygon(
      0,
      0,
      [-3, -4, 2, -4, 4, -1, 4, 4, -3, 4],
      accentDark,
      1
    ), isSelected);
    const shoulderPadRear = outline(scene.add.circle(-4.8, -2.5, 2.8, 0x4a6243), isSelected);
    const shoulderPadFront = outline(scene.add.circle(4.8, -1.8, 2.8, 0x6f885d), isSelected);
    const rearArm = outline(scene.add.rectangle(-5.5, 1.5, 3, 9, 0x455b44), isSelected);
    const frontArm = outline(scene.add.rectangle(6.2, 0.8, 3.4, 8.2, 0x6b875d), isSelected);
    const gloves = outline(scene.add.rectangle(8.3, 1.2, 2.2, 4, 0x2b2f32), isSelected);
    const rifleStock = outline(scene.add.rectangle(5.5, 1.5, 8, 3, 0x5a402e), isSelected);
    const rifleBody = outline(scene.add.rectangle(13.2, 1.5, 11, 2.6, 0x1d242b), isSelected);
    const rifleSight = outline(scene.add.rectangle(11, -0.8, 3.4, 1.5, accentLight), isSelected);
    const muzzle = outline(scene.add.rectangle(19.5, 1.5, 2.2, 3, accentLight), isSelected);
    const head = outline(scene.add.circle(0, -9.2, 4.8, 0xf2c39c), isSelected);
    const helmet = outline(scene.add.arc(0, -10.2, 6.2, 180, 360, false, 0x364734), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const visor = outline(scene.add.rectangle(1.5, -10.1, 6.5, 1.8, accentLight), isSelected);
    const chin = outline(scene.add.rectangle(2.2, -7.3, 4.2, 1.7, 0xc59268), isSelected);

    container.add([
      backpack,
      rearLeg,
      frontLeg,
      hips,
      torso,
      chestPlate,
      shoulderPadRear,
      shoulderPadFront,
      rearArm,
      frontArm,
      gloves,
      rifleStock,
      rifleBody,
      rifleSight,
      muzzle,
      head,
      chin,
      helmet,
      visor
    ]);
  } else if (type === 'tank') {
    addShadow(scene, container, 0, 14, 40, 11);

    const trackTop = outline(scene.add.rectangle(0, -7.8, 30, 5, 0x24292c), isSelected);
    const trackBottom = outline(scene.add.rectangle(0, 7.8, 30, 5, 0x24292c), isSelected);
    const hull = outline(scene.add.rectangle(0, 0, 14, 13.2, 0x70805d), isSelected);
    const glacis = scene.add.polygon(2.6, 0, [-4.4, -4.4, 2.2, -4.4, 4.8, -1.8, 4.8, 1.8, 2.2, 4.4, -4.4, 4.4], 0x8a9b72, 1);
    const rearDeck = scene.add.rectangle(-3.8, 0, 2.8, 5.2, 0x5a6848);
    const turret = outline(scene.add.ellipse(0.2, 0, 11.2, 8, 0x798763), isSelected);
    const hatch = scene.add.circle(-1.6, 0, 1.1, 0xb8c29d);
    const mantlet = outline(scene.add.circle(6, 0, 1.5, 0x3a4334), isSelected);
    const barrel = outline(scene.add.rectangle(15.8, 0, 12.2, 2, 0x21271f), isSelected);
    const muzzle = outline(scene.add.rectangle(22.4, 0, 1.8, 2.4, 0xc7d0d3), isSelected);

    container.add([
      trackTop,
      trackBottom,
      hull,
      glacis,
      rearDeck,
      turret,
      hatch,
      mantlet,
      barrel,
      muzzle,
    ]);
  } else if (type === 'humvee') {
    addShadow(scene, container, 0, 13, 32, 10);

    const wheelRearTop = outline(scene.add.ellipse(-4.8, -5.2, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelFrontTop = outline(scene.add.ellipse(4.2, -5.2, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelRearBottom = outline(scene.add.ellipse(-4.8, 5.2, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelFrontBottom = outline(scene.add.ellipse(4.2, 5.2, 4.2, 2.8, 0x181c1e), isSelected);
    const axleTop = scene.add.rectangle(-0.3, -3.8, 10.4, 1.2, 0x4a4339);
    const axleBottom = scene.add.rectangle(-0.3, 3.8, 10.4, 1.2, 0x4a4339);
    const chassisSkirt = outline(scene.add.rectangle(-0.2, 0, 10, 5.4, 0xbfae90), isSelected);
    const body = outline(scene.add.rectangle(0, 0, 8.8, 6.8, 0xddcfb5), isSelected);
    const rearBox = scene.add.rectangle(-2.8, 0, 2.2, 5, 0xb69e7a);
    const hood = scene.add.polygon(3.4, 0, [-1.6, -2.8, 0.8, -2.8, 2.2, 0, 0.8, 2.8, -1.6, 2.8], 0xebe0c8, 1);
    const windshield = scene.add.rectangle(1.2, 0, 2.2, 3, 0x7ba8bd);
    const turretRing = outline(scene.add.circle(-0.4, 0, 1.3, 0x474f54), isSelected);
    const gun = outline(scene.add.rectangle(3.4, 0, 2.8, 1, 0x20262a), isSelected);
    const bumper = scene.add.rectangle(4.8, 0, 0.9, 3, 0xd8d8d2);
    const light = scene.add.circle(5.4, 0, 0.7, accentLight);

    container.add([
      wheelRearTop,
      wheelFrontTop,
      wheelRearBottom,
      wheelFrontBottom,
      axleTop,
      axleBottom,
      chassisSkirt,
      body,
      rearBox,
      hood,
      windshield,
      turretRing,
      gun,
      bumper,
      light
    ]);
  } else if (type === 'oil_seeker') {
    addShadow(scene, container, 0, 13.4, 36, 10);

    const wheelRearTop = outline(scene.add.ellipse(-5.6, -5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelMidTop = outline(scene.add.ellipse(0, -5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelFrontTop = outline(scene.add.ellipse(5.6, -5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelRearBottom = outline(scene.add.ellipse(-5.6, 5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelMidBottom = outline(scene.add.ellipse(0, 5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const wheelFrontBottom = outline(scene.add.ellipse(5.6, 5.3, 4.2, 2.8, 0x181c1e), isSelected);
    const axleTop = scene.add.rectangle(0, -3.9, 13.4, 1.1, 0xaa7530);
    const axleBottom = scene.add.rectangle(0, 3.9, 13.4, 1.1, 0xaa7530);
    const underBody = outline(scene.add.rectangle(0, 0, 11, 5.6, 0xd29640), isSelected);
    const body = outline(scene.add.rectangle(0, 0, 9.4, 6.8, 0xe4ae58), isSelected);
    const rearBox = scene.add.rectangle(-2.8, 0, 2.2, 5.4, 0xbd7f30);
    const cab = outline(scene.add.polygon(3.8, 0, [-1.4, -4.8, 1.2, -4.8, 2.6, -1.8, 2.6, 1.8, 1.2, 4.8, -1.4, 4.8], 0xf0be6d, 1), isSelected);
    const windshield = scene.add.rectangle(3.6, 0, 2.2, 3.2, 0x7aa8bc);
    const turntable = outline(scene.add.circle(0, 0, 1.7, 0x4f5c65), isSelected);
    const derrick = outline(scene.add.rectangle(0, -0.2, 1.2, 9.8, 0x3f474d), isSelected);
    const boom = outline(scene.add.rectangle(2.2, -3.2, 5.6, 1.1, 0x5f6870), isSelected);
    boom.setRotation(-0.34);
    const bit = outline(scene.add.circle(4.2, -5, 1.1, accentLight), isSelected);

    container.add([
      wheelRearTop,
      wheelMidTop,
      wheelFrontTop,
      wheelRearBottom,
      wheelMidBottom,
      wheelFrontBottom,
      axleTop,
      axleBottom,
      underBody,
      body,
      rearBox,
      cab,
      windshield,
      turntable,
      derrick,
      boom,
      bit
    ]);
  } else if (type === 'missile_launcher') {
    addShadow(scene, container, 0, 14, 39, 10);

    const wheelRearTop = outline(scene.add.ellipse(-5.6, -5.3, 4, 2.8, 0x171b1d), isSelected);
    const wheelMidTop = outline(scene.add.ellipse(0, -5.3, 4, 2.8, 0x171b1d), isSelected);
    const wheelFrontTop = outline(scene.add.ellipse(5.6, -5.3, 4, 2.8, 0x171b1d), isSelected);
    const wheelRearBottom = outline(scene.add.ellipse(-5.6, 5.3, 4, 2.8, 0x171b1d), isSelected);
    const wheelMidBottom = outline(scene.add.ellipse(0, 5.3, 4, 2.8, 0x171b1d), isSelected);
    const wheelFrontBottom = outline(scene.add.ellipse(5.6, 5.3, 4, 2.8, 0x171b1d), isSelected);
    const axleTop = scene.add.rectangle(0, -3.9, 13.2, 1.1, 0x556243);
    const axleBottom = scene.add.rectangle(0, 3.9, 13.2, 1.1, 0x556243);
    const underBody = outline(scene.add.rectangle(0, 0, 11.4, 5.8, 0x86996c), isSelected);
    const body = outline(scene.add.rectangle(0, 0, 10.2, 7, 0x91a173), isSelected);
    const pod = outline(scene.add.rectangle(-0.2, 0, 7.8, 9.4, 0x6d7b84), isSelected);
    const podFace = scene.add.rectangle(3.2, 0, 1, 9.4, 0x56616a);
    const cab = outline(scene.add.polygon(3.8, 0, [-1.4, -4.8, 1.2, -4.8, 2.6, -1.8, 2.6, 1.8, 1.2, 4.8, -1.4, 4.8], 0x788961, 1), isSelected);
    const windshield = scene.add.rectangle(3.6, 0, 2.2, 3.2, 0x7faeca);
    const launcherCells = [
      { x: -6.2, y: -3.1 },
      { x: -3.2, y: -3.1 },
      { x: -0.2, y: -3.1 },
      { x: -6.2, y: 0 },
      { x: -3.2, y: 0 },
      { x: -0.2, y: 0 },
      { x: -6.2, y: 3.1 },
      { x: -3.2, y: 3.1 },
      { x: -0.2, y: 3.1 }
    ];
    launcherCells.forEach(({ x: tubeX, y: tubeY }) => {
      const cell = outline(scene.add.circle(tubeX, tubeY, 1.4, 0x1a2025), isSelected);
      const ring = outline(scene.add.circle(tubeX, tubeY, 0.9, 0xcfd5da), isSelected);
      container.add([cell, ring]);
    });
    const stabilizer = scene.add.rectangle(-3.8, 0, 1.2, 6.8, 0x46533d);

    container.add([
      wheelRearTop,
      wheelMidTop,
      wheelFrontTop,
      wheelRearBottom,
      wheelMidBottom,
      wheelFrontBottom,
      axleTop,
      axleBottom,
      underBody,
      body,
      cab,
      windshield,
      pod,
      podFace,
      stabilizer,
    ]);
  } else if (type === 'destroyer') {
    addShadow(scene, container, 0, 14, 48, 11, 0.14);

    const hullBody = outline(scene.add.rectangle(0, 0, 33.2, 8.2, 0x576672), isSelected);
    const deck = outline(scene.add.rectangle(0, 0, 25.2, 6.2, 0x7d8f99), isSelected);
    const centerDeck = outline(scene.add.rectangle(0, 0, 16.2, 5.8, 0x95a7b1), isSelected);
    const superStructure = outline(scene.add.rectangle(0, 0, 8.8, 4.8, 0xc3d0d6), isSelected);
    const bridgeGlass = scene.add.rectangle(0.8, 0, 3.2, 1.2, 0x7cb0c7);
    const funnel = outline(scene.add.rectangle(-1.2, 0, 2, 3.4, 0x374047), isSelected);
    const mast = outline(scene.add.rectangle(-3.2, 0, 1, 8, 0x253038), isSelected);
    const radar = outline(scene.add.rectangle(-3.2, 0, 4.6, 1, accentLight), isSelected);
    const aftVls = outline(scene.add.rectangle(-7.8, 0, 3.2, 3.2, 0x4c5a64), isSelected);
    const foreVls = outline(scene.add.rectangle(7.8, 0, 3.2, 3.2, 0x4c5a64), isSelected);
    const bowTurret = outline(scene.add.circle(13.9, 0, 1.8, 0x30373d), isSelected);
    const bowGun = outline(scene.add.rectangle(17.8, 0, 3.8, 1.2, 0x1c2328), isSelected);
    const sternPad = outline(scene.add.rectangle(-13.2, 0, 4.4, 4.4, 0x50606a), isSelected);
    const sternMarkV = scene.add.rectangle(-13.2, 0, 2.6, 0.7, 0xd0d9dd);
    const sternMarkH = scene.add.rectangle(-13.2, 0, 0.7, 2.6, 0xd0d9dd);

    container.add([
      hullBody,
      deck,
      centerDeck,
      superStructure,
      bridgeGlass,
      funnel,
      mast,
      radar,
      aftVls,
      foreVls,
      bowTurret,
      bowGun,
      sternPad,
      sternMarkV,
      sternMarkH
    ]);
  } else if (type === 'pirate_ship') {
    addShadow(scene, container, 0, 14, 45, 13, 0.15);

    const hullBody = outline(scene.add.rectangle(0, 0, 31.6, 8.3, 0x6a4330), isSelected);
    const deck = outline(scene.add.rectangle(0, 0, 23.8, 6.1, 0x926241), isSelected);
    const centerDeck = outline(scene.add.rectangle(0, 0, 16.4, 5.8, 0xa67a52), isSelected);
    const spine = scene.add.rectangle(0, 0, 22, 1.1, 0x553321);
    const rearMast = outline(scene.add.rectangle(-4.2, 0, 1.2, 13.8, 0x362519), isSelected);
    const midMast = outline(scene.add.rectangle(0, 0, 1.3, 15.2, 0x362519), isSelected);
    const frontMast = outline(scene.add.rectangle(4.4, 0, 1.2, 12.6, 0x362519), isSelected);
    const rearSail = scene.add.polygon(-4.2, 0, [-2.7, -5, 2.5, -3.5, 2.5, 3.5, -2.7, 5], 0xe9dcc1, 1);
    const midSail = scene.add.polygon(0, 0, [-3.1, -5.6, 2.9, -4, 2.9, 4, -3.1, 5.6], 0xf2e7cf, 1);
    const frontSail = scene.add.polygon(4.4, 0, [-2.2, -4.2, 2, -2.9, 2, 2.9, -2.2, 4.2], 0xe9dcc1, 1);
    const bowsprit = outline(scene.add.rectangle(20.2, 0, 4, 1.2, 0x4c321f), isSelected);
    const flag = outline(scene.add.triangle(5.2, -7, 0, -1.5, 0, 1.5, 3.2, 0, accent), isSelected);

    container.add([
      hullBody,
      deck,
      centerDeck,
      spine,
      rearMast,
      midMast,
      frontMast,
      rearSail,
      midSail,
      frontSail,
      bowsprit,
      flag
    ]);
  } else if (type === 'construction_ship') {
    addShadow(scene, container, 0, 14, 46, 12, 0.15);

    const hullBody = outline(scene.add.rectangle(0, 0, 34.2, 8.6, 0x66717a), isSelected);
    const deck = outline(scene.add.rectangle(0, 0, 27.4, 6.8, 0x8896a0), isSelected);
    const workDeck = outline(scene.add.rectangle(0.6, 0, 19.8, 5.8, 0x96a4ad), isSelected);
    const bridgeBlock = outline(scene.add.rectangle(-7.4, 0, 6.1, 5.1, 0xc5d0d5), isSelected);
    const bridgeRoof = outline(scene.add.rectangle(-7.4, 0, 3.2, 3.2, 0xe2ebef), isSelected);
    const windows = scene.add.rectangle(-6.8, 0, 2.6, 1.2, 0x7eb5cf);
    const craneTurntable = outline(scene.add.circle(4.4, 0, 2.2, 0x485159), isSelected);
    const craneColumn = outline(scene.add.rectangle(4.4, -0.2, 1.5, 8.2, 0xf0aa20), isSelected);
    const craneBoom = outline(scene.add.rectangle(8.3, -2.8, 7, 1.35, 0x374047), isSelected);
    craneBoom.setRotation(-0.34);
    const cable = outline(scene.add.line(0, 0, 10.2, -4.5, 10.2, 0.6, 0x1b2227), isSelected);
    const hook = outline(scene.add.rectangle(10.2, 1.2, 1.25, 1.9, accentLight), isSelected);
    const sternDeck = outline(scene.add.rectangle(-13, 0, 3.8, 4.2, 0x75828b), isSelected);
    const bowPad = outline(scene.add.rectangle(13.1, 0, 4.4, 4.8, 0x7a8891), isSelected);

    container.add([
      hullBody,
      deck,
      workDeck,
      sternDeck,
      bowPad,
      bridgeBlock,
      bridgeRoof,
      windows,
      craneTurntable,
      craneColumn,
      craneBoom,
      cable,
      hook
    ]);
  } else if (type === 'sniper') {
    addShadow(scene, container, 0, 12, 19, 7);

    const cloak = outline(scene.add.polygon(
      -2,
      1,
      [-10, -6, 1, -8, 7, -1, 6, 9, -8, 8],
      0x495440,
      1
    ), isSelected);
    const rearLeg = outline(scene.add.rectangle(-3.2, 10, 4, 8, 0x354236), isSelected);
    const frontLeg = outline(scene.add.rectangle(2.2, 10, 4, 8, 0x415246), isSelected);
    const shoulderWrap = outline(scene.add.polygon(
      1,
      -1,
      [-6, -3, 3, -4, 7, -1, 6, 4, -6, 4],
      accentDark,
      1
    ), isSelected);
    const rearArm = outline(scene.add.rectangle(-5.8, 1, 3, 7, 0x56614d), isSelected);
    const frontArm = outline(scene.add.rectangle(7.2, 0.8, 3, 7, 0x69765f), isSelected);
    const rifleStock = outline(scene.add.rectangle(5.5, 1.2, 9, 2.3, 0x4f3827), isSelected);
    const rifleBody = outline(scene.add.rectangle(15, 1.2, 15, 1.8, 0x12181d), isSelected);
    const scope = outline(scene.add.rectangle(10, -1.3, 8, 1.8, accentLight), isSelected);
    const muzzle = outline(scene.add.rectangle(23, 1.2, 2.2, 2.6, 0xc9d1d7), isSelected);
    const head = outline(scene.add.circle(0, -8.8, 4.7, 0xf0c39f), isSelected);
    const hood = outline(scene.add.arc(0, -9.7, 6.5, 180, 360, false, 0x55614d), isSelected);
    (hood as Phaser.GameObjects.Arc).setClosePath(true);
    const ghilliePatch = outline(scene.add.polygon(-6.5, -1.5, [-3, -2, 3, -2, 5, 0, 2, 3, -3, 2], 0x687456, 1), isSelected);

    container.add([
      cloak,
      rearLeg,
      frontLeg,
      shoulderWrap,
      rearArm,
      frontArm,
      rifleStock,
      rifleBody,
      scope,
      muzzle,
      head,
      hood,
      ghilliePatch
    ]);
  } else if (type === 'rocketeer') {
    addShadow(scene, container, 0, 12, 20, 8);

    const rearTube = outline(scene.add.rectangle(-6, -1.8, 4.8, 13, 0x2c363c), isSelected);
    const rearLeg = outline(scene.add.rectangle(-3.8, 10, 4.6, 8, 0x39454b), isSelected);
    const frontLeg = outline(scene.add.rectangle(2.2, 10, 4.6, 8, 0x4b5962), isSelected);
    const torso = outline(scene.add.polygon(
      0,
      0,
      [-7, -6, 4, -6, 8, -1, 7, 7, -6, 7],
      0x6c7982,
      1
    ), isSelected);
    const chest = outline(scene.add.rectangle(0.5, 0, 9.5, 8.2, accentDark), isSelected);
    const rearArm = outline(scene.add.rectangle(-7, 1, 3.5, 9, 0x58656d), isSelected);
    const frontArm = outline(scene.add.rectangle(7.2, 0.2, 3.5, 8.2, 0x7b8891), isSelected);
    const launcherTube = outline(scene.add.rectangle(8.5, -4.2, 18, 6, 0x2f4730), isSelected);
    const launcherCap = outline(scene.add.rectangle(1.5, -4.2, 3, 6, 0x273430), isSelected);
    const grip = outline(scene.add.rectangle(2.8, -0.8, 2, 4.2, 0x171d22), isSelected);
    const sight = outline(scene.add.rectangle(8.5, -8.2, 4.5, 2, accentLight), isSelected);
    const rocketTip = outline(scene.add.triangle(17, -4.2, 0, -3, 0, 3, 5, 0, accent), isSelected);
    const head = outline(scene.add.circle(0, -10.1, 4.8, 0xf0c39f), isSelected);
    const helmet = outline(scene.add.arc(0, -10.8, 6.4, 180, 360, false, 0x39434a), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const visor = outline(scene.add.rectangle(1, -10.2, 7, 2, accentLight), isSelected);

    container.add([
      rearTube,
      rearLeg,
      frontLeg,
      torso,
      chest,
      rearArm,
      frontArm,
      launcherCap,
      launcherTube,
      grip,
      sight,
      rocketTip,
      head,
      helmet,
      visor
    ]);
  } else if (type === 'ferry') {
    addShadow(scene, container, 0, 14, 44, 13, 0.14);

    const hullBody = outline(scene.add.rectangle(0, 0, 35.2, 8.8, 0x8a949b), isSelected);
    const deck = outline(scene.add.rectangle(0, 0, 27.2, 7, 0xb8c2c7), isSelected);
    const cabin = outline(scene.add.rectangle(0, 0, 18.4, 7.6, 0xf2f6f7), isSelected);
    const upperCabin = outline(scene.add.rectangle(0, 0, 7.6, 5.4, 0xe6edf1), isSelected);
    const bridge = outline(scene.add.rectangle(1.2, 0, 2.2, 3.2, 0xdae4e8), isSelected);
    const windows = scene.add.rectangle(0, 0, 13.2, 2.2, 0x74aac6);
    const bowRamp = outline(scene.add.rectangle(15.6, 0, 4.2, 5.2, 0x9aa3a9), isSelected);
    const waterline = scene.add.rectangle(-0.6, 5.1, 34, 1.6, accent);

    container.add([
      hullBody,
      deck,
      cabin,
      upperCabin,
      bridge,
      windows,
      bowRamp,
      waterline
    ]);
  } else if (type === 'builder') {
    addShadow(scene, container, 0, 12, 19, 7);

    const rearLeg = outline(scene.add.rectangle(-3.5, 10, 4, 8, 0x284069), isSelected);
    const frontLeg = outline(scene.add.rectangle(2.5, 10, 4, 8, 0x34538b), isSelected);
    const torso = outline(scene.add.polygon(
      0,
      0,
      [-6, -6, 3, -6, 6, -1, 6, 7, -6, 7],
      0x2779c6,
      1
    ), isSelected);
    const vestLeft = outline(scene.add.rectangle(-2.4, 0, 3.1, 11, 0xf57c25), isSelected);
    const vestRight = outline(scene.add.rectangle(2.4, 0, 3.1, 11, 0xf57c25), isSelected);
    const vestBand = outline(scene.add.rectangle(0, 2, 11, 2, accentLight), isSelected);
    const toolBelt = outline(scene.add.rectangle(0, 5.6, 12, 2.2, 0x6b4a2a), isSelected);
    const rearArm = outline(scene.add.rectangle(-6.2, 1.2, 3, 8, 0x4b7eb9), isSelected);
    const frontArm = outline(scene.add.rectangle(6.4, 0.3, 3, 8, 0x5b90cd), isSelected);
    const wrenchHandle = outline(scene.add.rectangle(11, -4.2, 2.8, 10, 0xc7cfd6), isSelected);
    wrenchHandle.setRotation(-0.5);
    const wrenchHead = outline(scene.add.rectangle(13.2, -8.1, 6, 4, 0xe6eef3), isSelected);
    wrenchHead.setRotation(-0.5);
    const toolbox = outline(scene.add.rectangle(-12.2, 4, 8.4, 6.2, 0xe24936), isSelected);
    const toolboxHandle = outline(scene.add.rectangle(-12.2, 0, 4.2, 2, 0x242b31), isSelected);
    const head = outline(scene.add.circle(0, -8.8, 4.8, 0xf1c39c), isSelected);
    const helmet = outline(scene.add.arc(0, -9.6, 6.4, 180, 360, false, 0xf5cc27), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const helmetStripe = outline(scene.add.rectangle(0, -10.7, 2, 4, accent), isSelected);

    container.add([
      rearLeg,
      frontLeg,
      torso,
      vestLeft,
      vestRight,
      vestBand,
      toolBelt,
      rearArm,
      frontArm,
      wrenchHandle,
      wrenchHead,
      toolbox,
      toolboxHandle,
      head,
      helmet,
      helmetStripe
    ]);
  } else if (type === 'light_plane') {
    addShadow(scene, container, 0, 18, 50, 12, 0.12);
    const plane = scene.add.graphics();
    const outlineColor = isSelected ? HIGHLIGHT : OUTLINE;
    const lightBody = [
      { x: -17.2, y: -1.25 },
      { x: -14.8, y: -1.25 },
      { x: -13.1, y: -2.6 },
      { x: -11.8, y: -3.1 },
      { x: -9.7, y: -3.1 },
      { x: -7.1, y: -6.9 },
      { x: -4.5, y: -7.9 },
      { x: -2.2, y: -7.9 },
      { x: 1.2, y: -3.2 },
      { x: 5.8, y: -3.2 },
      { x: 10.8, y: -7.1 },
      { x: 13.2, y: -7.1 },
      { x: 15.8, y: -3.3 },
      { x: 18.1, y: -1.1 },
      { x: 19.2, y: 0 },
      { x: 18.1, y: 1.1 },
      { x: 15.8, y: 3.3 },
      { x: 13.2, y: 7.1 },
      { x: 10.8, y: 7.1 },
      { x: 5.8, y: 3.2 },
      { x: 1.2, y: 3.2 },
      { x: -2.2, y: 7.9 },
      { x: -4.5, y: 7.9 },
      { x: -7.1, y: 6.9 },
      { x: -9.7, y: 3.1 },
      { x: -11.8, y: 3.1 },
      { x: -13.1, y: 2.6 },
      { x: -14.8, y: 1.25 },
      { x: -17.2, y: 1.25 },
      { x: -15.2, y: 0 },
    ];
    const lightCore = [
      { x: -12.4, y: -0.9 },
      { x: -10.2, y: -0.9 },
      { x: -8.8, y: -1.95 },
      { x: -7.4, y: -2.25 },
      { x: -6.1, y: -2.25 },
      { x: -4.3, y: -4.9 },
      { x: -2.3, y: -5.6 },
      { x: -0.9, y: -5.6 },
      { x: 1.1, y: -2.6 },
      { x: 4.8, y: -2.6 },
      { x: 8.8, y: -5.7 },
      { x: 10.7, y: -5.7 },
      { x: 12.9, y: -2.55 },
      { x: 14.5, y: -0.82 },
      { x: 15.2, y: 0 },
      { x: 14.5, y: 0.82 },
      { x: 12.9, y: 2.55 },
      { x: 10.7, y: 5.7 },
      { x: 8.8, y: 5.7 },
      { x: 4.8, y: 2.6 },
      { x: 1.1, y: 2.6 },
      { x: -0.9, y: 5.6 },
      { x: -2.3, y: 5.6 },
      { x: -4.3, y: 4.9 },
      { x: -6.1, y: 2.25 },
      { x: -7.4, y: 2.25 },
      { x: -8.8, y: 1.95 },
      { x: -10.2, y: 0.9 },
      { x: -12.4, y: 0.9 },
    ];
    const lightSpine = [
      { x: -7.8, y: -0.82 },
      { x: -4.1, y: -0.82 },
      { x: -1.2, y: -0.48 },
      { x: 2.3, y: -0.16 },
      { x: 5.1, y: 0 },
      { x: 2.3, y: 0.16 },
      { x: -1.2, y: 0.48 },
      { x: -4.1, y: 0.82 },
      { x: -7.8, y: 0.82 },
    ];
    const lightCockpit = [
      { x: 3.4, y: -1.02 },
      { x: 5.5, y: -1.36 },
      { x: 7, y: -0.94 },
      { x: 8.1, y: 0 },
      { x: 7, y: 0.94 },
      { x: 5.5, y: 1.36 },
      { x: 3.4, y: 1.02 },
    ];
    plane.lineStyle(isSelected ? 2 : 1, outlineColor, 1);
    plane.fillStyle(0xf2f5f6, 1);
    plane.fillPoints(lightBody, true);
    plane.strokePoints(lightBody, true);
    plane.fillStyle(0xe0e7ea, 1);
    plane.fillPoints(lightCore, true);
    plane.fillStyle(0xd3dde2, 1);
    plane.fillPoints(lightSpine, true);
    plane.fillStyle(0x8eb2c7, 1);
    plane.fillPoints(lightCockpit, true);
    plane.fillStyle(0xd8f0f7, 1);
    plane.fillEllipse(5.9, 0, 2.2, 0.96);
    container.add(plane);
  } else if (type === 'heavy_plane') {
    addShadow(scene, container, 0, 20, 82, 18, 0.14);
    const plane = scene.add.graphics();
    const outlineColor = isSelected ? HIGHLIGHT : OUTLINE;
    const panelLineColor = skinPalette?.glow ?? shade(color, 180);
    const panelAccentColor = skinPalette?.glow ?? shade(color, 105);
    const heavyBody = [
      { x: -16.4, y: -14.4 },
      { x: -7.6, y: -14.4 },
      { x: 0.7, y: -10.8 },
      { x: 9.4, y: -6.2 },
      { x: 17.1, y: -2.7 },
      { x: 20.6, y: 0 },
      { x: 17.1, y: 2.7 },
      { x: 9.4, y: 6.2 },
      { x: 0.7, y: 10.8 },
      { x: -7.6, y: 14.4 },
      { x: -16.4, y: 14.4 },
    ];
    const bomberCockpit = [
      { x: 2.7, y: -2.2 },
      { x: 5.3, y: -2.9 },
      { x: 7.9, y: -2.45 },
      { x: 10.2, y: -1.2 },
      { x: 11.2, y: 0 },
      { x: 10.2, y: 1.2 },
      { x: 7.9, y: 2.45 },
      { x: 5.3, y: 2.9 },
      { x: 2.7, y: 2.2 },
    ];
    plane.lineStyle(isSelected ? 2 : 1, outlineColor, 1);
    plane.fillStyle(0x7b8791, 1);
    plane.fillPoints(heavyBody, true);
    plane.strokePoints(heavyBody, true);
    plane.lineStyle(1.35, panelLineColor, 0.82);
    plane.lineBetween(-13.2, -10.2, -6.8, -5.7);
    plane.lineBetween(-6.8, -5.7, 0.4, -3.05);
    plane.lineBetween(0.4, -3.05, 10.3, -0.95);
    plane.lineBetween(-13.2, 10.2, -6.8, 5.7);
    plane.lineBetween(-6.8, 5.7, 0.4, 3.05);
    plane.lineBetween(0.4, 3.05, 10.3, 0.95);
    plane.lineBetween(-9.8, 0, 10.8, 0);
    plane.lineBetween(-12.5, -12.2, -4.8, -7.2);
    plane.lineBetween(-12.5, 12.2, -4.8, 7.2);
    plane.lineStyle(0.8, panelAccentColor, 0.42);
    plane.lineBetween(-7.6, 0, 8.7, 0);
    plane.lineBetween(-4.2, -2.35, 4.9, -0.8);
    plane.lineBetween(-4.2, 2.35, 4.9, 0.8);
    plane.fillStyle(0x678aa1, 1);
    plane.fillPoints(bomberCockpit, true);
    plane.fillStyle(0xc7e7ef, 1);
    plane.fillEllipse(7.15, 0, 8.2, 3.44);
    container.add(plane);
  } else if (type === 'alien_scout') {
    addShadow(scene, container, 0, 16, 58, 12, 0.13);

    const ship = scene.add.container(0, -2);
    const skinLineColor = skinPalette?.glow ?? 0x5ee6ff;
    const coreColor = skinPalette?.secondary ?? 0xcffcff;
    const hullBase = preserveSkinColor(outline(scene.add.ellipse(0, 0, 42, 18, 0x050910), isSelected, 2));
    const hullMid = outline(scene.add.ellipse(-1, 0, 32, 12, 0x182331), isSelected);
    const cockpit = outline(scene.add.ellipse(4.5, 0, 13, 8.5, 0x2a3e4f), isSelected);
    const cockpitGlass = outline(scene.add.ellipse(7.6, 0, 6.8, 4.1, 0x92cfdf), isSelected);
    const beak = outline(scene.add.triangle(19.6, 0, 0, -4.8, 0, 4.8, 10.2, 0, coreColor), isSelected);
    const dorsalWing = outline(scene.add.polygon(0, -6.2, [-15, 0, -7, -6, 7, -5, 15, 0, 2, 2.2], 0x0f1822, 1), isSelected);
    const ventralWing = outline(scene.add.polygon(0, 6.2, [-15, 0, -7, 6, 7, 5, 15, 0, 2, -2.2], 0x0f1822, 1), isSelected);
    const portProng = outline(scene.add.rectangle(-9.4, -8.2, 8.4, 1.8, 0x1a2834), isSelected);
    const starboardProng = outline(scene.add.rectangle(-9.4, 8.2, 8.4, 1.8, 0x1a2834), isSelected);
    const tailSpine = outline(scene.add.rectangle(-15.6, 0, 8.2, 4.4, 0x111922), isSelected);
    const tailGlowTop = markAuraLine(scene.add.circle(-18.2, -4.2, 4.4, skinLineColor, 0.16));
    const tailGlowBottom = markAuraLine(scene.add.circle(-18.2, 4.2, 4.4, skinLineColor, 0.16));
    tailGlowTop.setBlendMode(Phaser.BlendModes.ADD);
    tailGlowBottom.setBlendMode(Phaser.BlendModes.ADD);
    const tailCoreTop = outline(scene.add.circle(-18.2, -4.2, 1.8, coreColor), isSelected);
    const tailCoreBottom = outline(scene.add.circle(-18.2, 4.2, 1.8, coreColor), isSelected);
    const scanRing = markAuraLine(scene.add.ellipse(-0.8, 0, 22, 10, skinLineColor, 0));
    scanRing.setStrokeStyle(1.55, skinLineColor, 0.82);
    const coreGlow = markAuraLine(scene.add.circle(-0.8, 0, 8.4, skinLineColor, 0.18));
    coreGlow.setBlendMode(Phaser.BlendModes.ADD);
    const core = outline(scene.add.circle(-0.8, 0, 4.3, coreColor), isSelected);
    const spineLine = createAuraLine(scene, -11.8, 0, 12.8, 0, skinLineColor, 0.52, 1.2);
    const topVein = createAuraLine(scene, -9.8, -5.1, 8.4, -1.4, skinLineColor, 0.42, 1);
    const bottomVein = createAuraLine(scene, -9.8, 5.1, 8.4, 1.4, skinLineColor, 0.42, 1);
    const topNode = markAuraLine(scene.add.circle(9.2, -3.4, 1.6, skinLineColor, 0.86));
    const bottomNode = markAuraLine(scene.add.circle(9.2, 3.4, 1.6, skinLineColor, 0.86));

    ship.add([
      hullBase,
      dorsalWing,
      ventralWing,
      hullMid,
      cockpit,
      cockpitGlass,
      beak,
      portProng,
      starboardProng,
      tailSpine,
      tailGlowTop,
      tailGlowBottom,
      tailCoreTop,
      tailCoreBottom,
      scanRing,
      coreGlow,
      spineLine,
      topVein,
      bottomVein,
      topNode,
      bottomNode,
      core,
    ]);

    scene.tweens.add({
      targets: ship,
      y: ship.y - 3,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: [scanRing, coreGlow, core],
      alpha: { from: 0.64, to: 1 },
      scaleX: { from: 0.96, to: 1.08 },
      scaleY: { from: 0.96, to: 1.08 },
      duration: 980,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: [tailGlowTop, tailGlowBottom],
      alpha: { from: 0.08, to: 0.34 },
      scaleX: { from: 0.84, to: 1.14 },
      scaleY: { from: 0.84, to: 1.14 },
      duration: 360,
      yoyo: true,
      repeat: -1,
      delay: 120,
      repeatDelay: 260,
      ease: 'Sine.easeInOut',
    });

    container.add(ship);
  } else if (type === 'heavy_alien') {
    addShadow(scene, container, 0, 18, 92, 18, 0.14);

    const ship = scene.add.container(0, -2);
    const skinLineColor = skinPalette?.glow ?? 0xbf7dff;
    const coreColor = skinPalette?.secondary ?? 0xf0d7ff;
    const hullBase = preserveSkinColor(outline(scene.add.ellipse(0, 0, 72, 28, 0x04070d), isSelected, 2.2));
    const hullShell = outline(scene.add.ellipse(0, 0, 58, 21, 0x141b27), isSelected, 1.8);
    const midPlate = outline(scene.add.ellipse(0, 0, 42, 14, 0x232f3d), isSelected);
    const foreSpine = outline(scene.add.polygon(20, 0, [-8, -5.2, 4, -4.2, 14, 0, 4, 4.2, -8, 5.2], 0x1f2a36, 1), isSelected);
    const portBlade = outline(scene.add.polygon(-18, -9.4, [-10, 0, -2, -5.2, 10, -4.4, 15, 0, 6, 3.6, -4, 4.6], 0x0d151f, 1), isSelected);
    const starboardBlade = outline(scene.add.polygon(-18, 9.4, [-10, 0, -2, 5.2, 10, 4.4, 15, 0, 6, -3.6, -4, -4.6], 0x0d151f, 1), isSelected);
    const tailTop = outline(scene.add.polygon(-28, -6.8, [-7, -1.6, -2.4, -4.6, 6.4, -4, 8.4, 0, 0, 1.9], 0x121a24, 1), isSelected);
    const tailBottom = outline(scene.add.polygon(-28, 6.8, [-7, 1.6, -2.4, 4.6, 6.4, 4, 8.4, 0, 0, -1.9], 0x121a24, 1), isSelected);

    const orbitRing = scene.add.container(0, 0);
    const outerRing = markAuraLine(scene.add.ellipse(0, 0, 52, 18, skinLineColor, 0));
    outerRing.setStrokeStyle(1.9, skinLineColor, 0.74);
    const innerRing = markAuraLine(scene.add.ellipse(0, 0, 32, 10, skinLineColor, 0));
    innerRing.setStrokeStyle(1.5, skinLineColor, 0.58);
    const ringSpine = createAuraLine(scene, -16, 0, 16, 0, skinLineColor, 0.48, 1.1);
    const ringNodes = [
      { x: 0, y: -9 },
      { x: 12, y: -6.2 },
      { x: 12, y: 6.2 },
      { x: 0, y: 9 },
      { x: -12, y: 6.2 },
      { x: -12, y: -6.2 },
    ].flatMap(({ x: nodeX, y: nodeY }) => {
      const halo = markAuraLine(scene.add.circle(nodeX, nodeY, 4.4, skinLineColor, 0.1));
      halo.setBlendMode(Phaser.BlendModes.ADD);
      const node = markAuraLine(scene.add.circle(nodeX, nodeY, 1.9, coreColor, 0.92));
      return [halo, node];
    });
    orbitRing.add([outerRing, innerRing, ringSpine, ...ringNodes]);

    const beamWellGlow = markAuraLine(scene.add.ellipse(18, 0, 15, 9, skinLineColor, 0.18));
    beamWellGlow.setBlendMode(Phaser.BlendModes.ADD);
    const beamWell = outline(scene.add.ellipse(18, 0, 8.2, 5.4, 0x0f1620), isSelected);
    const coreGlow = markAuraLine(scene.add.circle(0, 0, 13, skinLineColor, 0.16));
    coreGlow.setBlendMode(Phaser.BlendModes.ADD);
    const core = outline(scene.add.circle(0, 0, 7.6, coreColor), isSelected);
    const coreShell = outline(scene.add.circle(0, 0, 12, 0x121a24), isSelected, 1.8);
    const axisTop = createAuraLine(scene, -18, -6.2, 18, -2.1, skinLineColor, 0.38, 1.1);
    const axisBottom = createAuraLine(scene, -18, 6.2, 18, 2.1, skinLineColor, 0.38, 1.1);
    const axisMid = createAuraLine(scene, -24, 0, 24, 0, skinLineColor, 0.42, 1.15);

    ship.add([
      hullBase,
      portBlade,
      starboardBlade,
      tailTop,
      tailBottom,
      hullShell,
      midPlate,
      orbitRing,
      beamWellGlow,
      beamWell,
      foreSpine,
      axisTop,
      axisBottom,
      axisMid,
      coreGlow,
      coreShell,
      core,
    ]);

    scene.tweens.add({
      targets: ship,
      y: ship.y - 3.5,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: orbitRing,
      angle: 360,
      duration: 9000,
      repeat: -1,
      ease: 'Linear',
    });
    scene.tweens.add({
      targets: [coreGlow, core, outerRing, innerRing, beamWellGlow],
      alpha: { from: 0.62, to: 1 },
      scaleX: { from: 0.96, to: 1.08 },
      scaleY: { from: 0.96, to: 1.08 },
      duration: 1350,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    ringNodes.forEach((node, index) => {
      scene.tweens.add({
        targets: node,
        alpha: { from: 0.36, to: 1 },
        scaleX: { from: 0.92, to: 1.12 },
        scaleY: { from: 0.92, to: 1.12 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        delay: index * 80,
        repeatDelay: 520,
        ease: 'Sine.easeInOut',
      });
    });

    container.add(ship);
  } else if (type === 'aircraft_carrier') {
    addShadow(scene, container, 0, 18, 170, 28, 0.14);

    const hull = outline(scene.add.rectangle(0, 0, 164, 42, 0x324954), isSelected, 2);
    const flightDeck = outline(scene.add.rectangle(0, 0, 152, 34, 0x5b7584), isSelected);
    const runway = outline(scene.add.rectangle(3, 0, 136, 12, 0x22272c), isSelected);
    const runwayLine = scene.add.rectangle(3, 0, 122, 1.8, 0xdde7ec);
    const deckStripeTop = scene.add.rectangle(3, -10, 126, 1.4, 0xaac0cc);
    const deckStripeBottom = scene.add.rectangle(3, 10, 126, 1.4, 0xaac0cc);
    const sternLanding = outline(scene.add.rectangle(-60, 0, 26, 20, 0x2b3137), isSelected);
    const sternLandingMarkV = scene.add.rectangle(-60, 0, 1.6, 10, 0xe8f1f5);
    const sternLandingMarkH = scene.add.rectangle(-60, 0, 10, 1.6, 0xe8f1f5);
    const islandBase = outline(scene.add.rectangle(31, -11, 18, 12, 0x455862), isSelected);
    const islandTop = outline(scene.add.rectangle(34, -11, 10, 7, 0x738693), isSelected);
    const windows = outline(scene.add.rectangle(36, -11, 8, 2.8, 0x89b7cf), isSelected);
    const radarMast = outline(scene.add.rectangle(28, -18, 1.8, 11, 0x2b353d), isSelected);
    const radarBar = outline(scene.add.rectangle(28, -21.5, 8, 1.3, 0xd6dde1), isSelected);
    const bowLift = outline(scene.add.rectangle(52, 0, 12, 16, 0x6d818d), isSelected);

    scene.tweens.add({ targets: radarBar, angle: 360, duration: 2400, repeat: -1 });

    container.add([
      hull,
      flightDeck,
      runway,
      runwayLine,
      deckStripeTop,
      deckStripeBottom,
      sternLanding,
      sternLandingMarkV,
      sternLandingMarkH,
      islandBase,
      islandTop,
      windows,
      radarMast,
      radarBar,
      bowLift
    ]);
  } else if (type === 'mothership') {
    addShadow(scene, container, 0, 19, 124, 26, 0.12);

    const shipBody = scene.add.container(0, -2);
    const skinLineColor = skinPalette?.glow ?? 0x58d8ff;
    const coreBaseColor = skinPalette?.primary ?? 0x203342;
    const coreAccentColor = skinPalette?.secondary ?? 0xc8fbff;
    const webLines: Phaser.GameObjects.GameObject[] = [];
    const edgeNodes: Phaser.GameObjects.GameObject[] = [];
    const edgeHalos: Phaser.GameObjects.GameObject[] = [];
    const ringParts: Phaser.GameObjects.GameObject[] = [];

    const hull = preserveSkinColor(outline(scene.add.circle(0, 0, 66, 0x05070b), isSelected, 2.5));
    const hullRim = preserveSkinColor(markAuraLine(scene.add.circle(0, 0, 66, 0x05070b, 0)));
    hullRim.setStrokeStyle(2, 0x0f1620, 0.94);
    [18, 34, 50].forEach((radius, index) => {
      const ring = markAuraLine(scene.add.circle(0, 0, radius, skinLineColor, 0));
      ring.setStrokeStyle(index === 0 ? 1.75 : index === 1 ? 1.6 : 1.45, skinLineColor, index === 0 ? 0.8 : index === 1 ? 0.66 : 0.5);
      ringParts.push(ring);
    });

    const createWebLayer = (rotationDeg: number) => {
      const layer = scene.add.container(0, 0);
      layer.setRotation(Phaser.Math.DegToRad(rotationDeg));

      const layerLines = [
        createAuraLine(scene, 0, -14, 0, -50, skinLineColor, 0.88, 1.9),
        createAuraLine(scene, 0, -14, -10, -28, skinLineColor, 0.7, 1.45),
        createAuraLine(scene, 0, -14, 10, -28, skinLineColor, 0.7, 1.45),
        createAuraLine(scene, -10, -28, 0, -34, skinLineColor, 0.44, 1.12),
        createAuraLine(scene, 10, -28, 0, -34, skinLineColor, 0.44, 1.12),
        createAuraLine(scene, -10, -28, -18, -44, skinLineColor, 0.62, 1.28),
        createAuraLine(scene, 10, -28, 18, -44, skinLineColor, 0.62, 1.28),
        createAuraLine(scene, -18, -44, 0, -50, skinLineColor, 0.42, 1.06),
        createAuraLine(scene, 18, -44, 0, -50, skinLineColor, 0.42, 1.06),
        createAuraLine(scene, -10, -28, 10, -28, skinLineColor, 0.32, 0.9),
        createAuraLine(scene, -18, -44, 18, -44, skinLineColor, 0.28, 0.86),
      ];
      webLines.push(...layerLines);

      const nodeHaloTop = markAuraLine(scene.add.circle(0, -50, 5, skinLineColor, 0.14));
      nodeHaloTop.setStrokeStyle(1.15, skinLineColor, 0.34);
      const nodeTop = markAuraLine(scene.add.circle(0, -50, 2.5, skinLineColor, 0.82));
      nodeTop.setStrokeStyle(1.2, coreAccentColor, 0.74);

      const nodeHaloLeft = markAuraLine(scene.add.circle(-18, -44, 4.6, skinLineColor, 0.12));
      nodeHaloLeft.setStrokeStyle(1.05, skinLineColor, 0.3);
      const nodeLeft = markAuraLine(scene.add.circle(-18, -44, 2.2, skinLineColor, 0.78));
      nodeLeft.setStrokeStyle(1.1, coreAccentColor, 0.68);

      const nodeHaloRight = markAuraLine(scene.add.circle(18, -44, 4.6, skinLineColor, 0.12));
      nodeHaloRight.setStrokeStyle(1.05, skinLineColor, 0.3);
      const nodeRight = markAuraLine(scene.add.circle(18, -44, 2.2, skinLineColor, 0.78));
      nodeRight.setStrokeStyle(1.1, coreAccentColor, 0.68);

      edgeHalos.push(nodeHaloTop, nodeHaloLeft, nodeHaloRight);
      edgeNodes.push(nodeTop, nodeLeft, nodeRight);
      layer.add([
        ...layerLines,
        nodeHaloTop,
        nodeTop,
        nodeHaloLeft,
        nodeLeft,
        nodeHaloRight,
        nodeRight,
      ]);

      return layer;
    };

    const webLayers = [0, 90, 180, 270].map((rotation) => createWebLayer(rotation));

    const coreShell = outline(scene.add.circle(0, 0, 19, 0x111723), isSelected, 3);
    const corePlate = outline(scene.add.circle(0, 0, 13.5, coreBaseColor), isSelected, 2);
    const coreOrb = outline(scene.add.circle(0, 0, 8.4, coreAccentColor), isSelected, 1.8);
    const coreHighlight = scene.add.circle(-2.2, -2.8, 2.3, 0xf6ffff, 0.78);
    const coreGlow = markAuraLine(scene.add.circle(0, 0, 11.2, skinLineColor, 0.18));
    coreGlow.setStrokeStyle(1.8, skinLineColor, 0.88);

    const crownTop = createAuraLine(scene, -10, -10, 10, -10, skinLineColor, 0.34, 0.95);
    const crownBottom = createAuraLine(scene, -10, 10, 10, 10, skinLineColor, 0.34, 0.95);
    const crownLeft = createAuraLine(scene, -10, -10, -10, 10, skinLineColor, 0.34, 0.95);
    const crownRight = createAuraLine(scene, 10, -10, 10, 10, skinLineColor, 0.34, 0.95);

    shipBody.add([
      hull,
      hullRim,
      ...ringParts,
      ...webLayers,
      crownTop,
      crownBottom,
      crownLeft,
      crownRight,
      coreGlow,
      coreShell,
      corePlate,
      coreOrb,
      coreHighlight
    ]);

    scene.tweens.add({
      targets: shipBody,
      angle: 360,
      duration: 12000,
      repeat: -1,
      ease: 'Linear'
    });

    scene.tweens.add({
      targets: [coreGlow, coreOrb],
      alpha: { from: 0.72, to: 1 },
      scaleX: { from: 0.96, to: 1.05 },
      scaleY: { from: 0.96, to: 1.05 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    scene.tweens.add({
      targets: [...webLines, ...ringParts],
      alpha: { from: 0.58, to: 0.98 },
      duration: 3400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    edgeNodes.forEach((node, index) => {
      scene.tweens.add({
        targets: node,
        alpha: { from: 0.38, to: 1 },
        scaleX: { from: 0.94, to: 1.12 },
        scaleY: { from: 0.94, to: 1.12 },
        duration: 320,
        yoyo: true,
        repeat: -1,
        delay: index * 120,
        repeatDelay: 1400,
        ease: 'Sine.easeInOut'
      });
    });

    edgeHalos.forEach((halo, index) => {
      scene.tweens.add({
        targets: halo,
        alpha: { from: 0.06, to: 0.24 },
        scaleX: { from: 0.9, to: 1.2 },
        scaleY: { from: 0.9, to: 1.2 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        delay: index * 120,
        repeatDelay: 1300,
        ease: 'Sine.easeInOut'
      });
    });

    container.add(shipBody);
  } else {
    const fallback = outline(scene.add.rectangle(0, 0, 16, 16, accent), isSelected);
    container.add(fallback);
  }

  addUnitDesignLines(scene, container, type, accentLight);
  return container;
}
