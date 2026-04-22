import type { MatchStatisticsSummary } from './playerStatistics';

export const NAME_CHANGE_STAR_COST = 250;
export const ACHIEVEMENT_STAR_REWARD = 40;

const LOCAL_PROFILE_BACKUP_KEY = 'ag_commander_profile_v1';

export type ProfileBadgeVariant =
    | 'default'
    | 'gold'
    | 'platinum'
    | 'topaz'
    | 'diamond'
    | 'obsidian'
    | 'godly'
    | 'ruby'
    | 'leaderboard_first'
    | 'leaderboard_second'
    | 'leaderboard_third'
    | 'leaderboard_top10'
    | 'developer';

export interface CommanderProfile {
    version: number;
    displayName: string | null;
    stars: number;
    lifetimeStarsEarned: number;
    firstNameChangeFree: boolean;
    nameChangeCount: number;
    selectedBadgeVariant: ProfileBadgeVariant | null;
    updatedAt: string | null;
}

export type NameChangeResult = {
    success: boolean;
    profile?: CommanderProfile;
    error?: string;
};

export const createDefaultCommanderProfile = (): CommanderProfile => ({
    version: 1,
    displayName: null,
    stars: 0,
    lifetimeStarsEarned: 0,
    firstNameChangeFree: true,
    nameChangeCount: 0,
    selectedBadgeVariant: null,
    updatedAt: null,
});

const isObject = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const readNumber = (value: unknown, fallback = 0): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const clampStars = (value: number): number => Math.max(0, Math.trunc(value));
const PROFILE_BADGE_VARIANTS = new Set<ProfileBadgeVariant>([
    'default',
    'gold',
    'platinum',
    'topaz',
    'diamond',
    'obsidian',
    'godly',
    'ruby',
    'leaderboard_first',
    'leaderboard_second',
    'leaderboard_third',
    'leaderboard_top10',
    'developer',
]);

const normalizeBadgeVariant = (value: unknown): ProfileBadgeVariant | null => (
    typeof value === 'string' && PROFILE_BADGE_VARIANTS.has(value as ProfileBadgeVariant)
        ? value as ProfileBadgeVariant
        : null
);

export const normalizeCommanderProfile = (value: unknown): CommanderProfile => {
    const defaults = createDefaultCommanderProfile();
    if (!isObject(value)) {
        return defaults;
    }

    const displayName = typeof value.displayName === 'string' && value.displayName.trim()
        ? value.displayName.trim()
        : defaults.displayName;

    return {
        version: readNumber(value.version, defaults.version),
        displayName,
        stars: clampStars(readNumber(value.stars, defaults.stars)),
        lifetimeStarsEarned: clampStars(readNumber(value.lifetimeStarsEarned, defaults.lifetimeStarsEarned)),
        firstNameChangeFree: typeof value.firstNameChangeFree === 'boolean'
            ? value.firstNameChangeFree
            : defaults.firstNameChangeFree,
        nameChangeCount: clampStars(readNumber(value.nameChangeCount, defaults.nameChangeCount)),
        selectedBadgeVariant: normalizeBadgeVariant(value.selectedBadgeVariant),
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : defaults.updatedAt,
    };
};

export const sanitizeCommanderName = (rawName: string): { success: boolean; value?: string; error?: string } => {
    const value = rawName.replace(/\s+/g, ' ').trim();

    if (value.length < 3) {
        return { success: false, error: 'Name must be at least 3 characters.' };
    }

    if (value.length > 24) {
        return { success: false, error: 'Name must be 24 characters or shorter.' };
    }

    if (!/^[a-zA-Z0-9 _.-]+$/.test(value)) {
        return { success: false, error: 'Use letters, numbers, spaces, underscores, dots, or dashes only.' };
    }

    if (/^[_.-]|[_.-]$/.test(value)) {
        return { success: false, error: 'Name cannot start or end with punctuation.' };
    }

    return { success: true, value };
};

export const getNameChangeCost = (profile: CommanderProfile): number => (
    profile.firstNameChangeFree ? 0 : NAME_CHANGE_STAR_COST
);

export const setProfileBadgeVariant = (
    profile: CommanderProfile,
    badgeVariant: ProfileBadgeVariant | null,
    unlockedBadgeVariants: ProfileBadgeVariant[],
    timestamp: string = new Date().toISOString()
): CommanderProfile => {
    const normalized = normalizeCommanderProfile(profile);
    const unlocked = new Set(unlockedBadgeVariants);
    const nextBadgeVariant = badgeVariant && unlocked.has(badgeVariant) ? badgeVariant : null;

    return {
        ...normalized,
        selectedBadgeVariant: nextBadgeVariant,
        updatedAt: timestamp,
    };
};

export const awardStars = (
    profile: CommanderProfile,
    amount: number,
    timestamp: string = new Date().toISOString()
): CommanderProfile => {
    const normalized = normalizeCommanderProfile(profile);
    const reward = Math.max(0, Math.trunc(amount));

    if (reward <= 0) {
        return normalized;
    }

    return {
        ...normalized,
        stars: normalized.stars + reward,
        lifetimeStarsEarned: normalized.lifetimeStarsEarned + reward,
        updatedAt: timestamp,
    };
};

export const spendStarsOnNameChange = (
    profile: CommanderProfile,
    rawName: string,
    timestamp: string = new Date().toISOString()
): NameChangeResult => {
    const sanitized = sanitizeCommanderName(rawName);
    if (!sanitized.success || !sanitized.value) {
        return { success: false, error: sanitized.error || 'Invalid commander name.' };
    }

    const normalized = normalizeCommanderProfile(profile);
    const currentName = normalized.displayName?.toLowerCase() || '';
    if (currentName === sanitized.value.toLowerCase()) {
        return { success: false, error: 'That is already your commander name.' };
    }

    const cost = getNameChangeCost(normalized);
    if (normalized.stars < cost) {
        return { success: false, error: `You need ${cost.toLocaleString()} Stars to change your name.` };
    }

    return {
        success: true,
        profile: {
            ...normalized,
            displayName: sanitized.value,
            stars: normalized.stars - cost,
            firstNameChangeFree: false,
            nameChangeCount: normalized.nameChangeCount + 1,
            updatedAt: timestamp,
        },
    };
};

export const getMatchStarReward = (summary: MatchStatisticsSummary): number => {
    let reward = summary.result === 'win' ? 30 : summary.result === 'draw' ? 12 : 8;

    if (summary.ranked) {
        reward += summary.result === 'win' ? 18 : 8;
    }

    if (summary.source === 'steam') {
        reward += 10;
    }

    if (summary.source === 'campaign' || summary.source === 'custom') {
        reward += Math.min(24, Math.max(0, Math.trunc(summary.maxBotDifficulty || 0) * 2));
    }

    if (summary.coop) {
        reward += 6;
    }

    return reward;
};

export const readProfileBackup = (): CommanderProfile | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const raw = window.localStorage.getItem(LOCAL_PROFILE_BACKUP_KEY);
        return raw ? normalizeCommanderProfile(JSON.parse(raw)) : null;
    } catch (error) {
        console.warn('[Profile] Failed to read local commander profile backup.', error);
        return null;
    }
};

export const writeProfileBackup = (profile: CommanderProfile) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(LOCAL_PROFILE_BACKUP_KEY, JSON.stringify(normalizeCommanderProfile(profile)));
    } catch (error) {
        console.warn('[Profile] Failed to write local commander profile backup.', error);
    }
};
