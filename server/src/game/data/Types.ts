
export interface UnitStats {
    type: string;
    name: string;
    health: number;
    maxHealth: number;
    damage: number;
    range: number;
    speed: number;
    fireRate: number; // Cooldown in ms
    cost: { gold: number, oil: number };
    constructionTime?: number; // Time to recruit in ticks (30 ticks = 1s)
    description?: string;
    height?: number; // 0=Ground/Water, 1=Air Low (Heli/Plane), 2=Air High (Mothership)
    canRecruit?: boolean; // Can this unit recruit other units?
    canAttackAir?: boolean; // Can this unit attack air units?
}

export interface BuildingStats {
    type: string;
    name: string;
    health: number;
    maxHealth: number;
    cost: { gold: number, oil: number };
    constructionTime?: number; // Base time in ticks or ms
    range?: number;
    damage?: number;
    fireRate?: number; // Cooldown in ms
    description?: string;
    canAttackAir?: boolean; // Can this building attack air units?
    radius?: number; // Optional collision/hitbox radius
}
