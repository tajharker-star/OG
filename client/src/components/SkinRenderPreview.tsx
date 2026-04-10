import React, { useEffect, useMemo, useRef, useState } from 'react';
import Phaser from 'phaser';
import type { Building } from '../types/game';
import { applySkinToArtContainer } from '../game/rendering/skinEffects';
import { BUILDING_PREVIEW_LABELS, createBuildingArt } from '../game/rendering/buildingArt';
import { REDESIGNED_UNIT_TYPES, UNIT_PREVIEW_LABELS, createUnitArt, getUnitArtScale, getUnitWeaponMuzzleOffset, resolveUnitFacingTransform, type RenderableUnitType } from '../game/rendering/unitArt';
import { SKIN_DEFINITIONS_BY_ID, type SkinId } from '../utils/playerSkins';

interface SkinRenderPreviewProps {
    skinId: SkinId;
}

type BuildingType = Building['type'];
type PreviewHabitat = 'land' | 'water';
type PreviewAttackStyle = 'support' | 'bullet' | 'sniper' | 'shell' | 'rocket' | 'missile' | 'bomb' | 'beam';
type EnvironmentMode = 'land' | 'water' | 'shore' | 'gold' | 'grass' | 'oil_land' | 'oil_water' | 'bridge';
type StageMode = 'unitCombat' | 'unitRepair' | 'unitRadar' | 'unitTransport' | 'buildingAttack' | 'buildingHeal' | 'buildingEconomy' | 'buildingRecruit' | 'buildingSupport';
type RecruitableUnitId = RenderableUnitType;
type PreviewSelection =
    | { kind: 'unit'; type: RenderableUnitType }
    | { kind: 'building'; type: BuildingType };

type UnitPreviewConfig = {
    health: number;
    damage: number;
    speed: number;
    range: number;
    fireRateMs: number;
    habitat: PreviewHabitat;
    attackStyle: PreviewAttackStyle;
    combat: boolean;
    detail: string;
    costGold: number;
    costOil: number;
    explosionRadius?: number;
    sizeClass: string;
    scaleFootprint: number;
    burstShots?: number;
    burstIntervalMs?: number;
};

type PreviewInfoSection = {
    title: string;
    rows: { label: string; value: string }[];
    note?: string;
};

type RecruitRosterEntry = {
    id: RecruitableUnitId;
    label: string;
    timeLabel: string;
    costLabel: string;
    note: string;
    renderType?: RenderableUnitType;
    icon?: string;
};

type BuildingPreviewStats = {
    health: number;
    costGold: number;
    costOil: number;
    range?: number;
    damage?: number;
    fireRateMs?: number;
    description: string;
    hasTesla?: boolean;
};

type BuildingPreviewVariantOption = {
    id: string;
    label: string;
    blurb: string;
    level: number;
    stats: BuildingPreviewStats;
    upgradeCost?: { gold: number; oil: number };
};

type PreviewDescriptor = {
    key: string;
    kind: 'unit' | 'building';
    title: string;
    subtitle: string;
    hint: string;
    chipLabel: string;
    habitat: PreviewHabitat;
    environmentMode: EnvironmentMode;
    stageMode: StageMode;
    stageTitle: string;
    stageCopy: string;
    stageHeight: number;
    unitType?: RenderableUnitType;
    buildingType?: BuildingType;
    buildingStats?: BuildingPreviewStats;
    buildingVariantOptions?: BuildingPreviewVariantOption[];
    activeBuildingVariantId?: string;
    combatConfig?: UnitPreviewConfig;
    attackTargetType?: RenderableUnitType | 'bridge_node';
    infoSections: PreviewInfoSection[];
    roster?: RecruitRosterEntry[];
    income?: { gold: number; oil: number; cycleMs: number };
    heal?: { percentMissingPerSecond: number; range: number; targetType: RenderableUnitType };
    repair?: { ratePerSecond: number; assistRadius: number; targetType: BuildingType };
    radar?: { cooldownSeconds: number; durationSeconds: number; revealRangeLabel: string };
    transport?: { capacity: number; unloadRange: number; cargoLabel: string };
};

const UNIT_TYPES: RenderableUnitType[] = REDESIGNED_UNIT_TYPES;
const BUILDING_TYPES: BuildingType[] = [
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
    'naval_mine',
];

const UNIT_ACCENTS: Record<RenderableUnitType, number> = {
    soldier: 0xd97706,
    tank: 0x2dd4bf,
    humvee: 0xf97316,
    oil_seeker: 0x60a5fa,
    missile_launcher: 0xef4444,
    destroyer: 0x38bdf8,
    pirate_ship: 0xf59e0b,
    construction_ship: 0xf59e0b,
    sniper: 0x84cc16,
    rocketeer: 0xa78bfa,
    ferry: 0x14b8a6,
    builder: 0xf43f5e,
    light_plane: 0x0ea5e9,
    heavy_plane: 0x6366f1,
    alien_scout: 0x5eead4,
    heavy_alien: 0xc084fc,
    aircraft_carrier: 0x64748b,
    mothership: 0x8b5cf6,
};

const BUILDING_ACCENTS: Record<BuildingType, number> = {
    base: 0xf97316,
    barracks: 0xef4444,
    tank_factory: 0x84cc16,
    air_base: 0x0ea5e9,
    hospital: 0x22c55e,
    repair_dock: 0xf59e0b,
    dock: 0x14b8a6,
    tower: 0x94a3b8,
    mine: 0xfacc15,
    oil_rig: 0xfb923c,
    oil_well: 0x38bdf8,
    farm: 0x4ade80,
    wall: 0x9ca3af,
    bridge_node: 0xc084fc,
    wall_node: 0xe5e7eb,
    naval_mine: 0x38bdf8,
};

const DEFAULT_PREVIEW_WIDTH = 1360;
const MIN_PREVIEW_WIDTH = 760;
const MAX_PREVIEW_WIDTH = 1580;
const STAGE_TOP_PADDING = 18;
const STAGE_BOTTOM_PADDING = 18;
const MIN_ZOOM = 0.34;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.15;
const AUTO_MIN_ZOOM = 0.84;
const DEFAULT_ATTACK_PREVIEW_UNIT: RenderableUnitType = 'soldier';
const BUILDER_REPAIR_RATE_PER_SECOND = 4.5;
const HEAL_PERCENT_PER_SECOND = 5;

const ATTACK_PREVIEW_CONFIG: Record<RenderableUnitType, UnitPreviewConfig> = {
    soldier: { health: 50, damage: 10, speed: 100, range: 100, fireRateMs: 1000, habitat: 'land', attackStyle: 'bullet', combat: true, detail: 'Assault rifle burst at max rifle range.', costGold: 10, costOil: 0, sizeClass: 'Infantry', scaleFootprint: 1 },
    tank: { health: 400, damage: 60, speed: 80, range: 150, fireRateMs: 1500, habitat: 'land', attackStyle: 'shell', combat: true, detail: 'Heavy cannon shot at full engagement distance.', costGold: 150, costOil: 50, explosionRadius: 24, sizeClass: 'Heavy Armor', scaleFootprint: 2.6 },
    humvee: { health: 200, damage: 15, speed: 160, range: 120, fireRateMs: 500, habitat: 'land', attackStyle: 'bullet', combat: true, detail: 'Machine-gun spray at the edge of its skirmish range.', costGold: 80, costOil: 20, sizeClass: 'Light Vehicle', scaleFootprint: 1.9 },
    oil_seeker: { health: 150, damage: 0, speed: 50, range: 100, fireRateMs: 0, habitat: 'land', attackStyle: 'support', combat: false, detail: 'Support-only scout. No direct attack preview, but it shows the real reveal job.', costGold: 1000, costOil: 0, sizeClass: 'Support Vehicle', scaleFootprint: 1.7 },
    missile_launcher: { health: 150, damage: 110, speed: 60, range: 500, fireRateMs: 5200, habitat: 'land', attackStyle: 'missile', combat: true, detail: 'Six-missile saturation barrage from maximum bombardment distance, followed by a long reload.', costGold: 250, costOil: 100, explosionRadius: 46, sizeClass: 'Siege Vehicle', scaleFootprint: 2.1, burstShots: 6, burstIntervalMs: 170 },
    destroyer: { health: 300, damage: 50, speed: 70, range: 200, fireRateMs: 1000, habitat: 'water', attackStyle: 'shell', combat: true, detail: 'Naval cannon fire across open water.', costGold: 50, costOil: 10, explosionRadius: 22, sizeClass: 'Warship', scaleFootprint: 3.3 },
    pirate_ship: { health: 180, damage: 15, speed: 78, range: 180, fireRateMs: 1300, habitat: 'water', attackStyle: 'shell', combat: true, detail: 'Light broadside strike from raider range.', costGold: 200, costOil: 0, explosionRadius: 18, sizeClass: 'Raider Ship', scaleFootprint: 2.7 },
    construction_ship: { health: 150, damage: 0, speed: 80, range: 50, fireRateMs: 0, habitat: 'water', attackStyle: 'support', combat: false, detail: 'Utility vessel. It heals, accelerates construction, and handles offshore structures.', costGold: 100, costOil: 0, sizeClass: 'Support Ship', scaleFootprint: 2.9 },
    sniper: { health: 40, damage: 40, speed: 90, range: 300, fireRateMs: 2000, habitat: 'land', attackStyle: 'sniper', combat: true, detail: 'Precision shot from the very edge of sniper sightline.', costGold: 25, costOil: 0, sizeClass: 'Marksman', scaleFootprint: 1 },
    rocketeer: { health: 60, damage: 30, speed: 80, range: 150, fireRateMs: 3000, habitat: 'land', attackStyle: 'rocket', combat: true, detail: 'Rocket strike with splash at full firing distance.', costGold: 40, costOil: 10, explosionRadius: 28, sizeClass: 'Infantry Siege', scaleFootprint: 1.1 },
    ferry: { health: 400, damage: 0, speed: 60, range: 100, fireRateMs: 0, habitat: 'water', attackStyle: 'support', combat: false, detail: 'Transport craft. It ferries armies between coastlines and bridgeheads.', costGold: 30, costOil: 5, sizeClass: 'Transport Ship', scaleFootprint: 2.6 },
    builder: { health: 50, damage: 0, speed: 100, range: 50, fireRateMs: 0, habitat: 'land', attackStyle: 'support', combat: false, detail: 'Construction unit. It repairs, accelerates builds, and erects land structures.', costGold: 50, costOil: 0, sizeClass: 'Utility Infantry', scaleFootprint: 1 },
    light_plane: { health: 150, damage: 30, speed: 200, range: 200, fireRateMs: 1000, habitat: 'land', attackStyle: 'bullet', combat: true, detail: 'Air pass over land with a forward gun burst.', costGold: 100, costOil: 20, sizeClass: 'Light Aircraft', scaleFootprint: 2.3 },
    heavy_plane: { health: 400, damage: 110, speed: 230, range: 145, fireRateMs: 1800, habitat: 'land', attackStyle: 'bomb', combat: true, detail: 'Bombing run over land with repeated payload drops.', costGold: 250, costOil: 100, explosionRadius: 90, sizeClass: 'Bomber', scaleFootprint: 2.7 },
    alien_scout: { health: 200, damage: 20, speed: 350, range: 200, fireRateMs: 500, habitat: 'land', attackStyle: 'bullet', combat: true, detail: 'Skin-reactive plasma skirmisher with a scanning core and fast strafing fire.', costGold: 150, costOil: 50, sizeClass: 'Alien Scout', scaleFootprint: 2.2 },
    heavy_alien: { health: 1500, damage: 100, speed: 100, range: 250, fireRateMs: 1000, habitat: 'land', attackStyle: 'bullet', combat: true, detail: 'Heavy alien warship that hammers targets with dense plasma bursts from a shielded core.', costGold: 800, costOil: 400, sizeClass: 'Alien Warship', scaleFootprint: 4.1 },
    aircraft_carrier: { health: 3000, damage: 100, speed: 50, range: 400, fireRateMs: 2000, habitat: 'water', attackStyle: 'missile', combat: true, detail: 'Capital ship rocket barrage plus an onboard air wing.', costGold: 2000, costOil: 1000, explosionRadius: 36, sizeClass: 'Capital Ship', scaleFootprint: 5.2 },
    mothership: { health: 3000, damage: 250, speed: 50, range: 300, fireRateMs: 1200, habitat: 'land', attackStyle: 'beam', combat: true, detail: 'Beam fortress with direct beam ticks and stackable radiation decay in the impact zone.', costGold: 2000, costOil: 1000, explosionRadius: 56, sizeClass: 'Colossal Airship', scaleFootprint: 5.6 },
};

const RECRUIT_LIBRARY: Record<RecruitableUnitId, RecruitRosterEntry> = {
    soldier: { id: 'soldier', label: 'Soldier', timeLabel: '3s', costLabel: '10g', note: 'Cheap frontliner and capture piece.', renderType: 'soldier' },
    sniper: { id: 'sniper', label: 'Sniper', timeLabel: '5s', costLabel: '25g', note: 'Long-range infantry pickoff.', renderType: 'sniper' },
    rocketeer: { id: 'rocketeer', label: 'Rocketeer', timeLabel: '5s', costLabel: '40g / 10o', note: 'Splash infantry siege.', renderType: 'rocketeer' },
    builder: { id: 'builder', label: 'Builder', timeLabel: '5s', costLabel: '50g', note: 'Builds and repairs on land.', renderType: 'builder' },
    oil_seeker: { id: 'oil_seeker', label: 'Oil Seeker', timeLabel: '30s', costLabel: '1000g', note: 'Reveals black oil spots on land maps.', renderType: 'oil_seeker' },
    tank: { id: 'tank', label: 'Tank', timeLabel: '15s', costLabel: '150g / 50o', note: 'Heavy armor spearhead.', renderType: 'tank' },
    humvee: { id: 'humvee', label: 'Humvee', timeLabel: '10s', costLabel: '80g / 20o', note: 'Fast gun truck and infantry transport.', renderType: 'humvee' },
    missile_launcher: { id: 'missile_launcher', label: 'Missile Launcher', timeLabel: '20s', costLabel: '250g / 100o', note: '6-shot siege launcher with a long reload.', renderType: 'missile_launcher' },
    destroyer: { id: 'destroyer', label: 'Destroyer', timeLabel: '10s', costLabel: '50g / 10o', note: 'Flexible naval gun platform.', renderType: 'destroyer' },
    pirate_ship: { id: 'pirate_ship', label: 'Pirate Ship', timeLabel: '12s', costLabel: '200g', note: 'Cheap raider with lighter guns.', renderType: 'pirate_ship' },
    construction_ship: { id: 'construction_ship', label: 'Construction Ship', timeLabel: '10s', costLabel: '100g', note: 'Builds rigs, bridges, and naval mines.', renderType: 'construction_ship' },
    ferry: { id: 'ferry', label: 'Ferry', timeLabel: '8s', costLabel: '30g / 5o', note: 'Transport for water crossings.', renderType: 'ferry' },
    light_plane: { id: 'light_plane', label: 'Light Plane', timeLabel: '10s', costLabel: '100g / 20o', note: 'Fast gunship patrol.', renderType: 'light_plane' },
    heavy_plane: { id: 'heavy_plane', label: 'Heavy Plane', timeLabel: '20s', costLabel: '250g / 100o', note: 'Stealth bomber with heavy splash.', renderType: 'heavy_plane' },
    aircraft_carrier: { id: 'aircraft_carrier', label: 'Aircraft Carrier', timeLabel: '60s', costLabel: '2000g / 1000o', note: 'Capital ship that launches aircraft.', renderType: 'aircraft_carrier' },
    mothership: { id: 'mothership', label: 'Mothership', timeLabel: '60s', costLabel: '2000g / 1000o', note: 'Beam fortress with launch bays.', renderType: 'mothership' },
    alien_scout: { id: 'alien_scout', label: 'Alien Scout Ship', timeLabel: '3s', costLabel: '150g / 50o', note: 'Very fast alien skirmisher with scanning plasma fins.', renderType: 'alien_scout' },
    heavy_alien: { id: 'heavy_alien', label: 'Heavy Alien Spaceship', timeLabel: '40s', costLabel: '800g / 400o', note: 'Heavy alien warship with a shielded reactor core.', renderType: 'heavy_alien' },
};

