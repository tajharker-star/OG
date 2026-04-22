export type SkinFamily = 'standard' | 'ranked' | 'achievement' | 'leaderboard' | 'developer';
export type SkinTarget = 'unit' | 'building';
export type RankedSkinRank = 'gold' | 'platinum' | 'topaz' | 'diamond' | 'obsidian' | 'godly';
export type SkinId =
    | 'default'
    | 'ruby'
    | 'gold'
    | 'platinum'
    | 'topaz'
    | 'diamond'
    | 'obsidian'
    | 'godly'
    | 'leaderboard_first'
    | 'leaderboard_second'
    | 'leaderboard_third'
    | 'leaderboard_top10'
    | 'developer';

export interface SkinPalette {
    primary: number;
    secondary: number;
    stroke: number;
    shadow: number;
    glow: number;
    fillBlend: number;
    strokeBlend: number;
    shadowBlend: number;
    highlightBlend: number;
    glowAlpha: number;
    sheenAlpha: number;
    outerGlowAlpha: number;
    outlineAlpha: number;
    pulseStrength: number;
    pulseDurationMs: number;
    trailAlpha: number;
    trailScale: number;
    trailDurationMs: number;
}

export interface SkinDefinition {
    id: SkinId;
    title: string;
    shortTitle: string;
    family: SkinFamily;
    rank?: RankedSkinRank;
    unlockText: string;
    summary: string;
    palette: SkinPalette;
}

export interface SkinLoadout {
    unitSkinId: SkinId;
    buildingSkinId: SkinId;
    unitEnhancementLevel?: number;
    buildingEnhancementLevel?: number;
}

export interface PlayerSkinProfile {
    version: number;
    loadout: SkinLoadout;
    earnedSeasonRewards: SkinId[];
    skinItemCounts: Partial<Record<SkinId, number>>;
    claimedLeaderboardRewards: Record<string, string>;
}

export interface SteamSkinItemDefinition {
    itemDefId: number;
    storeBundle: string;
    rarity: 'starter' | 'seasonal' | 'mastery' | 'leaderboard' | 'creator';
    tradable: boolean;
    marketable: boolean;
    notes: string;
}

export const RANK_LABELS: Record<RankedSkinRank, string> = {
    gold: 'Gold',
    platinum: 'Platinum',
    topaz: 'Topaz',
    diamond: 'Diamond',
    obsidian: 'Obsidian',
    godly: 'Godly',
};

export const RANKED_SKIN_IDS: RankedSkinRank[] = ['gold', 'platinum', 'topaz', 'diamond', 'obsidian', 'godly'];

export const LEADERBOARD_SKIN_IDS = [
    'leaderboard_first',
    'leaderboard_second',
    'leaderboard_third',
    'leaderboard_top10',
] as const satisfies readonly SkinId[];

export type LeaderboardSkinId = typeof LEADERBOARD_SKIN_IDS[number];

const RANK_SUMMARIES: Record<RankedSkinRank, string> = {
    gold: 'Warm gold trim with a polished tournament glow.',
    platinum: 'Bright light-blue plating with a colder elite finish.',
    topaz: 'Amber-crystal highlights with a brighter command sheen.',
    diamond: 'Dark sapphire-blue brilliance with sharper luminous edges and premium motion trails.',
    obsidian: 'Dark volcanic armor with restrained spectral highlights.',
    godly: 'Controlled neon white radiance built to feel divine without washing units out.',
};

