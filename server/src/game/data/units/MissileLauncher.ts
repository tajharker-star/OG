import { UnitStats } from '../Types';

export const MissileLauncherStats: UnitStats = {
    type: 'missile_launcher',
    name: 'Missile Launcher',
    health: 150,
    maxHealth: 150,
    damage: 300,
    range: 500,
    speed: 60,
    fireRate: 3000, // Very slow firing
    cost: { gold: 250, oil: 100 },
    constructionTime: 600, // 20s
    description: 'Long-range artillery. Devastating against buildings, but cannot attack units.'
};
