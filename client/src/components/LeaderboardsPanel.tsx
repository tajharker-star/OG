import { useCallback, useEffect, useMemo, useState } from 'react';
import { steamService, type SteamLeaderboardSnapshotResult } from '../services/steam';
import {
    STEAM_LEADERBOARD_DEFINITIONS,
    formatLeaderboardScore,
    getLeaderboardSkinRewardForRank,
    isLeaderboardLiveInDemo,
    type LeaderboardMetricId,
    type SteamLeaderboardDefinition,
} from '../utils/steamLeaderboards';
import { SKIN_DEFINITIONS_BY_ID, type LeaderboardRewardClaim, type SkinId } from '../utils/playerSkins';
import { RankBadgeIcon } from './RankBadgeIcon';
import './LeaderboardsPanel.css';

type LeaderboardsPanelProps = {
    steamConnected: boolean;
    steamPersonaName?: string | null;
    claimedLeaderboardRewards?: Record<string, LeaderboardRewardClaim>;
    onLeaderboardRewardEligible?: (reward: {
        leaderboardId: LeaderboardMetricId;
        leaderboardTitle: string;
        rewardSkinId: SkinId;
        rank: number;
    }) => void;
};

const AUTO_REFRESH_MS = 12000;

type SnapshotById = Partial<Record<LeaderboardMetricId, SteamLeaderboardSnapshotResult>>;

const formatTimestamp = (value: string | null): string => {
    if (!value) return 'Not refreshed yet';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Not refreshed yet';
    return parsed.toLocaleTimeString();
};

