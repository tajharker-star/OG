import { BuildingStats } from '../Types';

export const FarmStats: BuildingStats = {
    type: 'farm',
    name: 'Farm',
    health: 200,
    maxHealth: 200,
    cost: { gold: 50, oil: 0 },
    constructionTime: 200,
    description: 'Generates gold. Can be placed on grass land.',
    radius: 30
};