const BUILDING_STATS: Record<BuildingType, BuildingPreviewStats> = {
    base: { health: 1000, costGold: 9999, costOil: 9999, range: 300, damage: 50, fireRateMs: 1000, description: 'HQ that generates income, fires at enemies, and trains Builders.' },
    barracks: { health: 1000, costGold: 50, costOil: 0, description: 'Infantry production hub.' },
    tank_factory: { health: 1500, costGold: 500, costOil: 50, description: 'Produces armored land vehicles.' },
    air_base: { health: 1000, costGold: 400, costOil: 100, description: 'Produces aircraft and the mothership.' },
    hospital: { health: 550, costGold: 150, costOil: 20, range: 220, description: 'Heals allied human units by 5% missing HP per second.' },
    repair_dock: { health: 700, costGold: 220, costOil: 40, range: 220, description: 'Heals allied vehicles, ships, and aircraft by 5% missing HP per second.' },
    dock: { health: 600, costGold: 100, costOil: 0, description: 'Constructs naval units from shoreline water.' },
    tower: { health: 400, costGold: 40, costOil: 0, range: 200, damage: 25, fireRateMs: 800, description: 'Static defensive gun for lane control.' },
    mine: { health: 300, costGold: 30, costOil: 0, description: 'Extracts gold from deposit nodes.' },
    oil_rig: { health: 400, costGold: 200, costOil: 0, description: 'Offshore oil platform for water oil spots.' },
    oil_well: { health: 400, costGold: 200, costOil: 0, description: 'Land oil extractor for visible black oil spots.' },
    farm: { health: 200, costGold: 50, costOil: 0, description: 'Passive backline gold on grassland.' },
    wall: { health: 500, costGold: 10, costOil: 0, description: 'Cheap blocker for funneling attacks.' },
    bridge_node: { health: 200, costGold: 50, costOil: 0, description: 'Anchor point for bridges between islands.' },
    wall_node: { health: 200, costGold: 20, costOil: 0, description: 'Anchor point for longer wall chains.' },
    naval_mine: { health: 80, costGold: 120, costOil: 20, range: 38, damage: 500, description: 'Hidden water trap with a huge blast.' },
};

const BUILDING_VARIANTS: Partial<Record<BuildingType, BuildingPreviewVariantOption[]>> = {
    base: [
        {
            id: 'base_tier_1',
            label: 'HQ I (Standard)',
            blurb: 'Default HQ defense profile used at match start.',
            level: 1,
            stats: { ...BUILDING_STATS.base, hasTesla: false },
        },
        {
            id: 'base_tier_2_tesla',
            label: 'HQ II (Tesla)',
            blurb: 'Upgraded HQ with Tesla defense and doubled max HP.',
            level: 2,
            upgradeCost: { gold: 500, oil: 0 },
            stats: {
                ...BUILDING_STATS.base,
                health: 2000,
                range: 400,
                damage: 100,
                fireRateMs: 500,
                hasTesla: true,
                description: 'Tier 2 HQ with Tesla defense, 2x HP, and faster anti-unit fire.',
            },
        },
    ],
};

const getBuildingVariantOptions = (type: BuildingType): BuildingPreviewVariantOption[] => {
    const options = BUILDING_VARIANTS[type];
    if (options?.length) return options;
    return [
        {
            id: `${type}_default`,
            label: 'Default',
            blurb: 'Standard building profile.',
            level: 1,
            stats: BUILDING_STATS[type],
        },
    ];
};

const resolveBuildingVariant = (type: BuildingType, variantId?: string): BuildingPreviewVariantOption => {
    const options = getBuildingVariantOptions(type);
    if (!variantId) return options[0];
    return options.find((option) => option.id === variantId) ?? options[0];
};

const ECONOMY_YIELDS: Partial<Record<BuildingType, { gold: number; oil: number; cycleMs: number }>> = {
    base: { gold: 20, oil: 0, cycleMs: 2000 },
    mine: { gold: 100, oil: 0, cycleMs: 2000 },
    farm: { gold: 50, oil: 0, cycleMs: 2000 },
    oil_rig: { gold: 400, oil: 10, cycleMs: 2000 },
    oil_well: { gold: 400, oil: 10, cycleMs: 2000 },
};

const BUILDING_RECRUIT_ROSTERS: Partial<Record<BuildingType, RecruitRosterEntry[]>> = {
    base: [RECRUIT_LIBRARY.builder],
    barracks: [RECRUIT_LIBRARY.soldier, RECRUIT_LIBRARY.sniper, RECRUIT_LIBRARY.rocketeer, RECRUIT_LIBRARY.builder, RECRUIT_LIBRARY.oil_seeker],
    tank_factory: [RECRUIT_LIBRARY.tank, RECRUIT_LIBRARY.humvee, RECRUIT_LIBRARY.missile_launcher],
    air_base: [RECRUIT_LIBRARY.light_plane, RECRUIT_LIBRARY.heavy_plane, RECRUIT_LIBRARY.mothership],
    dock: [RECRUIT_LIBRARY.pirate_ship, RECRUIT_LIBRARY.destroyer, RECRUIT_LIBRARY.construction_ship, RECRUIT_LIBRARY.ferry, RECRUIT_LIBRARY.aircraft_carrier],
};

const UNIT_RECRUIT_ROSTERS: Partial<Record<RenderableUnitType, RecruitRosterEntry[]>> = {
    mothership: [RECRUIT_LIBRARY.alien_scout, RECRUIT_LIBRARY.heavy_alien, RECRUIT_LIBRARY.light_plane, RECRUIT_LIBRARY.heavy_plane],
    aircraft_carrier: [RECRUIT_LIBRARY.light_plane, RECRUIT_LIBRARY.heavy_plane],
};

const BUILDING_WEAPON_OFFSETS: Partial<Record<BuildingType, { x: number; y: number }>> = {
    base: { x: 28, y: -10 },
    tower: { x: 0, y: -38 },
    naval_mine: { x: 0, y: 0 },
};

const clampZoom = (value: number) => Phaser.Math.Clamp(Number.isFinite(value) ? value : 1, MIN_ZOOM, MAX_ZOOM);
const isRenderableUnitType = (value: string): value is RenderableUnitType => UNIT_TYPES.includes(value as RenderableUnitType);

const formatDps = (config: UnitPreviewConfig) => {
    if (!config.combat || config.fireRateMs <= 0 || config.damage <= 0) return '0';
    const burstShots = config.burstShots ?? 1;
    const burstInterval = config.burstIntervalMs ?? 0;
    const cycleMs = config.fireRateMs + Math.max(0, burstShots - 1) * burstInterval;
    return ((config.damage * burstShots) * (1000 / cycleMs)).toFixed(config.damage >= 100 ? 0 : 1);
};

const formatAttackCadence = (config: UnitPreviewConfig) => {
    if (config.fireRateMs <= 0) return 'No weapon';
    if ((config.burstShots ?? 1) > 1) {
        return `${config.burstShots}-shot salvo • ${(config.fireRateMs / 1000).toFixed(1)}s reload`;
    }
    return `${(1000 / config.fireRateMs).toFixed(2)} shots/s`;
};

const formatExplosionRadius = (config: UnitPreviewConfig) => {
    if (!config.explosionRadius) return 'Direct hit';
    return `${config.explosionRadius}px`;
};

const formatCost = (gold: number, oil: number) => `${gold}g${oil > 0 ? ` / ${oil}o` : ''}`;
const formatFireRateLabel = (fireRateMs?: number) => (fireRateMs && fireRateMs > 0 ? `${(1000 / fireRateMs).toFixed(2)} shots/s` : 'No weapon');
const formatDpsLabel = (damage?: number, fireRateMs?: number) => (damage && fireRateMs && fireRateMs > 0 ? ((damage * 1000) / fireRateMs).toFixed(damage >= 100 ? 0 : 1) : '0');
const getPreviewSurvivableHealth = (baseHealth: number, incomingDamage: number) => {
    if (incomingDamage <= 0) return Math.max(1, baseHealth);
    return Math.max(baseHealth, Math.ceil(incomingDamage * 1.35));
};

const getPreviewWeaponOrigin = (art: Phaser.GameObjects.Container, type: RenderableUnitType) => {
    const offset = getUnitWeaponMuzzleOffset(type);
    const scaleX = art.scaleX || 1;
    const scaleY = art.scaleY || 1;
    const scaledX = offset.x * scaleX;
    const scaledY = offset.y * scaleY;
    const rotation = art.rotation || 0;

    return {
        x: art.x + scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation),
        y: art.y + scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation),
    };
};

const applyPreviewFacing = (art: Phaser.GameObjects.Container, targetAngle: number | undefined) => {
    const facing = resolveUnitFacingTransform(targetAngle);
    if (!facing) return;
    const baseScale = Number(art.getData('baseScale')) || Math.abs(art.scaleY || art.scaleX || 1);
    art.scaleX = facing.mirrored ? -baseScale : baseScale;
    art.rotation = facing.rotation;
};

const getPreviewBuildingOrigin = (art: Phaser.GameObjects.Container, type: BuildingType) => {
    const offset = BUILDING_WEAPON_OFFSETS[type] ?? { x: 0, y: -14 };
    const scaleX = art.scaleX || 1;
    const scaleY = art.scaleY || 1;
    return {
        x: art.x + offset.x * scaleX,
        y: art.y + offset.y * scaleY,
    };
};

const getUnitAttackPreviewScale = (type: RenderableUnitType) => {
    if (type === 'mothership') return 1.04;
    if (type === 'aircraft_carrier') return 1.18;
    if (type === 'alien_scout') return 1.56 * getUnitArtScale(type);
    if (type === 'heavy_alien') return 1.34 * getUnitArtScale(type);
    if (type === 'destroyer' || type === 'pirate_ship' || type === 'construction_ship' || type === 'ferry') return 1.6 * getUnitArtScale(type);
    if (type === 'light_plane' || type === 'heavy_plane') return 1.68 * getUnitArtScale(type);
    if (type === 'tank' || type === 'humvee' || type === 'oil_seeker' || type === 'missile_launcher') return 1.72 * getUnitArtScale(type);
    if (type === 'soldier' || type === 'sniper' || type === 'rocketeer' || type === 'builder') return 2.02;
    return 1.72 * getUnitArtScale(type);
};

const createPreviewBuildingData = (type: BuildingType, statsOverride?: BuildingPreviewStats): Building => {
    const stats = statsOverride ?? BUILDING_STATS[type];
    return {
        id: `preview_${type}`,
        type,
        level: type === 'base' && stats.hasTesla ? 2 : 1,
        health: stats.health,
        maxHealth: stats.health,
        ownerId: 'preview',
        hasTesla: type === 'base' ? Boolean(stats.hasTesla) : undefined,
    };
};

const getAttackPreviewDistance = (range: number, arenaWidth: number) => {
    const normalized = Phaser.Math.Clamp((range - 50) / 450, 0, 1);
    return Phaser.Math.Linear(250, Math.max(420, arenaWidth - 300), normalized);
};

const getUnitCardSubtitle = (type: RenderableUnitType) => {
    if (type === 'builder' || type === 'construction_ship') return 'Repair + construction preview';
    if (type === 'oil_seeker') return 'Oil reveal and terrain preview';
    if (type === 'ferry') return 'Transport preview';
    if (type === 'mothership' || type === 'aircraft_carrier') return 'Attack + launch bay preview';
    if (type === 'humvee') return 'Attack + transport stats';
    return ATTACK_PREVIEW_CONFIG[type].combat ? `${ATTACK_PREVIEW_CONFIG[type].range} range • attack preview` : 'Support unit preview';
};

const getBuildingCardSubtitle = (type: BuildingType) => {
    if (type === 'mine' || type === 'farm' || type === 'oil_rig' || type === 'oil_well') return 'Placement + economy preview';
    if (type === 'hospital' || type === 'repair_dock') return 'Healing preview';
    if (type === 'tower' || type === 'naval_mine') return 'Attack preview';
    if (type === 'base') return 'HQ fire, income, and recruit preview';
    if (type === 'barracks' || type === 'tank_factory' || type === 'air_base' || type === 'dock') return 'Recruitment preview';
    return 'Structure preview';
};

const createCombatSections = (config: UnitPreviewConfig): PreviewInfoSection[] => ([
    {
        title: 'Combat Stats',
        rows: [
            { label: 'Health', value: `${config.health}` },
            { label: 'Damage', value: `${config.damage}` },
            { label: 'DPS', value: formatDps(config) },
            { label: 'Fire Rate', value: formatAttackCadence(config) },
            { label: 'Range', value: `${config.range}` },
            { label: 'Move Speed', value: `${config.speed}` },
            { label: 'Splash', value: formatExplosionRadius(config) },
            { label: 'Cost', value: formatCost(config.costGold, config.costOil) },
        ],
    },
    {
        title: 'Role',
        rows: [
            { label: 'Class', value: config.sizeClass },
            { label: 'Habitat', value: config.habitat === 'water' ? 'Water / Sea lane' : 'Land / Island lane' },
            { label: 'Scale', value: `${config.scaleFootprint.toFixed(1)}x soldier` },
        ],
        note: config.detail,
    },
]);

