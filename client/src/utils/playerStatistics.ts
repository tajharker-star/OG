export type MatchSource = 'campaign' | 'custom' | 'lan' | 'steam';
export type MatchResult = 'win' | 'loss' | 'draw';
export type StatsBucketKey = 'lifetime' | 'campaign' | 'custom' | 'multiplayer' | 'coop' | 'ranked';

export interface StatsBucket {
    wins: number;
    losses: number;
    draws: number;
    currentWinStreak: number;
    bestWinStreak: number;
}

export interface MatchStatisticsSummary {
    result: MatchResult;
    source: MatchSource;
    humanPlayers: number;
    botPlayers: number;
    ranked?: boolean;
    coop?: boolean;
}

export interface PlayerStatistics {
    version: number;
    updatedAt: string | null;
    lastPlayedAt: string | null;
    lastResult: MatchResult | null;
    lastSource: MatchSource | null;
    lifetime: StatsBucket;
    campaign: StatsBucket;
    custom: StatsBucket;
    multiplayer: StatsBucket;
    coop: StatsBucket;
    ranked: StatsBucket;
    steamSync: {
        available: boolean;
        lastAttemptAt: string | null;
        lastSuccessAt: string | null;
        lastError: string | null;
    };
}

export const STEAM_STAT_KEYS = {
    lifetimeWins: 'STAT_LIFETIME_WINS',
    lifetimeLosses: 'STAT_LIFETIME_LOSSES',
    lifetimeDraws: 'STAT_LIFETIME_DRAWS',
    lifetimeBestWinStreak: 'STAT_LIFETIME_BEST_WIN_STREAK',
    campaignWins: 'STAT_CAMPAIGN_WINS',
    campaignLosses: 'STAT_CAMPAIGN_LOSSES',
    customWins: 'STAT_CUSTOM_WINS',
    customLosses: 'STAT_CUSTOM_LOSSES',
    multiplayerWins: 'STAT_MULTIPLAYER_WINS',
    multiplayerLosses: 'STAT_MULTIPLAYER_LOSSES',
    multiplayerDraws: 'STAT_MULTIPLAYER_DRAWS',
    coopWins: 'STAT_COOP_WINS',
    coopLosses: 'STAT_COOP_LOSSES',
    rankedWins: 'STAT_RANKED_WINS',
    rankedLosses: 'STAT_RANKED_LOSSES',
    rankedBestWinStreak: 'STAT_RANKED_BEST_WIN_STREAK',
} as const;

export type SteamStatPayload = Record<string, number>;
export type SteamStatSnapshot = Record<string, number | null>;

const createBucket = (): StatsBucket => ({
    wins: 0,
    losses: 0,
    draws: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
});

