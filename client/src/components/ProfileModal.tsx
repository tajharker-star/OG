import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import {
    bucketMatches,
    getRankedProgressBarState,
    type PlayerStatistics,
    type StatsBucket,
} from '../utils/playerStatistics';
import type { EvaluatedAchievement } from '../utils/playerAchievements';
import {
    formatLeaderboardScore,
    isLeaderboardLiveInDemo,
    STEAM_LEADERBOARD_DEFINITIONS,
    type LeaderboardMetricId,
} from '../utils/steamLeaderboards';
import { steamService } from '../services/steam';
import {
    getNameChangeCost,
    type ProfileBadgeVariant,
    type CommanderProfile,
} from '../utils/playerProfile';
import { getAchievementIcon } from '../utils/achievementIcons';
import { RankBadgeIcon, getBadgeVariantForRankedPoints, type RankBadgeVariant } from './RankBadgeIcon';
import starCurrencyUrl from '../assets/star-currency.png';
import './ProfileModal.css';

type ProfileModalProps = {
    isOpen: boolean;
    onClose: () => void;
    commanderProfile: CommanderProfile;
    steamPersonaName?: string | null;
    statistics: PlayerStatistics;
    achievements: EvaluatedAchievement[];
    steamConnected: boolean;
    unlockedBadgeVariants: ProfileBadgeVariant[];
    onChangeDisplayName: (nextName: string) => Promise<{ success: boolean; error?: string }>;
    onSelectBadge: (badgeVariant: ProfileBadgeVariant | null) => Promise<void>;
};

type PlacementState = {
    id: LeaderboardMetricId;
    title: string;
    scoreLabel: string;
    displayType: (typeof STEAM_LEADERBOARD_DEFINITIONS)[number]['displayType'];
    rank: number | null;
    score: number | null;
    totalEntries: number;
    status: 'loading' | 'ready' | 'offline' | 'error' | 'coming_soon';
    error?: string;
};

const BADGE_LABELS: Record<ProfileBadgeVariant, string> = {
    default: 'Recruit',
    gold: 'Gold',
    platinum: 'Platinum',
    topaz: 'Topaz',
    diamond: 'Diamond',
    obsidian: 'Obsidian',
    godly: 'Godly',
    ruby: 'Ruby',
    leaderboard_first: 'World Champion',
    leaderboard_second: 'Silver Vanguard',
    leaderboard_third: 'Bronze Warlord',
    leaderboard_top10: 'Top 10',
    developer: 'Developer',
};

const formatPercent = (wins: number, losses: number) => {
    const total = wins + losses;
    if (total <= 0) return '0.0%';
    return `${((wins / total) * 100).toFixed(1)}%`;
};

const formatRatio = (wins: number, losses: number) => {
    if (wins === 0 && losses === 0) return '0.00';
    if (losses === 0) return 'Perfect';
    return (wins / losses).toFixed(2);
};

