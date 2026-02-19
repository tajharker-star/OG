import { UnitStats } from '../Types';

export const OilSeekerStats: UnitStats = {
    type: 'oil_seeker',
    name: 'Oil Seeker',
    health: 150,
    maxHealth: 150,
    damage: 0, // Scout/Support only
    range: 100,
    speed: 50, // Slow
    fireRate: 1000,
    cost: { gold: 1000, oil: 0 }, // Expensive, Gold only
    constructionTime: 900, // 30s
    description: 'Slow, expensive mobile radar. Passively detects hidden oil. Toggle view to see spots.'
};
