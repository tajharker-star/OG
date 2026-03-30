import {
    TUTORIAL_BUILDING_GROUPS,
    TUTORIAL_UNIT_GROUPS,
    type TutorialGuideCard,
} from './tutorialGuide';

export type ActionGuidePreview =
    | 'deposit'
    | 'farm-land'
    | 'oil-land'
    | 'oil-water'
    | 'shoreline'
    | 'defense'
    | 'bridge'
    | 'wall'
    | 'support'
    | 'infantry'
    | 'marksman'
    | 'rocket'
    | 'builder'
    | 'scanner'
    | 'armor'
    | 'transport'
    | 'artillery'
    | 'naval-raider'
    | 'naval-warship'
    | 'builder-ship'
    | 'air'
    | 'capital';

export type ActionGuide = {
    id: string;
    title: string;
    icon: string;
    summary: string;
    preview: ActionGuidePreview;
    placementTargets?: Array<{
        kind: 'gold-node' | 'grassland' | 'oil-spot' | 'land' | 'water';
        label: string;
    }>;
    placement?: string[];
    use: string[];
    bestFor: string;
    watchOut: string;
};

const buildCardIndex = new Map<string, TutorialGuideCard>();
const unitCardIndex = new Map<string, TutorialGuideCard>();

TUTORIAL_BUILDING_GROUPS.forEach((group) => {
    group.cards.forEach((card) => {
        if (card.entityType) {
            buildCardIndex.set(card.entityType, card);
        }
    });
});

TUTORIAL_UNIT_GROUPS.forEach((group) => {
    group.cards.forEach((card) => {
        if (card.entityType) {
            unitCardIndex.set(card.entityType, card);
        }
    });
});

const fallbackCard = (type: string, title: string, summary: string): TutorialGuideCard => ({
    id: type,
    entityType: type,
    title,
    summary,
    strengths: summary,
    caution: 'Needs the right support and timing to pay off.',
    tips: []
});

const makeGuide = (
    card: TutorialGuideCard,
    icon: string,
    preview: ActionGuidePreview,
    placement: string[] | undefined,
    use: string[],
    placementTargets?: ActionGuide['placementTargets']
): ActionGuide => ({
    id: card.entityType || card.id,
    title: card.title,
    icon,
    summary: card.summary,
    preview,
    placementTargets,
    placement,
    use,
    bestFor: card.strengths,
    watchOut: card.caution,
});

