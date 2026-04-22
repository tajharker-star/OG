import Phaser from 'phaser';
import { SKIN_DEFINITIONS_BY_ID, type SkinId, type SkinPalette } from '../../utils/playerSkins';

export type SkinRenderTarget = 'unit' | 'building';

type SkinEffectMetrics = {
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    centerX: number;
    centerY: number;
};

type AuraShape = {
    kind: 'ellipse' | 'roundedRect' | 'polygon';
    x: number;
    y: number;
    width: number;
    height: number;
    radius?: number;
    alpha?: number;
    color?: number;
    points?: Array<{ x: number; y: number }>;
};

export type MotionTrailStyle = {
    spacing: number;
    minSpeed: number;
    lifetimeMs: number;
    maxActive: number;
    baseAlpha: number;
    growth: number;
};

type OuterOutlineOptions = {
    width?: number;
    alpha?: number;
    expand?: number;
};

const MOTION_TRAIL_STYLES: Partial<Record<SkinId, MotionTrailStyle>> = {
    diamond: {
        spacing: 18,
        minSpeed: 18,
        lifetimeMs: 700,
        maxActive: 180,
        baseAlpha: 0.84,
        growth: 0.08,
    },
    obsidian: {
        spacing: 16,
        minSpeed: 16,
        lifetimeMs: 760,
        maxActive: 190,
        baseAlpha: 0.82,
        growth: 0.1,
    },
    godly: {
        spacing: 15,
        minSpeed: 15,
        lifetimeMs: 820,
        maxActive: 220,
        baseAlpha: 0.88,
        growth: 0.12,
    },
    ruby: {
        spacing: 14,
        minSpeed: 14,
        lifetimeMs: 860,
        maxActive: 230,
        baseAlpha: 0.9,
        growth: 0.12,
    },
    leaderboard_top10: {
        spacing: 15,
        minSpeed: 15,
        lifetimeMs: 820,
        maxActive: 220,
        baseAlpha: 0.88,
        growth: 0.12,
    },
    leaderboard_third: {
        spacing: 14,
        minSpeed: 14,
        lifetimeMs: 860,
        maxActive: 230,
        baseAlpha: 0.9,
        growth: 0.13,
    },
    leaderboard_second: {
        spacing: 14,
        minSpeed: 14,
        lifetimeMs: 880,
        maxActive: 240,
        baseAlpha: 0.9,
        growth: 0.13,
    },
    leaderboard_first: {
        spacing: 13,
        minSpeed: 14,
        lifetimeMs: 940,
        maxActive: 260,
        baseAlpha: 0.93,
        growth: 0.15,
    },
    developer: {
        spacing: 13,
        minSpeed: 14,
        lifetimeMs: 920,
        maxActive: 250,
        baseAlpha: 0.92,
        growth: 0.14,
    },
};

const DEVELOPER_RAINBOW_COLORS = [0xff4fd8, 0xfff06b, 0x72ff7d, 0x79fff2, 0x7d8cff, 0xff4fd8];

const blendColor = (from: number, to: number, amount: number): number => {
    const a = Phaser.Display.Color.ValueToColor(from);
    const b = Phaser.Display.Color.ValueToColor(to);
    const t = Phaser.Math.Clamp(amount, 0, 1);
    return Phaser.Display.Color.GetColor(
        Math.round(a.red + (b.red - a.red) * t),
        Math.round(a.green + (b.green - a.green) * t),
        Math.round(a.blue + (b.blue - a.blue) * t)
    );
};

const getBrightness = (color: number): number => {
    const rgb = Phaser.Display.Color.ValueToColor(color);
    return (rgb.red + rgb.green + rgb.blue) / 3;
};

const isSkinTone = (color: number): boolean => {
    const rgb = Phaser.Display.Color.ValueToColor(color);
    return rgb.red > 120 && rgb.green > 80 && rgb.blue > 55 && rgb.red > rgb.green && rgb.green > rgb.blue * 0.8;
};

const getStoredBaseColor = (
    child: Phaser.GameObjects.GameObject,
    key: string,
    currentColor: number
): number => {
    const dataTarget = child as Phaser.GameObjects.GameObject & {
        getData?: (key: string) => unknown;
        setData?: (key: string, value: unknown) => Phaser.GameObjects.GameObject;
    };
    const storedColor = typeof dataTarget.getData === 'function' ? dataTarget.getData(key) : undefined;
    if (typeof storedColor === 'number' && Number.isFinite(storedColor)) {
        return storedColor;
    }

    if (typeof dataTarget.setData === 'function') {
        dataTarget.setData(key, currentColor);
    }
    return currentColor;
};

const createDeveloperRuntimePalette = (basePalette: SkinPalette, color: number): SkinPalette => ({
    ...basePalette,
    primary: color,
    secondary: blendColor(color, 0xffffff, 0.52),
    stroke: blendColor(color, 0xffffff, 0.72),
    glow: blendColor(color, 0xffffff, 0.18),
    shadow: blendColor(basePalette.shadow, color, 0.14),
});

const getRuntimeSkinEnhancementLevel = (skinId: SkinId, target: SkinRenderTarget): number => {
    if (typeof window === 'undefined' || skinId === 'default') {
        return 0;
    }

    const loadout = (window as Window & {
        agSkinLoadout?: {
            unitSkinId?: SkinId;
            buildingSkinId?: SkinId;
            unitEnhancementLevel?: number;
            buildingEnhancementLevel?: number;
        };
    }).agSkinLoadout;

    const rawLevel = target === 'building'
        ? (loadout?.buildingSkinId === skinId ? loadout?.buildingEnhancementLevel : 0)
        : (loadout?.unitSkinId === skinId ? loadout?.unitEnhancementLevel : 0);

    return Math.max(0, Math.min(8, Math.floor(rawLevel || 0)));
};

const enhancePaletteForSkinCopies = (palette: SkinPalette, enhancementLevel: number): SkinPalette => {
    if (enhancementLevel <= 0) {
        return palette;
    }

    const boost = Math.min(0.55, enhancementLevel * 0.11);
    return {
        ...palette,
        glowAlpha: Math.min(0.38, palette.glowAlpha * (1 + boost) + enhancementLevel * 0.012),
        sheenAlpha: Math.min(0.3, palette.sheenAlpha * (1 + boost * 0.8) + enhancementLevel * 0.006),
        outerGlowAlpha: Math.min(0.46, palette.outerGlowAlpha * (1 + boost) + enhancementLevel * 0.014),
        outlineAlpha: Math.min(0.52, palette.outlineAlpha * (1 + boost * 0.8) + enhancementLevel * 0.01),
        pulseStrength: Math.min(0.16, palette.pulseStrength * (1 + boost * 0.7) + enhancementLevel * 0.004),
        trailAlpha: Math.min(0.34, palette.trailAlpha * (1 + boost) + enhancementLevel * 0.012),
        trailScale: Math.min(1.5, palette.trailScale + enhancementLevel * 0.035),
    };
};

const transformFillColor = (color: number, palette: SkinPalette, target: SkinRenderTarget): number => {
    const brightness = getBrightness(color);
    const baseBlend = target === 'building' ? palette.fillBlend + 0.06 : palette.fillBlend;

    if (isSkinTone(color)) {
        return blendColor(color, palette.secondary, baseBlend * 0.16);
    }

    if (brightness < 28) {
        return blendColor(color, palette.shadow, palette.shadowBlend * 0.35);
    }

    if (brightness < 85) {
        return blendColor(color, palette.shadow, palette.shadowBlend + (target === 'building' ? 0.05 : 0));
    }

    if (brightness > 205) {
        return blendColor(color, palette.secondary, palette.highlightBlend + (target === 'building' ? 0.04 : 0));
    }

    return blendColor(color, palette.primary, baseBlend);
};