const RANK_PALETTES: Record<RankedSkinRank, SkinPalette> = {
    gold: {
        primary: 0xd4af37,
        secondary: 0xffe7a2,
        stroke: 0xfff3ca,
        shadow: 0x5e4510,
        glow: 0xffcb67,
        fillBlend: 0.18,
        strokeBlend: 0.26,
        shadowBlend: 0.12,
        highlightBlend: 0.24,
        glowAlpha: 0.1,
        sheenAlpha: 0.08,
        outerGlowAlpha: 0.18,
        outlineAlpha: 0.2,
        pulseStrength: 0.04,
        pulseDurationMs: 2600,
        trailAlpha: 0,
        trailScale: 1,
        trailDurationMs: 0,
    },
    platinum: {
        primary: 0x9bcfff,
        secondary: 0xf2fbff,
        stroke: 0xe6f7ff,
        shadow: 0x315979,
        glow: 0xaedfff,
        fillBlend: 0.22,
        strokeBlend: 0.3,
        shadowBlend: 0.14,
        highlightBlend: 0.28,
        glowAlpha: 0.11,
        sheenAlpha: 0.1,
        outerGlowAlpha: 0.2,
        outlineAlpha: 0.22,
        pulseStrength: 0.045,
        pulseDurationMs: 2450,
        trailAlpha: 0,
        trailScale: 1,
        trailDurationMs: 0,
    },
    topaz: {
        primary: 0xffb65f,
        secondary: 0xffe4b8,
        stroke: 0xfff1d7,
        shadow: 0x6b3d11,
        glow: 0xffa44f,
        fillBlend: 0.25,
        strokeBlend: 0.33,
        shadowBlend: 0.16,
        highlightBlend: 0.3,
        glowAlpha: 0.13,
        sheenAlpha: 0.12,
        outerGlowAlpha: 0.22,
        outlineAlpha: 0.24,
        pulseStrength: 0.055,
        pulseDurationMs: 2250,
        trailAlpha: 0,
        trailScale: 1,
        trailDurationMs: 0,
    },
    diamond: {
        primary: 0x2f66cf,
        secondary: 0x9fc7ff,
        stroke: 0xe4efff,
        shadow: 0x101f46,
        glow: 0x4c8fff,
        fillBlend: 0.28,
        strokeBlend: 0.36,
        shadowBlend: 0.18,
        highlightBlend: 0.33,
        glowAlpha: 0.15,
        sheenAlpha: 0.13,
        outerGlowAlpha: 0.24,
        outlineAlpha: 0.28,
        pulseStrength: 0.065,
        pulseDurationMs: 2050,
        trailAlpha: 0.15,
        trailScale: 1.05,
        trailDurationMs: 980,
    },
    obsidian: {
        primary: 0x2c2f38,
        secondary: 0xc7cddd,
        stroke: 0xeaeeff,
        shadow: 0x080a0f,
        glow: 0x8d9eff,
        fillBlend: 0.3,
        strokeBlend: 0.38,
        shadowBlend: 0.21,
        highlightBlend: 0.34,
        glowAlpha: 0.15,
        sheenAlpha: 0.12,
        outerGlowAlpha: 0.23,
        outlineAlpha: 0.28,
        pulseStrength: 0.06,
        pulseDurationMs: 2150,
        trailAlpha: 0.17,
        trailScale: 1.08,
        trailDurationMs: 920,
    },
    godly: {
        primary: 0xeaf4ff,
        secondary: 0xffffff,
        stroke: 0xfafcff,
        shadow: 0x8e9daf,
        glow: 0xe3f2ff,
        fillBlend: 0.32,
        strokeBlend: 0.4,
        shadowBlend: 0.18,
        highlightBlend: 0.36,
        glowAlpha: 0.17,
        sheenAlpha: 0.15,
        outerGlowAlpha: 0.28,
        outlineAlpha: 0.34,
        pulseStrength: 0.085,
        pulseDurationMs: 1850,
        trailAlpha: 0.2,
        trailScale: 1.14,
        trailDurationMs: 840,
    },
};

