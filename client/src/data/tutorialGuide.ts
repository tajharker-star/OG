export type TutorialGuideCard = {
    id: string;
    entityType?: string;
    title: string;
    summary: string;
    strengths: string;
    caution: string;
    tips: string[];
};

export type TutorialGuideGroup = {
    id: string;
    title: string;
    intro: string;
    cards: TutorialGuideCard[];
};

export type TutorialLesson = {
    id: string;
    title: string;
    summary: string;
    bullets: string[];
};

export const TUTORIAL_CORE_LESSONS: TutorialLesson[] = [
    {
        id: 'goal',
        title: 'What wins the match',
        summary: 'Protect your HQ, grow your economy, and destroy every enemy HQ still standing.',
        bullets: [
            'Your base is your command center. If it is destroyed and you are out of respawns, you lose.',
            'Winning usually means turning early income into production, then production into map control and army pressure.',
            'Do not wait too long. Expanding to more islands and oil spots is what lets you outscale the enemy.'
        ]
    },
    {
        id: 'tempo',
        title: 'How matches usually flow',
        summary: 'Open with builders and income, tech into the production you need, then attack the right target with the right force.',
        bullets: [
            'Early game is about builders, gold, and claiming safe ground.',
            'Mid game is where barracks, factories, docks, and air bases decide your army shape.',
            'Late game is about layered armies, transport, support buildings, and striking the enemy HQ before they can rebuild.'
        ]
    },
    {
        id: 'practice',
        title: 'How to use this tutorial',
        summary: 'This tutorial sandbox starts rich and safe so you can experiment first, then press Add Bot when you want live practice.',
        bullets: [
            'Build freely, read the unit and building cards, and use the checklist to cover the basics.',
            'When you feel comfortable, add a bot and practice turning your economy into an actual win.',
            'After that, jump into The Beginning to start the normal campaign.'
        ]
    }
];

export const TUTORIAL_RESOURCE_LESSONS: TutorialLesson[] = [
    {
        id: 'gold',
        title: 'Gold',
        summary: 'Gold powers almost everything: builders, production buildings, infantry, vehicles, ships, and expansion.',
        bullets: [
            'You earn gold passively from your base, owned islands, mines, and farms.',
            'Mines are your best burst gold structure when a gold spot is available.',
            'Farms are cheap economy buildings for steady income on suitable land.'
        ]
    },
    {
        id: 'oil',
        title: 'Oil',
        summary: 'Oil is the tech resource. Your strongest vehicles, ships, aircraft, and support structures all need it.',
        bullets: [
            'Oil Wells harvest land oil spots. Oil Rigs harvest water oil spots.',
            'Rocketeers, tanks, missile launchers, aircraft, carriers, and motherships all lean on oil.',
            'If you ignore oil, you lock yourself out of advanced armies and lose the late game.'
        ]
    }
];

