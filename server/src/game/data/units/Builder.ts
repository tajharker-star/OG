import { UnitStats } from '../Types';

export const BuilderStats: UnitStats = {
    type: 'builder',
    name: 'Builder',
    health: 50,
    maxHealth: 50,
    damage: 0,
    range: 50,
    speed: 100,
    fireRate: 0,
    cost: { gold: 50, oil: 0 },
    constructionTime: 150 // 5s
};