const LEADERBOARD_SKIN_DEFINITIONS: SkinDefinition[] = [
    {
        id: 'leaderboard_first',
        title: 'World Champion',
        shortTitle: 'Champion',
        family: 'leaderboard',
        unlockText: 'Finish #1 on any global Steam leaderboard.',
        summary: 'A radiant crown-tier leaderboard finish with white-hot gold, royal blue edging, and maximum prestige shimmer.',
        palette: {
            primary: 0xffd96b,
            secondary: 0xffffff,
            stroke: 0xfff5cb,
            shadow: 0x2d1907,
            glow: 0xffef8a,
            fillBlend: 0.38,
            strokeBlend: 0.48,
            shadowBlend: 0.2,
            highlightBlend: 0.4,
            glowAlpha: 0.21,
            sheenAlpha: 0.18,
            outerGlowAlpha: 0.34,
            outlineAlpha: 0.42,
            pulseStrength: 0.105,
            pulseDurationMs: 1580,
            trailAlpha: 0.24,
            trailScale: 1.24,
            trailDurationMs: 730,
        },
    },
    {
        id: 'leaderboard_second',
        title: 'Silver Vanguard',
        shortTitle: 'Silver',
        family: 'leaderboard',
        unlockText: 'Finish #2 on any global Steam leaderboard.',
        summary: 'A cold silver podium finish with blue-white gleam, crisp outlines, and a clean elite commander trail.',
        palette: {
            primary: 0xdce8ff,
            secondary: 0xffffff,
            stroke: 0xf5fbff,
            shadow: 0x33465f,
            glow: 0xc6e5ff,
            fillBlend: 0.34,
            strokeBlend: 0.44,
            shadowBlend: 0.18,
            highlightBlend: 0.36,
            glowAlpha: 0.18,
            sheenAlpha: 0.15,
            outerGlowAlpha: 0.29,
            outlineAlpha: 0.36,
            pulseStrength: 0.085,
            pulseDurationMs: 1760,
            trailAlpha: 0.2,
            trailScale: 1.16,
            trailDurationMs: 800,
        },
    },
    {
        id: 'leaderboard_third',
        title: 'Bronze Warlord',
        shortTitle: 'Bronze',
        family: 'leaderboard',
        unlockText: 'Finish #3 on any global Steam leaderboard.',
        summary: 'A molten bronze podium finish with ember seams, smoky depth, and a proud battle-worn glow.',
        palette: {
            primary: 0xc87935,
            secondary: 0xffd49a,
            stroke: 0xffe4b8,
            shadow: 0x46230f,
            glow: 0xff954d,
            fillBlend: 0.32,
            strokeBlend: 0.4,
            shadowBlend: 0.19,
            highlightBlend: 0.33,
            glowAlpha: 0.17,
            sheenAlpha: 0.14,
            outerGlowAlpha: 0.26,
            outlineAlpha: 0.32,
            pulseStrength: 0.076,
            pulseDurationMs: 1900,
            trailAlpha: 0.18,
            trailScale: 1.12,
            trailDurationMs: 860,
        },
    },
    {
        id: 'leaderboard_top10',
        title: 'Top Ten Contender',
        shortTitle: 'Top 10',
        family: 'leaderboard',
        unlockText: 'Finish #4-#10 on any global Steam leaderboard.',
        summary: 'A blue-and-gold leaderboard contender finish for commanders who break into the global top ten.',
        palette: {
            primary: 0x4da1ff,
            secondary: 0xffd772,
            stroke: 0xeaf5ff,
            shadow: 0x10233d,
            glow: 0x69c7ff,
            fillBlend: 0.29,
            strokeBlend: 0.36,
            shadowBlend: 0.18,
            highlightBlend: 0.32,
            glowAlpha: 0.15,
            sheenAlpha: 0.12,
            outerGlowAlpha: 0.24,
            outlineAlpha: 0.3,
            pulseStrength: 0.065,
            pulseDurationMs: 2060,
            trailAlpha: 0.16,
            trailScale: 1.08,
            trailDurationMs: 920,
        },
    },
];

