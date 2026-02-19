import { BuildingStats } from '../Types';

export const TankFactoryStats: BuildingStats = {
    type: 'tank_factory',
    name: 'Tank Factory',
    health: 1500,
    maxHealth: 1500,
    cost: { gold: 500, oil: 50 },
    constructionTime: 600, // 20s
    description: 'Produces heavy armored vehicles: Tanks, Humvees, and Missile Launchers.'
};
