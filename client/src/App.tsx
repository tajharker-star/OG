import { useState, useEffect, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { GameUI } from './components/GameUI';
import { SettingsModal } from './components/SettingsModal';
import { Modal } from './components/Modal';
import { ConnectionLostOverlay } from './components/ConnectionLostOverlay';
import { LobbyLogo } from './components/LobbyLogo';
import { PatchNotesModal } from './components/PatchNotesModal';
import { StatisticsPanel } from './components/StatisticsPanel';
import { socket, connectToServer, connectionManager } from './services/socket';
import { steamService } from './services/steam';
import { soundEffectsManager } from './audio/soundEffects';
import {
    bucketMatches,
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
import './App.css';

const LOCAL_STATISTICS_BACKUP_KEY = 'ag_statistics_backup_v1';
const LOCAL_ENGINE_CONNECT_ATTEMPT_TIMEOUT_MS = 20000;
const INITIAL_LOCAL_ENGINE_BOOT_BUDGET_MS = 24000;
const INTERACTIVE_LOCAL_ENGINE_BOOT_BUDGET_MS = 30000;
const MAIN_GAME_STEAM_APP_ID = '4432210';
const MAIN_GAME_STEAM_STORE_URL = `https://store.steampowered.com/app/${MAIN_GAME_STEAM_APP_ID}/`;
const MAIN_GAME_STEAM_DEEP_LINK = `steam://store/${MAIN_GAME_STEAM_APP_ID}`;
const SETTINGS_FLOAT_BUTTON_SIZE = 56;
const SETTINGS_FLOAT_BUTTON_MARGIN = 24;
const SETTINGS_FLOAT_BUTTON_STORAGE_KEY = 'ag_settings_float_button_position_v1';

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
        description: 'Guided sandbox that teaches objectives, gold, oil, buildings, unit roles, counterplay, and how to turn a match into a win.',
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
    const ipc = (window as any).require ? (window as any).require('electron').ipcRenderer : null;
    const [lastJoinedRoom, setLastJoinedRoom] = useState<string | null>(null);
    const [gameStatus, setGameStatus] = useState<string>('waiting');

    // Campaign State
    const [isCampaignMode, setIsCampaignMode] = useState(false);
    const [isTutorialMode, setIsTutorialMode] = useState(false);
    const [isLocalMode, setIsLocalMode] = useState(false); // Campaign or Custom
    const [campaignLevel, setCampaignLevel] = useState(0);
    const [showCampaignModal, setShowCampaignModal] = useState<'victory' | 'defeat' | null>(null);
    const [statistics, setStatistics] = useState<PlayerStatistics>(createDefaultPlayerStatistics);
    const statisticsRef = useRef<PlayerStatistics>(createDefaultPlayerStatistics());
    const [achievementUnlocks, setAchievementUnlocks] = useState<AchievementUnlockState>(createDefaultAchievementUnlockState);
    const achievementUnlocksRef = useRef<AchievementUnlockState>(createDefaultAchievementUnlockState());
    const [didLoadSave, setDidLoadSave] = useState(false);
    const [matchStatsSource, setMatchStatsSource] = useState<MatchSource>('lan');

    // New Menu States
    const [menuView, setMenuView] = useState<'main' | 'campaign' | 'multiplayer' | 'host_public' | 'statistics'>('main');
    const [showPatchNotes, setShowPatchNotes] = useState(false);
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

    // Host Public State
    const [localPort, setLocalPort] = useState("3001");
    const [publicEndpoint, setPublicEndpoint] = useState("");
    const [generatedJoinCode, setGeneratedJoinCode] = useState("");

    // DEV Feature: Toggle UI Visibility & Bypass
    const [isUIVisible, setIsUIVisible] = useState(true);
    const [isDevBypass, setIsDevBypass] = useState(false);
    const localEngineUrlRef = useRef<string>('http://127.0.0.1:3001');
    const bootSplashReleasedRef = useRef(false);
    const [isLocalEngineReady, setIsLocalEngineReady] = useState(false);
    const [isLocalEngineBooting, setIsLocalEngineBooting] = useState(true);
    const [localEngineBootError, setLocalEngineBootError] = useState<string | null>(null);

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

    const waitForLocalServerReachability = async (maxWaitMs: number): Promise<boolean> => {
        const localEngineUrl = normalizeNetworkEndpoint(localEngineUrlRef.current);
        const currentOrigin = getCurrentRendererOrigin();

        if (localEngineUrl && currentOrigin === localEngineUrl) {
            console.log('[App] Renderer is already running from the local engine origin:', localEngineUrl);
            return true;
        }

        if (!ipc?.invoke) {
            return true;
        }

        const startedAt = Date.now();

        while ((Date.now() - startedAt) < maxWaitMs) {
            try {
                const status = await ipc.invoke('local-server-status');
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

    const evaluatedAchievements = evaluateAchievements(
        { statistics },
        achievementUnlocks
    );

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
                if (creatingSteamLobbyRef.current) {
                    console.log('[App] Creating Steam Lobby for Room:', rid);
                    creatingSteamLobbyRef.current = false;

                    (async () => {
                        const hostEndpoint = await resolveSteamHostEndpoint({ preferPublicTunnel: true });
                        if (!hostEndpoint) {
                            throw new Error('Unable to resolve host endpoint for Steam lobby');
                        }
                        const result = await steamService.createLobby(rid, 'Random', 'Standard', hostEndpoint);
                        if (!result.success || !result.lobbyId) {
                            return result;
                        }

                        const createdLobbyId = String(result.lobbyId);
                        setSteamLobbyId(createdLobbyId);
                        steamService.setRichPresence('steam_display', '#Status_WaitingForPlayers');
                        steamService.setRichPresence('connect', `+connect_lobby ${createdLobbyId}`);

                        const inviteResult = await steamService.openInviteDialog(createdLobbyId);
                        if (!inviteResult.success) {
                            console.warn('[App] Failed to open Steam invite dialog, falling back to Friends overlay.', inviteResult.error);
                            steamService.activateOverlay('Friends');
                        }

                        return {
                            ...result,
                            lobbyId: createdLobbyId,
                        };
                    })()
                        .then(res => {
                            if (res.success) {
                                console.log('[App] Steam Lobby Created:', res.lobbyId);
                            } else {
                                setSteamLobbyId(null);
                                steamService.setRichPresence('connect', null);
                                if (ipc?.invoke) {
                                    void ipc.invoke('network:close-public-tunnel');
                                }
                                console.error('[App] Failed to create Steam Lobby:', res.error);
                                alert(`Failed to create Steam Lobby: ${res.error || 'Unknown error'}`);
                            }
                        })
                        .catch((err: any) => {
                            setSteamLobbyId(null);
                            steamService.setRichPresence('connect', null);
                            if (ipc?.invoke) {
                                void ipc.invoke('network:close-public-tunnel');
                            }
                            console.error('[App] Steam lobby host setup failed:', err);
                            alert(`Failed to create Steam Lobby: ${err?.message || 'Unknown error'}`);
                        })
                        .finally(() => {
                            setCreatingSteamLobby(false);
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
            } else if (status === 'waiting') {
                console.log('[CLIENT] returning to lobby reason=server_status_waiting');
                clientMatchState.current = 'LOBBY';
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
        }
        const handleStartFailed = (data: { reason: string }) => {
            console.warn('[CLIENT] MATCH_START_FAILED:', data.reason);
            clientMatchState.current = 'LOBBY';
            setGameStatus('waiting');
            alert(`Failed to start match: ${data.reason}`);
        }

        socket.on('joinedRoom', handleJoinedRoom);
        socket.on('gameStatus', handleGameStatus);
        socket.on('votingUpdate', handleVoting);
        socket.on('gameStarted', handleStarted);
        socket.on('MATCH_START_FAILED', handleStartFailed);

        // Load initial save data
        const loadSave = async () => {
            const backupStatistics = readStatisticsBackup();
            if (!ipc) {
                if (backupStatistics) {
                    statisticsRef.current = backupStatistics;
                    setStatistics(backupStatistics);
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
                } else if (backupStatistics) {
                    statisticsRef.current = backupStatistics;
                    setStatistics(backupStatistics);
                    writeStatisticsBackup(backupStatistics);
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

    // --- Steam Integration ---
    const [steamError, setSteamError] = useState<string | null>(null);
    const [steamUser, setSteamUser] = useState<{ name: string, steamId: string } | null>(null);
    const [steamLobbyId, setSteamLobbyId] = useState<string | null>(null);
    const [creatingSteamLobby, setCreatingSteamLobby] = useState(false);
    const creatingSteamLobbyRef = useRef(false);

    useEffect(() => {
        creatingSteamLobbyRef.current = creatingSteamLobby;
    }, [creatingSteamLobby]);

    const leaveActiveSteamLobby = async () => {
        const activeLobbyId = steamLobbyId;

        setSteamLobbyId(null);
        steamService.setRichPresence('connect', null);

        if (ipc?.invoke) {
            try {
                await ipc.invoke('network:close-public-tunnel');
            } catch (error) {
                console.warn('[App] Failed to close public tunnel cleanly.', error);
            }
        }

        if (!activeLobbyId || !steamService.isInitialized) {
            return;
        }

        const result = await steamService.leaveLobby(activeLobbyId);
        if (!result.success) {
            console.warn('[App] Failed to leave active Steam lobby cleanly.', result.error);
        }
    };

    const handleLeaveToMenu = async () => {
        await leaveActiveSteamLobby();
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

        if (options?.preferPublicTunnel && ipc?.invoke) {
            const tunnelResult = await ipc.invoke('network:ensure-public-tunnel', { port: fallbackPort });
            const publicEndpoint = normalizeNetworkEndpoint(tunnelResult?.endpoint);

            if (!tunnelResult?.success || !publicEndpoint) {
                console.error('[App] Failed to provision public tunnel for Steam hosting.', tunnelResult?.error);
                return null;
            }

            socket.emit('set_tunnel_url', publicEndpoint);
            return publicEndpoint;
        }

        return await new Promise((resolve) => {
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
    };

    useEffect(() => {
        // Listen for Steam Init
        const onSteamInit = (user: any) => {
            console.log('[App] Steam Initialized:', user);
            setSteamUser(user);
            // Set Rich Presence to Main Menu
            steamService.setRichPresence('steam_display', '#Status_MainMenu');
            steamService.setRichPresence('connect', null);
        };

        const onSteamError = (err: string) => {
            console.error('[App] Steam Error:', err);
            if (!isDevBypass) {
                setSteamError(err);
            }
        };

        const onJoinLobby = async (lobbyId: string) => {
            console.log('[App] Joining Steam Lobby:', lobbyId);
            const data = await steamService.getLobbyData(lobbyId);
            if (!data.success || !data.roomId) {
                console.error('[App] Failed to get room from Steam Lobby', data.error);
                alert('Failed to join Steam Lobby: ' + (data.error || 'Unknown error'));
                return;
            }

            const endpoint = normalizeNetworkEndpoint(data.endpoint);
            if (!endpoint) {
                alert('Host endpoint is missing in this Steam lobby. Ask the host to recreate it.');
                return;
            }

            const connectionResult = await connectToServer(endpoint);
            if (!connectionResult.success) {
                console.error('[App] Failed to connect to Steam host endpoint', endpoint, connectionResult.error);
                alert(`Failed to connect to host endpoint: ${connectionResult.error || endpoint}`);
                return;
            }

            const activeLobbyId = String(data.lobbyId || lobbyId);
            console.log('[App] Steam Lobby mapped to Room:', data.roomId, 'Endpoint:', endpoint);
            setIsLocalMode(false);
            setMatchStatsSource('steam');
            setSteamLobbyId(activeLobbyId);
            steamService.setRichPresence('connect', `+connect_lobby ${activeLobbyId}`);
            setLastJoinedRoom(data.roomId);
            socket.emit('joinByCode', data.roomId);
            setIsPlaying(true);
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

        void commitAchievementUnlocks(nextState);

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

    const handleQuitGame = () => {
        if (window.confirm("Are you sure you want to quit to desktop?")) {
            window.close(); // Electron handles this
        }
    };


    const quickJoin = async (mapType: string = 'random', forceNew: boolean = false, source: MatchSource = 'lan') => {
        if (!(await bootstrapLocalEngine())) {
            creatingSteamLobbyRef.current = false;
            setCreatingSteamLobby(false);
            alert('Failed to start the local game engine. Please restart the game.');
            return;
        }

        setIsLocalMode(false);
        setMatchStatsSource(source);
        socket.emit('quickJoin', { mapType, forceNew });
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
        setIsPlaying(true);

        socket.emit('quickJoin', {
            mapType: 'random',
            tunnelUrl: generatedJoinCode || undefined
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
        if (isReadyOnEndpoint(localEngineUrlRef.current)) {
            setIsLocalEngineReady(true);
            setLocalEngineBootError(null);
            return true;
        }

        setIsLocalEngineBooting(true);
        setLocalEngineBootError(null);

        const ready = await ensureLocalEngineReady(retries, delayMs, maxWaitMs);

        setIsLocalEngineReady(ready);
        setIsLocalEngineBooting(false);

        if (ready) {
            setLocalEngineBootError(null);
        } else {
            setLocalEngineBootError('Local game engine is not ready yet.');
        }

        return ready;
    };

    useEffect(() => {
        let cancelled = false;

        const prewarm = async () => {
            setIsLocalEngineBooting(true);
            setLocalEngineBootError(null);
            emitBootStatus(
                'Starting local command server...',
                'Creating the local battlefield and stabilising multiplayer services.'
            );

            const ready = await ensureLocalEngineReady(8, 500, INITIAL_LOCAL_ENGINE_BOOT_BUDGET_MS);
            if (cancelled) return;

            setIsLocalEngineReady(ready);
            setIsLocalEngineBooting(false);

            if (!ready) {
                setLocalEngineBootError('Local game engine failed to start during launch.');
                emitBootStatus(
                    'Startup completed with warnings.',
                    'The menu will open now. You can retry the local engine from inside the game.'
                );
                releaseBootSplash(520);
                return;
            }

            emitBootStatus(
                'Command deck online.',
                'Loading the menu and warming up the simulation.'
            );
            releaseBootSplash(420);
        };

        prewarm();
        return () => { cancelled = true; };
    }, []);

    const startCampaignLevel = async (levelIndex: number) => {
        const level = CAMPAIGN_LEVELS[levelIndex];
        if (!level) return;

        const selectedMapType = resolveMapType(level.mapType);

        setIsCampaignMode(true);
        setIsTutorialMode(Boolean(level.isTutorial));
        setCampaignLevel(levelIndex);
        setMatchStatsSource('campaign');
        // Ensure the embedded local engine is ready.
        if (!(await bootstrapLocalEngine())) {
            alert("Failed to start the local game engine. Please restart the game.");
            return;
        }
        setShowCampaignModal(null);
        setGameStatus('playing');
        setIsLocalMode(true);

        // Trigger Save
        triggerSave({ campaignLevel: levelIndex });

        socket.emit('createCustomGame', {
            mapType: selectedMapType,
            botCount: level.botCount,
            difficulty: level.difficulty,
            startingResources: level.startingResources
        });
        setIsPlaying(true);
    };

    const nextLevel = () => {
        startCampaignLevel(campaignLevel + 1);
    };

    const retryLevel = () => {
        startCampaignLevel(campaignLevel);
    };

    const startCustomGame = async () => {
        // Optimistically set playing status to avoid lobby flash
        setGameStatus('playing');
        setIsCampaignMode(false);
        setIsTutorialMode(false);
        setIsLocalMode(true);
        setMatchStatsSource('custom');

        if (!(await bootstrapLocalEngine())) {
            setIsLocalMode(false);
            alert("Failed to start the local game engine. Please restart the game.");
            return;
        }

        socket.emit('createCustomGame', customConfig);
        setIsPlaying(true);
    };

    const handleMatchResolved = async (summary: MatchStatisticsSummary) => {
        const playedAt = new Date().toISOString();
        const nextStatistics = recordMatchResult(statisticsRef.current, summary, playedAt);
        const committed = await commitStatistics(nextStatistics);

        if (steamService.isInitialized) {
            await pushStatisticsToSteam(committed);
        }
    };

    return (
        <div className="App">
            <GameCanvas />
            {/* GameCanvas always rendered in background */}

            {/* Main Menu Layer */}
            {isUIVisible && !isPlaying && (!steamError || isDevBypass) && (
                <>
                    <button
                        type="button"
                        className="patch-notes-float-btn"
                        onClick={() => setShowPatchNotes(true)}
                    >
                        Patch Notes
                    </button>

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

                    <div className={`menu ${menuView === 'statistics' ? 'menu--statistics' : ''}`}>
                        <h1 className="menu-title-accessible">Conquerors: Dominion</h1>
                        <LobbyLogo />

                        {/* Prewarm the local engine before campaign/custom can start */}
                        {isLocalEngineBooting && (
                            <div className="local-engine-loading" style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', padding: '10px 20px', borderRadius: '8px', border: '1px solid #444', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div className="spinner" style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                <p style={{ margin: 0, fontSize: '14px', color: '#fff' }}>Preparing Local Game Engine...</p>
                            </div>
                        )}
                        {!isLocalEngineBooting && !isLocalEngineReady && localEngineBootError && (
                            <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #664', background: 'rgba(0,0,0,0.5)', color: '#f1d9aa', fontSize: '14px', textAlign: 'center' }}>
                                <div style={{ marginBottom: '8px' }}>{localEngineBootError}</div>
                                <button onClick={() => bootstrapLocalEngine(14, 750)} className="menu-btn small">Retry Engine Start</button>
                            </div>
                        )}

                    {menuView === 'main' && (
                        <div className="menu-column menu-main-actions">
                            <button onClick={() => setMenuView('multiplayer')} className="menu-btn menu-btn-main">Multiplayer</button>
                            <button onClick={() => setMenuView('campaign')} className="menu-btn menu-btn-main" disabled={!isLocalEngineReady}>Campaign & Custom</button>
                            <button onClick={() => setMenuView('statistics')} className="menu-btn menu-btn-main">Stats & Achievements</button>
                        </div>
                    )}

                    {menuView === 'multiplayer' && (
                        <div className="menu-column menu-column--multiplayer">
                            <div className="menu-eyebrow">Online Command</div>
                            <h3 className="menu-section-title">Multiplayer</h3>
                            <p className="menu-section-copy">
                                Host on your local network, invite Steam friends, or route the match onto the public internet.
                            </p>

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
                                            await leaveActiveSteamLobby();
                                            setCreatingSteamLobby(true);
                                            await quickJoin('random', true, 'steam');
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
                                            onClick={() => startCampaignLevel(index)}
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
                                                    <span className="campaign-map">Map: {level.mapType === 'random' ? 'Random' : level.mapType}</span>
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
                            <StatisticsPanel
                                statistics={statistics}
                                achievements={evaluatedAchievements}
                                campaignLevel={campaignLevel}
                                totalCampaignStages={STANDARD_CAMPAIGN_STAGE_COUNT}
                                campaignProgressLabel={getCampaignProgressLabel(campaignLevel)}
                                steamConnected={steamService.isInitialized}
                            />
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

            <PatchNotesModal
                isOpen={showPatchNotes}
                onClose={() => setShowPatchNotes(false)}
            />

            {/* In-Game UI Layer - Keep mounted to preserve state, but hide if toggled/blocked */}
            <div style={{ display: (isUIVisible && isPlaying && (!steamError || isDevBypass)) ? 'block' : 'none' }}>
                <GameUI
                    onLeave={handleLeaveToMenu}
                    roomId={lastJoinedRoom}
                    initialGameStatus={gameStatus as 'waiting' | 'voting' | 'playing'}
                    isLocalMode={isLocalMode}
                    isDevBypass={isDevBypass}
                    tutorialMode={isTutorialMode}
                    matchStatsSource={matchStatsSource}
                    steamLobbyId={steamLobbyId}
                    onMatchResolved={handleMatchResolved}
                />

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
                        <button onClick={() => window.close()} className="menu-btn primary">Quit Game</button>
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
                <ConnectionLostOverlay
                    onRetry={() => connectionManager.retry()}
                    onMainMenu={() => {
                        connectionManager.cancel();
                        setIsPlaying(false);
                        setMenuView('main');
                        // Local storage skip if we want it to persist through reload
                        window.location.reload();
                    }}
                />
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
                        <SettingsModal onClose={() => setShowSettings(false)} mapData={null} />
                    )}
                </>
            )}
        </div>
    );
}

export default App;
