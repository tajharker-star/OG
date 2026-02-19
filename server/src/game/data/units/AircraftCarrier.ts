import { UnitStats } from '../Types';

export const AircraftCarrierStats: UnitStats = {
    type: 'aircraft_carrier',
    name: 'Aircraft Carrier',
    health: 3000,
    maxHealth: 3000,
    damage: 100, // Powerful rockets
    range: 400, // Long range
    speed: 50, // Slow like mothership
    fireRate: 2000, // Slow fire rate (rockets)
    cost: { gold: 2000, oil: 1000 },
    constructionTime: 1800, // 60s
    description: 'Massive naval fortress. Launches devastating rockets and transports units.',
    height: 0, // Water
    canRecruit: true,
    canAttackAir: true
};
