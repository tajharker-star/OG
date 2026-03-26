import type { PlayerStatistics } from './playerStatistics';
import { bucketMatches } from './playerStatistics';

export type AchievementCategory = 'General' | 'Campaign' | 'Custom' | 'Multiplayer' | 'Co-op' | 'Ranked';

export interface AchievementUnlockState {
    version: number;
    unlockedAtById: Record<string, string>;
}

export interface AchievementContext {
    statistics: PlayerStatistics;
}

export interface AchievementDefinition {
    id: string;
    title: string;
    description: string;
    category: AchievementCategory;
    target: number;
    getCurrent: (context: AchievementContext) => number;
}

export interface EvaluatedAchievement extends AchievementDefinition {
    current: number;
    unlocked: boolean;
    unlockedAt: string | null;
    progress: number;
}

const lifetimeMatches = (context: AchievementContext) => bucketMatches(context.statistics.lifetime);
const lifetimeWins = (context: AchievementContext) => context.statistics.lifetime.wins;
const campaignMatches = (context: AchievementContext) => bucketMatches(context.statistics.campaign);
const campaignWins = (context: AchievementContext) => context.statistics.campaign.wins;
const customMatches = (context: AchievementContext) => bucketMatches(context.statistics.custom);
const customWins = (context: AchievementContext) => context.statistics.custom.wins;
const multiplayerMatches = (context: AchievementContext) => bucketMatches(context.statistics.multiplayer);
const multiplayerWins = (context: AchievementContext) => context.statistics.multiplayer.wins;
const coopWins = (context: AchievementContext) => context.statistics.coop.wins;
const rankedMatches = (context: AchievementContext) => bucketMatches(context.statistics.ranked);
const rankedWins = (context: AchievementContext) => context.statistics.ranked.wins;
const lifetimeBestWinStreak = (context: AchievementContext) => context.statistics.lifetime.bestWinStreak;

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
    {
        id: 'FIRST_DEPLOYMENT',
        title: 'First Deployment',
        description: 'Play your first match.',
        category: 'General',
        target: 1,
        getCurrent: lifetimeMatches,
    },
    {
        id: 'FIELD_TESTED',
        title: 'Field Tested',
        description: 'Play 10 matches.',
        category: 'General',
        target: 10,
        getCurrent: lifetimeMatches,
    },
    {
        id: 'WAR_MACHINE',
        title: 'War Machine',
        description: 'Play 50 matches.',
        category: 'General',
        target: 50,
        getCurrent: lifetimeMatches,
    },
    {
        id: 'FIRST_VICTORY',
        title: 'First Victory',
        description: 'Win your first match.',
        category: 'General',
        target: 1,
        getCurrent: lifetimeWins,
    },
    {
        id: 'SEASONED_WINNER',
        title: 'Seasoned Winner',
        description: 'Win 10 matches.',
        category: 'General',
        target: 10,
        getCurrent: lifetimeWins,
    },
    {
        id: 'DOMINATOR',
        title: 'Dominator',
        description: 'Win 50 matches.',
        category: 'General',
        target: 50,
        getCurrent: lifetimeWins,
    },
    {
        id: 'STAYING_POWER',
        title: 'Staying Power',
        description: 'Reach a 3-match win streak.',
        category: 'General',
        target: 3,
        getCurrent: lifetimeBestWinStreak,
    },
    {
        id: 'LEGENDARY_STREAK',
        title: 'Legendary Streak',
        description: 'Reach a 7-match win streak.',
        category: 'General',
        target: 7,
        getCurrent: lifetimeBestWinStreak,
    },
    {
        id: 'CAMPAIGN_INITIATE',
        title: 'Campaign Initiate',
        description: 'Complete your first campaign battle.',
        category: 'Campaign',
        target: 1,
        getCurrent: campaignMatches,
    },
    {
        id: 'CAMPAIGN_CONQUEROR',
        title: 'Campaign Conqueror',
        description: 'Win 5 campaign battles.',
        category: 'Campaign',
        target: 5,
        getCurrent: campaignWins,
    },
    {
        id: 'CAMPAIGN_LEGEND',
        title: 'Campaign Legend',
        description: 'Win 15 campaign battles.',
        category: 'Campaign',
        target: 15,
        getCurrent: campaignWins,
    },
    {
        id: 'SKIRMISH_STARTER',
        title: 'Skirmish Starter',
        description: 'Play your first custom match.',
        category: 'Custom',
        target: 1,
        getCurrent: customMatches,
    },
    {
        id: 'SKIRMISH_SUPREME',
        title: 'Skirmish Supreme',
        description: 'Win 10 custom matches.',
        category: 'Custom',
        target: 10,
        getCurrent: customWins,
    },
    {
        id: 'NETWORK_INITIATE',
        title: 'Network Initiate',
        description: 'Play your first multiplayer match.',
        category: 'Multiplayer',
        target: 1,
        getCurrent: multiplayerMatches,
    },
    {
        id: 'ONLINE_WARLORD',
        title: 'Online Warlord',
        description: 'Win 10 multiplayer matches.',
        category: 'Multiplayer',
        target: 10,
        getCurrent: multiplayerWins,
    },
    {
        id: 'ONLINE_LEGEND',
        title: 'Online Legend',
        description: 'Win 25 multiplayer matches.',
        category: 'Multiplayer',
        target: 25,
        getCurrent: multiplayerWins,
    },
    {
        id: 'COOP_WINGMAN',
        title: 'Co-op Wingman',
        description: 'Win your first co-op or PvE match.',
        category: 'Co-op',
        target: 1,
        getCurrent: coopWins,
    },
    {
        id: 'PVE_COMMANDER',
        title: 'PvE Commander',
        description: 'Win 10 co-op or PvE matches.',
        category: 'Co-op',
        target: 10,
        getCurrent: coopWins,
    },
    {
        id: 'RANKED_ROOKIE',
        title: 'Ranked Rookie',
        description: 'Play your first ranked match.',
        category: 'Ranked',
        target: 1,
        getCurrent: rankedMatches,
    },
    {
        id: 'RANKED_CONTENDER',
        title: 'Ranked Contender',
        description: 'Win 5 ranked matches.',
        category: 'Ranked',
        target: 5,
        getCurrent: rankedWins,
    },
];

