import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Modal } from './components/Modal';
import { LobbyLogo } from './components/LobbyLogo';
import { LobbyBackdrop } from './components/LobbyBackdrop';
import { socket, connectToServer, connectionManager } from './services/socket';
import { steamService } from './services/steam';
import { soundEffectsManager } from './audio/soundEffects';
import {
    bucketMatches,
    RANKED_QUICK_MATCH_PLAYER_COUNT,
    STEAM_STAT_KEYS,
    createDefaultPlayerStatistics,
    mergeSteamStatistics,
    normalizePlayerStatistics,
    recordMatchResult,
    toSteamStatPayload,
    withSteamSyncState,
    type MatchSource,
    type MatchStatisticsSummary,
    type PlayerStatistics,
} from './utils/playerStatistics';
import {
    createDefaultAchievementUnlockState,
    evaluateAchievements,
    normalizeAchievementUnlockState,
    unlockEligibleAchievements,
    type AchievementUnlockState,
} from './utils/playerAchievements';
import {
    TUTORIAL_MAP_OPTIONS,
    type TutorialMapType,
} from './data/tutorialGuide';
import { buildLeaderboardUploadCandidates, getLeaderboardSkinRewardForRank, type LeaderboardMetricId } from './utils/steamLeaderboards';
import {
    createDefaultSteamMultiplayerDiagnostics,
    type SteamMultiplayerDiagnostics,
} from './types/steamDiagnostics';
import {
    STEAM_SKIN_ITEM_DEFS,
    type PlayerSkinProfile,
    type SkinId,
    type SkinTarget,
} from './utils/playerSkins';
import {
    ACHIEVEMENT_STAR_REWARD,
    awardStars,
    createDefaultCommanderProfile,
    getMatchStarReward,
    normalizeCommanderProfile,
    readProfileBackup,
    setProfileBadgeVariant,
    spendStarsOnNameChange,
    writeProfileBackup,
    type CommanderProfile,
    type ProfileBadgeVariant,
} from './utils/playerProfile';
import './App.css';

const LazyGameCanvas = lazy(async () => {
    const module = await import('./components/GameCanvas');
    return { default: module.GameCanvas };
});

const LazyGameUI = lazy(async () => {
    const module = await import('./components/GameUI');
    return { default: module.GameUI };
});

const LazySettingsModal = lazy(async () => {
    const module = await import('./components/SettingsModal');
    return { default: module.SettingsModal };
});

const LazyPatchNotesModal = lazy(async () => {
    const module = await import('./components/PatchNotesModal');
    return { default: module.PatchNotesModal };
});

const LazyProfileModal = lazy(async () => {
    const module = await import('./components/ProfileModal');
    return { default: module.ProfileModal };
});

const LazyStatisticsPanel = lazy(async () => {
    const module = await import('./components/StatisticsPanel');
    return { default: module.StatisticsPanel };
});

const LazyLeaderboardsPanel = lazy(async () => {
    const module = await import('./components/LeaderboardsPanel');
    return { default: module.LeaderboardsPanel };
});

const LazyConnectionLostOverlay = lazy(async () => {
    const module = await import('./components/ConnectionLostOverlay');
    return { default: module.ConnectionLostOverlay };
});

const LazySkinsPanel = lazy(async () => {
    const module = await import('./components/SkinsPanel');
    return { default: module.SkinsPanel };
});

const LOCAL_STATISTICS_BACKUP_KEY = 'ag_statistics_backup_v1';
const LOCAL_ENGINE_CONNECT_ATTEMPT_TIMEOUT_MS = 20000;
const INITIAL_LOCAL_ENGINE_BOOT_BUDGET_MS = 24000;
const INTERACTIVE_LOCAL_ENGINE_BOOT_BUDGET_MS = 30000;
const MAIN_GAME_STEAM_APP_ID = '4432210';
const MAIN_GAME_STEAM_STORE_URL = `https://store.steampowered.com/app/${MAIN_GAME_STEAM_APP_ID}/`;
const MAIN_GAME_STEAM_DEEP_LINK = `steam://store/${MAIN_GAME_STEAM_APP_ID}`;
const REQUEST_CHANGES_DISCUSSION_URL = 'https://steamcommunity.com/app/4432210/discussions/0/797840128955390334/';
const SETTINGS_FLOAT_BUTTON_SIZE = 56;
const SETTINGS_FLOAT_BUTTON_MARGIN = 24;
const SETTINGS_FLOAT_BUTTON_STORAGE_KEY = 'ag_settings_float_button_position_v1';
const DEFAULT_TUTORIAL_MAP: TutorialMapType = 'desert';
const DEVELOPER_SKIN_ALLOWED_NAMES = new Set(['thecoadstar']);
const DEVELOPER_SKIN_ALLOWED_OS_USERS = new Set<string>();
const RANKED_QUICK_QUEUE_TYPE = 'ranked_quick_match';
const DEFAULT_SKIN_PROFILE: PlayerSkinProfile = {
    version: 2,
    loadout: {
        unitSkinId: 'default',
        buildingSkinId: 'default',
    },
    earnedSeasonRewards: [],
    skinItemCounts: {},
    claimedLeaderboardRewards: {},
};
const VALID_SKIN_IDS = new Set<SkinId>([
    'default',
    'ruby',
    'gold',
    'platinum',
    'topaz',
    'diamond',
    'obsidian',
    'godly',
    'leaderboard_first',
    'leaderboard_second',
    'leaderboard_third',
    'leaderboard_top10',
    'developer',
]);
const RANKED_SKIN_ID_SET = new Set<SkinId>([
    'gold',
    'platinum',
    'topaz',
    'diamond',
    'obsidian',
    'godly',
]);
const PROFILE_BADGE_BY_SKIN_ID: Partial<Record<SkinId, ProfileBadgeVariant>> = {
    default: 'default',
    gold: 'gold',
    platinum: 'platinum',
    topaz: 'topaz',
    diamond: 'diamond',
    obsidian: 'obsidian',
    godly: 'godly',
    ruby: 'ruby',
    leaderboard_first: 'leaderboard_first',
    leaderboard_second: 'leaderboard_second',
    leaderboard_third: 'leaderboard_third',
    leaderboard_top10: 'leaderboard_top10',
    developer: 'developer',
};
const LEADERBOARD_REWARD_SKIN_ID_SET = new Set<SkinId>([
    'leaderboard_first',
    'leaderboard_second',
    'leaderboard_third',
    'leaderboard_top10',
]);
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

type LocalServerStatus = {
    success?: boolean;
    ready?: boolean;
    stopped?: boolean;
    managed?: boolean;
    port?: number;
    error?: string;
    reason?: string;
};

type RendererManagedLocalServerState = {
    process: any | null;
    startPromise: Promise<LocalServerStatus> | null;
    stopPromise: Promise<LocalServerStatus> | null;
};

const RENDERER_LOCAL_SERVER_PORT = 3001;
const RENDERER_LOCAL_SERVER_STATE_KEY = '__agRendererLocalServerState';

const getRendererRequire = () => {
    if (typeof window === 'undefined') return null;
    return (window as any).require ?? null;
};

const getRendererLocalServerState = (): RendererManagedLocalServerState | null => {
    if (typeof window === 'undefined') return null;
    const hostWindow = window as any;
    if (!hostWindow[RENDERER_LOCAL_SERVER_STATE_KEY]) {
        hostWindow[RENDERER_LOCAL_SERVER_STATE_KEY] = {
            process: null,
            startPromise: null,
            stopPromise: null,
        } satisfies RendererManagedLocalServerState;
    }
    return hostWindow[RENDERER_LOCAL_SERVER_STATE_KEY] as RendererManagedLocalServerState;
};

const isMissingIpcHandlerError = (error: unknown, channel: string) => {
    const message = getErrorMessage(error);
    return message.includes(`No handler registered for '${channel}'`);
};

const checkRendererLocalServerPort = async (port: number = RENDERER_LOCAL_SERVER_PORT): Promise<boolean> => {
    const electronRequire = getRendererRequire();
    if (!electronRequire) return false;

    try {
        const http = electronRequire('http');
        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const request = http.get(`http://127.0.0.1:${port}`, (response: any) => {
                response.resume?.();
                finish(true);
            });

            request.setTimeout?.(900, () => {
                request.destroy?.();
                finish(false);
            });
            request.on('error', () => finish(false));
        });
    } catch {
        return false;
    }
};

const resolveRendererServerLaunchConfig = () => {
    const electronRequire = getRendererRequire();
    if (!electronRequire) {
        return null;
    }

    try {
        const fs = electronRequire('fs');
        const path = electronRequire('path');
        const resourcesPath = (window as any)?.process?.resourcesPath ?? '';
        const cwd = (window as any)?.process?.cwd?.() ?? '';
        const candidateServerPaths = [
            path.join(resourcesPath, 'app', 'server', 'dist', 'index.js'),
            path.join(resourcesPath, 'server', 'dist', 'index.js'),
            path.join(cwd, 'server', 'dist', 'index.js'),
            path.join(cwd, '..', 'server', 'dist', 'index.js'),
        ];
        const candidateClientDistDirs = [
            path.join(resourcesPath, 'app', 'client', 'dist'),
            path.join(resourcesPath, 'client', 'dist'),
            path.join(cwd, 'client', 'dist'),
            path.join(cwd, '..', 'client', 'dist'),
        ];

        const serverPath = candidateServerPaths.find((candidate: string) => fs.existsSync(candidate));
        if (!serverPath) {
            return null;
        }

        const clientDistDir = candidateClientDistDirs.find((candidate: string) => fs.existsSync(candidate)) ?? path.join(path.dirname(path.dirname(serverPath)), 'client', 'dist');
        return {
            serverPath,
            cwd: path.dirname(path.dirname(serverPath)),
            clientDistDir,
        };
    } catch {
        return null;
    }
};

const ensureRendererManagedLocalServerRunning = async (): Promise<LocalServerStatus> => {
    const state = getRendererLocalServerState();
    const electronRequire = getRendererRequire();
    if (!state || !electronRequire) {
        return {
            success: false,
            ready: false,
            port: RENDERER_LOCAL_SERVER_PORT,
            error: 'Renderer local-server fallback is unavailable in this environment.',
        };
    }

    if (await checkRendererLocalServerPort(RENDERER_LOCAL_SERVER_PORT)) {
        return {
            success: true,
            ready: true,
            port: RENDERER_LOCAL_SERVER_PORT,
            managed: Boolean(state.process && !state.process.killed),
        };
    }

    if (state.startPromise) {
        return state.startPromise;
    }

    state.startPromise = (async () => {
        const config = resolveRendererServerLaunchConfig();
        if (!config) {
            return {
                success: false,
                ready: false,
                port: RENDERER_LOCAL_SERVER_PORT,
                error: 'Could not locate the local match engine files from the renderer fallback.',
            };
        }

        try {
            const { fork } = electronRequire('child_process');
            const child = fork(config.serverPath, [], {
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
                cwd: config.cwd,
                env: {
                    ...((window as any)?.process?.env ?? {}),
                    PORT: String(RENDERER_LOCAL_SERVER_PORT),
                    HEADLESS: 'true',
                    CLIENT_DIST_DIR: config.clientDistDir,
                },
            });

            state.process = child;
            child.stdout?.on?.('data', (data: any) => console.log(`[Renderer Local Server]: ${String(data).trim()}`));
            child.stderr?.on?.('data', (data: any) => console.error(`[Renderer Local Server Error]: ${String(data).trim()}`));
            child.on?.('exit', () => {
                if (state.process === child) {
                    state.process = null;
                }
            });
        } catch (error) {
            return {
                success: false,
                ready: false,
                port: RENDERER_LOCAL_SERVER_PORT,
                error: getErrorMessage(error),
            };
        }

        const startedAt = Date.now();
        while ((Date.now() - startedAt) < 20000) {
            if (await checkRendererLocalServerPort(RENDERER_LOCAL_SERVER_PORT)) {
                return {
                    success: true,
                    ready: true,
                    port: RENDERER_LOCAL_SERVER_PORT,
                    managed: true,
                };
            }
            await new Promise((resolve) => window.setTimeout(resolve, 250));
        }

        return {
            success: false,
            ready: false,
            port: RENDERER_LOCAL_SERVER_PORT,
            error: 'Renderer fallback started the local match engine, but it never became reachable.',
        };
    })();

    try {
        return await state.startPromise;
    } finally {
        state.startPromise = null;
    }
};

const stopRendererManagedLocalServer = async (): Promise<LocalServerStatus> => {
    const state = getRendererLocalServerState();
    if (!state) {
        return {
            success: true,
            stopped: false,
            port: RENDERER_LOCAL_SERVER_PORT,
            reason: 'Renderer local-server fallback is unavailable.',
        };
    }

    if (state.startPromise) {
        try {
            await state.startPromise;
        } catch {
            // Ignore and continue stopping.
        }
    }

    if (!state.process || state.process.killed) {
        return {
            success: true,
            stopped: false,
            port: RENDERER_LOCAL_SERVER_PORT,
            reason: 'No renderer-managed local server process was running.',
        };
    }

    if (state.stopPromise) {
        return state.stopPromise;
    }

    const processToStop = state.process;
    state.stopPromise = new Promise<LocalServerStatus>((resolve) => {
        let settled = false;
        const finish = (result: LocalServerStatus) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const timeoutId = window.setTimeout(() => {
            try {
                processToStop.kill?.('SIGKILL');
            } catch {
                // Ignore kill failure here and return timeout.
            }
            if (state.process === processToStop) {
                state.process = null;
            }
            finish({
                success: false,
                stopped: false,
                port: RENDERER_LOCAL_SERVER_PORT,
                error: 'Timed out while stopping the renderer-managed local match engine.',
            });
        }, 4000);

        processToStop.once?.('exit', () => {
            window.clearTimeout(timeoutId);
            if (state.process === processToStop) {
                state.process = null;
            }
            finish({
                success: true,
                stopped: true,
                port: RENDERER_LOCAL_SERVER_PORT,
                managed: false,
            });
        });

        try {
            processToStop.kill?.('SIGTERM');
        } catch (error) {
            window.clearTimeout(timeoutId);
            if (state.process === processToStop) {
                state.process = null;
            }
            finish({
                success: false,
                stopped: false,
                port: RENDERER_LOCAL_SERVER_PORT,
                error: getErrorMessage(error),
            });
        }
    });

    try {
        return await state.stopPromise;
    } finally {
        state.stopPromise = null;
    }
};

const getRendererManagedLocalServerStatus = async (): Promise<LocalServerStatus> => {
    const state = getRendererLocalServerState();
    const ready = await checkRendererLocalServerPort(RENDERER_LOCAL_SERVER_PORT);
    return {
        success: true,
        ready,
        port: RENDERER_LOCAL_SERVER_PORT,
        managed: Boolean(state?.process && !state.process.killed),
    };
};

type PendingSteamLobbyConfig = {
    lobbyVisibility: 'private' | 'friends' | 'public' | 'invisible';
    maxMembers: number;
    map: string;
    mode: string;
    openInviteDialog: boolean;
    ranked: boolean;
    metadata: Record<string, string | number | boolean | null | undefined>;
};

const getCurrentOsUsername = (): string | null => {
    try {
        const electronRequire = (window as any)?.require;
        if (!electronRequire) {
            return null;
        }

        const os = electronRequire('os');
        const username = os?.userInfo?.()?.username;
        return typeof username === 'string' ? username.trim().toLowerCase() : null;
    } catch {
        return null;
    }
};

const canUseDeveloperSkin = (steamIdentity?: { name?: string | null; steamId?: string | null } | null): boolean => {
    const normalizedName = typeof steamIdentity?.name === 'string'
        ? steamIdentity.name.trim().toLowerCase()
        : '';

    if (normalizedName && DEVELOPER_SKIN_ALLOWED_NAMES.has(normalizedName)) {
        return true;
    }

    const osUsername = getCurrentOsUsername();
    return !!osUsername && DEVELOPER_SKIN_ALLOWED_OS_USERS.has(osUsername);
};

const createDefaultPlayerSkinProfile = (): PlayerSkinProfile => ({
    version: DEFAULT_SKIN_PROFILE.version,
    loadout: { ...DEFAULT_SKIN_PROFILE.loadout },
    earnedSeasonRewards: [],
    skinItemCounts: {},
    claimedLeaderboardRewards: {},
});

const canonicalizeSkinId = (value: unknown): SkinId | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = LEGACY_SKIN_ID_MAP[value] || value;
    return VALID_SKIN_IDS.has(normalized as SkinId) ? (normalized as SkinId) : null;
};

