import { memo, useEffect, useRef, useState } from 'react';
import { settingsManager, type GraphicsSettings, type Settings } from '../game/SettingsManager';
import './LobbyBackdrop.css';

type LobbyBackdropProps = {
    electronSafe?: boolean;
};

type ProjectileKind = 'bullet' | 'rocket';
type ProjectileTone = 'ally' | 'enemy';
type ProjectileMaterial = 'alloy' | 'plasma' | 'ember' | 'prism';

type ProjectilePalette = {
    hue: number;
    saturation: number;
    lightness: number;
    glow: string;
    trail: string;
    trailSoft: string;
    cap: string;
    mid: string;
    shadow: string;
};

type SimulationProjectile = {
    id: number;
    kind: ProjectileKind;
    tone: ProjectileTone;
    material: ProjectileMaterial;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    mass: number;
    age: number;
    sizeScale: number;
    trailLength: number;
    turnRate: number;
    turnFrequency: number;
    turnPhase: number;
    palette: ProjectilePalette;
    sprite: HTMLCanvasElement;
    dead?: boolean;
};

type CollisionBurst = {
    x: number;
    y: number;
    age: number;
    duration: number;
    maxRadius: number;
    hue: number;
    saturation: number;
    lightness: number;
};

type SpriteCache = Map<string, HTMLCanvasElement>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${Math.round(h)}, ${Math.round(clamp(s, 0, 100))}%, ${Math.round(clamp(l, 0, 100))}%, ${clamp(a, 0, 1)})`;

function getProjectileLevels(graphics: GraphicsSettings) {
    const bulletPercent = clamp(graphics.menuProjectileMultiplierPercent ?? 100, 0, 10000);
    const rocketPercent = clamp(graphics.menuRocketMultiplierPercent ?? 100, 0, 10000);
    return {
        bulletLevel: Math.sqrt(Math.max(0, bulletPercent) / 100),
        rocketLevel: Math.sqrt(Math.max(0, rocketPercent) / 100),
    };
}

function getProjectileTargets(graphics: GraphicsSettings, electronSafe: boolean) {
    const { bulletLevel, rocketLevel } = getProjectileLevels(graphics);
    const qualityScalar = graphics.highQuality ? 1 : 0.92;
    const safeScalar = electronSafe ? 0.88 : 1;
    const bulletCap = electronSafe ? 260 : 340;
    const rocketCap = electronSafe ? 22 : 30;

    const bulletTarget = clamp(
        Math.round((12 + bulletLevel * 14 + bulletLevel * bulletLevel * 1.7) * qualityScalar * safeScalar),
        0,
        bulletCap,
    );
    const rocketTarget = clamp(
        Math.round(
            (1.5 + rocketLevel * 1.6 + rocketLevel * rocketLevel * 0.16 + bulletLevel * 0.45 + bulletLevel * bulletLevel * 0.08)
            * qualityScalar
            * safeScalar,
        ),
        0,
        rocketCap,
    );

    return { bulletTarget, rocketTarget };
}

function pickMaterial(kind: ProjectileKind, graphics: GraphicsSettings): ProjectileMaterial {
    const materials: ProjectileMaterial[] = ['alloy', 'plasma', 'ember', 'prism'];
    const variety = clamp(graphics.menuProjectileMaterialVariety ?? 0.8, 0, 1);
    if (variety <= 0.05) {
        return kind === 'rocket' ? 'alloy' : 'plasma';
    }
    const selection = materials.slice(0, Math.max(1, Math.round(1 + variety * (materials.length - 1))));
    return selection[Math.floor(Math.random() * selection.length)] ?? selection[0];
}

function createPalette(tone: ProjectileTone, graphics: GraphicsSettings): ProjectilePalette {
    const variety = clamp(graphics.menuProjectileColorVariety ?? 0.85, 0, 1);
    const baseHue = tone === 'ally' ? 152 : 22;
    const hueSpan = 24 + variety * 320;
    const hue = (baseHue + (Math.random() - 0.5) * hueSpan + 360) % 360;
    const saturation = clamp(66 + Math.random() * 24 + variety * 10, 54, 98);
    const lightness = clamp(46 + Math.random() * 18, 40, 78);

    return {
        hue,
        saturation,
        lightness,
        glow: hsla(hue, saturation + 10, lightness + 20, 0.55),
        trail: hsla(hue, saturation + 8, lightness + 15, 0.92),
        trailSoft: hsla(hue, saturation + 4, lightness + 6, 0.36),
        cap: hsla((hue + 8) % 360, saturation - 18, 96, 1),
        mid: hsla(hue, saturation, lightness + 6, 1),
        shadow: hsla((hue + 12) % 360, saturation - 26, 12, 0.6),
    };
}

function getSpriteCacheKey(kind: ProjectileKind, material: ProjectileMaterial, palette: ProjectilePalette, sizeScale: number) {
    const hueBucket = Math.round(palette.hue / 14) * 14;
    const sizeBucket = Math.round(sizeScale * 10) / 10;
    return `${kind}:${material}:${hueBucket}:${sizeBucket}`;
}

function createSpriteCanvas(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(width));
    canvas.height = Math.max(2, Math.round(height));
    return canvas;
}

function createProjectileSprite(
    kind: ProjectileKind,
    material: ProjectileMaterial,
    palette: ProjectilePalette,
    sizeScale: number,
    cache: SpriteCache,
) {
    const key = getSpriteCacheKey(kind, material, palette, sizeScale);
    const cached = cache.get(key);
    if (cached) return cached;

    const canvas = createSpriteCanvas(kind === 'rocket' ? 72 * sizeScale : 24 * sizeScale, kind === 'rocket' ? 34 * sizeScale : 14 * sizeScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.translate(centerX, centerY);

    if (kind === 'bullet') {
        const radius = Math.max(4, canvas.height * 0.32);
        const gradient = ctx.createRadialGradient(-radius * 0.2, -radius * 0.15, radius * 0.25, 0, 0, radius * 1.3);
        gradient.addColorStop(0, palette.cap);
        gradient.addColorStop(0.48, palette.mid);
        gradient.addColorStop(1, hsla(palette.hue, palette.saturation + 8, palette.lightness - 10, 1));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.25, radius, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = hsla(palette.hue, palette.saturation + 4, palette.lightness + 18, material === 'plasma' ? 0.9 : 0.54);
        ctx.lineWidth = Math.max(1, radius * 0.28);
        ctx.beginPath();
        ctx.moveTo(-radius * 0.45, -radius * 0.25);
        ctx.lineTo(radius * 0.6, 0);
        ctx.stroke();
    } else {
        const bodyLength = canvas.width * 0.58;
        const bodyHeight = canvas.height * 0.34;
        const finColor = material === 'ember'
            ? hsla(palette.hue, palette.saturation + 6, palette.lightness - 18, 1)
            : hsla(palette.hue, palette.saturation - 4, palette.lightness - 10, 1);
        const bodyGradient = ctx.createLinearGradient(-bodyLength * 0.5, 0, bodyLength * 0.5, 0);
        bodyGradient.addColorStop(0, hsla(palette.hue, palette.saturation - 6, palette.lightness + 26, 1));
        bodyGradient.addColorStop(material === 'prism' ? 0.34 : 0.42, palette.mid);
        bodyGradient.addColorStop(1, hsla(palette.hue, palette.saturation + 10, palette.lightness - 16, 1));

        ctx.fillStyle = finColor;
        ctx.beginPath();
        ctx.moveTo(-bodyLength * 0.2, -bodyHeight * 0.2);
        ctx.lineTo(-bodyLength * 0.52, -bodyHeight * 0.82);
        ctx.lineTo(-bodyLength * 0.38, 0);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-bodyLength * 0.2, bodyHeight * 0.2);
        ctx.lineTo(-bodyLength * 0.52, bodyHeight * 0.82);
        ctx.lineTo(-bodyLength * 0.38, 0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.moveTo(-bodyLength * 0.56, 0);
        ctx.lineTo(-bodyLength * 0.24, -bodyHeight * 0.62);
        ctx.lineTo(bodyLength * 0.26, -bodyHeight * 0.54);
        ctx.lineTo(bodyLength * 0.56, 0);
        ctx.lineTo(bodyLength * 0.26, bodyHeight * 0.54);
        ctx.lineTo(-bodyLength * 0.24, bodyHeight * 0.62);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = material === 'alloy'
            ? hsla(palette.hue, palette.saturation - 14, palette.lightness + 14, 0.92)
            : hsla(palette.hue, palette.saturation + 12, palette.lightness + 18, 0.74);
        ctx.lineWidth = Math.max(1.2, sizeScale * 1.1);
        ctx.beginPath();
        ctx.moveTo(-bodyLength * 0.1, -bodyHeight * 0.35);
        ctx.lineTo(bodyLength * 0.22, -bodyHeight * 0.08);
        ctx.stroke();

        ctx.fillStyle = palette.cap;
        ctx.beginPath();
        ctx.moveTo(bodyLength * 0.24, -bodyHeight * 0.44);
        ctx.lineTo(bodyLength * 0.62, 0);
        ctx.lineTo(bodyLength * 0.24, bodyHeight * 0.44);
        ctx.closePath();
        ctx.fill();

        if (material !== 'ember') {
            ctx.fillStyle = material === 'prism'
                ? hsla((palette.hue + 50) % 360, palette.saturation + 6, palette.lightness + 22, 0.92)
                : hsla((palette.hue + 18) % 360, palette.saturation + 6, palette.lightness + 18, 0.88);
            ctx.fillRect(-bodyLength * 0.02, -bodyHeight * 0.48, bodyLength * 0.18, bodyHeight * 0.96);
        }
    }

    cache.set(key, canvas);
    return canvas;
}

function spawnProjectile(
    kind: ProjectileKind,
    width: number,
    height: number,
    graphics: GraphicsSettings,
    cache: SpriteCache,
    spawnInside = false,
): SimulationProjectile {
    const directionFromLeft = Math.random() > 0.5;
    const tone: ProjectileTone = directionFromLeft ? 'ally' : 'enemy';
    const material = pickMaterial(kind, graphics);
    const palette = createPalette(tone, graphics);
    const sizeVariance = clamp(graphics.menuProjectileSizeVariance ?? 0.7, 0, 2);
    const sizeScale = clamp(
        1 + (Math.random() - 0.5) * (kind === 'rocket' ? 1.2 : 0.9) * sizeVariance,
        kind === 'rocket' ? 0.72 : 0.66,
        kind === 'rocket' ? 2.2 : 1.8,
    );
    const sprite = createProjectileSprite(kind, material, palette, sizeScale, cache);
    const speed = kind === 'rocket'
        ? randomBetween(180, 290) * (0.95 + sizeScale * 0.1)
        : randomBetween(250, 470) * (0.95 + sizeScale * 0.08);
    const angleDeg = directionFromLeft
        ? randomBetween(-14, 14)
        : randomBetween(166, 194);
    const angle = angleDeg * (Math.PI / 180);
    const radius = kind === 'rocket'
        ? Math.max(10, sprite.height * 0.22)
        : Math.max(3.5, sprite.height * 0.24);

    return {
        id: Math.round(Math.random() * 1e9),
        kind,
        tone,
        material,
        x: spawnInside ? randomBetween(-40, width + 40) : (directionFromLeft ? -90 : width + 90),
        y: spawnInside ? randomBetween(18, Math.max(18, height - 18)) : randomBetween(20, Math.max(20, height - 20)),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius,
        mass: kind === 'rocket' ? 2.8 * sizeScale : 1.05 * sizeScale,
        age: randomBetween(0, 2),
        sizeScale,
        trailLength: kind === 'rocket' ? 58 * sizeScale : 34 * sizeScale,
        turnRate: kind === 'rocket'
            ? randomBetween(0.32, 0.88) * clamp(graphics.menuRocketTurnStrength ?? 1.1, 0, 2.5)
            : randomBetween(0.04, 0.14) * (0.4 + clamp(graphics.menuRocketTurnStrength ?? 1.1, 0, 2.5) * 0.18),
        turnFrequency: kind === 'rocket' ? randomBetween(1.1, 2.0) : randomBetween(0.6, 1.2),
        turnPhase: randomBetween(0, Math.PI * 2),
        palette,
        sprite,
    };
}

function createBurst(
    x: number,
    y: number,
    sizeMultiplier: number,
    palette: ProjectilePalette,
    graphics: GraphicsSettings,
): CollisionBurst {
    const intensity = clamp(graphics.menuExplosionDensity ?? 1, 0, 2);
    return {
        x,
        y,
        age: 0,
        duration: 0.26 + intensity * 0.24 + Math.random() * 0.18,
        maxRadius: (28 + intensity * 34) * sizeMultiplier,
        hue: palette.hue,
        saturation: palette.saturation,
        lightness: palette.lightness,
    };
}

function drawProjectile(ctx: CanvasRenderingContext2D, projectile: SimulationProjectile) {
    const heading = Math.atan2(projectile.vy, projectile.vx);
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(heading);

    const tailStart = -projectile.trailLength;
    ctx.lineCap = 'round';
    ctx.globalAlpha = projectile.kind === 'rocket' ? 0.42 : 0.22;
    ctx.strokeStyle = projectile.palette.trailSoft;
    ctx.lineWidth = projectile.kind === 'rocket' ? 8 * projectile.sizeScale : 4 * projectile.sizeScale;
    ctx.beginPath();
    ctx.moveTo(tailStart, 0);
    ctx.lineTo(-projectile.radius * 0.3, 0);
    ctx.stroke();

    ctx.globalAlpha = 0.96;
    ctx.strokeStyle = projectile.palette.trail;
    ctx.lineWidth = projectile.kind === 'rocket' ? 3.4 * projectile.sizeScale : 1.7 * projectile.sizeScale;
    ctx.beginPath();
    ctx.moveTo(tailStart, 0);
    ctx.lineTo(-projectile.radius * 0.18, 0);
    ctx.stroke();

    if (projectile.kind === 'rocket') {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = hsla(projectile.palette.hue + 10, projectile.palette.saturation + 8, 86, 0.85);
        ctx.beginPath();
        ctx.moveTo(-projectile.radius * 1.12, 0);
        ctx.lineTo(-projectile.radius * 2.8, -projectile.radius * 0.72);
        ctx.lineTo(-projectile.radius * 2.18, 0);
        ctx.lineTo(-projectile.radius * 2.8, projectile.radius * 0.72);
        ctx.closePath();
        ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.drawImage(projectile.sprite, -projectile.sprite.width / 2, -projectile.sprite.height / 2);
    ctx.restore();
}

function drawBurst(ctx: CanvasRenderingContext2D, burst: CollisionBurst) {
    const progress = clamp(burst.age / burst.duration, 0, 1);
    const radius = burst.maxRadius * (0.3 + progress * 0.9);
    const alpha = 1 - progress;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const glow = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, radius);
    glow.addColorStop(0, hsla(burst.hue, burst.saturation - 10, 96, alpha * 0.85));
    glow.addColorStop(0.24, hsla((burst.hue + 12) % 360, burst.saturation + 12, clamp(burst.lightness + 18, 0, 100), alpha * 0.62));
    glow.addColorStop(0.7, hsla((burst.hue + 22) % 360, burst.saturation + 8, clamp(burst.lightness - 8, 0, 100), alpha * 0.26));
    glow.addColorStop(1, hsla((burst.hue + 22) % 360, burst.saturation + 8, clamp(burst.lightness - 12, 0, 100), 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = hsla(burst.hue, burst.saturation - 4, 98, 1);
    ctx.lineWidth = Math.max(1.2, radius * 0.08);
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, radius * 0.64, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
}

function reflectEdge(projectile: SimulationProjectile, width: number, height: number) {
    if (projectile.y < projectile.radius && projectile.vy < 0) {
        projectile.y = projectile.radius;
        projectile.vy *= -1;
    } else if (projectile.y > height - projectile.radius && projectile.vy > 0) {
        projectile.y = height - projectile.radius;
        projectile.vy *= -1;
    }

    if (projectile.x < -140 || projectile.x > width + 140) {
        projectile.dead = true;
    }
}

function resolveBulletRicochet(left: SimulationProjectile, right: SimulationProjectile) {
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = left.radius + right.radius - distance;

    if (overlap > 0) {
        left.x -= nx * overlap * 0.5;
        left.y -= ny * overlap * 0.5;
        right.x += nx * overlap * 0.5;
        right.y += ny * overlap * 0.5;
    }

    const tx = -ny;
    const ty = nx;
    const dpTanLeft = left.vx * tx + left.vy * ty;
    const dpTanRight = right.vx * tx + right.vy * ty;
    const dpNormLeft = left.vx * nx + left.vy * ny;
    const dpNormRight = right.vx * nx + right.vy * ny;

    const nextNormLeft = (dpNormLeft * (left.mass - right.mass) + 2 * right.mass * dpNormRight) / (left.mass + right.mass);
    const nextNormRight = (dpNormRight * (right.mass - left.mass) + 2 * left.mass * dpNormLeft) / (left.mass + right.mass);

    left.vx = (tx * dpTanLeft + nx * nextNormLeft) * 0.98;
    left.vy = (ty * dpTanLeft + ny * nextNormLeft) * 0.98;
    right.vx = (tx * dpTanRight + nx * nextNormRight) * 0.98;
    right.vy = (ty * dpTanRight + ny * nextNormRight) * 0.98;
}

export const LobbyBackdrop = memo(function LobbyBackdrop({ electronSafe = false }: LobbyBackdropProps) {
    const [graphics, setGraphics] = useState<GraphicsSettings>(() => settingsManager.getSettings().graphics);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleSettingsChange = (settings: Settings) => {
            setGraphics(settings.graphics);
        };

        settingsManager.on('change', handleSettingsChange);
        return () => settingsManager.off('change', handleSettingsChange);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrame = 0;
        let resizeObserver: ResizeObserver | null = null;
        let disposed = false;
        let width = 0;
        let height = 0;
        let dpr = 1;
        const cache: SpriteCache = new Map();
        let lastTime = performance.now();
        let projectiles: SimulationProjectile[] = [];
        let bursts: CollisionBurst[] = [];

        const resize = () => {
            const rect = container.getBoundingClientRect();
            width = Math.max(1, Math.round(rect.width));
            height = Math.max(1, Math.round(rect.height));
            dpr = clamp(window.devicePixelRatio || 1, 1, electronSafe ? 1.35 : 1.75);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const syncPopulation = () => {
            const { bulletTarget, rocketTarget } = getProjectileTargets(graphics, electronSafe);
            const bullets = projectiles.filter(projectile => projectile.kind === 'bullet');
            const rockets = projectiles.filter(projectile => projectile.kind === 'rocket');

            while (bullets.length + projectiles.filter(projectile => projectile.kind === 'bullet' && projectile.dead).length < bulletTarget && width > 0 && height > 0) {
                const projectile = spawnProjectile('bullet', width, height, graphics, cache, true);
                projectiles.push(projectile);
                bullets.push(projectile);
            }

            while (rockets.length + projectiles.filter(projectile => projectile.kind === 'rocket' && projectile.dead).length < rocketTarget && width > 0 && height > 0) {
                const projectile = spawnProjectile('rocket', width, height, graphics, cache, true);
                projectiles.push(projectile);
                rockets.push(projectile);
            }

            if (bullets.length > bulletTarget) {
                let toRemove = bullets.length - bulletTarget;
                for (let index = projectiles.length - 1; index >= 0 && toRemove > 0; index -= 1) {
                    if (projectiles[index]?.kind !== 'bullet') continue;
                    projectiles.splice(index, 1);
                    toRemove -= 1;
                }
            }

            if (rockets.length > rocketTarget) {
                let toRemove = rockets.length - rocketTarget;
                for (let index = projectiles.length - 1; index >= 0 && toRemove > 0; index -= 1) {
                    if (projectiles[index]?.kind !== 'rocket') continue;
                    projectiles.splice(index, 1);
                    toRemove -= 1;
                }
            }
        };

        const step = (now: number) => {
            if (disposed) return;

            const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
            lastTime = now;
            syncPopulation();

            ctx.clearRect(0, 0, width, height);

            for (const projectile of projectiles) {
                projectile.age += dt;
                const speed = Math.hypot(projectile.vx, projectile.vy);
                const heading = Math.atan2(projectile.vy, projectile.vx)
                    + Math.sin(projectile.age * projectile.turnFrequency + projectile.turnPhase) * projectile.turnRate * dt;
                projectile.vx = Math.cos(heading) * speed;
                projectile.vy = Math.sin(heading) * speed;
                projectile.x += projectile.vx * dt;
                projectile.y += projectile.vy * dt;
                reflectEdge(projectile, width, height);
            }

            const cellSize = 72;
            const grid = new Map<string, number[]>();
            projectiles.forEach((projectile, index) => {
                if (projectile.dead) return;
                const key = `${Math.floor(projectile.x / cellSize)}:${Math.floor(projectile.y / cellSize)}`;
                const entries = grid.get(key);
                if (entries) entries.push(index);
                else grid.set(key, [index]);
            });

            for (let index = 0; index < projectiles.length; index += 1) {
                const left = projectiles[index];
                if (!left || left.dead) continue;
                const cellX = Math.floor(left.x / cellSize);
                const cellY = Math.floor(left.y / cellSize);
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                        const cellEntries = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
                        if (!cellEntries) continue;
                        for (const otherIndex of cellEntries) {
                            if (otherIndex <= index) continue;
                            const right = projectiles[otherIndex];
                            if (!right || right.dead) continue;
                            const dx = right.x - left.x;
                            const dy = right.y - left.y;
                            const minDistance = left.radius + right.radius;
                            if (dx * dx + dy * dy > minDistance * minDistance) continue;

                            const midpointX = (left.x + right.x) * 0.5;
                            const midpointY = (left.y + right.y) * 0.5;
                            if (left.kind === 'bullet' && right.kind === 'bullet') {
                                resolveBulletRicochet(left, right);
                                bursts.push(createBurst(midpointX, midpointY, 0.5, left.palette, graphics));
                            } else if (left.kind === 'rocket' && right.kind === 'rocket') {
                                left.dead = true;
                                right.dead = true;
                                bursts.push(createBurst(midpointX, midpointY, 4, left.palette, graphics));
                            } else {
                                left.dead = true;
                                right.dead = true;
                                bursts.push(createBurst(midpointX, midpointY, 1, left.kind === 'rocket' ? left.palette : right.palette, graphics));
                            }
                        }
                    }
                }
            }

            projectiles = projectiles.filter(projectile => !projectile.dead);
            bursts = bursts.filter((burst) => {
                burst.age += dt;
                return burst.age <= burst.duration;
            });

            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (const burst of bursts) {
                drawBurst(ctx, burst);
            }
            ctx.restore();

            for (const projectile of projectiles) {
                drawProjectile(ctx, projectile);
            }

            animationFrame = window.requestAnimationFrame(step);
        };

        resize();
        syncPopulation();
        animationFrame = window.requestAnimationFrame(step);

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => resize());
            resizeObserver.observe(container);
        } else {
            window.addEventListener('resize', resize);
        }

        return () => {
            disposed = true;
            window.cancelAnimationFrame(animationFrame);
            resizeObserver?.disconnect();
            window.removeEventListener('resize', resize);
        };
    }, [electronSafe, graphics]);

    return (
        <div ref={containerRef} className={`lobby-backdrop${electronSafe ? ' lobby-backdrop--electron' : ''}`} aria-hidden="true">
            <canvas ref={canvasRef} className="lobby-backdrop__canvas" />
            <div className="lobby-backdrop__wash" />
        </div>
    );
});