const DEFAULT_SKIN_DEFINITION: SkinDefinition = {
    id: 'default',
    title: 'Standard Issue',
    shortTitle: 'Default',
    family: 'standard',
    unlockText: 'Available immediately.',
    summary: 'Classic battlefield finish with no unlock requirement.',
    palette: {
        primary: 0xffffff,
        secondary: 0xffffff,
        stroke: 0xffffff,
        shadow: 0x09131b,
        glow: 0xffffff,
        fillBlend: 0,
        strokeBlend: 0,
        shadowBlend: 0,
        highlightBlend: 0,
        glowAlpha: 0,
        sheenAlpha: 0,
        outerGlowAlpha: 0,
        outlineAlpha: 0,
        pulseStrength: 0,
        pulseDurationMs: 0,
        trailAlpha: 0,
        trailScale: 1,
        trailDurationMs: 0,
    },
};

const createRankedSkinDefinition = (rank: RankedSkinRank): SkinDefinition => ({
    id: rank,
    title: RANK_LABELS[rank],
    shortTitle: RANK_LABELS[rank],
    family: 'ranked',
    rank,
    unlockText: `Win a ranked season in ${RANK_LABELS[rank]} (I, II, or III) in the full game.`,
    summary: RANK_SUMMARIES[rank],
    palette: RANK_PALETTES[rank],
});

const RUBY_SKIN_DEFINITION: SkinDefinition = {
    id: 'ruby',
    title: 'Ruby Mastery',
    shortTitle: 'Ruby',
    family: 'achievement',
    unlockText: 'Unlock every achievement in the demo.',
    summary: 'Neon ruby-red mastery finish for full demo completion, tuned to stand beside Godly without overpowering unit readability.',
    palette: {
        primary: 0xff4a5f,
        secondary: 0xffbcc6,
        stroke: 0xffdde3,
        shadow: 0x52131a,
        glow: 0xff5f72,
        fillBlend: 0.32,
        strokeBlend: 0.42,
        shadowBlend: 0.18,
        highlightBlend: 0.34,
        glowAlpha: 0.18,
        sheenAlpha: 0.16,
        outerGlowAlpha: 0.29,
        outlineAlpha: 0.36,
        pulseStrength: 0.09,
        pulseDurationMs: 1780,
        trailAlpha: 0.22,
        trailScale: 1.16,
        trailDurationMs: 820,
    },
};

const DEVELOPER_SKIN_DEFINITION: SkinDefinition = {
    id: 'developer',
    title: 'Developer',
    shortTitle: 'Developer',
    family: 'developer',
    unlockText: 'Reserved for the lead developer account only.',
    summary: 'Rainbow developer prestige that constantly fades through the full spectrum. It sits above Ruby and Godly and stays hidden from normal players.',
    palette: {
        primary: 0xff4fd8,
        secondary: 0x79fff2,
        stroke: 0xffffff,
        shadow: 0x171133,
        glow: 0xfff06b,
        fillBlend: 0.36,
        strokeBlend: 0.46,
        shadowBlend: 0.18,
        highlightBlend: 0.38,
        glowAlpha: 0.2,
        sheenAlpha: 0.17,
        outerGlowAlpha: 0.33,
        outlineAlpha: 0.4,
        pulseStrength: 0.105,
        pulseDurationMs: 1680,
        trailAlpha: 0.25,
        trailScale: 1.22,
        trailDurationMs: 760,
    },
};

export const SKIN_DEFINITIONS: SkinDefinition[] = [
    DEFAULT_SKIN_DEFINITION,
    DEVELOPER_SKIN_DEFINITION,
    ...RANKED_SKIN_IDS.map((rank) => createRankedSkinDefinition(rank)),
    ...LEADERBOARD_SKIN_DEFINITIONS,
    RUBY_SKIN_DEFINITION,
];

export const SKIN_DEFINITIONS_BY_ID: Record<SkinId, SkinDefinition> = SKIN_DEFINITIONS.reduce((acc, definition) => {
    acc[definition.id] = definition;
    return acc;
}, {} as Record<SkinId, SkinDefinition>);

