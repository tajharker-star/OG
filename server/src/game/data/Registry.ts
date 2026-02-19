import { UnitStats, BuildingStats } from './Types';
import { SoldierStats } from './units/Soldier';
import { SniperStats } from './units/Sniper';
import { RocketeerStats } from './units/Rocketeer';
import { DestroyerStats } from './units/Destroyer';
import { BuilderStats } from './units/Builder';
import { ConstructionShipStats } from './units/ConstructionShip';
import { FerryStats } from './units/Ferry';
import { TankStats } from './units/Tank';
import { HumveeStats } from './units/Humvee';
import { MissileLauncherStats } from './units/MissileLauncher';
import { OilSeekerStats } from './units/OilSeeker';
import { LightPlaneStats } from './units/LightPlane';
import { HeavyPlaneStats } from './units/HeavyPlane';
import { AircraftCarrierStats } from './units/AircraftCarrier';
import { MothershipStats } from './units/Mothership';
import { AlienScoutShipStats } from './units/AlienScoutShip';
import { HeavyAlienSpaceshipStats } from './units/HeavyAlienSpaceship';

import { BaseStats } from './buildings/Base';
import { BarracksStats } from './buildings/Barracks';
import { MineStats } from './buildings/Mine';
import { TowerStats } from './buildings/Tower';
import { DockStats } from './buildings/Dock';
import { OilRigStats } from './buildings/OilRig';
import { OilWellStats } from './buildings/OilWell';
import { WallStats } from './buildings/Wall';
import { BridgeNodeStats } from './buildings/BridgeNode';
import { WallNodeStats } from './buildings/WallNode';
import { FarmStats } from './buildings/Farm';
import { TankFactoryStats } from './buildings/TankFactory';
import { AirBaseStats } from './buildings/AirBase';

export const UnitData: Record<string, UnitStats> = {
    soldier: SoldierStats,
    sniper: SniperStats,
    rocketeer: RocketeerStats,
    destroyer: DestroyerStats,
    builder: BuilderStats,
    construction_ship: ConstructionShipStats,
    ferry: FerryStats,
    tank: TankStats,
    humvee: HumveeStats,
    missile_launcher: MissileLauncherStats,
    oil_seeker: OilSeekerStats,
    light_plane: LightPlaneStats,
    heavy_plane: HeavyPlaneStats,
    aircraft_carrier: AircraftCarrierStats,
    mothership: MothershipStats,
    alien_scout: AlienScoutShipStats,
    heavy_alien: HeavyAlienSpaceshipStats
};

export const BuildingData: Record<string, BuildingStats> = {
    base: BaseStats,
    barracks: BarracksStats,
    mine: MineStats,
    tower: TowerStats,
    dock: DockStats,
    oil_rig: OilRigStats,
    oil_well: OilWellStats,
    wall: WallStats,
    bridge_node: BridgeNodeStats,
    wall_node: WallNodeStats,
    farm: FarmStats,
    tank_factory: TankFactoryStats,
    air_base: AirBaseStats
};