export const BUILDING_ACTION_GUIDES: Record<string, ActionGuide> = {
    mine: makeGuide(
        buildCardIndex.get('mine') || fallbackCard('mine', 'Gold Mine', 'Turns a gold deposit into your first real income spike.'),
        '⛏️',
        'deposit',
        [
            'Place directly on an empty gold deposit.',
            'Keep a builder nearby so you can chain into barracks or farms quickly.',
            'Defend exposed mine islands because they snowball the opening.'
        ],
        ['Open with this when you need fast gold for builders, barracks, or a quick second economy island.'],
        [
            { kind: 'gold-node', label: 'Gold Node' },
            { kind: 'land', label: 'Land' }
        ]
    ),
    oil_rig: makeGuide(
        buildCardIndex.get('oil_rig') || fallbackCard('oil_rig', 'Oil Rig', 'Water oil income that unlocks naval and air tech.'),
        '🛢️',
        'oil-water',
        [
            'Place on a free offshore oil spot.',
            'Needs a nearby construction ship and safe water control.',
            'Best after you already have a dock or sea escort online.'
        ],
        ['Use rigs to unlock ships, planes, and late-game production without starving your oil bank.'],
        [
            { kind: 'oil-spot', label: 'Oil Spot' },
            { kind: 'water', label: 'Water' }
        ]
    ),
    oil_well: makeGuide(
        buildCardIndex.get('oil_well') || fallbackCard('oil_well', 'Oil Well', 'Land oil income for vehicles, missiles, and aircraft.'),
        '⛽',
        'oil-land',
        [
            'Place on a visible land oil spot.',
            'Build it before committing to tanks, missiles, or aircraft.',
            'Treat oil islands like priority objectives.'
        ],
        ['This is the cleanest way to transition from cheap infantry into real mid-game tech.'],
        [
            { kind: 'oil-spot', label: 'Oil Spot' },
            { kind: 'land', label: 'Land' }
        ]
    ),
    farm: makeGuide(
        buildCardIndex.get('farm') || fallbackCard('farm', 'Farm', 'Passive gold that thickens your backline economy.'),
        '🌾',
        'farm-land',
        [
            'Place on grasslands or forest terrain.',
            'Use safe backline space when no gold deposit is available.',
            'Mix farms with mines instead of relying on farms alone.'
        ],
        ['Use farms to stabilize income once your first mine and first production building are already covered.'],
        [
            { kind: 'grassland', label: 'Grassland' },
            { kind: 'land', label: 'Land' }
        ]
    ),
    barracks: makeGuide(
        buildCardIndex.get('barracks') || fallbackCard('barracks', 'Barracks', 'Fast infantry production and map control.'),
        '⚔️',
        'support',
        [
            'Place on land you already control with room to defend it.',
            'Keep it close enough to reinforce your front but not so far forward that it gets sniped.',
        ],
        ['Use barracks when you want fast map presence, cheap troops, and extra builders to out-expand the enemy.']
    ),
    tank_factory: makeGuide(
        buildCardIndex.get('tank_factory') || fallbackCard('tank_factory', 'Tank Factory', 'Unlocks armor, transport, and siege.'),
        '🏭',
        'support',
        [
            'Place on safe land after your oil income is online.',
            'Leave road space in front so tanks and humvees can leave cleanly.',
        ],
        ['This is your land power spike when infantry alone stops being enough.']
    ),
    air_base: makeGuide(
        buildCardIndex.get('air_base') || fallbackCard('air_base', 'Air Base', 'Launches fast pressure across the map.'),
        '🛫',
        'support',
        [
            'Place on defended land with strong oil income behind it.',
            'Avoid exposing your first air base on a flimsy forward island.',
        ],
        ['Use air bases to punish weak backlines, rotate pressure fast, and close gaps between fronts.']
    ),
    dock: makeGuide(
        buildCardIndex.get('dock') || fallbackCard('dock', 'Dock', 'Your path into ships, ferries, and offshore oil.'),
        '⚓',
        'shoreline',
        [
            'Place on a shoreline with open water in front of it.',
            'Best on islands that matter for transport lanes or offshore oil.',
        ],
        ['Use docks to control water routes, escort economy, and launch cross-map pressure on island maps.']
    ),
    tower: makeGuide(
        buildCardIndex.get('tower') || fallbackCard('tower', 'Tower', 'Static defense for chokepoints and key islands.'),
        '🏰',
        'defense',
        [
            'Place near your HQ, economy hubs, or narrow approach lanes.',
            'Pair with walls or unit screens so the enemy has to sit in its firing arc.',
        ],
        ['Use towers to buy time and make enemy pushes expensive instead of fighting alone in open space.']
    ),
    hospital: makeGuide(
        buildCardIndex.get('hospital') || fallbackCard('hospital', 'Hospital', 'Sustains human ground forces between fights.'),
        '🏥',
        'support',
        [
            'Place just behind your frontline, not on the very edge of it.',
            'Best where infantry trades happen over and over.',
        ],
        ['Use hospitals to keep soldiers, snipers, and rocketeers cycling without rebuilding the whole army.']
    ),
    repair_dock: makeGuide(
        buildCardIndex.get('repair_dock') || fallbackCard('repair_dock', 'Repair Dock', 'Repairs expensive machines and ships.'),
        '🛠️',
        'support',
        [
            'Place near docks, fleets, or armored staging areas.',
            'Works best when damaged units have a safe retreat path.',
        ],
        ['Use this to win attrition battles with destroyers, carriers, tanks, and other costly units.']
    ),
    naval_mine: makeGuide(
        buildCardIndex.get('naval_mine') || fallbackCard('naval_mine', 'Naval Mine', 'Hidden water ambush for ship lanes and docks.'),
        '💣',
        'defense',
        [
            'Place in open water chokepoints, near docks, or around offshore oil.',
            'Needs a nearby construction ship and spacing from other mines.',
        ],
        ['Use mines to punish predictable ferry paths and make your sea economy much safer.']
    ),
    wall: makeGuide(
        buildCardIndex.get('wall_node') || fallbackCard('wall', 'Wall', 'Cheap blocker that reshapes enemy approach paths.'),
        '🧱',
        'wall',
        [
            'Place where you want enemies to slow down or bunch up.',
            'Do not build walls so far forward that you cannot support them.',
        ],
        ['Use walls with towers and infantry to force bad fights instead of relying on walls alone.']
    ),
    wall_node: makeGuide(
        buildCardIndex.get('wall_node') || fallbackCard('wall_node', 'Wall Node', 'Creates custom wall lines around key space.'),
        '🏰',
        'wall',
        [
            'Drop nodes to shape your defensive line around HQs, oil, and chokepoints.',
            'Link them where the enemy naturally wants to path through.',
        ],
        ['Use wall nodes when you want defenses to fight on your terms instead of in open ground.']
    ),
    bridge_node: makeGuide(
        buildCardIndex.get('bridge_node') || fallbackCard('bridge_node', 'Bridge Node', 'Turns water gaps into attack routes.'),
        '🌉',
        'bridge',
        [
            'Place in open water or on neutral footholds where a builder or construction ship can reach.',
            'Use nodes to create routes toward untouched islands or awkward enemy flanks.',
        ],
        ['Use bridge nodes to change the map itself and open attack lines the enemy did not prepare for.']
    ),
};