const transformStrokeColor = (color: number, palette: SkinPalette, target: SkinRenderTarget): number => {
    const brightness = getBrightness(color);
    const strokeBlend = target === 'building' ? palette.strokeBlend + 0.04 : palette.strokeBlend;

    if (brightness < 40) {
        return blendColor(color, palette.shadow, strokeBlend * 0.5);
    }

    return blendColor(color, palette.stroke, strokeBlend);
};

const applySkinToDisplayObject = (
    child: Phaser.GameObjects.GameObject,
    palette: SkinPalette,
    target: SkinRenderTarget
) => {
    if (child instanceof Phaser.GameObjects.Container) {
        child.list.forEach((nestedChild) => applySkinToDisplayObject(nestedChild, palette, target));
        return;
    }

    const isAuraLine = 'getData' in child && typeof child.getData === 'function' && child.getData('skinAuraLine');
    const preserveColor = 'getData' in child && typeof child.getData === 'function' && child.getData('skinPreserveColor');

    const maybeShape = child as Phaser.GameObjects.Shape & {
        fillColor?: number;
        fillAlpha?: number;
        strokeColor?: number;
        strokeAlpha?: number;
        lineWidth?: number;
        setFillStyle?: (color?: number, alpha?: number) => Phaser.GameObjects.Shape;
        setStrokeStyle?: (lineWidth?: number, color?: number, alpha?: number) => Phaser.GameObjects.Shape;
    };

    if (!preserveColor && typeof maybeShape.fillColor === 'number' && typeof maybeShape.setFillStyle === 'function') {
        const baseFillColor = getStoredBaseColor(child, 'skinBaseFillColor', maybeShape.fillColor);
        maybeShape.setFillStyle(
            isAuraLine ? palette.glow : transformFillColor(baseFillColor, palette, target),
            typeof maybeShape.fillAlpha === 'number' ? maybeShape.fillAlpha : 1
        );
    }

    if (
        typeof maybeShape.strokeColor === 'number'
        && typeof maybeShape.lineWidth === 'number'
        && maybeShape.lineWidth > 0
        && typeof maybeShape.setStrokeStyle === 'function'
    ) {
        if (!preserveColor) {
            const baseStrokeColor = getStoredBaseColor(child, 'skinBaseStrokeColor', maybeShape.strokeColor);
            maybeShape.setStrokeStyle(
                maybeShape.lineWidth,
                isAuraLine ? palette.glow : transformStrokeColor(baseStrokeColor, palette, target),
                typeof maybeShape.strokeAlpha === 'number' ? maybeShape.strokeAlpha : 1
            );
        }
    }

    const maybeImage = child as Phaser.GameObjects.Image & { setTint?: (topLeft?: number, topRight?: number, bottomLeft?: number, bottomRight?: number) => Phaser.GameObjects.Image };
    if (!preserveColor && typeof maybeImage.setTint === 'function' && child instanceof Phaser.GameObjects.Image) {
        maybeImage.setTint(blendColor(0xffffff, palette.primary, palette.fillBlend * 0.5));
    }
};

const applyEffectTint = (child: Phaser.GameObjects.GameObject, palette: SkinPalette) => {
    if (child instanceof Phaser.GameObjects.Container) {
        child.list.forEach((nestedChild) => applyEffectTint(nestedChild, palette));
        return;
    }

    const maybeShape = child as Phaser.GameObjects.Shape & {
        fillColor?: number;
        fillAlpha?: number;
        strokeColor?: number;
        strokeAlpha?: number;
        lineWidth?: number;
        setFillStyle?: (color?: number, alpha?: number) => Phaser.GameObjects.Shape;
        setStrokeStyle?: (lineWidth?: number, color?: number, alpha?: number) => Phaser.GameObjects.Shape;
    };

    if (typeof maybeShape.fillColor === 'number' && typeof maybeShape.setFillStyle === 'function') {
        const alpha = typeof maybeShape.fillAlpha === 'number' ? maybeShape.fillAlpha : 1;
        maybeShape.setFillStyle(blendColor(palette.glow, palette.secondary, 0.26), alpha);
    }

    if (
        typeof maybeShape.strokeColor === 'number'
        && typeof maybeShape.lineWidth === 'number'
        && maybeShape.lineWidth > 0
        && typeof maybeShape.setStrokeStyle === 'function'
    ) {
        const alpha = typeof maybeShape.strokeAlpha === 'number' ? maybeShape.strokeAlpha : 1;
        maybeShape.setStrokeStyle(maybeShape.lineWidth, palette.stroke, alpha);
    }

    const maybeTintable = child as Phaser.GameObjects.GameObject & {
        setTint?: (topLeft?: number, topRight?: number, bottomLeft?: number, bottomRight?: number) => Phaser.GameObjects.GameObject;
    };
    if (typeof maybeTintable.setTint === 'function') {
        maybeTintable.setTint(palette.glow, palette.secondary, palette.primary, palette.glow);
    }
};

const animateDeveloperSkinPalette = (
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    target: SkinRenderTarget,
    basePalette: SkinPalette,
    glowLayer: Phaser.GameObjects.Container,
    sheenLayer: Phaser.GameObjects.Container
) => {
    scene.tweens.addCounter({
        from: 0,
        to: DEVELOPER_RAINBOW_COLORS.length - 1,
        duration: 4200,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => {
            const value = tween.getValue() ?? 0;
            const low = Math.floor(value);
            const high = (low + 1) % DEVELOPER_RAINBOW_COLORS.length;
            const color = blendColor(DEVELOPER_RAINBOW_COLORS[low], DEVELOPER_RAINBOW_COLORS[high], value - low);
            const palette = createDeveloperRuntimePalette(basePalette, color);

            container.list
                .filter((child) => child !== glowLayer && child !== sheenLayer)
                .forEach((child) => applySkinToDisplayObject(child, palette, target));
            applyEffectTint(glowLayer, palette);
        },
    });
};

const getFallbackMetrics = (target: SkinRenderTarget): SkinEffectMetrics => {
    const width = target === 'building' ? 76 : 56;
    const height = target === 'building' ? 48 : 34;
    const centerY = target === 'building' ? 4 : 3;
    return {
        width,
        height,
        left: -width / 2,
        right: width / 2,
        top: centerY - height / 2,
        bottom: centerY + height / 2,
        centerX: 0,
        centerY,
    };
};

const measureSkinEffectMetrics = (
    container: Phaser.GameObjects.Container,
    target: SkinRenderTarget
): SkinEffectMetrics => {
    const fallback = getFallbackMetrics(target);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const visit = (child: Phaser.GameObjects.GameObject) => {
        if ('getData' in child && typeof child.getData === 'function' && child.getData('skinEffectIgnore')) {
            return;
        }

        if (child instanceof Phaser.GameObjects.Container) {
            child.list.forEach(visit);
            return;
        }

        if (!('getBounds' in child) || typeof child.getBounds !== 'function') {
            return;
        }

        const bounds = child.getBounds();
        minX = Math.min(minX, bounds.left - container.x);
        minY = Math.min(minY, bounds.top - container.y);
        maxX = Math.max(maxX, bounds.right - container.x);
        maxY = Math.max(maxY, bounds.bottom - container.y);
    };

    container.list.forEach(visit);

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return fallback;
    }

    const width = Math.max(fallback.width, maxX - minX);
    const height = Math.max(fallback.height, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
        width,
        height,
        left: centerX - width / 2,
        right: centerX + width / 2,
        top: centerY - height / 2,
        bottom: centerY + height / 2,
        centerX,
        centerY,
    };
};

