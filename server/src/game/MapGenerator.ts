export interface Building {
    id: string;
    type: 'barracks' | 'mine' | 'tower' | 'dock' | 'base' | 'oil_rig' | 'oil_well' | 'wall' | 'bridge_node' | 'wall_node' | 'farm' | 'tank_factory' | 'air_base';
    level: number;
    health: number;
    maxHealth: number;
    x?: number;
    y?: number;
    constructionProgress?: number;
    isConstructing?: boolean;
    recruitmentQueue?: {
        unitType: string;
        progress: number;
        totalTime: number;
    }[];
    lastAttackTime?: number;
    ownerId?: string; // Explicit ownership for shared islands
    hasTesla?: boolean;
    range?: number;
}

export interface GoldDeposit {
    id: string;
    x: number; // Relative to island center
    y: number;
    occupiedBy?: string; // Building ID
}

export interface Island {
    id: string;
    x: number;
    y: number;
    radius: number;
    points?: { x: number, y: number }[];
    type: 'forest' | 'desert' | 'snow' | 'grasslands';
    ownerId?: string;
    buildings: Building[];
    goldSpots: GoldDeposit[];
}

export interface OilSpot {
    id: string;
    x: number;
    y: number;
    radius: number;
    occupiedBy?: string;
}

export interface Bridge {
    id: string;
    type: 'bridge' | 'wall' | 'gate';
    nodeAId: string;
    nodeBId: string;
    islandAId: string;
    islandBId: string;
    ownerId: string;
    health: number;
    maxHealth: number;
}

export interface GameMap {
    width: number;
    height: number;
    islands: Island[];
    oilSpots: OilSpot[];
    bridges: Bridge[];
    mapType?: string;
    serverRegion?: string;
    version?: string;
    highGrounds?: {
        id: string;
        x: number;
        y: number;
        radius: number;
        points: { x: number, y: number }[];
    }[];
}

export class MapGenerator {
    static generate(width: number, height: number, numIslands: number, mapType: 'islands' | 'grasslands' | 'desert' = 'islands'): GameMap {
        console.log(`[MapGenerator] Generating map with type: ${mapType}, dimensions: ${width}x${height}`);
        if (mapType === 'grasslands') {
            return this.generateGrasslands(width, height);
        } else if (mapType === 'desert') {
            return this.generateDesert(width, height);
        }
        return this.generateIslands(width, height, numIslands);
    }

