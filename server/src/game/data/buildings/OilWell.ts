import { BuildingStats } from '../Types';

export const OilWellStats: BuildingStats = {
    type: 'oil_well',
    name: 'Oil Well',
    health: 400,
    maxHealth: 400,
    cost: { gold: 200, oil: 0 },
    constructionTime: 300,
    description: 'Extracts oil from land-based Oil Spots. Must be placed on a visible land Oil Spot.'
};