const getBuildingAuraShapes = (metrics: SkinEffectMetrics, buildingType?: string): AuraShape[] => {
    const aspectRatio = metrics.width / Math.max(metrics.height, 1);
    const lowerHeight = metrics.height * 0.48;
    const lowerY = metrics.bottom - lowerHeight / 2 - metrics.height * 0.04;
    const upperHeight = metrics.height * 0.34;
    const upperY = metrics.top + upperHeight / 2 + metrics.height * 0.18;
    const upperWidth = metrics.width * (aspectRatio > 1.35 ? 0.56 : 0.62);
    const crownY = metrics.top + metrics.height * 0.08;

    if (buildingType === 'tower' || buildingType === 'oil_well') {
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY + metrics.height * 0.06,
                width: metrics.width * 1.02,
                height: metrics.height * 0.78,
                radius: Math.max(10, metrics.width * 0.16),
                alpha: 1,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.top + metrics.height * 0.08,
                width: Math.max(metrics.width * 0.56, 18),
                height: Math.max(metrics.height * 0.22, 12),
                alpha: 0.84,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.bottom - metrics.height * 0.1,
                width: metrics.width * 1.12,
                height: Math.max(metrics.height * 0.22, 12),
                alpha: 0.56,
            },
        ];
    }

    if (buildingType === 'wall') {
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 1.08,
                height: metrics.height * 0.82,
                radius: Math.max(8, metrics.height * 0.34),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 0.82,
                height: metrics.height * 0.5,
                radius: Math.max(6, metrics.height * 0.24),
                alpha: 0.68,
            },
        ];
    }

    if (buildingType === 'bridge_node' || buildingType === 'wall_node' || buildingType === 'naval_mine') {
        return [
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 1.12,
                height: metrics.height * 1.04,
                alpha: 1,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 0.78,
                height: metrics.height * 0.72,
                alpha: 0.68,
            },
        ];
    }

    if (buildingType === 'dock' || buildingType === 'repair_dock' || buildingType === 'tank_factory' || buildingType === 'air_base') {
        const shoulderWidth = metrics.width * 0.28;
        const shoulderHeight = metrics.height * 0.32;
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: lowerY,
                width: metrics.width * 1.02,
                height: metrics.height * 0.54,
                radius: Math.max(12, metrics.width * 0.14),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: upperY,
                width: metrics.width * 0.74,
                height: metrics.height * 0.4,
                radius: Math.max(10, metrics.width * 0.1),
                alpha: 0.84,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX - metrics.width * 0.28,
                y: metrics.centerY + metrics.height * 0.02,
                width: shoulderWidth,
                height: shoulderHeight,
                radius: Math.max(8, shoulderWidth * 0.18),
                alpha: 0.54,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.28,
                y: metrics.centerY + metrics.height * 0.02,
                width: shoulderWidth,
                height: shoulderHeight,
                radius: Math.max(8, shoulderWidth * 0.18),
                alpha: 0.54,
            },
        ];
    }

    if (buildingType === 'oil_rig') {
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY + metrics.height * 0.06,
                width: metrics.width * 1.04,
                height: metrics.height * 0.5,
                radius: Math.max(10, metrics.width * 0.14),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.top + metrics.height * 0.18,
                width: metrics.width * 0.44,
                height: metrics.height * 0.56,
                radius: Math.max(8, metrics.width * 0.08),
                alpha: 0.84,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.bottom - metrics.height * 0.02,
                width: metrics.width * 1.14,
                height: Math.max(metrics.height * 0.18, 10),
                alpha: 0.42,
            },
        ];
    }

    if (buildingType === 'mine' || buildingType === 'farm') {
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY + metrics.height * 0.04,
                width: metrics.width * 0.98,
                height: metrics.height * 0.74,
                radius: Math.max(10, metrics.width * 0.14),
                alpha: 1,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.top + metrics.height * 0.1,
                width: metrics.width * 0.66,
                height: metrics.height * 0.24,
                alpha: 0.76,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.bottom - metrics.height * 0.06,
                width: metrics.width * 1.08,
                height: metrics.height * 0.24,
                alpha: 0.42,
            },
        ];
    }

    const shapes: AuraShape[] = [
        {
            kind: 'roundedRect',
            x: metrics.centerX,
            y: lowerY,
            width: metrics.width * 0.98,
            height: lowerHeight,
            radius: Math.max(10, metrics.width * 0.12),
            alpha: 1,
        },
        {
            kind: 'roundedRect',
            x: metrics.centerX,
            y: upperY,
            width: upperWidth * 1.08,
            height: upperHeight,
            radius: Math.max(8, upperWidth * 0.16),
            alpha: 0.94,
        },
        {
            kind: 'ellipse',
            x: metrics.centerX,
            y: crownY,
            width: Math.max(metrics.width * 0.42, 18),
            height: Math.max(metrics.height * 0.2, 10),
            alpha: 0.72,
        },
    ];

    if (aspectRatio > 1.35) {
        const shoulderY = metrics.centerY + metrics.height * 0.03;
        shapes.push(
            {
                kind: 'roundedRect',
                x: metrics.centerX - metrics.width * 0.28,
                y: shoulderY,
                width: metrics.width * 0.26,
                height: metrics.height * 0.28,
                radius: Math.max(6, metrics.width * 0.08),
                alpha: 0.52,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.28,
                y: shoulderY,
                width: metrics.width * 0.26,
                height: metrics.height * 0.28,
                radius: Math.max(6, metrics.width * 0.08),
                alpha: 0.52,
            }
        );
    }

    if (metrics.height > metrics.width * 1.06) {
        shapes.push({
            kind: 'ellipse',
            x: metrics.centerX,
            y: metrics.top + metrics.height * 0.02,
            width: Math.max(metrics.width * 0.22, 10),
            height: Math.max(metrics.height * 0.18, 12),
            alpha: 0.5,
        });
    }

    return shapes;
};

