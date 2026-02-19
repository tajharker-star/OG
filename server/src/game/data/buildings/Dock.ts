import { BuildingStats } from '../Types';

export const DockStats: BuildingStats = {
    type: 'dock',
    name: 'Naval Dock',
    health: 600,
    maxHealth: 600,
    cost: { gold: 100, oil: 0 },
    constructionTime: 400,
    description: 'Constructs naval units.'
};
