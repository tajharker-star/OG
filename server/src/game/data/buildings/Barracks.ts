import { BuildingStats } from '../Types';

export const BarracksStats: BuildingStats = {
    type: 'barracks',
    name: 'Barracks',
    health: 1000,
    maxHealth: 1000,
    cost: { gold: 50, oil: 0 },
    constructionTime: 300,
    description: 'Trains infantry units.'
};