const getUnitAuraShapes = (metrics: SkinEffectMetrics, unitType?: string): AuraShape[] => {
    if (unitType === 'tank') {
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY + metrics.height * 0.03,
                width: metrics.width * 1.02,
                height: metrics.height * 0.52,
                radius: Math.max(10, metrics.height * 0.24),
                alpha: 1,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX + metrics.width * 0.04,
                y: metrics.centerY,
                width: metrics.width * 0.44,
                height: metrics.height * 0.38,
                alpha: 0.82,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX + metrics.width * 0.28,
                y: metrics.centerY,
                width: metrics.width * 0.34,
                height: metrics.height * 0.14,
                alpha: 0.44,
            },
        ];
    }

    if (unitType === 'humvee' || unitType === 'oil_seeker' || unitType === 'missile_launcher') {
        const cabWidth = unitType === 'humvee' ? 0.28 : 0.26;
        const rearWidth = unitType === 'missile_launcher' ? 0.46 : 0.4;
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY + metrics.height * 0.03,
                width: metrics.width * 1.04,
                height: metrics.height * 0.48,
                radius: Math.max(9, metrics.height * 0.22),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.16,
                y: metrics.centerY,
                width: metrics.width * cabWidth,
                height: metrics.height * 0.34,
                radius: Math.max(7, metrics.height * 0.18),
                alpha: 0.82,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX - metrics.width * 0.14,
                y: metrics.centerY,
                width: metrics.width * rearWidth,
                height: metrics.height * 0.32,
                radius: Math.max(7, metrics.height * 0.16),
                alpha: 0.54,
            },
        ];
    }

    if (unitType === 'destroyer' || unitType === 'pirate_ship' || unitType === 'construction_ship' || unitType === 'ferry') {
        const upperWidth = unitType === 'destroyer'
            ? 0.48
            : unitType === 'ferry'
                ? 0.42
                : 0.34;
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 1.04,
                height: metrics.height * 0.46,
                radius: Math.max(12, metrics.height * 0.24),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.04,
                y: metrics.centerY,
                width: metrics.width * upperWidth,
                height: metrics.height * 0.24,
                radius: Math.max(8, metrics.height * 0.14),
                alpha: 0.78,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX - metrics.width * 0.32,
                y: metrics.centerY,
                width: metrics.width * 0.24,
                height: metrics.height * 0.16,
                alpha: 0.42,
            },
        ];
    }

    if (unitType === 'light_plane') {
        return [
            {
                kind: 'polygon',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width,
                height: metrics.height,
                alpha: 1,
                points: [
                    { x: metrics.centerX - metrics.width * 0.42, y: metrics.centerY - metrics.height * 0.14 },
                    { x: metrics.centerX - metrics.width * 0.14, y: metrics.centerY - metrics.height * 0.34 },
                    { x: metrics.centerX + metrics.width * 0.08, y: metrics.centerY - metrics.height * 0.18 },
                    { x: metrics.centerX + metrics.width * 0.48, y: metrics.centerY },
                    { x: metrics.centerX + metrics.width * 0.08, y: metrics.centerY + metrics.height * 0.18 },
                    { x: metrics.centerX - metrics.width * 0.14, y: metrics.centerY + metrics.height * 0.34 },
                    { x: metrics.centerX - metrics.width * 0.42, y: metrics.centerY + metrics.height * 0.14 },
                ],
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.02,
                y: metrics.centerY,
                width: metrics.width * 0.52,
                height: metrics.height * 0.18,
                radius: Math.max(6, metrics.height * 0.12),
                alpha: 0.76,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX + metrics.width * 0.24,
                y: metrics.centerY,
                width: metrics.width * 0.2,
                height: metrics.height * 0.14,
                alpha: 0.46,
            },
        ];
    }

    if (unitType === 'heavy_plane') {
        return [
            {
                kind: 'polygon',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width,
                height: metrics.height,
                alpha: 1,
                points: [
                    { x: metrics.centerX - metrics.width * 0.48, y: metrics.centerY - metrics.height * 0.42 },
                    { x: metrics.centerX - metrics.width * 0.16, y: metrics.centerY - metrics.height * 0.34 },
                    { x: metrics.centerX + metrics.width * 0.46, y: metrics.centerY },
                    { x: metrics.centerX - metrics.width * 0.16, y: metrics.centerY + metrics.height * 0.34 },
                    { x: metrics.centerX - metrics.width * 0.48, y: metrics.centerY + metrics.height * 0.42 },
                ],
            },
            {
                kind: 'polygon',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 0.72,
                height: metrics.height * 0.54,
                alpha: 0.72,
                points: [
                    { x: metrics.centerX - metrics.width * 0.28, y: metrics.centerY - metrics.height * 0.2 },
                    { x: metrics.centerX - metrics.width * 0.05, y: metrics.centerY - metrics.height * 0.16 },
                    { x: metrics.centerX + metrics.width * 0.2, y: metrics.centerY },
                    { x: metrics.centerX - metrics.width * 0.05, y: metrics.centerY + metrics.height * 0.16 },
                    { x: metrics.centerX - metrics.width * 0.28, y: metrics.centerY + metrics.height * 0.2 },
                ],
            },
            {
                kind: 'ellipse',
                x: metrics.centerX + metrics.width * 0.12,
                y: metrics.centerY,
                width: metrics.width * 0.2,
                height: metrics.height * 0.14,
                alpha: 0.48,
            },
        ];
    }

    if (unitType === 'mothership') {
        return [
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 1.12,
                height: metrics.height * 1.12,
                alpha: 1,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 0.9,
                height: metrics.height * 0.9,
                alpha: 0.72,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 0.68,
                height: metrics.height * 0.68,
                alpha: 0.46,
            },
        ];
    }

    if (unitType === 'aircraft_carrier') {
        const primaryHeight = Math.max(metrics.height * 0.58, 24);
        const secondaryHeight = Math.max(metrics.height * 0.4, 16);
        return [
            {
                kind: 'roundedRect',
                x: metrics.centerX,
                y: metrics.centerY,
                width: metrics.width * 1.08,
                height: primaryHeight,
                radius: Math.max(10, primaryHeight * 0.36),
                alpha: 1,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.1,
                y: metrics.centerY,
                width: metrics.width * 0.86,
                height: secondaryHeight * 1.06,
                radius: Math.max(8, secondaryHeight * 0.36),
                alpha: 0.72,
            },
            {
                kind: 'roundedRect',
                x: metrics.centerX + metrics.width * 0.22,
                y: metrics.centerY - metrics.height * 0.22,
                width: Math.max(metrics.width * 0.2, 16),
                height: Math.max(metrics.height * 0.22, 12),
                radius: Math.max(5, metrics.height * 0.08),
                alpha: 0.46,
            },
        ];
    }

    const aspectRatio = metrics.width / Math.max(metrics.height, 1);
    const shapes: AuraShape[] = [
        {
            kind: 'ellipse',
            x: metrics.centerX,
            y: metrics.centerY + metrics.height * 0.06,
            width: metrics.width * 1.04,
            height: metrics.height * 0.7,
            alpha: 1,
        },
        {
            kind: 'ellipse',
            x: metrics.centerX,
            y: metrics.centerY - metrics.height * 0.18,
            width: metrics.width * 0.72,
            height: metrics.height * 0.48,
            alpha: 0.84,
        },
        {
            kind: 'ellipse',
            x: metrics.centerX,
            y: metrics.centerY - metrics.height * 0.34,
            width: Math.max(metrics.width * 0.32, 12),
            height: Math.max(metrics.height * 0.28, 10),
            alpha: 0.62,
        },
    ];

    if (aspectRatio > 1.45) {
        shapes.push(
            {
                kind: 'ellipse',
                x: metrics.centerX - metrics.width * 0.28,
                y: metrics.centerY + metrics.height * 0.02,
                width: metrics.width * 0.36,
                height: metrics.height * 0.3,
                alpha: 0.48,
            },
            {
                kind: 'ellipse',
                x: metrics.centerX + metrics.width * 0.28,
                y: metrics.centerY + metrics.height * 0.02,
                width: metrics.width * 0.36,
                height: metrics.height * 0.3,
                alpha: 0.48,
            }
        );
    }

    return shapes;
};

const getAuraShapes = (
    target: SkinRenderTarget,
    metrics: SkinEffectMetrics,
    renderType?: string
) => target === 'building' ? getBuildingAuraShapes(metrics, renderType) : getUnitAuraShapes(metrics, renderType);

const scalePolygonPoints = (
    points: Array<{ x: number; y: number }>,
    centerX: number,
    centerY: number,
    scale: number
) => points.map((point) => ({
    x: centerX + (point.x - centerX) * scale,
    y: centerY + (point.y - centerY) * scale,
}));

