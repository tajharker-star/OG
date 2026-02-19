import { UnitStats } from '../Types';

export const HeavyPlaneStats: UnitStats = {
    type: 'heavy_plane',
    name: 'Heavy Plane',
    health: 400,
    maxHealth: 400,
    damage: 80,
    range: 200,
    speed: 200,
    fireRate: 1500,
    cost: { gold: 250, oil: 100 },
    constructionTime: 600, // 20s
    description: 'Heavy armored air unit.'
};
