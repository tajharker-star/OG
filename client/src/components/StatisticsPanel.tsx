import { useMemo, useState } from 'react';
import './StatisticsPanel.css';
import type { PlayerStatistics, StatsBucket } from '../utils/playerStatistics';
import { bucketMatches } from '../utils/playerStatistics';
import type { EvaluatedAchievement } from '../utils/playerAchievements';

type StatisticsPanelProps = {
    statistics: PlayerStatistics;
    achievements: EvaluatedAchievement[];
    campaignLevel: number;
    totalCampaignStages: number;
    steamConnected: boolean;
};

type SectionKey = 'achievements' | 'lifetime' | 'modes' | 'coop' | 'ranked' | 'steam';

const formatRate = (wins: number, losses: number) => {
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
    return parsed.toLocaleString();
};

const Metric: React.FC<{ label: string; value: string | number; accent?: 'good' | 'bad' | 'info' }> = ({ label, value, accent = 'info' }) => (
    <div className={`statistics-metric statistics-metric--${accent}`}>
        <div className="statistics-metric-label">{label}</div>
        <div className="statistics-metric-value">{value}</div>
    </div>
);

const BucketMetrics: React.FC<{ bucket: StatsBucket }> = ({ bucket }) => (
    <div className="statistics-metric-grid">
        <Metric label="Matches" value={bucketMatches(bucket)} />
        <Metric label="Wins" value={bucket.wins} accent="good" />
        <Metric label="Losses" value={bucket.losses} accent="bad" />
        <Metric label="Draws" value={bucket.draws} />
        <Metric label="Win Rate" value={formatRate(bucket.wins, bucket.losses)} accent="good" />
        <Metric label="W/L Ratio" value={formatRatio(bucket.wins, bucket.losses)} />
        <Metric label="Best Win Streak" value={bucket.bestWinStreak} accent="good" />
        <Metric label="Current Win Streak" value={bucket.currentWinStreak} />
    </div>
);

const AchievementCard: React.FC<{ achievement: EvaluatedAchievement }> = ({ achievement }) => {
    const progressValue = achievement.unlocked ? achievement.target : Math.min(achievement.current, achievement.target);
    const progressLabel = achievement.unlocked
        ? `Unlocked${achievement.unlockedAt ? ` ${formatTimestamp(achievement.unlockedAt)}` : ''}`
        : `${progressValue} / ${achievement.target}`;

    return (
        <div className={`achievement-card ${achievement.unlocked ? 'achievement-card--unlocked' : ''}`}>
            <div className="achievement-card-top">
                <div>
                    <div className="achievement-card-title">{achievement.title}</div>
                    <div className="achievement-card-category">{achievement.category}</div>
                </div>
                <div className={`achievement-card-badge ${achievement.unlocked ? 'achievement-card-badge--unlocked' : ''}`}>
                    {achievement.unlocked ? 'Unlocked' : 'Locked'}
                </div>
            </div>
            <p className="achievement-card-description">{achievement.description}</p>
            <div className="achievement-progress-track achievement-progress-track--card">
                <div
                    className="achievement-progress-fill"
                    style={{ width: `${achievement.unlocked ? 100 : achievement.progress}%` }}
                />
            </div>
            <div className="achievement-card-progress">{progressLabel}</div>
        </div>
    );
};

