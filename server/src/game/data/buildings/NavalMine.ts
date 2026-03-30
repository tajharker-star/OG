import { BuildingStats } from '../Types';

export const NavalMineStats: BuildingStats = {
    type: 'naval_mine',
    name: 'Naval Mine',
    health: 80,
    maxHealth: 80,
    radius: 12,
    range: 38,
    damage: 500,
    cost: { gold: 120, oil: 20 },
    constructionTime: 300,
    hiddenFromEnemies: true,
    minSpacing: 110,
    description: 'Hidden water mine. Detonates for 500 damage in a large blast that only hits enemy water units.'
};
