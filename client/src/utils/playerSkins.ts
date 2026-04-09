export type SkinFamily = 'standard' | 'ranked' | 'achievement' | 'developer';
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
}

export interface PlayerSkinProfile {
    version: number;
    loadout: SkinLoadout;
    earnedSeasonRewards: SkinId[];
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
    summary: 'Neon emerald developer finish with the strongest command glow and premium motion trail. Hidden from normal players.',
    palette: {
        primary: 0x33d17a,
        secondary: 0xc7ffe2,
        stroke: 0xe8fff1,
        shadow: 0x0b2e1f,
        glow: 0x4eff95,
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
    version: 1,
    loadout: {
        unitSkinId: 'default',
        buildingSkinId: 'default',
    },
    earnedSeasonRewards: [],
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

    return {
        version: typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : defaults.version,
        loadout: {
            unitSkinId: normalizeSkinId(rawLoadout.unitSkinId, defaults.loadout.unitSkinId),
            buildingSkinId: normalizeSkinId(rawLoadout.buildingSkinId, defaults.loadout.buildingSkinId),
        },
        earnedSeasonRewards: Array.from(new Set(
            rawRewards
                .map((entry) => canonicalizeSkinId(entry))
                .filter((entry): entry is SkinId => !!entry && entry !== 'default' && SKIN_DEFINITIONS_BY_ID[entry].family === 'ranked')
        )),
    };
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

    if (getRubySkinUnlocked(unlockedAchievementCount, totalAchievementCount)) {
        unlocked.add('ruby');
    }

    return unlocked;
};

export const isSkinUnlocked = (skinId: SkinId, unlockedSkinIds: Set<SkinId>): boolean => unlockedSkinIds.has(skinId);

export const sanitizeSkinProfile = (
    profile: PlayerSkinProfile,
    unlockedSkinIds: Set<SkinId>
): PlayerSkinProfile => ({
    ...profile,
    loadout: {
        unitSkinId: unlockedSkinIds.has(profile.loadout.unitSkinId) ? profile.loadout.unitSkinId : 'default',
        buildingSkinId: unlockedSkinIds.has(profile.loadout.buildingSkinId) ? profile.loadout.buildingSkinId : 'default',
    },
    earnedSeasonRewards: Array.from(new Set(
        profile.earnedSeasonRewards
            .map((skinId) => canonicalizeSkinId(skinId))
            .filter((skinId): skinId is SkinId => !!skinId && SKIN_DEFINITIONS_BY_ID[skinId]?.family === 'ranked')
    )),
});

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