export const addOuterOutlineToArtContainer = (
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    target: SkinRenderTarget,
    color: number,
    options: OuterOutlineOptions = {}
) => {
    const metrics = measureSkinEffectMetrics(container, target);
    const renderType = typeof container.getData === 'function'
        ? target === 'unit'
            ? container.getData('unitArtType')
            : container.getData('buildingArtType')
        : undefined;
    const primaryShape = getAuraShapes(target, metrics, renderType)[0];
    const width = options.width ?? (target === 'building' ? 2 : 1.7);
    const alpha = options.alpha ?? 0.72;
    const expand = options.expand ?? (target === 'building' ? 1.05 : 1.08);

    if (container.list.length > 0) {
        const outlineGroup = scene.add.container(0, 0);
        const innerPass = createModelAuraPass(
            scene,
            container,
            metrics,
            color,
            Math.min(1, alpha * 0.96),
            expand,
            Phaser.BlendModes.SCREEN
        );
        const outerPass = createModelAuraPass(
            scene,
            container,
            metrics,
            color,
            Math.min(1, alpha * 0.58),
            expand + (target === 'building' ? 0.04 : 0.05),
            Phaser.BlendModes.SCREEN
        );
        outlineGroup.add([outerPass, innerPass]);
        outlineGroup.setData('skinEffectIgnore', true);
        container.add(outlineGroup);
        return outlineGroup;
    }

    let outline: Phaser.GameObjects.GameObject;

    if (primaryShape.kind === 'roundedRect') {
        const graphics = scene.add.graphics();
        graphics.lineStyle(width, color, alpha);
        graphics.strokeRoundedRect(
            primaryShape.x - (primaryShape.width * expand) / 2,
            primaryShape.y - (primaryShape.height * expand) / 2,
            primaryShape.width * expand,
            primaryShape.height * expand,
            (primaryShape.radius ?? 8) * expand
        );
        outline = graphics;
    } else if (primaryShape.kind === 'polygon' && primaryShape.points?.length) {
        const graphics = scene.add.graphics();
        const points = scalePolygonPoints(primaryShape.points, primaryShape.x, primaryShape.y, expand);
        graphics.lineStyle(width, color, alpha);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
        graphics.closePath();
        graphics.strokePath();
        outline = graphics;
    } else {
        const ellipse = scene.add.ellipse(
            primaryShape.x,
            primaryShape.y,
            primaryShape.width * expand,
            primaryShape.height * expand,
            color,
            0
        );
        ellipse.setStrokeStyle(width, color, alpha);
        outline = ellipse;
    }

    if ('setData' in outline && typeof outline.setData === 'function') {
        outline.setData('skinEffectIgnore', true);
    }

    container.add(outline);
    return outline;
};

export const getMotionTrailStyle = (skinId: SkinId): MotionTrailStyle | null => MOTION_TRAIL_STYLES[skinId] ?? null;

const drawAuraShape = (
    graphics: Phaser.GameObjects.Graphics,
    shape: AuraShape,
    scale: number
) => {
    if (shape.kind === 'polygon' && shape.points?.length) {
        graphics.fillPoints(scalePolygonPoints(shape.points, shape.x, shape.y, scale), true);
        return;
    }

    const width = shape.width * scale;
    const height = shape.height * scale;
    if (shape.kind === 'roundedRect') {
        graphics.fillRoundedRect(
            shape.x - width / 2,
            shape.y - height / 2,
            width,
            height,
            (shape.radius ?? 8) * scale
        );
        return;
    }

    graphics.fillEllipse(shape.x, shape.y, width, height);
};

const strokeAuraShape = (
    graphics: Phaser.GameObjects.Graphics,
    shape: AuraShape,
    scale: number
) => {
    if (shape.kind === 'polygon' && shape.points?.length) {
        const points = scalePolygonPoints(shape.points, shape.x, shape.y, scale);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
        graphics.closePath();
        graphics.strokePath();
        return;
    }

    const width = shape.width * scale;
    const height = shape.height * scale;
    if (shape.kind === 'roundedRect') {
        graphics.strokeRoundedRect(
            shape.x - width / 2,
            shape.y - height / 2,
            width,
            height,
            (shape.radius ?? 8) * scale
        );
        return;
    }

    graphics.strokeEllipse(shape.x, shape.y, width, height);
};

const createSoftAuraLayers = (
    scene: Phaser.Scene,
    shapes: AuraShape[],
    baseColor: number,
    passes: Array<{ scale: number; alpha: number }>,
    blendMode: Phaser.BlendModes = Phaser.BlendModes.NORMAL
) => passes.map((pass) => {
    const graphics = scene.add.graphics();
    shapes.forEach((shape) => {
        graphics.fillStyle(shape.color ?? baseColor, pass.alpha * (shape.alpha ?? 1));
        drawAuraShape(graphics, shape, pass.scale);
    });
    graphics.setBlendMode(blendMode);
    return graphics;
});

const shouldHideForAuraSnapshot = (child: Phaser.GameObjects.GameObject) => {
    if (!('getData' in child) || typeof child.getData !== 'function') {
        return false;
    }

    return Boolean(child.getData('skinEffectIgnore') || child.getData('skinAuraLine'));
};

const withAuraSnapshotSource = <T>(
    container: Phaser.GameObjects.Container,
    draw: () => T
): T => {
    const hidden: Array<{ object: Phaser.GameObjects.GameObject & { visible: boolean; setVisible: (value: boolean) => Phaser.GameObjects.GameObject }; visible: boolean }> = [];

    const visit = (child: Phaser.GameObjects.GameObject) => {
        if (shouldHideForAuraSnapshot(child)) {
            const visibleChild = child as Phaser.GameObjects.GameObject & { visible: boolean; setVisible: (value: boolean) => Phaser.GameObjects.GameObject };
            hidden.push({ object: visibleChild, visible: visibleChild.visible });
            visibleChild.setVisible(false);
            return;
        }

        if (child instanceof Phaser.GameObjects.Container) {
            child.list.forEach(visit);
        }
    };

    container.list.forEach(visit);

    try {
        return draw();
    } finally {
        hidden.forEach(({ object, visible }) => object.setVisible(visible));
    }
};

const createModelAuraPass = (
    scene: Phaser.Scene,
    sourceContainer: Phaser.GameObjects.Container,
    metrics: SkinEffectMetrics,
    color: number,
    alpha: number,
    scale: number,
    blendMode: Phaser.BlendModes
) => {
    const padding = Math.max(28, Math.ceil(Math.max(metrics.width, metrics.height) * 0.34));
    const textureWidth = Math.ceil(metrics.width + padding);
    const textureHeight = Math.ceil(metrics.height + padding);
    const renderTexture = scene.add.renderTexture(metrics.centerX, metrics.centerY, textureWidth, textureHeight);
    renderTexture.setOrigin(0.5, 0.5);
    renderTexture.setTint(color);
    renderTexture.setAlpha(alpha);
    renderTexture.setScale(scale);
    renderTexture.setBlendMode(blendMode);
    renderTexture.setData('skinEffectIgnore', true);

    withAuraSnapshotSource(sourceContainer, () => {
        renderTexture.clear();
        renderTexture.draw(
            sourceContainer,
            textureWidth / 2 - metrics.centerX,
            textureHeight / 2 - metrics.centerY
        );
    });

    return renderTexture;
};

