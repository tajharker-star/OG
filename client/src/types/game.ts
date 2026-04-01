export interface Building {
  id: string;
  type: 'barracks' | 'mine' | 'tower' | 'dock' | 'base' | 'oil_rig' | 'oil_well' | 'wall' | 'bridge_node' | 'wall_node' | 'farm' | 'tank_factory' | 'air_base' | 'hospital' | 'repair_dock' | 'naval_mine';
  level: number;
  health: number;
  maxHealth: number;
  x?: number;
  y?: number;
  constructionProgress?: number;
  isConstructing?: boolean;
  recruitmentQueue?: {
    unitType: string;
    progress: number;
    totalTime: number;
  }[];
  ownerId?: string;
  hasTesla?: boolean;
  range?: number;
  hiddenFromEnemies?: boolean;
}

export interface GoldDeposit {
  id: string;
  x: number; // Relative to island center
  y: number;
  occupiedBy?: string; // Building ID
}

export interface Island {
  id: string;
  x: number;
  y: number;
  radius: number;
  points?: {x: number, y: number}[];
  type: 'forest' | 'desert' | 'snow' | 'grasslands';
  ownerId?: string;
  buildings: Building[];
  goldSpots: GoldDeposit[];
}

export interface OilSpot {
  id: string;
  x: number;
  y: number;
  radius: number;
  occupiedBy?: string;
  ownerId?: string;
  building?: Building;
}

export interface Bridge {
  id: string;
  type: 'bridge' | 'wall' | 'gate'; // Connectors
  nodeAId: string;
  nodeBId: string;
  islandAId?: string; // ID of island where node A is, if the endpoint is on land
  islandBId?: string; // ID of island where node B is, if the endpoint is on land
  ownerId: string;
  health: number;
  maxHealth: number;
}

export interface GameMap {
  width: number;
  height: number;
  islands: Island[];
  oilSpots: OilSpot[];
  bridges: Bridge[];
  waterBuildings?: Building[];
  mapType?: string;
  serverRegion?: string;
  version?: string;
  highGrounds?: {
      id: string;
      x: number;
      y: number;
      radius: number;
      points: {x: number, y: number}[];
  }[];
}

export interface Unit {
  id: string;
  ownerId: string;
  type: 'soldier' | 'destroyer' | 'pirate_ship' | 'construction_ship' | 'sniper' | 'rocketeer' | 'builder' | 'ferry' | 'tank' | 'humvee' | 'missile_launcher' | 'oil_seeker' | 'light_plane' | 'heavy_plane' | 'aircraft_carrier' | 'mothership';
  x: number;
  y: number;
  targetIslandId?: string;
  targetX?: number;
  targetY?: number;
  status: 'idle' | 'moving' | 'fighting';
  health: number;
  maxHealth: number;
  damage: number;
  range: number;
  speed: number;
  fireRate: number;
  cargo?: Unit[];
  recruitmentQueue?: {
    unitType: string;
    progress: number;
    totalTime: number;
  }[];
  intentId?: string;
  steeringDirX?: number;
  steeringDirY?: number;
  lastSteerTime?: number;
  vx?: number;
  vy?: number;
  path?: { x: number; y: number }[];
  facingAngle?: number;
}

export interface Player {
  id: string;
  color: string;
  name?: string;
  resources: {
    gold: number;
    oil: number;
  };
  isBot?: boolean;
  difficulty?: number;
  status?: 'active' | 'eliminated';
  hqSpawnedOnce?: boolean;
}
