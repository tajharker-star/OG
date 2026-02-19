import { BuildingStats } from '../Types';

export const BaseStats: BuildingStats = {
    type: 'base',
    name: 'Base',
    health: 1000,
    maxHealth: 1000,
    cost: { gold: 9999, oil: 9999 },
    constructionTime: 0,
    range: 300,
    damage: 50,
    fireRate: 1000,
    description: 'Main command center. Generates income and trains Builders.'
};