const VALID_SKIN_IDS = new Set<SkinId>(SKIN_DEFINITIONS.map((definition) => definition.id));

const LEGACY_SKIN_ID_MAP: Record<string, SkinId> = {
    gold_1: 'gold',
    gold_2: 'gold',
    gold_3: 'gold',
    platinum_1: 'platinum',
    platinum_2: 'platinum',
    platinum_3: 'platinum',
    topaz_1: 'topaz',
    topaz_2: 'topaz',
    topaz_3: 'topaz',
    diamond_1: 'diamond',
    diamond_2: 'diamond',
    diamond_3: 'diamond',
    obsidian_1: 'obsidian',
    obsidian_2: 'obsidian',
    obsidian_3: 'obsidian',
    godly_1: 'godly',
    godly_2: 'godly',
    godly_3: 'godly',
};

export const createDefaultPlayerSkinProfile = (): PlayerSkinProfile => ({
    version: 2,
    loadout: {
        unitSkinId: 'default',
        buildingSkinId: 'default',
    },
    earnedSeasonRewards: [],
    skinItemCounts: {},
    claimedLeaderboardRewards: {},
});

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const canonicalizeSkinId = (value: unknown): SkinId | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = LEGACY_SKIN_ID_MAP[value] || value;
    if (VALID_SKIN_IDS.has(normalized as SkinId)) {
        return normalized as SkinId;
    }

    return null;
};

const normalizeSkinId = (value: unknown, fallback: SkinId): SkinId => canonicalizeSkinId(value) || fallback;

export const normalizePlayerSkinProfile = (value: unknown): PlayerSkinProfile => {
    const defaults = createDefaultPlayerSkinProfile();
    if (!isObject(value)) return defaults;

    const rawLoadout = isObject(value.loadout) ? value.loadout : {};
    const rawRewards = Array.isArray(value.earnedSeasonRewards) ? value.earnedSeasonRewards : [];
    const rawSkinItemCounts = isObject(value.skinItemCounts) ? value.skinItemCounts : {};
    const rawClaimedLeaderboardRewards = isObject(value.claimedLeaderboardRewards) ? value.claimedLeaderboardRewards : {};
    const skinItemCounts: Partial<Record<SkinId, number>> = {};

    Object.entries(rawSkinItemCounts).forEach(([key, rawCount]) => {
        const skinId = canonicalizeSkinId(key);
        if (!skinId || skinId === 'default') return;
        const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
        if (Number.isFinite(count) && count > 0) {
            skinItemCounts[skinId] = Math.max(1, Math.floor(count));
        }
    });

    const earnedSeasonRewards = Array.from(new Set(
        rawRewards
            .map((entry) => canonicalizeSkinId(entry))
            .filter((entry): entry is SkinId => !!entry && entry !== 'default' && SKIN_DEFINITIONS_BY_ID[entry].family === 'ranked')
    ));

    earnedSeasonRewards.forEach((skinId) => {
        skinItemCounts[skinId] = Math.max(1, skinItemCounts[skinId] || 0);
    });

    return {
        version: typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : defaults.version,
        loadout: {
            unitSkinId: normalizeSkinId(rawLoadout.unitSkinId, defaults.loadout.unitSkinId),
            buildingSkinId: normalizeSkinId(rawLoadout.buildingSkinId, defaults.loadout.buildingSkinId),
            unitEnhancementLevel: typeof rawLoadout.unitEnhancementLevel === 'number' ? Math.max(0, Math.floor(rawLoadout.unitEnhancementLevel)) : 0,
            buildingEnhancementLevel: typeof rawLoadout.buildingEnhancementLevel === 'number' ? Math.max(0, Math.floor(rawLoadout.buildingEnhancementLevel)) : 0,
        },
        earnedSeasonRewards,
        skinItemCounts,
        claimedLeaderboardRewards: Object.fromEntries(
            Object.entries(rawClaimedLeaderboardRewards)
                .filter(([key, entry]) => key.length > 0 && typeof entry === 'string')
                .map(([key, entry]) => [key, entry as string])
        ) as Record<string, string>,
    };
};