const LeaderboardTable: React.FC<{
    definition: SteamLeaderboardDefinition;
    snapshot?: SteamLeaderboardSnapshotResult;
    loading: boolean;
}> = ({ definition, snapshot, loading }) => {
    const entries = snapshot?.entries || [];

    if (!isLeaderboardLiveInDemo(definition)) {
        return (
            <div className="leaderboards-panel__empty leaderboards-panel__empty--coming-soon">
                <strong>Coming Soon</strong>
                <span>{definition.comingSoonReason || 'This leaderboard will open in the full game.'}</span>
            </div>
        );
    }

    if (loading && entries.length === 0) {
        return <div className="leaderboards-panel__empty">Loading Steam leaderboard...</div>;
    }

    if (!snapshot?.success) {
        return (
            <div className="leaderboards-panel__empty">
                {snapshot?.error || 'Steam leaderboard data is not available yet.'}
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="leaderboards-panel__empty">
                No scores yet. Play a match and post the first score.
            </div>
        );
    }

    return (
        <div className="leaderboards-table-wrap">
            <div className="leaderboards-table" role="table" aria-label={definition.title}>
                <div className="leaderboards-row leaderboards-row--head" role="row">
                    <span role="columnheader">Rank</span>
                    <span role="columnheader">Player</span>
                    <span role="columnheader">{definition.scoreLabel}</span>
                </div>
                {entries.map((entry) => (
                    <div
                        className="leaderboards-row"
                        role="row"
                        key={`${definition.id}_${entry.rank}_${entry.steamId}`}
                    >
                        <span role="cell" className="leaderboards-rank-cell">
                            <RankBadgeIcon leaderboardRank={entry.rank} size="mini" title={`Rank ${entry.rank} badge`} />
                            #{entry.rank}
                        </span>
                        <span role="cell" title={entry.steamId}>{entry.name || entry.steamId}</span>
                        <span role="cell">{formatLeaderboardScore(entry.score, definition.displayType)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export function LeaderboardsPanel({ steamConnected, steamPersonaName, claimedLeaderboardRewards, onLeaderboardRewardEligible }: LeaderboardsPanelProps) {
    const [activeLeaderboardId, setActiveLeaderboardId] = useState<LeaderboardMetricId>('lifetime_wins');
    const [snapshotById, setSnapshotById] = useState<SnapshotById>({});
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    const activeDefinition = useMemo(
        () => STEAM_LEADERBOARD_DEFINITIONS.find((entry) => entry.id === activeLeaderboardId) || STEAM_LEADERBOARD_DEFINITIONS[0],
        [activeLeaderboardId]
    );
    const activeLeaderboardIsLive = isLeaderboardLiveInDemo(activeDefinition);

    const activeSnapshot = snapshotById[activeDefinition.id];
    const activeRewardSkinId = activeLeaderboardIsLive
        ? getLeaderboardSkinRewardForRank(activeSnapshot?.playerEntry?.rank)
        : null;
    const activeRewardDefinition = activeRewardSkinId ? SKIN_DEFINITIONS_BY_ID[activeRewardSkinId] : null;

    const loadLeaderboard = useCallback(async (leaderboard: SteamLeaderboardDefinition) => {
        if (!steamConnected || !steamService.isInitialized || !isLeaderboardLiveInDemo(leaderboard)) {
            return;
        }

        setIsLoading(true);
        setLastError(null);

        const result = await steamService.getLeaderboardSnapshot({
            name: leaderboard.steamName,
            topCount: 10,
            sortMethod: leaderboard.sortMethod,
            displayType: leaderboard.displayType,
        });

        setSnapshotById((previous) => ({
            ...previous,
            [leaderboard.id]: result,
        }));

        if (!result.success) {
            setLastError(result.error || 'Failed to refresh Steam leaderboard data.');
        }

        setLastUpdatedAt(new Date().toISOString());
        setIsLoading(false);
    }, [steamConnected]);

    useEffect(() => {
        if (!activeLeaderboardIsLive) {
            setIsLoading(false);
            setLastError(null);
            return;
        }

        void loadLeaderboard(activeDefinition);

        if (!steamConnected || !steamService.isInitialized) {
            return;
        }

        const timer = window.setInterval(() => {
            void loadLeaderboard(activeDefinition);
        }, AUTO_REFRESH_MS);

        return () => {
            window.clearInterval(timer);
        };
    }, [activeDefinition, activeLeaderboardIsLive, loadLeaderboard, steamConnected]);

    useEffect(() => {
        if (!steamConnected || !steamService.isInitialized) {
            return;
        }

        STEAM_LEADERBOARD_DEFINITIONS
            .filter(isLeaderboardLiveInDemo)
            .forEach((definition) => {
                void loadLeaderboard(definition);
            });
    }, [loadLeaderboard, steamConnected]);

    useEffect(() => {
        if (!onLeaderboardRewardEligible) {
            return;
        }

        STEAM_LEADERBOARD_DEFINITIONS.forEach((definition) => {
            if (!isLeaderboardLiveInDemo(definition)) {
                return;
            }

            const rank = snapshotById[definition.id]?.playerEntry?.rank;
            const rewardSkinId = getLeaderboardSkinRewardForRank(rank);
            if (!rewardSkinId || !rank) {
                return;
            }

            onLeaderboardRewardEligible({
                leaderboardId: definition.id,
                leaderboardTitle: definition.title,
                rewardSkinId,
                rank,
            });
        });
    }, [snapshotById, onLeaderboardRewardEligible, claimedLeaderboardRewards]);

    if (!steamConnected || !steamService.isInitialized) {
        return (
            <div className="leaderboards-panel">
                <div className="leaderboards-panel__empty">
                    Steam is required for global leaderboards. Launch from Steam to view live rankings.
                </div>
            </div>
        );
    }

    const playerEntry = activeSnapshot?.playerEntry || null;

    return (
        <div className="leaderboards-panel">
            <div className="leaderboards-toolbar">
                <div className="leaderboards-toolbar__identity">
                    <strong>{steamPersonaName || 'Commander'}</strong>
                    <span>Global Steam leaderboards • Auto-refresh every 12s</span>
                </div>
                <div className="leaderboards-toolbar__actions">
                    <button
                        type="button"
                        className="menu-btn menu-btn-main menu-btn-compact"
                        onClick={() => void loadLeaderboard(activeDefinition)}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="leaderboards-tabs" role="tablist" aria-label="Leaderboard Categories">
                {STEAM_LEADERBOARD_DEFINITIONS.map((definition) => (
                    <button
                        key={definition.id}
                        type="button"
                        role="tab"
                        aria-selected={activeLeaderboardId === definition.id}
                        className={`leaderboards-tab ${activeLeaderboardId === definition.id ? 'is-active' : ''}`}
                        onClick={() => setActiveLeaderboardId(definition.id)}
                    >
                        <strong>{definition.title}</strong>
                        <span>{isLeaderboardLiveInDemo(definition) ? definition.scoreLabel : 'Coming Soon'}</span>
                    </button>
                ))}
            </div>

            <div className="leaderboards-focus-card">
                <div className="leaderboards-focus-card__head">
                    <div>
                        <h4>{activeDefinition.title}</h4>
                        <p>{activeDefinition.description}</p>
                    </div>
                    <div className="leaderboards-focus-card__meta">
                        <span>Last update</span>
                        <strong>{formatTimestamp(lastUpdatedAt)}</strong>
                    </div>
                </div>

                <LeaderboardTable
                    definition={activeDefinition}
                    snapshot={activeSnapshot}
                    loading={isLoading}
                />

                <div className="leaderboards-player-strip">
                    <div>
                        <span>Your Placement</span>
                        <strong>{activeLeaderboardIsLive ? (playerEntry ? `#${playerEntry.rank}` : 'Unranked') : 'Coming Soon'}</strong>
                    </div>
                    <div>
                        <span>Your Score</span>
                        <strong>
                            {activeLeaderboardIsLive && playerEntry
                                ? formatLeaderboardScore(playerEntry.score, activeDefinition.displayType)
                                : '--'}
                        </strong>
                    </div>
                    <div>
                        <span>Total Entries</span>
                        <strong>{activeSnapshot?.totalEntries ?? 0}</strong>
                    </div>
                </div>

                <div className={`leaderboards-reward-strip ${activeRewardDefinition ? 'is-earned' : ''}`}>
                    <RankBadgeIcon leaderboardRank={playerEntry?.rank ?? null} size="small" className="leaderboards-reward-strip__badge" />
                    <div>
                        <span>Leaderboard Skin Reward</span>
                        <strong>
                            {!activeLeaderboardIsLive
                                ? 'Coming Soon'
                                : activeRewardDefinition
                                    ? activeRewardDefinition.title
                                    : 'Top 10 required'}
                        </strong>
                    </div>
                    <p>
                        {!activeLeaderboardIsLive
                            ? (activeDefinition.comingSoonReason || 'This reward opens in the full game.')
                            : activeRewardDefinition
                                ? `Your current #${playerEntry?.rank} position unlocks a Steam-linked skin copy while you are on this leaderboard.`
                                : 'Reach current #1, #2, #3, or #4-#10 on a live leaderboard to claim that leaderboard skin copy.'}
                    </p>
                </div>
            </div>

            {lastError && (
                <div className="leaderboards-error">
                    {lastError}
                </div>
            )}
        </div>
    );
}
