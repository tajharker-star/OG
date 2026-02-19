import { UnitStats } from '../Types';

export const AlienScoutShipStats: UnitStats = {
    type: 'alien_scout',
    name: 'Alien Scout Ship',
    health: 200,
    maxHealth: 200,
    damage: 20,
    range: 200,
    speed: 350, // Very fast
    fireRate: 500,
    cost: { gold: 150, oil: 50 },
    constructionTime: 100, // 3s
    description: 'Extremely fast alien scout. Weak but rapid.'
};
