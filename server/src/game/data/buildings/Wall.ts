import { BuildingStats } from '../Types';

export const WallStats: BuildingStats = {
    type: 'wall',
    name: 'Wall',
    health: 500,
    maxHealth: 500,
    cost: { gold: 10, oil: 0 },
    constructionTime: 50,
    description: 'Defensive barrier.'
};
