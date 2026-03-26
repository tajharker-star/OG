import { BuildingStats } from '../Types';

export const RepairDockStats: BuildingStats = {
    type: 'repair_dock',
    name: 'Repair Dock',
    health: 700,
    maxHealth: 700,
    radius: 32,
    cost: { gold: 220, oil: 40 },
    constructionTime: 420,
    range: 220,
    description: 'Heals allied non-human units by 5% of missing HP per second.'
};