export const TUTORIAL_BUILDING_GROUPS: TutorialGuideGroup[] = [
    {
        id: 'economy',
        title: 'Economy and Expansion',
        intro: 'These structures keep your income flowing and your empire growing.',
        cards: [
            {
                id: 'base',
                entityType: 'base',
                title: 'Base',
                summary: 'Your HQ. It generates core income, trains builders, and defines whether you are still alive in the match.',
                strengths: 'Central income, builder access, and the building you must protect at all costs.',
                caution: 'If the enemy collapses your HQ and you are out of recovery chances, your match is over.',
                tips: [
                    'Keep towers, walls, and armies near your HQ if pressure is coming.',
                    'Use the base early to get extra builders so you can expand faster.',
                    'Treat enemy HQs as priority targets once your army is ready.'
                ]
            },
            {
                id: 'mine',
                entityType: 'mine',
                title: 'Mine',
                summary: 'The fastest way to turn a gold deposit into strong early-game income.',
                strengths: 'Huge gold efficiency when placed on a gold spot.',
                caution: 'Only works on gold spots, so protect the island that contains them.',
                tips: [
                    'Secure mines early if the map gives you safe deposits.',
                    'A mine-heavy opening lets you snowball into more builders and faster production.',
                    'Losing mine islands hurts your economy immediately, so defend them.'
                ]
            },
            {
                id: 'farm',
                entityType: 'farm',
                title: 'Farm',
                summary: 'Cheap passive gold income that helps stabilize your economy across owned land.',
                strengths: 'Low-cost, easy-to-place income building for scaling.',
                caution: 'Farms are weaker than mines per slot, so build them where gold spots are not available.',
                tips: [
                    'Use farms to thicken your economy after your first mine and production building.',
                    'Farms are excellent on safe backline islands.',
                    'Do not spam only farms if the enemy is taking map control faster than you.'
                ]
            },
            {
                id: 'oil-well',
                entityType: 'oil_well',
                title: 'Oil Well',
                summary: 'Your land-based path into tanks, missiles, aircraft, and other tech-heavy units.',
                strengths: 'Reliable oil income from visible land oil spots.',
                caution: 'If your oil gets cut off, your advanced production slows down hard.',
                tips: [
                    'Build Oil Wells before committing to vehicle or air-heavy plans.',
                    'A single oil structure can unlock your first wave of advanced units.',
                    'Protect oil islands because they are high-value targets.'
                ]
            },
            {
                id: 'oil-rig',
                entityType: 'oil_rig',
                title: 'Oil Rig',
                summary: 'Water-based oil income that pays for powerful naval and air late-game armies.',
                strengths: 'Strong offshore oil production once your dock game is online.',
                caution: 'Requires water access and is vulnerable if you lose naval control.',
                tips: [
                    'Use Construction Ships to reach offshore oil safely.',
                    'Oil Rigs are a big reason to build docks early on island maps.',
                    'Escort your offshore economy with destroyers, pirate ships, or naval mines.'
                ]
            }
        ]
    },
    {
        id: 'production',
        title: 'Production Buildings',
        intro: 'These buildings decide what kind of army you can field.',
        cards: [
            {
                id: 'barracks',
                entityType: 'barracks',
                title: 'Barracks',
                summary: 'Your first military production building and the home of infantry, builders, and oil seekers.',
                strengths: 'Fast access to cheap map-control units and utility pieces.',
                caution: 'Barracks alone will not win once the enemy reaches heavy armor or air.',
                tips: [
                    'Build barracks early when you need map presence fast.',
                    'Use infantry to claim ground and support heavier units later.',
                    'Keep producing builders from either the base or barracks when you want to out-expand the enemy.'
                ]
            },
            {
                id: 'tank-factory',
                entityType: 'tank_factory',
                title: 'Tank Factory',
                summary: 'Unlocks the strongest land power spike: tanks, humvees, and missile launchers.',
                strengths: 'Gives you armor, transport, and siege pressure from one building.',
                caution: 'Needs oil support, so do not rush it without economy behind it.',
                tips: [
                    'Add a Tank Factory when infantry alone stops being enough.',
                    'Tanks are your frontline bruisers; missile launchers break defenses from range.',
                    'Humvees are best when you want fast repositioning and troop delivery.'
                ]
            },
            {
                id: 'dock',
                entityType: 'dock',
                title: 'Dock',
                summary: 'Your gateway to navy, transport, offshore oil, and some of the best island-map control tools.',
                strengths: 'Controls water, unlocks logistics, and opens Oil Rigs and capital ships.',
                caution: 'A dock with no naval follow-up is just a tech tax.',
                tips: [
                    'Prioritize docks on island maps or whenever water lanes matter.',
                    'Docks let you pressure enemy coastlines and reinforce distant islands.',
                    'A player with navy control often controls the tempo on water maps.'
                ]
            },
            {
                id: 'air-base',
                entityType: 'air_base',
                title: 'Air Base',
                summary: 'Trains fast strike aircraft and opens your path to map-wide pressure.',
                strengths: 'Best way to threaten multiple fronts quickly.',
                caution: 'Air is expensive and weak if your oil economy is not online.',
                tips: [
                    'Add an Air Base once you have stable oil and a reason to punish slow enemy defenses.',
                    'Light Planes are great for speed; Heavy Planes hit harder and survive longer.',
                    'Air power is strongest when paired with land or naval pressure underneath it.'
                ]
            }
        ]
    },
    {
        id: 'defense',
        title: 'Defense and Support',
        intro: 'These structures help you survive pushes and keep expensive armies alive.',
        cards: [
            {
                id: 'tower',
                entityType: 'tower',
                title: 'Tower',
                summary: 'A direct-fire defense that punishes enemy units trying to brute-force your islands.',
                strengths: 'Reliable static defense near HQs, economy hubs, and chokepoints.',
                caution: 'Towers are support pieces, not a replacement for an army.',
                tips: [
                    'Place towers where the enemy has to commit through a narrow lane.',
                    'Towers buy time for your mobile army to arrive.',
                    'A few towers near important oil or gold islands can save games.'
                ]
            },
            {
                id: 'hospital',
                entityType: 'hospital',
                title: 'Hospital',
                summary: 'Repairs and sustains your human ground forces after fights.',
                strengths: 'Keeps infantry and other human units in the field longer.',
                caution: 'It does not replace good positioning, and it will not save units caught alone.',
                tips: [
                    'Build hospitals near frontline staging areas for repeated pushes.',
                    'Use hospitals when you are trading often with infantry or mixed land forces.',
                    'Support buildings shine most when your units actually survive with low health.'
                ]
            },
            {
                id: 'repair-dock',
                entityType: 'repair_dock',
                title: 'Repair Dock',
                summary: 'The naval and vehicle equivalent of a hospital for non-human units.',
                strengths: 'Excellent for preserving destroyers, carriers, tanks, and other expensive machines.',
                caution: 'If your fleet has nowhere safe to retreat, the repair dock cannot help you.',
                tips: [
                    'Build one once you are investing in ships or other expensive non-human units.',
                    'Use repair docks to win attrition wars on water.',
                    'Pair repair support with strong defenses so your damaged fleet can actually escape.'
                ]
            },
            {
                id: 'bridge-node',
                entityType: 'bridge_node',
                title: 'Bridge Node',
                summary: 'Connects islands and lets you extend land pressure across water.',
                strengths: 'Transforms the map by turning water gaps into usable attack routes.',
                caution: 'Bridge chains need protection or the enemy will break your logistics.',
                tips: [
                    'Use bridge nodes to create new fronts the enemy did not expect.',
                    'Builders and Construction Ships can both help with bridge expansion.',
                    'Bridge control often wins island maps before the final HQ push.'
                ]
            },
            {
                id: 'wall-node',
                entityType: 'wall_node',
                title: 'Wall Node',
                summary: 'Creates defensive walls and lets you shape how enemy armies approach.',
                strengths: 'Great for making towers and armies fight on your terms.',
                caution: 'Walls delay enemies, but they do not kill them by themselves.',
                tips: [
                    'Use wall nodes to protect your HQ, oil islands, or narrow land entrances.',
                    'Combine walls with towers so stalled enemies take punishment.',
                    'If your wall line is too far forward, it becomes expensive to maintain.'
                ]
            },
            {
                id: 'naval-mine',
                entityType: 'naval_mine',
                title: 'Naval Mine',
                summary: 'A hidden water ambush that deletes careless enemy ships.',
                strengths: 'Excellent for denying water lanes, docks, and offshore oil.',
                caution: 'Mines only matter where enemy ships actually travel.',
                tips: [
                    'Plant mines near docks, rig lanes, and chokepoints.',
                    'Use them to punish predictable ferry or destroyer paths.',
                    'A few mines can make your water economy much safer.'
                ]
            }
        ]
    }
];

