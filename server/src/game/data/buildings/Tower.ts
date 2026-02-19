import { BuildingStats } from '../Types';

export const TowerStats: BuildingStats = {
    type: 'tower',
    name: 'Defense Tower',
    health: 400,
    maxHealth: 400,
    cost: { gold: 40, oil: 0 },
    constructionTime: 200,
    range: 200,
    damage: 25,
    fireRate: 800,
    description: 'Defensive structure that attacks enemy units.'
};
