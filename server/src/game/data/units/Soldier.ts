import { UnitStats } from '../Types';

export const SoldierStats: UnitStats = {
    type: 'soldier',
    name: 'Soldier',
    health: 50,
    maxHealth: 50,
    damage: 10,
    range: 100,
    speed: 100,
    fireRate: 1000,
    cost: { gold: 10, oil: 0 },
    constructionTime: 90 // 3s
};
