import { UnitStats } from '../Types';

export const HeavyAlienSpaceshipStats: UnitStats = {
    type: 'heavy_alien',
    name: 'Heavy Alien Spaceship',
    health: 1500,
    maxHealth: 1500,
    damage: 100,
    range: 250,
    speed: 100, // Moderate speed
    fireRate: 1000,
    cost: { gold: 800, oil: 400 },
    constructionTime: 1200, // 40s
    description: 'Heavy alien warship. High damage and durability.'
};
