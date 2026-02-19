import { UnitStats } from '../Types';

export const FerryStats: UnitStats = {
    type: 'ferry',
    name: 'Ferry',
    health: 400,
    maxHealth: 400,
    damage: 0,
    range: 100, // Drop off range
    speed: 60,
    fireRate: 0,
    cost: { gold: 30, oil: 5 },
    constructionTime: 240 // 8s
};