export const TUTORIAL_UNIT_GROUPS: TutorialGuideGroup[] = [
    {
        id: 'utility',
        title: 'Utility and Logistics Units',
        intro: 'These units win the map before the big armies even arrive.',
        cards: [
            {
                id: 'builder',
                entityType: 'builder',
                title: 'Builder',
                summary: 'The most important unit in the game. Builders create your economy, production, and defenses.',
                strengths: 'Essential for every expansion plan and every base recovery.',
                caution: 'If you stop making builders, your map growth usually stops too.',
                tips: [
                    'Always think about whether you need another builder.',
                    'Safe builders create income; forward builders create tempo.',
                    'Protect builders because they are often more valuable than one extra combat unit.'
                ]
            },
            {
                id: 'oil-seeker',
                entityType: 'oil_seeker',
                title: 'Oil Seeker',
                summary: 'A support unit that helps you discover and exploit hidden oil faster.',
                strengths: 'Finds oil and supports your tech economy.',
                caution: 'It is expensive and does not fight well, so do not build it before basics are stable.',
                tips: [
                    'Use oil seekers when you need to unlock more advanced production.',
                    'Treat them like utility scouts, not front-line soldiers.',
                    'An oil seeker pays off when it helps you secure new oil before the enemy does.'
                ]
            },
            {
                id: 'construction-ship',
                entityType: 'construction_ship',
                title: 'Construction Ship',
                summary: 'Your specialist for offshore building, bridge support, and water logistics.',
                strengths: 'Required for Oil Rigs and strong water infrastructure.',
                caution: 'A Construction Ship without water control is easy to punish.',
                tips: [
                    'Escort construction ships with combat ships if enemy navy is nearby.',
                    'Use them to expand offshore oil and safe naval infrastructure.',
                    'They are strategic units, so losing them slows your whole sea game.'
                ]
            },
            {
                id: 'ferry',
                entityType: 'ferry',
                title: 'Ferry',
                summary: 'Basic troop transport for moving infantry and builders over water.',
                strengths: 'Cheap way to move armies between islands before full bridge control.',
                caution: 'Ferries are vulnerable while loaded, so do not sail them alone through danger.',
                tips: [
                    'Use ferries to surprise weakly defended islands.',
                    'Load builders for fast expansion on remote islands.',
                    'Escort important ferry routes with destroyers or naval mines.'
                ]
            },
            {
                id: 'humvee',
                entityType: 'humvee',
                title: 'Humvee',
                summary: 'Fast vehicle transport that keeps infantry moving and reinforces fronts quickly.',
                strengths: 'Great mobility, troop carrying, and quick response play.',
                caution: 'Humvees are not heavy brawlers. They work best with support.',
                tips: [
                    'Use humvees to reposition snipers and rocketeers quickly.',
                    'They are perfect for responding to raids across your empire.',
                    'Do not let them sit and trade into tanks without help.'
                ]
            }
        ]
    },
    {
        id: 'infantry',
        title: 'Infantry Core',
        intro: 'Infantry is cheap, flexible, and the easiest way to hold ground early.',
        cards: [
            {
                id: 'soldier',
                entityType: 'soldier',
                title: 'Soldier',
                summary: 'Your basic front-line unit and the fastest way to put bodies on the map.',
                strengths: 'Cheap, quick to recruit, and good for swarming light resistance.',
                caution: 'Falls off against heavier tech if unsupported.',
                tips: [
                    'Use soldiers to claim islands, soak fire, and escort builders.',
                    'Mass soldiers early if the enemy is greedy.',
                    'Once heavier tech appears, keep soldiers as support instead of your whole army.'
                ]
            },
            {
                id: 'sniper',
                entityType: 'sniper',
                title: 'Sniper',
                summary: 'Long-range infantry that punishes exposed enemies before they can fire back.',
                strengths: 'Excellent pick-offs and defensive lines when protected.',
                caution: 'Snipers hate getting rushed or transported into bad positions.',
                tips: [
                    'Put snipers behind soldiers or walls.',
                    'Use them to punish infantry-heavy enemies.',
                    'Transport them with humvees when you need range on a new front quickly.'
                ]
            },
            {
                id: 'rocketeer',
                entityType: 'rocketeer',
                title: 'Rocketeer',
                summary: 'Explosive infantry that threatens armor and structures once oil is online.',
                strengths: 'Great burst into tougher targets and clustered defenses.',
                caution: 'More expensive than basic infantry, so avoid wasting them on low-value fights.',
                tips: [
                    'Use rocketeers when tanks and towers begin to appear.',
                    'Keep them behind a screen instead of leading with them.',
                    'A few rocketeers can make your infantry army far harder to ignore.'
                ]
            }
        ]
    },
    {
        id: 'vehicles',
        title: 'Vehicle Force',
        intro: 'Vehicles hit harder than infantry and give you real mid-game land power.',
        cards: [
            {
                id: 'tank',
                entityType: 'tank',
                title: 'Tank',
                summary: 'Your most dependable land bruiser for breaking through defended positions.',
                strengths: 'High durability, good all-around pressure, and strong front-line presence.',
                caution: 'Tanks are expensive, so do not feed them into unsupported bad fights.',
                tips: [
                    'Use tanks when you need a real front line.',
                    'Tanks pair well with snipers, rocketeers, and support buildings behind them.',
                    'If the enemy is still on infantry tech, tanks can snowball hard.'
                ]
            },
            {
                id: 'missile-launcher',
                entityType: 'missile_launcher',
                title: 'Missile Launcher',
                summary: 'Long-range siege unit for deleting buildings from safety.',
                strengths: 'Exceptional at cracking towers, production, and HQs.',
                caution: 'It is not for dueling normal units, so always screen it.',
                tips: [
                    'Bring missile launchers when the enemy turtles behind defenses.',
                    'Keep them behind tanks or infantry screens.',
                    'If they get flanked, they usually die before paying for themselves.'
                ]
            }
        ]
    },
    {
        id: 'naval',
        title: 'Naval Power',
        intro: 'Navies control water routes, offshore oil, and surprise attacks on island maps.',
        cards: [
            {
                id: 'pirate-ship',
                entityType: 'pirate_ship',
                title: 'Pirate Ship',
                summary: 'Cheap raider ship for fast harassment and early naval presence.',
                strengths: 'Affordable pressure on exposed coasts and transports.',
                caution: 'Loses direct quality fights against stronger warships.',
                tips: [
                    'Open pirate ships when you need quick water presence.',
                    'Raid ferries, exposed docks, and weak offshore economy.',
                    'Do not rely on pirate ships alone once heavy fleets appear.'
                ]
            },
            {
                id: 'destroyer',
                entityType: 'destroyer',
                title: 'Destroyer',
                summary: 'Your core combat ship and the safest all-around naval answer.',
                strengths: 'Reliable naval fighting power and strong escort value.',
                caution: 'Still needs support if the enemy is massing carriers or layered defenses.',
                tips: [
                    'Use destroyers to take water control before building deep offshore economy.',
                    'Escort ferries, oil rigs, and construction ships with destroyers.',
                    'A stable destroyer line makes the rest of your navy possible.'
                ]
            },
            {
                id: 'aircraft-carrier',
                entityType: 'aircraft_carrier',
                title: 'Aircraft Carrier',
                summary: 'A capital ship that projects air power and transports units over water.',
                strengths: 'Huge late-game pressure, air support, and transport utility.',
                caution: 'Very expensive, so build carriers only after your oil economy is real.',
                tips: [
                    'Use carriers when you already control or contest the sea.',
                    'Launch aircraft while the carrier stays in a safer backline position.',
                    'Carriers shine when they support an existing fleet, not when rushed alone.'
                ]
            }
        ]
    },
    {
        id: 'air',
        title: 'Air and Capital Units',
        intro: 'Air lets you hit anywhere. Capital units turn that pressure into match-ending threat.',
        cards: [
            {
                id: 'light-plane',
                entityType: 'light_plane',
                title: 'Light Plane',
                summary: 'Fast, cheap air harassment that punishes weakly defended targets.',
                strengths: 'Excellent mobility and quick strike potential.',
                caution: 'Fragile compared with heavier tech.',
                tips: [
                    'Use Light Planes to pick off economy and lonely units.',
                    'They are best when you need speed more than durability.',
                    'Rotate them often instead of leaving them in long trades.'
                ]
            },
            {
                id: 'heavy-plane',
                entityType: 'heavy_plane',
                title: 'Heavy Plane',
                summary: 'A sturdier air attacker for serious strike pressure.',
                strengths: 'Better survivability and punch than light planes.',
                caution: 'Costs enough oil that you should not lose them carelessly.',
                tips: [
                    'Use Heavy Planes when the target is actually defended.',
                    'They are great at finishing damaged high-value targets.',
                    'Heavy Planes work best when the enemy is already distracted by land or naval pressure.'
                ]
            },
            {
                id: 'mothership',
                entityType: 'mothership',
                title: 'Mothership',
                summary: 'Your flying fortress. It transports units and keeps producing air power in the late game.',
                strengths: 'Massive strategic reach and end-game intimidation.',
                caution: 'A mothership is a full tech commitment. Do not build one without the economy to support it.',
                tips: [
                    'Build motherships only when you already have strong gold and oil behind you.',
                    'Use them to swing pressure across the map, not to idle over one island.',
                    'A protected mothership can close games quickly once the enemy economy is cracked.'
                ]
            }
        ]
    }
];

