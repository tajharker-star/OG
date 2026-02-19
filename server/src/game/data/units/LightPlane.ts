import { UnitStats } from '../Types';

export const LightPlaneStats: UnitStats = {
    type: 'light_plane',
    name: 'Light Plane',
    health: 150,
    maxHealth: 150,
    damage: 30,
    range: 200,
    speed: 200,
    fireRate: 1000,
    cost: { gold: 100, oil: 20 },
    constructionTime: 300, // 10s
    description: 'Fast, cheap air unit.'
};