export const getSkinCopyCount = (profile: PlayerSkinProfile, skinId: SkinId): number => {
    if (skinId === 'default') return 1;
    return Math.max(0, Math.floor(profile.skinItemCounts?.[skinId] || 0));
};

export const getSkinEnhancementLevelFromCopies = (copyCount: number): number => {
    if (copyCount < 3) return 0;
    return Math.max(0, Math.floor(copyCount / 3));
};

export const getSkinEnhancementLevel = (profile: PlayerSkinProfile, skinId: SkinId): number => (
    getSkinEnhancementLevelFromCopies(getSkinCopyCount(profile, skinId))
);

export const getSkinEnhancementLabel = (copyCount: number): string => {
    const level = getSkinEnhancementLevelFromCopies(copyCount);
    if (level <= 0) return copyCount > 0 ? `${copyCount} copy` : 'No copies';
    return `Enhancement +${level}`;
};

export const getRubySkinUnlocked = (unlockedAchievementCount: number, totalAchievementCount: number): boolean => (
    totalAchievementCount > 0 && unlockedAchievementCount >= totalAchievementCount
);

export const getUnlockedSkinIds = (
    profile: PlayerSkinProfile,
    unlockedAchievementCount: number,
    totalAchievementCount: number,
    hasDeveloperAccess: boolean = false
): Set<SkinId> => {
    const unlocked = new Set<SkinId>(['default']);

    if (hasDeveloperAccess) {
        unlocked.add('developer');
    }

    profile.earnedSeasonRewards.forEach((skinId) => {
        if (SKIN_DEFINITIONS_BY_ID[skinId]?.family === 'ranked') {
            unlocked.add(skinId);
        }
    });

    Object.entries(profile.skinItemCounts || {}).forEach(([rawSkinId, rawCount]) => {
        const skinId = canonicalizeSkinId(rawSkinId);
        if (!skinId || skinId === 'default' || skinId === 'developer') return;
        if ((rawCount || 0) > 0) {
            unlocked.add(skinId);
        }
    });

    if (getRubySkinUnlocked(unlockedAchievementCount, totalAchievementCount)) {
        unlocked.add('ruby');
    }

    return unlocked;
};

export const isSkinUnlocked = (skinId: SkinId, unlockedSkinIds: Set<SkinId>): boolean => unlockedSkinIds.has(skinId);

export const sanitizeSkinProfile = (
    profile: PlayerSkinProfile,
    unlockedSkinIds: Set<SkinId>
): PlayerSkinProfile => {
    const unitSkinId = unlockedSkinIds.has(profile.loadout.unitSkinId) ? profile.loadout.unitSkinId : 'default';
    const buildingSkinId = unlockedSkinIds.has(profile.loadout.buildingSkinId) ? profile.loadout.buildingSkinId : 'default';
    const skinItemCounts: Partial<Record<SkinId, number>> = {};

    Object.entries(profile.skinItemCounts || {}).forEach(([rawSkinId, rawCount]) => {
        const skinId = canonicalizeSkinId(rawSkinId);
        if (!skinId || skinId === 'default') return;
        const count = Math.floor(Number(rawCount));
        if (Number.isFinite(count) && count > 0) {
            skinItemCounts[skinId] = count;
        }
    });

    return {
        ...profile,
        loadout: {
            unitSkinId,
            buildingSkinId,
            unitEnhancementLevel: getSkinEnhancementLevelFromCopies(unitSkinId === 'default' ? 1 : skinItemCounts[unitSkinId] || 0),
            buildingEnhancementLevel: getSkinEnhancementLevelFromCopies(buildingSkinId === 'default' ? 1 : skinItemCounts[buildingSkinId] || 0),
        },
        earnedSeasonRewards: Array.from(new Set(
            profile.earnedSeasonRewards
                .map((skinId) => canonicalizeSkinId(skinId))
                .filter((skinId): skinId is SkinId => !!skinId && SKIN_DEFINITIONS_BY_ID[skinId]?.family === 'ranked')
        )),
        skinItemCounts,
        claimedLeaderboardRewards: { ...(profile.claimedLeaderboardRewards || {}) },
    };
};

