import { UnitStats } from '../Types';

export const PirateShipStats: UnitStats = {
    type: 'pirate_ship',
    name: 'Pirate Ship',
    health: 180,
    maxHealth: 180,
    damage: 15,
    range: 180,
    speed: 78,
    fireRate: 1300,
    cost: { gold: 200, oil: 0 },
    constructionTime: 360,
    description: 'Cheap raider ship armed with light cannons. Weakest dock combat damage.'
};
