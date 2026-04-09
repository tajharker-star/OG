import { UnitStats } from '../Types';

export const MissileLauncherStats: UnitStats = {
    type: 'missile_launcher',
    name: 'Missile Launcher',
    health: 150,
    maxHealth: 150,
    damage: 110,
    range: 500,
    speed: 60,
    fireRate: 5200, // Long reload after unloading a 6-missile salvo
    cost: { gold: 250, oil: 100 },
    constructionTime: 600, // 20s
    description: 'Long-range artillery. Fires a 6-missile salvo into buildings, then reloads for a long cooldown.'
};
