import { UnitStats } from '../Types';

export const TankStats: UnitStats = {
    type: 'tank',
    name: 'Tank',
    health: 400,
    maxHealth: 400,
    damage: 60,
    range: 150,
    speed: 80,
    fireRate: 1500, // Slow firing
    cost: { gold: 150, oil: 50 },
    constructionTime: 450, // 15s
    description: 'Heavy armored unit. Strong against everything.'
};