    private static generateGrasslands(width: number, height: number): GameMap {
        const islands: Island[] = [];
        const oilSpots: OilSpot[] = [];

        // Goal: ~80% land coverage.
        // Strategy: Create a dense grid/noise of islands.

        const cols = 8;
        const rows = 6;
        const cellW = width / cols;
        const cellH = height / rows;

        // Target fill rate: 80% +/- 10% (0.7 to 0.9)
        const fillRate = 0.7 + Math.random() * 0.2;

        let islandCount = 0;

        // Base layer for coverage
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // use fillRate
                if (Math.random() > fillRate) continue;

                const cx = c * cellW + cellW / 2;
                const cy = r * cellH + cellH / 2;

                // Random offset
                const ox = (Math.random() - 0.5) * cellW * 0.8;
                const oy = (Math.random() - 0.5) * cellH * 0.8;

                // Radius large enough to overlap neighbors
                const radius = (Math.min(cellW, cellH) / 2) * 1.5;

                const goldSpots: GoldDeposit[] = [];
                if (Math.random() > 0.6) {
                    const numGold = Math.floor(Math.random() * 2) + 1;
                    for (let j = 0; j < numGold; j++) {
                        const gAngle = Math.random() * Math.PI * 2;
                        const gDist = Math.random() * (radius * 0.7);
                        goldSpots.push({
                            id: `gold_${islandCount}_${j}`,
                            x: Math.cos(gAngle) * gDist,
                            y: Math.sin(gAngle) * gDist
                        });
                    }
                }

                islands.push({
                    id: `island_g_${islandCount}`,
                    x: cx + ox,
                    y: cy + oy,
                    radius,
                    points: this.generatePolygon(cx + ox, cy + oy, radius),
                    type: 'grasslands',
                    buildings: [],
                    goldSpots
                });
                islandCount++;
            }
        }

        // Add rivers/ponds (implicit by gaps)
        // Add oil in water spots
        this.generateOilSpots(width, height, islands, oilSpots, 15);

        return { width, height, islands, oilSpots, bridges: [], mapType: 'grasslands' };
    }

    private static generateDesert(width: number, height: number): GameMap {
        const islands: Island[] = [];
        const oilSpots: OilSpot[] = [];

        // Goal: 80% land. 
        // Two chunks: 
        // 1. High Land (Plateau) - 10-20% of map, distinct.
        // 2. Low Land (Desert Floor) - Fills the rest, separated by gap.

        // 1. Generate High Land
        // Area = 15% +/- 5%
        const totalArea = width * height;
        const highLandRatio = 0.15 + (Math.random() * 0.1 - 0.05); // 0.10 to 0.20
        const highLandArea = totalArea * highLandRatio;
        const highLandRadius = Math.sqrt(highLandArea / Math.PI); // Approx radius

        // Random placement with padding
        const padding = highLandRadius + 100;
        const hx = padding + Math.random() * (width - padding * 2);
        const hy = padding + Math.random() * (height - padding * 2);

        const highLand: Island = {
            id: 'high_land',
            x: hx,
            y: hy,
            radius: highLandRadius,
            points: this.generatePolygon(hx, hy, highLandRadius),
            type: 'desert',
            buildings: [],
            goldSpots: []
        };
        // Mark as high ground (using a custom property or type if interface allows, 
        // but standard interface doesn't have it. We can add it to Island interface or infer from ID)
        // We will infer from ID in client for now, or add property.

        // Add gold to High Land
        for (let j = 0; j < 8; j++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * (highLandRadius * 0.8);
            highLand.goldSpots.push({
                id: `gold_high_${j}`,
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist
            });
        }
        islands.push(highLand);

        // 2. Generate Low Land (The Desert Floor)
        // Covers the entire map (0,0 to width,height)
        const lowLand: Island = {
            id: 'low_land',
            x: width / 2,
            y: height / 2,
            radius: Math.max(width, height), // effectively infinite
            points: [
                { x: 0, y: 0 },
                { x: width, y: 0 },
                { x: width, y: height },
                { x: 0, y: height }
            ],
            type: 'desert',
            buildings: [],
            goldSpots: []
        };

        // 2.5 Generate Obstacle High Grounds (Unwalkable)
        const highGrounds: { id: string, x: number, y: number, radius: number, points: { x: number, y: number }[] }[] = [];
        const isOneBig = Math.random() < 0.5;
        const numHighGrounds = isOneBig ? 1 : Math.floor(Math.random() * 3) + 3; // 3-5

        for (let i = 0; i < numHighGrounds; i++) {
            const r = isOneBig ? (250 + Math.random() * 150) : (100 + Math.random() * 80);
            let x = 0, y = 0, valid = false;
            let attempts = 0;

            while (!valid && attempts < 50) {
                x = r + Math.random() * (width - r * 2);
                y = r + Math.random() * (height - r * 2);
                valid = true;

                // Avoid High Land (Plateau)
                if (Math.hypot(x - hx, y - hy) < highLandRadius + r + 100) valid = false;

                // Avoid existing High Grounds
                for (const hg of highGrounds) {
                    // Approximate radius check (using r as rough radius)
                    const dist = Math.hypot(x - hg.x, y - hg.y);
                    if (dist < r + r + 50) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }

            if (valid) {
                highGrounds.push({
                    id: `high_ground_${i}`,
                    x,
                    y,
                    radius: r,
                    points: this.generatePolygon(x, y, r, isOneBig ? 15 : 8, 0.5) // More irregular
                });
            }
        }

        // 3. Giant Oil Oasis (20% chance)
        // "Instead of water... giant complex shaped oil spot"
        // We place this somewhere away from High Land.
        if (Math.random() < 0.2) {
            const oasisRadius = 300 + Math.random() * 200; // Large
            let ox = 0, oy = 0, valid = false;
            let attempts = 0;
            while (!valid && attempts < 20) {
                ox = oasisRadius + Math.random() * (width - oasisRadius * 2);
                oy = oasisRadius + Math.random() * (height - oasisRadius * 2);
                // Check distance from High Land
                if (Math.hypot(ox - hx, oy - hy) > highLandRadius + oasisRadius + 200) {
                    valid = true;
                    // Check distance from High Grounds
                    for (const hg of highGrounds) {
                        if (this.isPointInPolygon(ox, oy, hg.points) || Math.hypot(ox - hg.x, oy - hg.y) < oasisRadius + 150) {
                            valid = false;
                            break;
                        }
                    }
                }
                attempts++;
            }

            if (valid) {
                // Generate complex shape
                const oasisPoints = this.generatePolygon(ox, oy, oasisRadius, 12, 0.4);

                const oasis: Island = {
                    id: 'oil_pit',
                    x: ox,
                    y: oy,
                    radius: oasisRadius,
                    points: oasisPoints,
                    type: 'desert', // It's on the desert floor
                    buildings: [],
                    goldSpots: []
                };
                // Add special marker for client rendering
                (oasis as any).subtype = 'oil_field';

                islands.push(oasis);

                // Add Oil Spots INSIDE the Oil Pit
                const numOil = 5 + Math.floor(Math.random() * 3);
                for (let k = 0; k < numOil; k++) {
                    // Random point inside oasis
                    let ox = 0, oy = 0, oValid = false;
                    let oAttempts = 0;
                    while (!oValid && oAttempts < 20) {
                        const dist = Math.random() * (oasisRadius - 60);
                        const ang = Math.random() * Math.PI * 2;
                        ox = oasis.x + Math.cos(ang) * dist;
                        oy = oasis.y + Math.sin(ang) * dist;

                        // Check overlap with other oil spots
                        oValid = true;
                        for (const existing of oilSpots) {
                            if (Math.hypot(ox - existing.x, oy - existing.y) < 100) {
                                oValid = false;
                                break;
                            }
                        }
                        if (oValid) {
                            // Ensure inside polygon
                            if (!this.isPointInPolygon(ox, oy, oasis.points!)) oValid = false;
                        }
                        oAttempts++;
                    }

                    if (oValid) {
                        oilSpots.push({
                            id: `oil_${k}`,
                            x: ox,
                            y: oy,
                            radius: 40
                        });
                    }
                }
            }
        }



        // Add Random Gold/Oil elsewhere on Low Land
        // (Standard distribution)
        // Increased attempts to ensure 10+ spots with high spacing
        for (let i = 0; i < 30; i++) {
            const gx = Math.random() * width;
            const gy = Math.random() * height;
            // Avoid High Land
            if (Math.hypot(gx - hx, gy - hy) > highLandRadius + 100) {
                // Avoid Oil Pit (if any)
                const oilPit = islands.find(i => i.id === 'oil_pit');
                let tooCloseToPit = false;
                if (oilPit) {
                    if (Math.hypot(oilPit.x - gx, oilPit.y - gy) < oilPit.radius + 100) {
                        tooCloseToPit = true;
                    }
                }

                // Avoid High Grounds
                if (!tooCloseToPit) {
                    for (const hg of highGrounds) {
                        if (this.isPointInPolygon(gx, gy, hg.points)) {
                            tooCloseToPit = true; // reuse flag
                            break;
                        }
                    }
                }

                if (!tooCloseToPit) {
                    lowLand.goldSpots.push({
                        id: `gold_low_${i}`,
                        x: gx - width / 2, // Relative to center
                        y: gy - height / 2
                    });
                }
            }
        }

        // 4. Small Grass Oases (Farms)
        // "small amount of grass land to spawn in the desert"
        const numOases = Math.floor(Math.random() * 3) + 2; // 2-4 oases
        for (let i = 0; i < numOases; i++) {
            const r = 80 + Math.random() * 60; // Small-ish
            let x = 0, y = 0, valid = false;
            let attempts = 0;
            while (!valid && attempts < 50) {
                x = r + Math.random() * (width - r * 2);
                y = r + Math.random() * (height - r * 2);
                valid = true;

                // Avoid High Land
                if (Math.hypot(x - hx, y - hy) < highLandRadius + r + 50) valid = false;

                // Avoid existing islands (like oil pit)
                for (const isl of islands) {
                    if (Math.hypot(x - isl.x, y - isl.y) < isl.radius + r + 50) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }

            if (valid) {
                islands.push({
                    id: `oasis_${i}`,
                    x,
                    y,
                    radius: r,
                    points: this.generatePolygon(x, y, r),
                    type: 'forest', // Grass/Forest
                    buildings: [],
                    goldSpots: []
                });
            }
        }

        // 5. Random Land Oil Spots (Hidden) - DESERT FLOOR ONLY
        // We explicitly spawn on 'low_land' (the desert floor), not on 'high_land'
        const numHiddenOil = 10 + Math.floor(Math.random() * 5);
        const desertFloor = lowLand; // Always exists

        for (let i = 0; i < numHiddenOil; i++) {
            let x = 0, y = 0, valid = false;
            let attempts = 0;

            while (!valid && attempts < 200) {
                // Sample a random point inside the map rectangle (low_land polygon covers full map)
                x = Math.random() * width;
                y = Math.random() * height;
                valid = true;

                // Must be inside the desert floor polygon (should always be true, but keep for safety)
                if (desertFloor.points && !this.isPointInPolygon(x, y, desertFloor.points)) {
                    valid = false;
                }

                // Avoid High Land plateau area
                if (valid && Math.hypot(x - hx, y - hy) < highLandRadius + 80) valid = false;

                // Avoid Oil Pit (complex oil field)
                const oilPit = islands.find(ii => ii.id === 'oil_pit');
                if (valid && oilPit) {
                    if (this.isPointInPolygon(x, y, oilPit.points!) || Math.hypot(x - oilPit.x, y - oilPit.y) < oilPit.radius + 120) {
                        valid = false;
                    }
                }

                // Avoid High Grounds (unwalkable obstacles)
                if (valid) {
                    for (const hg of highGrounds) {
                        if (this.isPointInPolygon(x, y, hg.points)) {
                            valid = false;
                            break;
                        }
                    }
                }

                // Avoid existing Oil Spots - Evenly Spaced
                if (valid) {
                    for (const os of oilSpots) {
                        if (Math.hypot(x - os.x, y - os.y) < 120) {
                            valid = false;
                            break;
                        }
                    }
                }

                // Avoid Buildings on desert floor (if any already placed)
                if (valid) {
                    for (const isl of islands) {
                        for (const b of isl.buildings) {
                            const bx = isl.x + (b.x || 0);
                            const by = isl.y + (b.y || 0);
                            if (Math.hypot(x - bx, y - by) < 80) {
                                valid = false;
                                break;
                            }
                        }
                        if (!valid) break;
                    }
                }

                attempts++;
            }

            if (valid) {
                oilSpots.push({
                    id: `hidden_oil_${i}`,
                    x,
                    y,
                    radius: 30
                });
            }
        }

        // Push Low Land FIRST so it's the background
        // Actually, order matters for rendering (painter's algo).
        // We want Low Land at bottom.
        islands.unshift(lowLand);

        return { width, height, islands, oilSpots, bridges: [], highGrounds, mapType: 'desert' };
    }



    private static generatePolygon(x: number, y: number, radius: number, numPoints?: number, irregularity?: number): { x: number, y: number }[] {
        const points: { x: number, y: number }[] = [];
        const n = numPoints || (Math.floor(Math.random() * 5) + 7);
        const angleStep = (Math.PI * 2) / n;
        const irregular = irregularity || 0.4;

        for (let i = 0; i < n; i++) {
            const angle = i * angleStep;
            const r = radius * (1 - irregular / 2 + Math.random() * irregular);
            points.push({
                x: x + Math.cos(angle) * r,
                y: y + Math.sin(angle) * r
            });
        }
        return points;
    }

    private static generateIslands(width: number, height: number, numIslands: number): GameMap {
        const islands: Island[] = [];
        const oilSpots: OilSpot[] = [];

        // Generate Islands
        for (let i = 0; i < numIslands; i++) {
            let x, y, radius, valid = false;
            let attempts = 0;

            while (!valid && attempts < 100) {
                x = Math.floor(Math.random() * (width - 200)) + 100;
                y = Math.floor(Math.random() * (height - 200)) + 100;
                radius = Math.floor(Math.random() * 50) + 40;

                valid = true;
                for (const island of islands) {
                    const dist = Math.hypot(x - island.x, y - island.y);
                    if (dist < island.radius + radius + 50) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }

            if (valid) {
                const goldSpots: GoldDeposit[] = [];
                const numGold = Math.floor(Math.random() * 2) + 1;

                for (let j = 0; j < numGold; j++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * (radius! * 0.7);
                    goldSpots.push({
                        id: `gold_${i}_${j}`,
                        x: Math.cos(angle) * dist,
                        y: Math.sin(angle) * dist
                    });
                }

                islands.push({
                    id: `island_${i}`,
                    x: x!,
                    y: y!,
                    radius: radius!,
                    points: this.generatePolygon(x!, y!, radius!),
                    type: ['forest', 'desert', 'snow'][Math.floor(Math.random() * 3)] as any,
                    buildings: [],
                    goldSpots
                });
            }
        }

        // Generate Oil Spots (in water)
        this.generateOilSpots(width, height, islands, oilSpots, Math.floor(numIslands / 2));

        return {
            width,
            height,
            islands,
            oilSpots,
            bridges: [],
            mapType: 'islands'
        };
    }

    private static generateOilSpots(width: number, height: number, islands: Island[], oilSpots: OilSpot[], count: number) {
        for (let i = 0; i < count; i++) {
            let x, y, valid = false;
            let attempts = 0;
            while (!valid && attempts < 50) {
                x = Math.floor(Math.random() * width);
                y = Math.floor(Math.random() * height);
                valid = true;

                // Check distance to other oil spots
                for (const os of oilSpots) {
                    if (Math.hypot(x - os.x, y - os.y) < 150) { // 150px separation
                        valid = false;
                        break;
                    }
                }
                if (!valid) { attempts++; continue; }

                // Check collision with islands (buffer zone)
                for (const island of islands) {
                    // Max polygon radius is ~1.2 * radius. Add 60px buffer.
                    // First check simple radius for speed
                    if (Math.hypot(x - island.x, y - island.y) < (island.radius * 1.2) + 60) {
                        // If close, check precise polygon if available
                        if (island.points) {
                            // If inside polygon OR close to polygon edge
                            if (this.isPointInPolygon(x, y, island.points)) {
                                valid = false;
                                break;
                            }
                            const closest = this.getClosestPointOnPolygon(x, y, island.points);
                            if (Math.hypot(x - closest.x, y - closest.y) < 60) {
                                valid = false;
                                break;
                            }
                        } else {
                            valid = false;
                            break;
                        }
                    }
                }
                attempts++;
            }

            if (valid) {
                oilSpots.push({
                    id: `oil_${oilSpots.length}`,
                    x: x!,
                    y: y!,
                    radius: 15
                });
            }
        }
    }

    public static isPointInPolygon(x: number, y: number, points: { x: number, y: number }[]): boolean {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    public static getClosestPointOnSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): { x: number, y: number } {
        const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (l2 === 0) return { x: x1, y: y1 };

        let t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));

        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }

    public static getClosestEdge(x: number, y: number, points: { x: number, y: number }[]): { p1: { x: number, y: number }, p2: { x: number, y: number }, closest: { x: number, y: number } } {
        let minDist = Infinity;
        let result = {
            p1: points[0],
            p2: points[1],
            closest: points[0]
        };

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];

            const closest = this.getClosestPointOnSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            const dist = (x - closest.x) ** 2 + (y - closest.y) ** 2;

            if (dist < minDist) {
                minDist = dist;
                result = { p1, p2, closest };
            }
        }
        return result;
    }

    public static segmentsIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (denom === 0) return false;
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
        return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
    }

    public static getClosestPointOnPolygon(x: number, y: number, points: { x: number, y: number }[]): { x: number, y: number } {
        let minDist = Infinity;
        let closestX = x;
        let closestY = y;

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];

            const closest = this.getClosestPointOnSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            const dist = (x - closest.x) ** 2 + (y - closest.y) ** 2;

            if (dist < minDist) {
                minDist = dist;
                closestX = closest.x;
                closestY = closest.y;
            }
        }
        return { x: closestX, y: closestY };
    }

    public static findPathAround(start: { x: number, y: number }, end: { x: number, y: number }, points: { x: number, y: number }[]): { x: number, y: number }[] {
        // Find closest vertex to start
        let startIndex = -1;
        let minStartDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const d = (start.x - points[i].x) ** 2 + (start.y - points[i].y) ** 2;
            if (d < minStartDist) {
                minStartDist = d;
                startIndex = i;
            }
        }

        // Find closest vertex to end
        let endIndex = -1;
        let minEndDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const d = (end.x - points[i].x) ** 2 + (end.y - points[i].y) ** 2;
            if (d < minEndDist) {
                minEndDist = d;
                endIndex = i;
            }
        }

        if (startIndex === -1 || endIndex === -1 || startIndex === endIndex) return [];

        // Path 1: Clockwise
        const path1: { x: number, y: number }[] = [];
        let i = startIndex;
        let dist1 = 0;
        let curr = points[startIndex];

        let steps = 0;
        while (i !== endIndex && steps < points.length) {
            i = (i + 1) % points.length;
            const next = points[i];
            dist1 += Math.hypot(next.x - curr.x, next.y - curr.y);
            path1.push(next);
            curr = next;
            steps++;
        }

        // Path 2: Counter-Clockwise
        const path2: { x: number, y: number }[] = [];
        i = startIndex;
        let dist2 = 0;
        curr = points[startIndex];

        steps = 0;
        while (i !== endIndex && steps < points.length) {
            i = (i - 1 + points.length) % points.length;
            const next = points[i];
            dist2 += Math.hypot(next.x - curr.x, next.y - curr.y);
            path2.push(next);
            curr = next;
            steps++;
        }

        return dist1 < dist2 ? path1 : path2;
    }
}
