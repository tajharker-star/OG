import { UnitStats } from '../Types';

export const ConstructionShipStats: UnitStats = {
    type: 'construction_ship',
    name: 'Construction Ship',
    health: 150,
    maxHealth: 150,
    damage: 0,
    range: 50,
    speed: 80,
    fireRate: 0,
    cost: { gold: 100, oil: 0 },
    constructionTime: 300 // 10s
};