const getPreviewDescriptor = (selection: PreviewSelection, buildingVariantId?: string): PreviewDescriptor => {
    if (selection.kind === 'unit') {
        const config = ATTACK_PREVIEW_CONFIG[selection.type];
        const roster = UNIT_RECRUIT_ROSTERS[selection.type];

        if (selection.type === 'builder') {
            return {
                key: 'unit_builder',
                kind: 'unit',
                title: 'Builder',
                subtitle: 'Shows how idle builders heal damaged structures and how close builders speed up construction.',
                hint: 'Builder repair demo. The stage shows a live repair cycle on a damaged land structure, plus the Builder’s construction role and repair stats.',
                chipLabel: 'LAND ENGINEERING',
                habitat: 'land',
                environmentMode: 'land',
                stageMode: 'unitRepair',
                stageTitle: 'Builder Repair Preview',
                stageCopy: 'Idle Builders repair safe damaged structures, speed up nearby construction, and place most land buildings. This preview loops the real repair job instead of a fake attack.',
                stageHeight: 560,
                unitType: 'builder',
                repair: { ratePerSecond: BUILDER_REPAIR_RATE_PER_SECOND, assistRadius: 150, targetType: 'tower' },
                infoSections: [
                    {
                        title: 'Field Stats',
                        rows: [
                            { label: 'Health', value: '50' },
                            { label: 'Move Speed', value: '100' },
                            { label: 'Recruit Time', value: '5s' },
                            { label: 'Cost', value: '50g' },
                        ],
                    },
                    {
                        title: 'Repair & Build',
                        rows: [
                            { label: 'Repair Rate', value: '4.5 HP/s per idle Builder' },
                            { label: 'Repair Radius', value: '150' },
                            { label: 'Construction Assist', value: '+100% build speed per nearby helper' },
                            { label: 'Common Targets', value: 'HQs, towers, factories, farms, mines, bridges' },
                        ],
                        note: 'Builders do not fight. They win tempo by expanding, repairing, and creating new lanes.',
                    },
                ],
            };
        }

        if (selection.type === 'construction_ship') {
            return {
                key: 'unit_construction_ship',
                kind: 'unit',
                title: 'Construction Ship',
                subtitle: 'Shows offshore repair work plus the ship’s role in building bridges, oil rigs, and naval mines.',
                hint: 'Construction Ship preview. Watch it repair a damaged offshore structure while the intel panel calls out every naval build role it handles.',
                chipLabel: 'WATER ENGINEERING',
                habitat: 'water',
                environmentMode: 'water',
                stageMode: 'unitRepair',
                stageTitle: 'Construction Ship Repair Preview',
                stageCopy: 'Construction Ships are your offshore builders. They speed up water construction, heal damaged sea structures, and are required for Oil Rigs and naval bridge work.',
                stageHeight: 560,
                unitType: 'construction_ship',
                repair: { ratePerSecond: BUILDER_REPAIR_RATE_PER_SECOND, assistRadius: 150, targetType: 'oil_rig' },
                infoSections: [
                    {
                        title: 'Field Stats',
                        rows: [
                            { label: 'Health', value: '150' },
                            { label: 'Move Speed', value: '80' },
                            { label: 'Recruit Time', value: '10s' },
                            { label: 'Cost', value: '100g' },
                        ],
                    },
                    {
                        title: 'Offshore Roles',
                        rows: [
                            { label: 'Repair Rate', value: '4.5 HP/s when assisting' },
                            { label: 'Build Radius', value: '300' },
                            { label: 'Builds', value: 'Oil Rigs, Bridge Nodes, Naval Mines' },
                            { label: 'Best Use', value: 'Island maps, shoreline bridges, sea economy' },
                        ],
                        note: 'If the structure belongs in water, this is the worker that gets it done.',
                    },
                ],
            };
        }

        if (selection.type === 'oil_seeker') {
            return {
                key: 'unit_oil_seeker',
                kind: 'unit',
                title: 'Oil Seeker',
                subtitle: 'Shows the reveal pulse that exposes hidden black oil spots on land maps like Desert.',
                hint: 'Oil Seeker preview. The radar sweep reveals black oil spots on land so players know exactly why they need this unit on maps like Desert.',
                chipLabel: 'LAND SCANNER',
                habitat: 'land',
                environmentMode: 'oil_land',
                stageMode: 'unitRadar',
                stageTitle: 'Oil Reveal Preview',
                stageCopy: 'Use Oil Seekers on land maps to expose hidden black oil spots. Once you reveal a spot, Builders can place Oil Wells directly on it.',
                stageHeight: 540,
                unitType: 'oil_seeker',
                radar: { cooldownSeconds: 30, durationSeconds: 10, revealRangeLabel: '¼ of the map' },
                infoSections: [
                    {
                        title: 'Field Stats',
                        rows: [
                            { label: 'Health', value: '150' },
                            { label: 'Move Speed', value: '50' },
                            { label: 'Recruit Time', value: '30s' },
                            { label: 'Cost', value: '1000g' },
                        ],
                    },
                    {
                        title: 'Reveal Ability',
                        rows: [
                            { label: 'Cooldown', value: '30s' },
                            { label: 'Visible Window', value: '10s' },
                            { label: 'Reveal Radius', value: '¼ map radius' },
                            { label: 'Best Maps', value: 'Desert and other land-heavy maps' },
                        ],
                        note: 'If you cannot see the black oil spot yet, an Oil Seeker is the answer.',
                    },
                ],
            };
        }

        if (selection.type === 'ferry') {
            return {
                key: 'unit_ferry',
                kind: 'unit',
                title: 'Ferry',
                subtitle: 'Shows a water crossing route so players can understand how ferry transport opens new fronts.',
                hint: 'Ferry transport preview. Watch infantry cargo move through the water lane so the role is clear without reading a wall of text.',
                chipLabel: 'WATER TRANSPORT',
                habitat: 'water',
                environmentMode: 'shore',
                stageMode: 'unitTransport',
                stageTitle: 'Ferry Transport Preview',
                stageCopy: 'Ferries carry armies across water and into bridgeheads. This demo shows pickup, crossing, and unload range on a shoreline lane.',
                stageHeight: 540,
                unitType: 'ferry',
                transport: { capacity: 20, unloadRange: 100, cargoLabel: 'Infantry and vehicles' },
                infoSections: [
                    {
                        title: 'Transport Stats',
                        rows: [
                            { label: 'Capacity', value: '20 cargo slots' },
                            { label: 'Unload Range', value: '100' },
                            { label: 'Move Speed', value: '60' },
                            { label: 'Cost', value: '30g / 5o' },
                        ],
                    },
                    {
                        title: 'Use Cases',
                        rows: [
                            { label: 'Best Maps', value: 'Grasslands and Islands' },
                            { label: 'Supports', value: 'Builder expansion, bridgeheads, fast flank routes' },
                            { label: 'Weakness', value: 'Needs escort against destroyers and mines' },
                        ],
                        note: 'Think of the Ferry as the tool that turns water into a shortcut instead of a wall.',
                    },
                ],
            };
        }

        if (selection.type === 'humvee') {
            return {
                key: 'unit_humvee',
                kind: 'unit',
                title: 'Humvee',
                subtitle: 'Shows the live gun pass while also calling out its infantry transport role.',
                hint: 'Humvee preview. You still get the real attack demo, but the intel panel now also spells out its transport utility and capacity.',
                chipLabel: 'LAND STRIKE + TRANSPORT',
                habitat: 'land',
                environmentMode: 'land',
                stageMode: 'unitCombat',
                stageTitle: 'Humvee Attack Preview',
                stageCopy: 'The Humvee fights like a fast skirmish vehicle and also carries infantry for quick reinforcement swings.',
                stageHeight: 588,
                unitType: 'humvee',
                combatConfig: config,
                attackTargetType: 'bridge_node',
                transport: { capacity: 4, unloadRange: 100, cargoLabel: 'Infantry only' },
                infoSections: [
                    ...createCombatSections(config),
                    {
                        title: 'Transport Utility',
                        rows: [
                            { label: 'Capacity', value: '4 infantry' },
                            { label: 'Unload Range', value: '100' },
                            { label: 'Role', value: 'Rapid repositioning for soldiers, snipers, and rocketeers' },
                        ],
                        note: 'Use Humvees to move fragile ranged units faster than the enemy can answer.',
                    },
                ],
            };
        }

        if (selection.type === 'mothership' || selection.type === 'aircraft_carrier') {
            return {
                key: `unit_${selection.type}`,
                kind: 'unit',
                title: UNIT_PREVIEW_LABELS[selection.type],
                subtitle: `${selection.type === 'mothership' ? 'Beam weapon and launch bay' : 'Rocket barrage and air wing'} in one live preview.`,
                hint: `${UNIT_PREVIEW_LABELS[selection.type]} preview. The stage stays focused on the capital unit itself, while the recruit panel on the right lets you open each launch-bay unit as its own live demo.`,
                chipLabel: selection.type === 'mothership' ? 'CAPITAL AIR FORTRESS' : 'CAPITAL SEA FORTRESS',
                habitat: selection.type === 'aircraft_carrier' ? 'water' : 'land',
                environmentMode: selection.type === 'aircraft_carrier' ? 'water' : 'land',
                stageMode: 'unitCombat',
                stageTitle: `${UNIT_PREVIEW_LABELS[selection.type]} Live Preview`,
                stageCopy: `${config.detail} Use the recruit panel on the right to swap the theater over to any onboard unit and inspect it on its own.`,
                stageHeight: 622,
                unitType: selection.type,
                combatConfig: config,
                attackTargetType: 'bridge_node',
                roster,
                infoSections: [
                    ...createCombatSections(config),
                    ...(selection.type === 'mothership'
                        ? [
                            {
                                title: 'Beam Mechanics',
                                rows: [
                                    { label: 'Beam Tick', value: '25 damage every 0.1s for 1.0s' },
                                    { label: 'Cycle Time', value: '1.2s (beam + cooldown)' },
                                    { label: 'Radiation AoE', value: '115 radius around impact' },
                                    { label: 'Radiation Stacks', value: '5s per stack • stackable decay' },
                                ],
                            },
                        ]
                        : []),
                    {
                        title: 'Launch Bay',
                        rows: roster?.map((entry) => ({ label: entry.label, value: `${entry.timeLabel} • ${entry.costLabel}` })) ?? [],
                        note: selection.type === 'mothership'
                            ? 'Motherships launch alien ships and aircraft while also serving as a transport platform.'
                            : 'Aircraft Carriers project air power at sea and can keep the pressure flowing without returning home.',
                    },
                ],
            };
        }

        return {
            key: `unit_${selection.type}`,
            kind: 'unit',
            title: UNIT_PREVIEW_LABELS[selection.type],
            subtitle: 'Live combat preview with real projectile behavior, range, and splash timings.',
            hint: `${UNIT_PREVIEW_LABELS[selection.type]} attack theater. Click any other unit or building card to swap the live demo and inspect its real job.`,
            chipLabel: config.habitat === 'water' ? 'WATER COMBAT' : 'LAND COMBAT',
            habitat: config.habitat,
            environmentMode: config.habitat === 'water' ? 'water' : 'land',
            stageMode: 'unitCombat',
            stageTitle: 'Attack Theater',
            stageCopy: `${UNIT_PREVIEW_LABELS[selection.type]} • max range ${config.range} • ${config.detail}`,
            stageHeight: 548,
            unitType: selection.type,
            combatConfig: config,
            attackTargetType: 'bridge_node',
            infoSections: createCombatSections(config),
        };
    }

    const buildingVariantOptions = getBuildingVariantOptions(selection.type);
    const activeBuildingVariant = resolveBuildingVariant(selection.type, buildingVariantId);
    const stats = activeBuildingVariant.stats;
    const roster = BUILDING_RECRUIT_ROSTERS[selection.type];
    const income = ECONOMY_YIELDS[selection.type];

    switch (selection.type) {
        case 'tower':
        case 'naval_mine':
        case 'base': {
            const targetType: RenderableUnitType = selection.type === 'naval_mine' ? 'destroyer' : 'soldier';
            return {
                key: `building_${selection.type}`,
                kind: 'building',
                title: BUILDING_PREVIEW_LABELS[selection.type],
                subtitle: selection.type === 'base'
                    ? 'HQ preview that covers defense fire, income, and Builder production.'
                    : 'Defensive structure preview with live fire against a moving target.',
                hint: `${BUILDING_PREVIEW_LABELS[selection.type]} preview. This stage shows the building performing its real job instead of just showing the model standing still.`,
                chipLabel: selection.type === 'naval_mine' ? 'WATER TRAP' : 'DEFENSIVE FIRE',
                habitat: selection.type === 'naval_mine' ? 'water' : 'land',
                environmentMode: selection.type === 'naval_mine' ? 'water' : 'land',
                stageMode: 'buildingAttack',
                stageTitle: selection.type === 'base' ? 'HQ Defense Preview' : 'Building Attack Preview',
                stageCopy: selection.type === 'naval_mine'
                    ? 'Hidden naval mines wait under the water until an enemy ship crosses the trigger radius, then erupt in a huge blast.'
                    : selection.type === 'base'
                        ? (stats.hasTesla
                            ? 'Tier 2 HQ uses Tesla defense while still generating HQ income and recruiting Builders.'
                            : 'Bases can defend themselves while generating HQ income and recruiting Builders.')
                        : 'Towers keep lanes honest with constant anti-ground pressure.',
                stageHeight: selection.type === 'base' ? 612 : 552,
                buildingType: selection.type,
                buildingStats: stats,
                buildingVariantOptions,
                activeBuildingVariantId: activeBuildingVariant.id,
                attackTargetType: targetType,
                roster,
                income: selection.type === 'base' ? income : undefined,
                infoSections: [
                    {
                        title: 'Structure Stats',
                        rows: [
                            { label: 'Health', value: `${stats.health}` },
                            { label: 'Damage', value: `${stats.damage ?? 0}` },
                            { label: 'DPS', value: formatDpsLabel(stats.damage, stats.fireRateMs) },
                            { label: 'Range', value: `${stats.range ?? 0}` },
                            { label: 'Fire Rate', value: selection.type === 'naval_mine' ? 'Trigger blast' : formatFireRateLabel(stats.fireRateMs) },
                            { label: 'Cost', value: formatCost(stats.costGold, stats.costOil) },
                        ],
                    },
                    ...(selection.type === 'base'
                        ? [
                            {
                                title: 'HQ Utility',
                                rows: [
                                    { label: 'Variant', value: activeBuildingVariant.label },
                                    { label: 'Income', value: '+10 gold / second (+1 per owned island)' },
                                    { label: 'Recruits', value: 'Builders • 5s' },
                                    { label: 'Upgrade', value: stats.hasTesla ? 'Tesla online • upgrade purchased' : 'Upgrade to HQ II Tesla for 500g' },
                                    { label: 'Role', value: 'Spawn anchor, economy pulse, fallback defense' },
                                ],
                            },
                        ]
                        : []),
                    {
                        title: 'Purpose',
                        rows: [
                            { label: 'Use', value: stats.description },
                        ],
                    },
                ],
            };
        }
        case 'hospital':
        case 'repair_dock': {
            const healsHumans = selection.type === 'hospital';
            const healTargetType: RenderableUnitType = healsHumans ? 'soldier' : 'tank';
            return {
                key: `building_${selection.type}`,
                kind: 'building',
                title: BUILDING_PREVIEW_LABELS[selection.type],
                subtitle: healsHumans ? 'Shows wounded infantry being healed inside the support radius.' : 'Shows armored units being repaired inside the support radius.',
                hint: `${BUILDING_PREVIEW_LABELS[selection.type]} preview. The unit on stage is actually being healed, so the panel makes the healing role obvious at a glance.`,
                chipLabel: healsHumans ? 'INFANTRY HEALING' : 'MECHANICAL REPAIR',
                habitat: selection.type === 'repair_dock' ? 'water' : 'land',
                environmentMode: selection.type === 'repair_dock' ? 'shore' : 'land',
                stageMode: 'buildingHeal',
                stageTitle: healsHumans ? 'Hospital Healing Preview' : 'Repair Dock Healing Preview',
                stageCopy: stats.description,
                stageHeight: 560,
                buildingType: selection.type,
                buildingStats: stats,
                buildingVariantOptions,
                activeBuildingVariantId: activeBuildingVariant.id,
                heal: { percentMissingPerSecond: HEAL_PERCENT_PER_SECOND, range: stats.range ?? 220, targetType: healTargetType },
                infoSections: [
                    {
                        title: 'Support Stats',
                        rows: [
                            { label: 'Health', value: `${stats.health}` },
                            { label: 'Support Range', value: `${stats.range ?? 220}` },
                            { label: 'Heal Rate', value: `${HEAL_PERCENT_PER_SECOND}% missing HP / second` },
                            { label: 'Cost', value: formatCost(stats.costGold, stats.costOil) },
                        ],
                    },
                    {
                        title: 'Targets',
                        rows: [
                            { label: 'Primary Units', value: healsHumans ? 'Soldiers, Snipers, Rocketeers, Builders' : 'Vehicles, ships, aircraft, capitals' },
                            { label: 'Placement', value: selection.type === 'repair_dock' ? 'Best near docks, sea lanes, and capital ships' : 'Best behind tower lines and staging fronts' },
                        ],
                        note: healsHumans ? 'Hospitals keep infantry pushes efficient.' : 'Repair Docks protect your expensive tech investments.',
                    },
                ],
            };
        }
        case 'mine':
        case 'farm':
        case 'oil_well':
        case 'oil_rig': {
            const environmentMode: EnvironmentMode = selection.type === 'mine'
                ? 'gold'
                : selection.type === 'farm'
                    ? 'grass'
                    : selection.type === 'oil_rig'
                        ? 'oil_water'
                        : 'oil_land';
            return {
                key: `building_${selection.type}`,
                kind: 'building',
                title: BUILDING_PREVIEW_LABELS[selection.type],
                subtitle: 'Shows the structure in the exact environment where it is allowed to be placed.',
                hint: `${BUILDING_PREVIEW_LABELS[selection.type]} economy preview. The stage shows the exact placement environment plus the actual gold/oil burst timing, so players can instantly understand where it belongs.`,
                chipLabel: selection.type === 'oil_rig' ? 'OFFSHORE ECONOMY' : selection.type === 'oil_well' ? 'LAND OIL ECONOMY' : 'ECONOMY STRUCTURE',
                habitat: selection.type === 'oil_rig' ? 'water' : 'land',
                environmentMode,
                stageMode: 'buildingEconomy',
                stageTitle: 'Economy & Placement Preview',
                stageCopy: stats.description,
                stageHeight: 532,
                buildingType: selection.type,
                buildingStats: stats,
                buildingVariantOptions,
                activeBuildingVariantId: activeBuildingVariant.id,
                income,
                infoSections: [
                    {
                        title: 'Economy Output',
                        rows: [
                            { label: 'Gold / sec', value: `${income?.gold ?? 0}` },
                            { label: 'Oil / sec', value: `${income?.oil ?? 0}` },
                            { label: 'Cycle', value: `${((income?.cycleMs ?? 1000) / 1000).toFixed(1)}s` },
                            { label: 'Cost', value: formatCost(stats.costGold, stats.costOil) },
                        ],
                    },
                    {
                        title: 'Placement Rules',
                        rows: [
                            { label: 'Must Be On', value: selection.type === 'mine' ? 'Gold deposit node' : selection.type === 'farm' ? 'Grassland patch' : 'Black oil spot' },
                            { label: 'Terrain', value: selection.type === 'oil_rig' ? 'Water only • Construction Ship required' : selection.type === 'oil_well' ? 'Land only • Builder required' : 'Land' },
                            { label: 'Role', value: selection.type === 'farm' ? 'Safe backline scaling' : selection.type === 'mine' ? 'Fast early gold spike' : 'Oil tech unlock' },
                        ],
                        note: selection.type === 'oil_rig'
                            ? 'Oil Rigs belong directly on a black oil spot in water. If the black oil spot is on land, use an Oil Well instead.'
                            : selection.type === 'oil_well'
                                ? 'On land maps like Desert, reveal the black oil spot with an Oil Seeker first, then place the Oil Well directly on it.'
                                : undefined,
                    },
                ],
            };
        }
        case 'barracks':
        case 'tank_factory':
        case 'air_base':
        case 'dock': {
            const environmentMode: EnvironmentMode = selection.type === 'dock' ? 'shore' : 'land';
            return {
                key: `building_${selection.type}`,
                kind: 'building',
                title: BUILDING_PREVIEW_LABELS[selection.type],
                subtitle: 'Shows the live queue flow and the units this production building can create.',
                hint: `${BUILDING_PREVIEW_LABELS[selection.type]} recruitment preview. The live stage stays clear and readable, while the recruit panel on the right lets you open each produced unit as its own preview.`,
                chipLabel: selection.type === 'dock' ? 'NAVAL PRODUCTION' : 'PRODUCTION BUILDING',
                habitat: selection.type === 'dock' ? 'water' : 'land',
                environmentMode,
                stageMode: 'buildingRecruit',
                stageTitle: 'Recruitment Preview',
                stageCopy: stats.description,
                stageHeight: 610,
                buildingType: selection.type,
                buildingStats: stats,
                buildingVariantOptions,
                activeBuildingVariantId: activeBuildingVariant.id,
                roster,
                infoSections: [
                    {
                        title: 'Structure Stats',
                        rows: [
                            { label: 'Health', value: `${stats.health}` },
                            { label: 'Cost', value: formatCost(stats.costGold, stats.costOil) },
                            { label: 'Role', value: stats.description },
                        ],
                    },
                    {
                        title: 'Recruit Roster',
                        rows: roster?.map((entry) => ({ label: entry.label, value: `${entry.timeLabel} • ${entry.costLabel}` })) ?? [],
                        note: 'Click any recruit below to swap the live theater to that unit and inspect its real attack or support role on its own.',
                    },
                ],
            };
        }
        case 'wall':
        case 'wall_node':
        case 'bridge_node': {
            return {
                key: `building_${selection.type}`,
                kind: 'building',
                title: BUILDING_PREVIEW_LABELS[selection.type],
                subtitle: selection.type === 'bridge_node' ? 'Shows how bridge anchors create new routes between islands.' : 'Shows how wall pieces anchor and extend your choke points.',
                hint: `${BUILDING_PREVIEW_LABELS[selection.type]} structure preview. This one is about shape, route control, and durability rather than damage or economy.`,
                chipLabel: selection.type === 'bridge_node' ? 'ROUTE CONTROL' : 'FORTIFICATION',
                habitat: 'land',
                environmentMode: selection.type === 'bridge_node' ? 'bridge' : 'land',
                stageMode: 'buildingSupport',
                stageTitle: selection.type === 'bridge_node' ? 'Bridge Route Preview' : 'Fortification Preview',
                stageCopy: stats.description,
                stageHeight: 500,
                buildingType: selection.type,
                buildingStats: stats,
                buildingVariantOptions,
                activeBuildingVariantId: activeBuildingVariant.id,
                infoSections: [
                    {
                        title: 'Structure Stats',
                        rows: [
                            { label: 'Health', value: `${stats.health}` },
                            { label: 'Cost', value: formatCost(stats.costGold, stats.costOil) },
                            { label: 'Primary Use', value: selection.type === 'bridge_node' ? 'Creates crossings and surprise attack lanes' : 'Funnels units and protects fragile backline structures' },
                        ],
                    },
                ],
            };
        }
    }
};

