import { UnitStats } from '../Types';

export const HumveeStats: UnitStats = {
    type: 'humvee',
    name: 'Humvee',
    health: 200,
    maxHealth: 200,
    damage: 15,
    range: 120,
    speed: 160,
    fireRate: 500, // Fast firing machine gun
    cost: { gold: 80, oil: 20 },
    constructionTime: 300, // 10s
    description: 'Fast transport unit. Can carry up to 8 infantry units.'
};
