import { BuildingStats } from '../Types';

export const BridgeNodeStats: BuildingStats = {
    type: 'bridge_node',
    name: 'Bridge Node',
    health: 200,
    maxHealth: 200,
    cost: { gold: 50, oil: 0 },
    constructionTime: 50,
    description: 'Connection point for bridges.'
};