export const STEAM_SKIN_ITEM_DEFS: Partial<Record<SkinId, SteamSkinItemDefinition>> = {
    gold: { itemDefId: 4100, storeBundle: 'ranked_gold_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    platinum: { itemDefId: 4101, storeBundle: 'ranked_platinum_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    topaz: { itemDefId: 4102, storeBundle: 'ranked_topaz_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    diamond: { itemDefId: 4103, storeBundle: 'ranked_diamond_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    obsidian: { itemDefId: 4104, storeBundle: 'ranked_obsidian_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    godly: { itemDefId: 4105, storeBundle: 'ranked_godly_skin', rarity: 'seasonal', tradable: true, marketable: false, notes: 'Ranked season reward item definition.' },
    ruby: { itemDefId: 4200, storeBundle: 'demo_ruby_mastery_skin', rarity: 'mastery', tradable: false, marketable: false, notes: 'Demo mastery achievement reward.' },
    leaderboard_first: { itemDefId: 4301, storeBundle: 'leaderboard_world_champion_skin', rarity: 'leaderboard', tradable: true, marketable: false, notes: 'Awarded for #1 on any global Steam leaderboard.' },
    leaderboard_second: { itemDefId: 4302, storeBundle: 'leaderboard_silver_vanguard_skin', rarity: 'leaderboard', tradable: true, marketable: false, notes: 'Awarded for #2 on any global Steam leaderboard.' },
    leaderboard_third: { itemDefId: 4303, storeBundle: 'leaderboard_bronze_warlord_skin', rarity: 'leaderboard', tradable: true, marketable: false, notes: 'Awarded for #3 on any global Steam leaderboard.' },
    leaderboard_top10: { itemDefId: 4310, storeBundle: 'leaderboard_top_ten_skin', rarity: 'leaderboard', tradable: true, marketable: false, notes: 'Awarded for #4-#10 on any global Steam leaderboard.' },
    developer: { itemDefId: 4999, storeBundle: 'developer_rainbow_skin', rarity: 'creator', tradable: false, marketable: false, notes: 'Hidden creator-only skin. Do not expose in public store lists.' },
};

export const toCssHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export const getSkinPreviewStyle = (skinId: SkinId) => {
    const palette = SKIN_DEFINITIONS_BY_ID[skinId]?.palette || DEFAULT_SKIN_DEFINITION.palette;
    return {
        '--skin-primary': toCssHex(palette.primary),
        '--skin-secondary': toCssHex(palette.secondary),
        '--skin-stroke': toCssHex(palette.stroke),
        '--skin-shadow': toCssHex(palette.shadow),
        '--skin-glow': toCssHex(palette.glow),
        '--skin-glow-alpha': `${palette.glowAlpha}`,
        '--skin-outline-alpha': `${palette.outlineAlpha}`,
        '--skin-pulse-strength': `${palette.pulseStrength}`,
        '--skin-pulse-ms': `${palette.pulseDurationMs}ms`,
        '--skin-sheen-alpha': `${palette.sheenAlpha}`,
        '--skin-trail-alpha': `${palette.trailAlpha}`,
        '--skin-trail-scale': `${palette.trailScale}`,
        '--skin-trail-ms': `${palette.trailDurationMs}ms`,
    } as Record<string, string>;
};