const formatTimestamp = (value: string | null) => {
    if (!value) return 'Never';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Never';
    return parsed.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

const createOfflinePlacements = (status: PlacementState['status']): PlacementState[] => (
    STEAM_LEADERBOARD_DEFINITIONS.map((definition) => ({
        id: definition.id,
        title: definition.title,
        scoreLabel: definition.scoreLabel,
        displayType: definition.displayType,
        rank: null,
        score: null,
        totalEntries: 0,
        status: isLeaderboardLiveInDemo(definition) ? status : 'coming_soon',
    }))
);

const StatRow = ({ label, bucket }: { label: string; bucket: StatsBucket }) => (
    <div className="profile-stat-card">
        <div className="profile-stat-card__title">{label}</div>
        <div className="profile-stat-card__grid">
            <span>Matches<strong>{bucketMatches(bucket)}</strong></span>
            <span>Wins<strong>{bucket.wins}</strong></span>
            <span>Losses<strong>{bucket.losses}</strong></span>
            <span>Draws<strong>{bucket.draws}</strong></span>
            <span>Win Rate<strong>{formatPercent(bucket.wins, bucket.losses)}</strong></span>
            <span>W/L<strong>{formatRatio(bucket.wins, bucket.losses)}</strong></span>
            <span>Best Streak<strong>{bucket.bestWinStreak}</strong></span>
            <span>Current<strong>{bucket.currentWinStreak}</strong></span>
        </div>
    </div>
);

const StarCurrencyIcon = ({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }) => (
    <span className={`profile-star profile-star--${size}`} aria-hidden="true">
        <img src={starCurrencyUrl} alt="" />
    </span>
);

export function ProfileModal({
    isOpen,
    onClose,
    commanderProfile,
    steamPersonaName,
    statistics,
    achievements,
    steamConnected,
    unlockedBadgeVariants,
    onChangeDisplayName,
    onSelectBadge,
}: ProfileModalProps) {
    const resolvedDisplayName = commanderProfile.displayName || steamPersonaName || 'Commander';
    const [draftName, setDraftName] = useState(resolvedDisplayName);
    const [nameChangeMessage, setNameChangeMessage] = useState<string | null>(null);
    const [isChangingName, setIsChangingName] = useState(false);
    const [placements, setPlacements] = useState<PlacementState[]>(() => createOfflinePlacements('offline'));

    useEffect(() => {
        if (isOpen) {
            setDraftName(resolvedDisplayName);
            setNameChangeMessage(null);
        }
    }, [isOpen, resolvedDisplayName]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (!steamConnected) {
            setPlacements(createOfflinePlacements('offline'));
            return;
        }

        let cancelled = false;
        setPlacements(createOfflinePlacements('loading'));

        const loadPlacements = async () => {
            const nextPlacements = await Promise.all(STEAM_LEADERBOARD_DEFINITIONS.map(async (definition): Promise<PlacementState> => {
                if (!isLeaderboardLiveInDemo(definition)) {
                    return {
                        id: definition.id,
                        title: definition.title,
                        scoreLabel: definition.scoreLabel,
                        displayType: definition.displayType,
                        rank: null,
                        score: null,
                        totalEntries: 0,
                        status: 'coming_soon',
                        error: definition.comingSoonReason,
                    };
                }

                try {
                    const result = await steamService.getLeaderboardSnapshot({
                        name: definition.steamName,
                        topCount: 10,
                        sortMethod: definition.sortMethod,
                        displayType: definition.displayType,
                    });

                    if (!result.success) {
                        return {
                            id: definition.id,
                            title: definition.title,
                            scoreLabel: definition.scoreLabel,
                            displayType: definition.displayType,
                            rank: null,
                            score: null,
                            totalEntries: 0,
                            status: 'error',
                            error: result.error || 'Steam leaderboard unavailable.',
                        };
                    }

                    return {
                        id: definition.id,
                        title: definition.title,
                        scoreLabel: definition.scoreLabel,
                        displayType: definition.displayType,
                        rank: result.playerEntry?.rank ?? null,
                        score: result.playerEntry?.score ?? null,
                        totalEntries: result.totalEntries,
                        status: 'ready',
                    };
                } catch (error) {
                    return {
                        id: definition.id,
                        title: definition.title,
                        scoreLabel: definition.scoreLabel,
                        displayType: definition.displayType,
                        rank: null,
                        score: null,
                        totalEntries: 0,
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Steam leaderboard unavailable.',
                    };
                }
            }));

            if (!cancelled) {
                setPlacements(nextPlacements);
            }
        };

        void loadPlacements();
        return () => {
            cancelled = true;
        };
    }, [isOpen, steamConnected]);

    const summary = useMemo(() => {
        const highestRankedPoints = Math.max(statistics.rankedProgress.bestPoints, statistics.rankedProgress.points);
        const rankedProgress = getRankedProgressBarState(highestRankedPoints);
        const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked).length;
        const nextAchievement = achievements.find((achievement) => !achievement.unlocked);

        return {
            highestRankedPoints,
            rankedProgress,
            badgeVariant: getBadgeVariantForRankedPoints(highestRankedPoints),
            unlockedAchievements,
            nextAchievement,
            totalMatches: bucketMatches(statistics.lifetime),
        };
    }, [achievements, statistics]);

    const nameChangeCost = getNameChangeCost(commanderProfile);
    const canAffordNameChange = commanderProfile.stars >= nameChangeCost;
    const activeBadgeVariant = (
        commanderProfile.selectedBadgeVariant && unlockedBadgeVariants.includes(commanderProfile.selectedBadgeVariant)
            ? commanderProfile.selectedBadgeVariant
            : summary.badgeVariant
    ) as RankBadgeVariant;
    const badgeOptions = useMemo(() => {
        const ordered: ProfileBadgeVariant[] = [
            'default',
            'gold',
            'platinum',
            'topaz',
            'diamond',
            'obsidian',
            'godly',
            'ruby',
            'leaderboard_top10',
            'leaderboard_third',
            'leaderboard_second',
            'leaderboard_first',
            'developer',
        ];
        const unlocked = new Set(unlockedBadgeVariants);
        return ordered.filter((badgeVariant) => unlocked.has(badgeVariant));
    }, [unlockedBadgeVariants]);

    const handleNameSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsChangingName(true);
        setNameChangeMessage(null);

        try {
            const result = await onChangeDisplayName(draftName);
            setNameChangeMessage(result.success
                ? 'Commander name updated.'
                : result.error || 'Unable to update commander name.');
        } finally {
            setIsChangingName(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            className="profile-modal"
            title="Profile"
        >
            <div className="profile-modal__body">
                <section className="profile-hero-card">
                    <div className="profile-hero-card__identity">
                        <RankBadgeIcon
                            variant={activeBadgeVariant}
                            size="large"
                            title="Shown profile badge"
                            className="profile-hero-card__badge"
                        />
                        <div>
                            <div className="profile-hero-card__eyebrow">Commander Profile</div>
                            <h2 className="profile-hero-card__name">{resolvedDisplayName}</h2>
                            <div className="profile-hero-card__rank">
                                Shown Badge: {BADGE_LABELS[activeBadgeVariant]}
                                <span>Highest earned rank: Division {summary.rankedProgress.tier} / {summary.highestRankedPoints.toLocaleString()} RP</span>
                            </div>
                        </div>
                    </div>
                    <div className="profile-currency-panel">
                        <StarCurrencyIcon size="large" />
                        <div>
                            <span>Stars</span>
                            <strong>{commanderProfile.stars.toLocaleString()}</strong>
                            <small>{commanderProfile.lifetimeStarsEarned.toLocaleString()} lifetime earned</small>
                        </div>
                    </div>
                </section>

                <section className="profile-section">
                    <div className="profile-section__header">
                        <h3>Profile Badge</h3>
                        <span>Choose any badge you have unlocked</span>
                    </div>
                    <div className="profile-badge-picker">
                        {badgeOptions.map((badgeVariant) => (
                            <button
                                key={badgeVariant}
                                type="button"
                                className={`profile-badge-option ${activeBadgeVariant === badgeVariant ? 'is-active' : ''}`}
                                onClick={() => void onSelectBadge(badgeVariant)}
                            >
                                <RankBadgeIcon variant={badgeVariant as RankBadgeVariant} size="small" framed={false} />
                                <span>{BADGE_LABELS[badgeVariant]}</span>
                            </button>
                        ))}
                        {commanderProfile.selectedBadgeVariant && (
                            <button
                                type="button"
                                className="profile-badge-option profile-badge-option--auto"
                                onClick={() => void onSelectBadge(null)}
                            >
                                Auto Highest Badge
                            </button>
                        )}
                    </div>
                </section>

                <section className="profile-name-card">
                    <div>
                        <h3>Commander Name</h3>
                        <p>
                            Your first name change is free. After that, changing your in-game name costs
                            <StarCurrencyIcon size="small" /> {NAME_CHANGE_LABEL(nameChangeCost)}.
                        </p>
                    </div>
                    <form className="profile-name-form" onSubmit={handleNameSubmit}>
                        <input
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            maxLength={24}
                            aria-label="Commander name"
                        />
                        <button type="submit" disabled={isChangingName || !canAffordNameChange}>
                            {isChangingName ? 'Saving...' : nameChangeCost === 0 ? 'Use Free Change' : 'Change Name'}
                        </button>
                    </form>
                    {!canAffordNameChange && (
                        <div className="profile-warning">Not enough Stars for a paid name change yet.</div>
                    )}
                    {nameChangeMessage && (
                        <div className={nameChangeMessage.includes('updated') ? 'profile-success' : 'profile-warning'}>
                            {nameChangeMessage}
                        </div>
                    )}
                </section>

                <section className="profile-overview-grid">
                    <div className="profile-overview-tile">
                        <span>Lifetime Matches</span>
                        <strong>{summary.totalMatches}</strong>
                    </div>
                    <div className="profile-overview-tile">
                        <span>Lifetime W/L</span>
                        <strong>{formatRatio(statistics.lifetime.wins, statistics.lifetime.losses)}</strong>
                    </div>
                    <div className="profile-overview-tile">
                        <span>Achievements</span>
                        <strong>{summary.unlockedAchievements} / {achievements.length}</strong>
                    </div>
                    <div className="profile-overview-tile">
                        <span>Last Played</span>
                        <strong>{formatTimestamp(statistics.lastPlayedAt)}</strong>
                    </div>
                </section>

                <section className="profile-section">
                    <div className="profile-section__header">
                        <h3>Stats</h3>
                        <span>All tracked local and Steam-backed buckets</span>
                    </div>
                    <div className="profile-stat-grid">
                        <StatRow label="Lifetime" bucket={statistics.lifetime} />
                        <StatRow label="Campaign" bucket={statistics.campaign} />
                        <StatRow label="Custom" bucket={statistics.custom} />
                        <StatRow label="Multiplayer" bucket={statistics.multiplayer} />
                        <StatRow label="Co-op / PvE" bucket={statistics.coop} />
                        <StatRow label="Ranked" bucket={statistics.ranked} />
                    </div>
                </section>

                <section className="profile-section">
                    <div className="profile-section__header">
                        <h3>Leaderboard Positions</h3>
                        <span>{steamConnected ? 'Live Steam placement snapshot' : 'Launch through Steam to load global positions'}</span>
                    </div>
                    <div className="profile-leaderboard-grid">
                        {placements.map((placement) => (
                            <div key={placement.id} className="profile-leaderboard-card">
                                <RankBadgeIcon leaderboardRank={placement.rank} size="small" framed={false} />
                                <div>
                                    <span>{placement.title}</span>
                                    <strong>
                                        {placement.status === 'loading'
                                            ? 'Loading...'
                                            : placement.status === 'coming_soon'
                                                ? 'Coming Soon'
                                            : placement.rank
                                                ? `#${placement.rank.toLocaleString()}`
                                                : 'Unranked'}
                                    </strong>
                                    <small>
                                        {placement.status === 'coming_soon'
                                            ? placement.error || 'Full game feature'
                                            : placement.score !== null
                                            ? `${placement.scoreLabel}: ${formatLeaderboardScore(placement.score, placement.displayType)}`
                                            : placement.status === 'offline'
                                                ? 'Steam offline'
                                                : placement.error || `${placement.totalEntries.toLocaleString()} entries`}
                                    </small>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="profile-section">
                    <div className="profile-section__header">
                        <h3>Achievements</h3>
                        <span>{summary.nextAchievement ? `Next: ${summary.nextAchievement.title}` : 'All current achievements completed'}</span>
                    </div>
                    <div className="profile-achievement-progress">
                        <div style={{ width: `${achievements.length ? (summary.unlockedAchievements / achievements.length) * 100 : 0}%` }} />
                    </div>
                    <div className="profile-achievement-grid">
                        {achievements.map((achievement) => (
                            <div
                                key={achievement.id}
                                className={`profile-achievement-card ${achievement.unlocked ? 'profile-achievement-card--unlocked' : ''}`}
                            >
                                <img src={getAchievementIcon(achievement.id, achievement.unlocked)} alt="" loading="lazy" />
                                <div>
                                    <strong>{achievement.title}</strong>
                                    <span>{achievement.category}</span>
                                    <small>
                                        {achievement.unlocked
                                            ? `Unlocked ${formatTimestamp(achievement.unlockedAt)}`
                                            : `${Math.min(achievement.current, achievement.target)} / ${achievement.target}`}
                                    </small>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </Modal>
    );
}

const NAME_CHANGE_LABEL = (cost: number) => (
    cost === 0 ? '0 Stars' : `${cost.toLocaleString()} Stars`
);
