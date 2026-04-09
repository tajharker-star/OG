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
        id: 'steam-multiplayer-and-ranked-quick-match',
        badge: 'Latest',
        filters: ['Latest', 'Content', 'Balance'],
        sortOrder: 162,
        dateLabel: 'Apr 7, 2026',
        title: 'Steam multiplayer, ranked quick match, and RP tracking',
        summary: 'Multiplayer now runs through a proper Steam-hosted flow, with working lobby join/invite support, a dedicated ranked quick-match queue, and ranked progression that feeds directly into post-match results and long-term stats.',
        highlights: [
            'Steam multiplayer lobbies can now be created, advertised, discovered, joined, and invited through the integrated Steam lobby flow instead of relying only on manual room coordination.',
            'Ranked Quick Match is now a dedicated 6-player Steam queue with no bots and auto-start rules, and the matchmaking server now prefers filling active ranked rooms before spinning up new ones.',
            'Ranked results now feed proper RP gain and loss, ranked placement summaries, and long-term ranked records, with Top 3 placements gaining points and 4th through 6th losing them.',
            'Steam lobby metadata, rich presence, and multiplayer stat syncing were tightened so hosted matches, ranked queues, and Steam-backed progression all stay in sync much more reliably.'
        ],
        tags: ['Steam', 'Multiplayer', 'Ranked', 'Stats'],
        iconKey: 'steam',
        changeIcons: ['steam', 'lobby', 'stats'],
        accent: '#7bc7ff'
    },
    {
        id: 'skin-aura-and-unit-scale-polish',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 156,
        dateLabel: 'Apr 7, 2026',
        title: 'Skin aura attachment, themed effects, and unit scale cleanup',
        summary: 'The latest visual pass locked skin effects onto the actual unit and building silhouettes, replaced the old generic skin badges with themed elemental effects, and tightened the size hierarchy across the roster.',
        highlights: [
            'Skin auras and outer outlines now attach to the visible model shapes of units and buildings instead of floating around loose helper geometry, so premium skins read as part of the actual model.',
            'The old square-and-circle skin effect layer was replaced with skin-themed visuals like flame tongues, crystal shards, halo arcs, smoke wisps, and spectral accents, all driven by the active skin colors.',
            'Diamond, Obsidian, Godly, Ruby, and Developer motion trails were recolored to use their real skin palettes more strongly, with the Developer skin now reading as a clear green-fire effect instead of pale white plasma.',
            'Non-humanoid units were normalized into a cleaner shared size band so they stay clearly larger than infantry while still reading smaller than the aircraft carrier and mothership.'
        ],
        tags: ['Skins', 'Auras', 'Units', 'Buildings'],
        iconKey: 'units',
        changeIcons: ['units', 'buildings', 'lobby'],
        accent: '#6dffb0'
    },
    {
        id: 'skins-showroom-and-battlefield-clarity',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 150,
        dateLabel: 'Apr 6, 2026',
        title: 'Skins showroom, premium effects, and battlefield clarity',
        summary: 'The skins system grew into a proper showroom with stronger premium effects, creator-only prestige access, and cleaner battlefield readability around key resource structures and status bars.',
        highlights: [
            'Built a dedicated Skins armory in the lobby with equipping, full-roster preview, zoom, fit, and scroll controls so players can inspect the actual in-game renders for every unit and building.',
            'Refined the public skin ladder into cleaner rank finishes, added Ruby mastery as the demo-completion reward, and introduced a hidden emerald Developer skin that only appears for the creator account.',
            'Neon skin treatment now behaves like a real colored outer glow, and premium motion escalates by tier with Diamond and above gaining stronger trails, pulses, and showroom animation.',
            'Improved battlefield readability by adding dark backplates and black outlines to health and recruitment bars, and made placed oil rigs render above their oil spots so the structure reads cleanly on the map.'
        ],
        tags: ['Skins', 'Developer', 'Readability', 'Showroom'],
        iconKey: 'units',
        changeIcons: ['lobby', 'units', 'buildings', 'rules'],
        accent: '#7dffb2'
    },
    {
        id: 'tutorial-mastery-and-hud-qol',
        badge: 'Latest',
        filters: ['Latest', 'Content', 'Balance'],
        sortOrder: 144,
        dateLabel: 'Apr 1, 2026',
        title: 'Tutorial mastery, HUD polish, and archive cleanup',
        summary: 'The April onboarding pass rolled together clearer map-specific teaching, a proper tutorial graduation flow, cleaner HUD controls, and a faster-scanning patch archive.',
        highlights: [
            'Tutorial flow is now map-aware, with a picker for Desert, Grasslands, and Islands, plus exact lessons for Oil Seeker scouting, Dock logistics, Construction Ships, Oil Wells, and Oil Rigs depending on the terrain.',
            'Economy teaching now uses real placement graphics for gold, grassland, black oil spots, land, and water, and the Start your economy quest only clears once both gold and oil production are online.',
            'Tutorial graduation now ends with a real final test: spawn a bot, defeat it, reach the victory screen, and unlock the new Tutorial Graduate plus higher bot-difficulty achievement milestones.',
            'HUD and front-end quality-of-life updates from the same pass made the floating chat/settings/build controls draggable, fixed Tab focus issues, improved click-away chat behavior, and converted patch notes into a faster icon-first archive.'
        ],
        tags: ['Tutorial', 'HUD', 'Patch Notes', 'Achievements'],
        iconKey: 'campaign',
        changeIcons: ['campaign', 'buildings', 'ai', 'lobby'],
        accent: '#9fdcb7'
    },
    {
        id: 'tutorial-sandbox-and-local-practice',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 138,
        dateLabel: 'Mar 31, 2026',
        title: 'Tutorial sandbox and local practice improvements',
        summary: 'Campaign onboarding became a real playable sandbox, while local match flow and bot practice tools were tightened so players can learn without friction.',
        highlights: [
            'Added a new Tutorial mission at the top of the campaign with guided lessons, safer starting resources, and build/recruit hover previews that explain placement, role, and usage before the player commits.',
            'Darkened tutorial, construction, selected-item, and build-preview panels so the live battlefield stays readable while players learn the game.',
            'Match-start fairness was improved by freezing the opening until every human player is ready, so bots do not get a hidden head start in local practice matches.',
            'Custom and tutorial games now support adding bots reliably mid-session, and ownership labels were cleaned up so humans show Steam names while bots show clear Bot 1, Bot 2, Bot 3 naming.'
        ],
        tags: ['Tutorial', 'Custom Match', 'Bots', 'Readability'],
        iconKey: 'ai',
        changeIcons: ['campaign', 'ai', 'buildings', 'rules'],
        accent: '#9de58d'
    },
    {
        id: 'menu-archive-and-presentation-refresh',
        badge: 'Latest',
        filters: ['Latest', 'Content'],
        sortOrder: 132,
        dateLabel: 'Mar 30, 2026',
        title: 'Menu archive, wishlist CTA, and presentation refresh',
        summary: 'The late-March front-end pass unified the menu style, introduced an in-game patch archive, and pushed the lobby presentation much closer to the Conquerors: Domination identity.',
        highlights: [
            'Added the in-game Patch Notes archive with date labels, category filters, sorting controls, and a dedicated Demo Release announcement for new players.',
            'Added the Wishlist on Steam call-to-action so demo players can jump straight to the full game store page from the lobby.',
            'Unified the top-level lobby button styling, refreshed the animated logo presentation, and cleaned up multiplayer host/join panels so they match the rest of the UI language.',
            'Rounded and re-themed menus, settings, stats, tutorial panels, and construction interfaces around the gold-and-ember logo palette for a more cohesive presentation.'
        ],
        tags: ['Patch Notes', 'Wishlist', 'UI', 'Lobby'],
        iconKey: 'lobby',
        changeIcons: ['lobby', 'steam', 'campaign', 'buildings'],
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
