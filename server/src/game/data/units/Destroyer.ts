import { UnitStats } from '../Types';

export const DestroyerStats: UnitStats = {
    type: 'destroyer',
    name: 'Destroyer',
    health: 300,
    maxHealth: 300,
    damage: 50,
    range: 200, // Reduced from 250 (nerfed)
    speed: 70,
    fireRate: 1000,
    cost: { gold: 50, oil: 10 },
    constructionTime: 300 // 10s
};