const createAlienPlaceholderArt = (
    scene: Phaser.Scene,
    x: number,
    y: number,
    entry: RecruitRosterEntry,
    skinId: SkinId,
    size = 1
) => {
    const palette = skinId !== 'default' ? SKIN_DEFINITIONS_BY_ID[skinId]?.palette : undefined;
    const primary = palette?.primary ?? 0x8b5cf6;
    const secondary = palette?.secondary ?? 0xd8b4fe;
    const glow = palette?.glow ?? 0xa855f7;
    const container = scene.add.container(x, y);
    const glowOrb = scene.add.circle(0, 0, 24 * size, glow, 0.18);
    glowOrb.setBlendMode(Phaser.BlendModes.ADD);
    const hull = scene.add.ellipse(0, 0, 40 * size, 18 * size, primary, 0.92);
    hull.setStrokeStyle(2, secondary, 0.8);
    const core = scene.add.circle(0, -2 * size, 8 * size, secondary, 0.94);
    const fins = [
        scene.add.line(0, 0, -18 * size, 2 * size, -6 * size, -11 * size, secondary, 0.7),
        scene.add.line(0, 0, 18 * size, 2 * size, 6 * size, -11 * size, secondary, 0.7),
    ];
    fins.forEach((fin) => fin.setLineWidth(2.5 * size));
    const icon = scene.add.text(0, 18 * size, entry.icon ?? '👽', {
        fontFamily: 'Apple Color Emoji, Segoe UI Emoji, sans-serif',
        fontSize: `${Math.max(16, 20 * size)}px`,
    }).setOrigin(0.5, 0);
    container.add([glowOrb, hull, core, ...fins, icon]);
    return container;
};

