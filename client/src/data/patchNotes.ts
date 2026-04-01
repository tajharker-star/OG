export type PatchNoteBadge = 'Latest' | 'Archive';
export type PatchNoteFilterTag = 'Latest' | 'Balance' | 'Content' | 'Archive';
export type PatchNoteIconKey =
    | 'demo'
    | 'steam'
    | 'loading'
    | 'rules'
    | 'stats'
    | 'audio'
    | 'lobby'
    | 'ai'
    | 'units'
    | 'buildings'
    | 'logistics'
    | 'campaign';

export interface PatchNoteEntry {
    id: string;
    badge: PatchNoteBadge;
    filters: PatchNoteFilterTag[];
    sortOrder: number;
    dateLabel: string;
    title: string;
    summary: string;
    highlights: string[];
    tags: string[];
    iconKey: PatchNoteIconKey;
    changeIcons: PatchNoteIconKey[];
    accent: string;
}

export const PATCH_NOTE_ENTRIES: PatchNoteEntry[] = [
    {
        id: 'tutorial-economy-and-placement-clarity',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 142,
        dateLabel: 'Apr 1, 2026',
        title: 'Tutorial economy and placement clarity pass',
        summary: 'Economy onboarding now teaches the exact resource spots and support units players need, so oil and gold placement is much harder to misunderstand.',
        highlights: [
            'Economy hover guides now show real placement graphics like the three-dot gold node, grassland patch, black oil spot, and land or water requirement markers.',
            'Land-map tutorials now explicitly teach recruiting an Oil Seeker before trying to place Oil Wells on maps like Desert.',
            'Water-map tutorials now push Dock into Construction Ship into Oil Rig flow so players understand offshore oil before they get stuck.',
            'The Start your economy objective now requires both a gold producer and an oil producer, so players learn the full economy loop instead of half of it.'
        ],
        tags: ['Tutorial', 'Economy', 'Oil', 'Placement'],
        iconKey: 'buildings',
        changeIcons: ['buildings', 'campaign', 'logistics', 'units'],
        accent: '#f7cb70'
    },
    {
        id: 'tutorial-map-playbooks-and-oil-guidance',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 138,
        dateLabel: 'Apr 1, 2026',
        title: 'Map-specific tutorial playbooks and oil guidance',
        summary: 'The tutorial now teaches the right economy and logistics plan for the actual map you picked instead of forcing one generic lesson path.',
        highlights: [
            'Added a tutorial map picker so players can start on Desert, Grasslands, or Islands before launching the sandbox.',
            'Desert now explicitly teaches Barracks into Oil Seeker scanner use, then land Oil Wells and heavy land tech.',
            'Grasslands now teaches earlier Dock and ferry usage for shoreline shortcuts and faster side-lane expansion.',
            'Islands now teaches the full Dock -> Construction Ship -> Oil Rig flow for offshore oil and naval control.'
        ],
        tags: ['Tutorial', 'Maps', 'Oil Scanner', 'Onboarding'],
        iconKey: 'campaign',
        changeIcons: ['campaign', 'logistics', 'buildings', 'units'],
        accent: '#96e0c2'
    },
    {
        id: 'tutorial-graduation-and-bot-achievements',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 136,
        dateLabel: 'Apr 1, 2026',
        title: 'Tutorial graduation quest and new achievement milestones',
        summary: 'The tutorial now has a real final test: add a bot, beat it, reach the victory screen, and graduate properly with progression rewards.',
        highlights: [
            'Added a final tutorial quest that stays incomplete until the player spawns a bot, defeats every bot in the tutorial match, and reaches the victory screen.',
            'Added the Tutorial Graduate achievement that unlocks from either finishing every tutorial objective or winning the final bot challenge.',
            'Added new bot milestone achievements for beating bot difficulties 7, 8, 9, and 10.',
            'Higher bot difficulty wins now cascade the lower-tier bot achievements too, so a level 10 win awards the whole 7-10 set.'
        ],
        tags: ['Tutorial', 'Achievements', 'Bots', 'Progression'],
        iconKey: 'stats',
        changeIcons: ['stats', 'campaign', 'ai'],
        accent: '#9fb0ff'
    },
    {
        id: 'patch-notes-quick-scan-pass',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 134,
        dateLabel: 'Apr 1, 2026',
        title: 'Patch notes quick-scan icon pass',
        summary: 'The changelog is now much faster to read because the side screenshots were replaced with icon-based change callouts and system chips.',
        highlights: [
            'Removed the slower side artwork treatment from patch note cards so the left rail is pure icon information now.',
            'Each patch note now uses a clean icon column that highlights the systems touched by that update.',
            'The result is a faster scan path for players who just want to know what changed at a glance.',
            'Patch entries were also updated with the newest tutorial, onboarding, and achievement work.'
        ],
        tags: ['Patch Notes', 'UI', 'Readability', 'Archive'],
        iconKey: 'lobby',
        changeIcons: ['lobby', 'stats', 'campaign'],
        accent: '#ffd37a'
    },
    {
        id: 'hud-usability-and-chat-polish',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 132,
        dateLabel: 'Apr 1, 2026',
        title: 'HUD usability and chat control polish',
        summary: 'The floating in-match controls are easier to place, easier to read, and no longer fight basic camera control while you play.',
        highlights: [
            'Made the round construction, chat, and settings opener buttons draggable and persist their positions between launches.',
            'Aligned the default in-match opener row across the top and cleaned up the chat button with a proper round shape plus chat-bubble icon.',
            'Stopped Tab from cycling focus through the HUD so WASD and arrow-key camera movement keep working.',
            'Chat input now drops out of typing mode when you click away from the chat window.'
        ],
        tags: ['HUD', 'Chat', 'Controls', 'Quality of Life'],
        iconKey: 'lobby',
        changeIcons: ['lobby', 'logistics'],
        accent: '#ffcf7d'
    },
    {
        id: 'tutorial-and-guided-learning-pass',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 130,
        dateLabel: 'Mar 31, 2026',
        title: 'Tutorial mode and guided learning pass',
        summary: 'Campaign now opens with a real tutorial sandbox that teaches economy, production, unit roles, and how to actually win matches.',
        highlights: [
            'Added a new Tutorial mission at the top of the campaign with safe starting resources and guided lessons.',
            'Added build and recruit hover previews that explain placement, usage, and matchups before players commit.',
            'Economy previews now show the correct placement graphics for gold, grassland, land oil, and water oil.',
            'Tutorial and construction panels were darkened and simplified so the text is easier to read in live matches.'
        ],
        tags: ['Tutorial', 'Campaign', 'Onboarding', 'Build Preview'],
        iconKey: 'campaign',
        changeIcons: ['campaign', 'buildings', 'units'],
        accent: '#8fe3bf'
    },
    {
        id: 'local-match-fairness-and-bot-tools',
        badge: 'Latest',
        filters: ['Latest', 'Balance'],
        sortOrder: 128,
        dateLabel: 'Mar 31, 2026',
        title: 'Local match fairness and bot management',
        summary: 'Single-player and local matches now start more fairly and give you better control over when bots enter the sandbox.',
        highlights: [
            'Bots now wait for every human player to finish the start load gate before the match simulation really begins.',
            'Tutorial and custom matches support adding bots after the match is already running, instead of leaving the Add Bot button dead.',
            'Match startup and local-engine flow were tuned so onboarding and practice sessions are much smoother.',
            'Selected-item ownership labels now read as Steam usernames for humans and clean Bot 1, Bot 2, Bot 3 labels for AI players.'
        ],
        tags: ['Bots', 'Tutorial', 'Custom Match', 'Fair Start'],
        iconKey: 'ai',
        changeIcons: ['ai', 'campaign', 'rules'],
        accent: '#9de58d'
    },
    {
        id: 'patch-notes-and-store-cta-refresh',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 126,
        dateLabel: 'Mar 30, 2026',
        title: 'Patch notes archive and Steam wishlist CTA',
        summary: 'The front end now calls out updates properly and gives demo players a clearer route to follow the full game on Steam.',
        highlights: [
            'Added an in-game Patch Notes button with a real archive instead of hiding changelog details outside the game.',
            'Added dated entries, filters for Latest, Balance, Content, Archive, and sort order controls.',
            'Added the animated Wishlist on Steam button that links directly to the main game store page.',
            'Added the Demo Release announcement entry with a thank-you note and full-game roadmap messaging.'
        ],
        tags: ['Patch Notes', 'Steam', 'Wishlist', 'Presentation'],
        iconKey: 'steam',
        changeIcons: ['steam', 'lobby', 'campaign'],
        accent: '#8ecbff'
    },
    {
        id: 'ui-theme-and-panel-polish',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 124,
        dateLabel: 'Mar 30, 2026',
        title: 'UI theme and panel polish pass',
        summary: 'Menus and in-match panels were pushed closer to the Conquerors: Domination logo style so the whole game feels more cohesive.',
        highlights: [
            'Rounded and re-themed UI panels and buttons across the lobby, settings, stats, tutorial, and in-match HUD.',
            'Rebuilt the construction panel into a cleaner command deck with richer category cards and better readability.',
            'Cleaned up multiplayer menu presentation so host and join flows match the rest of the game design.',
            'Darkened build previews and selected-item panels to make important information easier to read in combat.'
        ],
        tags: ['UI', 'HUD', 'Construction', 'Multiplayer'],
        iconKey: 'lobby',
        changeIcons: ['lobby', 'buildings', 'campaign'],
        accent: '#ffd772'
    },
    {
        id: 'demo-release',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 120,
        dateLabel: 'Mar 25, 2026',
        title: 'Conquerors: Domination Demo is live',
        summary: 'Thank you for downloading the demo and jumping into the battlefield with us. This release rolls together our newest fixes, presentation upgrades, stat tracking, and gameplay cleanup while we keep pushing toward the full game.',
        highlights: [
            'Recent patches included Steam deployment hardening, local-engine warmup/loading, HQ elimination fixes, stats and achievements, the SFX overhaul, and the lobby refresh.',
            'This demo is our current playable slice of the project, built to show off the strategy sandbox, expanding unit roster, bot improvements, and evolving building systems.',
            'We are excited to bring the full version online with proper servers once the project has the funding and finances to support that jump.',
            'Seriously, thank you for trying the game early and helping build momentum for what Conquerors: Domination can become.'
        ],
        tags: ['Demo Release', 'Welcome', 'Thank You', 'Roadmap'],
        iconKey: 'demo',
        changeIcons: ['demo', 'campaign', 'steam'],
        accent: '#ffb74d'
    },
    {
        id: 'steam-platform-hardening',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 118,
        dateLabel: 'Mar 2026',
        title: 'Steam deployment and platform hardening',
        summary: 'The demo pipeline was rebuilt so the game packages and ships cleanly across Steam without manual depot triage.',
        highlights: [
            'Stabilized Windows, macOS, and Linux packaging plus cross-platform smoke validation.',
            'Fixed launch path and bundle layout issues that were breaking packaged Steam builds.',
            'Improved Steam upload, auth, and deployment reliability in CI.'
        ],
        tags: ['Steam', 'CI', 'Windows', 'macOS', 'Linux'],
        iconKey: 'steam',
        changeIcons: ['steam', 'loading'],
        accent: '#66c0f4'
    },
    {
        id: 'warmup-and-local-engine',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 116,
        dateLabel: 'Mar 2026',
        title: 'Warmup loading and local engine boot flow',
        summary: 'Local matches now prewarm the embedded server and hold entry until the session is actually stable.',
        highlights: [
            'Added boot gating before campaign and custom play unlock.',
            'Added lobby and match loading screens that wait for state, ping, and frame rate to settle.',
            'Reduced ugly lobby flashes and startup race conditions when entering matches.'
        ],
        tags: ['Loading', 'Campaign', 'Custom', 'Stability'],
        iconKey: 'loading',
        changeIcons: ['loading', 'campaign'],
        accent: '#8ce2cb'
    },
    {
        id: 'elimination-and-hq-rules',
        badge: 'Latest',
        filters: ['Latest', 'Balance'],
        sortOrder: 114,
        dateLabel: 'Mar 2026',
        title: 'HQ elimination rules and defeat flow cleanup',
        summary: 'Match-ending logic was tightened so destroyed players actually stay out and wins resolve correctly.',
        highlights: [
            'HQ respawn is capped instead of looping forever.',
            'Defeat and victory screens now trigger from the real elimination state.',
            'Blocked repeated force-respawns after a player is fully eliminated.'
        ],
        tags: ['Combat', 'Rules', 'Victory', 'Defeat'],
        iconKey: 'rules',
        changeIcons: ['rules', 'campaign'],
        accent: '#ff7d6e'
    },
    {
        id: 'stats-and-achievements',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 112,
        dateLabel: 'Mar 2026',
        title: 'Stats, achievements, and Steam progression sync',
        summary: 'The lobby now tracks long-term performance instead of treating every session like a fresh boot.',
        highlights: [
            'Added lifetime, multiplayer, co-op, campaign, custom, and ranked stat buckets.',
            'Added a starter achievement set tied to match history and progression milestones.',
            'Prepared Steam stat and achievement sync so progression can persist beyond local saves.'
        ],
        tags: ['Stats', 'Achievements', 'Ranked', 'Steam'],
        iconKey: 'stats',
        changeIcons: ['stats', 'steam', 'campaign'],
        accent: '#97a7ff'
    },
    {
        id: 'audio-overhaul',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 110,
        dateLabel: 'Mar 2026',
        title: 'Sound design pass and advanced SFX mixer',
        summary: 'Menu and battlefield audio were upgraded from a handful of generic cues to a layered, tunable sound set.',
        highlights: [
            'Added satisfying button click sounds across the lobby and menus.',
            'Added unit-specific weapon fire and building placement effects.',
            'Added an advanced SFX mixer with per-sound sliders plus main-menu bullets and explosions controls.'
        ],
        tags: ['Audio', 'SFX', 'Mixer', 'UI'],
        iconKey: 'audio',
        changeIcons: ['audio', 'lobby', 'units', 'buildings'],
        accent: '#ff8bd4'
    },
    {
        id: 'lobby-presentation-refresh',
        badge: 'Latest',
        filters: ['Latest'],
        sortOrder: 108,
        dateLabel: 'Mar 2026',
        title: 'Lobby presentation refresh',
        summary: 'The front end got a stronger presentation pass so the main menu, multiplayer area, and onboarding screens feel like the same game.',
        highlights: [
            'Added the new animated lobby logo treatment.',
            'Unified the top-level lobby buttons and cleaned up multiplayer hosting and join panels.',
            'Improved responsive scaling on the logo, settings, and menu layouts.'
        ],
        tags: ['Lobby', 'UI', 'Multiplayer', 'Presentation'],
        iconKey: 'lobby',
        changeIcons: ['lobby', 'campaign'],
        accent: '#ffd772'
    },
    {
        id: 'bot-difficulty-overhaul',
        badge: 'Archive',
        filters: ['Balance', 'Archive'],
        sortOrder: 98,
        dateLabel: 'Archive - Feb 2026',
        title: 'Bot training and difficulty ladder overhaul',
        summary: 'AI opponents moved from basic pressure bots to a deeper difficulty ladder with distinct strategic behavior.',
        highlights: [
            'Expanded the difficulty ladder out to 10 tuned bot levels.',
            'Added smarter bridge expansion, dock pressure, pirate raids, and naval mine defense logic.',
            'Added deeper air-tech behavior including air-base planning and mothership saving windows.',
            'Improved healing, retreat, and hidden-oil claiming behavior for stronger mid and late-game bots.'
        ],
        tags: ['Bots', 'AI', 'Difficulty', 'Strategy'],
        iconKey: 'ai',
        changeIcons: ['ai', 'units', 'logistics'],
        accent: '#8fe388'
    },
    {
        id: 'unit-roster-expansion',
        badge: 'Archive',
        filters: ['Content', 'Archive'],
        sortOrder: 96,
        dateLabel: 'Archive - Feb 2026',
        title: 'Unit roster expansion',
        summary: 'The battlefield roster grew well beyond the starter infantry set into full land, sea, and air tech trees.',
        highlights: [
            'Expanded infantry options with snipers, rocketeers, builders, and oil seekers.',
            'Added vehicle pressure with tanks, humvees, and missile launchers.',
            'Expanded naval logistics and combat with destroyers, pirate ships, ferries, and construction ships.',
            'Added air escalation with light planes, heavy planes, aircraft carriers, and motherships.'
        ],
        tags: ['Units', 'Land', 'Naval', 'Air'],
        iconKey: 'units',
        changeIcons: ['units', 'logistics'],
        accent: '#ff9e47'
    },
    {
        id: 'building-and-economy-expansion',
        badge: 'Archive',
        filters: ['Content', 'Archive'],
        sortOrder: 94,
        dateLabel: 'Archive - Feb 2026',
        title: 'New buildings, economy, and support structures',
        summary: 'Base-building moved from a small core set into a layered economy and support network.',
        highlights: [
            'Added tank factories and air bases to unlock heavier production chains.',
            'Added hospitals and repair docks to support damaged armies and fleets.',
            'Expanded economy with farms, oil wells, and offshore oil rigs.',
            'Added bridge nodes, wall nodes, and naval mines for map control and defense.'
        ],
        tags: ['Buildings', 'Economy', 'Support', 'Defense'],
        iconKey: 'buildings',
        changeIcons: ['buildings', 'logistics', 'units'],
        accent: '#f2cf63'
    },
    {
        id: 'logistics-and-map-control',
        badge: 'Archive',
        filters: ['Content', 'Archive'],
        sortOrder: 92,
        dateLabel: 'Archive - Jan to Feb 2026',
        title: 'Bridges, logistics, and map control systems',
        summary: 'Movement and expansion became much more tactical once transport and node systems were layered in.',
        highlights: [
            'Added ferry loading and unloading plus broader transport interactions.',
            'Added bridge-node chaining for crossing water and extending fronts.',
            'Added wall-node perimeter building and chokepoint defense tools.',
            'Improved shoreline, dock, and water-building validation.'
        ],
        tags: ['Logistics', 'Bridges', 'Transport', 'Map Control'],
        iconKey: 'logistics',
        changeIcons: ['logistics', 'buildings'],
        accent: '#84d8ff'
    },
    {
        id: 'campaign-and-skirmish-suite',
        badge: 'Archive',
        filters: ['Content', 'Archive'],
        sortOrder: 90,
        dateLabel: 'Archive - Jan 2026',
        title: 'Campaign and skirmish suite',
        summary: 'Single-player and local modes were expanded so the game is playable even without a remote multiplayer backend.',
        highlights: [
            'Added multi-stage campaign progression with curated bot counts and difficulty ramps.',
            'Added custom and local match setup with map type, bot count, and difficulty selection.',
            'Improved local-engine boot behavior so offline-style play is much smoother.'
        ],
        tags: ['Campaign', 'Skirmish', 'Offline', 'Progression'],
        iconKey: 'campaign',
        changeIcons: ['campaign', 'ai', 'loading'],
        accent: '#90dfc4'
    }
];
