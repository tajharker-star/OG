import { UnitStats } from '../Types';

export const SniperStats: UnitStats = {
    type: 'sniper',
    name: 'Sniper',
    health: 40,
    maxHealth: 40,
    damage: 40,
    range: 300,
    speed: 90,
    fireRate: 2000,
    cost: { gold: 25, oil: 0 },
    constructionTime: 150 // 5s
};
