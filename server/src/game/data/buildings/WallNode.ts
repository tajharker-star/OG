import { BuildingStats } from '../Types';

export const WallNodeStats: BuildingStats = {
    type: 'wall_node',
    name: 'Wall Node',
    health: 200,
    maxHealth: 200,
    cost: { gold: 20, oil: 0 },
    constructionTime: 50,
    description: 'Connection point for walls.'
};
