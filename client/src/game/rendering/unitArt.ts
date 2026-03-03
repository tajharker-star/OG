import Phaser from 'phaser';

export type RenderableUnitType =
  | 'soldier'
  | 'destroyer'
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
  | 'aircraft_carrier'
  | 'mothership';

export const REDESIGNED_UNIT_TYPES: RenderableUnitType[] = [
  'soldier',
  'tank',
  'humvee',
  'oil_seeker',
  'missile_launcher',
  'destroyer',
  'construction_ship',
  'sniper',
  'rocketeer',
  'ferry',
  'builder',
  'light_plane',
  'heavy_plane'
];

export const UNIT_PREVIEW_LABELS: Record<RenderableUnitType, string> = {
  soldier: 'Soldier',
  destroyer: 'Destroyer',
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
  aircraft_carrier: 'Aircraft Carrier',
  mothership: 'Mothership'
};

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
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 0.18
) {
  const shadow = scene.add.ellipse(x, y, width, height, SHADOW, alpha);
  container.add(shadow);
  return shadow;
}

export function createUnitArt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  type: RenderableUnitType | string,
  color: number,
  isSelected: boolean
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const accent = color;
  const accentLight = tint(color, 35);
  const accentDark = shade(color, 45);

  if (type === 'soldier') {
    addShadow(scene, container, 0, 11, 18, 8);

    const cape = outline(scene.add.triangle(-6, -1, -4, -8, -7, 9, 2, 4, shade(accent, 30), 0.95), isSelected);
    const leftLeg = outline(scene.add.rectangle(-3, 10, 4, 8, 0x374d34), isSelected);
    const rightLeg = outline(scene.add.rectangle(2.5, 10, 4, 8, 0x415e3c), isSelected);
    const torso = outline(scene.add.rectangle(0, 0, 12, 13, 0x56704f), isSelected);
    const plate = outline(scene.add.rectangle(1, 0, 7, 8, accentDark), isSelected);
    const armRear = outline(scene.add.rectangle(-5, 1, 3, 10, 0x3f5640), isSelected);
    const armFront = outline(scene.add.rectangle(6, 1, 3, 9, 0x627d54), isSelected);
    const pack = outline(scene.add.rectangle(-6.5, 0, 4, 8, 0x7b6f55), isSelected);
    const rifleStock = outline(scene.add.rectangle(5, 2, 8, 2.6, 0x4c3727), isSelected);
    const rifleBarrel = outline(scene.add.rectangle(13, 2, 10, 1.8, 0x20282f), isSelected);
    const muzzle = outline(scene.add.rectangle(18, 2, 2, 3, accentLight), isSelected);
    const head = outline(scene.add.circle(0, -9, 4.8, 0xf2c49a), isSelected);
    const helmet = outline(scene.add.arc(0, -10, 6, 180, 360, false, 0x314632), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const visor = outline(scene.add.rectangle(2, -10, 7, 2, accentLight), isSelected);

    container.add([
      cape,
      leftLeg,
      rightLeg,
      pack,
      torso,
      plate,
      armRear,
      armFront,
      rifleStock,
      rifleBarrel,
      muzzle,
      head,
      helmet,
      visor
    ]);
  } else if (type === 'tank') {
    addShadow(scene, container, -1, 12, 28, 10);

    const treadRear = outline(scene.add.rectangle(-1, 8.5, 28, 6, 0x161b1f), isSelected);
    const treadFront = outline(scene.add.rectangle(-1, -8.5, 28, 6, 0x1b2127), isSelected);
    const hull = outline(scene.add.polygon(
      0,
      0,
      [-14, -7, 7, -9, 14, -3, 14, 3, 7, 9, -14, 7],
      0x526246,
      1
    ), isSelected);
    const hullTop = outline(scene.add.polygon(
      0,
      -1,
      [-10, -5, 5, -6, 11, -1, 11, 1, 5, 6, -10, 5],
      0x6a7a57,
      1
    ), isSelected);
    const accentPanel = outline(scene.add.rectangle(-3, 0, 8, 5, accentDark), isSelected);
    const turret = outline(scene.add.ellipse(1, 0, 16, 12, 0x3c4934), isSelected);
    const hatch = outline(scene.add.circle(-2, -1, 2.3, accentLight), isSelected);
    const barrel = outline(scene.add.rectangle(14, 0, 16, 3, 0x293125), isSelected);
    const muzzle = outline(scene.add.rectangle(21, 0, 3, 4, 0xb0bbc3), isSelected);

    [-10, -3, 4, 11].forEach((wheelX) => {
      container.add(outline(scene.add.circle(wheelX, 8.5, 1.6, 0x5f666b), isSelected));
      container.add(outline(scene.add.circle(wheelX, -8.5, 1.6, 0x5f666b), isSelected));
    });

    container.add([treadRear, treadFront, hull, hullTop, accentPanel, barrel, muzzle, turret, hatch]);
  } else if (type === 'humvee') {
    addShadow(scene, container, 0, 11, 24, 9);

    const wheels = [
      scene.add.circle(-8, -7, 3, 0x181a1d),
      scene.add.circle(6, -7, 3, 0x181a1d),
      scene.add.circle(-8, 7, 3, 0x181a1d),
      scene.add.circle(6, 7, 3, 0x181a1d)
    ];
    wheels.forEach((wheel) => container.add(outline(wheel, isSelected)));

    const body = outline(scene.add.polygon(
      0,
      0,
      [-13, -6, 7, -7, 12, -2, 12, 6, -13, 6],
      0xbca780,
      1
    ), isSelected);
    const chassisRail = outline(scene.add.rectangle(-1, 5.5, 23, 3, 0x5f5240), isSelected);
    const hood = outline(scene.add.polygon(
      5,
      -0.5,
      [-4, -4, 3, -4, 5, -1, 5, 4, -4, 4],
      0xcab68f,
      1
    ), isSelected);
    const roof = outline(scene.add.rectangle(-1, -1, 14, 7, 0xd5c6a3), isSelected);
    const door = outline(scene.add.rectangle(-4, 0, 7, 7, accentDark), isSelected);
    const windshield = outline(scene.add.polygon(
      4,
      -1,
      [-2, -4, 3, -4, 5, 0, 3, 4, -2, 4],
      0x89bdd6,
      1
    ), isSelected);
    const rearWindow = outline(scene.add.rectangle(-10, 0, 3, 6, 0x6d96ad), isSelected);
    const rearBumper = outline(scene.add.rectangle(-12.5, 0, 2, 9, 0x4f4637), isSelected);
    const frontGuard = outline(scene.add.rectangle(12.5, 0, 2, 9, 0x4f4637), isSelected);
    const wheelHubRear = outline(scene.add.rectangle(-8, 0, 2, 14, 0x45484c), isSelected);
    const wheelHubFront = outline(scene.add.rectangle(6, 0, 2, 14, 0x45484c), isSelected);
    const turretPost = outline(scene.add.rectangle(-1, -4.5, 2.4, 7, 0x444a50), isSelected);
    const turretRing = outline(scene.add.circle(-1, -1, 3.5, 0x50565c), isSelected);
    const mgBody = outline(scene.add.rectangle(5, -4.5, 9, 2.2, 0x2a3137), isSelected);
    const mgTip = outline(scene.add.rectangle(10.5, -4.5, 3, 3, accentLight), isSelected);
    const rack = outline(scene.add.rectangle(-11, 0, 2, 10, accent), isSelected);
    const rackBrace = outline(scene.add.rectangle(-9.4, 0, 2.4, 8, 0x726450), isSelected);

    container.add([
      body,
      chassisRail,
      hood,
      roof,
      door,
      windshield,
      rearWindow,
      rearBumper,
      frontGuard,
      wheelHubRear,
      wheelHubFront,
      turretPost,
      turretRing,
      mgBody,
      mgTip,
      rackBrace,
      rack
    ]);
  } else if (type === 'oil_seeker') {
    addShadow(scene, container, 0, 10, 22, 8);

    const body = outline(scene.add.polygon(
      0,
      0,
      [-10, -5, 6, -6, 11, -1, 11, 5, -10, 5],
      0xc28e26,
      1
    ), isSelected);
    const wheelFrame = outline(scene.add.rectangle(0, 0, 17, 9, 0x7d5d1e), isSelected);
    const chassisRail = outline(scene.add.rectangle(0, 5.6, 19, 2.6, 0x5d4314), isSelected);
    const canopy = outline(scene.add.ellipse(-1, -1, 7, 6, 0x5e8391), isSelected);
    const roofHatch = outline(scene.add.rectangle(-2, -4.2, 5, 2.2, 0x8a661d), isSelected);
    const sensorBase = outline(scene.add.rectangle(-1, -6, 5.5, 4, 0x4d565d), isSelected);
    const mast = outline(scene.add.rectangle(-1, -11, 2, 7, 0x22292e), isSelected);
    const dishMount = outline(scene.add.line(-1, -10, 0, 0, 3, -2, 0x2a3137), isSelected);
    const dish = outline(scene.add.ellipse(2.5, -12, 10, 4.8, accentLight), isSelected);
    const noseStripe = outline(scene.add.rectangle(7.5, 0, 4, 7, accent), isSelected);
    const cargo = outline(scene.add.rectangle(-8, 0, 4.5, 6.5, 0x6e5d39), isSelected);
    const cargoBrace = outline(scene.add.rectangle(-8, 0, 1.5, 8, 0x4d3d22), isSelected);

    const wheels = [
      scene.add.circle(-7, -6, 2.8, 0x161a1c),
      scene.add.circle(6, -6, 2.8, 0x161a1c),
      scene.add.circle(-7, 6, 2.8, 0x161a1c),
      scene.add.circle(6, 6, 2.8, 0x161a1c)
    ];
    wheels.forEach((wheel) => container.add(outline(wheel, isSelected)));
    [-7, 6].forEach((wheelX) => {
      container.add(outline(scene.add.circle(wheelX, -6, 1.2, 0x5c646b), isSelected));
      container.add(outline(scene.add.circle(wheelX, 6, 1.2, 0x5c646b), isSelected));
    });

    scene.tweens.add({
      targets: dish,
      angle: { from: -35, to: 35 },
      duration: 1400,
      yoyo: true,
      repeat: -1
    });

    container.add([body, wheelFrame, chassisRail, canopy, roofHatch, cargo, cargoBrace, noseStripe, sensorBase, mast, dishMount, dish]);
  } else if (type === 'missile_launcher') {
    addShadow(scene, container, 0, 12, 30, 9);

    const chassis = outline(scene.add.polygon(
      0,
      1,
      [-15, -5, 7, -6, 14, -1, 14, 7, -15, 7],
      0x4c5d35,
      1
    ), isSelected);
    const bed = outline(scene.add.rectangle(-3, 0.5, 19, 7, 0x61734a), isSelected);
    const cab = outline(scene.add.polygon(
      8,
      -3,
      [-3, -3, 2, -5, 4, -1, 4, 3, -3, 3],
      0x3a452d,
      1
    ), isSelected);
    const windshield = outline(scene.add.rectangle(9, -3, 3, 5, 0x7eb1c8), isSelected);
    const rack = outline(scene.add.polygon(
      -2,
      -4,
      [-9, -3, 6, -6, 8, -2, -7, 1],
      0x303b43,
      1
    ), isSelected);
    const pivot = outline(scene.add.rectangle(-6, -1.5, 3.5, 7, 0x21272d), isSelected);
    const brace = outline(scene.add.rectangle(-4, 0, 9, 3, 0x21272d), isSelected);
    const rackBrace = outline(scene.add.line(-3, -1, 0, 0, 4, -6, 0x192026), isSelected);
    const signal = outline(scene.add.circle(11, -6.8, 2.1, accentLight), isSelected);

    const missiles = [
      scene.add.rectangle(1, -8, 9, 1.7, 0xb8c3cb),
      scene.add.rectangle(-1, -5.2, 9, 1.7, 0xb8c3cb),
      scene.add.rectangle(-3, -2.4, 9, 1.7, 0xb8c3cb)
    ];
    missiles.forEach((missile, index) => {
      missile.setRotation(-0.18);
      container.add(outline(missile, isSelected));
      container.add(outline(scene.add.triangle(5 - index * 2, -8 + index * 2.8, 0, -1.2, 0, 1.2, 2.4, 0, accent), isSelected));
    });

    [-9, -1, 7].forEach((wheelX) => {
      container.add(outline(scene.add.circle(wheelX, -7, 2.2, 0x13171a), isSelected));
      container.add(outline(scene.add.circle(wheelX, 7, 2.2, 0x13171a), isSelected));
      container.add(outline(scene.add.circle(wheelX, -7, 0.95, 0x596066), isSelected));
      container.add(outline(scene.add.circle(wheelX, 7, 0.95, 0x596066), isSelected));
    });

    scene.tweens.add({
      targets: signal,
      alpha: { from: 0.25, to: 1 },
      duration: 700,
      yoyo: true,
      repeat: -1
    });

    container.add([chassis, bed, cab, windshield, pivot, brace, rackBrace, rack, signal]);
  } else if (type === 'destroyer') {
    addShadow(scene, container, -2, 12, 38, 10, 0.14);

    const wake = scene.add.polygon(-15, 0, [0, 0, -9, -5, -16, 0, -9, 5], 0xdceef6, 0.55);
    const hull = outline(scene.add.polygon(
      0,
      0,
      [-16, -6, 5, -6, 16, -2, 18, 0, 16, 2, 5, 6, -16, 6],
      0x52677b,
      1
    ), isSelected);
    const deck = outline(scene.add.polygon(
      0,
      0,
      [-12, -4, 5, -4, 13, -1, 13, 1, 5, 4, -12, 4],
      0x73879a,
      1
    ), isSelected);
    const superstructureBase = outline(scene.add.rectangle(-1, -2, 14, 5, 0x607487), isSelected);
    const stripe = outline(scene.add.rectangle(-1, 0, 18, 1.8, accentLight), isSelected);
    const bridge = outline(scene.add.polygon(
      -2,
      -5,
      [-4, -1, 2, -3, 6, -1, 6, 4, -4, 4],
      0xc9d4dc,
      1
    ), isSelected);
    const bridgeWindow = outline(scene.add.rectangle(0, -4.5, 6, 2, 0x6fa2c0), isSelected);
    const turretFront = outline(scene.add.circle(6, 0, 3.2, 0x2b333b), isSelected);
    const barrelFront = outline(scene.add.rectangle(14, 0, 8, 2, 0x1f252b), isSelected);
    const turretRear = outline(scene.add.circle(-6, 0, 2.8, 0x313942), isSelected);
    const barrelRear = outline(scene.add.rectangle(-1, 0, 7, 1.8, 0x23292f), isSelected);
    const radarStem = outline(scene.add.rectangle(-3, -9, 1.5, 4, 0x1e2429), isSelected);
    const radar = outline(scene.add.rectangle(-2, -11, 7, 2, accent), isSelected);
    const mastBraceFront = outline(scene.add.line(-3, -8, 0, 0, 4, 5, 0x24303a), isSelected);
    const mastBraceRear = outline(scene.add.line(-3, -8, 0, 0, -4, 5, 0x24303a), isSelected);
    const sternDeck = outline(scene.add.rectangle(-11, 0, 4, 6, 0x465a6e), isSelected);

    scene.tweens.add({
      targets: radar,
      angle: { from: -20, to: 20 },
      duration: 1200,
      yoyo: true,
      repeat: -1
    });

    container.add([
      wake,
      hull,
      deck,
      superstructureBase,
      stripe,
      bridge,
      bridgeWindow,
      sternDeck,
      barrelRear,
      turretRear,
      barrelFront,
      turretFront,
      mastBraceFront,
      mastBraceRear,
      radarStem,
      radar
    ]);
  } else if (type === 'construction_ship') {
    addShadow(scene, container, -1, 12, 40, 10, 0.14);

    const hull = outline(scene.add.polygon(
      0,
      0,
      [-17, -6, 10, -6, 17, -2, 19, 0, 17, 2, 10, 6, -17, 6],
      0x5b6674,
      1
    ), isSelected);
    const deck = outline(scene.add.rectangle(-1, 0, 28, 8, 0x8d99a7), isSelected);
    const cargoBed = outline(scene.add.rectangle(2, 2.5, 14, 7, 0x7d8794), isSelected);
    const cabin = outline(scene.add.polygon(
      -9,
      -4,
      [-4, -2, 2, -3, 4, -1, 4, 4, -4, 4],
      0xe4e9ed,
      1
    ), isSelected);
    const window = outline(scene.add.rectangle(-8, -4.5, 5, 2.5, 0x7fb7d4), isSelected);
    const cargoA = outline(scene.add.rectangle(-1, 3.5, 5, 4, 0x875837), isSelected);
    const cargoB = outline(scene.add.rectangle(4, 3.5, 5, 4, 0xa36d42), isSelected);
    const craneBase = outline(scene.add.circle(7, -1, 4.2, 0x293239), isSelected);
    const craneMast = outline(scene.add.rectangle(9, -4, 3, 10, 0x4a545c), isSelected);
    const craneArm = outline(scene.add.rectangle(15, -5, 16, 3, 0xf7a11a), isSelected);
    craneArm.setRotation(-0.35);
    const craneBrace = outline(scene.add.line(10, -4, 0, 0, 5, 6, 0x20262c), isSelected);
    const craneCable = outline(scene.add.line(0, 0, 20, -8, 21, 2, 0x12181d), isSelected);
    const hook = outline(scene.add.rectangle(21, 2.5, 2.5, 3, accentLight), isSelected);

    container.add([hull, deck, cargoBed, cabin, window, cargoA, cargoB, craneBase, craneMast, craneArm, craneBrace, craneCable, hook]);
  } else if (type === 'sniper') {
    addShadow(scene, container, 0, 11, 18, 7);

    const cloak = outline(scene.add.polygon(
      -2,
      1,
      [-9, -6, 1, -7, 6, -1, 5, 9, -7, 8],
      0x46513c,
      1
    ), isSelected);
    const shoulder = outline(scene.add.rectangle(1, -1, 12, 7, accentDark), isSelected);
    const leftLeg = outline(scene.add.rectangle(-3, 10, 4, 8, 0x3b4737), isSelected);
    const rightLeg = outline(scene.add.rectangle(2, 10, 4, 8, 0x455642), isSelected);
    const armRear = outline(scene.add.rectangle(-5, 1, 3, 7, 0x56604d), isSelected);
    const armFront = outline(scene.add.rectangle(7, 1, 3, 7, 0x67725b), isSelected);
    const rifleStock = outline(scene.add.rectangle(5, 1, 10, 2.5, 0x4e3827), isSelected);
    const rifleBody = outline(scene.add.rectangle(14, 1, 14, 1.8, 0x141a1f), isSelected);
    const scope = outline(scene.add.rectangle(9, -1.8, 7, 2, accentLight), isSelected);
    const muzzle = outline(scene.add.rectangle(21, 1, 2, 2.8, 0xc8d0d5), isSelected);
    const head = outline(scene.add.circle(0, -8.5, 4.6, 0xf0c39f), isSelected);
    const hood = outline(scene.add.arc(0, -9.5, 6.4, 180, 360, false, 0x55614d), isSelected);
    (hood as Phaser.GameObjects.Arc).setClosePath(true);

    container.add([
      cloak,
      leftLeg,
      rightLeg,
      shoulder,
      armRear,
      armFront,
      rifleStock,
      rifleBody,
      scope,
      muzzle,
      head,
      hood
    ]);
  } else if (type === 'rocketeer') {
    addShadow(scene, container, 0, 11, 20, 8);

    const backTube = outline(scene.add.rectangle(-6, -2, 5, 13, 0x2d373d), isSelected);
    const leftLeg = outline(scene.add.rectangle(-4, 10, 5, 8, 0x384349), isSelected);
    const rightLeg = outline(scene.add.rectangle(2, 10, 5, 8, 0x45515a), isSelected);
    const torso = outline(scene.add.rectangle(0, 0, 14, 14, 0x6e7b84), isSelected);
    const chest = outline(scene.add.rectangle(0, 0, 9, 8, accentDark), isSelected);
    const armRear = outline(scene.add.rectangle(-7, 1, 4, 9, 0x55636c), isSelected);
    const armFront = outline(scene.add.rectangle(7, 0, 4, 8, 0x7a8790), isSelected);
    const launcher = outline(scene.add.rectangle(8, -4, 18, 6, 0x334d2d), isSelected);
    const grip = outline(scene.add.rectangle(2, -1, 2, 4, 0x151b20), isSelected);
    const sight = outline(scene.add.rectangle(8, -8, 4, 2, accentLight), isSelected);
    const rocketTip = outline(scene.add.triangle(16, -4, 0, -3, 0, 3, 5, 0, accent), isSelected);
    const head = outline(scene.add.circle(0, -10, 4.8, 0xf0c39f), isSelected);
    const helmet = outline(scene.add.arc(0, -10.5, 6.4, 180, 360, false, 0x364047), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const visor = outline(scene.add.rectangle(1, -10, 7, 2, accentLight), isSelected);

    container.add([
      backTube,
      leftLeg,
      rightLeg,
      torso,
      chest,
      armRear,
      armFront,
      launcher,
      grip,
      sight,
      rocketTip,
      head,
      helmet,
      visor
    ]);
  } else if (type === 'ferry') {
    addShadow(scene, container, 0, 12, 36, 11, 0.14);

    const wake = scene.add.polygon(-14, 0, [0, 0, -8, -5, -15, 0, -8, 5], 0xe1eff7, 0.48);
    const hull = outline(scene.add.polygon(
      0,
      0,
      [-15, -8, 12, -8, 17, -3, 17, 3, 12, 8, -15, 8],
      0x6d7d8a,
      1
    ), isSelected);
    const deck = outline(scene.add.rectangle(2, 0, 23, 12, 0x929ea7), isSelected);
    const cargoWell = outline(scene.add.rectangle(3, 0, 17, 9, 0xaab3ba), isSelected);
    const ramp = outline(scene.add.polygon(16, 0, [-3, -7, 3, -5, 3, 5, -3, 7], 0x3f464c), isSelected);
    const bridge = outline(scene.add.polygon(
      -10,
      -1,
      [-4, -5, 3, -4, 5, 0, 5, 5, -4, 5],
      0xf2f4f5,
      1
    ), isSelected);
    const windows = outline(scene.add.rectangle(-9, -1.5, 6, 3, 0x6ea8c7), isSelected);
    const stripe = outline(scene.add.rectangle(1, 0, 24, 1.8, accent), isSelected);
    const railTop = outline(scene.add.rectangle(3, -5, 18, 1.6, 0xf1f5f8), isSelected);
    const railBottom = outline(scene.add.rectangle(3, 5, 18, 1.6, 0xf1f5f8), isSelected);
    const cargoA = outline(scene.add.rectangle(-1, -3.5, 7, 4.5, 0x537868), isSelected);
    const cargoB = outline(scene.add.rectangle(7, 3.5, 6, 4, 0xbc8d4a), isSelected);

    container.add([wake, hull, deck, cargoWell, stripe, ramp, bridge, windows, railTop, railBottom, cargoA, cargoB]);
  } else if (type === 'builder') {
    addShadow(scene, container, 0, 11, 18, 7);

    const leftLeg = outline(scene.add.rectangle(-3.5, 10, 4, 8, 0x25355e), isSelected);
    const rightLeg = outline(scene.add.rectangle(2.5, 10, 4, 8, 0x345089), isSelected);
    const torso = outline(scene.add.rectangle(0, 0, 12, 13, 0x2779c6), isSelected);
    const vestLeft = outline(scene.add.rectangle(-2.5, 0, 3, 11, 0xf57c25), isSelected);
    const vestRight = outline(scene.add.rectangle(2.5, 0, 3, 11, 0xf57c25), isSelected);
    const vestBand = outline(scene.add.rectangle(0, 2, 11, 2, accentLight), isSelected);
    const belt = outline(scene.add.rectangle(0, 5.5, 12, 2.2, 0x6a4a2a), isSelected);
    const head = outline(scene.add.circle(0, -8.5, 4.8, 0xf1c39c), isSelected);
    const helmet = outline(scene.add.arc(0, -9.5, 6.4, 180, 360, false, 0xf5cc27), isSelected);
    (helmet as Phaser.GameObjects.Arc).setClosePath(true);
    const stripe = outline(scene.add.rectangle(0, -10.5, 2, 4, accent), isSelected);
    const armRear = outline(scene.add.rectangle(-6.5, 1, 3, 8, 0x4a7db8), isSelected);
    const armFront = outline(scene.add.rectangle(6.5, 0, 3, 8, 0x5a8fcc), isSelected);
    const wrenchHandle = outline(scene.add.rectangle(11, -4, 3, 10, 0xc7cfd6), isSelected);
    wrenchHandle.setRotation(-0.5);
    const wrenchHead = outline(scene.add.rectangle(13, -8, 6, 4, 0xe6eef3), isSelected);
    wrenchHead.setRotation(-0.5);
    const toolbox = outline(scene.add.rectangle(-12, 4, 8, 6, 0xe24936), isSelected);
    const handle = outline(scene.add.rectangle(-12, 0, 4, 2, 0x242b31), isSelected);

    container.add([
      leftLeg,
      rightLeg,
      torso,
      vestLeft,
      vestRight,
      vestBand,
      belt,
      armRear,
      armFront,
      wrenchHandle,
      wrenchHead,
      toolbox,
      handle,
      head,
      helmet,
      stripe
    ]);
  } else if (type === 'light_plane') {
    addShadow(scene, container, -5, 18, 34, 11, 0.12);

    const airframe = outline(scene.add.polygon(
      0,
      0,
      [-16, 0, -10, -4, -4, -11, 8, -7, 19, 0, 8, 7, -4, 11, -10, 4],
      0xd4dde4,
      1
    ), isSelected);
    const fuselage = outline(scene.add.polygon(
      0,
      0,
      [-13, -2, -5, -4, 4, -4, 12, 0, 4, 4, -5, 4, -13, 2],
      0xe8eef3,
      1
    ), isSelected);
    const wingRoot = outline(scene.add.polygon(
      -2,
      0,
      [-7, -4, 3, -6, 8, 0, 3, 6, -7, 4, -10, 0],
      0xc4ced8,
      1
    ), isSelected);
    const cockpit = outline(scene.add.polygon(
      5,
      0,
      [-2, -3, 4, -2, 6, 0, 4, 2, -2, 3, -4, 0],
      0x72aaca,
      1
    ), isSelected);
    const canopyShine = outline(scene.add.rectangle(7, -0.2, 4, 1.3, 0xb8e3f6), isSelected);
    const panelLeft = outline(scene.add.polygon(-4, -5, [-8, 0, 4, -3, 5, -0.5, -2, 2], accentDark, 1), isSelected);
    const panelRight = outline(scene.add.polygon(-4, 5, [-8, 0, 5, 0.5, 4, 3, -2, -2], accentDark, 1), isSelected);
    const tailBridge = outline(scene.add.rectangle(-10, 0, 6, 5, 0x6b7681), isSelected);
    const finTop = outline(scene.add.triangle(-11, -4.5, -5, 4, 0, 0, -7, -7, 0x5d6974), isSelected);
    const finBottom = outline(scene.add.triangle(-11, 4.5, -5, -4, 0, 0, -7, 7, 0x5d6974), isSelected);
    const exhaustHousing = outline(scene.add.rectangle(-14, 0, 4, 6, 0x49535f), isSelected);
    const nose = outline(scene.add.triangle(18, 0, 0, -3.5, 0, 3.5, 7, 0, accent), isSelected);
    const engineGlow = outline(scene.add.ellipse(-14, 0, 5, 3.2, accentLight), isSelected);

    scene.tweens.add({
      targets: engineGlow,
      alpha: { from: 0.3, to: 0.95 },
      scale: { from: 0.9, to: 1.18 },
      duration: 260,
      yoyo: true,
      repeat: -1
    });

    container.add([
      airframe,
      panelLeft,
      panelRight,
      fuselage,
      wingRoot,
      tailBridge,
      exhaustHousing,
      finTop,
      finBottom,
      cockpit,
      canopyShine,
      nose,
      engineGlow
    ]);
  } else if (type === 'heavy_plane') {
    addShadow(scene, container, -8, 22, 44, 15, 0.14);

    const wingBody = outline(scene.add.polygon(
      0,
      0,
      [-22, 0, -14, -5, -7, -16, 8, -12, 24, 0, 8, 12, -7, 16, -14, 5],
      0x434a53,
      1
    ), isSelected);
    const spine = outline(scene.add.polygon(
      2,
      0,
      [-15, -2, -7, -5, 1, -6, 12, 0, 1, 6, -7, 5, -15, 2],
      0x5f6873,
      1
    ), isSelected);
    const innerWing = outline(scene.add.polygon(
      -2,
      0,
      [-14, 0, -8, -5, 0, -11, 9, -8, 16, 0, 9, 8, 0, 11, -8, 5],
      0x59626d,
      1
    ), isSelected);
    const cockpit = outline(scene.add.polygon(
      7,
      0,
      [-3, -4, 4, -3, 7, 0, 4, 3, -3, 4, -6, 0],
      0x648da8,
      1
    ), isSelected);
    const cockpitShine = outline(scene.add.rectangle(9, -0.4, 4.5, 1.5, 0xa7d9ef), isSelected);
    const bay = outline(scene.add.polygon(
      -2,
      0,
      [-6, -2, 6, -3, 10, 0, 6, 3, -6, 2, -10, 0],
      0x20262c,
      1
    ), isSelected);
    const topFacet = outline(scene.add.polygon(-2, -6, [-8, 0, 7, -1, 10, 2, 0, 4], accentDark, 1), isSelected);
    const bottomFacet = outline(scene.add.polygon(-2, 6, [-8, 0, 10, -2, 7, 1, 0, -4], accentDark, 1), isSelected);
    const enginePodTop = outline(scene.add.polygon(
      -14,
      -4,
      [-5, -2, 2, -2, 5, 0, 2, 2, -5, 2, -7, 0],
      0x313841,
      1
    ), isSelected);
    const enginePodBottom = outline(scene.add.polygon(
      -14,
      4,
      [-5, -2, 2, -2, 5, 0, 2, 2, -5, 2, -7, 0],
      0x313841,
      1
    ), isSelected);
    const intakeTop = outline(scene.add.rectangle(-13, -4, 5.5, 1.8, 0x1b2025), isSelected);
    const intakeBottom = outline(scene.add.rectangle(-13, 4, 5.5, 1.8, 0x1b2025), isSelected);
    const exhaustTop = outline(scene.add.ellipse(-19, -4, 5, 2.5, accentLight), isSelected);
    const exhaustBottom = outline(scene.add.ellipse(-19, 4, 5, 2.5, accentLight), isSelected);
    const tailSpine = outline(scene.add.rectangle(-16, 0, 5, 7, 0x4e5660), isSelected);
    const nose = outline(scene.add.triangle(22, 0, 0, -4.5, 0, 4.5, 8, 0, accent), isSelected);

    [exhaustTop, exhaustBottom].forEach((glow, index) => {
      scene.tweens.add({
        targets: glow,
        alpha: { from: 0.25, to: 0.9 },
        scale: { from: 0.9, to: 1.2 },
        duration: 320,
        yoyo: true,
        repeat: -1,
        delay: index * 110
      });
    });

    container.add([
      wingBody,
      topFacet,
      bottomFacet,
      tailSpine,
      spine,
      innerWing,
      enginePodTop,
      enginePodBottom,
      intakeTop,
      intakeBottom,
      bay,
      cockpit,
      cockpitShine,
      nose,
      exhaustTop,
      exhaustBottom
    ]);
  } else if (type === 'aircraft_carrier') {
    const hull = outline(scene.add.rectangle(0, 0, 180, 70, 0x2f4f4f), isSelected, 2);
    const deck = outline(scene.add.rectangle(0, 0, 170, 60, 0x4682b4), isSelected);
    const runway1 = outline(scene.add.rectangle(0, -15, 160, 10, 0x222222), isSelected);
    const line1 = scene.add.rectangle(0, -15, 150, 2, 0xffffff);
    const runway2 = outline(scene.add.rectangle(0, 15, 160, 10, 0x222222), isSelected);
    const line2 = scene.add.rectangle(0, 15, 150, 2, 0xffffff);
    const padH = outline(scene.add.circle(-70, 0, 10, 0x222222), isSelected);
    const padHText = scene.add.text(-75, -5, 'H', { fontSize: '10px', color: '#FFFF00', fontFamily: 'Arial' });
    const towerBase = outline(scene.add.rectangle(40, -40, 30, 15, 0x2f4f4f), isSelected);
    const towerTop = outline(scene.add.rectangle(40, -40, 20, 10, 0x555555), isSelected);
    const windows = outline(scene.add.rectangle(40, -40, 18, 6, 0x87ceeb), isSelected);
    const radar1 = outline(scene.add.rectangle(35, -50, 8, 2, 0xcccccc), isSelected);
    const radar2 = outline(scene.add.rectangle(45, -50, 10, 3, 0xcccccc), isSelected);

    scene.tweens.add({ targets: radar1, angle: 360, duration: 2000, repeat: -1 });
    scene.tweens.add({ targets: radar2, angle: -360, duration: 3000, repeat: -1 });

    container.add([hull, deck, runway1, line1, runway2, line2, padH, padHText, towerBase, towerTop, windows, radar1, radar2]);
  } else if (type === 'mothership') {
    const shipBody = scene.add.container(0, 0);
    const hull = outline(scene.add.circle(0, 0, 80, 0x222222), isSelected, 3);
    hull.setStrokeStyle(isSelected ? 4 : 3, isSelected ? HIGHLIGHT : 0x00ffff);
    shipBody.add(hull);

    const graphics = scene.add.graphics();
    graphics.lineStyle(2, 0x00aaaa, 0.8);
    graphics.strokeCircle(0, 0, 60);
    graphics.strokeCircle(0, 0, 40);
    for (let i = 0; i < 8; i++) {
      const angle = Phaser.Math.DegToRad(i * 45);
      const startX = Math.cos(angle) * 20;
      const startY = Math.sin(angle) * 20;
      const endX = Math.cos(angle) * 75;
      const endY = Math.sin(angle) * 75;
      graphics.moveTo(startX, startY);
      graphics.lineTo(endX, endY);
    }
    graphics.strokePath();
    shipBody.add(graphics);

    const orb = scene.add.circle(0, 0, 15, 0x00ffff);
    scene.tweens.add({
      targets: orb,
      alpha: { from: 1, to: 0.6 },
      scale: { from: 1, to: 1.3 },
      duration: 1200,
      yoyo: true,
      repeat: -1
    });
    shipBody.add(orb);

    scene.tweens.add({
      targets: shipBody,
      angle: 360,
      duration: 12000,
      repeat: -1,
      ease: 'Linear'
    });

    container.add(shipBody);
  } else {
    const fallback = outline(scene.add.rectangle(0, 0, 16, 16, accent), isSelected);
    container.add(fallback);
  }

  return container;
}
