import type { MatchStatisticsSummary, PlayerStatistics } from './playerStatistics';
import type { SteamLeaderboardDisplayType, SteamLeaderboardSortMethod } from '../services/steam';

export type LeaderboardMetricId =
    | 'lifetime_wins'
    | 'ranked_peak'
    | 'fastest_multiplayer_win'
    | 'fastest_ranked_win'
    | 'fastest_campaign_d10_win';

export type SteamLeaderboardDefinition = {
    id: LeaderboardMetricId;
    steamName: string;
    title: string;
    description: string;
    sortMethod: SteamLeaderboardSortMethod;
    displayType: SteamLeaderboardDisplayType;
    scoreLabel: string;
};

export type LeaderboardUploadCandidate = {
    definition: SteamLeaderboardDefinition;
    score: number;
};

export const STEAM_LEADERBOARD_DEFINITIONS: SteamLeaderboardDefinition[] = [
    {
        id: 'lifetime_wins',
        steamName: 'LB_LIFETIME_WINS',
        title: 'Most Wins',
        description: 'Highest total lifetime wins across all supported modes.',
        sortMethod: 'descending',
        displayType: 'numeric',
        scoreLabel: 'Wins',
    },
    {
        id: 'ranked_peak',
        steamName: 'LB_RANKED_PEAK_RP',
        title: 'Highest Ranked Peak',
        description: 'Highest ranked points reached in Steam ranked quick match.',
        sortMethod: 'descending',
        displayType: 'numeric',
        scoreLabel: 'Ranked Points',
    },
    {
        id: 'fastest_multiplayer_win',
        steamName: 'LB_FASTEST_MULTIPLAYER_WIN_MS',
        title: 'Fastest Multiplayer Win',
        description: 'Shortest completed Steam multiplayer win time.',
        sortMethod: 'ascending',
        displayType: 'time_milliseconds',
        scoreLabel: 'Time',
    },
    {
        id: 'fastest_ranked_win',
        steamName: 'LB_FASTEST_RANKED_WIN_MS',
        title: 'Fastest Ranked Win',
        description: 'Shortest ranked quick match victory time.',
        sortMethod: 'ascending',
        displayType: 'time_milliseconds',
        scoreLabel: 'Time',
    },
    {
        id: 'fastest_campaign_d10_win',
        steamName: 'LB_FASTEST_CAMPAIGN_D10_WIN_MS',
        title: 'Fastest Campaign D10 Win',
        description: 'Fastest campaign win on difficulty 10.',
        sortMethod: 'ascending',
        displayType: 'time_milliseconds',
        scoreLabel: 'Time',
    },
];

export const STEAM_LEADERBOARD_BY_ID = STEAM_LEADERBOARD_DEFINITIONS.reduce<Record<LeaderboardMetricId, SteamLeaderboardDefinition>>((acc, definition) => {
    acc[definition.id] = definition;
    return acc;
}, {} as Record<LeaderboardMetricId, SteamLeaderboardDefinition>);

const formatMilliseconds = (milliseconds: number): string => {
    const clamped = Math.max(0, Math.trunc(milliseconds));
    const totalSeconds = Math.floor(clamped / 1000);
    const ms = clamped % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const formatSeconds = (seconds: number): string => {
    return formatMilliseconds(Math.max(0, Math.trunc(seconds * 1000)));
};

export const formatLeaderboardScore = (score: number, displayType: SteamLeaderboardDisplayType): string => {
    switch (displayType) {
        case 'time_milliseconds':
            return formatMilliseconds(score);
        case 'time_seconds':
            return formatSeconds(score);
        default:
            return Math.trunc(score).toLocaleString();
    }
};

export const buildLeaderboardUploadCandidates = (
    statistics: PlayerStatistics,
    summary: MatchStatisticsSummary,
    matchDurationMs: number | null,
): LeaderboardUploadCandidate[] => {
    const updates = new Map<LeaderboardMetricId, LeaderboardUploadCandidate>();
    const add = (id: LeaderboardMetricId, score: number) => {
        if (!Number.isFinite(score)) return;
        const normalized = Math.max(0, Math.round(score));
        updates.set(id, {
            definition: STEAM_LEADERBOARD_BY_ID[id],
            score: normalized,
        });
    };

    add('lifetime_wins', statistics.lifetime.wins);
    add('ranked_peak', statistics.rankedProgress.bestPoints);

    if (summary.result === 'win' && matchDurationMs && matchDurationMs > 0) {
        if (summary.source === 'steam' && !summary.ranked) {
            add('fastest_multiplayer_win', matchDurationMs);
        }

        if (summary.ranked) {
            add('fastest_ranked_win', matchDurationMs);
        }

        if (summary.source === 'campaign' && (summary.maxBotDifficulty || 0) >= 10) {
            add('fastest_campaign_d10_win', matchDurationMs);
        }
    }

    return Array.from(updates.values());
};
