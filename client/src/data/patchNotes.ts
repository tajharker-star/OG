import appIconImage from '../assets/patch-notes/app-icon.png';
import battleArtImage from '../assets/patch-notes/battle-art.png';
import campaignCustomImage from '../assets/patch-notes/campaign-custom.png';
import demoReleaseImage from '../assets/patch-notes/demo-release.png';
import lobbyMenuImage from '../assets/patch-notes/lobby-menu.png';
import steamPlatformImage from '../assets/patch-notes/steam-platform.png';

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
    accent: string;
    artwork?: string;
    artworkAlt?: string;
}

export const PATCH_NOTE_ENTRIES: PatchNoteEntry[] = [
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
        accent: '#ffb74d',
        artwork: demoReleaseImage,
        artworkAlt: 'Conquerors: Domination demo key art.'
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
        accent: '#66c0f4',
        artwork: steamPlatformImage,
        artworkAlt: 'Steam store presentation artwork for Conquerors: Domination.'
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
        accent: '#8ce2cb',
        artwork: campaignCustomImage,
        artworkAlt: 'Campaign and custom game setup screen.'
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
        accent: '#ff7d6e',
        artwork: battleArtImage,
        artworkAlt: 'Battle artwork showing active combat.'
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
        accent: '#97a7ff',
        artwork: appIconImage,
        artworkAlt: 'Conquerors: Domination app icon.'
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
        accent: '#ffd772',
        artwork: lobbyMenuImage,
        artworkAlt: 'Main menu lobby screenshot.'
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
        accent: '#8fe388',
        artwork: battleArtImage,
        artworkAlt: 'Combat artwork used to represent AI battle tuning.'
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
        accent: '#ff9e47',
        artwork: battleArtImage,
        artworkAlt: 'Explosive battlefield art representing the expanded unit roster.'
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
        accent: '#f2cf63',
        artwork: campaignCustomImage,
        artworkAlt: 'Custom game setup screen representing broader match and building options.'
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
        accent: '#90dfc4',
        artwork: campaignCustomImage,
        artworkAlt: 'Campaign and custom match selection screen.'
    }
];