export const createDefaultAchievementUnlockState = (): AchievementUnlockState => ({
    version: 1,
    unlockedAtById: {},
});

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const normalizeAchievementUnlockState = (value: unknown): AchievementUnlockState => {
    const defaults = createDefaultAchievementUnlockState();
    if (!isObject(value)) return defaults;

    const unlockedAtById = isObject(value.unlockedAtById) ? value.unlockedAtById : {};
    const normalizedEntries = Object.entries(unlockedAtById).reduce<Record<string, string>>((acc, [key, entryValue]) => {
        if (typeof entryValue === 'string' && entryValue) {
            acc[key] = entryValue;
        }
        return acc;
    }, {});

    return {
        version: typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : defaults.version,
        unlockedAtById: normalizedEntries,
    };
};

export const evaluateAchievements = (
    context: AchievementContext,
    unlockState: AchievementUnlockState
): EvaluatedAchievement[] => {
    return ACHIEVEMENT_DEFINITIONS.map(definition => {
        const current = definition.getCurrent(context);
        const unlockedAt = unlockState.unlockedAtById[definition.id] || null;
        const unlocked = !!unlockedAt || current >= definition.target;
        return {
            ...definition,
            current,
            unlocked,
            unlockedAt,
            progress: Math.max(0, Math.min(100, (current / definition.target) * 100)),
        };
    });
};

export const unlockEligibleAchievements = (
    unlockState: AchievementUnlockState,
    context: AchievementContext,
    unlockedAt: string = new Date().toISOString()
): { nextState: AchievementUnlockState; newlyUnlocked: string[] } => {
    const nextState: AchievementUnlockState = {
        ...unlockState,
        unlockedAtById: { ...unlockState.unlockedAtById },
    };
    const newlyUnlocked: string[] = [];

    for (const definition of ACHIEVEMENT_DEFINITIONS) {
        const current = definition.getCurrent(context);
        if (current < definition.target) continue;
        if (nextState.unlockedAtById[definition.id]) continue;

        nextState.unlockedAtById[definition.id] = unlockedAt;
        newlyUnlocked.push(definition.id);
    }

    return { nextState, newlyUnlocked };
};
