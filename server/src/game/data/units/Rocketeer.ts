import { UnitStats } from '../Types';

export const RocketeerStats: UnitStats = {
    type: 'rocketeer',
    name: 'Rocketeer',
    health: 60,
    maxHealth: 60,
    damage: 30,
    range: 150,
    speed: 80,
    fireRate: 3000,
    cost: { gold: 40, oil: 10 },
    constructionTime: 150 // 5s
};