export const createDefaultPlayerStatistics = (): PlayerStatistics => ({
    version: 1,
    updatedAt: null,
    lastPlayedAt: null,
    lastResult: null,
    lastSource: null,
    lifetime: createBucket(),
    campaign: createBucket(),
    custom: createBucket(),
    multiplayer: createBucket(),
    coop: createBucket(),
    ranked: createBucket(),
    steamSync: {
        available: false,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
    },
});

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const readNumber = (value: unknown, fallback: number = 0): number => {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const normalizeBucket = (value: unknown): StatsBucket => {
    if (!isObject(value)) return createBucket();

    return {
        wins: readNumber(value.wins),
        losses: readNumber(value.losses),
        draws: readNumber(value.draws),
        currentWinStreak: readNumber(value.currentWinStreak),
        bestWinStreak: readNumber(value.bestWinStreak),
    };
};

export const normalizePlayerStatistics = (value: unknown): PlayerStatistics => {
    const defaults = createDefaultPlayerStatistics();
    if (!isObject(value)) return defaults;

    const steamSync = isObject(value.steamSync) ? value.steamSync : {};

    return {
        version: readNumber(value.version, defaults.version),
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : defaults.updatedAt,
        lastPlayedAt: typeof value.lastPlayedAt === 'string' ? value.lastPlayedAt : defaults.lastPlayedAt,
        lastResult: value.lastResult === 'win' || value.lastResult === 'loss' || value.lastResult === 'draw' ? value.lastResult : defaults.lastResult,
        lastSource: value.lastSource === 'campaign' || value.lastSource === 'custom' || value.lastSource === 'lan' || value.lastSource === 'steam' ? value.lastSource : defaults.lastSource,
        lifetime: normalizeBucket(value.lifetime),
        campaign: normalizeBucket(value.campaign),
        custom: normalizeBucket(value.custom),
        multiplayer: normalizeBucket(value.multiplayer),
        coop: normalizeBucket(value.coop),
        ranked: normalizeBucket(value.ranked),
        steamSync: {
            available: typeof steamSync.available === 'boolean' ? steamSync.available : defaults.steamSync.available,
            lastAttemptAt: typeof steamSync.lastAttemptAt === 'string' ? steamSync.lastAttemptAt : defaults.steamSync.lastAttemptAt,
            lastSuccessAt: typeof steamSync.lastSuccessAt === 'string' ? steamSync.lastSuccessAt : defaults.steamSync.lastSuccessAt,
            lastError: typeof steamSync.lastError === 'string' ? steamSync.lastError : defaults.steamSync.lastError,
        },
    };
};

const applyResultToBucket = (bucket: StatsBucket, result: MatchResult): StatsBucket => {
    if (result === 'win') {
        const currentWinStreak = bucket.currentWinStreak + 1;
        return {
            ...bucket,
            wins: bucket.wins + 1,
            currentWinStreak,
            bestWinStreak: Math.max(bucket.bestWinStreak, currentWinStreak),
        };
    }

    if (result === 'loss') {
        return {
            ...bucket,
            losses: bucket.losses + 1,
            currentWinStreak: 0,
        };
    }

    return {
        ...bucket,
        draws: bucket.draws + 1,
        currentWinStreak: 0,
    };
};

export const bucketMatches = (bucket: StatsBucket): number => bucket.wins + bucket.losses + bucket.draws;

export const recordMatchResult = (
    current: PlayerStatistics,
    summary: MatchStatisticsSummary,
    playedAt: string = new Date().toISOString()
): PlayerStatistics => {
    const next: PlayerStatistics = {
        ...current,
        updatedAt: playedAt,
        lastPlayedAt: playedAt,
        lastResult: summary.result,
        lastSource: summary.source,
        lifetime: applyResultToBucket(current.lifetime, summary.result),
        campaign: current.campaign,
        custom: current.custom,
        multiplayer: current.multiplayer,
        coop: current.coop,
        ranked: current.ranked,
    };

    if (summary.source === 'campaign') {
        next.campaign = applyResultToBucket(current.campaign, summary.result);
    }

    if (summary.source === 'custom') {
        next.custom = applyResultToBucket(current.custom, summary.result);
    }

    if (summary.source === 'lan' || summary.source === 'steam') {
        next.multiplayer = applyResultToBucket(current.multiplayer, summary.result);
    }

    if (summary.coop) {
        next.coop = applyResultToBucket(current.coop, summary.result);
    }

    if (summary.ranked) {
        next.ranked = applyResultToBucket(current.ranked, summary.result);
    }

    return next;
};

export const withSteamSyncState = (
    current: PlayerStatistics,
    patch: Partial<PlayerStatistics['steamSync']>
): PlayerStatistics => ({
    ...current,
    updatedAt: patch.lastAttemptAt || current.updatedAt,
    steamSync: {
        ...current.steamSync,
        ...patch,
    },
});

export const toSteamStatPayload = (statistics: PlayerStatistics): SteamStatPayload => ({
    [STEAM_STAT_KEYS.lifetimeWins]: statistics.lifetime.wins,
    [STEAM_STAT_KEYS.lifetimeLosses]: statistics.lifetime.losses,
    [STEAM_STAT_KEYS.lifetimeDraws]: statistics.lifetime.draws,
    [STEAM_STAT_KEYS.lifetimeBestWinStreak]: statistics.lifetime.bestWinStreak,
    [STEAM_STAT_KEYS.campaignWins]: statistics.campaign.wins,
    [STEAM_STAT_KEYS.campaignLosses]: statistics.campaign.losses,
    [STEAM_STAT_KEYS.customWins]: statistics.custom.wins,
    [STEAM_STAT_KEYS.customLosses]: statistics.custom.losses,
    [STEAM_STAT_KEYS.multiplayerWins]: statistics.multiplayer.wins,
    [STEAM_STAT_KEYS.multiplayerLosses]: statistics.multiplayer.losses,
    [STEAM_STAT_KEYS.multiplayerDraws]: statistics.multiplayer.draws,
    [STEAM_STAT_KEYS.coopWins]: statistics.coop.wins,
    [STEAM_STAT_KEYS.coopLosses]: statistics.coop.losses,
    [STEAM_STAT_KEYS.rankedWins]: statistics.ranked.wins,
    [STEAM_STAT_KEYS.rankedLosses]: statistics.ranked.losses,
    [STEAM_STAT_KEYS.rankedBestWinStreak]: statistics.ranked.bestWinStreak,
});

const mergeBucketValue = (localValue: number, steamValue: number | null | undefined): number => {
    if (steamValue === null || steamValue === undefined || !Number.isFinite(steamValue)) {
        return localValue;
    }
    return Math.max(localValue, steamValue);
};

export const mergeSteamStatistics = (
    current: PlayerStatistics,
    steamStats: SteamStatSnapshot,
    mergedAt: string = new Date().toISOString()
): PlayerStatistics => {
    const next = {
        ...current,
        updatedAt: mergedAt,
        lifetime: { ...current.lifetime },
        campaign: { ...current.campaign },
        custom: { ...current.custom },
        multiplayer: { ...current.multiplayer },
        coop: { ...current.coop },
        ranked: { ...current.ranked },
    };

    next.lifetime.wins = mergeBucketValue(next.lifetime.wins, steamStats[STEAM_STAT_KEYS.lifetimeWins]);
    next.lifetime.losses = mergeBucketValue(next.lifetime.losses, steamStats[STEAM_STAT_KEYS.lifetimeLosses]);
    next.lifetime.draws = mergeBucketValue(next.lifetime.draws, steamStats[STEAM_STAT_KEYS.lifetimeDraws]);
    next.lifetime.bestWinStreak = mergeBucketValue(next.lifetime.bestWinStreak, steamStats[STEAM_STAT_KEYS.lifetimeBestWinStreak]);

    next.campaign.wins = mergeBucketValue(next.campaign.wins, steamStats[STEAM_STAT_KEYS.campaignWins]);
    next.campaign.losses = mergeBucketValue(next.campaign.losses, steamStats[STEAM_STAT_KEYS.campaignLosses]);

    next.custom.wins = mergeBucketValue(next.custom.wins, steamStats[STEAM_STAT_KEYS.customWins]);
    next.custom.losses = mergeBucketValue(next.custom.losses, steamStats[STEAM_STAT_KEYS.customLosses]);

    next.multiplayer.wins = mergeBucketValue(next.multiplayer.wins, steamStats[STEAM_STAT_KEYS.multiplayerWins]);
    next.multiplayer.losses = mergeBucketValue(next.multiplayer.losses, steamStats[STEAM_STAT_KEYS.multiplayerLosses]);
    next.multiplayer.draws = mergeBucketValue(next.multiplayer.draws, steamStats[STEAM_STAT_KEYS.multiplayerDraws]);

    next.coop.wins = mergeBucketValue(next.coop.wins, steamStats[STEAM_STAT_KEYS.coopWins]);
    next.coop.losses = mergeBucketValue(next.coop.losses, steamStats[STEAM_STAT_KEYS.coopLosses]);

    next.ranked.wins = mergeBucketValue(next.ranked.wins, steamStats[STEAM_STAT_KEYS.rankedWins]);
    next.ranked.losses = mergeBucketValue(next.ranked.losses, steamStats[STEAM_STAT_KEYS.rankedLosses]);
    next.ranked.bestWinStreak = mergeBucketValue(next.ranked.bestWinStreak, steamStats[STEAM_STAT_KEYS.rankedBestWinStreak]);

    return next;
};