const createGlowLayer = (
    scene: Phaser.Scene,
    palette: SkinPalette,
    target: SkinRenderTarget,
    metrics: SkinEffectMetrics,
    renderType?: string,
    sourceContainer?: Phaser.GameObjects.Container
): Phaser.GameObjects.Container => {
    const group = scene.add.container(0, 0);
    group.setData('skinEffectIgnore', true);
    const fallback = getFallbackMetrics(target);
    const scaleFactor = Math.max(metrics.width / fallback.width, metrics.height / fallback.height);
    const opacityBoost = 1 + Math.max(0, scaleFactor - 1) * 0.32;
    const outerAlpha = Phaser.Math.Clamp(palette.outerGlowAlpha * 1.55 * opacityBoost + 0.04, 0.16, 0.48);
    const coreAlpha = Phaser.Math.Clamp(palette.glowAlpha * 1.8 * opacityBoost + 0.05, 0.16, 0.52);
    const outlineAlpha = Phaser.Math.Clamp(palette.outlineAlpha * 1.22 * opacityBoost + 0.02, 0.18, 0.62);
    const accentOutlineAlpha = Phaser.Math.Clamp(outlineAlpha * 0.62, 0.12, 0.42);
    const majorLineWidth = Math.max(target === 'building' ? 3 : 2.5, Math.min(6.5, metrics.width * (target === 'building' ? 0.04 : 0.048)));
    const minorLineWidth = Math.max(1.5, Math.min(4, majorLineWidth * 0.56));
    const shapes = getAuraShapes(target, metrics, renderType);
    const glowLayers = sourceContainer
        ? [
            createModelAuraPass(
                scene,
                sourceContainer,
                metrics,
                palette.glow,
                outerAlpha * 0.62,
                target === 'building' ? 1.24 : 1.2,
                Phaser.BlendModes.SCREEN
            ),
            createModelAuraPass(
                scene,
                sourceContainer,
                metrics,
                palette.glow,
                outerAlpha * 0.46,
                target === 'building' ? 1.16 : 1.12,
                Phaser.BlendModes.SCREEN
            ),
            createModelAuraPass(
                scene,
                sourceContainer,
                metrics,
                palette.glow,
                coreAlpha * 0.34,
                1.08,
                Phaser.BlendModes.SCREEN
            ),
            createModelAuraPass(
                scene,
                sourceContainer,
                metrics,
                palette.secondary,
                coreAlpha * 0.28,
                1.03,
                Phaser.BlendModes.ADD
            ),
        ]
        : [
            ...createSoftAuraLayers(
                scene,
                shapes,
                palette.glow,
                [
                    { scale: target === 'building' ? 1.34 : 1.28, alpha: outerAlpha * 0.18 },
                    { scale: target === 'building' ? 1.24 : 1.19, alpha: outerAlpha * 0.28 },
                    { scale: target === 'building' ? 1.14 : 1.11, alpha: outerAlpha * 0.4 },
                ]
            ),
            ...createSoftAuraLayers(
                scene,
                shapes,
                palette.glow,
                [
                    { scale: 1.06, alpha: coreAlpha * 0.34 },
                    { scale: 1.01, alpha: coreAlpha * 0.48 },
                ]
            ),
        ];

    const outline = sourceContainer
        ? createModelAuraPass(
            scene,
            sourceContainer,
            metrics,
            palette.glow,
            outlineAlpha * 0.78,
            1.015,
            Phaser.BlendModes.SCREEN
        )
        : (() => {
            const graphics = scene.add.graphics();
            graphics.lineStyle(majorLineWidth, palette.glow, outlineAlpha * 0.82);
            shapes.forEach((shape) => strokeAuraShape(graphics, shape, 1.01));
            graphics.lineStyle(minorLineWidth, palette.secondary, accentOutlineAlpha);
            shapes.forEach((shape) => strokeAuraShape(graphics, shape, 0.94));
            graphics.setBlendMode(Phaser.BlendModes.SCREEN);
            return graphics;
        })();

    group.add([...glowLayers, outline]);
    return group;
};

const addDiamondSpark = (
    scene: Phaser.Scene,
    x: number,
    y: number,
    size: number,
    color: number,
    alpha: number
) => {
    const shard = scene.add.polygon(x, y, [
        0, -size,
        size * 0.72, 0,
        0, size,
        -size * 0.72, 0,
    ], color, alpha);
    shard.setBlendMode(Phaser.BlendModes.ADD);
    return shard;
};

const addCrossSpark = (
    scene: Phaser.Scene,
    x: number,
    y: number,
    length: number,
    color: number,
    alpha: number
) => {
    const h = scene.add.line(x, y, -length, 0, length, 0, color, alpha);
    const v = scene.add.line(x, y, 0, -length, 0, length, color, alpha);
    h.setLineWidth(1.6, 1.6);
    v.setLineWidth(1.6, 1.6);
    h.setBlendMode(Phaser.BlendModes.ADD);
    v.setBlendMode(Phaser.BlendModes.ADD);
    return [h, v];
};

const addFlameTongue = (
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    outerColor: number,
    innerColor: number,
    outerAlpha: number,
    innerAlpha: number
) => {
    const outer = scene.add.polygon(x, y, [
        -width * 0.48, height * 0.32,
        -width * 0.18, -height * 0.22,
        width * 0.04, -height * 0.58,
        width * 0.24, -height * 0.18,
        width * 0.38, 0,
        width * 0.12, height * 0.46,
        -width * 0.18, height * 0.28,
    ], outerColor, outerAlpha);
    outer.setBlendMode(Phaser.BlendModes.SCREEN);
    const inner = scene.add.polygon(x + width * 0.06, y + height * 0.02, [
        -width * 0.2, height * 0.18,
        -width * 0.04, -height * 0.12,
        width * 0.1, -height * 0.32,
        width * 0.22, -height * 0.08,
        width * 0.18, height * 0.2,
        -width * 0.02, height * 0.24,
    ], innerColor, innerAlpha);
    inner.setBlendMode(Phaser.BlendModes.ADD);
    return [outer, inner];
};

const addEnergyArc = (
    scene: Phaser.Scene,
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    color: number,
    alpha: number,
    width: number
) => {
    const arc = scene.add.arc(x, y, radius, startAngle, endAngle, false, color, 0);
    arc.setStrokeStyle(width, color, alpha);
    arc.setBlendMode(Phaser.BlendModes.SCREEN);
    return arc;
};

const addGoldEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const crown = addEnergyArc(
        scene,
        metrics.centerX + metrics.width * 0.18,
        metrics.centerY - metrics.height * 0.18,
        Math.max(10, metrics.width * 0.12),
        210,
        330,
        palette.glow,
        0.72,
        2.4
    );
    const sparkA = addDiamondSpark(scene, metrics.centerX + metrics.width * 0.26, metrics.centerY - metrics.height * 0.2, Math.max(3, metrics.width * 0.038), palette.secondary, 0.72);
    const sparkB = addDiamondSpark(scene, metrics.centerX - metrics.width * 0.16, metrics.centerY - metrics.height * 0.12, Math.max(2.4, metrics.width * 0.03), palette.glow, 0.5);
    group.add([crown, sparkA, sparkB]);
};

const addPlatinumEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const frostArc = addEnergyArc(
        scene,
        metrics.centerX + metrics.width * 0.08,
        metrics.centerY - metrics.height * 0.12,
        Math.max(14, metrics.width * 0.18),
        228,
        322,
        palette.glow,
        0.5,
        2.1
    );
    const crystal = scene.add.polygon(metrics.centerX + metrics.width * 0.24, metrics.centerY - metrics.height * 0.22, [
        0, -6,
        5, 0,
        0, 6,
        -4, 0,
    ], palette.secondary, 0.62);
    crystal.setBlendMode(Phaser.BlendModes.ADD);
    const shard = scene.add.line(metrics.centerX, metrics.centerY, metrics.width * 0.06, -metrics.height * 0.08, metrics.width * 0.22, -metrics.height * 0.18, palette.secondary, 0.44);
    shard.setLineWidth(1.4, 1.4);
    shard.setBlendMode(Phaser.BlendModes.ADD);
    group.add([frostArc, crystal, shard]);
};

const addTopazEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const heatArc = addEnergyArc(
        scene,
        metrics.centerX + metrics.width * 0.16,
        metrics.centerY - metrics.height * 0.14,
        Math.max(12, metrics.width * 0.14),
        220,
        340,
        palette.glow,
        0.72,
        2.6
    );
    const [flameOuter, flameInner] = addFlameTongue(
        scene,
        metrics.centerX + metrics.width * 0.24,
        metrics.centerY - metrics.height * 0.18,
        Math.max(12, metrics.width * 0.12),
        Math.max(16, metrics.height * 0.22),
        palette.glow,
        palette.secondary,
        0.36,
        0.28
    );
    group.add([heatArc, flameOuter, flameInner]);
};

const addDiamondEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const shard = scene.add.polygon(metrics.centerX + metrics.width * 0.2, metrics.centerY - metrics.height * 0.16, [
        0, -8,
        7, 0,
        0, 9,
        -6, 0,
    ], palette.glow, 0.46);
    shard.setBlendMode(Phaser.BlendModes.ADD);
    const streak = scene.add.line(metrics.centerX, metrics.centerY, metrics.width * 0.02, -metrics.height * 0.08, metrics.width * 0.28, -metrics.height * 0.2, palette.glow, 0.58);
    streak.setLineWidth(1.5, 1.5);
    streak.setBlendMode(Phaser.BlendModes.ADD);
    const spark = addDiamondSpark(scene, metrics.centerX + metrics.width * 0.28, metrics.centerY - metrics.height * 0.2, Math.max(2.8, metrics.width * 0.03), palette.secondary, 0.5);
    group.add([shard, streak, spark]);
};

const addObsidianEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const wispA = scene.add.polygon(metrics.centerX + metrics.width * 0.08, metrics.centerY - metrics.height * 0.08, [
        -10, 3,
        -4, -5,
        3, -8,
        8, -2,
        10, 4,
        2, 8,
        -8, 7,
    ], palette.shadow, 0.26);
    wispA.setBlendMode(Phaser.BlendModes.NORMAL);
    const wispB = scene.add.polygon(metrics.centerX + metrics.width * 0.18, metrics.centerY - metrics.height * 0.18, [
        -7, 2,
        -2, -4,
        4, -6,
        7, 0,
        4, 6,
        -3, 5,
    ], palette.glow, 0.22);
    wispB.setBlendMode(Phaser.BlendModes.SCREEN);
    const spectral = addEnergyArc(
        scene,
        metrics.centerX + metrics.width * 0.22,
        metrics.centerY - metrics.height * 0.18,
        Math.max(10, metrics.width * 0.1),
        220,
        320,
        palette.glow,
        0.56,
        2.2
    );
    group.add([wispA, wispB, spectral]);
};

const addGodlyEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const halo = addEnergyArc(
        scene,
        metrics.centerX + metrics.width * 0.12,
        metrics.centerY - metrics.height * 0.18,
        Math.max(12, metrics.width * 0.12),
        0,
        360,
        palette.glow,
        0.52,
        2.2
    );
    const rays = addCrossSpark(
        scene,
        metrics.centerX + metrics.width * 0.18,
        metrics.centerY - metrics.height * 0.18,
        Math.max(5, metrics.width * 0.08),
        palette.secondary,
        0.58
    );
    group.add([halo, ...rays]);
};

const addRubyEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const [flameOuter, flameInner] = addFlameTongue(
        scene,
        metrics.centerX + metrics.width * 0.14,
        metrics.centerY - metrics.height * 0.14,
        Math.max(13, metrics.width * 0.13),
        Math.max(18, metrics.height * 0.24),
        palette.glow,
        palette.secondary,
        0.44,
        0.3
    );
    const ember = addDiamondSpark(scene, metrics.centerX + metrics.width * 0.28, metrics.centerY - metrics.height * 0.2, Math.max(2.8, metrics.width * 0.03), palette.secondary, 0.58);
    group.add([flameOuter, flameInner, ember]);
};

const addDeveloperEffect = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
) => {
    const [flameOuter, flameInner] = addFlameTongue(
        scene,
        metrics.centerX + metrics.width * 0.12,
        metrics.centerY - metrics.height * 0.14,
        Math.max(14, metrics.width * 0.14),
        Math.max(20, metrics.height * 0.26),
        palette.glow,
        palette.primary,
        0.5,
        0.38
    );
    const spark = addDiamondSpark(scene, metrics.centerX + metrics.width * 0.24, metrics.centerY - metrics.height * 0.2, Math.max(3, metrics.width * 0.032), palette.secondary, 0.46);
    group.add([flameOuter, flameInner, spark]);

    scene.tweens.addCounter({
        from: 0,
        to: DEVELOPER_RAINBOW_COLORS.length - 1,
        duration: 4200,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => {
            const value = tween.getValue() ?? 0;
            const low = Math.floor(value);
            const high = (low + 1) % DEVELOPER_RAINBOW_COLORS.length;
            const color = blendColor(DEVELOPER_RAINBOW_COLORS[low], DEVELOPER_RAINBOW_COLORS[high], value - low);
            flameOuter.setFillStyle(color, 0.52);
            flameInner.setFillStyle(blendColor(color, 0xffffff, 0.38), 0.42);
            spark.setFillStyle(blendColor(color, 0xffffff, 0.18), 0.56);
        },
    });
};

const createSheenLayer = (
    scene: Phaser.Scene,
    skinId: SkinId,
    palette: SkinPalette,
    metrics: SkinEffectMetrics
): Phaser.GameObjects.Container => {
    const group = scene.add.container(0, 0);
    group.setData('skinEffectIgnore', true);

    switch (skinId) {
        case 'gold':
            addGoldEffect(scene, group, palette, metrics);
            break;
        case 'platinum':
            addPlatinumEffect(scene, group, palette, metrics);
            break;
        case 'topaz':
            addTopazEffect(scene, group, palette, metrics);
            break;
        case 'diamond':
            addDiamondEffect(scene, group, palette, metrics);
            break;
        case 'obsidian':
            addObsidianEffect(scene, group, palette, metrics);
            break;
        case 'godly':
            addGodlyEffect(scene, group, palette, metrics);
            break;
        case 'ruby':
            addRubyEffect(scene, group, palette, metrics);
            break;
        case 'leaderboard_first':
            addGoldEffect(scene, group, palette, metrics);
            addGodlyEffect(scene, group, palette, metrics);
            break;
        case 'leaderboard_second':
            addPlatinumEffect(scene, group, palette, metrics);
            addDiamondEffect(scene, group, palette, metrics);
            break;
        case 'leaderboard_third':
            addTopazEffect(scene, group, palette, metrics);
            addRubyEffect(scene, group, palette, metrics);
            break;
        case 'leaderboard_top10':
            addDiamondEffect(scene, group, palette, metrics);
            break;
        case 'developer':
            addDeveloperEffect(scene, group, palette, metrics);
            break;
        default:
            break;
    }

    return group;
};

const addDiamondTrail = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    length: number,
    width: number
) => {
    const core = scene.add.ellipse(-length * 0.12, 0, length, width * 0.58, palette.glow, 0.54);
    core.setBlendMode(Phaser.BlendModes.SCREEN);
    const tail = scene.add.ellipse(-length * 0.46, 0, length * 0.72, width * 0.34, palette.primary, 0.42);
    tail.setBlendMode(Phaser.BlendModes.SCREEN);
    const shard = scene.add.polygon(length * 0.16, 0, [
        0, -width * 0.34,
        width * 0.26, 0,
        0, width * 0.34,
        -width * 0.18, 0,
    ], palette.glow, 0.62);
    shard.setBlendMode(Phaser.BlendModes.ADD);
    const sparkle = addDiamondSpark(scene, length * 0.26, 0, Math.max(2.2, width * 0.1), palette.primary, 0.36);
    group.add([tail, core, shard, sparkle]);
};

const addObsidianTrail = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    length: number,
    width: number
) => {
    const smoke = scene.add.ellipse(-length * 0.16, 0, length * 0.98, width * 0.76, palette.shadow, 0.42);
    smoke.setBlendMode(Phaser.BlendModes.NORMAL);
    const spectral = scene.add.ellipse(-length * 0.04, 0, length * 0.78, width * 0.46, palette.glow, 0.34);
    spectral.setBlendMode(Phaser.BlendModes.SCREEN);
    const ash1 = addDiamondSpark(scene, -length * 0.42, -width * 0.12, Math.max(2.2, width * 0.1), palette.glow, 0.3);
    const ash2 = addDiamondSpark(scene, length * 0.14, width * 0.14, Math.max(1.8, width * 0.08), palette.primary, 0.24);
    group.add([smoke, spectral, ash1, ash2]);
};

const addGodlyTrail = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    length: number,
    width: number
) => {
    const ribbon = scene.add.ellipse(-length * 0.08, 0, length * 0.92, width * 0.52, palette.glow, 0.48);
    ribbon.setBlendMode(Phaser.BlendModes.SCREEN);
    const halo = scene.add.ellipse(length * 0.1, 0, width * 0.92, width * 0.42, palette.glow, 0.44);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    const star = addCrossSpark(scene, length * 0.2, 0, Math.max(2, width * 0.18), palette.secondary, 0.46);
    group.add([ribbon, halo, ...star]);
};

