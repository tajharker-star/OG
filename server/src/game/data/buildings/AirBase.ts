import { BuildingStats } from '../Types';

export const AirBaseStats: BuildingStats = {
    type: 'air_base',
    name: 'Air Base',
    health: 1000,
    maxHealth: 1000,
    cost: { gold: 400, oil: 100 },
    constructionTime: 600, // 20s
    description: 'Trains air units.'
};
