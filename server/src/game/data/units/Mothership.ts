import { UnitStats } from '../Types';

export const MothershipStats: UnitStats = {
    type: 'mothership',
    name: 'Mothership',
    health: 3000,
    maxHealth: 3000,
    damage: 50,
    range: 300,
    speed: 50,
    fireRate: 200,
    cost: { gold: 2000, oil: 1000 },
    constructionTime: 1800, // 60s
    description: 'Flying fortress. Spawns planes and transports units.',
    height: 2, // High Air
    canRecruit: true,
    canAttackAir: true
};