export const UNIT_ACTION_GUIDES: Record<string, ActionGuide> = {
    soldier: makeGuide(
        unitCardIndex.get('soldier') || fallbackCard('soldier', 'Soldier', 'Cheap frontline body for early map control.'),
        '💂',
        'infantry',
        undefined,
        ['Use soldiers to claim space, escort builders, and soak damage while your stronger units fire behind them.']
    ),
    sniper: makeGuide(
        unitCardIndex.get('sniper') || fallbackCard('sniper', 'Sniper', 'Long-range pick unit for defensive lines.'),
        '🎯',
        'marksman',
        undefined,
        ['Keep snipers behind other units or walls so they can punish infantry-heavy armies without being rushed.']
    ),
    rocketeer: makeGuide(
        unitCardIndex.get('rocketeer') || fallbackCard('rocketeer', 'Rocketeer', 'Explosive infantry for armor and structures.'),
        '🚀',
        'rocket',
        undefined,
        ['Use rocketeers once towers, tanks, or clustered defenses start deciding fights.']
    ),
    builder: makeGuide(
        unitCardIndex.get('builder') || fallbackCard('builder', 'Builder', 'Expands your map, economy, and tech.'),
        '🛠️',
        'builder',
        undefined,
        ['If you are unsure what to do next, another builder is often the correct answer for tempo and recovery.']
    ),
    oil_seeker: makeGuide(
        unitCardIndex.get('oil_seeker') || fallbackCard('oil_seeker', 'Oil Seeker', 'Support scout that helps discover oil faster.'),
        '📡',
        'scanner',
        undefined,
        ['Use oil seekers when hidden or distant oil decides the map and you want earlier access to high-tech armies.']
    ),
    tank: makeGuide(
        unitCardIndex.get('tank') || fallbackCard('tank', 'Tank', 'Durable frontliner for breaking defended land.'),
        '🚜',
        'armor',
        undefined,
        ['Lead pushes with tanks when you need a real front line instead of trading with fragile infantry.']
    ),
    humvee: makeGuide(
        unitCardIndex.get('humvee') || fallbackCard('humvee', 'Humvee', 'Fast transport and reaction vehicle.'),
        '🚙',
        'transport',
        undefined,
        ['Use humvees to move infantry quickly, answer raids, and shift pressure between nearby fronts.']
    ),
    missile_launcher: makeGuide(
        unitCardIndex.get('missile_launcher') || fallbackCard('missile_launcher', 'Missile Launcher', 'Long-range siege for structures and HQs.'),
        '🚚',
        'artillery',
        undefined,
        ['Keep missile launchers behind tanks or infantry and let them crack towers, production, and HQs from safety.']
    ),
    pirate_ship: makeGuide(
        unitCardIndex.get('pirate_ship') || fallbackCard('pirate_ship', 'Pirate Ship', 'Fast raider for weak coasts and ferries.'),
        '🏴‍☠️',
        'naval-raider',
        undefined,
        ['Use pirate ships to harass water lanes, punish unescorted transports, and keep offshore greed honest.']
    ),
    destroyer: makeGuide(
        unitCardIndex.get('destroyer') || fallbackCard('destroyer', 'Destroyer', 'Core combat ship and safe escort choice.'),
        '🚢',
        'naval-warship',
        undefined,
        ['Use destroyers to secure water control before trying to scale offshore oil or capital ships.']
    ),
    construction_ship: makeGuide(
        unitCardIndex.get('construction_ship') || fallbackCard('construction_ship', 'Construction Ship', 'Builds offshore economy and naval infrastructure.'),
        '🏗️',
        'builder-ship',
        undefined,
        ['Escort construction ships so they can safely place rigs, bridges, and mines without stalling your sea game.']
    ),
    ferry: makeGuide(
        unitCardIndex.get('ferry') || fallbackCard('ferry', 'Ferry', 'Basic transport for crossing water early.'),
        '⛴️',
        'transport',
        undefined,
        ['Use ferries to move builders or infantry onto weak islands before you have permanent bridge or navy control.']
    ),
    light_plane: makeGuide(
        unitCardIndex.get('light_plane') || fallbackCard('light_plane', 'Light Plane', 'Fast harassment air unit.'),
        '🛩️',
        'air',
        undefined,
        ['Use light planes for quick punish windows on soft targets, then rotate out before long trades start.']
    ),
    heavy_plane: makeGuide(
        unitCardIndex.get('heavy_plane') || fallbackCard('heavy_plane', 'Heavy Plane', 'Harder-hitting air strike unit.'),
        '✈️',
        'air',
        undefined,
        ['Use heavy planes when the target is defended and you need real finishing power instead of pure speed.']
    ),
    aircraft_carrier: makeGuide(
        unitCardIndex.get('aircraft_carrier') || fallbackCard('aircraft_carrier', 'Aircraft Carrier', 'Capital ship with air projection and transport.'),
        '🛳️',
        'capital',
        undefined,
        ['Use carriers once you already contest the sea and want to project heavy pressure without exposing your whole fleet.']
    ),
    mothership: makeGuide(
        unitCardIndex.get('mothership') || fallbackCard('mothership', 'Mothership', 'Flying fortress and late-game pressure engine.'),
        '🛸',
        'capital',
        undefined,
        ['Use motherships to swing whole fronts, transport key units, and close games once your economy is already huge.']
    ),
    alien_scout: makeGuide(
        fallbackCard('alien_scout', 'Alien Scout', 'Fast alien skirmisher for quick pressure and spotting.'),
        '👽',
        'air',
        undefined,
        ['Use alien scouts like high-speed pick units: scout edges, punish stragglers, and support heavier alien air.']
    ),
    heavy_alien: makeGuide(
        fallbackCard('heavy_alien', 'Heavy Alien', 'Slow, heavy alien attacker for brutal late-game pressure.'),
        '🛸',
        'capital',
        undefined,
        ['Use heavy aliens when you already have economy and map control and want a durable finisher, not a first strike.']
    ),
};