export const TUTORIAL_STRATEGY_LESSONS: TutorialLesson[] = [
    {
        id: 'openings',
        title: 'Strong opening habits',
        summary: 'Good openings are simple: income first, production second, pressure third.',
        bullets: [
            'Train builders early so you can take more gold and oil than the enemy.',
            'Choose your first production building based on the map: barracks for fast land pressure, dock for island water control, factory for vehicle timing, air once oil is stable.',
            'Always ask what your next income source is before over-spending on luxury tech.'
        ]
    },
    {
        id: 'matchups',
        title: 'Pick the right answer to the right threat',
        summary: 'The best army is the one that attacks what the enemy is actually relying on.',
        bullets: [
            'Use soldiers and snipers to control early land skirmishes.',
            'Use rocketeers, tanks, and missile launchers once armor and buildings matter.',
            'Use destroyers and pirate ships to stop ferries, rigs, and enemy dock plans.',
            'Use aircraft when you need reach, speed, or punishment on weak backlines.'
        ]
    },
    {
        id: 'closing',
        title: 'How to actually finish games',
        summary: 'Most wins come from collapsing the enemy economy first, then striking the HQ before they can rebuild.',
        bullets: [
            'Take map control and deny oil before jumping straight at the HQ.',
            'Break production and support buildings so the enemy cannot reinforce.',
            'Once the enemy is weak, focus the HQ and end the match instead of farming side targets forever.'
        ]
    }
];