const normalizePlayerSkinProfile = (value: unknown): PlayerSkinProfile => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createDefaultPlayerSkinProfile();
    }

    const profile = value as Record<string, unknown>;
    const rawLoadout = profile.loadout && typeof profile.loadout === 'object' && !Array.isArray(profile.loadout)
        ? profile.loadout as Record<string, unknown>
        : {};
    const rawRewards = Array.isArray(profile.earnedSeasonRewards) ? profile.earnedSeasonRewards : [];
    const rawSkinItemCounts = profile.skinItemCounts && typeof profile.skinItemCounts === 'object' && !Array.isArray(profile.skinItemCounts)
        ? profile.skinItemCounts as Record<string, unknown>
        : {};
    const rawClaimedLeaderboardRewards = profile.claimedLeaderboardRewards && typeof profile.claimedLeaderboardRewards === 'object' && !Array.isArray(profile.claimedLeaderboardRewards)
        ? profile.claimedLeaderboardRewards as Record<string, unknown>
        : {};
    const skinItemCounts: Partial<Record<SkinId, number>> = {};
    const earnedSeasonRewards = Array.from(new Set(
        rawRewards
            .map((entry) => canonicalizeSkinId(entry))
            .filter((entry): entry is SkinId => entry !== null && RANKED_SKIN_ID_SET.has(entry))
    ));

    Object.entries(rawSkinItemCounts).forEach(([key, rawCount]) => {
        const skinId = canonicalizeSkinId(key);
        if (!skinId || skinId === 'default') return;
        const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
        if (Number.isFinite(count) && count > 0) {
            skinItemCounts[skinId] = Math.max(1, Math.floor(count));
        }
    });

    earnedSeasonRewards.forEach((skinId) => {
        skinItemCounts[skinId] = Math.max(1, skinItemCounts[skinId] || 0);
    });

    return {
        version: typeof profile.version === 'number' && Number.isFinite(profile.version)
            ? profile.version
            : DEFAULT_SKIN_PROFILE.version,
        loadout: {
            unitSkinId: canonicalizeSkinId(rawLoadout.unitSkinId) || DEFAULT_SKIN_PROFILE.loadout.unitSkinId,
            buildingSkinId: canonicalizeSkinId(rawLoadout.buildingSkinId) || DEFAULT_SKIN_PROFILE.loadout.buildingSkinId,
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

const getSkinEnhancementLevelFromCopies = (copyCount: number): number => {
    if (copyCount < 3) return 0;
    return Math.max(0, Math.floor(copyCount / 3));
};

const getSkinCopyCount = (profile: PlayerSkinProfile, skinId: SkinId): number => {
    if (skinId === 'default') return 1;
    return Math.max(0, Math.floor(profile.skinItemCounts?.[skinId] || 0));
};

const withSkinLoadoutEnhancements = (profile: PlayerSkinProfile): PlayerSkinProfile => ({
    ...profile,
    loadout: {
        ...profile.loadout,
        unitEnhancementLevel: getSkinEnhancementLevelFromCopies(getSkinCopyCount(profile, profile.loadout.unitSkinId)),
        buildingEnhancementLevel: getSkinEnhancementLevelFromCopies(getSkinCopyCount(profile, profile.loadout.buildingSkinId)),
    },
});

const getUnlockedSkinIds = (
    profile: PlayerSkinProfile,
    unlockedAchievementCount: number,
    totalAchievementCount: number,
    hasDeveloperAccess: boolean,
): Set<SkinId> => {
    const unlocked = new Set<SkinId>(['default']);

    if (hasDeveloperAccess) {
        unlocked.add('developer');
    }

    profile.earnedSeasonRewards.forEach((skinId) => {
        if (RANKED_SKIN_ID_SET.has(skinId)) {
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

    if (totalAchievementCount > 0 && unlockedAchievementCount >= totalAchievementCount) {
        unlocked.add('ruby');
    }

    return unlocked;
};

const sanitizeSkinProfile = (
    profile: PlayerSkinProfile,
    unlockedSkinIds: Set<SkinId>,
): PlayerSkinProfile => {
    const skinItemCounts: Partial<Record<SkinId, number>> = {};
    Object.entries(profile.skinItemCounts || {}).forEach(([rawSkinId, rawCount]) => {
        const skinId = canonicalizeSkinId(rawSkinId);
        if (!skinId || skinId === 'default') return;
        const count = Math.floor(Number(rawCount));
        if (Number.isFinite(count) && count > 0) {
            skinItemCounts[skinId] = count;
        }
    });

    return withSkinLoadoutEnhancements({
        ...profile,
        loadout: {
            unitSkinId: unlockedSkinIds.has(profile.loadout.unitSkinId) ? profile.loadout.unitSkinId : 'default',
            buildingSkinId: unlockedSkinIds.has(profile.loadout.buildingSkinId) ? profile.loadout.buildingSkinId : 'default',
        },
        earnedSeasonRewards: Array.from(new Set(
            profile.earnedSeasonRewards
                .map((skinId) => canonicalizeSkinId(skinId))
                .filter((skinId): skinId is SkinId => skinId !== null && RANKED_SKIN_ID_SET.has(skinId))
        )),
        skinItemCounts,
        claimedLeaderboardRewards: { ...(profile.claimedLeaderboardRewards || {}) },
    });
};

const getDefaultSettingsButtonPosition = () => ({
    x: SETTINGS_FLOAT_BUTTON_MARGIN,
    y: Math.max(
        SETTINGS_FLOAT_BUTTON_MARGIN,
        window.innerHeight - SETTINGS_FLOAT_BUTTON_SIZE - SETTINGS_FLOAT_BUTTON_MARGIN
    )
});

const readSavedSettingsButtonPosition = () => {
    const defaults = getDefaultSettingsButtonPosition();

    if (typeof window === 'undefined') {
        return defaults;
    }

    try {
        const raw = window.localStorage.getItem(SETTINGS_FLOAT_BUTTON_STORAGE_KEY);
        if (!raw) return defaults;

        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        return {
            x: Number.isFinite(parsed.x) ? parsed.x! : defaults.x,
            y: Number.isFinite(parsed.y) ? parsed.y! : defaults.y
        };
    } catch {
        return defaults;
    }
};

const emitBootStatus = (status: string, detail: string) => {
    window.dispatchEvent(new CustomEvent('ag:boot-status', { detail: { status, detail } }));
};

const STEAM_STAT_NAMES = Object.values(STEAM_STAT_KEYS);

const buildHostEndpoint = (host: string, port: string): string => {
    const cleanHost = host.trim();
    const cleanPort = (port || '3001').trim() || '3001';

    if (cleanHost.startsWith('[') || !cleanHost.includes(':')) {
        return `http://${cleanHost}:${cleanPort}`;
    }

    // Raw IPv6 without [] needs bracketing in URLs.
    return `http://[${cleanHost}]:${cleanPort}`;
};

const normalizeNetworkEndpoint = (rawValue?: string | null): string | null => {
    if (!rawValue) return null;

    let value = rawValue.trim();
    if (!value) return null;

    if (value.startsWith('PLAYIT:')) {
        const parts = value.split(':');
        if (parts.length < 3) return null;
        value = `http://${parts[1]}:${parts[2]}`;
    }

    if (value.startsWith('ws://')) {
        value = `http://${value.slice('ws://'.length)}`;
    } else if (value.startsWith('wss://')) {
        value = `https://${value.slice('wss://'.length)}`;
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }

    // Host:port without scheme
    if (/^[^/\s]+:\d+$/.test(value) || /^\[[^\]]+\]:\d+$/.test(value)) {
        return `http://${value}`;
    }

    return null;
};

const getCurrentRendererOrigin = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const { protocol, origin } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') {
        return null;
    }

    return normalizeNetworkEndpoint(origin);
};

const getCurrentReadyEndpoint = (): string | null => {
    if (connectionManager.getState().phase !== 'READY') {
        return null;
    }

    return normalizeNetworkEndpoint(connectionManager.getState().url)
        || normalizeNetworkEndpoint((socket as any).io?.uri);
};

const isReadyOnEndpoint = (targetUrl?: string | null): boolean => {
    const normalizedTarget = normalizeNetworkEndpoint(targetUrl);
    if (!normalizedTarget) {
        return false;
    }

    return getCurrentReadyEndpoint() === normalizedTarget;
};

const getStatisticsFreshness = (statistics: PlayerStatistics): number => {
    const timestamp = statistics.updatedAt || statistics.lastPlayedAt;
    if (timestamp) {
        const parsed = Date.parse(timestamp);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return bucketMatches(statistics.lifetime);
};

const choosePreferredStatistics = (
    fileStatistics: PlayerStatistics | null,
    backupStatistics: PlayerStatistics | null
): PlayerStatistics | null => {
    if (!fileStatistics) return backupStatistics;
    if (!backupStatistics) return fileStatistics;

    const fileFreshness = getStatisticsFreshness(fileStatistics);
    const backupFreshness = getStatisticsFreshness(backupStatistics);

    if (backupFreshness > fileFreshness) {
        return backupStatistics;
    }

    if (fileFreshness > backupFreshness) {
        return fileStatistics;
    }

    return bucketMatches(backupStatistics.lifetime) > bucketMatches(fileStatistics.lifetime)
        ? backupStatistics
        : fileStatistics;
};

const readStatisticsBackup = (): PlayerStatistics | null => {
    try {
        const raw = window.localStorage.getItem(LOCAL_STATISTICS_BACKUP_KEY);
        if (!raw) {
            return null;
        }

        return normalizePlayerStatistics(JSON.parse(raw));
    } catch (error) {
        console.warn('[Stats] Failed to read local statistics backup.', error);
        return null;
    }
};

const writeStatisticsBackup = (statistics: PlayerStatistics) => {
    try {
        window.localStorage.setItem(LOCAL_STATISTICS_BACKUP_KEY, JSON.stringify(statistics));
    } catch (error) {
        console.warn('[Stats] Failed to write local statistics backup.', error);
    }
};

const timeoutConnectAttempt = async (
    targetUrl: string,
    timeoutMs: number
): Promise<{ success: boolean; error?: string }> => {
    return connectToServer(targetUrl, timeoutMs);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown error';
};

const createDiagnosticsTimestamp = () => (
    new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
);

const openExternalUrl = async (url: string, fallbackUrl?: string) => {
    const electronRequire = (window as any).require;
    if (electronRequire) {
        try {
            const { shell } = electronRequire('electron');
            if (shell?.openExternal) {
                await shell.openExternal(url);
                return;
            }
        } catch (error) {
            console.warn('[App] Failed to open external URL through Electron shell.', error);
        }
    }

    window.open(fallbackUrl || url, '_blank', 'noopener,noreferrer');
};

type CampaignLevelConfig = {
    id: string;
    name: string;
    mapType: string;
    botCount: number;
    difficulty: number;
    description: string;
    isTutorial?: boolean;
    cardBadge?: string;
    modeLabel?: string;
    startingResources?: {
        gold: number;
        oil: number;
    };
};

const CAMPAIGN_LEVELS: CampaignLevelConfig[] = [
    {
        id: 'tutorial',
        name: 'Tutorial',
        mapType: 'islands',
        botCount: 0,
        difficulty: 1,
        description: 'Choose desert, grasslands, or islands and learn the exact economy, oil, dock, scanner, and logistics flow for that map before the real campaign starts.',
        isTutorial: true,
        cardBadge: 'New',
        modeLabel: 'Guided Sandbox',
        startingResources: { gold: 8000, oil: 3000 }
    },
    {
        id: 'the-beginning',
        name: 'The Beginning',
        mapType: 'islands',
        botCount: 1,
        difficulty: 1,
        description: 'Your first conquest. Defeat the weak local resistance.'
    },
    {
        id: 'grassy-plains',
        name: 'Grassy Plains',
        mapType: 'grasslands',
        botCount: 2,
        difficulty: 3,
        description: 'Two factions fight for control. Crush them both.'
    },
    {
        id: 'desert-storm',
        name: 'Desert Storm',
        mapType: 'desert',
        botCount: 3,
        difficulty: 5,
        description: 'Resource rich desert. The enemy is smarter now.'
    },
    {
        id: 'island-hopping',
        name: 'Island Hopping',
        mapType: 'islands',
        botCount: 4,
        difficulty: 7,
        description: 'A chaotic archipelago war. Speed is key.'
    },
    {
        id: 'world-domination',
        name: 'World Domination',
        mapType: 'random',
        botCount: 5,
        difficulty: 10,
        description: 'The final test. Face the elite coalition.'
    }
];

const FIRST_STANDARD_CAMPAIGN_INDEX = Math.max(0, CAMPAIGN_LEVELS.findIndex((level) => !level.isTutorial));
const STANDARD_CAMPAIGN_STAGE_COUNT = CAMPAIGN_LEVELS.filter((level) => !level.isTutorial).length;

const clampCampaignLevelIndex = (levelIndex: number) => (
    Math.min(CAMPAIGN_LEVELS.length - 1, Math.max(0, levelIndex))
);

const getStandardCampaignStageNumber = (levelIndex: number) => {
    const clampedLevelIndex = clampCampaignLevelIndex(levelIndex);
    return CAMPAIGN_LEVELS
        .slice(0, clampedLevelIndex + 1)
        .filter((level) => !level.isTutorial)
        .length;
};

const getCampaignProgressLabel = (levelIndex: number) => {
    const level = CAMPAIGN_LEVELS[clampCampaignLevelIndex(levelIndex)];
    if (!level) {
        return `Stage 1 / ${STANDARD_CAMPAIGN_STAGE_COUNT}`;
    }

    if (level.isTutorial) {
        return 'Tutorial';
    }

    return `Stage ${getStandardCampaignStageNumber(levelIndex)} / ${STANDARD_CAMPAIGN_STAGE_COUNT}`;
};

const getCampaignCompletionHeading = (levelIndex: number) => {
    const level = CAMPAIGN_LEVELS[clampCampaignLevelIndex(levelIndex)];
    if (!level) {
        return 'Stage Complete';
    }

    if (level.isTutorial) {
        return 'Tutorial Complete';
    }

    return `Stage ${getStandardCampaignStageNumber(levelIndex)} Complete`;
};

function App() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const electronRequire = typeof window !== 'undefined' ? (window as any).require : null;
    const ipc = electronRequire ? electronRequire('electron').ipcRenderer : null;
    const isElectronRuntime = Boolean((window as any).process?.versions?.electron)
        || (
            typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
        )
        || Boolean((window as any).api);
    const [lastJoinedRoom, setLastJoinedRoom] = useState<string | null>(null);
    const [gameStatus, setGameStatus] = useState<string>('waiting');

    // Campaign State
    const [isCampaignMode, setIsCampaignMode] = useState(false);
    const [isTutorialMode, setIsTutorialMode] = useState(false);
    const [selectedTutorialMap, setSelectedTutorialMap] = useState<TutorialMapType>(DEFAULT_TUTORIAL_MAP);
    const [showTutorialMapPicker, setShowTutorialMapPicker] = useState(false);
    const [pendingTutorialLevelIndex, setPendingTutorialLevelIndex] = useState<number | null>(null);
    const [isLocalMode, setIsLocalMode] = useState(false); // Campaign or Custom
    const [campaignLevel, setCampaignLevel] = useState(0);
    const [showCampaignModal, setShowCampaignModal] = useState<'victory' | 'defeat' | null>(null);
    const [statistics, setStatistics] = useState<PlayerStatistics>(createDefaultPlayerStatistics);
    const statisticsRef = useRef<PlayerStatistics>(createDefaultPlayerStatistics());
    const [achievementUnlocks, setAchievementUnlocks] = useState<AchievementUnlockState>(createDefaultAchievementUnlockState);
    const achievementUnlocksRef = useRef<AchievementUnlockState>(createDefaultAchievementUnlockState());
    const [skinsProfile, setSkinsProfile] = useState<PlayerSkinProfile>(createDefaultPlayerSkinProfile);
    const skinsProfileRef = useRef<PlayerSkinProfile>(createDefaultPlayerSkinProfile());
    const [commanderProfile, setCommanderProfile] = useState<CommanderProfile>(createDefaultCommanderProfile);
    const commanderProfileRef = useRef<CommanderProfile>(createDefaultCommanderProfile());
    const [didLoadSave, setDidLoadSave] = useState(false);
    const [matchStatsSource, setMatchStatsSource] = useState<MatchSource>('lan');
    const [isRankedMatch, setIsRankedMatch] = useState(false);

    // New Menu States
    const [menuView, setMenuView] = useState<'main' | 'campaign' | 'multiplayer' | 'host_public' | 'statistics' | 'skins' | 'leaderboards'>('main');
    const [showPatchNotes, setShowPatchNotes] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settingsButtonPos, setSettingsButtonPos] = useState(readSavedSettingsButtonPosition);
    const [isDraggingSettingsButton, setIsDraggingSettingsButton] = useState(false);
    const [customConfig, setCustomConfig] = useState({
        mapType: 'islands',
        botCount: 5,
        difficulty: 5
    });
    const settingsButtonDragOffset = useRef({ x: 0, y: 0 });
    const settingsButtonMouseDownOrigin = useRef({ x: 0, y: 0 });
    const settingsButtonMovedRef = useRef(false);
    const suppressSettingsButtonClickRef = useRef(false);

    const clientMatchState = useRef<'LOBBY' | 'STARTING' | 'IN_MATCH'>('LOBBY');
    const matchStartedAtRef = useRef<number | null>(null);

    // Host Public State
    const [localPort, setLocalPort] = useState("3001");
    const [publicEndpoint, setPublicEndpoint] = useState("");
    const [generatedJoinCode, setGeneratedJoinCode] = useState("");

    // DEV Feature: Toggle UI Visibility & Bypass
    const [isUIVisible, setIsUIVisible] = useState(true);
    const [isDevBypass, setIsDevBypass] = useState(false);
    const localEngineUrlRef = useRef<string>('http://127.0.0.1:3001');
    const bootSplashReleasedRef = useRef(false);
    const localEngineBootSequenceRef = useRef(0);
    const [isLocalEngineReady, setIsLocalEngineReady] = useState(false);
    const [isLocalEngineBooting, setIsLocalEngineBooting] = useState(false);
    const [localEngineBootError, setLocalEngineBootError] = useState<string | null>(null);
    const [steamError, setSteamError] = useState<string | null>(null);
    const [steamUser, setSteamUser] = useState<{ name: string, steamId: string } | null>(null);
    const [steamLobbyId, setSteamLobbyId] = useState<string | null>(null);
    const [steamLobbyRole, setSteamLobbyRole] = useState<'host' | 'guest' | null>(null);
    const [creatingSteamLobby, setCreatingSteamLobby] = useState(false);
    const [isRankedQueueing, setIsRankedQueueing] = useState(false);
    const creatingSteamLobbyRef = useRef(false);
    const pendingSteamLobbyConfigRef = useRef<PendingSteamLobbyConfig | null>(null);
    const activeSteamRelaySessionRef = useRef<string | null>(null);
    const [steamDiagnostics, setSteamDiagnostics] = useState<SteamMultiplayerDiagnostics>(createDefaultSteamMultiplayerDiagnostics);

    const formatSteamInviteSurface = (method?: string | null) => {
        switch (method) {
            case 'native-overlay-invite-dialog':
            case 'overlay-invite':
                return 'Steam Overlay Invite Dialog';
            case 'overlay-plus-steam-client':
                return 'Steam Overlay + Friends Window';
            case 'steam-client-friends':
                return 'Steam Friends Window';
            default:
                return null;
        }
    };

    const updateSteamDiagnostics = (
        updater: Partial<SteamMultiplayerDiagnostics> | ((previous: SteamMultiplayerDiagnostics) => Partial<SteamMultiplayerDiagnostics>)
    ) => {
        setSteamDiagnostics((previous) => {
            const patch = typeof updater === 'function' ? updater(previous) : updater;
            return {
                ...previous,
                ...patch,
                updatedAt: patch.updatedAt === undefined ? previous.updatedAt : patch.updatedAt,
            };
        });
    };

    const pushSteamDiagnosticsEvent = (
        message: string,
        patch: Partial<SteamMultiplayerDiagnostics> = {}
    ) => {
        setSteamDiagnostics((previous) => {
            const event = {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                at: createDiagnosticsTimestamp(),
                message,
            };

            return {
                ...previous,
                ...patch,
                updatedAt: new Date().toISOString(),
                events: [event, ...previous.events].slice(0, 8),
            };
        });
    };

    const clampSettingsButtonPosition = (position: { x: number; y: number }) => ({
        x: Math.max(0, Math.min(position.x, window.innerWidth - SETTINGS_FLOAT_BUTTON_SIZE)),
        y: Math.max(0, Math.min(position.y, window.innerHeight - SETTINGS_FLOAT_BUTTON_SIZE))
    });

    useEffect(() => {
        const handleResize = () => {
            setSettingsButtonPos((current) => clampSettingsButtonPosition(current));
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleSettingsButtonMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        setIsDraggingSettingsButton(true);
        settingsButtonDragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        settingsButtonMouseDownOrigin.current = {
            x: e.clientX,
            y: e.clientY
        };
        settingsButtonMovedRef.current = false;
    };

    const handleSettingsButtonClick = () => {
        if (suppressSettingsButtonClickRef.current) {
            suppressSettingsButtonClickRef.current = false;
            return;
        }

        setShowSettings(true);
    };

    useEffect(() => {
        if (!isDraggingSettingsButton) return;

        const handleMouseMove = (e: MouseEvent) => {
            const distance = Math.hypot(
                e.clientX - settingsButtonMouseDownOrigin.current.x,
                e.clientY - settingsButtonMouseDownOrigin.current.y
            );

            if (distance > 4) {
                settingsButtonMovedRef.current = true;
            }

            if (!settingsButtonMovedRef.current) {
                return;
            }

            setSettingsButtonPos(clampSettingsButtonPosition({
                x: e.clientX - settingsButtonDragOffset.current.x,
                y: e.clientY - settingsButtonDragOffset.current.y
            }));
        };

        const handleMouseUp = () => {
            if (settingsButtonMovedRef.current) {
                suppressSettingsButtonClickRef.current = true;
            }
            setIsDraggingSettingsButton(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingSettingsButton]);

    useEffect(() => {
        try {
            window.localStorage.setItem(SETTINGS_FLOAT_BUTTON_STORAGE_KEY, JSON.stringify(settingsButtonPos));
        } catch {
            // Keep the runtime position even if persistence is unavailable.
        }
    }, [settingsButtonPos]);

    const requestLocalServerStart = async () => {
        if (!ipc?.invoke) {
            const fallbackStatus = await ensureRendererManagedLocalServerRunning();
            if (fallbackStatus?.port) {
                localEngineUrlRef.current = `http://127.0.0.1:${fallbackStatus.port}`;
            }
            if (fallbackStatus?.success && fallbackStatus?.ready) {
                return true;
            }
            setLocalEngineBootError(fallbackStatus?.error || 'Local game engine failed to start.');
            return false;
        }

        try {
            const status = await ipc.invoke('local-server-start');
            if (status?.port) {
                localEngineUrlRef.current = `http://127.0.0.1:${status.port}`;
            }

            if (status?.success && status?.ready) {
                return true;
            }

            console.warn('[App] Electron local-server-start returned a non-ready state.', status);
            setLocalEngineBootError(status?.error || 'Local game engine failed to start.');
            return false;
        } catch (error) {
            if (isMissingIpcHandlerError(error, 'local-server-start')) {
                console.warn('[App] local-server-start IPC handler missing. Falling back to renderer-managed local server.');
                const fallbackStatus = await ensureRendererManagedLocalServerRunning();
                if (fallbackStatus?.port) {
                    localEngineUrlRef.current = `http://127.0.0.1:${fallbackStatus.port}`;
                }
                if (fallbackStatus?.success && fallbackStatus?.ready) {
                    return true;
                }
                setLocalEngineBootError(fallbackStatus?.error || 'Local game engine failed to start.');
                return false;
            }
            console.warn('[App] Failed to request local server start.', error);
            setLocalEngineBootError(getErrorMessage(error));
            return false;
        }
    };

    const requestLocalServerStop = async () => {
        if (!ipc?.invoke) {
            await stopRendererManagedLocalServer();
            return;
        }

        try {
            const status = await ipc.invoke('local-server-stop');
            if (status?.error) {
                console.warn('[App] Electron local-server-stop returned a warning.', status);
            }
        } catch (error) {
            if (isMissingIpcHandlerError(error, 'local-server-stop')) {
                console.warn('[App] local-server-stop IPC handler missing. Falling back to renderer-managed local server shutdown.');
                await stopRendererManagedLocalServer();
                return;
            }
            console.warn('[App] Failed to request local server stop.', error);
        }
    };

    const waitForLocalServerReachability = async (maxWaitMs: number): Promise<boolean> => {
        const localEngineUrl = normalizeNetworkEndpoint(localEngineUrlRef.current);
        const currentOrigin = getCurrentRendererOrigin();

        if (localEngineUrl && currentOrigin === localEngineUrl) {
            console.log('[App] Renderer is already running from the local engine origin:', localEngineUrl);
            return true;
        }

        if (!ipc?.invoke) {
            const status = await getRendererManagedLocalServerStatus();
            if (status?.port) {
                localEngineUrlRef.current = `http://127.0.0.1:${status.port}`;
            }
            return Boolean(status?.ready);
        }

        const startedAt = Date.now();

        while ((Date.now() - startedAt) < maxWaitMs) {
            try {
                let status: LocalServerStatus;
                try {
                    status = await ipc.invoke('local-server-status');
                } catch (error) {
                    if (!isMissingIpcHandlerError(error, 'local-server-status')) {
                        throw error;
                    }
                    console.warn('[App] local-server-status IPC handler missing. Falling back to renderer-managed local server status.');
                    status = await getRendererManagedLocalServerStatus();
                }
                if (status?.port) {
                    localEngineUrlRef.current = `http://127.0.0.1:${status.port}`;
                }
                if (status?.ready) {
                    console.log('[App] Local backend reported reachable via IPC status check.', status);
                    return true;
                }
            } catch (error) {
                console.warn('[App] Failed to query local server status.', error);
            }

            const remainingMs = maxWaitMs - (Date.now() - startedAt);
            if (remainingMs <= 0) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, Math.min(250, remainingMs)));
        }

        return false;
    };

    const handleWishlistClick = () => {
        void openExternalUrl(MAIN_GAME_STEAM_DEEP_LINK, MAIN_GAME_STEAM_STORE_URL);
    };

    const handleRequestChangesClick = () => {
        void openExternalUrl(REQUEST_CHANGES_DISCUSSION_URL);
    };

    const handleEquipSkin = (target: SkinTarget, skinId: SkinId) => {
        if (!unlockedSkinIds.has(skinId)) {
            return;
        }

        const nextProfile: PlayerSkinProfile = withSkinLoadoutEnhancements({
            ...skinsProfileRef.current,
            loadout: {
                ...skinsProfileRef.current.loadout,
                unitSkinId: target === 'unit' ? skinId : skinsProfileRef.current.loadout.unitSkinId,
                buildingSkinId: target === 'building' ? skinId : skinsProfileRef.current.loadout.buildingSkinId,
            },
        });

        void commitSkinsProfile(nextProfile);
    };

    const unlockAchievementsByIds = async (
        achievementIds: string[],
        unlockedAt: string = new Date().toISOString()
    ) => {
        const idsToUnlock = Array.from(new Set(achievementIds)).filter((achievementId) => (
            !achievementUnlocksRef.current.unlockedAtById[achievementId]
        ));

        if (idsToUnlock.length === 0) {
            return [];
        }

        const nextState: AchievementUnlockState = {
            ...achievementUnlocksRef.current,
            unlockedAtById: {
                ...achievementUnlocksRef.current.unlockedAtById,
            },
        };

        idsToUnlock.forEach((achievementId) => {
            nextState.unlockedAtById[achievementId] = unlockedAt;
        });

        await commitAchievementUnlocks(nextState);

        if (steamService.isInitialized) {
            idsToUnlock.forEach((achievementId) => {
                steamService.activateAchievement(achievementId);
            });
        }

        await grantProfileStars(idsToUnlock.length * ACHIEVEMENT_STAR_REWARD, unlockedAt);

        return idsToUnlock;
    };

    const unlockAchievementById = async (
        achievementId: string,
        unlockedAt: string = new Date().toISOString()
    ) => {
        const unlocked = await unlockAchievementsByIds([achievementId], unlockedAt);
        return unlocked.length > 0;
    };

    const commitStatistics = async (nextStatistics: PlayerStatistics) => {
        statisticsRef.current = nextStatistics;
        setStatistics(nextStatistics);
        writeStatisticsBackup(nextStatistics);
        await triggerSave({ statistics: nextStatistics });
        return nextStatistics;
    };

    const commitAchievementUnlocks = async (nextAchievementUnlocks: AchievementUnlockState) => {
        achievementUnlocksRef.current = nextAchievementUnlocks;
        setAchievementUnlocks(nextAchievementUnlocks);
        await triggerSave({ achievements: nextAchievementUnlocks });
        return nextAchievementUnlocks;
    };

    const commitSkinsProfile = async (nextSkinsProfile: PlayerSkinProfile) => {
        const normalizedSkinsProfile = withSkinLoadoutEnhancements(nextSkinsProfile);
        skinsProfileRef.current = normalizedSkinsProfile;
        setSkinsProfile(normalizedSkinsProfile);
        await triggerSave({ skins: normalizedSkinsProfile });
        return normalizedSkinsProfile;
    };

    const commitCommanderProfile = async (nextCommanderProfile: CommanderProfile) => {
        const normalizedCommanderProfile = normalizeCommanderProfile(nextCommanderProfile);
        commanderProfileRef.current = normalizedCommanderProfile;
        setCommanderProfile(normalizedCommanderProfile);
        writeProfileBackup(normalizedCommanderProfile);
        await triggerSave({ profile: normalizedCommanderProfile });
        return normalizedCommanderProfile;
    };

    const grantProfileStars = async (
        amount: number,
        timestamp: string = new Date().toISOString()
    ) => {
        if (amount <= 0) {
            return commanderProfileRef.current;
        }

        return commitCommanderProfile(awardStars(commanderProfileRef.current, amount, timestamp));
    };

    const handleChangeDisplayName = async (nextName: string) => {
        const result = spendStarsOnNameChange(commanderProfileRef.current, nextName);
        if (!result.success || !result.profile) {
            return { success: false, error: result.error || 'Unable to update commander name.' };
        }

        const savedProfile = await commitCommanderProfile(result.profile);
        if (savedProfile.displayName) {
            socket.emit('set_player_name', savedProfile.displayName);
        }

        return { success: true };
    };

    const pushStatisticsToSteam = async (baseStatistics: PlayerStatistics) => {
        if (!steamService.isInitialized) {
            return baseStatistics;
        }

        const attemptedAt = new Date().toISOString();
        const attemptSnapshot = withSteamSyncState(baseStatistics, {
            lastAttemptAt: attemptedAt,
            lastError: null,
        });
        await commitStatistics(attemptSnapshot);

        const result = await steamService.setStats(toSteamStatPayload(attemptSnapshot));
        const finishedAt = new Date().toISOString();
        const syncedSnapshot = withSteamSyncState(attemptSnapshot, result.success && result.stored
            ? {
                available: true,
                lastSuccessAt: finishedAt,
                lastError: null,
            }
            : {
                available: false,
                lastError: result.error || 'Steam did not confirm stat storage.',
            });

        await commitStatistics(syncedSnapshot);
        return syncedSnapshot;
    };

    const pushLeaderboardsToSteam = async (
        statisticsSnapshot: PlayerStatistics,
        summary: MatchStatisticsSummary,
        matchDurationMs: number | null
    ) => {
        if (!steamService.isInitialized) {
            return;
        }

        const uploads = buildLeaderboardUploadCandidates(statisticsSnapshot, summary, matchDurationMs);
        if (uploads.length === 0) {
            return;
        }

        await Promise.all(uploads.map(async ({ definition, score }) => {
            const result = await steamService.setLeaderboardScore({
                name: definition.steamName,
                score,
                sortMethod: definition.sortMethod,
                displayType: definition.displayType,
                uploadMethod: 'keep_best',
            });

            if (!result.success) {
                console.warn(`[Steam] Failed to update leaderboard ${definition.steamName}:`, result.error);
                return;
            }

            const rewardSkinId = getLeaderboardSkinRewardForRank(result.rank);
            if (rewardSkinId && result.rank) {
                await handleLeaderboardRewardEligible({
                    leaderboardId: definition.id,
                    leaderboardTitle: definition.title,
                    rewardSkinId,
                    rank: result.rank,
                });
            }
        }));
    };

    const handleLeaderboardRewardEligible = async (reward: {
        leaderboardId: LeaderboardMetricId;
        leaderboardTitle: string;
        rewardSkinId: SkinId;
        rank: number;
    }) => {
        if (!LEADERBOARD_REWARD_SKIN_ID_SET.has(reward.rewardSkinId)) {
            return;
        }

        const claimKey = `${reward.leaderboardId}:${reward.rewardSkinId}`;
        const currentProfile = skinsProfileRef.current;
        if (currentProfile.claimedLeaderboardRewards?.[claimKey]) {
            return;
        }

        const nextProfile = withSkinLoadoutEnhancements({
            ...currentProfile,
            skinItemCounts: {
                ...(currentProfile.skinItemCounts || {}),
                [reward.rewardSkinId]: getSkinCopyCount(currentProfile, reward.rewardSkinId) + 1,
            },
            claimedLeaderboardRewards: {
                ...(currentProfile.claimedLeaderboardRewards || {}),
                [claimKey]: `Rank #${reward.rank} on ${reward.leaderboardTitle} at ${new Date().toISOString()}`,
            },
        });

        await commitSkinsProfile(nextProfile);

        const steamItem = STEAM_SKIN_ITEM_DEFS[reward.rewardSkinId];
        if (steamItem && steamService.isInitialized) {
            const result = await steamService.requestInventoryItemGrant([steamItem.itemDefId]);
            if (!result.success) {
                console.warn('[Steam] Skin item grant queued locally but Steam Inventory did not confirm:', result.error);
            }
        }
    };

    const evaluatedAchievements = evaluateAchievements(
        { statistics },
        achievementUnlocks
    );
    const commanderDisplayName = useMemo(
        () => commanderProfile.displayName || steamUser?.name || 'Commander',
        [commanderProfile.displayName, steamUser?.name]
    );

    const unlockedAchievementCount = useMemo(
        () => evaluatedAchievements.filter((achievement) => achievement.unlocked).length,
        [evaluatedAchievements]
    );
    const totalAchievementCount = evaluatedAchievements.length;
    const hasDeveloperSkinAccess = useMemo(
        () => canUseDeveloperSkin(steamUser),
        [steamUser?.name, steamUser?.steamId]
    );
    const unlockedSkinIds = useMemo(
        () => getUnlockedSkinIds(skinsProfile, unlockedAchievementCount, totalAchievementCount, hasDeveloperSkinAccess),
        [skinsProfile, unlockedAchievementCount, totalAchievementCount, hasDeveloperSkinAccess]
    );
    const unlockedProfileBadgeVariants = useMemo(() => {
        const badgeVariants = new Set<ProfileBadgeVariant>(['default']);
        unlockedSkinIds.forEach((skinId) => {
            const badgeVariant = PROFILE_BADGE_BY_SKIN_ID[skinId];
            if (badgeVariant) {
                badgeVariants.add(badgeVariant);
            }
        });

        const highestRankedPoints = Math.max(statistics.rankedProgress.points, statistics.rankedProgress.bestPoints);
        if (highestRankedPoints >= 100) badgeVariants.add('gold');
        if (highestRankedPoints >= 200) badgeVariants.add('platinum');
        if (highestRankedPoints >= 300) badgeVariants.add('topaz');
        if (highestRankedPoints >= 400) badgeVariants.add('diamond');
        if (highestRankedPoints >= 500) badgeVariants.add('obsidian');
        if (highestRankedPoints >= 600) badgeVariants.add('godly');

        return Array.from(badgeVariants);
    }, [statistics.rankedProgress.bestPoints, statistics.rankedProgress.points, unlockedSkinIds]);

    const handleSelectProfileBadge = async (badgeVariant: ProfileBadgeVariant | null) => {
        await commitCommanderProfile(setProfileBadgeVariant(
            commanderProfileRef.current,
            badgeVariant,
            unlockedProfileBadgeVariants
        ));
    };

    const releaseBootSplash = (delayMs: number = 320) => {
        if (bootSplashReleasedRef.current) {
            return;
        }

        bootSplashReleasedRef.current = true;
        window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('ag:boot-ready'));
        }, delayMs);
    };

    useEffect(() => {
        emitBootStatus(
            'Launching command deck...',
            'Synchronising Steam systems, renderer, and local battlefield services.'
        );

        // Initial connection to local/default server
        const initialUrl = (socket as any).io.uri;
        localEngineUrlRef.current = initialUrl;
        console.log('[App] Initial local engine target:', initialUrl);

        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            socket.emit('joinByCode', roomParam);
            setLastJoinedRoom(roomParam);
            setIsPlaying(true);
        }
    }, []);

    useEffect(() => {
        const resumeAudio = () => {
            void soundEffectsManager.resume();
        };

        const handleButtonClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const button = target.closest('button');
            if (!(button instanceof HTMLButtonElement) || button.disabled || button.dataset.sfx === 'off') {
                return;
            }

            soundEffectsManager.playButtonClick(soundEffectsManager.getButtonVariant(button));
        };

        window.addEventListener('pointerdown', resumeAudio, true);
        window.addEventListener('keydown', resumeAudio, true);
        document.addEventListener('click', handleButtonClick, true);

        return () => {
            window.removeEventListener('pointerdown', resumeAudio, true);
            window.removeEventListener('keydown', resumeAudio, true);
            document.removeEventListener('click', handleButtonClick, true);
        };
    }, []);

    useEffect(() => {
        if (publicEndpoint) {
            // Simple validation and generation
            const clean = publicEndpoint.replace('http://', '').replace('https://', '').replace('/', '');
            setGeneratedJoinCode(`PLAYIT:${clean}`);
        } else {
            setGeneratedJoinCode("");
        }
    }, [publicEndpoint]);


    useEffect(() => {
        // Notify MainScene about menu mode
        const isMenuMode = !isPlaying || gameStatus !== 'playing';
        (window as any).gameMenuMode = isMenuMode;
        const event = new CustomEvent('game-menu-mode', { detail: isMenuMode });
        window.dispatchEvent(event);
    }, [isPlaying, gameStatus]);

    // Reconnection Logic
    useEffect(() => {
        const unsubscribe = connectionManager.subscribe((state) => {
            updateSteamDiagnostics({
                connectionPhase: state.phase,
                connectionUrl: normalizeNetworkEndpoint(state.url),
                lastError: state.phase === 'FAILED'
                    ? (state.error || state.details || null)
                    : state.phase === 'READY'
                        ? null
                        : undefined,
                updatedAt: new Date().toISOString(),
            });

            if (!bootSplashReleasedRef.current) {
                if (state.phase === 'CONNECTING') {
                    emitBootStatus(
                        'Opening local command uplink...',
                        'Starting the embedded server and bringing the simulation online.'
                    );
                } else if (state.phase === 'HANDSHAKING') {
                    emitBootStatus(
                        'Synchronising battlefield systems...',
                        'Waiting for the local engine handshake to complete.'
                    );
                } else if (state.phase === 'READY') {
                    emitBootStatus(
                        'Local command uplink online.',
                        'Finalising startup and preparing the main menu.'
                    );
                }
            }

            // Suppress FAILED state if we are in local/campaign mode to allow "serverless" feel
            if (state.phase === 'FAILED' && (isCampaignMode || isLocalMode)) {
                console.warn('[App] Connection failed but suppressed for local mode.');
                return;
            }

            // If we successfully reconnected (READY) and we were playing
            if (state.phase === 'READY' && isPlaying && lastJoinedRoom) {
                console.log('[App] Reconnected! Attempting to rejoin room:', lastJoinedRoom);
                socket.emit('joinByCode', lastJoinedRoom);
                socket.emit('request_game_state');
            }
        });
        return unsubscribe;
    }, [isPlaying, lastJoinedRoom, isCampaignMode, isLocalMode]);

    useEffect(() => {
        // Identify connection type is now handled in socket.ts after handshake

        const handleJoinedRoom = (rid: string) => {
            console.log('[CLIENT] joinedRoom:', rid);
            // Do not treat global 'lobby' as a playable Room ID
            if (rid !== 'lobby') {
                setLastJoinedRoom(rid);

                // If we initiated a Steam Lobby Host
                if (creatingSteamLobbyRef.current && pendingSteamLobbyConfigRef.current) {
                    console.log('[App] Creating Steam Lobby for Room:', rid);
                    creatingSteamLobbyRef.current = false;
                    const pendingSteamLobby = pendingSteamLobbyConfigRef.current;
                    pendingSteamLobbyConfigRef.current = null;
                    pushSteamDiagnosticsEvent('Joined local host room, creating Steam lobby.', {
                        flow: pendingSteamLobby.ranked ? 'ranked' : 'hosting',
                        route: 'pending',
                        roomId: rid,
                        lobbyId: null,
                        endpoint: null,
                        relaySessionId: null,
                        lastError: null,
                        status: 'Creating Steam lobby',
                    });

                    (async () => {
                        const hostEndpoint = await resolveSteamHostEndpoint({ preferPublicTunnel: true });
                        const result = await steamService.createLobby(
                            rid,
                            pendingSteamLobby.map,
                            pendingSteamLobby.mode,
                            hostEndpoint || undefined,
                            {
                                lobbyVisibility: pendingSteamLobby.lobbyVisibility,
                                maxMembers: pendingSteamLobby.maxMembers,
                                metadata: pendingSteamLobby.metadata,
                            }
                        );
                        if (!result.success || !result.lobbyId) {
                            return result;
                        }

                        const createdLobbyId = String(result.lobbyId);
                        setSteamLobbyId(createdLobbyId);
                        setSteamLobbyRole('host');
                        setIsRankedMatch(pendingSteamLobby.ranked);
                        steamService.setRichPresence('steam_display', '#Status_WaitingForPlayers');
                        steamService.setRichPresence('connect', `+connect_lobby ${createdLobbyId}`);
                        pushSteamDiagnosticsEvent(
                            pendingSteamLobby.openInviteDialog
                                ? 'Steam lobby created and preparing invite dialog.'
                                : 'Steam lobby created and ready for players.',
                            {
                                flow: pendingSteamLobby.ranked ? 'ranked' : 'hosting',
                                route: 'steam-relay',
                                lobbyId: createdLobbyId,
                                roomId: rid,
                                inviteSurface: null,
                                inviteSurfaceNote: null,
                                endpoint: result.endpoint || hostEndpoint || null,
                                lastError: null,
                                status: pendingSteamLobby.openInviteDialog ? 'Opening Steam invite dialog' : 'Steam lobby ready',
                            }
                        );

                        if (pendingSteamLobby.openInviteDialog) {
                            const inviteResult = await steamService.openInviteDialog(createdLobbyId);
                            if (!inviteResult.success) {
                                pushSteamDiagnosticsEvent('Steam invite UI failed to open.', {
                                    status: 'Steam invite failed',
                                    lastError: inviteResult.error || 'Steam invite dialog unavailable.',
                                    inviteSurface: null,
                                    inviteSurfaceNote: inviteResult.note || null,
                                });
                                console.warn('[App] Failed to open Steam invite UI.', inviteResult.error);
                            } else {
                                const inviteSurface = formatSteamInviteSurface(inviteResult.method);
                                const inviteOpenedMessage = inviteResult.note
                                    || (inviteSurface === 'Steam Friends Window'
                                        ? 'Opened the Steam friends window for inviting.'
                                        : inviteSurface === 'Steam Overlay + Friends Window'
                                            ? 'Requested the Steam invite overlay and opened the Steam friends window as a fallback.'
                                            : 'Steam invite dialog opened.');

                                pushSteamDiagnosticsEvent(inviteOpenedMessage, {
                                    status: inviteSurface === 'Steam Friends Window' || inviteSurface === 'Steam Overlay + Friends Window'
                                        ? 'Steam friends window open'
                                        : 'Steam invite dialog open',
                                    inviteSurface,
                                    inviteSurfaceNote: inviteResult.note || null,
                                    lastError: null,
                                });
                            }
                        }

                        return {
                            ...result,
                            lobbyId: createdLobbyId,
                        };
                    })()
                        .then(res => {
                            if (res.success) {
                                console.log('[App] Steam Lobby Created:', res.lobbyId);
                                pushSteamDiagnosticsEvent('Steam lobby host flow completed.', {
                                    status: 'Waiting for invited players',
                                    lastError: null,
                                });
                            } else {
                                setSteamLobbyId(null);
                                setSteamLobbyRole(null);
                                steamService.setRichPresence('connect', null);
                                if (ipc?.invoke) {
                                    void ipc.invoke('network:close-public-tunnel');
                                }
                                pushSteamDiagnosticsEvent('Steam lobby creation failed.', {
                                    route: 'idle',
                                    status: 'Steam lobby failed',
                                    lastError: res.error || 'Unknown Steam lobby creation error.',
                                });
                                console.error('[App] Failed to create Steam Lobby:', res.error);
                                alert(`Failed to create Steam Lobby: ${res.error || 'Unknown error'}`);
                            }
                        })
                        .catch((err: unknown) => {
                            setSteamLobbyId(null);
                            setSteamLobbyRole(null);
                            steamService.setRichPresence('connect', null);
                            if (ipc?.invoke) {
                                void ipc.invoke('network:close-public-tunnel');
                            }
                            pushSteamDiagnosticsEvent('Steam lobby host setup threw an error.', {
                                route: 'idle',
                                status: 'Steam lobby setup failed',
                                lastError: getErrorMessage(err),
                            });
                            console.error('[App] Steam lobby host setup failed:', err);
                            alert(`Failed to create Steam Lobby: ${getErrorMessage(err)}`);
                        })
                        .finally(() => {
                            setCreatingSteamLobby(false);
                            setIsRankedQueueing(false);
                        });
                } else {
                    // Check if we are just joining?
                    // Update Rich Presence to In-Game
                    steamService.setRichPresence('steam_display', '#Status_InGame');
                    // We don't set connect string here unless we know the lobby ID.
                    // If we joined via Steam, we are good.
                }
            }
            // Reset gate on explicit room join (new room = new state)
            clientMatchState.current = 'LOBBY';
        }
        const handleGameStatus = (status: string) => {
            // Gate: Ignore lobby updates if we are starting or in match
            if (clientMatchState.current !== 'LOBBY') {
                if (status === 'waiting') {
                    console.log(`[CLIENT_GATE] IGNORED LOBBY_UPDATE (waiting) because clientMatchState=${clientMatchState.current}`);
                    return;
                }
            }

            if (status === 'playing') {
                console.log('[CLIENT] entering in-game');
                clientMatchState.current = 'IN_MATCH';
                setIsPlaying(true);
                if (!matchStartedAtRef.current) {
                    matchStartedAtRef.current = Date.now();
                }
            } else if (status === 'waiting') {
                console.log('[CLIENT] returning to lobby reason=server_status_waiting');
                clientMatchState.current = 'LOBBY';
                matchStartedAtRef.current = null;
            }
            setGameStatus(status);
        }
        const handleVoting = () => {
            console.log('[CLIENT] entering loading');
            clientMatchState.current = 'STARTING';
            setGameStatus('voting');
        }
        const handleStarted = () => {
            console.log('[CLIENT] received MATCH_STARTED');
            console.log('[CLIENT] entering in-game');
            clientMatchState.current = 'IN_MATCH';
            setGameStatus('playing');
            setIsPlaying(true);
            if (!matchStartedAtRef.current) {
                matchStartedAtRef.current = Date.now();
            }
            pushSteamDiagnosticsEvent('Match started.', {
                status: 'Match in progress',
            });
        }
        const handleStartFailed = (data: { reason: string }) => {
            console.warn('[CLIENT] MATCH_START_FAILED:', data.reason);
            clientMatchState.current = 'LOBBY';
            setGameStatus('waiting');
            pushSteamDiagnosticsEvent('Match start failed.', {
                status: 'Match start failed',
                lastError: data.reason,
            });
            alert(`Failed to start match: ${data.reason}`);
        };

        const handleRoomJoinFailed = (data: { reason?: string }) => {
            clientMatchState.current = 'LOBBY';
            setGameStatus('waiting');
            setIsPlaying(false);
            setIsRankedQueueing(false);
            matchStartedAtRef.current = null;
            pushSteamDiagnosticsEvent('Room join failed after transport connection.', {
                status: 'Room join failed',
                lastError: data.reason || 'Failed to join room.',
            });
            void leaveActiveSteamLobby();
            alert(data.reason || 'Failed to join room.');
        };

        socket.on('joinedRoom', handleJoinedRoom);
        socket.on('gameStatus', handleGameStatus);
        socket.on('votingUpdate', handleVoting);
        socket.on('gameStarted', handleStarted);
        socket.on('MATCH_START_FAILED', handleStartFailed);
        socket.on('ROOM_JOIN_FAILED', handleRoomJoinFailed);

        // Load initial save data
        const loadSave = async () => {
            const backupStatistics = readStatisticsBackup();
            const backupProfile = readProfileBackup();
            if (!ipc) {
                if (backupStatistics) {
                    statisticsRef.current = backupStatistics;
                    setStatistics(backupStatistics);
                }
                if (backupProfile) {
                    commanderProfileRef.current = backupProfile;
                    setCommanderProfile(backupProfile);
                    writeProfileBackup(backupProfile);
                }
                setDidLoadSave(true);
                return;
            }

            try {
                const res = await ipc.invoke('load-data');
                if (res.success && res.data) {
                    console.log('[App] Loaded Save Data:', res.data);
                    if (res.data.campaignLevel !== undefined) {
                        setCampaignLevel(clampCampaignLevelIndex(res.data.campaignLevel));
                    }
                    {
                        const fileStatistics = res.data.statistics !== undefined
                            ? normalizePlayerStatistics(res.data.statistics)
                            : null;
                        const loadedStatistics = choosePreferredStatistics(fileStatistics, backupStatistics);
                        if (loadedStatistics) {
                            statisticsRef.current = loadedStatistics;
                            setStatistics(loadedStatistics);
                            writeStatisticsBackup(loadedStatistics);
                        }
                    }
                    if (res.data.achievements !== undefined) {
                        const loadedAchievements = normalizeAchievementUnlockState(res.data.achievements);
                        achievementUnlocksRef.current = loadedAchievements;
                        setAchievementUnlocks(loadedAchievements);
                    }
                    if (res.data.skins !== undefined) {
                        const loadedSkinsProfile = normalizePlayerSkinProfile(res.data.skins);
                        skinsProfileRef.current = loadedSkinsProfile;
                        setSkinsProfile(loadedSkinsProfile);
                    }
                    if (res.data.profile !== undefined) {
                        const loadedProfile = normalizeCommanderProfile(res.data.profile);
                        commanderProfileRef.current = loadedProfile;
                        setCommanderProfile(loadedProfile);
                        writeProfileBackup(loadedProfile);
                    } else if (backupProfile) {
                        commanderProfileRef.current = backupProfile;
                        setCommanderProfile(backupProfile);
                        writeProfileBackup(backupProfile);
                    }
                } else {
                    if (backupStatistics) {
                        statisticsRef.current = backupStatistics;
                        setStatistics(backupStatistics);
                        writeStatisticsBackup(backupStatistics);
                    }
                    if (backupProfile) {
                        commanderProfileRef.current = backupProfile;
                        setCommanderProfile(backupProfile);
                        writeProfileBackup(backupProfile);
                    }
                }
            } finally {
                setDidLoadSave(true);
            }
        };
        loadSave();

        return () => {
            socket.off('joinedRoom', handleJoinedRoom);
            socket.off('gameStatus', handleGameStatus);
            socket.off('votingUpdate', handleVoting);
            socket.off('gameStarted', handleStarted);
            socket.off('MATCH_START_FAILED', handleStartFailed);
            socket.off('ROOM_JOIN_FAILED', handleRoomJoinFailed);
        };
    }, [ipc]); // Dependency on ipc to ensure it runs when available

    const triggerSave = async (data: any) => {
        if (ipc) {
            await ipc.invoke('save-data', data);
        }
    };

    useEffect(() => {
        statisticsRef.current = statistics;
    }, [statistics]);

    useEffect(() => {
        achievementUnlocksRef.current = achievementUnlocks;
    }, [achievementUnlocks]);

    useEffect(() => {
        const normalizedProfile = normalizeCommanderProfile(commanderProfile);
        commanderProfileRef.current = normalizedProfile;
        writeProfileBackup(normalizedProfile);
    }, [commanderProfile]);

    useEffect(() => {
        const enhancedProfile = withSkinLoadoutEnhancements(skinsProfile);
        skinsProfileRef.current = enhancedProfile;
        (window as Window & { agSkinLoadout?: PlayerSkinProfile['loadout'] }).agSkinLoadout = enhancedProfile.loadout;
        window.dispatchEvent(new CustomEvent('ag:skin-loadout-changed', { detail: enhancedProfile.loadout }));
    }, [skinsProfile]);

    useEffect(() => {
        if (!didLoadSave) {
            return;
        }

        const sanitizedProfile = sanitizeSkinProfile(skinsProfileRef.current, unlockedSkinIds);
        const unitChanged = sanitizedProfile.loadout.unitSkinId !== skinsProfileRef.current.loadout.unitSkinId;
        const buildingChanged = sanitizedProfile.loadout.buildingSkinId !== skinsProfileRef.current.loadout.buildingSkinId;

        if (!unitChanged && !buildingChanged) {
            return;
        }

        void commitSkinsProfile(sanitizedProfile);
    }, [didLoadSave, unlockedSkinIds]);

    useEffect(() => {
        const selectedBadgeVariant = commanderProfileRef.current.selectedBadgeVariant;
        if (!didLoadSave || !selectedBadgeVariant || unlockedProfileBadgeVariants.includes(selectedBadgeVariant)) {
            return;
        }

        void handleSelectProfileBadge(null);
    }, [didLoadSave, unlockedProfileBadgeVariants]);

    useEffect(() => {
        if (!commanderDisplayName.trim()) {
            return;
        }

        socket.emit('set_player_name', commanderDisplayName);
    }, [commanderDisplayName]);

    useEffect(() => {
        creatingSteamLobbyRef.current = creatingSteamLobby;
    }, [creatingSteamLobby]);

    const closeActiveSteamRelayConnection = async () => {
        const activeRelaySessionId = activeSteamRelaySessionRef.current;
        activeSteamRelaySessionRef.current = null;

        if (!activeRelaySessionId || !steamService.isInitialized) {
            return;
        }

        const result = await steamService.closeRelayConnection(activeRelaySessionId);
        if (!result.success) {
            console.warn('[App] Failed to close Steam relay session cleanly.', result.error);
            pushSteamDiagnosticsEvent('Steam relay session failed to close cleanly.', {
                relaySessionId: null,
                lastError: result.error || 'Steam relay close failed.',
                status: 'Relay close warning',
            });
            return;
        }

        pushSteamDiagnosticsEvent('Closed active Steam relay session.', {
            relaySessionId: null,
            status: 'Relay session closed',
        });
    };

    const leaveActiveSteamLobby = async () => {
        const activeLobbyId = steamLobbyId;

        pendingSteamLobbyConfigRef.current = null;
        setSteamLobbyId(null);
        setSteamLobbyRole(null);
        setIsRankedQueueing(false);
        steamService.setRichPresence('connect', null);
        await closeActiveSteamRelayConnection();
        pushSteamDiagnosticsEvent('Leaving active Steam lobby.', {
            lobbyId: null,
            route: 'idle',
            status: 'Leaving Steam lobby',
        });

        if (ipc?.invoke) {
            try {
                await ipc.invoke('network:close-public-tunnel');
            } catch (error) {
                console.warn('[App] Failed to close public tunnel cleanly.', error);
                pushSteamDiagnosticsEvent('Public tunnel close reported a warning.', {
                    lastError: getErrorMessage(error),
                    status: 'Tunnel close warning',
                });
            }
        }

        if (!activeLobbyId || !steamService.isInitialized) {
            return;
        }

        const result = await steamService.leaveLobby(activeLobbyId);
        if (!result.success) {
            console.warn('[App] Failed to leave active Steam lobby cleanly.', result.error);
            pushSteamDiagnosticsEvent('Steam lobby leave reported a warning.', {
                lastError: result.error || 'Steam lobby leave failed.',
                status: 'Steam lobby leave warning',
            });
            return;
        }

        pushSteamDiagnosticsEvent('Steam lobby left cleanly.', {
            status: 'Steam lobby closed',
        });
    };

    const handleLeaveToMenu = async () => {
        await leaveActiveSteamLobby();
        matchStartedAtRef.current = null;
        window.location.reload();
    };

    const resolveSteamHostEndpoint = async (
        options?: { preferPublicTunnel?: boolean }
    ): Promise<string | null> => {
        const connectionStateUrl = normalizeNetworkEndpoint(connectionManager.getState().url);
        const socketUrl = normalizeNetworkEndpoint((socket as any).io?.uri);
        const localEngineUrl = normalizeNetworkEndpoint(localEngineUrlRef.current);
        const fallbackEndpoint = connectionStateUrl || socketUrl || localEngineUrl;

        let fallbackPort = localPort || '3001';
        if (fallbackEndpoint) {
            try {
                const parsed = new URL(fallbackEndpoint);
                if (parsed.port) {
                    fallbackPort = parsed.port;
                } else if (parsed.protocol === 'https:') {
                    fallbackPort = '443';
                } else if (parsed.protocol === 'http:') {
                    fallbackPort = '80';
                }
            } catch {
                // Keep default fallback port.
            }
        }

        const discoverExistingEndpoint = async () => await new Promise<string | null>((resolve) => {
            let settled = false;
            let timeoutId = 0;

            const finish = (value?: string | null) => {
                if (settled) return;
                settled = true;
                socket.off('tunnelUrl', handleTunnelUrl);
                socket.off('tunnelPassword', handleTunnelPassword);
                window.clearTimeout(timeoutId);
                resolve(value || fallbackEndpoint || null);
            };

            const handleTunnelUrl = (value: string) => {
                const endpoint = normalizeNetworkEndpoint(value);
                if (endpoint) finish(endpoint);
            };

            const handleTunnelPassword = (value: string) => {
                const host = (value || '').trim();
                if (!host || (!host.includes('.') && !host.includes(':'))) return;
                const endpoint = normalizeNetworkEndpoint(buildHostEndpoint(host, fallbackPort));
                if (endpoint) finish(endpoint);
            };

            socket.on('tunnelUrl', handleTunnelUrl);
            socket.on('tunnelPassword', handleTunnelPassword);
            socket.emit('request_game_state');

            timeoutId = window.setTimeout(() => finish(null), 1200);
        });

        if (options?.preferPublicTunnel && ipc?.invoke) {
            try {
                const tunnelResult = await ipc.invoke('network:ensure-public-tunnel', { port: fallbackPort });
                const publicEndpoint = normalizeNetworkEndpoint(tunnelResult?.endpoint);

                if (tunnelResult?.success && publicEndpoint) {
                    socket.emit('set_tunnel_url', publicEndpoint);
                    pushSteamDiagnosticsEvent('Resolved public host endpoint for Steam lobby.', {
                        endpoint: publicEndpoint,
                        status: 'Public host endpoint ready',
                    });
                    return publicEndpoint;
                }

                pushSteamDiagnosticsEvent('Public tunnel unavailable, falling back to direct endpoint discovery.', {
                    status: 'Tunnel fallback',
                    lastError: tunnelResult?.error || 'No tunnel endpoint returned.',
                });
                console.warn(
                    '[App] Public tunnel unavailable for Steam hosting. Falling back to LAN/local endpoint.',
                    tunnelResult?.error || 'No tunnel endpoint returned.'
                );
            } catch (error) {
                pushSteamDiagnosticsEvent('Public tunnel provisioning threw, falling back to direct endpoint discovery.', {
                    status: 'Tunnel fallback',
                    lastError: getErrorMessage(error),
                });
                console.warn('[App] Public tunnel provisioning threw. Falling back to LAN/local endpoint.', error);
            }
        }

        const discoveredEndpoint = await discoverExistingEndpoint();
        if (discoveredEndpoint || fallbackEndpoint) {
            pushSteamDiagnosticsEvent('Resolved fallback host endpoint for Steam lobby.', {
                endpoint: discoveredEndpoint || fallbackEndpoint || null,
                status: 'Fallback host endpoint ready',
            });
        }
        return discoveredEndpoint || fallbackEndpoint || null;
    };

    const fetchSteamLobbyDataWithRetry = async (
        lobbyId: string,
        attempts: number = 5,
        delayMs: number = 1000
    ) => {
        let lastResult: Awaited<ReturnType<typeof steamService.getLobbyData>> = {
            success: false,
            error: 'Steam lobby lookup did not run.',
        };

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            lastResult = await steamService.getLobbyData(lobbyId);
            if (lastResult.success && lastResult.roomId && (lastResult.endpoint || lastResult.hostSteamId)) {
                return lastResult;
            }

            if (attempt < attempts - 1) {
                await delay(delayMs);
            }
        }

        return lastResult;
    };

    const connectToSteamEndpointWithRetry = async (
        endpoint: string,
        attempts: number = 4,
        timeoutMs: number = 12000,
        delayMs: number = 1500
    ) => {
        let lastResult: { success: boolean; error?: string } = {
            success: false,
            error: 'Connection attempt did not run.',
        };

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            lastResult = await connectToServer(endpoint, timeoutMs);
            if (lastResult.success) {
                return lastResult;
            }

            if (attempt < attempts - 1) {
                await delay(delayMs);
            }
        }

        return lastResult;
    };

    const joinSteamLobbyById = async (
        lobbyId: string,
        options?: { suppressAlert?: boolean }
    ): Promise<boolean> => {
        console.log('[App] Joining Steam Lobby:', lobbyId);
        await closeActiveSteamRelayConnection();
        pushSteamDiagnosticsEvent('Starting Steam lobby join.', {
            flow: isRankedQueueing ? 'ranked' : 'joining',
            route: 'pending',
            lobbyId,
            roomId: null,
            hostSteamId: null,
            endpoint: null,
            relaySessionId: null,
            lastError: null,
            status: 'Reading Steam lobby data',
        });
        const data = await fetchSteamLobbyDataWithRetry(lobbyId);
        if (!data.success || !data.roomId) {
            pushSteamDiagnosticsEvent('Steam lobby metadata lookup failed.', {
                status: 'Steam lobby lookup failed',
                lastError: data.error || 'Steam lobby metadata unavailable.',
            });
            console.error('[App] Failed to get room from Steam Lobby', data.error);
            if (!options?.suppressAlert) {
                alert('Failed to join Steam Lobby: ' + (data.error || 'Unknown error'));
            }
            return false;
        }

        pushSteamDiagnosticsEvent('Steam lobby metadata loaded.', {
            lobbyId: String(data.lobbyId || lobbyId),
            roomId: data.roomId,
            hostSteamId: data.hostSteamId || null,
            endpoint: data.endpoint || null,
            status: 'Steam lobby resolved',
        });

        const connectionCandidates: Array<{
            label: 'steam-relay' | 'direct-endpoint';
            endpoint: string;
            sessionId?: string;
        }> = [];
        let relayPreparationError: string | null = null;

        if (data.hostSteamId) {
            pushSteamDiagnosticsEvent('Preparing Steam relay session from lobby host metadata.', {
                hostSteamId: data.hostSteamId,
                status: 'Preparing Steam relay',
            });
            const relayResult = await steamService.prepareRelayConnection(data.hostSteamId);
            if (relayResult.success && relayResult.endpoint && relayResult.sessionId) {
                pushSteamDiagnosticsEvent('Steam relay session prepared.', {
                    route: 'steam-relay',
                    endpoint: relayResult.endpoint,
                    relaySessionId: relayResult.sessionId,
                    status: 'Steam relay ready',
                });
                connectionCandidates.push({
                    label: 'steam-relay',
                    endpoint: relayResult.endpoint,
                    sessionId: relayResult.sessionId,
                });
            } else if (relayResult.error) {
                relayPreparationError = relayResult.error;
                pushSteamDiagnosticsEvent('Steam relay preparation failed, direct endpoint fallback will be tried if available.', {
                    route: 'pending',
                    status: 'Steam relay failed',
                    lastError: relayResult.error,
                });
                console.warn('[App] Steam relay preparation failed, falling back to direct endpoint if available.', relayResult.error);
            }
        }

        const endpoint = normalizeNetworkEndpoint(data.endpoint);
        if (endpoint) {
            connectionCandidates.push({
                label: 'direct-endpoint',
                endpoint,
            });
        }

        if (connectionCandidates.length === 0) {
            pushSteamDiagnosticsEvent('No usable Steam join path was available from lobby metadata.', {
                route: 'idle',
                status: 'No join path available',
            });
            if (!options?.suppressAlert) {
                const reason = relayPreparationError
                    ? `Steam relay failed: ${relayPreparationError}`
                    : 'Host endpoint is missing in this Steam lobby. Ask the host to recreate it.';
                alert(reason);
            }
            return false;
        }

        let activeConnection:
            | { label: 'steam-relay' | 'direct-endpoint'; endpoint: string; sessionId?: string }
            | null = null;
        let lastConnectionError = relayPreparationError || 'Connection attempt did not run.';

        for (const candidate of connectionCandidates) {
            pushSteamDiagnosticsEvent(
                candidate.label === 'steam-relay'
                    ? 'Attempting Steam relay connection.'
                    : 'Attempting direct host endpoint connection.',
                {
                    route: candidate.label,
                    endpoint: candidate.endpoint,
                    relaySessionId: candidate.sessionId || null,
                    status: candidate.label === 'steam-relay' ? 'Connecting through Steam relay' : 'Connecting directly to host endpoint',
                }
            );
            const connectionResult = await connectToSteamEndpointWithRetry(candidate.endpoint);
            if (connectionResult.success) {
                activeConnection = candidate;
                pushSteamDiagnosticsEvent(
                    candidate.label === 'steam-relay'
                        ? 'Steam relay connection established.'
                        : 'Direct host endpoint connection established.',
                    {
                        route: candidate.label,
                        status: candidate.label === 'steam-relay' ? 'Steam relay connected' : 'Direct endpoint connected',
                    }
                );
                break;
            }

            lastConnectionError = connectionResult.error || `${candidate.label} failed`;
            pushSteamDiagnosticsEvent(
                candidate.label === 'steam-relay'
                    ? 'Steam relay connection attempt failed.'
                    : 'Direct host endpoint connection attempt failed.',
                {
                    route: candidate.label,
                    status: candidate.label === 'steam-relay' ? 'Steam relay connect failed' : 'Direct endpoint connect failed',
                    lastError: lastConnectionError,
                }
            );
            console.warn('[App] Failed to connect through Steam lobby candidate.', candidate.label, candidate.endpoint, connectionResult.error);

            if (candidate.sessionId) {
                const relayCloseResult = await steamService.closeRelayConnection(candidate.sessionId);
                if (!relayCloseResult.success) {
                    console.warn('[App] Failed to close unsuccessful Steam relay session cleanly.', relayCloseResult.error);
                }
            }
        }

        if (!activeConnection) {
            pushSteamDiagnosticsEvent('All Steam join paths failed.', {
                route: 'idle',
                status: 'Steam join failed',
                lastError: lastConnectionError,
            });
            if (!options?.suppressAlert) {
                alert(`Failed to connect to host endpoint: ${lastConnectionError}`);
            }
            return false;
        }

        activeSteamRelaySessionRef.current = activeConnection.sessionId || null;

        const activeLobbyId = String(data.lobbyId || lobbyId);
        const ranked = Boolean(data.ranked || data.queueType === RANKED_QUICK_QUEUE_TYPE);
        console.log('[App] Steam Lobby mapped to Room:', data.roomId, 'Endpoint:', activeConnection.endpoint, 'Mode:', activeConnection.label);
        setIsLocalMode(false);
        setMatchStatsSource('steam');
        setIsRankedMatch(ranked);
        setSteamLobbyRole('guest');
        setSteamLobbyId(activeLobbyId);
        steamService.setRichPresence('connect', `+connect_lobby ${activeLobbyId}`);
        setLastJoinedRoom(data.roomId);
        socket.emit('joinByCode', data.roomId);
        pushSteamDiagnosticsEvent('Steam lobby join finished and room join was requested.', {
            route: activeConnection.label,
            lobbyId: activeLobbyId,
            roomId: data.roomId,
            hostSteamId: data.hostSteamId || null,
            endpoint: activeConnection.endpoint,
            relaySessionId: activeConnection.sessionId || null,
            status: `Joined via ${activeConnection.label === 'steam-relay' ? 'Steam relay' : 'direct endpoint'}`,
            lastError: null,
        });
        setIsPlaying(true);
        setIsRankedQueueing(false);
        return true;
    };

    const startRankedQuickMatch = async () => {
        if (!steamUser || !steamService.isInitialized) {
            alert('Steam is required for ranked quick match.');
            return;
        }

        setIsCampaignMode(false);
        setIsTutorialMode(false);
        setIsLocalMode(false);
        setMatchStatsSource('steam');
        setIsRankedMatch(true);
        pushSteamDiagnosticsEvent('Starting ranked quick match search.', {
            flow: 'ranked',
            route: 'pending',
            status: 'Searching ranked Steam lobbies',
            lobbyId: null,
            roomId: null,
            endpoint: null,
            relaySessionId: null,
            lastError: null,
        });

        await leaveActiveSteamLobby();
        setIsRankedQueueing(true);

        const lobbyResult = await steamService.listLobbies({
            queueType: RANKED_QUICK_QUEUE_TYPE,
            status: 'waiting',
            requireOpenSlot: true,
            maxResults: 12,
        });

        if (lobbyResult.success) {
            pushSteamDiagnosticsEvent(`Steam lobby search returned ${lobbyResult.lobbies.length} ranked candidates.`, {
                status: 'Ranked lobby search complete',
            });
            const rankedCandidates = [...lobbyResult.lobbies];
            for (let index = rankedCandidates.length - 1; index > 0; index -= 1) {
                const randomIndex = Math.floor(Math.random() * (index + 1));
                [rankedCandidates[index], rankedCandidates[randomIndex]] = [rankedCandidates[randomIndex], rankedCandidates[index]];
            }

            for (const candidate of rankedCandidates) {
                if (!candidate.lobbyId) continue;
                const joined = await joinSteamLobbyById(candidate.lobbyId, { suppressAlert: true });
                if (joined) {
                    pushSteamDiagnosticsEvent('Joined an existing ranked Steam lobby.', {
                        flow: 'ranked',
                    });
                    return;
                }
            }
        } else {
            pushSteamDiagnosticsEvent('Ranked Steam lobby search failed.', {
                status: 'Ranked lobby search failed',
                lastError: lobbyResult.error || 'Steam lobby search failed.',
            });
            console.warn('[App] Steam ranked quick match lobby search failed.', lobbyResult.error);
        }

        pendingSteamLobbyConfigRef.current = {
            lobbyVisibility: 'public',
            maxMembers: RANKED_QUICK_MATCH_PLAYER_COUNT,
            map: 'Random',
            mode: 'Ranked Quick Match',
            openInviteDialog: false,
            ranked: true,
            metadata: {
                ag_queue: RANKED_QUICK_QUEUE_TYPE,
                ag_status: 'waiting',
                ag_required_players: RANKED_QUICK_MATCH_PLAYER_COUNT,
                ag_ranked: true,
            },
        };
        creatingSteamLobbyRef.current = true;
        setCreatingSteamLobby(true);
        pushSteamDiagnosticsEvent('No ranked candidate was joinable, hosting a new ranked Steam lobby.', {
            flow: 'ranked',
            status: 'Hosting ranked Steam lobby',
        });
        await quickJoin('random', true, 'steam', {
            queueType: RANKED_QUICK_QUEUE_TYPE,
            requiredPlayers: RANKED_QUICK_MATCH_PLAYER_COUNT,
            ranked: true,
        });
    };

    useEffect(() => {
        // Listen for Steam Init
        const onSteamInit = (user: any) => {
            console.log('[App] Steam Initialized:', user);
            setSteamUser(user);
            // Set Rich Presence to Main Menu
            steamService.setRichPresence('steam_display', '#Status_MainMenu');
            steamService.setRichPresence('connect', null);
            pushSteamDiagnosticsEvent(`Steam initialized for ${user.name}.`, {
                status: 'Steam ready',
                lastError: null,
            });
        };

        const onSteamError = (err: string) => {
            console.error('[App] Steam Error:', err);
            pushSteamDiagnosticsEvent('Steam initialization error reported.', {
                status: 'Steam unavailable',
                lastError: err,
            });
            if (!isDevBypass) {
                setSteamError(err);
            }
        };

        const onJoinLobby = async (lobbyId: string) => {
            await joinSteamLobbyById(lobbyId);
        };

        steamService.on('initialized', onSteamInit);
        steamService.on('error', onSteamError);
        steamService.on('join-lobby', onJoinLobby);

        // Check if already initialized
        if (steamService.isInitialized && steamService.currentUser) {
            onSteamInit(steamService.currentUser);
        }
        if (steamService.initError) {
            onSteamError(steamService.initError);
        }

        return () => {
            steamService.off('initialized', onSteamInit);
            steamService.off('error', onSteamError);
            steamService.off('join-lobby', onJoinLobby);
        };
    }, [isDevBypass]);

    useEffect(() => {
        if (!steamLobbyId || !steamService.isInitialized || steamLobbyRole !== 'host') {
            return;
        }

        void steamService.updateActiveLobbyData({
            ag_status: gameStatus,
            ag_queue: isRankedMatch ? RANKED_QUICK_QUEUE_TYPE : 'friends_hosted',
            ag_required_players: isRankedMatch ? RANKED_QUICK_MATCH_PLAYER_COUNT : undefined,
            ag_ranked: isRankedMatch,
        });
    }, [gameStatus, isRankedMatch, steamLobbyId, steamLobbyRole]);

    useEffect(() => {
        if (!didLoadSave || !steamUser || !steamService.isInitialized) {
            return;
        }

        let cancelled = false;

        const pullSteamStatistics = async () => {
            const attemptedAt = new Date().toISOString();
            const attemptSnapshot = withSteamSyncState(statisticsRef.current, {
                lastAttemptAt: attemptedAt,
                lastError: null,
            });
            await commitStatistics(attemptSnapshot);

            const result = await steamService.getStats(STEAM_STAT_NAMES);
            if (cancelled) return;

            if (!result.success) {
                await commitStatistics(withSteamSyncState(attemptSnapshot, {
                    available: false,
                    lastError: result.error || 'Unable to read Steam stats.',
                }));
                return;
            }

            const mergedSnapshot = withSteamSyncState(
                mergeSteamStatistics(attemptSnapshot, result.stats, attemptedAt),
                {
                    available: true,
                    lastSuccessAt: attemptedAt,
                    lastError: null,
                }
            );
            await commitStatistics(mergedSnapshot);
            if (cancelled) return;

            await pushStatisticsToSteam(mergedSnapshot);
        };

        pullSteamStatistics();
        return () => {
            cancelled = true;
        };
    }, [didLoadSave, steamUser]);

    useEffect(() => {
        if (!didLoadSave) {
            return;
        }

        const unlockedAt = new Date().toISOString();
        const { nextState, newlyUnlocked } = unlockEligibleAchievements(
            achievementUnlocksRef.current,
            { statistics: statisticsRef.current },
            unlockedAt
        );

        if (newlyUnlocked.length === 0) {
            return;
        }

        void (async () => {
            await commitAchievementUnlocks(nextState);
            await grantProfileStars(newlyUnlocked.length * ACHIEVEMENT_STAR_REWARD, unlockedAt);
        })();

        if (steamService.isInitialized) {
            newlyUnlocked.forEach(achievementId => {
                steamService.activateAchievement(achievementId);
            });
        }
    }, [didLoadSave, statistics]);

    useEffect(() => {
        if (!didLoadSave || !steamUser || !steamService.isInitialized) {
            return;
        }

        Object.keys(achievementUnlocksRef.current.unlockedAtById).forEach(achievementId => {
            steamService.activateAchievement(achievementId);
        });
    }, [didLoadSave, steamUser]);

    // --- Secret Bypass Shortcut ---
    useEffect(() => {
        const handleBypass = () => {
            console.log('[App] Secret Bypass (IPC) Triggered: Enabling Persistent Dev Bypass');
            setSteamError(null);
            setIsDevBypass(true);
            localStorage.setItem('ag_dev_bypass', 'true');
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            // Command + O (or Ctrl + O) to toggle Persistent Dev Bypass
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
                console.log('[App] Secret Bypass (Renderer) Triggered');
                setSteamError(null);
                const nextBypass = !isDevBypass;
                setIsDevBypass(nextBypass);
                localStorage.setItem('ag_dev_bypass', nextBypass ? 'true' : 'false');

                // If we are turning OFF bypass, we might want to toggle UI visibility too
                // as per the original "Hide UI" request. 
                // But generally, the user wants the UI when bypassing.
                if (!nextBypass) {
                    setIsUIVisible(prev => !prev);
                } else {
                    setIsUIVisible(true); // Always show UI when enabling bypass
                }
            }
        };

        // Listen for IPC from Main Process
        if (ipc) {
            ipc.on('steam:bypass-error', handleBypass);
        }

        window.addEventListener('keydown', handleKeyDown, true); // Use capture phase for robustness
        return () => {
            if (ipc) ipc.removeListener('steam:bypass-error', handleBypass);
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [ipc]);

    const handleQuitGame = async () => {
        if (!window.confirm("Are you sure you want to quit to desktop?")) return;

        try {
            if (ipc?.invoke) {
                await ipc.invoke('app:quit');
                return;
            }
        } catch (error) {
            console.warn('[App] Electron app:quit failed, falling back to window.close().', error);
        }

        window.close();
    };


    const quickJoin = async (
        mapType: string = 'random',
        forceNew: boolean = false,
        source: MatchSource = 'lan',
        options?: {
            queueType?: 'standard' | 'ranked_quick_match';
            requiredPlayers?: number;
            ranked?: boolean;
        }
    ) => {
        if (!(await bootstrapLocalEngine())) {
            creatingSteamLobbyRef.current = false;
            setCreatingSteamLobby(false);
            setIsRankedQueueing(false);
            alert('Failed to start the local game engine. Please restart the game.');
            return;
        }

        setIsLocalMode(false);
        setMatchStatsSource(source);
        setIsRankedMatch(Boolean(options?.ranked));
        socket.emit('quickJoin', {
            mapType,
            forceNew,
            queueType: options?.queueType,
            requiredPlayers: options?.requiredPlayers,
            playerName: commanderDisplayName,
        });
        setIsPlaying(true);
    };

    const handleJoinWithCode = async () => {
        const code = joinCode.trim();
        if (!code) return;

        if (code.startsWith('PLAYIT:') || code.startsWith('ws://') || code.startsWith('http://') || (code.includes(':') && code.includes('.'))) {
            const result = await connectToServer(code);
            if (result.success) {
                setIsLocalMode(false);
                setMatchStatsSource('lan');
                setIsRankedMatch(false);
                setSteamLobbyRole(null);
                socket.emit('set_player_name', commanderDisplayName);
                setIsPlaying(true);
                setLastJoinedRoom(code);
            } else {
                alert(result.error || "Failed to connect to server.");
            }
        } else {
            if (connectionManager.getState().phase !== 'READY') {
                connectionManager.connect((socket as any).io.uri);
            }
            setIsLocalMode(false);
            setMatchStatsSource('lan');
            setIsRankedMatch(false);
            setSteamLobbyRole(null);
            socket.emit('set_player_name', commanderDisplayName);
            socket.emit('joinByCode', code);
            setIsPlaying(true);
            setLastJoinedRoom(code);
        }
    };

    const startHostingPublic = async () => {
        if (!(await bootstrapLocalEngine())) {
            alert('Failed to start the local game engine. Please restart the game.');
            return;
        }

        setIsCampaignMode(false);
        setIsTutorialMode(false);
        setIsLocalMode(false);
        setMatchStatsSource('lan');
        setIsRankedMatch(false);
        setSteamLobbyRole(null);
        setIsPlaying(true);

        socket.emit('quickJoin', {
            mapType: 'random',
            tunnelUrl: generatedJoinCode || undefined,
            playerName: commanderDisplayName,
        });
    };

    const startWorldConquer = () => {
        setIsCampaignMode(true);
        setIsTutorialMode(false);
        setCampaignLevel(FIRST_STANDARD_CAMPAIGN_INDEX);
        startCampaignLevel(FIRST_STANDARD_CAMPAIGN_INDEX);
    };

    const getDifficultyColor = (difficulty: number) => {
        const clamped = Math.min(10, Math.max(1, difficulty));
        const t = (clamped - 1) / 9;
        const r = Math.round(0 + (200 - 0) * t);
        const g = Math.round(200 - 200 * t);
        return `rgb(${r}, ${g}, 0)`;
    };

    const resolveMapType = (mapType: string) => {
        if (mapType === 'random') {
            const pool = ['islands', 'grasslands', 'desert'];
            const index = Math.floor(Math.random() * pool.length);
            return pool[index];
        }
        return mapType;
    };

    const openTutorialMapPicker = (levelIndex: number) => {
        setPendingTutorialLevelIndex(levelIndex);
        setShowTutorialMapPicker(true);
    };

    const closeTutorialMapPicker = () => {
        setShowTutorialMapPicker(false);
        setPendingTutorialLevelIndex(null);
    };

    const startSelectedTutorialMap = () => {
        if (pendingTutorialLevelIndex === null) {
            return;
        }

        closeTutorialMapPicker();
        void startCampaignLevel(pendingTutorialLevelIndex, selectedTutorialMap);
    };

    const ensureLocalEngineReady = async (
        retries: number = 8,
        delayMs: number = 750,
        maxWaitMs: number = INTERACTIVE_LOCAL_ENGINE_BOOT_BUDGET_MS
    ) => {
        const reachabilityBudgetMs = maxWaitMs;
        const backendReachable = await waitForLocalServerReachability(reachabilityBudgetMs);
        if (!backendReachable) {
            console.warn('[App] Local backend was not reachable before connection bootstrap.');
            return false;
        }

        const targetUrl = normalizeNetworkEndpoint(localEngineUrlRef.current);
        if (!targetUrl) {
            console.error('[App] Local engine URL is missing or invalid.', localEngineUrlRef.current);
            return false;
        }

        const startedAt = Date.now();

        // Give the embedded backend time to boot on cold starts.
        for (let attempt = 0; attempt < retries; attempt++) {
            if (isReadyOnEndpoint(targetUrl)) {
                return true;
            }

            const elapsedMs = Date.now() - startedAt;
            const remainingMs = maxWaitMs - elapsedMs;
            if (remainingMs <= 0) {
                break;
            }

            const result = await timeoutConnectAttempt(
                targetUrl,
                Math.max(1500, Math.min(LOCAL_ENGINE_CONNECT_ATTEMPT_TIMEOUT_MS, remainingMs))
            );
            if (result.success && isReadyOnEndpoint(targetUrl)) {
                return true;
            }

            if (result.success) {
                console.warn('[App] Local engine connect attempt completed, but the active socket is still pointed somewhere else.', {
                    targetUrl,
                    activeUrl: getCurrentReadyEndpoint()
                });
            }

            const remainingAfterAttempt = maxWaitMs - (Date.now() - startedAt);
            if (remainingAfterAttempt <= 0) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, remainingAfterAttempt)));
        }

        return isReadyOnEndpoint(targetUrl);
    };

    const bootstrapLocalEngine = async (
        retries: number = 10,
        delayMs: number = 750,
        maxWaitMs: number = INTERACTIVE_LOCAL_ENGINE_BOOT_BUDGET_MS
    ) => {
        const bootSequence = localEngineBootSequenceRef.current + 1;
        localEngineBootSequenceRef.current = bootSequence;

        if (isReadyOnEndpoint(localEngineUrlRef.current)) {
            if (localEngineBootSequenceRef.current !== bootSequence) {
                return false;
            }
            setIsLocalEngineReady(true);
            setIsLocalEngineBooting(false);
            setLocalEngineBootError(null);
            return true;
        }

        setIsLocalEngineBooting(true);
        setLocalEngineBootError(null);

        const started = await requestLocalServerStart();
        if (!started) {
            if (localEngineBootSequenceRef.current === bootSequence) {
                setIsLocalEngineReady(false);
                setIsLocalEngineBooting(false);
            }
            return false;
        }

        const ready = await ensureLocalEngineReady(retries, delayMs, maxWaitMs);

        if (localEngineBootSequenceRef.current !== bootSequence) {
            return false;
        }

        setIsLocalEngineReady(ready);
        setIsLocalEngineBooting(false);

        if (ready) {
            setLocalEngineBootError(null);
        } else {
            setLocalEngineBootError('Local game engine is not ready yet.');
        }

        return ready;
    };

    const shutdownLocalEngine = () => {
        localEngineBootSequenceRef.current += 1;

        const localEngineUrl = normalizeNetworkEndpoint(localEngineUrlRef.current);
        const connectionState = connectionManager.getState();
        const connectionUrl = normalizeNetworkEndpoint(connectionState.url);
        const socketUrl = normalizeNetworkEndpoint((socket as any).io?.uri);
        const shouldDropConnection = Boolean(
            localEngineUrl && (connectionUrl === localEngineUrl || socketUrl === localEngineUrl)
        );

        if (shouldDropConnection || connectionState.phase === 'CONNECTING' || connectionState.phase === 'HANDSHAKING') {
            connectionManager.idle('Local engine parked while menu is idle.');
        }

        setIsLocalEngineBooting(false);
        setIsLocalEngineReady(false);
        setLocalEngineBootError(null);
        void requestLocalServerStop();
    };

    useEffect(() => {
        emitBootStatus(
            'Command deck online.',
            'Main menu ready. Match services now load only when you open Campaign or Multiplayer.'
        );
        releaseBootSplash(260);
    }, []);

    const shouldPrepareLocalEngine = menuView === 'campaign'
        || menuView === 'multiplayer'
        || menuView === 'host_public';

    useEffect(() => {
        if (!shouldPrepareLocalEngine || isLocalEngineReady || isLocalEngineBooting) {
            return;
        }

        void bootstrapLocalEngine(8, 500, INITIAL_LOCAL_ENGINE_BOOT_BUDGET_MS);
    }, [shouldPrepareLocalEngine, isLocalEngineReady, isLocalEngineBooting]);

    useEffect(() => {
        if (isPlaying || shouldPrepareLocalEngine) {
            return;
        }

        shutdownLocalEngine();
    }, [isPlaying, shouldPrepareLocalEngine]);

    const startCampaignLevel = async (levelIndex: number, tutorialMapOverride?: TutorialMapType) => {
        const level = CAMPAIGN_LEVELS[levelIndex];
        if (!level) return;

        const requestedTutorialMap = tutorialMapOverride || selectedTutorialMap;
        const selectedMapType = level.isTutorial
            ? resolveMapType(requestedTutorialMap)
            : resolveMapType(level.mapType);

        setIsCampaignMode(true);
        setIsTutorialMode(Boolean(level.isTutorial));
        if (level.isTutorial) {
            setSelectedTutorialMap(requestedTutorialMap);
        }
        setCampaignLevel(levelIndex);
        setMatchStatsSource('campaign');

        await leaveActiveSteamLobby();

        // Ensure the embedded local engine is ready.
        if (!(await bootstrapLocalEngine())) {
            alert("Failed to start the local game engine. Please restart the game.");
            return;
        }
        setShowCampaignModal(null);
        setGameStatus('playing');
        setIsLocalMode(true);
        setIsRankedMatch(false);
        setSteamLobbyRole(null);

        // Trigger Save
        triggerSave({ campaignLevel: levelIndex });

        socket.emit('createSoloGame', {
            mapType: selectedMapType,
            botCount: level.botCount,
            difficulty: level.difficulty,
            startingResources: level.startingResources,
            internalSingleplayer: true,
            source: 'campaign',
            playerName: commanderDisplayName,
        });
        setIsPlaying(true);
        matchStartedAtRef.current = Date.now();
    };

    const nextLevel = () => {
        startCampaignLevel(campaignLevel + 1);
    };

    const retryLevel = () => {
        startCampaignLevel(
            campaignLevel,
            CAMPAIGN_LEVELS[campaignLevel]?.isTutorial ? selectedTutorialMap : undefined
        );
    };

    const startCustomGame = async () => {
        await leaveActiveSteamLobby();

        // Optimistically set playing status to avoid lobby flash
        setGameStatus('playing');
        setIsCampaignMode(false);
        setIsTutorialMode(false);
        setIsLocalMode(true);
        setMatchStatsSource('custom');
        setIsRankedMatch(false);
        setSteamLobbyRole(null);

        if (!(await bootstrapLocalEngine())) {
            setIsLocalMode(false);
            alert("Failed to start the local game engine. Please restart the game.");
            return;
        }

        socket.emit('createSoloGame', {
            ...customConfig,
            internalSingleplayer: true,
            source: 'custom',
            playerName: commanderDisplayName,
        });
        setIsPlaying(true);
        matchStartedAtRef.current = Date.now();
    };

    const handleMatchResolved = async (summary: MatchStatisticsSummary) => {
        const playedAt = new Date().toISOString();
        const nowMs = Date.now();
        const matchDurationMs = matchStartedAtRef.current && matchStartedAtRef.current <= nowMs
            ? nowMs - matchStartedAtRef.current
            : null;
        matchStartedAtRef.current = null;
        const nextStatistics = recordMatchResult(statisticsRef.current, summary, playedAt);
        const committed = await commitStatistics(nextStatistics);
        await grantProfileStars(getMatchStarReward(summary), playedAt);

        if (steamService.isInitialized) {
            const syncedStatistics = await pushStatisticsToSteam(committed);
            await pushLeaderboardsToSteam(syncedStatistics, summary, matchDurationMs);
        }

        if (isTutorialMode && summary.result === 'win' && summary.botPlayers > 0) {
            await unlockAchievementById('TUTORIAL_GRADUATE', playedAt);
        }

        if (summary.result === 'win' && (summary.maxBotDifficulty || 0) >= 7) {
            const botDifficultyAchievements: string[] = [];

            if ((summary.maxBotDifficulty || 0) >= 7) botDifficultyAchievements.push('BOT_LEVEL_7');
            if ((summary.maxBotDifficulty || 0) >= 8) botDifficultyAchievements.push('BOT_LEVEL_8');
            if ((summary.maxBotDifficulty || 0) >= 9) botDifficultyAchievements.push('BOT_LEVEL_9');
            if ((summary.maxBotDifficulty || 0) >= 10) botDifficultyAchievements.push('BOT_LEVEL_10');

            await unlockAchievementsByIds(botDifficultyAchievements, playedAt);
        }
    };

    const handleTutorialObjectivesCompleted = () => {
        if (!isTutorialMode) {
            return;
        }

        void unlockAchievementById('TUTORIAL_GRADUATE');
    };

    const steamDiagnosticsRouteLabel = useMemo(() => {
        switch (steamDiagnostics.route) {
            case 'steam-relay':
                return 'Steam Relay';
            case 'direct-endpoint':
                return 'Direct Endpoint';
            case 'pending':
                return 'Pending';
            default:
                return 'Idle';
        }
    }, [steamDiagnostics.route]);

    const steamDiagnosticsFlowLabel = useMemo(() => {
        switch (steamDiagnostics.flow) {
            case 'hosting':
                return 'Hosting';
            case 'joining':
                return 'Joining';
            case 'ranked':
                return 'Ranked';
            default:
                return 'Idle';
        }
    }, [steamDiagnostics.flow]);

    const steamDiagnosticsContextNote = useMemo(() => {
        if (steamDiagnostics.inviteSurface === 'Steam Friends Window' || steamDiagnostics.inviteSurface === 'Steam Overlay + Friends Window') {
            return steamDiagnostics.inviteSurfaceNote
                || 'Steam opened the friends window for inviting. Use that Steam UI to send the invite.';
        }

        if (steamLobbyRole === 'host' && steamLobbyId && steamDiagnostics.route === 'steam-relay' && !steamDiagnostics.relaySessionId) {
            if (steamDiagnostics.endpoint) {
                return 'Host is ready. "Relay None" is normal until a friend accepts the Steam invite. The endpoint below is only the direct fallback path.';
            }

            return 'Host is ready. "Relay None" is normal until a friend accepts the Steam invite.';
        }

        if (steamDiagnostics.route === 'steam-relay' && steamDiagnostics.relaySessionId) {
            return 'This session is currently using Steam relay.';
        }

        if (steamDiagnostics.route === 'direct-endpoint' && steamDiagnostics.endpoint) {
            return 'This session fell back to the host endpoint instead of Steam relay.';
        }

        return null;
    }, [
        steamDiagnostics.inviteSurface,
        steamDiagnostics.inviteSurfaceNote,
        steamDiagnostics.endpoint,
        steamDiagnostics.relaySessionId,
        steamDiagnostics.route,
        steamLobbyId,
        steamLobbyRole,
    ]);

    const showSteamDiagnosticsPanel = steamService.isInitialized
        || Boolean(steamDiagnostics.lastError)
        || steamDiagnostics.events.length > 0
        || steamDiagnostics.route !== 'idle'
        || steamDiagnostics.flow !== 'idle';
    const shouldRenderGameCanvas = isPlaying;

    return (
        <div className={`App${isElectronRuntime ? ' App--electron' : ''}`}>
            {shouldRenderGameCanvas && (
                <Suspense fallback={null}>
                    <LazyGameCanvas />
                </Suspense>
            )}

            {isUIVisible && !isPlaying && !shouldRenderGameCanvas && (
                <LobbyBackdrop electronSafe={isElectronRuntime} />
            )}

            {/* Main Menu Layer */}
            {isUIVisible && !isPlaying && (!steamError || isDevBypass) && (
                <>
                    <div className="top-left-actions">
                        <button
                            type="button"
                            className="patch-notes-float-btn"
                            onClick={() => setShowPatchNotes(true)}
                        >
                            Patch Notes
                        </button>
                        <button
                            type="button"
                            className="profile-float-btn"
                            onClick={() => setShowProfileModal(true)}
                        >
                            <span className="profile-float-btn__star" aria-hidden="true">★</span>
                            Profile
                        </button>
                    </div>

                    <button
                        type="button"
                        className="wishlist-float-btn"
                        onClick={handleWishlistClick}
                    >
                        <span className="wishlist-float-btn__icon" aria-hidden="true">
                            <svg viewBox="0 0 64 64" className="wishlist-float-btn__icon-svg">
                                <circle cx="32" cy="32" r="28" />
                                <circle cx="44" cy="20" r="6" className="wishlist-float-btn__icon-detail" />
                                <circle cx="24" cy="42" r="5.5" className="wishlist-float-btn__icon-detail" />
                                <path d="M27 39L38 27a8 8 0 0 0 8 2" className="wishlist-float-btn__icon-path" />
                                <path d="M24 37.5l-2.5 5.5" className="wishlist-float-btn__icon-path" />
                            </svg>
                        </span>
                        <span className="wishlist-float-btn__label">
                            <span className="wishlist-float-btn__eyebrow">Steam</span>
                            <span className="wishlist-float-btn__text">Wishlist on Steam</span>
                        </span>
                    </button>

                    <button
                        type="button"
                        className="request-changes-float-btn"
                        onClick={handleRequestChangesClick}
                    >
                        <span className="request-changes-float-btn__icon" aria-hidden="true">
                            <svg viewBox="0 0 64 64" className="request-changes-float-btn__icon-svg">
                                <path d="M10 16c0-5 4-9 9-9h26c5 0 9 4 9 9v19c0 5-4 9-9 9H31L18 56v-12c-5-.4-8-4.2-8-9Z" />
                                <path d="M21 24h22M21 34h14" className="request-changes-float-btn__icon-lines" />
                                <path d="M44 43v12M38 49h12" className="request-changes-float-btn__icon-plus" />
                            </svg>
                        </span>
                        <span className="request-changes-float-btn__label">
                            <span className="request-changes-float-btn__eyebrow">Steam Forum</span>
                            <span className="request-changes-float-btn__text">Request Changes</span>
                        </span>
                    </button>

                    <div className={`menu ${menuView === 'statistics' ? 'menu--statistics' : ''} ${menuView === 'skins' ? 'menu--skins' : ''} ${(menuView === 'multiplayer' || menuView === 'host_public') ? 'menu--multiplayer' : ''} ${menuView === 'leaderboards' ? 'menu--leaderboards' : ''}`}>
                        <h1 className="menu-title-accessible">Conquerors: Domination</h1>
                        <LobbyLogo performanceMode={isElectronRuntime} />

                        {/* Match systems now spin up only after the player opens a mode that needs them. */}
                        {shouldPrepareLocalEngine && isLocalEngineBooting && (
                            <div className="local-engine-loading" style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', padding: '10px 20px', borderRadius: '8px', border: '1px solid #444', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div className="spinner" style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                <p style={{ margin: 0, fontSize: '14px', color: '#fff' }}>Preparing Local Game Engine...</p>
                            </div>
                        )}
                        {shouldPrepareLocalEngine && !isLocalEngineBooting && !isLocalEngineReady && localEngineBootError && (
                            <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #664', background: 'rgba(0,0,0,0.5)', color: '#f1d9aa', fontSize: '14px', textAlign: 'center' }}>
                                <div style={{ marginBottom: '8px' }}>{localEngineBootError}</div>
                                <button onClick={() => bootstrapLocalEngine(14, 750)} className="menu-btn small">Retry Engine Start</button>
                            </div>
                        )}

                    {menuView === 'main' && (
                        <div className="menu-column menu-main-actions">
                            <button onClick={() => setMenuView('multiplayer')} className="menu-btn menu-btn-main">Multiplayer</button>
                            <button onClick={() => setMenuView('campaign')} className="menu-btn menu-btn-main">Campaign & Custom</button>
                            <button onClick={() => setMenuView('skins')} className="menu-btn menu-btn-main">Skins</button>
                            <button onClick={() => setMenuView('statistics')} className="menu-btn menu-btn-main">Stats & Achievements</button>
                            <button onClick={() => setMenuView('leaderboards')} className="menu-btn menu-btn-main">Leaderboards</button>
                        </div>
                    )}

                    {menuView === 'multiplayer' && (
                        <div className="menu-column menu-column--multiplayer">
                            <div className="menu-eyebrow">Online Command</div>
                            <h3 className="menu-section-title">Multiplayer</h3>
                            <p className="menu-section-copy">
                                Host on your local network, invite Steam friends, or route the match onto the public internet.
                            </p>

                            <section className="menu-feature-card menu-feature-card--ranked-hero">
                                <div className="menu-feature-card__header">
                                    <div>
                                        <div className="menu-feature-card__badge menu-feature-card__badge--ranked">Ranked</div>
                                        <h4 className="menu-feature-card__title">Quick Match</h4>
                                    </div>
                                    <div className="ranked-points-chip">{statistics.rankedProgress.points} RP</div>
                                </div>
                                <p className="menu-feature-card__copy">
                                    Queue into a Steam-backed 6-player free-for-all. The match starts once all 6 commanders are present, and placements award +25, +12, +6, -10, -15, and -20 RP.
                                </p>
                                <button
                                    onClick={startRankedQuickMatch}
                                    className="menu-btn menu-btn-ranked menu-btn-feature"
                                    disabled={!steamUser || !isLocalEngineReady || isRankedQueueing}
                                >
                                    {isRankedQueueing ? 'Queueing Ranked Match...' : 'Quick Match'}
                                </button>
                            </section>

                            <div className="multiplayer-grid">
                                <section className="menu-feature-card">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge">Fast setup</div>
                                            <h4 className="menu-feature-card__title">Host Local (LAN)</h4>
                                        </div>
                                    </div>
                                    <p className="menu-feature-card__copy">
                                        Start a battle on this machine for same-network friends, quick testing, or local sessions.
                                    </p>
                                    <button
                                        onClick={() => quickJoin('random', false, 'lan')}
                                        className="menu-btn menu-btn-main menu-btn-feature"
                                        disabled={!isLocalEngineReady}
                                    >
                                        Host Local (LAN)
                                    </button>
                                </section>

                                <section className="menu-feature-card menu-feature-card--steam">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge menu-feature-card__badge--steam">Steam</div>
                                            <h4 className="menu-feature-card__title">Host Steam Lobby</h4>
                                        </div>
                                    </div>
                                    <p className="menu-feature-card__copy">
                                        Best for Steam friends and rich presence. The match still runs on your PC, but Steam handles the invite layer.
                                    </p>
                                    <button
                                        onClick={async () => {
                                            if (!steamUser) {
                                                alert("Steam is required to host a Steam Lobby.");
                                                return;
                                            }
                                            pushSteamDiagnosticsEvent('Preparing friends-only Steam lobby host flow.', {
                                                flow: 'hosting',
                                                route: 'pending',
                                                status: 'Preparing Steam host',
                                                lobbyId: null,
                                                roomId: null,
                                                endpoint: null,
                                                relaySessionId: null,
                                                lastError: null,
                                            });
                                            await leaveActiveSteamLobby();
                                            pendingSteamLobbyConfigRef.current = {
                                                lobbyVisibility: 'friends',
                                                maxMembers: 10,
                                                map: 'Random',
                                                mode: 'Standard',
                                                openInviteDialog: true,
                                                ranked: false,
                                                metadata: {
                                                    ag_queue: 'friends_hosted',
                                                    ag_status: 'waiting',
                                                    ag_ranked: false,
                                                },
                                            };
                                            creatingSteamLobbyRef.current = true;
                                            setCreatingSteamLobby(true);
                                            await quickJoin('random', true, 'steam', {
                                                queueType: 'standard',
                                                ranked: false,
                                            });
                                        }}
                                        className="menu-btn menu-btn-steam menu-btn-feature"
                                        disabled={!isLocalEngineReady}
                                    >
                                        <span aria-hidden="true">🎮</span>
                                        Host Steam Lobby
                                    </button>
                                </section>

                                <section className="menu-feature-card menu-feature-card--public">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge menu-feature-card__badge--public">Internet</div>
                                            <h4 className="menu-feature-card__title">Host Public</h4>
                                        </div>
                                    </div>
                                    <p className="menu-feature-card__copy">
                                        Use Playit.gg or a TCP tunnel so friends outside your network can join your machine directly.
                                    </p>
                                    <button
                                        onClick={() => setMenuView('host_public')}
                                        className="menu-btn menu-btn-warning menu-btn-feature"
                                    >
                                        Host Public (Playit.gg)
                                    </button>
                                </section>
                            </div>

                            <section className="menu-feature-card menu-feature-card--join">
                                <div className="menu-feature-card__header">
                                    <div>
                                        <div className="menu-feature-card__badge">Join</div>
                                        <h4 className="menu-feature-card__title">Join Existing Game</h4>
                                    </div>
                                </div>
                                <p className="menu-feature-card__copy">
                                    Paste a room ID or join code from the host and jump straight into their lobby.
                                </p>
                                <div className="join-row join-row--styled">
                                    <input
                                        placeholder="Room ID or Join Code"
                                        value={joinCode}
                                        onChange={(e) => setJoinCode(e.target.value)}
                                        className="join-input"
                                    />
                                    <button onClick={handleJoinWithCode} className="menu-btn menu-btn-main menu-btn-compact">Join</button>
                                </div>
                            </section>

                            {showSteamDiagnosticsPanel && (
                                <section className="menu-feature-card menu-feature-card--steam-diagnostics">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge menu-feature-card__badge--steam">Steam</div>
                                            <h4 className="menu-feature-card__title">Multiplayer Diagnostics</h4>
                                        </div>
                                        <div className="steam-diagnostics-status-chip">{steamDiagnostics.status}</div>
                                    </div>
                                    <div className="steam-diagnostics-grid">
                                        <div className="steam-diagnostics-row">
                                            <span>Flow</span>
                                            <strong>{steamDiagnosticsFlowLabel}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Route</span>
                                            <strong>{steamDiagnosticsRouteLabel}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Socket Phase</span>
                                            <strong>{steamDiagnostics.connectionPhase}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Invite Surface</span>
                                            <strong>{steamDiagnostics.inviteSurface || 'None'}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Lobby ID</span>
                                            <strong>{steamDiagnostics.lobbyId || 'None'}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Room ID</span>
                                            <strong>{steamDiagnostics.roomId || 'None'}</strong>
                                        </div>
                                        <div className="steam-diagnostics-row">
                                            <span>Relay Session</span>
                                            <strong>{steamDiagnostics.relaySessionId || 'None'}</strong>
                                        </div>
                                    </div>
                                    <div className="steam-diagnostics-field">
                                        <span>Host Steam ID</span>
                                        <code>{steamDiagnostics.hostSteamId || 'Unavailable'}</code>
                                    </div>
                                    <div className="steam-diagnostics-field">
                                        <span>Connection URL</span>
                                        <code>{steamDiagnostics.connectionUrl || 'Unavailable'}</code>
                                    </div>
                                    <div className="steam-diagnostics-field">
                                        <span>{steamLobbyRole === 'host' ? 'Fallback Endpoint' : 'Join Endpoint'}</span>
                                        <code>{steamDiagnostics.endpoint || 'Unavailable'}</code>
                                    </div>
                                    <div className={`steam-diagnostics-field ${steamDiagnostics.lastError ? 'steam-diagnostics-field--error' : ''}`}>
                                        <span>Last Error</span>
                                        <code>{steamDiagnostics.lastError || 'None'}</code>
                                    </div>
                                    {steamDiagnosticsContextNote && (
                                        <div className="steam-diagnostics-note">{steamDiagnosticsContextNote}</div>
                                    )}
                                    <div className="steam-diagnostics-log">
                                        <div className="steam-diagnostics-log__title">Recent Events</div>
                                        {steamDiagnostics.events.length > 0 ? (
                                            <div className="steam-diagnostics-log__list">
                                                {steamDiagnostics.events.map((event) => (
                                                    <div key={event.id} className="steam-diagnostics-log__entry">
                                                        <span>{event.at}</span>
                                                        <span>{event.message}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="steam-diagnostics-log__empty">No Steam multiplayer events yet.</div>
                                        )}
                                    </div>
                                </section>
                            )}

                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'host_public' && (
                        <div className="menu-column menu-column--host-public">
                            <div className="menu-eyebrow">Internet Hosting</div>
                            <h3 className="menu-section-title">Host Public Game</h3>
                            <p className="menu-section-copy">
                                Tunnel your local server out to the internet, then hand your friends a clean join code.
                            </p>

                            <div className="multiplayer-grid multiplayer-grid--host">
                                <section className="menu-feature-card menu-feature-card--steps">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge menu-feature-card__badge--public">Guide</div>
                                            <h4 className="menu-feature-card__title">Playit.gg Setup</h4>
                                        </div>
                                    </div>
                                    <div className="host-step-list">
                                        <div className="host-step">
                                            <span className="host-step__number">1</span>
                                            <div className="host-step__text">Download and run the <strong>playit.gg</strong> agent.</div>
                                        </div>
                                        <div className="host-step">
                                            <span className="host-step__number">2</span>
                                            <div className="host-step__text">Create a <strong>TCP tunnel</strong> to <code>localhost:{localPort}</code>.</div>
                                        </div>
                                        <div className="host-step">
                                            <span className="host-step__number">3</span>
                                            <div className="host-step__text">Paste the generated public address into the field on the right.</div>
                                        </div>
                                        <div className="host-step">
                                            <span className="host-step__number">4</span>
                                            <div className="host-step__text">Start hosting, then share the join code with your friends.</div>
                                        </div>
                                    </div>
                                </section>

                                <section className="menu-feature-card menu-feature-card--config">
                                    <div className="menu-feature-card__header">
                                        <div>
                                            <div className="menu-feature-card__badge">Connection</div>
                                            <h4 className="menu-feature-card__title">Host Connection Details</h4>
                                        </div>
                                    </div>

                                    <div className="setting-row">
                                        <label>Local Port</label>
                                        <input
                                            value={localPort}
                                            onChange={(e) => setLocalPort(e.target.value)}
                                            className="small-input"
                                        />
                                    </div>

                                    <div className="setting-row">
                                        <label>Public Address</label>
                                        <input
                                            value={publicEndpoint}
                                            onChange={(e) => setPublicEndpoint(e.target.value)}
                                            placeholder="e.g. mind-control.playit.gg:12345"
                                            className="wide-input"
                                        />
                                    </div>

                                    <p className="menu-feature-card__hint">
                                        Use the TCP endpoint exactly as Playit.gg gives it to you. HTTP tunnels will not work for the game server.
                                    </p>
                                </section>
                            </div>

                            {generatedJoinCode && (
                                <div className="join-code-display">
                                    <div className="join-code-display__label">Your Join Code</div>
                                    <div className="code-box">
                                        <div className="code-box__value">{generatedJoinCode}</div>
                                        <div className="code-box__actions">
                                            <button
                                                onClick={() => navigator.clipboard.writeText(generatedJoinCode)}
                                                className="copy-btn"
                                                title="Copy Join Code"
                                            >
                                                Copy Code
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const wsUrl = `ws://${publicEndpoint.replace('http://', '').replace('https://', '')}`;
                                                    navigator.clipboard.writeText(wsUrl);
                                                }}
                                                className="copy-btn"
                                                title="Copy WebSocket URL"
                                            >
                                                Copy WS
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="menu-action-row">
                                <button
                                    onClick={startHostingPublic}
                                    disabled={!generatedJoinCode || !isLocalEngineReady}
                                    className="menu-btn menu-btn-main menu-btn-full"
                                >
                                    Start Hosting
                                </button>

                                <button onClick={() => setMenuView('multiplayer')} className="menu-btn secondary">Back</button>
                            </div>
                        </div>
                    )}

                    {menuView === 'campaign' && (
                        <div className="menu-column">
                            <h3 className="menu-section-title">Campaign</h3>

                            <div className="campaign-list">
                                {CAMPAIGN_LEVELS.map((level, index) => {
                                    const difficultyColor = level.isTutorial ? null : getDifficultyColor(level.difficulty);
                                    return (
                                        <button
                                            key={level.id}
                                            className="campaign-card"
                                            disabled={!isLocalEngineReady}
                                            onClick={() => {
                                                if (level.isTutorial) {
                                                    openTutorialMapPicker(index);
                                                    return;
                                                }

                                                void startCampaignLevel(index);
                                            }}
                                        >
                                            <div className="campaign-card-header">
                                                <div className="campaign-name-row">
                                                    <div className="campaign-name-line">
                                                        <span className="campaign-name">{level.name}</span>
                                                        {level.cardBadge && (
                                                            <span className={`campaign-card-badge ${level.isTutorial ? 'campaign-card-badge--tutorial' : ''}`}>
                                                                {level.cardBadge}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="campaign-map">
                                                        Map: {level.isTutorial ? 'Choose at launch' : level.mapType === 'random' ? 'Random' : level.mapType}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="campaign-card-body">
                                                <p className="campaign-description">{level.description}</p>
                                                <div className="campaign-meta-row">
                                                    <span className="campaign-bots">
                                                        {level.isTutorial
                                                            ? `Start: ${level.startingResources?.gold ?? 200} gold / ${level.startingResources?.oil ?? 0} oil`
                                                            : `Bots: ${level.botCount}`}
                                                    </span>
                                                    {level.isTutorial ? (
                                                        <span className="campaign-mode-pill campaign-mode-pill--tutorial">
                                                            {level.modeLabel || 'Guided Sandbox'}
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className="campaign-difficulty-pill"
                                                            style={{ backgroundColor: difficultyColor || undefined, color: '#fff' }}
                                                        >
                                                            Difficulty: {level.difficulty}/10
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <button onClick={startWorldConquer} className="menu-btn primary" disabled={!isLocalEngineReady}>World Conquer (Stages)</button>

                            <div className="custom-game-panel">
                                <h3 className="custom-game-title">Custom Mode</h3>

                                <div className="setting-row">
                                    <label>Map:</label>
                                    <select value={customConfig.mapType} onChange={e => setCustomConfig({ ...customConfig, mapType: e.target.value })}>
                                        <option value="islands">Islands</option>
                                        <option value="grasslands">Grasslands</option>
                                        <option value="desert">Desert</option>
                                        <option value="random">Random</option>
                                    </select>
                                </div>

                                <div className="setting-row">
                                    <label>Bots: {customConfig.botCount}</label>
                                    <input type="range" min="0" max="10" value={customConfig.botCount} onChange={e => setCustomConfig({ ...customConfig, botCount: parseInt(e.target.value) })} />
                                </div>

                                <div className="setting-row">
                                    <label>Difficulty: {customConfig.difficulty}</label>
                                    <input type="range" min="1" max="10" value={customConfig.difficulty} onChange={e => setCustomConfig({ ...customConfig, difficulty: parseInt(e.target.value) })} />
                                </div>

                                <button onClick={startCustomGame} className="menu-btn success menu-btn-full" disabled={!isLocalEngineReady}>Start Custom Game</button>
                            </div>

                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'statistics' && (
                        <div className="menu-column menu-column--statistics">
                            <h3 className="menu-section-title">Stats & Achievements</h3>
                            <Suspense fallback={<div className="menu-panel-loading">Loading stats...</div>}>
                                <LazyStatisticsPanel
                                    statistics={statistics}
                                    achievements={evaluatedAchievements}
                                    campaignLevel={campaignLevel}
                                    totalCampaignStages={STANDARD_CAMPAIGN_STAGE_COUNT}
                                    campaignProgressLabel={getCampaignProgressLabel(campaignLevel)}
                                    steamConnected={steamService.isInitialized}
                                />
                            </Suspense>
                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'skins' && (
                        <div className="menu-column menu-column--skins">
                            <h3 className="menu-section-title">Skins</h3>
                            <Suspense fallback={<div className="menu-panel-loading">Loading skins...</div>}>
                                <LazySkinsPanel
                                    profile={skinsProfile}
                                    unlockedSkinIds={unlockedSkinIds}
                                    unlockedAchievementCount={unlockedAchievementCount}
                                    totalAchievementCount={totalAchievementCount}
                                    showDeveloperSkin={hasDeveloperSkinAccess}
                                    onEquip={handleEquipSkin}
                                />
                            </Suspense>
                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'leaderboards' && (
                        <div className="menu-column menu-column--leaderboards">
                            <h3 className="menu-section-title">Leaderboards</h3>
                            <p className="menu-section-copy">
                                Live Steam-backed top 10 rankings plus your personal placement for each tracked mode.
                            </p>
                            <Suspense fallback={<div className="menu-panel-loading">Loading leaderboards...</div>}>
                                <LazyLeaderboardsPanel
                                    steamConnected={Boolean(steamUser && steamService.isInitialized)}
                                    steamPersonaName={steamUser?.name}
                                    onLeaderboardRewardEligible={handleLeaderboardRewardEligible}
                                />
                            </Suspense>
                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}



                        {lastJoinedRoom && (
                            <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
                                Last Joined: {lastJoinedRoom}
                            </div>
                        )}

                    </div>
                </>
            )}

            <Modal
                isOpen={showTutorialMapPicker}
                onClose={closeTutorialMapPicker}
                className="modal-content tutorial-map-modal"
                title="Choose Tutorial Map"
            >
                <div className="tutorial-map-modal__intro">
                    Pick the map you want the tutorial to explain. Each version teaches a different economy and logistics flow.
                </div>
                <div className="tutorial-map-grid">
                    {TUTORIAL_MAP_OPTIONS.map((option) => {
                        const isSelected = selectedTutorialMap === option.id;

                        return (
                            <button
                                key={option.id}
                                type="button"
                                className={`tutorial-map-card ${isSelected ? 'selected' : ''}`}
                                onClick={() => setSelectedTutorialMap(option.id)}
                            >
                                <div className="tutorial-map-card__header">
                                    <div className="tutorial-map-card__title">
                                        <span className="tutorial-map-card__icon" aria-hidden="true">{option.icon}</span>
                                        <span>{option.label}</span>
                                    </div>
                                    {isSelected && <span className="tutorial-map-card__badge">Selected</span>}
                                </div>
                                <p className="tutorial-map-card__summary">{option.summary}</p>
                                <p className="tutorial-map-card__focus">{option.focus}</p>
                                <ul className="tutorial-map-card__highlights">
                                    {option.highlights.map((highlight) => (
                                        <li key={highlight}>{highlight}</li>
                                    ))}
                                </ul>
                            </button>
                        );
                    })}
                </div>
                <div className="modal-actions tutorial-map-modal__actions">
                    <button type="button" className="menu-btn secondary" onClick={closeTutorialMapPicker}>Cancel</button>
                    <button
                        type="button"
                        className="menu-btn primary"
                        onClick={startSelectedTutorialMap}
                        disabled={pendingTutorialLevelIndex === null}
                    >
                        Start {TUTORIAL_MAP_OPTIONS.find((option) => option.id === selectedTutorialMap)?.label || 'Tutorial'}
                    </button>
                </div>
            </Modal>

            {showPatchNotes && (
                <Suspense fallback={null}>
                    <LazyPatchNotesModal
                        isOpen={showPatchNotes}
                        onClose={() => setShowPatchNotes(false)}
                    />
                </Suspense>
            )}

            {showProfileModal && (
                <Suspense fallback={null}>
                    <LazyProfileModal
                        isOpen={showProfileModal}
                        onClose={() => setShowProfileModal(false)}
                        commanderProfile={commanderProfile}
                        steamPersonaName={steamUser?.name}
                        statistics={statistics}
                        achievements={evaluatedAchievements}
                        steamConnected={Boolean(steamUser && steamService.isInitialized)}
                        unlockedBadgeVariants={unlockedProfileBadgeVariants}
                        onChangeDisplayName={handleChangeDisplayName}
                        onSelectBadge={handleSelectProfileBadge}
                    />
                </Suspense>
            )}

            {/* In-Game UI Layer - Keep mounted to preserve state, but hide if toggled/blocked */}
            <div style={{ display: (isUIVisible && isPlaying && (!steamError || isDevBypass)) ? 'block' : 'none' }}>
                {isPlaying && (
                    <Suspense fallback={null}>
                        <LazyGameUI
                            onLeave={handleLeaveToMenu}
                            roomId={lastJoinedRoom}
                            initialGameStatus={gameStatus as 'waiting' | 'voting' | 'playing'}
                            isLocalMode={isLocalMode}
                            isDevBypass={isDevBypass}
                            tutorialMode={isTutorialMode}
                            tutorialMapType={selectedTutorialMap}
                            onTutorialObjectivesCompleted={handleTutorialObjectivesCompleted}
                            matchStatsSource={matchStatsSource}
                            rankedMatch={isRankedMatch}
                            currentRankedPoints={statistics.rankedProgress.points}
                            currentPlayerStatistics={statistics}
                            steamPersonaName={steamUser?.name}
                            steamLobbyId={steamLobbyId}
                            steamLobbyRole={steamLobbyRole}
                            steamMultiplayerDiagnostics={steamDiagnostics}
                            onMatchResolved={handleMatchResolved}
                        />
                    </Suspense>
                )}

                {showCampaignModal && (
                    <Modal
                        isOpen={true}
                        onClose={() => { }}
                        showCloseButton={false}
                        className="modal-content"
                    >
                        {showCampaignModal === 'victory' ? (
                            <>
                                <h1 className="victory-title">VICTORY!</h1>
                                {isCampaignMode && (
                                    <>
                                        <h3 className="stage-title">{getCampaignCompletionHeading(campaignLevel)}</h3>
                                        <p className="stage-desc">{CAMPAIGN_LEVELS[campaignLevel].name}</p>
                                    </>
                                )}

                                {isCampaignMode ? (
                                    campaignLevel + 1 < CAMPAIGN_LEVELS.length ? (
                                        <div className="modal-footer">
                                            <p className="modal-text">Next: {CAMPAIGN_LEVELS[campaignLevel + 1].name}</p>
                                            <button onClick={nextLevel} className="menu-btn primary btn-large">
                                                Next Stage
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="modal-footer">
                                            <p className="conquered-text">WORLD CONQUERED!</p>
                                            <button onClick={() => window.location.reload()} className="menu-btn primary">Finish Campaign</button>
                                        </div>
                                    )
                                ) : (
                                    <div className="modal-footer">
                                        <button onClick={() => window.location.reload()} className="menu-btn primary">Go Back to Main Menu</button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <h1 className="defeat-title">DEFEAT</h1>
                                <p className="stage-desc">The enemy was too strong.</p>
                                <div className="modal-actions">
                                    <button onClick={retryLevel} className="menu-btn primary">Retry Stage</button>
                                    <button onClick={() => window.location.reload()} className="menu-btn danger btn-danger">Give Up</button>
                                </div>
                            </>
                        )}
                    </Modal>
                )}
            </div>

            {/* Steam Error Modal - Hidden in Dev Bypass */}
            {isUIVisible && steamError && !isDevBypass && (
                <Modal
                    isOpen={true}
                    onClose={() => { }}
                    showCloseButton={false}
                    className="modal-content"
                >
                    <h2 style={{ color: '#ff4444' }}>Steam Required</h2>
                    <p>{steamError}</p>
                    <p>Please launch the game from Steam.</p>
                    <div className="modal-footer">
                        <button onClick={handleQuitGame} className="menu-btn primary">Quit Game</button>
                    </div>
                </Modal>
            )}

            {/* System Overlay (DEMO Label) - Only show if UI is visible */}
            {isUIVisible && (
                <div className="system-overlay" style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: '10px', alignItems: 'center', pointerEvents: 'auto', zIndex: 9999 }}>
                    <div style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>
                        DEMO BUILD {steamUser ? `| ${steamUser.name}` : ''}
                        {isDevBypass && <span style={{ color: '#ff4444', marginLeft: '5px' }}>[BYPASS ACTIVE]</span>}
                    </div>
                    {!steamError && !isDevBypass && (
                        <button onClick={handleQuitGame} style={{ background: '#330000', border: '1px solid #660000', color: '#ffaaaa', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
                            Quit
                        </button>
                    )}
                </div>
            )}

            {/* Connection Lost Overlay - Only block if we are actually in-game AND not in local mode */}
            {isUIVisible && isPlaying && !isLocalMode && !isDevBypass && (
                <Suspense fallback={null}>
                    <LazyConnectionLostOverlay
                        onRetry={() => connectionManager.retry()}
                        onMainMenu={() => {
                            connectionManager.cancel();
                            setIsPlaying(false);
                            setMenuView('main');
                            // Local storage skip if we want it to persist through reload
                            window.location.reload();
                        }}
                    />
                </Suspense>
            )}

            {/* Global Settings Button - Always in bottom left if UI is on */}
            {isUIVisible && (
                <>
                    <button
                        onMouseDown={handleSettingsButtonMouseDown}
                        onClick={handleSettingsButtonClick}
                        className={`settings-float-btn ${isDraggingSettingsButton ? 'dragging' : ''}`}
                        title="Settings • drag to move"
                        style={{ left: settingsButtonPos.x, top: settingsButtonPos.y }}
                    >
                        ⚙️
                    </button>

                    {showSettings && (
                        <Suspense fallback={null}>
                            <LazySettingsModal onClose={() => setShowSettings(false)} mapData={null} />
                        </Suspense>
                    )}
                </>
            )}
        </div>
    );
}

export default App;
