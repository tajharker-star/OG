import { BuildingStats } from '../Types';

export const MineStats: BuildingStats = {
    type: 'mine',
    name: 'Gold Mine',
    health: 300,
    maxHealth: 300,
    cost: { gold: 30, oil: 0 },
    constructionTime: 150,
    description: 'Extracts gold from gold spots.'
};
