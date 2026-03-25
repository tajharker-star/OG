import { BuildingStats } from '../Types';

export const HospitalStats: BuildingStats = {
    type: 'hospital',
    name: 'Hospital',
    health: 550,
    maxHealth: 550,
    radius: 30,
    cost: { gold: 150, oil: 20 },
    constructionTime: 360,
    range: 220,
    description: 'Heals allied human units from military camps by 5% of missing HP per second.'
};
