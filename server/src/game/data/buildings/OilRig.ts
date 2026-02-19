import { BuildingStats } from '../Types';

export const OilRigStats: BuildingStats = {
    type: 'oil_rig',
    name: 'Oil Rig',
    health: 400,
    maxHealth: 400,
    cost: { gold: 200, oil: 0 },
    constructionTime: 300,
    description: 'Extracts oil from oil spots in the water.'
};
