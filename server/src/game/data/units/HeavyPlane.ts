import { UnitStats } from '../Types';

export const HeavyPlaneStats: UnitStats = {
    type: 'heavy_plane',
    name: 'Stealth Bomber',
    health: 400,
    maxHealth: 400,
    damage: 110,
    range: 145,
    speed: 230,
    fireRate: 1800,
    cost: { gold: 250, oil: 100 },
    constructionTime: 600, // 20s
    description: 'High-altitude stealth bomber that drops explosive payloads on enemy units and buildings below.',
    height: 2
};