export function StatisticsPanel({ statistics, achievements, campaignLevel, totalCampaignStages, steamConnected }: StatisticsPanelProps) {
    const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
        achievements: true,
        lifetime: false,
        modes: false,
        coop: false,
        ranked: false,
        steam: false,
    });

    const summary = useMemo(() => {
        const lifetime = statistics.lifetime;
        const unlockedAchievements = achievements.filter(achievement => achievement.unlocked).length;
        return {
            matches: bucketMatches(lifetime),
            wins: lifetime.wins,
            losses: lifetime.losses,
            winRate: formatRate(lifetime.wins, lifetime.losses),
            ratio: formatRatio(lifetime.wins, lifetime.losses),
            unlockedAchievements,
        };
    }, [achievements, statistics]);

    const toggleSection = (section: SectionKey) => {
        setOpenSections(prev => ({
            ...prev,
            [section]: !prev[section],
        }));
    };

    return (
        <div className="statistics-screen">
            <div className="achievement-progress-card">
                <div className="achievement-progress-head">
                    <span>Achievement Progress</span>
                    <strong>{summary.unlockedAchievements} / {achievements.length}</strong>
                </div>
                <div className="achievement-progress-track">
                    <div
                        className="achievement-progress-fill"
                        style={{ width: `${achievements.length > 0 ? (summary.unlockedAchievements / achievements.length) * 100 : 0}%` }}
                    />
                </div>
            </div>

            <div className="statistics-summary-grid">
                <Metric label="Lifetime Matches" value={summary.matches} />
                <Metric label="Lifetime Wins" value={summary.wins} accent="good" />
                <Metric label="Lifetime Losses" value={summary.losses} accent="bad" />
                <Metric label="Win Rate" value={summary.winRate} accent="good" />
            </div>

            <div className="statistics-summary-strip">
                <div><span>W/L Ratio</span><strong>{summary.ratio}</strong></div>
                <div><span>Last Result</span><strong>{statistics.lastResult ? statistics.lastResult.toUpperCase() : 'NONE'}</strong></div>
                <div><span>Last Match</span><strong>{formatTimestamp(statistics.lastPlayedAt)}</strong></div>
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('achievements')}>
                    <span>Achievements</span>
                    <span>{openSections.achievements ? '−' : '+'}</span>
                </button>
                {openSections.achievements && (
                    <div className="statistics-section-body">
                        <div className="achievement-grid">
                            {achievements.map(achievement => (
                                <AchievementCard key={achievement.id} achievement={achievement} />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('lifetime')}>
                    <span>Lifetime Record</span>
                    <span>{openSections.lifetime ? '−' : '+'}</span>
                </button>
                {openSections.lifetime && (
                    <div className="statistics-section-body">
                        <BucketMetrics bucket={statistics.lifetime} />
                    </div>
                )}
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('modes')}>
                    <span>Campaign, Custom, and Multiplayer</span>
                    <span>{openSections.modes ? '−' : '+'}</span>
                </button>
                {openSections.modes && (
                    <div className="statistics-section-body">
                        <div className="statistics-mode-block">
                            <div className="statistics-mode-title">Campaign</div>
                            <BucketMetrics bucket={statistics.campaign} />
                        </div>
                        <div className="statistics-mode-block">
                            <div className="statistics-mode-title">Custom</div>
                            <BucketMetrics bucket={statistics.custom} />
                        </div>
                        <div className="statistics-mode-block">
                            <div className="statistics-mode-title">Multiplayer</div>
                            <BucketMetrics bucket={statistics.multiplayer} />
                        </div>
                        <div className="statistics-note-card">
                            <span>Last Campaign Stage Selected</span>
                            <strong>Stage {Math.min(totalCampaignStages, campaignLevel + 1)} / {totalCampaignStages}</strong>
                        </div>
                    </div>
                )}
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('coop')}>
                    <span>Co-op / PvE Record</span>
                    <span>{openSections.coop ? '−' : '+'}</span>
                </button>
                {openSections.coop && (
                    <div className="statistics-section-body">
                        <BucketMetrics bucket={statistics.coop} />
                        <p className="statistics-note">
                            This bucket currently tracks AI-backed matches, so your solo campaign/custom runs still count here until full team co-op rules are added.
                        </p>
                    </div>
                )}
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('ranked')}>
                    <span>Ranked Record</span>
                    <span>{openSections.ranked ? '−' : '+'}</span>
                </button>
                {openSections.ranked && (
                    <div className="statistics-section-body">
                        <BucketMetrics bucket={statistics.ranked} />
                        <p className="statistics-note">
                            Ranked currently counts Steam-backed PvP matches with 2+ human players and no bots. LAN and bot matches stay out of this bucket.
                        </p>
                    </div>
                )}
            </div>

            <div className="statistics-section">
                <button className="statistics-section-toggle" onClick={() => toggleSection('steam')}>
                    <span>Steam Sync</span>
                    <span>{openSections.steam ? '−' : '+'}</span>
                </button>
                {openSections.steam && (
                    <div className="statistics-section-body">
                        <div className="statistics-metric-grid">
                            <Metric label="Steam Connected" value={steamConnected ? 'Yes' : 'No'} accent={steamConnected ? 'good' : 'bad'} />
                            <Metric label="Stats Available" value={statistics.steamSync.available ? 'Ready' : 'Local Only'} accent={statistics.steamSync.available ? 'good' : 'info'} />
                            <Metric label="Last Sync Attempt" value={formatTimestamp(statistics.steamSync.lastAttemptAt)} />
                            <Metric label="Last Successful Sync" value={formatTimestamp(statistics.steamSync.lastSuccessAt)} accent="good" />
                        </div>
                        {statistics.steamSync.lastError && (
                            <div className="statistics-warning">
                                Steam sync warning: {statistics.steamSync.lastError}
                            </div>
                        )}
                        <p className="statistics-note">
                            Steam stat storage only persists the API names that exist in Steamworks. The client now pushes tracked integers up to Steam when those stat definitions are present on your app backend.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