export const SkinRenderPreview: React.FC<SkinRenderPreviewProps> = ({ skinId }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const stageViewportRef = useRef<HTMLDivElement | null>(null);
    const selectorPaneRef = useRef<HTMLDivElement | null>(null);
    const previewRenderTokenRef = useRef(0);
    const [fitZoom, setFitZoom] = useState(0.5);
    const [manualZoom, setManualZoom] = useState<number | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(true);
    const [selectedPreview, setSelectedPreview] = useState<PreviewSelection>({ kind: 'unit', type: DEFAULT_ATTACK_PREVIEW_UNIT });
    const [buildingVariantByType, setBuildingVariantByType] = useState<Partial<Record<BuildingType, string>>>({
        base: 'base_tier_1',
    });
    const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);

    const selectedBuildingVariantId = selectedPreview.kind === 'building' ? buildingVariantByType[selectedPreview.type] : undefined;
    const selectedDescriptor = useMemo(
        () => getPreviewDescriptor(selectedPreview, selectedBuildingVariantId),
        [selectedPreview, selectedBuildingVariantId]
    );
    const previewHeight = useMemo(() => STAGE_TOP_PADDING + selectedDescriptor.stageHeight + STAGE_BOTTOM_PADDING, [selectedDescriptor.stageHeight]);
    const effectiveZoom = clampZoom(manualZoom ?? Math.max(fitZoom, AUTO_MIN_ZOOM));

    useEffect(() => {
        const viewport = stageViewportRef.current;
        if (!viewport) return;

        const updateViewportLayout = () => {
            const widthBudget = Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, viewport.clientWidth - 16));
            setPreviewWidth(widthBudget);
            const nextFit = clampZoom(Math.min(
                (viewport.clientWidth - 16) / widthBudget,
                (viewport.clientHeight - 16) / previewHeight
            ));
            setFitZoom(nextFit);
            setManualZoom((current) => (current === null ? null : clampZoom(current)));
        };

        updateViewportLayout();
        const observer = new ResizeObserver(updateViewportLayout);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [previewHeight]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const renderToken = previewRenderTokenRef.current + 1;
        previewRenderTokenRef.current = renderToken;
        setIsPreviewLoading(true);
        let disposed = false;

        const markPreviewReady = () => {
            if (disposed || previewRenderTokenRef.current !== renderToken) {
                return;
            }
            window.requestAnimationFrame(() => {
                if (!disposed && previewRenderTokenRef.current === renderToken) {
                    setIsPreviewLoading(false);
                }
            });
        };

        class SkinPreviewScene extends Phaser.Scene {
            constructor() {
                super('SkinPreviewScene');
            }

            create() {
                const sceneWidth = this.scale.width;
                const sceneHeight = this.scale.height;
                const descriptor = selectedDescriptor;
                const skinPalette = skinId !== 'default' ? SKIN_DEFINITIONS_BY_ID[skinId]?.palette : undefined;
                const theaterAccent = skinPalette?.glow
                    ?? (descriptor.kind === 'unit'
                        ? UNIT_ACCENTS[descriptor.unitType ?? DEFAULT_ATTACK_PREVIEW_UNIT]
                        : BUILDING_ACCENTS[descriptor.buildingType ?? 'tower']);
                const theaterHighlight = skinPalette?.secondary ?? 0xffffff;
                const usableWidth = sceneWidth - 48;
                const rowLeft = 24;
                const rowRight = rowLeft + usableWidth;
                const stageHeight = descriptor.stageHeight;
                const lowPerfPreview = descriptor.kind === 'unit'
                    && (
                        descriptor.unitType === 'mothership'
                        || descriptor.unitType === 'aircraft_carrier'
                        || descriptor.unitType === 'heavy_plane'
                        || descriptor.unitType === 'missile_launcher'
                        || descriptor.unitType === 'heavy_alien'
                    );

                this.cameras.main.setBackgroundColor('#081019');
                const background = this.add.graphics();
                for (let i = 0; i < 12; i += 1) {
                    const ratio = i / 11;
                    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                        Phaser.Display.Color.ValueToColor(0x081019),
                        Phaser.Display.Color.ValueToColor(0x1b2d41),
                        11,
                        i
                    );
                    background.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
                    background.fillRect(0, sceneHeight * ratio, sceneWidth, sceneHeight / 11 + 4);
                }
                background.lineStyle(1, 0xffffff, 0.024);
                for (let x = 0; x < sceneWidth; x += 72) background.lineBetween(x, 88, x, sceneHeight);
                for (let y = 88; y < sceneHeight; y += 72) background.lineBetween(0, y, sceneWidth, y);
                const glow = this.add.ellipse(sceneWidth / 2, sceneHeight / 2, sceneWidth * 0.84, sceneHeight * 0.78, 0xffd78f, 0.04);
                glow.setBlendMode(Phaser.BlendModes.ADD);

                const drawEnvironment = (
                    arenaLeft: number,
                    arenaTop: number,
                    arenaWidth: number,
                    arenaBottom: number,
                    mode: EnvironmentMode,
                    accent: number
                ) => {
                    const lane = this.add.graphics();
                    const arenaHeight = arenaBottom - arenaTop;
                    lane.fillStyle(0x09111b, 0.74);
                    lane.fillRoundedRect(arenaLeft, arenaTop, arenaWidth, arenaHeight, 24);

                    const grassStrip = () => {
                        lane.fillStyle(0x101b23, 0.98);
                        lane.fillRoundedRect(arenaLeft + 10, arenaTop + 12, arenaWidth - 20, arenaHeight - 22, 18);
                        lane.fillStyle(0x152630, 0.9);
                        lane.fillRoundedRect(arenaLeft + 14, arenaTop + 20, arenaWidth - 28, arenaHeight - 44, 16);
                        lane.fillStyle(0x324129, 0.94);
                        lane.fillRoundedRect(arenaLeft + 14, arenaBottom - 92, arenaWidth - 28, 62, 18);
                        lane.fillStyle(0x3b4c2c, 0.86);
                        lane.fillRoundedRect(arenaLeft + 14, arenaBottom - 58, arenaWidth - 28, 30, 14);
                        lane.fillStyle(0x7aa45b, 0.18);
                        for (let tuft = 0; tuft < 18; tuft += 1) {
                            const x = arenaLeft + 26 + tuft * ((arenaWidth - 52) / 18);
                            const height = 6 + (tuft % 4);
                            lane.fillTriangle(x, arenaBottom - 30, x + 3, arenaBottom - 30 - height, x + 6, arenaBottom - 30);
                        }
                    };

                    const waterFill = () => {
                        lane.fillStyle(0x0d2135, 0.98);
                        lane.fillRoundedRect(arenaLeft + 10, arenaTop + 12, arenaWidth - 20, arenaHeight - 22, 18);
                        lane.fillStyle(0x12324a, 1);
                        lane.fillRoundedRect(arenaLeft + 14, arenaTop + 20, arenaWidth - 28, arenaHeight - 44, 16);
                        lane.fillStyle(0x22506b, 0.66);
                        lane.fillRoundedRect(arenaLeft + 14, arenaTop + 20, arenaWidth - 28, arenaHeight - 110, 16);
                        lane.fillStyle(0x173549, 0.92);
                        lane.fillRoundedRect(arenaLeft + 14, arenaBottom - 64, arenaWidth - 28, 36, 14);
                        lane.lineStyle(2, 0x7ed8ff, 0.09);
                        for (let wave = 0; wave < 6; wave += 1) {
                            const yWave = arenaTop + 38 + wave * 30;
                            const points = [
                                new Phaser.Math.Vector2(arenaLeft + 28, yWave),
                                new Phaser.Math.Vector2(arenaLeft + arenaWidth * 0.34, yWave - 10),
                                new Phaser.Math.Vector2(arenaLeft + arenaWidth * 0.52, yWave + 6),
                                new Phaser.Math.Vector2(arenaLeft + arenaWidth * 0.72, yWave - 10),
                                new Phaser.Math.Vector2(arenaLeft + arenaWidth - 28, yWave),
                            ];
                            lane.strokePoints(points, false, false);
                        }
                    };

                    if (mode === 'water' || mode === 'oil_water') {
                        waterFill();
                    } else if (mode === 'shore') {
                        lane.fillStyle(0x101a23, 0.98);
                        lane.fillRoundedRect(arenaLeft + 10, arenaTop + 12, arenaWidth - 20, arenaHeight - 22, 18);
                        lane.fillStyle(0x21352d, 0.92);
                        lane.fillRoundedRect(arenaLeft + 14, arenaTop + 20, (arenaWidth - 32) * 0.46, arenaHeight - 44, 16);
                        lane.fillStyle(0x12324a, 0.96);
                        lane.fillRoundedRect(arenaLeft + 14 + (arenaWidth - 32) * 0.44, arenaTop + 20, (arenaWidth - 32) * 0.56, arenaHeight - 44, 16);
                        lane.lineStyle(3, 0xb7d9f0, 0.18);
                        lane.beginPath();
                        lane.moveTo(arenaLeft + arenaWidth * 0.44, arenaTop + 34);
                        lane.lineTo(arenaLeft + arenaWidth * 0.49, arenaBottom - 36);
                        lane.strokePath();
                    } else if (mode === 'bridge') {
                        grassStrip();
                        lane.fillStyle(0x132b43, 0.8);
                        lane.fillRoundedRect(arenaLeft + arenaWidth * 0.36, arenaTop + 18, arenaWidth * 0.28, arenaHeight - 52, 12);
                        lane.fillStyle(0xb99d62, 0.88);
                        lane.fillRoundedRect(arenaLeft + arenaWidth * 0.35, arenaBottom - 72, arenaWidth * 0.3, 18, 9);
                    } else {
                        grassStrip();
                    }

                    const focalX = arenaLeft + arenaWidth * 0.54;
                    const focalY = arenaBottom - 72;
                    if (mode === 'gold') {
                        [
                            { x: focalX - 26, y: focalY + 6, r: 10 },
                            { x: focalX, y: focalY - 10, r: 12 },
                            { x: focalX + 22, y: focalY + 8, r: 9 },
                        ].forEach((node) => {
                            const glowNode = this.add.circle(node.x, node.y, node.r + 6, 0xffe189, 0.12);
                            glowNode.setBlendMode(Phaser.BlendModes.ADD);
                            this.add.circle(node.x, node.y, node.r, 0xf8c94b, 0.95).setStrokeStyle(2, 0x6a4b04, 0.72);
                        });
                    } else if (mode === 'grass') {
                        const patch = this.add.ellipse(focalX, focalY, 124, 54, 0x5a8c43, 0.38);
                        patch.setBlendMode(Phaser.BlendModes.ADD);
                        for (let i = 0; i < 20; i += 1) {
                            const x = focalX - 52 + i * 5.2;
                            const height = 8 + (i % 5);
                            lane.fillStyle(0x8ccc61, 0.3);
                            lane.fillTriangle(x, focalY + 18, x + 3, focalY + 18 - height, x + 6, focalY + 18);
                        }
                    } else if (mode === 'oil_land' || mode === 'oil_water') {
                        const slicks = [
                            { x: focalX - 18, y: focalY + 10, rX: 20, rY: 10 },
                            { x: focalX + 14, y: focalY - 2, rX: 18, rY: 9 },
                            { x: focalX + 36, y: focalY + 14, rX: 12, rY: 7 },
                        ];
                        slicks.forEach((slick) => {
                            this.add.ellipse(slick.x, slick.y, slick.rX * 2.2, slick.rY * 2.2, 0x232323, 0.16).setBlendMode(Phaser.BlendModes.ADD);
                            this.add.ellipse(slick.x, slick.y, slick.rX * 2, slick.rY * 2, 0x0f0f0f, 0.98).setStrokeStyle(1.6, 0x2b2b2b, 0.8);
                        });
                    }

                    const aura = this.add.ellipse(arenaLeft + arenaWidth * 0.52, arenaTop + arenaHeight * 0.46, arenaWidth * 0.62, arenaHeight * 0.62, accent, 0.055);
                    aura.setBlendMode(Phaser.BlendModes.ADD);
                    return { lane, aura, focalX, focalY, groundY: arenaBottom - 84 };
                };

                const createHpBar = (x: number, y: number, width: number, accent: number, maxHealth: number) => {
                    const back = this.add.graphics();
                    const deltaFill = this.add.graphics();
                    const fill = this.add.graphics();
                    const label = this.add.text(x + width / 2, y + 6, `${maxHealth}/${maxHealth}`, {
                        fontFamily: 'Trebuchet MS, sans-serif',
                        fontSize: '10px',
                        color: '#f8fbff',
                        fontStyle: 'bold',
                        stroke: '#02060c',
                        strokeThickness: 3,
                    }).setOrigin(0.5);
                    label.setDepth(3.1);
                    let previousRatio = 1;

                    const redraw = (ratio: number) => {
                        const clamped = Phaser.Math.Clamp(ratio, 0, 1);
                        const previous = Phaser.Math.Clamp(previousRatio, 0, 1);
                        const currentHealth = Math.max(0, Math.round(maxHealth * clamped));
                        const previousHealth = Math.max(0, Math.round(maxHealth * previous));
                        const previousWidth = Math.max(0, (width - 4) * previous);
                        const currentWidth = Math.max(0, (width - 4) * clamped);
                        const delta = currentHealth - previousHealth;
                        back.clear();
                        deltaFill.clear();
                        fill.clear();
                        back.fillStyle(0x02060c, 0.84);
                        back.fillRoundedRect(x, y, width, 12, 6);
                        back.lineStyle(1, 0x000000, 0.9);
                        back.strokeRoundedRect(x, y, width, 12, 6);
                        fill.fillStyle(accent, 0.95);
                        fill.fillRoundedRect(x + 2, y + 2, Math.max(6, currentWidth), 8, 4);
                        label.setText(`${currentHealth}/${maxHealth}`);

                        if (Math.abs(delta) > 0) {
                            const deltaWidth = Math.abs(previousWidth - currentWidth);
                            if (deltaWidth > 1.5) {
                                const isHealing = delta > 0;
                                const segmentX = x + 2 + (isHealing ? previousWidth : currentWidth);
                                deltaFill.fillStyle(isHealing ? 0x67f2a7 : 0xff8b6e, isHealing ? 0.88 : 0.82);
                                deltaFill.fillRoundedRect(segmentX, y + 2, deltaWidth, 8, 4);
                                this.tweens.add({
                                    targets: deltaFill,
                                    alpha: 0,
                                    duration: 440,
                                    ease: 'Sine.easeOut',
                                    onComplete: () => {
                                        deltaFill.setAlpha(1);
                                        deltaFill.clear();
                                    },
                                });
                            }

                            const deltaText = this.add.text(x + width / 2, y - 10, `${delta > 0 ? '+' : ''}${delta}`, {
                                fontFamily: 'Trebuchet MS, sans-serif',
                                fontSize: '13px',
                                color: delta > 0 ? '#8df7bf' : '#ffb29f',
                                fontStyle: 'bold',
                                stroke: '#081019',
                                strokeThickness: 4,
                            }).setOrigin(0.5).setDepth(3.2);
                            this.tweens.add({
                                targets: deltaText,
                                y: y - 24,
                                alpha: 0,
                                duration: 520,
                                ease: 'Sine.easeOut',
                                onComplete: () => deltaText.destroy(),
                            });
                        }

                        previousRatio = clamped;
                    };
                    redraw(1);
                    return { back, deltaFill, fill, label, redraw };
                };

                const createExplosionEffect = (style: Exclude<PreviewAttackStyle, 'support'>, x: number, yPos: number, radius = 20) => {
                    const scaledRadius = Math.max(10, radius);
                    const mixExplosionColor = (baseColor: number, skinColor: number, amount: number) => {
                        const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(
                            Phaser.Display.Color.ValueToColor(baseColor),
                            Phaser.Display.Color.ValueToColor(skinColor),
                            100,
                            amount
                        );
                        return Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b);
                    };

                    if (style === 'bullet' || style === 'sniper') {
                        const flash = this.add.circle(x, yPos, 4.5, 0xfff5cf, 0.95).setDepth(3);
                        const spark = this.add.rectangle(x, yPos, 10, 2.4, 0xffe2b2, 0.95).setDepth(3);
                        spark.setRotation(Math.PI / 4);
                        this.tweens.add({
                            targets: [flash, spark],
                            scale: 1.7,
                            alpha: 0,
                            duration: style === 'sniper' ? 130 : 110,
                            onComplete: () => {
                                flash.destroy();
                                spark.destroy();
                            },
                        });
                        return;
                    }

                    const effectColors: Record<Exclude<PreviewAttackStyle, 'support' | 'bullet' | 'sniper'>, { core: number; glow: number; ring: number; smoke?: number; sparks?: number[] }> = {
                        shell: { core: 0xffa457, glow: 0xffd79a, ring: 0xfff0cf, smoke: 0x38414a, sparks: [0xffc16b, 0xffe7b2] },
                        rocket: { core: 0xff7c42, glow: 0xffb067, ring: 0xffefcf, smoke: 0x31363f, sparks: [0xff6629, 0xffc24a] },
                        missile: { core: 0xff9254, glow: 0xffc56f, ring: 0xfff2d1, smoke: 0x353c45, sparks: [0xff8031, 0xffd66d] },
                        bomb: { core: 0xff7b2d, glow: 0xffb75f, ring: 0xffefc6, smoke: 0x2d333b, sparks: [0xff6629, 0xffcf62] },
                        beam: { core: theaterHighlight, glow: theaterAccent, ring: theaterHighlight, sparks: [theaterHighlight, theaterAccent] },
                    };
                    const defaults = effectColors[style];
                    const coreColor = skinPalette && skinId !== 'default' ? mixExplosionColor(defaults.core, skinPalette.primary, 66) : defaults.core;
                    const glowColor = skinPalette && skinId !== 'default' ? mixExplosionColor(defaults.glow, skinPalette.glow, 72) : defaults.glow;
                    const ringColor = skinPalette && skinId !== 'default' ? mixExplosionColor(defaults.ring, skinPalette.secondary, 62) : defaults.ring;
                    const smokeColor = skinPalette && skinId !== 'default' && defaults.smoke !== undefined ? mixExplosionColor(defaults.smoke, skinPalette.shadow, 38) : defaults.smoke;
                    const sparkColors = skinPalette && skinId !== 'default'
                        ? (defaults.sparks ?? [theaterAccent, theaterHighlight]).map((sparkColor) => mixExplosionColor(sparkColor, skinPalette.glow, 58))
                        : (defaults.sparks ?? []);
                    const burst = this.add.circle(x, yPos, scaledRadius * 0.62, coreColor, 0.96).setDepth(3.1);
                    const glowOrb = this.add.circle(x, yPos, scaledRadius, glowColor, style === 'beam' ? 0.28 : 0.36).setDepth(3);
                    const ring = this.add.circle(x, yPos, scaledRadius * 0.58, ringColor, 0).setDepth(3.2);
                    ring.setStrokeStyle(Math.max(2, scaledRadius * 0.12), ringColor, 0.95);
                    this.tweens.add({ targets: glowOrb, scale: style === 'bomb' ? 2.4 : style === 'missile' ? 2.1 : 1.8, alpha: 0, duration: style === 'bomb' ? 360 : 260, onComplete: () => glowOrb.destroy() });
                    this.tweens.add({ targets: burst, scale: style === 'bomb' ? 1.85 : 1.55, alpha: 0, duration: style === 'bomb' ? 280 : 220, onComplete: () => burst.destroy() });
                    this.tweens.add({ targets: ring, scale: style === 'bomb' ? 2.8 : style === 'missile' ? 2.3 : 2, alpha: 0, duration: style === 'bomb' ? 330 : 260, onComplete: () => ring.destroy() });
                    if (smokeColor) {
                        const smoke = this.add.circle(x, yPos, scaledRadius * 0.45, smokeColor, 0.55).setDepth(2.9);
                        this.tweens.add({ targets: smoke, y: yPos - scaledRadius * 0.42, scale: 2.15, alpha: 0, duration: 420, onComplete: () => smoke.destroy() });
                    }
                    const sparkCount = lowPerfPreview ? Math.min(2, sparkColors.length) : sparkColors.length;
                    sparkColors.slice(0, sparkCount).forEach((sparkColor, index) => {
                        const spark = this.add.circle(x, yPos, Math.max(2.2, scaledRadius * 0.1), sparkColor, 0.92).setDepth(3.3);
                        const sparkAngle = (-Math.PI / 2) + ((Math.PI * 2 * index) / Math.max(1, sparkCount));
                        this.tweens.add({
                            targets: spark,
                            x: x + Math.cos(sparkAngle + Math.random() * 0.4) * Phaser.Math.Between(Math.round(scaledRadius * 0.8), Math.round(scaledRadius * 1.7)),
                            y: yPos + Math.sin(sparkAngle + Math.random() * 0.4) * Phaser.Math.Between(Math.round(scaledRadius * 0.8), Math.round(scaledRadius * 1.7)),
                            scale: 0.2,
                            alpha: 0,
                            duration: 180,
                            onComplete: () => spark.destroy(),
                        });
                    });
                };

                const playPreviewBeam = (originX: number, originY: number, targetX: number, targetY: number, radius: number) => {
                    const beam = this.add.graphics().setDepth(2.2);
                    const impact = this.add.container(targetX, targetY).setDepth(2.35);
                    const coverRadius = Math.max(20, radius * 0.9);
                    const impactGlow = this.add.circle(0, 0, coverRadius * 1.15, theaterAccent, 0.28);
                    impactGlow.setBlendMode(Phaser.BlendModes.ADD);
                    const impactBurst = this.add.circle(0, 0, coverRadius * 0.68, theaterHighlight, 0.52);
                    const impactCore = this.add.circle(0, 0, coverRadius * 0.34, 0xffffff, 0.92);
                    const impactRing = this.add.circle(0, 0, coverRadius * 0.88, theaterAccent, 0);
                    impactRing.setStrokeStyle(Math.max(2.2, coverRadius * 0.12), theaterAccent, 0.94);
                    impact.add([impactGlow, impactBurst, impactRing, impactCore]);
                    const state = { width: 8, auraPulse: 1, alpha: 1 };
                    const draw = () => {
                        beam.clear();
                        const dx = targetX - originX;
                        const dy = targetY - originY;
                        const len = Math.max(1, Math.hypot(dx, dy));
                        const nx = dx / len;
                        const ny = dy / len;
                        const endX = targetX - nx * (coverRadius * 0.44);
                        const endY = targetY - ny * (coverRadius * 0.44);
                        beam.lineStyle(state.width * (2.7 + state.auraPulse * 0.46), theaterAccent, state.alpha * 0.18);
                        beam.beginPath(); beam.moveTo(originX, originY); beam.lineTo(endX, endY); beam.strokePath();
                        beam.lineStyle(state.width * (1.84 + state.auraPulse * 0.24), theaterAccent, state.alpha * 0.34);
                        beam.beginPath(); beam.moveTo(originX, originY); beam.lineTo(endX, endY); beam.strokePath();
                        beam.lineStyle(state.width, theaterAccent, state.alpha * 0.96);
                        beam.beginPath(); beam.moveTo(originX, originY); beam.lineTo(endX, endY); beam.strokePath();
                        beam.lineStyle(Math.max(2, state.width * 0.34), theaterHighlight, state.alpha);
                        beam.beginPath(); beam.moveTo(originX, originY); beam.lineTo(endX, endY); beam.strokePath();
                    };
                    draw();
                    const widthTween = this.tweens.add({
                        targets: state,
                        width: { from: 6.8, to: 10.8 },
                        auraPulse: { from: 0.78, to: 1.18 },
                        duration: lowPerfPreview ? 180 : 150,
                        yoyo: true,
                        repeat: lowPerfPreview ? 2 : 4,
                        ease: 'Sine.easeInOut',
                        onUpdate: draw
                    });
                    const impactTween = this.tweens.add({
                        targets: [impactGlow, impactBurst, impactRing, impactCore],
                        alpha: { from: 0.4, to: 1 },
                        scale: { from: 0.86, to: 1.18 },
                        duration: lowPerfPreview ? 180 : 150,
                        yoyo: true,
                        repeat: lowPerfPreview ? 1 : 3,
                        ease: 'Sine.easeInOut'
                    });
                    this.time.delayedCall(420, () => {
                        widthTween.stop();
                        impactTween.stop();
                        this.tweens.add({
                            targets: state,
                            alpha: 0,
                            duration: 180,
                            ease: 'Quad.easeOut',
                            onUpdate: draw,
                            onComplete: () => beam.destroy(),
                        });
                        this.tweens.add({
                            targets: impact,
                            alpha: 0,
                            duration: 180,
                            ease: 'Quad.easeOut',
                            onComplete: () => impact.destroy(),
                        });
                    });
                };

                const createRecruitPreviewArt = (entry: RecruitRosterEntry, x: number, y: number, scale = 0.82) => {
                    if (entry.renderType && isRenderableUnitType(entry.renderType)) {
                        const art = createUnitArt(this, x, y, entry.renderType, UNIT_ACCENTS[entry.renderType], false, { skinId });
                        applySkinToArtContainer(this, art, skinId, 'unit');
                        const artScale = Math.max(0.5, getUnitArtScale(entry.renderType) * scale);
                        art.setScale(artScale);
                        art.setData('baseScale', artScale);
                        return art;
                    }
                    return createAlienPlaceholderArt(this, x, y, entry, skinId, scale);
                };

                const renderUnitCombatStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const config = descriptor.combatConfig!;
                    const unitType = descriptor.unitType!;
                    const { lane, aura, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const waterMode = descriptor.habitat === 'water';
                    const laneBottom = arenaBottom;
                    const stageDistance = getAttackPreviewDistance(config.range, arenaWidth);
                    const unitX = arenaLeft + 130;
                    const primaryTargetX = Math.min(unitX + stageDistance, arenaLeft + arenaWidth - 136);
                    const primaryTargetY = waterMode ? groundY - 8 : groundY - 16;
                    const unitY = waterMode
                        ? groundY + (unitType === 'aircraft_carrier' ? 12 : 2)
                        : (unitType === 'light_plane' || unitType === 'heavy_plane' || unitType === 'mothership')
                            ? groundY - 96
                            : groundY;

                    const unitShadow = this.add.ellipse(unitX, groundY + 18, unitType === 'mothership' ? 116 : unitType === 'aircraft_carrier' ? 124 : 72, unitType === 'mothership' ? 28 : 16, 0x000000, 0.18);
                    const unitArt = createUnitArt(this, unitX, unitY, unitType, UNIT_ACCENTS[unitType], false, { skinId });
                    applySkinToArtContainer(this, unitArt, skinId, 'unit');
                    const unitScale = getUnitAttackPreviewScale(unitType);
                    unitArt.setScale(unitScale);
                    unitArt.setData('baseScale', unitScale);
                    applyPreviewFacing(unitArt, Math.atan2(primaryTargetY - unitArt.y, primaryTargetX - unitArt.x));
                    this.tweens.add({ targets: unitArt, y: unitArt.y - (waterMode ? 4 : 6), duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

                    if (waterMode) {
                        const wakeGlow = this.add.ellipse(unitX - 18, groundY + 16, 120, 26, theaterAccent, 0.1);
                        wakeGlow.setBlendMode(Phaser.BlendModes.ADD);
                        this.tweens.add({ targets: wakeGlow, scaleX: { from: 0.94, to: 1.08 }, alpha: { from: 0.06, to: 0.12 }, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
                    }

                    type PreviewDummy = {
                        x: number;
                        y: number;
                        art: Phaser.GameObjects.Container;
                        shadow: Phaser.GameObjects.Ellipse;
                        hp: ReturnType<typeof createHpBar>;
                        maxHealth: number;
                        health: number;
                        pendingRespawn: boolean;
                        radiationExpiries: number[];
                        radiationLabel: Phaser.GameObjects.Text;
                    };

                    const aoeRadius = unitType === 'heavy_plane'
                        ? 90
                        : unitType === 'aircraft_carrier'
                            ? 150
                            : 0;
                    const radiationRadius = unitType === 'mothership' ? 115 : 0;
                    const isAoeUnit = aoeRadius > 0 || radiationRadius > 0;
                    const dummyOffsets = isAoeUnit
                        ? [
                            { x: 0, y: 0 },
                            { x: 56, y: -28 },
                            { x: 70, y: 24 },
                            { x: -46, y: 20 },
                        ]
                        : [{ x: 0, y: 0 }];
                    const dummyMaxHealth = unitType === 'mothership' ? 1500 : (isAoeUnit ? 1100 : 900);

                    const dummies: PreviewDummy[] = dummyOffsets.map((offset, index) => {
                        const x = primaryTargetX + offset.x;
                        const y = primaryTargetY + offset.y;
                        const art = createBuildingArt(this, x, y, 'bridge_node', 0x8ea3b3, createPreviewBuildingData('bridge_node'));
                        art.setScale(index === 0 ? 1.72 : 1.46);
                        const shadow = this.add.ellipse(x, groundY + 18, index === 0 ? 130 : 110, index === 0 ? 22 : 18, 0x000000, index === 0 ? 0.16 : 0.12);
                        const hp = createHpBar(
                            x - 54,
                            y - 74,
                            108,
                            unitType === 'mothership' ? theaterAccent : 0x8fd16f,
                            dummyMaxHealth
                        );
                        const radiationLabel = this.add.text(x, y - 92, '', {
                            fontFamily: 'Trebuchet MS, sans-serif',
                            fontSize: '14px',
                            color: '#d8ff98',
                            fontStyle: 'bold',
                            stroke: '#081019',
                            strokeThickness: 4,
                        }).setOrigin(0.5).setDepth(3.4).setVisible(false);
                        return {
                            x,
                            y,
                            art,
                            shadow,
                            hp,
                            maxHealth: dummyMaxHealth,
                            health: dummyMaxHealth,
                            pendingRespawn: false,
                            radiationExpiries: [],
                            radiationLabel,
                        };
                    });

                    const primaryDummy = dummies[0];
                    const rangeRule = this.add.graphics();
                    rangeRule.lineStyle(2, 0xffffff, 0.08);
                    rangeRule.lineBetween(unitX + 30, laneBottom - 44, primaryDummy.x - 30, laneBottom - 44);
                    rangeRule.lineStyle(2, theaterAccent, 0.36);
                    rangeRule.lineBetween(unitX + 30, laneBottom - 44, primaryDummy.x - 30, laneBottom - 44);
                    rangeRule.lineStyle(1, 0xffffff, 0.22);
                    rangeRule.lineBetween(unitX + 30, laneBottom - 52, unitX + 30, laneBottom - 36);
                    rangeRule.lineBetween(primaryDummy.x - 30, laneBottom - 52, primaryDummy.x - 30, laneBottom - 36);
                    this.add.text((unitX + primaryDummy.x) / 2, laneBottom - 62, `Range Lane • ${config.range}`, {
                        fontFamily: 'Trebuchet MS, sans-serif',
                        fontSize: '12px',
                        color: '#d7e3ea',
                    }).setOrigin(0.5);

                    const refreshRadiationLabel = (dummy: PreviewDummy) => {
                        const now = this.time.now;
                        dummy.radiationExpiries = dummy.radiationExpiries.filter((end) => end > now);
                        const stacks = dummy.radiationExpiries.length;
                        if (stacks <= 0) {
                            dummy.radiationLabel.setVisible(false);
                            return;
                        }
                        dummy.radiationLabel.setText(`☢ x${stacks}`);
                        dummy.radiationLabel.setVisible(true);
                    };

                    const shakeDummy = (dummy: PreviewDummy, strength = 4.5, duration = 70) => {
                        const state = { dx: 0 };
                        this.tweens.add({
                            targets: state,
                            dx: strength,
                            duration,
                            yoyo: true,
                            repeat: 1,
                            onUpdate: () => {
                                dummy.art.setX(dummy.x + state.dx);
                                dummy.hp.back.setX(state.dx);
                                dummy.hp.fill.setX(state.dx);
                                dummy.hp.deltaFill.setX(state.dx);
                                dummy.hp.label.setX(dummy.x + state.dx + 54);
                                dummy.radiationLabel.setX(dummy.x + state.dx);
                            },
                            onComplete: () => {
                                dummy.art.setX(dummy.x);
                                dummy.hp.back.setX(0);
                                dummy.hp.fill.setX(0);
                                dummy.hp.deltaFill.setX(0);
                                dummy.hp.label.setX(dummy.x + 54);
                                dummy.radiationLabel.setX(dummy.x);
                            },
                        });
                    };

                    const applyDamageToDummy = (dummy: PreviewDummy, damageAmount: number) => {
                        if (damageAmount <= 0 || dummy.pendingRespawn) return;
                        const nextHealth = Math.max(0, dummy.health - damageAmount);
                        if (nextHealth === dummy.health) return;
                        dummy.health = nextHealth;
                        dummy.hp.redraw(dummy.health / dummy.maxHealth);
                        shakeDummy(dummy);

                        if (dummy.health <= 0 && !dummy.pendingRespawn) {
                            dummy.pendingRespawn = true;
                            this.tweens.add({ targets: [dummy.art, dummy.shadow], alpha: 0.28, duration: 180, ease: 'Sine.easeOut' });
                            this.time.delayedCall(780, () => {
                                if (!dummy.art.scene) return;
                                dummy.health = dummy.maxHealth;
                                dummy.hp.redraw(1);
                                dummy.radiationExpiries = [];
                                refreshRadiationLabel(dummy);
                                dummy.pendingRespawn = false;
                                this.tweens.add({ targets: [dummy.art, dummy.shadow], alpha: 1, duration: 220, ease: 'Sine.easeIn' });
                            });
                        }
                    };

                    const showAoeRing = (x: number, y: number, radius: number) => {
                        if (radius <= 0) return;
                        const ring = this.add.circle(x, y, radius, theaterAccent, 0).setDepth(2.8);
                        ring.setStrokeStyle(Math.max(2, radius * 0.05), theaterAccent, 0.42);
                        this.tweens.add({
                            targets: ring,
                            alpha: 0,
                            scale: 1.14,
                            duration: 340,
                            onStart: () => ring.setAlpha(1),
                            onComplete: () => ring.destroy(),
                        });
                    };

                    const applyImpactDamage = (impactX: number, impactY: number, damageAmount: number, radius: number = 0) => {
                        dummies.forEach((dummy, index) => {
                            if (radius <= 0) {
                                if (index !== 0) return;
                            } else if (Math.hypot(dummy.x - impactX, dummy.y - impactY) > radius) {
                                return;
                            }
                            applyDamageToDummy(dummy, damageAmount);
                        });
                    };

                    const addRadiationStacks = (impactX: number, impactY: number) => {
                        if (radiationRadius <= 0) return;
                        showAoeRing(impactX, impactY, radiationRadius);
                        const now = this.time.now;
                        dummies.forEach((dummy) => {
                            if (Math.hypot(dummy.x - impactX, dummy.y - impactY) > radiationRadius) return;
                            dummy.radiationExpiries.push(now + 5000);
                            refreshRadiationLabel(dummy);
                        });
                    };

                    const radiationTickDelayMs = lowPerfPreview ? 180 : 100;
                    this.time.addEvent({
                        delay: radiationTickDelayMs,
                        loop: true,
                        callback: () => {
                            dummies.forEach((dummy) => {
                                refreshRadiationLabel(dummy);
                                const stacks = dummy.radiationExpiries.length;
                                if (stacks > 0) {
                                    applyDamageToDummy(dummy, stacks * 4 * (radiationTickDelayMs / 1000));
                                }
                            });
                        },
                    });

                    const playAttackLoop = () => {
                        const liveTargetX = primaryDummy.art.x;
                        const liveTargetY = primaryDummy.art.y;
                        const impactY = liveTargetY - 6;
                        const attackFacing = Math.atan2(liveTargetY - unitArt.y, liveTargetX - unitArt.x);
                        applyPreviewFacing(unitArt, attackFacing);
                        const weaponOrigin = getPreviewWeaponOrigin(unitArt, unitType);
                        const muzzleX = weaponOrigin.x;
                        const muzzleY = weaponOrigin.y;

                        switch (config.attackStyle) {
                            case 'beam': {
                                const beamRadius = Math.max(36, (config.explosionRadius ?? 56) * 0.92);
                                playPreviewBeam(muzzleX, muzzleY, liveTargetX, impactY, beamRadius);
                                if (unitType === 'mothership') {
                                    const tickCount = lowPerfPreview ? 6 : 10;
                                    for (let tick = 0; tick < tickCount; tick += 1) {
                                        this.time.delayedCall(tick * 100, () => {
                                            applyImpactDamage(liveTargetX, impactY, 25, 0);
                                            createExplosionEffect('beam', liveTargetX, impactY, Math.max(24, beamRadius * 0.58));
                                            addRadiationStacks(liveTargetX, impactY);
                                        });
                                    }
                                } else {
                                    applyImpactDamage(liveTargetX, impactY, config.damage, 0);
                                    createExplosionEffect('beam', liveTargetX, impactY, Math.max(24, beamRadius * 0.64));
                                }
                                break;
                            }
                            case 'missile':
                            case 'rocket': {
                                const explosiveStyle: 'missile' | 'rocket' = config.attackStyle;
                                const burstShots = Math.max(1, config.burstShots ?? 1);
                                const burstInterval = config.burstIntervalMs ?? 0;
                                const splashRadius = unitType === 'aircraft_carrier' ? 150 : 0;
                                const launchOne = () => {
                                    const liveWeaponOrigin = getPreviewWeaponOrigin(unitArt, unitType);
                                    const rocket = this.add.rectangle(liveWeaponOrigin.x, liveWeaponOrigin.y, explosiveStyle === 'missile' ? 18 : 14, 5, explosiveStyle === 'missile' ? 0xadb8c8 : 0x66717c, 1);
                                    rocket.setStrokeStyle(1, 0x081019, 0.9);
                                    rocket.setRotation(Math.atan2(impactY - liveWeaponOrigin.y, liveTargetX - liveWeaponOrigin.x));
                                    rocket.setDepth(2.1);
                                    const trail = this.add.circle(liveWeaponOrigin.x - 12, liveWeaponOrigin.y, 7, skinPalette?.glow ?? 0xffa95c, 0.24).setDepth(1.9);
                                    this.tweens.add({
                                        targets: [rocket, trail],
                                        x: liveTargetX,
                                        y: impactY,
                                        duration: explosiveStyle === 'missile' ? 620 : 520,
                                        ease: 'Sine.easeOut',
                                        onComplete: () => {
                                            rocket.destroy();
                                            trail.destroy();
                                            applyImpactDamage(liveTargetX, impactY, config.damage, splashRadius);
                                            if (splashRadius > 0) showAoeRing(liveTargetX, impactY, splashRadius);
                                            createExplosionEffect(explosiveStyle, liveTargetX, impactY, Math.max(20, (config.explosionRadius ?? 32) * (explosiveStyle === 'missile' ? 0.86 : 0.7)));
                                        },
                                    });
                                    this.tweens.add({ targets: trail, scale: 2, alpha: 0, duration: explosiveStyle === 'missile' ? 620 : 520 });
                                };
                                for (let shotIndex = 0; shotIndex < burstShots; shotIndex += 1) {
                                    this.time.delayedCall(shotIndex * burstInterval, launchOne);
                                }
                                break;
                            }
                            case 'bomb': {
                                const bomb = this.add.circle(muzzleX, muzzleY - 22, 5, 0x505966, 1).setDepth(2.1);
                                bomb.setStrokeStyle(1, 0x0d1217, 0.9);
                                const shadow = this.add.ellipse(liveTargetX, groundY + 10, 26, 10, 0x000000, 0.16).setDepth(1.2);
                                shadow.setScale(0.4);
                                const arc = new Phaser.Curves.QuadraticBezier(
                                    new Phaser.Math.Vector2(muzzleX, muzzleY - 22),
                                    new Phaser.Math.Vector2((muzzleX + liveTargetX) / 2, muzzleY - 90),
                                    new Phaser.Math.Vector2(liveTargetX, impactY)
                                );
                                const state = { t: 0 };
                                this.tweens.add({ targets: shadow, scaleX: 1, scaleY: 1, alpha: 0.24, duration: 620 });
                                this.tweens.add({
                                    targets: state,
                                    t: 1,
                                    duration: 620,
                                    onUpdate: () => {
                                        const point = arc.getPoint(state.t);
                                        bomb.setPosition(point.x, point.y);
                                    },
                                    onComplete: () => {
                                        shadow.destroy();
                                        bomb.destroy();
                                        const splashRadius = 90;
                                        applyImpactDamage(liveTargetX, impactY, config.damage, splashRadius);
                                        showAoeRing(liveTargetX, impactY, splashRadius);
                                        createExplosionEffect('bomb', liveTargetX, impactY, Math.max(30, (config.explosionRadius ?? 90) * 0.62));
                                    },
                                });
                                break;
                            }
                            case 'shell': {
                                const shell = this.add.circle(muzzleX, muzzleY, 4, 0xd1d8de, 1).setDepth(2.1);
                                shell.setStrokeStyle(1, 0x081019, 0.9);
                                this.tweens.add({
                                    targets: shell,
                                    x: liveTargetX,
                                    y: impactY,
                                    duration: 300,
                                    ease: 'Linear',
                                    onComplete: () => {
                                        shell.destroy();
                                        applyImpactDamage(liveTargetX, impactY, config.damage, 0);
                                        createExplosionEffect('shell', liveTargetX, impactY, Math.max(16, (config.explosionRadius ?? 22) * 0.68));
                                    },
                                });
                                break;
                            }
                            case 'sniper': {
                                const tracer = this.add.graphics().setDepth(2.1);
                                tracer.lineStyle(3, 0xf4fbff, 0.98);
                                tracer.beginPath();
                                tracer.moveTo(muzzleX, muzzleY);
                                tracer.lineTo(liveTargetX, impactY);
                                tracer.strokePath();
                                this.tweens.add({ targets: tracer, alpha: 0, duration: 180, onComplete: () => tracer.destroy() });
                                applyImpactDamage(liveTargetX, impactY, config.damage, 0);
                                createExplosionEffect('sniper', liveTargetX, impactY, 10);
                                break;
                            }
                            case 'bullet': {
                                const isAlienScout = unitType === 'alien_scout';
                                const isHeavyAlien = unitType === 'heavy_alien';
                                if (isAlienScout || isHeavyAlien) {
                                    const plasma = this.add.container(muzzleX, muzzleY).setDepth(2.1);
                                    plasma.setRotation(Math.atan2(impactY - muzzleY, liveTargetX - muzzleX));
                                    const plasmaGlow = this.add.circle(0, 0, isHeavyAlien ? 8.5 : 5.8, skinPalette?.glow ?? theaterAccent, isHeavyAlien ? 0.26 : 0.22);
                                    plasmaGlow.setBlendMode(Phaser.BlendModes.ADD);
                                    const plasmaShell = this.add.circle(0, 0, isHeavyAlien ? 4.8 : 3.4, skinPalette?.glow ?? theaterAccent, 0.9);
                                    plasmaShell.setStrokeStyle(1, skinPalette?.secondary ?? theaterHighlight, 0.82);
                                    const plasmaCore = this.add.circle(0, 0, isHeavyAlien ? 2.4 : 1.8, skinPalette?.secondary ?? 0xffffff, 0.96);
                                    const plasmaSpine = this.add.rectangle(isHeavyAlien ? -3 : -2, 0, isHeavyAlien ? 6.2 : 4.2, isHeavyAlien ? 1.5 : 1.1, skinPalette?.secondary ?? theaterHighlight, 0.72);
                                    plasma.add([plasmaGlow, plasmaShell, plasmaSpine, plasmaCore]);
                                    this.tweens.add({
                                        targets: plasma,
                                        x: liveTargetX,
                                        y: impactY,
                                        duration: isHeavyAlien ? 170 : 120,
                                        ease: 'Linear',
                                        onUpdate: () => {
                                            plasmaGlow.setScale(1 + Math.sin(this.time.now * 0.03) * 0.08);
                                        },
                                        onComplete: () => {
                                            plasma.destroy();
                                            applyImpactDamage(liveTargetX, impactY, config.damage, 0);
                                            createExplosionEffect(isHeavyAlien ? 'beam' : 'bullet', liveTargetX, impactY, isHeavyAlien ? 18 : 10);
                                        },
                                    });
                                    break;
                                }

                                const bullet = this.add.circle(muzzleX, muzzleY, 2.6, 0xffe4a8, 1).setDepth(2.1);
                                bullet.setStrokeStyle(1, 0x271a04, 0.6);
                                this.tweens.add({
                                    targets: bullet,
                                    x: liveTargetX,
                                    y: impactY,
                                    duration: 120,
                                    ease: 'Linear',
                                    onComplete: () => {
                                        bullet.destroy();
                                        applyImpactDamage(liveTargetX, impactY, config.damage, 0);
                                        createExplosionEffect('bullet', liveTargetX, impactY, 8);
                                    },
                                });
                                break;
                            }
                            default:
                                break;
                        }
                    };

                    const burstWindowMs = (config.burstShots && config.burstIntervalMs) ? (config.burstShots - 1) * config.burstIntervalMs : 0;
                    const attackLoopDelay = unitType === 'mothership'
                        ? 1200
                        : Math.max(config.fireRateMs + burstWindowMs, config.attackStyle === 'beam' ? 260 : 180);
                    this.time.addEvent({ delay: attackLoopDelay, loop: true, callback: playAttackLoop });
                    this.time.delayedCall(260, playAttackLoop);
                    return { lane, aura, unitArt, target: primaryDummy.art, targetShadow: primaryDummy.shadow, unitShadow };
                };

                const renderBuildingAttackStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, groundY, focalX } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const buildingType = descriptor.buildingType!;
                    const stats = descriptor.buildingStats ?? BUILDING_STATS[buildingType];
                    const sourceX = buildingType === 'naval_mine' ? focalX : arenaLeft + 150;
                    const sourceY = buildingType === 'naval_mine' ? groundY + 2 : (descriptor.environmentMode === 'water' ? groundY - 10 : groundY - 18);
                    const sourceArt = createBuildingArt(this, sourceX, sourceY, buildingType, BUILDING_ACCENTS[buildingType], createPreviewBuildingData(buildingType, stats));
                    applySkinToArtContainer(this, sourceArt, skinId, 'building');
                    sourceArt.setScale(buildingType === 'naval_mine' ? 1.3 : 1.46);
                    const targetType: RenderableUnitType = descriptor.attackTargetType === 'destroyer' ? 'destroyer' : 'soldier';
                    const targetX = buildingType === 'naval_mine' ? sourceX + 180 : Math.min(sourceX + getAttackPreviewDistance(stats.range ?? 180, arenaWidth), arenaLeft + arenaWidth - 128);
                    const targetY = descriptor.environmentMode === 'water' ? groundY - 6 : groundY;
                    const targetConfig = ATTACK_PREVIEW_CONFIG[targetType];
                    const targetMaxHealth = getPreviewSurvivableHealth(targetConfig.health, stats.damage ?? 0);
                    const targetArt = createUnitArt(this, targetX, targetY, targetType, UNIT_ACCENTS[targetType], false, { skinId: 'default' });
                    const targetScale = targetType === 'destroyer' ? 1.8 : 1.92;
                    targetArt.setScale(targetScale);
                    targetArt.setData('baseScale', targetScale);
                    applyPreviewFacing(targetArt, Math.PI);
                    const hp = createHpBar(
                        targetX - 50,
                        targetY - (targetType === 'destroyer' ? 48 : 42),
                        100,
                        0x8fd16f,
                        targetMaxHealth
                    );
                    let targetHealth = targetMaxHealth;
                    let pendingRespawn = false;

                    const applyTargetDamage = (damageAmount: number) => {
                        if (pendingRespawn || damageAmount <= 0) return;
                        targetHealth = Math.max(0, targetHealth - damageAmount);
                        hp.redraw(targetHealth / targetMaxHealth);
                        this.tweens.add({
                            targets: targetArt,
                            x: targetX - 5,
                            duration: 46,
                            yoyo: true,
                            repeat: 1,
                            ease: 'Sine.easeOut',
                            onComplete: () => targetArt.setX(targetX),
                        });

                        if (targetHealth <= 0) {
                            pendingRespawn = true;
                            this.tweens.add({ targets: targetArt, alpha: 0.24, duration: 150, ease: 'Sine.easeOut' });
                            this.time.delayedCall(760, () => {
                                if (!targetArt.scene) return;
                                targetHealth = targetMaxHealth;
                                hp.redraw(1);
                                targetArt.setAlpha(1);
                                pendingRespawn = false;
                            });
                        }
                    };

                    const playFire = () => {
                        if (pendingRespawn) return;
                        if (buildingType === 'naval_mine') {
                            const minePulse = this.add.circle(sourceX, sourceY, 10, theaterAccent, 0.22).setDepth(2.1);
                            this.tweens.add({ targets: minePulse, scale: 5.5, alpha: 0, duration: 320, onComplete: () => minePulse.destroy() });
                            this.time.delayedCall(210, () => {
                                createExplosionEffect('bomb', sourceX + 32, sourceY + 2, 70);
                                applyTargetDamage(stats.damage ?? 500);
                            });
                            return;
                        }
                        const targetPosX = targetArt.x;
                        const targetPosY = targetArt.y;
                        const origin = getPreviewBuildingOrigin(sourceArt, buildingType);
                        if (buildingType === 'base' && stats.hasTesla) {
                            const arc = this.add.graphics().setDepth(2.1);
                            arc.lineStyle(9, theaterAccent, 0.16);
                            arc.beginPath(); arc.moveTo(origin.x, origin.y); arc.lineTo(targetPosX, targetPosY); arc.strokePath();
                            arc.lineStyle(4.8, theaterAccent, 0.9);
                            arc.beginPath(); arc.moveTo(origin.x, origin.y); arc.lineTo(targetPosX, targetPosY); arc.strokePath();
                            arc.lineStyle(2.2, theaterHighlight, 1);
                            arc.beginPath(); arc.moveTo(origin.x, origin.y); arc.lineTo(targetPosX, targetPosY); arc.strokePath();
                            this.tweens.add({ targets: arc, alpha: 0, duration: 170, onComplete: () => arc.destroy() });
                            createExplosionEffect('beam', targetPosX, targetPosY, 20);
                        } else {
                            const tracer = this.add.graphics().setDepth(2.1);
                            tracer.lineStyle(buildingType === 'base' ? 4 : 3, theaterAccent, 0.9);
                            tracer.beginPath(); tracer.moveTo(origin.x, origin.y); tracer.lineTo(targetPosX, targetPosY); tracer.strokePath();
                            this.tweens.add({ targets: tracer, alpha: 0, duration: 120, onComplete: () => tracer.destroy() });
                            createExplosionEffect('bullet', targetPosX, targetPosY, buildingType === 'base' ? 14 : 10);
                        }
                        applyTargetDamage(stats.damage ?? 0);
                    };
                    const attackCadenceMs = buildingType === 'naval_mine'
                        ? 1700
                        : Math.max(220, stats.fireRateMs ?? 1000);
                    this.time.addEvent({ delay: attackCadenceMs, loop: true, callback: playFire });
                    this.time.delayedCall(220, playFire);
                    return { lane, aura, sourceArt, targetArt };
                };

                const renderBuildingHealStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const buildingType = descriptor.buildingType!;
                    const targetType = descriptor.heal!.targetType;
                    const sourceX = arenaLeft + 160;
                    const sourceY = descriptor.environmentMode === 'shore' ? groundY - 18 : groundY - 20;
                    const sourceArt = createBuildingArt(this, sourceX, sourceY, buildingType, BUILDING_ACCENTS[buildingType], createPreviewBuildingData(buildingType, descriptor.buildingStats));
                    applySkinToArtContainer(this, sourceArt, skinId, 'building');
                    sourceArt.setScale(1.44);
                    const patientX = arenaLeft + arenaWidth - 170;
                    const patientY = descriptor.environmentMode === 'shore' ? groundY - 4 : groundY;
                    const patient = createUnitArt(this, patientX, patientY, targetType, UNIT_ACCENTS[targetType], false, { skinId: 'default' });
                    const patientScale = targetType === 'tank' ? 1.88 : 1.96;
                    patient.setScale(patientScale);
                    patient.setData('baseScale', patientScale);
                    applyPreviewFacing(patient, Math.PI);
                    const hp = createHpBar(
                        patientX - 52,
                        patientY - (targetType === 'tank' ? 46 : 42),
                        104,
                        0x4ade80,
                        ATTACK_PREVIEW_CONFIG[targetType].health
                    );
                    let ratio = 0.34;
                    hp.redraw(ratio);
                    const healLoop = () => {
                        const origin = getPreviewBuildingOrigin(sourceArt, buildingType);
                        const beam = this.add.graphics().setDepth(2.1);
                        beam.lineStyle(8, 0x48d68f, 0.12);
                        beam.beginPath(); beam.moveTo(origin.x, origin.y); beam.lineTo(patientX, patientY - 10); beam.strokePath();
                        beam.lineStyle(3.8, 0x6dffc2, 0.7);
                        beam.beginPath(); beam.moveTo(origin.x, origin.y); beam.lineTo(patientX, patientY - 10); beam.strokePath();
                        const pulse = this.add.circle(patientX, patientY - 10, 10, 0x77ffcc, 0.26).setDepth(2.2);
                        this.tweens.add({ targets: [beam, pulse], alpha: 0, scale: 2, duration: 420, onComplete: () => { beam.destroy(); pulse.destroy(); } });
                        ratio = ratio >= 0.96 ? 0.34 : Math.min(1, ratio + 0.18);
                        hp.redraw(ratio);
                    };
                    this.time.addEvent({ delay: 900, loop: true, callback: healLoop });
                    this.time.delayedCall(240, healLoop);
                    return { lane, aura, sourceArt, patient };
                };

                const renderBuildingEconomyStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, focalX, focalY, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const buildingType = descriptor.buildingType!;
                    const artY = descriptor.environmentMode === 'oil_water' ? groundY - 6 : groundY - 18;
                    const building = createBuildingArt(this, focalX, artY, buildingType, BUILDING_ACCENTS[buildingType], createPreviewBuildingData(buildingType, descriptor.buildingStats));
                    applySkinToArtContainer(this, building, skinId, 'building');
                    building.setScale(buildingType === 'oil_rig' ? 1.46 : 1.34);
                    const halo = this.add.ellipse(focalX, focalY - 6, 168, 70, theaterAccent, 0.08).setBlendMode(Phaser.BlendModes.ADD);
                    const incomeLoop = () => {
                        const pieces: string[] = [];
                        if ((descriptor.income?.gold ?? 0) > 0) pieces.push(`+ ${descriptor.income?.gold} gold`);
                        if ((descriptor.income?.oil ?? 0) > 0) pieces.push(`+ ${descriptor.income?.oil} oil`);
                        const label = this.add.text(focalX, artY - 74, pieces.join('   '), {
                            fontFamily: 'Trebuchet MS, sans-serif',
                            fontSize: '20px',
                            fontStyle: 'bold',
                            color: '#fff5d4',
                            stroke: '#1a1205',
                            strokeThickness: 4,
                        }).setOrigin(0.5).setDepth(2.2);
                        const burst = this.add.circle(focalX, artY - 8, 12, theaterAccent, 0.22).setDepth(2.1);
                        this.tweens.add({ targets: burst, scale: 4, alpha: 0, duration: 620, onComplete: () => burst.destroy() });
                        this.tweens.add({ targets: label, y: artY - 124, alpha: 0, duration: 900, ease: 'Sine.easeOut', onComplete: () => label.destroy() });
                    };
                    incomeLoop();
                    this.time.addEvent({ delay: descriptor.income?.cycleMs ?? 1000, loop: true, callback: incomeLoop });
                    return { lane, aura, halo, building };
                };

                const renderBuildingRecruitStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const sourceX = arenaLeft + 170;
                    const sourceY = descriptor.environmentMode === 'shore' ? groundY - 18 : groundY - 18;
                    const buildingType = descriptor.buildingType!;
                    const sourceArt = createBuildingArt(this, sourceX, sourceY, buildingType, BUILDING_ACCENTS[buildingType], createPreviewBuildingData(buildingType, descriptor.buildingStats));
                    applySkinToArtContainer(this, sourceArt, skinId, 'building');
                    sourceArt.setScale(1.42);
                    const progressBack = this.add.graphics();
                    const progressFill = this.add.graphics();
                    const barX = sourceX - 86;
                    const barY = arenaBottom - 44;
                    const barWidth = 172;
                    const redraw = (progress: number) => {
                        progressBack.clear();
                        progressFill.clear();
                        progressBack.fillStyle(0x04101a, 0.88);
                        progressBack.fillRoundedRect(barX, barY, barWidth, 14, 7);
                        progressBack.lineStyle(1, 0x000000, 0.88);
                        progressBack.strokeRoundedRect(barX, barY, barWidth, 14, 7);
                        progressFill.fillStyle(theaterAccent, 0.96);
                        progressFill.fillRoundedRect(barX + 2, barY + 2, Math.max(10, (barWidth - 4) * progress), 10, 5);
                    };
                    redraw(0.24);
                    const spawnOne = () => {
                        const rosterEntries = descriptor.roster ?? [];
                        if (rosterEntries.length === 0) return;
                        const entry = rosterEntries[Math.floor(Math.random() * rosterEntries.length)];
                        const ghost = createRecruitPreviewArt(entry, sourceX + 30, sourceY - 16, 0.84);
                        ghost.setAlpha(0.86);
                        const destinationX = sourceX + 210 + Math.random() * 120;
                        const destinationY = sourceY - 12 + Math.random() * 28;
                        this.tweens.add({ targets: ghost, x: destinationX, y: destinationY, alpha: 0, duration: 880, ease: 'Sine.easeOut', onComplete: () => ghost.destroy() });
                        const cycle = { progress: 0 };
                        this.tweens.add({ targets: cycle, progress: 1, duration: 950, onUpdate: () => redraw(cycle.progress), onComplete: () => redraw(0.18) });
                    };
                    spawnOne();
                    this.time.addEvent({ delay: 1500, loop: true, callback: spawnOne });
                    return { lane, aura, sourceArt };
                };

                const renderBuildingSupportStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, focalX, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const buildingType = descriptor.buildingType!;
                    const sourceArt = createBuildingArt(this, focalX, descriptor.environmentMode === 'bridge' ? groundY - 24 : groundY - 18, buildingType, BUILDING_ACCENTS[buildingType], createPreviewBuildingData(buildingType, descriptor.buildingStats));
                    applySkinToArtContainer(this, sourceArt, skinId, 'building');
                    sourceArt.setScale(buildingType === 'bridge_node' ? 1.46 : 1.34);
                    if (buildingType === 'bridge_node') {
                        const link = this.add.graphics().setDepth(1.2);
                        link.lineStyle(5, 0xb99d62, 0.82);
                        link.lineBetween(focalX - 180, groundY - 18, focalX + 180, groundY - 18);
                        link.lineStyle(2, theaterAccent, 0.2);
                        link.lineBetween(focalX - 180, groundY - 18, focalX + 180, groundY - 18);
                    } else {
                        const flankA = createBuildingArt(this, focalX - 150, groundY - 18, buildingType === 'wall' ? 'wall_node' : 'wall', 0x8a959c, createPreviewBuildingData(buildingType === 'wall' ? 'wall_node' : 'wall'));
                        flankA.setScale(1.1);
                        const flankB = createBuildingArt(this, focalX + 150, groundY - 18, buildingType === 'wall' ? 'wall_node' : 'wall', 0x8a959c, createPreviewBuildingData(buildingType === 'wall' ? 'wall_node' : 'wall'));
                        flankB.setScale(1.1);
                    }
                    return { lane, aura, sourceArt };
                };

                const renderUnitRepairStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const sourceX = arenaLeft + 150;
                    const sourceY = descriptor.habitat === 'water' ? groundY - 8 : groundY;
                    const unitArt = createUnitArt(this, sourceX, sourceY, descriptor.unitType!, UNIT_ACCENTS[descriptor.unitType!], false, { skinId });
                    applySkinToArtContainer(this, unitArt, skinId, 'unit');
                    const unitScale = getUnitAttackPreviewScale(descriptor.unitType!);
                    unitArt.setScale(unitScale);
                    unitArt.setData('baseScale', unitScale);
                    const targetX = arenaLeft + arenaWidth - 170;
                    const targetY = descriptor.habitat === 'water' ? groundY - 6 : groundY - 18;
                    const targetType = descriptor.repair!.targetType;
                    const targetArt = createBuildingArt(this, targetX, targetY, targetType, BUILDING_ACCENTS[targetType], createPreviewBuildingData(targetType));
                    applySkinToArtContainer(this, targetArt, skinId, 'building');
                    targetArt.setScale(targetType === 'oil_rig' ? 1.34 : 1.28);
                    const hp = createHpBar(
                        targetX - 54,
                        targetY - 70,
                        108,
                        0x6cf0b5,
                        BUILDING_STATS[targetType].health
                    );
                    let ratio = 0.36;
                    hp.redraw(ratio);
                    const wrenchLoop = () => {
                        const angle = Math.atan2(targetY - unitArt.y, targetX - unitArt.x);
                        applyPreviewFacing(unitArt, angle);
                        const origin = getPreviewWeaponOrigin(unitArt, descriptor.unitType!);
                        const spark = this.add.graphics().setDepth(2.2);
                        spark.lineStyle(6, 0x5bf1ba, 0.15);
                        spark.beginPath(); spark.moveTo(origin.x, origin.y); spark.lineTo(targetX, targetY - 6); spark.strokePath();
                        spark.lineStyle(2.8, 0xa4ffe4, 0.76);
                        spark.beginPath(); spark.moveTo(origin.x, origin.y); spark.lineTo(targetX, targetY - 6); spark.strokePath();
                        const impact = this.add.circle(targetX, targetY - 6, 10, 0x73ffd6, 0.24).setDepth(2.3);
                        this.tweens.add({ targets: [spark, impact], alpha: 0, scale: 2.2, duration: 420, onComplete: () => { spark.destroy(); impact.destroy(); } });
                        ratio = ratio >= 0.97 ? 0.36 : Math.min(1, ratio + 0.2);
                        hp.redraw(ratio);
                    };
                    this.time.addEvent({ delay: 900, loop: true, callback: wrenchLoop });
                    this.time.delayedCall(200, wrenchLoop);
                    return { lane, aura, unitArt, targetArt };
                };

                const renderUnitRadarStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, focalX, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const unitArt = createUnitArt(this, arenaLeft + 180, groundY, descriptor.unitType!, UNIT_ACCENTS[descriptor.unitType!], false, { skinId });
                    applySkinToArtContainer(this, unitArt, skinId, 'unit');
                    const unitScale = getUnitAttackPreviewScale(descriptor.unitType!);
                    unitArt.setScale(unitScale);
                    unitArt.setData('baseScale', unitScale);
                    const oilSpots = [
                        { x: focalX - 110, y: groundY + 8 },
                        { x: focalX + 20, y: groundY - 14 },
                        { x: focalX + 158, y: groundY + 4 },
                    ];
                    oilSpots.forEach((spot) => {
                        const slick = this.add.ellipse(spot.x, spot.y, 38, 18, 0x090909, 0.98).setStrokeStyle(1.6, 0x2e2e2e, 0.76);
                        slick.setAlpha(0.18);
                        const ring = this.add.circle(spot.x, spot.y, 26, 0x83f1ff, 0).setStrokeStyle(2, 0x83f1ff, 0.34);
                        ring.setAlpha(0);
                        this.time.addEvent({
                            delay: 1100 + Math.random() * 380,
                            loop: true,
                            callback: () => {
                                slick.setAlpha(0.98);
                                ring.setScale(0.4);
                                ring.setAlpha(0.52);
                                this.tweens.add({ targets: ring, scale: 1.5, alpha: 0, duration: 620 });
                                this.tweens.add({ targets: slick, alpha: { from: 1, to: 0.2 }, duration: 820 });
                            },
                        });
                    });
                    const sweepLoop = () => {
                        const sweep = this.add.circle(unitArt.x, unitArt.y, 24, theaterAccent, 0).setStrokeStyle(3, theaterAccent, 0.34).setDepth(2.1);
                        this.tweens.add({ targets: sweep, scale: 8.8, alpha: 0, duration: 1000, ease: 'Sine.easeOut', onComplete: () => sweep.destroy() });
                    };
                    sweepLoop();
                    this.time.addEvent({ delay: 980, loop: true, callback: sweepLoop });
                    return { lane, aura, unitArt };
                };

                const renderUnitTransportStage = (arenaLeft: number, arenaTop: number, arenaWidth: number, arenaBottom: number) => {
                    const { lane, aura, groundY } = drawEnvironment(arenaLeft, arenaTop, arenaWidth, arenaBottom, descriptor.environmentMode, theaterAccent);
                    const unitX = arenaLeft + 180;
                    const unitY = descriptor.habitat === 'water' ? groundY - 6 : groundY;
                    const unitArt = createUnitArt(this, unitX, unitY, descriptor.unitType!, UNIT_ACCENTS[descriptor.unitType!], false, { skinId });
                    applySkinToArtContainer(this, unitArt, skinId, 'unit');
                    const unitScale = getUnitAttackPreviewScale(descriptor.unitType!);
                    unitArt.setScale(unitScale);
                    unitArt.setData('baseScale', unitScale);
                    const unloadX = arenaLeft + arenaWidth - 180;
                    const unloadMarker = this.add.graphics().setDepth(1.4);
                    unloadMarker.lineStyle(2, 0xfff3d2, 0.68);
                    unloadMarker.strokeRoundedRect(unloadX - 48, groundY - 24, 96, 48, 14);
                    this.add.text(unloadX, groundY - 42, 'UNLOAD', {
                        fontFamily: 'Trebuchet MS, sans-serif',
                        fontSize: '11px',
                        color: '#fff0cf',
                        fontStyle: 'bold',
                    }).setOrigin(0.5);
                    const cargoDots = Array.from({ length: descriptor.transport?.capacity === 4 ? 4 : 6 }).map((_, index) => {
                        const dot = this.add.circle(unitX - 18 + (index % 3) * 16, unitY - 24 + Math.floor(index / 3) * 16, 4.5, 0xffe2a8, 0.92).setDepth(2);
                        dot.setStrokeStyle(1, 0x402205, 0.7);
                        return dot;
                    });
                    let active = 0;
                    const transportLoop = () => {
                        const dot = cargoDots[active % cargoDots.length];
                        const ghost = this.add.circle(dot.x, dot.y, 4.8, theaterAccent, 0.9).setDepth(2.2);
                        this.tweens.add({ targets: ghost, x: unloadX, y: groundY - 4 + ((active % 2) * 12), alpha: 0, duration: 860, ease: 'Sine.easeInOut', onComplete: () => ghost.destroy() });
                        active += 1;
                    };
                    transportLoop();
                    this.time.addEvent({ delay: 520, loop: true, callback: transportLoop });
                    return { lane, aura, unitArt };
                };

                const renderStage = (y: number) => {
                    const stagePanel = this.add.graphics();
                    stagePanel.fillStyle(0x0b1520, 0.97);
                    stagePanel.fillRoundedRect(rowLeft, y, usableWidth, stageHeight, 26);
                    stagePanel.lineStyle(1.6, 0xffd27a, 0.22);
                    stagePanel.strokeRoundedRect(rowLeft, y, usableWidth, stageHeight, 26);
                    stagePanel.lineStyle(1, theaterAccent, 0.22);
                    stagePanel.strokeRoundedRect(rowLeft + 10, y + 10, usableWidth - 20, stageHeight - 20, 20);

                    const atmosphere = this.add.ellipse(sceneWidth / 2, y + stageHeight / 2 + 10, usableWidth * 0.72, stageHeight * 0.78, theaterAccent, 0.06);
                    atmosphere.setBlendMode(Phaser.BlendModes.ADD);

                    this.add.text(rowLeft + 28, y + 24, descriptor.stageTitle, {
                        fontFamily: 'Georgia, serif',
                        fontSize: '26px',
                        color: '#fff0cf',
                    });
                    const chip = this.add.graphics();
                    chip.fillStyle(theaterAccent, 0.12);
                    chip.fillRoundedRect(rowRight - 214, y + 22, 188, 32, 15);
                    chip.lineStyle(1, theaterAccent, 0.28);
                    chip.strokeRoundedRect(rowRight - 214, y + 22, 188, 32, 15);
                    this.add.text(rowRight - 120, y + 38, descriptor.chipLabel, {
                        fontFamily: 'Trebuchet MS, sans-serif',
                        fontSize: '11px',
                        color: '#e4eef6',
                        fontStyle: 'bold',
                        letterSpacing: 1,
                    }).setOrigin(0.5);
                    this.add.text(rowLeft + 28, y + 60, descriptor.stageCopy, {
                        fontFamily: 'Trebuchet MS, sans-serif',
                        fontSize: '15px',
                        color: '#d6e1e9',
                        wordWrap: { width: usableWidth - 92, useAdvancedWrap: true },
                    });

                    const arenaLeft = rowLeft + 24;
                    const arenaTop = y + 100;
                    const arenaWidth = usableWidth - 48;
                    const arenaBottom = y + stageHeight - 22;

                    switch (descriptor.stageMode) {
                        case 'unitCombat':
                            renderUnitCombatStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'unitRepair':
                            renderUnitRepairStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'unitRadar':
                            renderUnitRadarStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'unitTransport':
                            renderUnitTransportStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'buildingAttack':
                            renderBuildingAttackStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'buildingHeal':
                            renderBuildingHealStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'buildingEconomy':
                            renderBuildingEconomyStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'buildingRecruit':
                            renderBuildingRecruitStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                        case 'buildingSupport':
                        default:
                            renderBuildingSupportStage(arenaLeft, arenaTop, arenaWidth, arenaBottom);
                            break;
                    }
                    return atmosphere;
                };

                const stageAtmosphere = renderStage(STAGE_TOP_PADDING);
                stageAtmosphere.setDepth(-1);
                markPreviewReady();
            }
        }

        const game = new Phaser.Game({
            type: Phaser.AUTO,
            width: previewWidth,
            height: previewHeight,
            backgroundColor: '#081019',
            parent: host,
            scene: [SkinPreviewScene],
            render: {
                antialias: true,
                pixelArt: false,
            },
        });

        return () => {
            disposed = true;
            game.destroy(true);
            host.innerHTML = '';
        };
    }, [previewHeight, previewWidth, selectedDescriptor, skinId]);

    const zoomOut = () => setManualZoom((current) => clampZoom((current ?? fitZoom) - ZOOM_STEP));
    const zoomIn = () => setManualZoom((current) => clampZoom((current ?? fitZoom) + ZOOM_STEP));
    const resetToFit = () => setManualZoom(null);
    const getRosterTargetSelection = (entry: RecruitRosterEntry): PreviewSelection | null => {
        if (entry.renderType && isRenderableUnitType(entry.renderType)) {
            return { kind: 'unit', type: entry.renderType };
        }
        return null;
    };
    const setBuildingVariant = (type: BuildingType, variantId: string) => {
        setBuildingVariantByType((current) => ({ ...current, [type]: variantId }));
    };
    const isSelectionActive = (selection: PreviewSelection) => (
        selectedPreview.kind === selection.kind && selectedPreview.type === selection.type
    );

    useEffect(() => {
        const stageViewport = stageViewportRef.current;
        const selectorPane = selectorPaneRef.current;
        if (!stageViewport || !selectorPane) return;

        const handleNativeWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                setManualZoom((current) => clampZoom((current ?? fitZoom) + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
                return;
            }
            if (Math.abs(event.deltaY) > 0 || Math.abs(event.deltaX) > 0) {
                event.preventDefault();
                selectorPane.scrollTop += event.deltaY;
            }
        };

        stageViewport.addEventListener('wheel', handleNativeWheel, { passive: false });
        return () => stageViewport.removeEventListener('wheel', handleNativeWheel);
    }, [fitZoom]);

    return (
        <div className="skins-render-preview">
            <div className="skins-render-preview__toolbar">
                <div className="skins-render-preview__hint">
                    <strong>{selectedDescriptor.title}</strong>
                    {' '}
                    {selectedDescriptor.hint}
                </div>
                <div className="skins-render-preview__controls">
                    <button type="button" className="skins-render-preview__zoom-btn" onClick={zoomOut}>−</button>
                    <div className="skins-render-preview__zoom-readout">{Math.round(effectiveZoom * 100)}%</div>
                    <button type="button" className="skins-render-preview__zoom-btn" onClick={zoomIn}>+</button>
                    <button type="button" className="skins-render-preview__fit-btn" onClick={resetToFit}>Fit</button>
                </div>
            </div>

            <div className="skins-render-preview__body">
                <div className="skins-render-preview__left">
                    <div className="skins-render-preview__viewport-wrap">
                        <div ref={stageViewportRef} className="skins-render-preview__viewport">
                            <div
                                className="skins-render-preview__canvas-shell"
                                style={{
                                    width: `${previewWidth * effectiveZoom}px`,
                                    height: `${previewHeight * effectiveZoom}px`,
                                }}
                            >
                                <div ref={hostRef} className="skins-render-preview__canvas-host" />
                            </div>
                            {isPreviewLoading && (
                                <div className="skins-render-preview__loading-overlay">
                                    <div className="skins-render-preview__loading-spinner" />
                                    <div className="skins-render-preview__loading-copy">Loading unit theater...</div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div ref={selectorPaneRef} className="skins-render-preview__selector-pane">
                        <section className="skins-render-preview__selector-section">
                            <div className="skins-render-preview__selector-head">
                                <strong>Unit Preview List</strong>
                                <span>Scroll this list while the live theater stays pinned above.</span>
                            </div>
                            <div className="skins-render-preview__selector-grid">
                                {UNIT_TYPES.map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        className={[
                                            'skins-render-preview__selector-card',
                                            'is-unit',
                                            isSelectionActive({ kind: 'unit', type }) ? 'is-selected' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={() => setSelectedPreview({ kind: 'unit', type })}
                                    >
                                        <span>{ATTACK_PREVIEW_CONFIG[type].combat ? 'Unit Combat' : 'Unit Utility'}</span>
                                        <strong>{UNIT_PREVIEW_LABELS[type]}</strong>
                                        <p>{getUnitCardSubtitle(type)}</p>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="skins-render-preview__selector-section">
                            <div className="skins-render-preview__selector-head">
                                <strong>Building Preview List</strong>
                                <span>Attack, heal, economy, and recruitment structures each open their own focused demo.</span>
                            </div>
                            <div className="skins-render-preview__selector-grid">
                                {BUILDING_TYPES.map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        className={[
                                            'skins-render-preview__selector-card',
                                            'is-building',
                                            isSelectionActive({ kind: 'building', type }) ? 'is-selected' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={() => setSelectedPreview({ kind: 'building', type })}
                                    >
                                        <span>{type === 'mine' || type === 'farm' || type === 'oil_rig' || type === 'oil_well' ? 'Economy Structure' : type === 'barracks' || type === 'tank_factory' || type === 'air_base' || type === 'dock' || type === 'base' ? 'Production Structure' : 'Battlefield Structure'}</span>
                                        <strong>{BUILDING_PREVIEW_LABELS[type]}</strong>
                                        <p>{getBuildingCardSubtitle(type)}</p>
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                </div>

                <aside className="skins-render-preview__info">
                    <div className="skins-render-preview__info-hero">
                        <div className="skins-render-preview__info-eyebrow">{selectedDescriptor.kind === 'unit' ? 'Unit Intel' : 'Structure Intel'}</div>
                        <h3>{selectedDescriptor.title}</h3>
                        <p>{selectedDescriptor.subtitle}</p>
                        <div className="skins-render-preview__info-pills">
                            <span>{selectedDescriptor.chipLabel}</span>
                            <span>{selectedDescriptor.stageTitle}</span>
                        </div>
                    </div>

                    {selectedDescriptor.kind === 'building' && (selectedDescriptor.buildingVariantOptions?.length ?? 0) > 1 ? (
                        <section className="skins-render-preview__info-section">
                            <div className="skins-render-preview__info-section-title">Building Versions</div>
                            <div className="skins-render-preview__variant-grid">
                                {selectedDescriptor.buildingVariantOptions?.map((variant) => {
                                    const isActive = selectedDescriptor.activeBuildingVariantId === variant.id;
                                    const stats = variant.stats;
                                    const className = [
                                        'skins-render-preview__variant-btn',
                                        isActive ? 'is-selected' : '',
                                    ].filter(Boolean).join(' ');
                                    return (
                                        <button
                                            key={variant.id}
                                            type="button"
                                            className={className}
                                            onClick={() => {
                                                if (selectedDescriptor.buildingType) {
                                                    setBuildingVariant(selectedDescriptor.buildingType, variant.id);
                                                }
                                            }}
                                        >
                                            <div className="skins-render-preview__variant-head">
                                                <strong>{variant.label}</strong>
                                                <span>Tier {variant.level}</span>
                                            </div>
                                            <p>{variant.blurb}</p>
                                            <div className="skins-render-preview__variant-stats">
                                                <span>{stats.health} HP</span>
                                                <span>{stats.damage ?? 0} DMG</span>
                                                <span>{stats.range ?? 0} RNG</span>
                                                <span>{formatFireRateLabel(stats.fireRateMs)}</span>
                                            </div>
                                            {variant.upgradeCost ? (
                                                <em>Upgrade Cost: {formatCost(variant.upgradeCost.gold, variant.upgradeCost.oil)}</em>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {selectedDescriptor.infoSections.map((section) => (
                        <section key={section.title} className="skins-render-preview__info-section">
                            <div className="skins-render-preview__info-section-title">{section.title}</div>
                            <div className="skins-render-preview__info-grid">
                                {section.rows.map((row) => (
                                    <div key={`${section.title}-${row.label}`} className="skins-render-preview__info-card">
                                        <span>{row.label}</span>
                                        <strong>{row.value}</strong>
                                    </div>
                                ))}
                            </div>
                            {section.note ? <p className="skins-render-preview__info-note">{section.note}</p> : null}
                        </section>
                    ))}

                    {selectedDescriptor.roster?.length ? (
                        <section className="skins-render-preview__info-section">
                            <div className="skins-render-preview__info-section-title">Recruit Roster</div>
                            <div className="skins-render-preview__roster">
                                {selectedDescriptor.roster.map((entry) => {
                                    const targetSelection = getRosterTargetSelection(entry);
                                    const isSelected = Boolean(
                                        targetSelection
                                        && selectedPreview.kind === targetSelection.kind
                                        && selectedPreview.type === targetSelection.type
                                    );
                                    const className = [
                                        'skins-render-preview__roster-card',
                                        targetSelection ? 'is-clickable' : 'is-disabled',
                                        isSelected ? 'is-selected' : '',
                                    ].filter(Boolean).join(' ');

                                    return (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            className={className}
                                            onClick={() => {
                                                if (targetSelection) {
                                                    setSelectedPreview(targetSelection);
                                                }
                                            }}
                                            disabled={!targetSelection}
                                        >
                                            <div className="skins-render-preview__roster-head">
                                                <div>
                                                    <strong>{entry.label}</strong>
                                                    <span>{entry.timeLabel} • {entry.costLabel}</span>
                                                </div>
                                                <em>{targetSelection ? 'Open live demo' : 'Roster only'}</em>
                                            </div>
                                            <p>{entry.note}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}
                </aside>
            </div>
        </div>
    );
};