const addRubyTrail = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    length: number,
    width: number
) => {
    const flameBody = scene.add.polygon(length * 0.06, 0, [
        -length * 0.42, -width * 0.18,
        length * 0.14, -width * 0.36,
        length * 0.32, 0,
        length * 0.12, width * 0.34,
        -length * 0.46, width * 0.16,
    ], palette.glow, 0.5);
    flameBody.setBlendMode(Phaser.BlendModes.SCREEN);
    const emberCore = scene.add.ellipse(-length * 0.04, 0, length * 0.56, width * 0.3, palette.primary, 0.42);
    emberCore.setBlendMode(Phaser.BlendModes.ADD);
    const ember1 = addDiamondSpark(scene, length * 0.18, -width * 0.18, Math.max(2, width * 0.1), palette.secondary, 0.38);
    const ember2 = addDiamondSpark(scene, -length * 0.18, width * 0.16, Math.max(1.8, width * 0.08), palette.glow, 0.3);
    group.add([flameBody, emberCore, ember1, ember2]);
};

const addDeveloperTrail = (
    scene: Phaser.Scene,
    group: Phaser.GameObjects.Container,
    palette: SkinPalette,
    length: number,
    width: number
) => {
    const [flameBody, innerFlame] = addFlameTongue(
        scene,
        length * 0.02,
        0,
        Math.max(10, width * 1.7),
        Math.max(14, width * 1.9),
        palette.glow,
        palette.primary,
        0.56,
        0.44
    );
    const emberA = addDiamondSpark(scene, length * 0.18, -width * 0.14, Math.max(2, width * 0.1), palette.secondary, 0.28);
    const emberB = addDiamondSpark(scene, -length * 0.12, width * 0.1, Math.max(1.8, width * 0.08), palette.glow, 0.24);
    group.add([flameBody, innerFlame, emberA, emberB]);

    scene.tweens.addCounter({
        from: 0,
        to: DEVELOPER_RAINBOW_COLORS.length - 1,
        duration: 3600,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => {
            const value = tween.getValue() ?? 0;
            const low = Math.floor(value);
            const high = (low + 1) % DEVELOPER_RAINBOW_COLORS.length;
            const color = blendColor(DEVELOPER_RAINBOW_COLORS[low], DEVELOPER_RAINBOW_COLORS[high], value - low);
            flameBody.setFillStyle(color, 0.58);
            innerFlame.setFillStyle(blendColor(color, 0xffffff, 0.34), 0.46);
            emberA.setFillStyle(blendColor(color, 0xffffff, 0.18), 0.34);
            emberB.setFillStyle(color, 0.3);
        },
    });
};

export const createMotionTrailSegment = (
    scene: Phaser.Scene,
    skinId: SkinId,
    x: number,
    y: number,
    angle: number,
    unitScale: number
): { container: Phaser.GameObjects.Container; lifetimeMs: number; baseAlpha: number; growth: number } | null => {
    const style = getMotionTrailStyle(skinId);
    const definition = SKIN_DEFINITIONS_BY_ID[skinId];
    if (!style || !definition) {
        return null;
    }

    const enhancementLevel = getRuntimeSkinEnhancementLevel(skinId, 'unit');
    const palette = enhancePaletteForSkinCopies(definition.palette, enhancementLevel);
    const root = scene.add.container(x, y);
    const length = 18 * unitScale * palette.trailScale * (1 + enhancementLevel * 0.025);
    const width = 9 * unitScale * Math.max(0.92, palette.trailScale * 0.9) * (1 + enhancementLevel * 0.02);

    if (skinId === 'diamond') {
        addDiamondTrail(scene, root, palette, length, width);
    } else if (skinId === 'obsidian') {
        addObsidianTrail(scene, root, palette, length, width);
    } else if (skinId === 'godly') {
        addGodlyTrail(scene, root, palette, length, width);
    } else if (skinId === 'ruby' || skinId === 'leaderboard_third') {
        addRubyTrail(scene, root, palette, length, width);
    } else if (skinId === 'leaderboard_top10' || skinId === 'leaderboard_second') {
        addDiamondTrail(scene, root, palette, length, width);
    } else if (skinId === 'leaderboard_first') {
        addGodlyTrail(scene, root, palette, length, width);
    } else if (skinId === 'developer') {
        addDeveloperTrail(scene, root, palette, length, width);
    } else {
        return null;
    }

    root.rotation = angle;
    root.setDepth(18.6);
    root.setAlpha(style.baseAlpha);

    return {
        container: root,
        lifetimeMs: style.lifetimeMs,
        baseAlpha: style.baseAlpha,
        growth: style.growth,
    };
};

const isPreviewScene = (scene: Phaser.Scene) => /preview/i.test(scene.sys.settings.key || '');

const animateSkinEffects = (
    scene: Phaser.Scene,
    glowLayer: Phaser.GameObjects.Container,
    sheenLayer: Phaser.GameObjects.Container,
    palette: SkinPalette,
    target: SkinRenderTarget
) => {
    if (palette.pulseDurationMs <= 0) {
        return;
    }

    const preview = isPreviewScene(scene);
    const pulseStrength = preview ? palette.pulseStrength : Math.max(0.026, palette.pulseStrength * 0.62);
    const glowFrom = preview ? 0.76 : 0.84;
    const glowTo = preview ? 1 : 0.98;

    glowLayer.setAlpha(glowTo);

    scene.tweens.add({
        targets: glowLayer,
        alpha: { from: glowFrom, to: glowTo },
        scaleX: { from: 1 - pulseStrength * 0.12, to: 1 + pulseStrength },
        scaleY: { from: 1 - pulseStrength * 0.08, to: 1 + pulseStrength * 0.92 },
        duration: palette.pulseDurationMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
    });

    scene.tweens.add({
        targets: sheenLayer,
        x: target === 'building' ? 12 : 9,
        y: target === 'building' ? -5 : -3.5,
        alpha: { from: preview ? 0.58 : 0.46, to: preview ? 1 : 0.88 },
        duration: Math.max(1200, palette.pulseDurationMs - (preview ? 260 : 180)),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
    });
};

export const applySkinToArtContainer = (
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    skinId: SkinId,
    target: SkinRenderTarget
) => {
    const definition = SKIN_DEFINITIONS_BY_ID[skinId];
    if (!definition || skinId === 'default') {
        return;
    }

    const palette = enhancePaletteForSkinCopies(definition.palette, getRuntimeSkinEnhancementLevel(skinId, target));
    const metrics = measureSkinEffectMetrics(container, target);
    const renderType = typeof container.getData === 'function'
        ? target === 'unit'
            ? container.getData('unitArtType')
            : container.getData('buildingArtType')
        : undefined;
    const glowLayer = createGlowLayer(scene, palette, target, metrics, renderType, container);
    container.addAt(glowLayer, 0);

    container.list
        .filter((child) => child !== glowLayer)
        .forEach((child) => applySkinToDisplayObject(child, palette, target));

    addOuterOutlineToArtContainer(scene, container, target, palette.glow, {
        width: target === 'building' ? 2.2 : 1.85,
        alpha: target === 'building' ? 0.82 : 0.72,
        expand: target === 'building' ? 1.06 : 1.09,
    });

    const sheenLayer = createSheenLayer(scene, skinId, palette, metrics);
    container.add(sheenLayer);
    animateSkinEffects(scene, glowLayer, sheenLayer, palette, target);
    if (skinId === 'developer') {
        animateDeveloperSkinPalette(scene, container, target, palette, glowLayer, sheenLayer);
    }
};
