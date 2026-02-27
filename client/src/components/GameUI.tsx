import React, { useEffect, useState, useRef } from 'react';
import { socket, connectionManager } from '../services/socket';
import { steamService } from '../services/steam';
import type { ConnectionState } from '../services/socket';
import type { Player, GameMap, Unit } from '../types/game';
import { SettingsModal } from './SettingsModal';
import { settingsManager } from '../game/SettingsManager';
import { Confetti } from './Confetti';
import { EndGameOverlay } from './EndGameOverlay';
import './GameUI.css';

interface BattlePing {
    id: string;
    worldX: number;
    worldY: number;
    startTime: number;
    isHQ: boolean;
}

interface ChatMessage {
    sender: string;
    content: string;
    timestamp: number;
}

const ChatOverlay: React.FC<{
    messages: ChatMessage[];
    onSend: (msg: string) => void;
    myId: string;
    players: Map<string, Player>;
    visible: boolean;
    onClose: () => void;
    position: { x: number, y: number };
    onDragStart: (e: React.MouseEvent) => void;
}> = ({ messages, onSend, myId, players, visible, onClose, position, onDragStart }) => {
    const [input, setInput] = useState('');
    const [isMinimized, setIsMinimized] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (visible && !isMinimized) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, visible, isMinimized]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            onSend(input.trim());
            setInput('');
        }
    };

    return (
        <div
            className={`chat-window ${isMinimized ? 'minimized' : ''} ${!visible ? 'hidden' : ''}`}
            style={{ left: position.x, top: position.y, bottom: 'auto', right: 'auto' }}
        >
            {/* Chat Header */}
            <div
                className={`chat-header ${isMinimized ? 'minimized' : ''}`}
                onMouseDown={onDragStart}
                style={{ cursor: 'move' }}
            >
                <span className="chat-header-title">
                    <span>💬</span> Chat
                </span>
                <div className="chat-header-controls">
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="stats-control-btn"
                        title={isMinimized ? "Expand" : "Minimize"}
                    >
                        {isMinimized ? '▲' : '▼'}
                    </button>
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={onClose}
                        className="stats-control-btn stats-close-btn"
                        title="Hide Chat Window"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    <div
                        className="chat-messages"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {messages.map((msg, i) => {
                            const p = players.get(msg.sender);
                            const name = msg.sender === 'System' ? 'System' : (p?.name || (msg.sender === myId ? 'Me' : msg.sender.substr(0, 4)));
                            const color = msg.sender === 'System' ? '#ffff00' : (p?.color || '#fff');
                            return (
                                <div key={i} className="chat-message-item">
                                    <span className="chat-message-sender" style={{ '--sender-color': color } as React.CSSProperties}>{name}: </span>
                                    {msg.content}
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSend} className="chat-input-form">
                        <input
                            onMouseDown={(e) => e.stopPropagation()}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="Type a message..."
                            onKeyDown={e => e.stopPropagation()}
                            className="chat-input"
                        />
                    </form>
                </>
            )}
        </div>
    );
};

const VICTORY_TAGLINES = [
    "Mission Accomplished", "Total Domination", "Enemy Eradicated", "Sector Secured", "Command Supremacy"
];
const DEFEAT_TAGLINES = [
    "Base Destroyed", "Critical Failure", "Command Offline", "Sector Lost", "Retreat Impossible"
];

const GameOverOverlay: React.FC<{
    winnerId: string | null;
    playerId: string | undefined;
    onReturn: () => void;
    onSpectate?: () => void;
    reason?: string;
    showSpectate?: boolean;
}> = ({ winnerId, playerId, onReturn, onSpectate, reason, showSpectate }) => {
    const isWinner = winnerId === playerId;
    const title = isWinner ? "VICTORY!" : (winnerId ? "DEFEAT" : "GAME OVER");
    const color = isWinner ? "#4CAF50" : "#F44336";

    // Random tagline (memoized to prevent flickering)
    const tagline = useRef(
        isWinner
            ? VICTORY_TAGLINES[Math.floor(Math.random() * VICTORY_TAGLINES.length)]
            : DEFEAT_TAGLINES[Math.floor(Math.random() * DEFEAT_TAGLINES.length)]
    ).current;

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            color: 'white',
            fontFamily: 'monospace',
            pointerEvents: 'auto' // Block input
        }}>
            {isWinner && <Confetti />}
            {!isWinner && (
                <div className="defeat-fx">
                    {/* CSS-based Fire/Smoke effect placeholder */}
                    <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
                        background: 'linear-gradient(to top, rgba(255,50,0,0.2), transparent)',
                        pointerEvents: 'none'
                    }} />
                </div>
            )}

            <h1 style={{
                fontSize: '72px',
                color: color,
                marginBottom: '10px',
                textShadow: '0 0 20px ' + color,
                animation: 'fadeIn 1s ease-out'
            }}>{title}</h1>

            <h2 style={{
                fontSize: '24px',
                color: '#aaa',
                marginBottom: '40px',
                fontStyle: 'italic',
                animation: 'slideUp 1s ease-out'
            }}>"{tagline}"</h2>

            {reason && <div style={{ marginBottom: '30px', color: '#888' }}>
                Reason: {reason === 'HQ_DESTROYED' ? 'Headquarters Destroyed' : (reason === 'ALL_ENEMIES_DEFEATED' ? 'All Enemies Defeated' : reason)}
            </div>}

            <div style={{ display: 'flex', gap: '20px' }}>
                {showSpectate && onSpectate && (
                    <button
                        onClick={onSpectate}
                        style={{
                            padding: '15px 30px',
                            fontSize: '20px',
                            backgroundColor: '#444',
                            color: 'white',
                            border: '2px solid #666',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.backgroundColor = '#555'}
                        onMouseOut={e => e.currentTarget.style.backgroundColor = '#444'}
                    >
                        👁️ Spectate
                    </button>
                )}

                <button
                    onClick={onReturn}
                    style={{
                        padding: '15px 30px',
                        fontSize: '20px',
                        backgroundColor: isWinner ? '#2E7D32' : '#C62828',
                        color: 'white',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                    onMouseOut={e => e.currentTarget.style.filter = 'brightness(1.0)'}
                >
                    Return to Menu
                </button>
            </div>
        </div>
    );
};

// Shared Recruitment Button Component (Step 2)
const RecruitButton: React.FC<{
    type: string;
    label: string;
    queueCount: number;
    onClick: () => void;
}> = ({ type, label, queueCount, onClick }) => {
    const btnRef = useRef<HTMLButtonElement>(null);

    // Debug overflow check (Step 6)
    useEffect(() => {
        if (btnRef.current) {
            const { scrollWidth, clientWidth, scrollHeight, clientHeight } = btnRef.current;
            if (scrollWidth > clientWidth || scrollHeight > clientHeight) {
                console.warn(`[RecruitButton Overflow] Unit: ${label} | Button: ${clientWidth}x${clientHeight} | Content: ${scrollWidth}x${scrollHeight}`);
            }
        }
    }, [label]);

    return (
        <button
            ref={btnRef}
            key={type}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className="recruit-option-btn"
            title={label}
        >
            <span>{label}</span>
            {queueCount > 0 && (
                <span className="recruit-queue-count">
                    {queueCount}
                </span>
            )}
        </button>
    );
};

interface GameUIProps {
    onLeave: () => void;
    roomId: string | null;
    initialGameStatus?: 'waiting' | 'voting' | 'playing';
    isLocalMode?: boolean;
    isDevBypass?: boolean;
}

type LoadingCheckItem = {
    label: string;
    ready: boolean;
};

const PERF_SAMPLE_LIMIT = 10;
const PING_SAMPLE_WINDOW = 3;
const FPS_SAMPLE_WINDOW = 6;
const LOBBY_MIN_WARMUP_MS = 1200;
const LOBBY_MAX_WARMUP_MS = 9000;
const MATCH_MIN_WARMUP_MS = 1800;
const MATCH_MAX_WARMUP_MS = 14000;

const getIconForType = (type: string) => {
    switch (type) {
        case 'soldier': return '💂';
        case 'sniper': return '🎯';
        case 'rocketeer': return '🚀';
        case 'destroyer': return '🚢';
        case 'construction_ship': return '🏗️';
        case 'ferry': return '⛴️';
        case 'builder': return '🛠️';
        case 'base': return '🏠';
        case 'mine': return '⛏️';
        case 'barracks': return '⚔️';
        case 'tower': return '🏰';
        case 'dock': return '⚓';
        case 'oil_rig': return '🛢️';
        case 'wall': return '🧱';
        case 'bridge_node': return '🌉';
        case 'wall_node': return '🏰';
        case 'tank_factory': return '🏭';
        case 'tank': return '🚜';
        case 'humvee': return '🚙';
        case 'missile_launcher': return '🚚';
        case 'air_base': return '🛫';
        case 'light_plane': return '🛩️';
        case 'heavy_plane': return '✈️';
        case 'aircraft_carrier': return '🛳️';
        case 'mothership': return '🛸';
        default: return '❓';
    }
};

export const GameUI: React.FC<GameUIProps> = ({ onLeave, roomId, initialGameStatus, isLocalMode = false, isDevBypass = false }) => {
    const [player, setPlayer] = useState<Player | null>(null);
    const [hoverInfo, setHoverInfo] = useState<any>(null);
    const [selectedIslandId, setSelectedIslandId] = useState<string | null>(null);
    const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
    const [selectedBuildingType, setSelectedBuildingType] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
    const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>([]);
    const [revealedOilSpots, setRevealedOilSpots] = useState<Set<string>>(new Set());
    const [showSettings, setShowSettings] = useState(false);
    const [isConstructionMinimized, setIsConstructionMinimized] = useState(false);
    const [isSelectionMinimized, setIsSelectionMinimized] = useState(false);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [isScannerActive, setIsScannerActive] = useState(false);
    const [isChatVisible, setIsChatVisible] = useState(true);

    // Chat Drag State
    const [chatPos, setChatPos] = useState({ x: 20, y: window.innerHeight - 380 });
    const [isDraggingChat, setIsDraggingChat] = useState(false);
    const chatDragOffset = useRef({ x: 0, y: 0 });

    // Minimap State
    const [allPlayers, setAllPlayers] = useState<Map<string, Player>>(new Map());
    const [mapData, setMapData] = useState<GameMap | null>(null);
    const [units, setUnits] = useState<Unit[]>([]);
    const [minimapPos, setMinimapPos] = useState({ x: window.innerWidth - 220, y: 60 });
    const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
    const [viewRect, setViewRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const dragOffset = useRef({ x: 0, y: 0 });

    // Stats Panel Drag State
    const [statsPanelPos, setStatsPanelPos] = useState<{ x: number, y: number } | null>(null);
    const [isDraggingStats, setIsDraggingStats] = useState(false);
    const [isStatsMinimized, setIsStatsMinimized] = useState(false);
    const statsDragOffset = useRef({ x: 0, y: 0 });

    // Build Menu Drag State
    const [buildMenuPos, setBuildMenuPos] = useState({ x: 20, y: 120 });
    const [isDraggingBuildMenu, setIsDraggingBuildMenu] = useState(false);
    const buildMenuDragOffset = useRef({ x: 0, y: 0 });

    // Performance Stats
    const [ping, setPing] = useState(0);
    const [fps, setFps] = useState(60);
    const [memory, setMemory] = useState(0);

    // Multiplayer Lobby State
    const [gameStatus, setGameStatus] = useState<'waiting' | 'voting' | 'playing'>(initialGameStatus || 'waiting');
    const [requiredPlayers, setRequiredPlayers] = useState(2);
    const [votingData, setVotingData] = useState<{ timeLeft: number, votes: [string, string][] }>({ timeLeft: 0, votes: [] });
    const [isLobbyLoading, setIsLobbyLoading] = useState(gameStatus !== 'playing');
    const [isMatchLoading, setIsMatchLoading] = useState(gameStatus === 'playing');
    const [matchLoadTimedOut, setMatchLoadTimedOut] = useState(false);
    const [hasPlayersSnapshot, setHasPlayersSnapshot] = useState(false);
    const [hasUnitsSnapshot, setHasUnitsSnapshot] = useState(false);
    const [lobbyLoadChecks, setLobbyLoadChecks] = useState({
        connection: false,
        players: false,
        ping: false,
        fps: false
    });
    const [matchLoadChecks, setMatchLoadChecks] = useState({
        map: false,
        units: false,
        player: false,
        ping: false,
        fps: false
    });
    const prevGameStatusRef = useRef<'waiting' | 'voting' | 'playing' | null>(null);
    const lobbyLoadStartedAtRef = useRef<number>(Date.now());
    const matchLoadStartedAtRef = useRef<number>(Date.now());
    const pingSamplesRef = useRef<number[]>([]);
    const fpsSamplesRef = useRef<number[]>([]);

    // Client-Side Gate (Anti-Bounce)
    const clientMatchState = useRef<'LOBBY' | 'STARTING' | 'IN_MATCH'>('LOBBY');
    const activeMatchId = useRef<string | null>(null);

    // Debug State
    const [showDebug, setShowDebug] = useState(false);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('toggle-debug-view', { detail: { show: showDebug } }));
    }, [showDebug]);

    useEffect(() => {
        if (initialGameStatus) {
            setGameStatus(initialGameStatus);
        }
    }, [initialGameStatus]);

    // Reset stats minimization when selection changes
    useEffect(() => {
        setIsStatsMinimized(false);
    }, [selectedUnitIds, selectedBuildingIds, selectedNodeIds]);

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const resetDefaults = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        setChatPos({ x: 20, y: Math.max(0, h - 380) });
        setMinimapPos({ x: Math.max(0, w - 220), y: 60 });
        setBuildMenuPos({ x: 20, y: 120 });
        setStatsPanelPos(null);
    };
    useEffect(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        setMinimapPos(p => ({ x: clamp(p.x, 0, Math.max(0, w - 200)), y: clamp(p.y, 0, Math.max(0, h - 150)) }));
        setChatPos(p => ({ x: clamp(p.x, 0, Math.max(0, w - 300)), y: clamp(p.y, 0, Math.max(0, h - 220)) }));
        setBuildMenuPos(p => ({ x: clamp(p.x, 0, Math.max(0, w - 160)), y: clamp(p.y, 0, Math.max(0, h - 300)) }));
        if (statsPanelPos) {
            const nx = clamp(statsPanelPos.x, 0, Math.max(0, w - 260));
            const ny = clamp(statsPanelPos.y, 0, Math.max(0, h - 240));
            if (nx !== statsPanelPos.x || ny !== statsPanelPos.y) {
                setStatsPanelPos({ x: nx, y: ny });
            }
        }
        const onResize = () => {
            const w2 = window.innerWidth;
            const h2 = window.innerHeight;
            setMinimapPos(p => ({ x: clamp(p.x, 0, Math.max(0, w2 - 200)), y: clamp(p.y, 0, Math.max(0, h2 - 150)) }));
            setChatPos(p => ({ x: clamp(p.x, 0, Math.max(0, w2 - 300)), y: clamp(p.y, 0, Math.max(0, h2 - 220)) }));
            setBuildMenuPos(p => ({ x: clamp(p.x, 0, Math.max(0, w2 - 160)), y: clamp(p.y, 0, Math.max(0, h2 - 300)) }));
            if (statsPanelPos) {
                const nx2 = clamp(statsPanelPos.x, 0, Math.max(0, w2 - 260));
                const ny2 = clamp(statsPanelPos.y, 0, Math.max(0, h2 - 240));
                setStatsPanelPos({ x: nx2, y: ny2 });
            }
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [statsPanelPos]);
    useEffect(() => {
        if (gameStatus !== 'playing') {
            resetDefaults();
        }
    }, [gameStatus]);

    const [spectating, setSpectating] = useState(false);
    const [winnerId, setWinnerId] = useState<string | null>(null);
    const [gameOverReason, setGameOverReason] = useState<string | undefined>(undefined);
    const [eliminated, setEliminated] = useState(false);
    const [matchEnded, setMatchEnded] = useState(false); // New authoritative state
    const [isSpectateActive, setIsSpectateActive] = useState(false); // Actual spectate mode active (UI hidden)
    const [endGameState, setEndGameState] = useState<{ mode: 'VICTORY' | 'DEFEAT', canSpectate: boolean, reason?: string } | null>(null);

    const [tunnelPassword, setTunnelPassword] = useState<string | null>(null);
    const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>(connectionManager.getState());

    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const unsubscribe = connectionManager.subscribe(setConnectionState);
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (connectionState.phase === 'IDLE') {
            connectionManager.connect(connectionState.url);
        }
    }, [connectionState.phase]);

    useEffect(() => {
        // Request game state when ready
        if (connectionState.phase === 'READY') {
            socket.emit('request_game_state');
        }
    }, [connectionState.phase]);

    const lobbyConnectionReady = isLocalMode || isDevBypass || connectionState.phase === 'READY';

    const isPingStable = (samples: number[]) => {
        if (samples.length < PING_SAMPLE_WINDOW) return false;
        const windowed = samples.slice(-PING_SAMPLE_WINDOW);
        const avg = windowed.reduce((sum, value) => sum + value, 0) / windowed.length;
        const jitter = Math.max(...windowed) - Math.min(...windowed);
        const maxPing = isLocalMode ? 120 : 260;
        const maxJitter = isLocalMode ? 40 : 120;
        return avg <= maxPing && jitter <= maxJitter;
    };

    const isFpsStable = (samples: number[]) => {
        if (samples.length < FPS_SAMPLE_WINDOW) return false;
        const windowed = samples.slice(-FPS_SAMPLE_WINDOW);
        const avg = windowed.reduce((sum, value) => sum + value, 0) / windowed.length;
        const minFps = Math.min(...windowed);
        return avg >= 45 && minFps >= 28;
    };

    useEffect(() => {
        const prevStatus = prevGameStatusRef.current;
        const firstRun = prevStatus === null;
        const enteredMatch = gameStatus === 'playing' && (firstRun || prevStatus !== 'playing');
        const enteredLobby = (gameStatus === 'waiting' || gameStatus === 'voting') && (firstRun || prevStatus === 'playing');

        if (enteredMatch) {
            pingSamplesRef.current = [];
            fpsSamplesRef.current = [];
            setHasUnitsSnapshot(false);
            setMatchLoadTimedOut(false);
            setMatchLoadChecks({
                map: false,
                units: false,
                player: false,
                ping: false,
                fps: false
            });
            matchLoadStartedAtRef.current = Date.now();
            setIsMatchLoading(true);
            setIsLobbyLoading(false);
        } else if (gameStatus !== 'playing') {
            setIsMatchLoading(false);
            setMatchLoadTimedOut(false);
        }

        if (enteredLobby) {
            pingSamplesRef.current = [];
            fpsSamplesRef.current = [];
            const playersReady = allPlayers.size > 0;
            setHasPlayersSnapshot(playersReady);
            setLobbyLoadChecks({
                connection: lobbyConnectionReady,
                players: playersReady,
                ping: false,
                fps: false
            });
            lobbyLoadStartedAtRef.current = Date.now();
            setIsLobbyLoading(true);
        }

        prevGameStatusRef.current = gameStatus;
    }, [allPlayers.size, gameStatus, lobbyConnectionReady]);

    useEffect(() => {
        if (!isLobbyLoading) return;
        setLobbyLoadChecks(prev => {
            if (prev.connection === lobbyConnectionReady) return prev;
            return { ...prev, connection: lobbyConnectionReady };
        });
    }, [isLobbyLoading, lobbyConnectionReady]);

    useEffect(() => {
        if (!isLobbyLoading) return;
        const playersReady = hasPlayersSnapshot || allPlayers.size > 0;
        setLobbyLoadChecks(prev => {
            if (prev.players === playersReady) return prev;
            return { ...prev, players: playersReady };
        });
    }, [allPlayers.size, hasPlayersSnapshot, isLobbyLoading]);

    useEffect(() => {
        if (!isMatchLoading) return;
        const mapReady = !!mapData && mapData.islands.length > 0;
        setMatchLoadChecks(prev => {
            if (prev.map === mapReady) return prev;
            return { ...prev, map: mapReady };
        });
    }, [isMatchLoading, mapData]);

    useEffect(() => {
        if (!isMatchLoading) return;
        setMatchLoadChecks(prev => {
            if (prev.units === hasUnitsSnapshot) return prev;
            return { ...prev, units: hasUnitsSnapshot };
        });
    }, [hasUnitsSnapshot, isMatchLoading]);

    useEffect(() => {
        if (!isMatchLoading) return;
        const playerReady = !!player;
        setMatchLoadChecks(prev => {
            if (prev.player === playerReady) return prev;
            return { ...prev, player: playerReady };
        });
    }, [isMatchLoading, player]);

    useEffect(() => {
        if (ping <= 0) return;
        const updated = [...pingSamplesRef.current.slice(-(PERF_SAMPLE_LIMIT - 1)), ping];
        pingSamplesRef.current = updated;
        const pingReady = isPingStable(updated);

        if (isLobbyLoading) {
            setLobbyLoadChecks(prev => {
                if (prev.ping === pingReady) return prev;
                return { ...prev, ping: pingReady };
            });
        }

        if (isMatchLoading) {
            setMatchLoadChecks(prev => {
                if (prev.ping === pingReady) return prev;
                return { ...prev, ping: pingReady };
            });
        }
    }, [isLobbyLoading, isMatchLoading, ping]);

    useEffect(() => {
        if (fps <= 0) return;
        const updated = [...fpsSamplesRef.current.slice(-(PERF_SAMPLE_LIMIT - 1)), fps];
        fpsSamplesRef.current = updated;
        const fpsReady = isFpsStable(updated);

        if (isLobbyLoading) {
            setLobbyLoadChecks(prev => {
                if (prev.fps === fpsReady) return prev;
                return { ...prev, fps: fpsReady };
            });
        }

        if (isMatchLoading) {
            setMatchLoadChecks(prev => {
                if (prev.fps === fpsReady) return prev;
                return { ...prev, fps: fpsReady };
            });
        }
    }, [fps, isLobbyLoading, isMatchLoading]);

    useEffect(() => {
        if (!isLobbyLoading) return;
        const timer = window.setInterval(() => {
            const elapsed = Date.now() - lobbyLoadStartedAtRef.current;
            const ready = lobbyLoadChecks.connection && lobbyLoadChecks.players && lobbyLoadChecks.ping && lobbyLoadChecks.fps;
            if ((ready && elapsed >= LOBBY_MIN_WARMUP_MS) || elapsed >= LOBBY_MAX_WARMUP_MS) {
                setIsLobbyLoading(false);
            }
        }, 120);

        return () => window.clearInterval(timer);
    }, [isLobbyLoading, lobbyLoadChecks]);

    useEffect(() => {
        if (!isMatchLoading) return;
        const timer = window.setInterval(() => {
            const elapsed = Date.now() - matchLoadStartedAtRef.current;
            const ready = matchLoadChecks.map && matchLoadChecks.units && matchLoadChecks.player && matchLoadChecks.ping && matchLoadChecks.fps;
            if (ready && elapsed >= MATCH_MIN_WARMUP_MS) {
                setIsMatchLoading(false);
                return;
            }

            if (elapsed >= MATCH_MAX_WARMUP_MS) {
                setMatchLoadTimedOut(true);
                setIsMatchLoading(false);
            }
        }, 120);

        return () => window.clearInterval(timer);
    }, [isMatchLoading, matchLoadChecks]);

    useEffect(() => {
        // Ping Loop
        const pingInterval = setInterval(() => {
            if (socket.connected) socket.emit('ping_check', Date.now());
        }, 1000);

        // Memory Loop
        const memoryInterval = setInterval(() => {
            if ((performance as any).memory) {
                setMemory(Math.round((performance as any).memory.usedJSHeapSize / 1048576));
            }
        }, 1000);

        const handlePong = (start: number) => {
            setPing(Date.now() - start);
        };

        const handleTunnelPassword = (pwd: string) => {
            setTunnelPassword(pwd);
        };

        const handleTunnelUrl = (url: string) => {
            setTunnelUrl(url);
        };

        const handleFps = (e: CustomEvent) => {
            setFps(e.detail.fps);
        };

        const handleGameStatus = (status: 'waiting' | 'voting' | 'playing') => {
            // Gate: Ignore lobby updates if we are starting or in match
            if (clientMatchState.current !== 'LOBBY') {
                if (status === 'waiting') {
                    console.log(`[CLIENT_GATE] IGNORED LOBBY_UPDATE (waiting) because clientMatchState=${clientMatchState.current}`);
                    return;
                }
            }

            setGameStatus(prevStatus => {
                if (status === 'waiting' && prevStatus === 'playing') {
                    console.log('[CLIENT] returning to lobby reason=server_status_waiting');
                    console.log(`[NAV_TO_LOBBY] reason=server_status_waiting source=handleGameStatus`);
                    clientMatchState.current = 'LOBBY';
                    (window as any).gameMenuMode = true;
                    window.dispatchEvent(new CustomEvent('game-menu-mode', { detail: true }));
                }
                if (status === 'playing') {
                    console.log(`[NAV_TO_GAME] matchId=${activeMatchId.current} source=handleGameStatus`);
                    (window as any).gameMenuMode = false;
                    window.dispatchEvent(new CustomEvent('game-menu-mode', { detail: false }));
                }
                return status;
            });
        };

        const handleLobbySettings = (data: { requiredPlayers: number }) => {
            console.log('Received lobbySettings:', data);
            setRequiredPlayers(data.requiredPlayers);
        };

        const handleVotingUpdate = (data: { timeLeft: number, votes: [string, string][] }) => {
            setGameStatus('voting');
            setVotingData(data);
        };

        const handleGameStarted = (_data: any) => {
            console.log('[CLIENT] received MATCH_STARTED');
            console.log('[CLIENT] entering in-game');

            clientMatchState.current = 'IN_MATCH';
            if (roomId) activeMatchId.current = roomId;

            console.log(`[NAV_TO_GAME] matchId=${roomId}`);

            pingSamplesRef.current = [];
            fpsSamplesRef.current = [];
            setHasUnitsSnapshot(false);
            setMatchLoadTimedOut(false);
            setMatchLoadChecks({
                map: false,
                units: false,
                player: false,
                ping: false,
                fps: false
            });
            matchLoadStartedAtRef.current = Date.now();
            setIsMatchLoading(true);

            setGameStatus('playing');
            (window as any).gameMenuMode = false;
            window.dispatchEvent(new CustomEvent('game-menu-mode', { detail: false }));
            setWinnerId(null);
            setGameOverReason(undefined);
            setEliminated(false);
            setSpectating(false);
            setMatchEnded(false);
            setIsSpectateActive(false);
            // Reset minimap or other UI if needed
        };

        const handleGameOver = (data: { winnerId: string, reason?: string }) => {
            // Legacy handler, keep for safety but MATCH_ENDED is primary
            if (!matchEnded) {
                const isMe = data.winnerId === socket.id;
                console.log(`gameOver (Legacy) received. Winner: ${data.winnerId}, Local: ${socket.id}, DidWin: ${isMe}`);

                setWinnerId(data.winnerId);
                setGameOverReason(data.reason);
                // setMatchEnded(true); // DISABLED: Using EndGameOverlay

                setEndGameState({
                    mode: isMe ? 'VICTORY' : 'DEFEAT',
                    canSpectate: !isMe
                });
            }
        };

        const handleMatchEnded = (data: { winnerPlayerId: string | null, eliminatedPlayerIds: string[], endReason: string, timestamp: number }) => {
            const isMe = data.winnerPlayerId === socket.id;
            console.log(`MATCH_ENDED received. Winner: ${data.winnerPlayerId}, Local: ${socket.id}, DidWin: ${isMe}`);

            setWinnerId(data.winnerPlayerId);
            setGameOverReason(data.endReason);
            // setMatchEnded(true); // DISABLED: Using EndGameOverlay

            setEndGameState({
                mode: isMe ? 'VICTORY' : 'DEFEAT',
                canSpectate: !isMe
            });

            if (isMe) {
                steamService.activateAchievement('WIN_GAME');
            }

            // If we are in eliminated list and not already marked
            if (socket.id && data.eliminatedPlayerIds.includes(socket.id)) {
                setEliminated(true);
                setSpectating(true);
            }
        };

        const handlePlayerEliminated = (data: { playerId: string, reason?: string }) => {
            if (data.playerId === socket.id) {
                setEliminated(true);
                setSpectating(true);
                setEndGameState({
                    mode: 'DEFEAT',
                    canSpectate: true,
                    reason: data.reason
                });
            }
        };

        const handleMatchStartFailed = (data: { reason: string }) => {
            console.log(`[CLIENT] MATCH_START_FAILED reason=${data.reason}`);
            alert(`Failed to start match: ${data.reason}`);
            clientMatchState.current = 'LOBBY';
            setGameStatus('waiting');
        };

        socket.on('pong_check', handlePong);
        socket.on('tunnelPassword', handleTunnelPassword);
        socket.on('tunnelUrl', handleTunnelUrl);
        window.addEventListener('fps-update', handleFps as any);

        socket.on('gameStatus', handleGameStatus);
        socket.on('lobbySettings', handleLobbySettings);
        socket.on('votingUpdate', handleVotingUpdate);
        socket.on('gameStarted', handleGameStarted);
        socket.on('gameOver', handleGameOver);
        socket.on('MATCH_ENDED', handleMatchEnded);
        socket.on('playerEliminated', handlePlayerEliminated);
        socket.on('MATCH_START_FAILED', handleMatchStartFailed);

        const handlePlayers = (players: Player[]) => {
            const me = players.find(p => p.id === socket.id);
            if (me) setPlayer(me);

            const pMap = new Map();
            players.forEach(p => pMap.set(p.id, p));
            setAllPlayers(pMap);
            setHasPlayersSnapshot(true);
        };

        const handleMapData = (data: GameMap) => {
            setMapData(data);
        };

        const handleUnitsData = (data: Unit[]) => {
            setUnits(data);
            setHasUnitsSnapshot(true);
        };

        const handleHover = (e: CustomEvent) => {
            setHoverInfo(e.detail);
        };

        const handleSelection = (e: CustomEvent) => {
            const detail = e.detail || {};
            setSelectedIslandId(detail.islandId || null);
            setSelectedBuildingId(detail.buildingId || null);
            setSelectedBuildingType(detail.buildingType || null);
        };

        const handleNodeSelection = (e: CustomEvent) => {
            const detail = e.detail || {};
            setSelectedNodeIds(detail.nodes || []);
        };

        const handleUnitSelection = (e: CustomEvent) => {
            const detail = e.detail || {};
            setSelectedUnitIds(detail.unitIds || []);
        };

        const handleBuildingSelection = (e: CustomEvent) => {
            const detail = e.detail || {};
            setSelectedBuildingIds(detail.buildingIds || []);
        };

        const handleMinimapUpdate = (e: CustomEvent) => {
            setViewRect(e.detail);
        };

        const handleChatMessage = (msg: ChatMessage) => {
            setChatMessages(prev => [...prev, msg]);
        };

        const handleOilRevealed = (e: CustomEvent) => {
            setRevealedOilSpots(new Set(e.detail.ids));
        };


        socket.on('playersData', handlePlayers);
        socket.on('mapData', handleMapData);
        socket.on('unitsData', handleUnitsData);
        socket.on('chat_message', handleChatMessage);
        window.addEventListener('game-hover', handleHover as any);
        window.addEventListener('game-selection', handleSelection as any);
        window.addEventListener('node-selection-changed', handleNodeSelection as any);
        window.addEventListener('unit-selection-changed', handleUnitSelection as any);
        window.addEventListener('building-selection-changed', handleBuildingSelection as any);
        window.addEventListener('minimap-update', handleMinimapUpdate as any);
        window.addEventListener('oil-revealed', handleOilRevealed as any);

        return () => {
            clearInterval(pingInterval);
            clearInterval(memoryInterval);
            socket.off('pong_check', handlePong);
            socket.off('tunnelPassword', handleTunnelPassword);
            socket.off('tunnelUrl', handleTunnelUrl);
            window.removeEventListener('fps-update', handleFps as any);

            socket.off('playersData', handlePlayers);
            socket.off('mapData', handleMapData);
            socket.off('unitsData', handleUnitsData);
            socket.off('gameStatus', handleGameStatus);
            socket.off('lobbySettings', handleLobbySettings);
            socket.off('votingUpdate', handleVotingUpdate);
            socket.off('gameStarted', handleGameStarted);
            socket.off('gameOver', handleGameOver);
            socket.off('chat_message', handleChatMessage);

            window.removeEventListener('game-hover', handleHover as any);
            window.removeEventListener('game-selection', handleSelection as any);
            window.removeEventListener('node-selection-changed', handleNodeSelection as any);
            window.removeEventListener('unit-selection-changed', handleUnitSelection as any);
            window.removeEventListener('building-selection-changed', handleBuildingSelection as any);
            window.removeEventListener('minimap-update', handleMinimapUpdate as any);
            window.removeEventListener('oil-revealed', handleOilRevealed as any);
        };
    }, []);

    // Debug HUD removed due to build errors; will reintroduce later when needed.

    // Battle Ping & Damage Flash State
    const battlePingsRef = useRef<BattlePing[]>([]);
    const flashIntensityRef = useRef<number>(0);
    const flashOverlayRef = useRef<HTMLDivElement>(null);
    const lastPingTimeRef = useRef<Map<string, number>>(new Map());

    const renderMinimap = () => {
        if (!canvasRef.current || !mapData) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const width = canvasRef.current.width;
        const height = canvasRef.current.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw Water Background or Low Land
        const lowLand = mapData.islands.find(i => i.id === 'low_land');
        if (lowLand) {
            // Draw Desert Floor
            ctx.fillStyle = '#F4A460';
            ctx.fillRect(0, 0, width, height);
        } else {
            ctx.fillStyle = '#006994'; // Ocean Blue
            ctx.fillRect(0, 0, width, height);
        }

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, width, height);

        const scaleX = width / mapData.width;
        const scaleY = height / mapData.height;

        // Pass 0: Draw High Grounds (Obstacles)
        if (mapData.highGrounds) {
            ctx.fillStyle = '#5C4033'; // Dark Brown
            mapData.highGrounds.forEach(hg => {
                if (hg.points) {
                    ctx.beginPath();
                    hg.points.forEach((p, i) => {
                        if (i === 0) ctx.moveTo(p.x * scaleX, p.y * scaleY);
                        else ctx.lineTo(p.x * scaleX, p.y * scaleY);
                    });
                    ctx.closePath();
                    ctx.fill();
                }
            });
        }

        // Draw Islands
        // Pass 1: Draw Island Strokes (Background Layer)
        mapData.islands.forEach(island => {
            if (island.id === 'low_land') return; // Skip low_land (drawn as background)

            if (island.points) {
                ctx.beginPath();
                island.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x * scaleX, p.y * scaleY);
                    else ctx.lineTo(p.x * scaleX, p.y * scaleY);
                });
                ctx.closePath();
            } else {
                ctx.beginPath();
                ctx.arc(island.x * scaleX, island.y * scaleY, Math.max(2, island.radius * scaleX), 0, Math.PI * 2);
            }

            // Owner Border or Default Border
            if (island.ownerId && allPlayers.has(island.ownerId)) {
                const p = allPlayers.get(island.ownerId)!;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 4; // Thicker for background pass
            } else {
                // High Land Border
                if (island.id === 'high_land' || island.id.startsWith('high_land')) {
                    ctx.strokeStyle = '#5C4033'; // Dark Brown (Cliff-like)
                    ctx.lineWidth = 6;
                } else {
                    ctx.strokeStyle = '#444444'; // Darker neutral border
                    ctx.lineWidth = 3;
                }
            }
            ctx.stroke();
        });

        // Pass 2: Draw Island Fills (Foreground Layer)
        mapData.islands.forEach(island => {
            if (island.id === 'low_land') return; // Skip low_land

            if (island.points) {
                ctx.beginPath();
                island.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x * scaleX, p.y * scaleY);
                    else ctx.lineTo(p.x * scaleX, p.y * scaleY);
                });
                ctx.closePath();
            } else {
                ctx.beginPath();
                ctx.arc(island.x * scaleX, island.y * scaleY, Math.max(2, island.radius * scaleX), 0, Math.PI * 2);
            }

            // Island Color based on Type
            let islandColor = '#228B22'; // Forest
            if (island.type === 'desert') islandColor = '#F4A460';
            if (island.type === 'snow') islandColor = '#FFFAFA';

            // Oil Oasis Logic
            if ((island as any).subtype === 'oil_field' || island.id === 'oil_pit') {
                islandColor = '#222222'; // Dark Oil Color
            }

            ctx.fillStyle = islandColor;
            ctx.fill();
        });

        // Pass 3: Buildings (Overlay)
        mapData.islands.forEach(island => {
            island.buildings.forEach(b => {
                const bx = (island.x + (b.x || 0)) * scaleX;
                const by = (island.y + (b.y || 0)) * scaleY;

                let bColor = '#808080';
                if (b.type === 'mine') bColor = '#FFD700';
                if (b.type === 'tower') bColor = '#8B0000';
                if (b.type === 'base') bColor = '#4B0082';
                if (b.type === 'wall') bColor = '#666666';
                if (b.type === 'barracks') bColor = '#8B4513';
                if (b.type === 'dock') bColor = '#DEB887';
                if (b.type === 'farm') bColor = '#8FBC8F';

                ctx.fillStyle = bColor;
                ctx.fillRect(bx - 2, by - 2, 4, 4);
            });
        });

        // Draw Oil Spots (small black dots, Gold for revealed hidden)
        mapData.oilSpots.forEach(spot => {
            const isHidden = spot.id.startsWith('hidden_oil_');
            if (isHidden && !revealedOilSpots.has(spot.id)) return; // Hide hidden oil spots on minimap

            ctx.beginPath();
            // Make revealed hidden spots larger and Gold to be super visible
            const radius = isHidden ? 4 : 2;
            ctx.arc(spot.x * scaleX, spot.y * scaleY, radius, 0, Math.PI * 2);
            ctx.fillStyle = isHidden ? '#FFD700' : '#000000';
            ctx.fill();

            // Draw Oil Rig if present
            if ((spot as any).building) {
                ctx.fillStyle = '#333333';
                ctx.fillRect((spot.x * scaleX) - 2, (spot.y * scaleY) - 2, 4, 4);
            }
        });

        // Draw Units
        units.forEach(unit => {
            ctx.fillStyle = unit.ownerId === socket.id ? '#00FF00' : '#FF0000';
            ctx.fillRect(unit.x * scaleX, unit.y * scaleY, 2, 2);
        });

        // Draw View Rect
        if (viewRect) {
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1;
            ctx.strokeRect(viewRect.x * scaleX, viewRect.y * scaleY, viewRect.width * scaleX, viewRect.height * scaleY);
        }

        // Draw Battle Pings (New)
        const now = Date.now();

        // Prune old pings from Ref (without triggering re-render)
        battlePingsRef.current = battlePingsRef.current.filter(p => now - p.startTime < 2000);

        battlePingsRef.current.forEach(ping => {
            const age = now - ping.startTime;
            const t = age / 2000; // 0 to 1
            if (t >= 1) return;

            const px = ping.worldX * scaleX;
            const py = ping.worldY * scaleY;

            // Pulse: scale up/down every 250ms
            const pulse = 1 + 0.3 * Math.sin((age / 250) * Math.PI * 2);
            const baseRadius = ping.isHQ ? 8 : 4;
            const radius = baseRadius * pulse;

            // Fade out in last 0.6s (t > 0.7)
            let alpha = 1;
            if (t > 0.7) {
                alpha = 1 - ((t - 0.7) / 0.3);
            }

            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = `rgba(255, 0, 0, ${alpha * 0.3})`;
            ctx.fill();

            if (ping.isHQ) {
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('!', px, py);
            }
        });
    };

    // Damage Event Listener
    useEffect(() => {
        const handleBuildingDamaged = (data: any) => {
            // data: { entityId, entityType, ownerId, worldX, worldY, damageAmount, hpAfter }

            // 1. Flash
            if (data.ownerId === socket.id) {
                const isHQ = data.entityType === 'base';
                const boost = isHQ ? 0.8 : 0.3;
                // Stack intensity but cap at 0.8
                flashIntensityRef.current = Math.min(0.8, flashIntensityRef.current + boost);
            }

            // 2. Battle Ping (for own buildings being hit)
            if (data.ownerId === socket.id) {
                const now = Date.now();
                const isHQ = data.entityType === 'base';

                // Rate Limit
                const lastTime = lastPingTimeRef.current.get(data.entityId);
                if (lastTime && now - lastTime < 750) return;
                lastPingTimeRef.current.set(data.entityId, now);

                // Spatial Grouping (600 world units ~ 30px minimap)
                const existing = battlePingsRef.current.find(p => {
                    const dx = p.worldX - data.worldX;
                    const dy = p.worldY - data.worldY;
                    return (dx * dx + dy * dy) < (600 * 600) && (now - p.startTime < 1500);
                });

                if (existing) {
                    existing.startTime = now;
                    if (isHQ) existing.isHQ = true;
                } else {
                    battlePingsRef.current.push({
                        id: Math.random().toString(36),
                        worldX: data.worldX,
                        worldY: data.worldY,
                        startTime: now,
                        isHQ
                    });
                }
            }
        };

        socket.on('buildingDamaged', handleBuildingDamaged);
        return () => {
            socket.off('buildingDamaged', handleBuildingDamaged);
        };
    }, []);

    // Animation Loop
    useEffect(() => {
        let animId: number;

        const loop = () => {
            // Flash Decay
            if (flashIntensityRef.current > 0) {
                flashIntensityRef.current = Math.max(0, flashIntensityRef.current - 0.02); // Decay approx 1.2 per second (at 60fps) -> 0.8 fades in ~0.7s
                if (flashOverlayRef.current) {
                    flashOverlayRef.current.style.boxShadow = `inset 0 0 100px 50px rgba(255, 0, 0, ${flashIntensityRef.current})`;
                }
            }

            // Render Minimap
            if (battlePingsRef.current.length > 0) {
                renderMinimap();
            }

            animId = requestAnimationFrame(loop);
        };

        // Initial render on data change
        renderMinimap();

        animId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animId);
    }, [mapData, units, allPlayers, viewRect, revealedOilSpots]);

    // Chat Drag Logic
    const handleChatDragStart = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setIsDraggingChat(true);
        chatDragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingChat) {
                setChatPos({
                    x: e.clientX - chatDragOffset.current.x,
                    y: e.clientY - chatDragOffset.current.y
                });
            }
        };
        const handleWindowMouseUp = () => {
            setIsDraggingChat(false);
        };

        if (isDraggingChat) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isDraggingChat]);

    // Minimap Dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDraggingMinimap(true);
        dragOffset.current = {
            x: e.clientX - minimapPos.x,
            y: e.clientY - minimapPos.y
        };
    };

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingMinimap) {
                setMinimapPos({
                    x: e.clientX - dragOffset.current.x,
                    y: e.clientY - dragOffset.current.y
                });
            }
        };
        const handleWindowMouseUp = () => {
            setIsDraggingMinimap(false);
        };

        if (isDraggingMinimap) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isDraggingMinimap]);

    // Stats Panel Drag Logic
    const handleStatsDragStart = (e: React.MouseEvent) => {
        // Ignore clicks on buttons
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setIsDraggingStats(true);

        // Calculate offset from top-left of the element
        statsDragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        // If this is the first drag, we need to set the initial position explicitly
        if (!statsPanelPos) {
            setStatsPanelPos({ x: rect.left, y: rect.top });
        }
    };

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingStats) {
                setStatsPanelPos({
                    x: e.clientX - statsDragOffset.current.x,
                    y: e.clientY - statsDragOffset.current.y
                });
            }
        };

        const handleWindowMouseUp = () => {
            setIsDraggingStats(false);
        };

        if (isDraggingStats) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isDraggingStats]);

    // Build Menu Drag Logic
    const handleBuildMenuDragStart = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setIsDraggingBuildMenu(true);
        buildMenuDragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingBuildMenu) {
                setBuildMenuPos({
                    x: e.clientX - buildMenuDragOffset.current.x,
                    y: e.clientY - buildMenuDragOffset.current.y
                });
            }
        };
        const handleWindowMouseUp = () => {
            setIsDraggingBuildMenu(false);
        };

        if (isDraggingBuildMenu) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isDraggingBuildMenu]);

    const build = (type: string) => {
        // Unified placement mode for all buildings
        const event = new CustomEvent('enter-placement-mode', { detail: { type } });
        window.dispatchEvent(event);
    };

    const categories = React.useMemo(() => [
        {
            id: 'economy',
            label: 'Economy',
            buildings: [
                { type: 'mine', label: 'Gold Mine (30g)', icon: '⛏️' },
                { type: 'oil_rig', label: 'Oil Rig (200g)', icon: '🛢️' },
                { type: 'oil_well', label: 'Oil Well (200g)', icon: '⛽' },
                { type: 'farm', label: 'Farm (50g)', icon: '🌾' },
            ]
        },
        {
            id: 'military',
            label: 'Military',
            buildings: [
                { type: 'barracks', label: 'Barracks (50g)', icon: '⚔️' },
                { type: 'tank_factory', label: 'Tank Factory (500g)', icon: '🏭' },
                { type: 'air_base', label: 'Air Base (400g, 100o)', icon: '🛫' },
                { type: 'dock', label: 'Dock (100g)', icon: '⚓' }
            ]
        },
        {
            id: 'defenses',
            label: 'Defenses',
            buildings: [
                { type: 'tower', label: 'Tower (40g)', icon: '🏰' },
                { type: 'wall', label: 'Wall (10g)', icon: '🧱' },
                { type: 'wall_node', label: 'Wall Node (20g)', icon: '🏰' },
                { type: 'bridge_node', label: 'Bridge Node (50g)', icon: '🌉' }
            ]
        }
    ], [mapData?.mapType]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') return;

            const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

            // Menu Navigation (1-9, ESC)
            if (key === 'Escape' || key === 'ESCAPE') {
                if (activeCategory) {
                    setActiveCategory(null);
                    return;
                }
            }

            const num = parseInt(e.key);
            if (!isNaN(num) && num >= 1 && num <= 9) {
                if (!activeCategory) {
                    // Select Category
                    if (num <= categories.length) {
                        setActiveCategory(categories[num - 1].id);
                    }
                } else {
                    // Select Building
                    const cat = categories.find(c => c.id === activeCategory);
                    if (cat && cat.buildings[num - 1]) {
                        const bType = cat.buildings[num - 1].type;
                        if (bType === 'oil') {
                            build(mapData?.mapType === 'desert' ? 'oil_pump' : 'oil_rig');
                        } else {
                            build(bType);
                        }
                    }
                }
                return;
            }

            // Direct Hotkeys (Fallback)
            const binds = settingsManager.getSettings().keybinds;

            if (key === binds.buildMine) build('mine');
            else if (key === binds.buildBarracks) build('barracks');
            else if (key === binds.buildTower) build('tower');
            else if (key === binds.buildDock) build('dock');
            else if (key === binds.buildOilRig) build('oil_rig');
            else if (key === binds.buildWall) build('wall');
            else if (key === binds.buildBridgeNode) build('bridge_node');
            else if (key === binds.buildWallNode) build('wall_node');
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeCategory, categories, mapData]);

    const recruit = (type: string) => {
        if (selectedIslandId && selectedBuildingId && selectedBuildingType) {
            socket.emit('recruit', { islandId: selectedIslandId, buildingId: selectedBuildingId, type });
        } else if (selectedUnitIds.length > 0) {
            // Check if selected unit is a Mothership
            const unit = units.find(u => u.id === selectedUnitIds[0]);
            if (unit && (unit.type === 'mothership' || unit.type === 'aircraft_carrier')) {
                socket.emit('recruit', { islandId: null, buildingId: unit.id, type });
            }
        }
    };

    const handleVote = (mapType: string) => {
        socket.emit('vote_map', mapType);
    };

    const selectedUnitItem = React.useMemo(() => {
        if (selectedUnitIds.length === 1) {
            return units.find(u => u.id === selectedUnitIds[0]);
        }
        return null;
    }, [selectedUnitIds, units]);

    const selectedBuildingItem = React.useMemo(() => {
        if (selectedBuildingIds.length === 1 && mapData) {
            for (const island of mapData.islands) {
                const b = island.buildings.find(b => b.id === selectedBuildingIds[0]);
                if (b) return { ...b, islandId: island.id };
            }
        }
        return null;
    }, [selectedBuildingIds, mapData]);

    const selectedItems = React.useMemo(() => {
        const items: any[] = [];
        selectedUnitIds.forEach(id => {
            const u = units.find(unit => unit.id === id);
            if (u) items.push({ ...u, category: 'unit' });
        });
        if (mapData) {
            selectedBuildingIds.forEach(id => {
                for (const island of mapData.islands) {
                    const b = island.buildings.find(b => b.id === id);
                    if (b) { items.push({ ...b, category: 'building' }); break; }
                }
            });
        }
        return items;
    }, [selectedUnitIds, selectedBuildingIds, units, mapData]);

    const isBuildingMine = selectedBuildingItem?.ownerId === socket.id;
    const isUnitMine = selectedUnitItem?.ownerId === socket.id;

    const selectedTransport = React.useMemo(() => {
        if (selectedUnitItem && ['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(selectedUnitItem.type) && selectedUnitItem.ownerId === socket.id) {
            return selectedUnitItem;
        }
        return null;
    }, [selectedUnitItem]);

    const isVoting = gameStatus === 'voting';
    const renderLoadingScreen = (title: string, subtitle: string, checks: LoadingCheckItem[]) => {
        const readyCount = checks.filter(item => item.ready).length;
        const progress = Math.round((readyCount / checks.length) * 100);

        return (
            <div className="lobby-screen">
                <div className="lobby-card lobby-card-connecting lobby-load-card">
                    <div className="lobby-title">{title}</div>
                    <div className="lobby-subtitle">{subtitle}</div>
                    <div className="lobby-connecting-spinner"></div>

                    <div className="lobby-load-progress">
                        <div
                            className="lobby-load-progress-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="lobby-load-progress-text">{progress}% ready</div>

                    <div className="lobby-load-checklist">
                        {checks.map(item => (
                            <div key={item.label} className={`lobby-load-check ${item.ready ? 'ready' : ''}`}>
                                <span className="lobby-load-check-state">{item.ready ? '[OK]' : '[..]'}</span>
                                <span>{item.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="lobby-load-metrics">
                        <span>FPS: {fps}</span>
                        <span>PING: {ping > 0 ? `${ping}ms` : '--'}</span>
                    </div>
                </div>
            </div>
        );
    };

    const lobbyLoadItems: LoadingCheckItem[] = [
        { label: 'Connection ready', ready: lobbyLoadChecks.connection },
        { label: 'Lobby snapshot loaded', ready: lobbyLoadChecks.players },
        { label: 'Ping stabilized', ready: lobbyLoadChecks.ping },
        { label: 'Frame rate stabilized', ready: lobbyLoadChecks.fps }
    ];

    const matchLoadItems: LoadingCheckItem[] = [
        { label: 'Map data loaded', ready: matchLoadChecks.map },
        { label: 'Player snapshot loaded', ready: matchLoadChecks.player },
        { label: 'Units snapshot loaded', ready: matchLoadChecks.units },
        { label: 'Ping stabilized', ready: matchLoadChecks.ping },
        { label: 'Frame rate stabilized', ready: matchLoadChecks.fps }
    ];

    // Render Lobby/Voting Screens
    // NOTE: React requires all hooks to be called in the same order.
    // We have ensured all hooks are at the top level (lines 67-615).
    // The code below contains early returns, which is valid AS LONG AS no hooks are called after them.
    // Let's verify line by line.

    // Lines 617-719: Waiting/Voting Screen
    if (connectionState.phase !== 'READY' && !isLocalMode && !isDevBypass) {
        return (
            <div className="lobby-screen">
                <div className="lobby-card lobby-card-connecting">
                    <div className="lobby-title">
                        {connectionState.phase === 'FAILED' ? 'Connection Failed' : 'Connecting...'}
                    </div>
                    <div className="lobby-subtitle">
                        {connectionState.phase === 'FAILED' ? connectionState.error : 'Establishing connection to server'}
                    </div>

                    {connectionState.phase !== 'FAILED' && (
                        <div className="lobby-connecting-spinner"></div>
                    )}

                    {/* Diagnostics */}
                    <div style={{ marginTop: '20px', fontSize: '12px', color: '#ccc', textAlign: 'left', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '4px', width: '100%', boxSizing: 'border-box' }}>
                        <div><strong>Phase:</strong> {connectionState.phase}</div>
                        <div style={{ wordBreak: 'break-all' }}><strong>URL:</strong> {connectionState.url}</div>
                        {connectionState.details && <div style={{ color: '#ff6b6b', marginTop: '5px' }}><strong>Error:</strong> {connectionState.details}</div>}
                    </div>

                    <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        {connectionState.phase === 'FAILED' && (
                            <button
                                className="lobby-btn lobby-btn-primary"
                                onClick={() => connectionManager.connect(connectionState.url)}
                            >
                                Retry
                            </button>
                        )}
                        <button
                            className="lobby-btn lobby-btn-secondary"
                            style={{ backgroundColor: '#555', padding: '8px 16px' }}
                            onClick={() => {
                                connectionManager.cancel();
                                onLeave();
                            }}
                        >
                            {connectionState.phase === 'FAILED' ? 'Back' : 'Cancel'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if ((gameStatus === 'waiting' || gameStatus === 'voting') && isLobbyLoading) {
        return renderLoadingScreen(
            'Loading Lobby',
            'Syncing lobby state and stabilizing performance',
            lobbyLoadItems
        );
    }

    if (gameStatus === 'waiting' || gameStatus === 'voting') {
        return (
            <div className="lobby-screen">
                {isVoting ? (
                    <div className="lobby-card lobby-card-voting">
                        <div className="lobby-title lobby-title-success">
                            Starting in {Math.ceil(votingData.timeLeft / 1000)}s
                        </div>
                        <div className="lobby-subtitle">Vote for Map Type</div>

                        <div className="map-vote-container">
                            {['islands', 'grasslands', 'desert', 'random'].map(type => {
                                const votes = votingData.votes.filter(v => v[1] === type).length;
                                return (
                                    <div
                                        key={type}
                                        className="map-vote-card"
                                        onClick={() => handleVote(type)}
                                    >
                                        <h3 className="map-vote-title">{type}</h3>
                                        <div className="map-vote-count">{votes}</div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="map-vote-hint">Majority vote wins (or random if tie)</p>
                        <button
                            className="lobby-btn lobby-btn-secondary"
                            style={{ marginTop: '10px', backgroundColor: '#555', width: '100%' }}
                            onClick={onLeave}
                        >
                            Leave Game
                        </button>
                    </div>
                ) : (
                    <div className="lobby-card">
                        <div className="lobby-title">Lobby</div>
                        <div className="lobby-subtitle">
                            {Array.from(allPlayers.values()).filter(p => !p.isBot).length} / {requiredPlayers} Humans Ready
                        </div>

                        {tunnelUrl && (
                            <div className="lobby-invite-container">
                                <label>Join Code:</label>
                                <div className="lobby-invite-code">
                                    {tunnelUrl}
                                    <button
                                        onClick={() => navigator.clipboard.writeText(tunnelUrl)}
                                        className="copy-btn-small"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                        )}

                        {tunnelPassword && !tunnelUrl && (
                            <div className="lobby-invite-container">
                                <label>Tunnel IP (LAN):</label>
                                <div className="lobby-invite-code">
                                    {tunnelPassword}
                                    <button
                                        onClick={() => navigator.clipboard.writeText(tunnelPassword)}
                                        className="copy-btn-small"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="lobby-controls">
                            <div className="lobby-row">
                                <span>Required Humans</span>
                                <select
                                    className="lobby-select"
                                    value={requiredPlayers}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setRequiredPlayers(val);
                                        socket.emit('set_required_players', val);
                                    }}
                                >
                                    {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                        <option key={n} value={n}>{n} Humans</option>
                                    ))}
                                </select>
                            </div>

                            <div className="lobby-row">
                                <span>Add AI Bot</span>
                                <div className="lobby-bot-container">
                                    <span className="lobby-bot-count">
                                        ({Array.from(allPlayers.values()).filter(p => p.isBot).length}/10)
                                    </span>
                                    <select
                                        className="lobby-select lobby-select-bot"
                                        onChange={(e) => socket.emit('addBot', parseInt(e.target.value))}
                                        value=""
                                    >
                                        <option value="" disabled>+ Add Bot</option>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(diff => (
                                            <option key={diff} value={diff} className="option-level">Lvl {diff}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Host Start Button */}
                            {Array.from(allPlayers.keys())[0] === socket.id && (
                                <button
                                    className="lobby-btn btn-primary lobby-btn-start"
                                    onClick={() => {
                                        clientMatchState.current = 'STARTING';
                                        console.log('[NAV_TO_GAME] (Starting) initiated by user');
                                        socket.emit('force_start_match');
                                    }}
                                >
                                    Start Match Now
                                </button>
                            )}

                            {/* Back Button */}
                            <button
                                className="lobby-btn lobby-btn-secondary"
                                style={{ marginTop: '10px', backgroundColor: '#555' }}
                                onClick={() => {
                                    console.log('[NAV_TO_LOBBY] reason=user_left source=BackButton');
                                    clientMatchState.current = 'LOBBY';
                                    onLeave();
                                }}
                            >
                                Back / Leave
                            </button>
                        </div>
                    </div>
                )}

                {/* Force show Room ID for easy sharing */}
                <div className="lobby-invite-container">
                    <p className="lobby-invite-title">Invite friends to join!</p>

                    {roomId && (
                        <div className="lobby-invite-content">
                            {/* Game ID & Password Display */}
                            <div className="lobby-room-info-display">
                                <div className="lobby-room-id-row">
                                    <span className="lobby-room-id-label">Room ID:</span>
                                    <span className="lobby-room-id-text">{roomId}</span>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(roomId);
                                            alert(`Game ID copied: ${roomId}`);
                                        }}
                                        className="lobby-copy-btn"
                                    >
                                        Copy
                                    </button>
                                </div>

                                {tunnelPassword && (
                                    <div className="lobby-tunnel-password-display">
                                        <span className="lobby-tunnel-password-label">Tunnel Password (IP):</span>
                                        <span className="lobby-tunnel-password-val">{tunnelPassword}</span>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(tunnelPassword);
                                                alert('IP copied!');
                                            }}
                                            className="lobby-copy-btn"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                )}

                                {!tunnelUrl && (
                                    <div className="lobby-room-id-row">
                                        <span className="lobby-room-id-label">Port:</span>
                                        <span className="lobby-room-id-text">3001</span>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText("3001");
                                                alert('Port copied!');
                                            }}
                                            className="lobby-copy-btn"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Invite Link Button */}
                            <button
                                onClick={() => {
                                    // Determine Base URL for Invite Link
                                    let baseUrl = '';

                                    if (tunnelUrl) {
                                        // Remote Tunnel Mode
                                        baseUrl = tunnelUrl;
                                    } else if (tunnelPassword && (tunnelPassword.includes('.') || tunnelPassword.includes(':'))) {
                                        // LAN Mode: Use the Local IP sent as 'tunnelPassword'
                                        // Default port 3001 is assumed for LAN
                                        baseUrl = `http://${tunnelPassword}:3001`;
                                    } else {
                                        // Fallback: Use current origin (e.g. localhost)
                                        baseUrl = window.location.origin;
                                    }

                                    const url = `${baseUrl}?room=${roomId}`;
                                    navigator.clipboard.writeText(url);
                                    alert(`Invite Link copied! \n\nLink: ${url}`);
                                }}
                                className="lobby-invite-btn"
                            >
                                Copy Invite Link
                            </button>
                        </div>
                    )}
                </div>

                {/* Chat Toggle Button (Consistent with Game) */}
                <button
                    onClick={() => setIsChatVisible(!isChatVisible)}
                    title={isChatVisible ? "Hide Chat" : "Show Chat"}
                    className="chat-global-toggle-btn"
                >
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                    </svg>
                </button>

                {/* Chat Overlay in Lobby */}
                <ChatOverlay
                    messages={chatMessages}
                    onSend={(content) => socket.emit('chat_message', content)}
                    myId={socket.id || ''}
                    players={allPlayers}
                    visible={isChatVisible}
                    onClose={() => setIsChatVisible(false)}
                    position={chatPos}
                    onDragStart={handleChatDragStart}
                />
            </div>
        );
    }

    const connectNodes = () => {
        if (selectedNodeIds.length >= 2) {
            // Connect nodes in a chain (0-1, 1-2, 2-3, etc.)
            for (let i = 0; i < selectedNodeIds.length - 1; i++) {
                socket.emit('connect_nodes', { nodeAId: selectedNodeIds[i], nodeBId: selectedNodeIds[i + 1] });
            }
            setSelectedNodeIds([]);
        }
    };

    let recruitTitle = '';
    let recruitOptions: { type: string; label: string }[] = [];

    if (isBuildingMine) {
        if (selectedBuildingType === 'barracks') {
            recruitTitle = 'Barracks Recruitment';
            recruitOptions = [
                { type: 'soldier', label: '💂 Soldier (10g)' },
                { type: 'sniper', label: '🎯 Sniper (20g)' },
                { type: 'rocketeer', label: '🚀 Rocketeer (30g, 5o)' },
                { type: 'builder', label: '🛠️ Builder (15g)' },
                { type: 'oil_seeker', label: '🚙 Oil Seeker (1000g)' }
            ];
        } else if (selectedBuildingType === 'tank_factory') {
            recruitTitle = 'Tank Factory Recruitment';
            recruitOptions = [
                { type: 'tank', label: '🚜 Tank (150g, 20o)' },
                { type: 'humvee', label: '🚙 Humvee (100g, 10o)' },
                { type: 'missile_launcher', label: '🚚 Missile Launcher (200g, 50o)' }
            ];
        } else if (selectedBuildingType === 'air_base') {
            recruitTitle = 'Air Base Recruitment';
            recruitOptions = [
                { type: 'light_plane', label: '🛩️ Light Plane (100g, 20o)' },
                { type: 'heavy_plane', label: '✈️ Heavy Plane (250g, 100o)' },
                { type: 'mothership', label: '🛸 Mothership (2000g, 1000o)' }
            ];
        } else if (selectedBuildingType === 'dock') {
            recruitTitle = 'Dock Recruitment';
            recruitOptions = [
                { type: 'destroyer', label: '🚢 Destroyer (50g, 10o)' },
                { type: 'construction_ship', label: '🏗️ Construction Ship (100g)' },
                { type: 'ferry', label: '⛴️ Ferry (100g, 50o)' },
                { type: 'aircraft_carrier', label: '🛳️ Aircraft Carrier (1500g, 500o)' }
            ];
        } else if (selectedBuildingType === 'base') {
            recruitTitle = 'Base Recruitment';
            recruitOptions = [
                { type: 'builder', label: '🛠️ Builder (15g)' }
            ];
        }
    } else if (isUnitMine && selectedUnitItem?.type === 'mothership') {
        recruitTitle = 'Mothership Recruitment';
        recruitOptions = [
            { type: 'alien_scout', label: '👽 Alien Scout (150g, 50o)' },
            { type: 'heavy_alien', label: '🛸 Heavy Alien (800g, 400o)' },
            { type: 'light_plane', label: '🛩️ Light Plane (100g, 20o)' },
            { type: 'heavy_plane', label: '✈️ Heavy Plane (250g, 100o)' }
        ];
    } else if (isUnitMine && selectedUnitItem?.type === 'aircraft_carrier') {
        recruitTitle = 'Aircraft Carrier Recruitment';
        recruitOptions = [
            { type: 'light_plane', label: '🛩️ Light Plane (100g, 20o)' },
            { type: 'heavy_plane', label: '✈️ Heavy Plane (250g, 100o)' }
        ];
    }

    const handleLoadNearby = () => {
        if (selectedTransport) {
            const event = new CustomEvent('load-nearby', { detail: { ferryId: selectedTransport.id } });
            window.dispatchEvent(event);
        }
    };

    const handleUnloadClick = () => {
        if (selectedTransport) {
            const event = new CustomEvent('enter-unload-mode', { detail: { ferryId: selectedTransport.id } });
            window.dispatchEvent(event);
        }
    };

    const handleDeselect = (id: string, category: string) => {
        window.dispatchEvent(new CustomEvent('request-deselect', { detail: { id, type: category } }));
    };

    const handleSpectate = () => {
        setSpectating(true);
        setIsSpectateActive(true);
        window.dispatchEvent(new CustomEvent('enable-spectator-mode'));
        setEndGameState(null);
    };

    if (endGameState) {
        return (
            <EndGameOverlay
                mode={endGameState.mode}
                canSpectate={endGameState.canSpectate}
                onSpectate={handleSpectate}
                reason={endGameState.reason}
                onMainMenu={() => {
                    console.log('Navigating to Main Menu via Victory/Defeat Overlay');
                    onLeave();
                }}
            />
        );
    }

    if (matchEnded || (winnerId && winnerId !== socket.id)) {
        return (
            <GameOverOverlay
                winnerId={winnerId}
                playerId={socket.id}
                onReturn={onLeave}
                reason={gameOverReason}
                showSpectate={false} // Match ended, no one to spectate (or maybe allow flying around?)
            // Actually, if match ended, maybe we can still spectate the ruins?
            // User said "Spectate Mode (Defeat Only)". Victory screen just has Main Menu.
            // If I lost and match ended, I just see Defeat.
            />
        );
    }

    if (eliminated && !spectating) {
        return (
            <GameOverOverlay
                winnerId={null} // Force Defeat
                playerId={socket.id}
                onReturn={onLeave}
                onSpectate={handleSpectate}
                showSpectate={true}
                reason="Base Command Center Destroyed"
            />
        );
    }

    if (gameStatus === 'playing' && (isMatchLoading || !player)) {
        return renderLoadingScreen(
            'Starting Match',
            matchLoadTimedOut
                ? 'Network is still syncing. Entering game view as soon as core data is ready.'
                : 'Loading map, units, and stabilizing ping/FPS',
            matchLoadItems
        );
    }

    if (!player) return null;

    if (isSpectateActive) {
        return (
            <div className="game-ui root-ui-layer spectator-mode">
                <div className="hud-top-bar" style={{ justifyContent: 'space-between' }}>
                    <div className="hud-left-group">
                        <button onClick={onLeave} className="hud-btn hud-btn-menu" style={{ backgroundColor: '#d32f2f' }}>Quit Spectating</button>
                    </div>
                    <div style={{
                        color: '#ffff00',
                        fontWeight: 'bold',
                        letterSpacing: '2px',
                        textShadow: '0 0 5px black',
                        fontSize: '18px'
                    }}>
                        👁️ SPECTATOR MODE
                    </div>
                    <div style={{ width: '100px' }}></div>
                </div>

                {/* Chat Toggle Button (Consistent with Game) */}
                <button
                    onClick={() => setIsChatVisible(!isChatVisible)}
                    title={isChatVisible ? "Hide Chat" : "Show Chat"}
                    className="chat-global-toggle-btn"
                >
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                    </svg>
                </button>

                <ChatOverlay
                    messages={chatMessages}
                    onSend={(content) => socket.emit('chat_message', content)}
                    myId={socket.id || ''}
                    players={allPlayers}
                    visible={isChatVisible}
                    onClose={() => setIsChatVisible(false)}
                    position={chatPos}
                    onDragStart={handleChatDragStart}
                />
            </div>
        );
    }

    return (
        <div className="game-ui root-ui-layer">

            {/* Damage Flash Overlay */}
            <div
                ref={flashOverlayRef}
                style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    pointerEvents: 'none',
                    zIndex: 9000,
                    boxShadow: 'none',
                    transition: 'box-shadow 0.1s linear'
                }}
            />

            {/* Top Bar: Stats & Menu */}
            <div className="hud-top-bar">
                <div className="hud-left-group">
                    <button onClick={onLeave} className="hud-btn hud-btn-menu">Menu</button>
                    <button
                        onClick={() => {
                            const url = `${window.location.origin}?room=${roomId}`;
                            navigator.clipboard.writeText(url).then(() => {
                                alert(`Link copied: ${url}`);
                            });
                        }}
                        className="hud-btn hud-btn-share"
                    >
                        Share
                    </button>
                    <div className="hud-resource">Gold: <span className="hud-resource-gold-val">{player.resources.gold}</span></div>
                    <div className="hud-resource">Oil: <span className="hud-resource-oil-val">{player.resources.oil}</span></div>
                    {roomId && (
                        <div className="game-id-container">
                            <span className="hud-game-id-label">ID:</span>
                            <div className="game-id-box">
                                <input
                                    value={roomId}
                                    readOnly
                                    className="game-id-input"
                                />
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(roomId);
                                        alert(`Room ID copied: ${roomId}`);
                                    }}
                                    className="game-id-copy-btn"
                                    title="Copy Room ID"
                                >
                                    📋
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="hud-center-group">
                    {/* Stats moved to bottom bar */}
                </div>

                <div className="hud-right-group">
                    <button onClick={() => socket.emit('addBot')} className="hud-btn hud-btn-add-bot">Add Bot</button>
                    <button onClick={() => setShowDebug(!showDebug)} className="hud-btn hud-btn-debug" style={{ opacity: showDebug ? 1 : 0.5 }}>🐞</button>
                    <button onClick={() => setShowSettings(true)} className="hud-btn hud-btn-settings">⚙️</button>
                </div>
            </div>

            {/* Ability Button for Oil Seeker */}
            {isUnitMine && selectedUnitItem?.type === 'oil_seeker' && (
                <div className="scanner-btn-container">
                    <button
                        onClick={() => {
                            const newState = !isScannerActive;
                            setIsScannerActive(newState);
                            window.dispatchEvent(new CustomEvent('toggle-oil-scanner', { detail: { show: newState } }));
                        }}
                        className={`scanner-btn ${isScannerActive ? 'scanner-btn-active' : 'scanner-btn-inactive'}`}
                    >
                        <span>📡</span>
                        <span>{isScannerActive ? 'Scanner: ON' : 'Scanner: OFF'}</span>
                    </button>
                </div>
            )}



            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} mapData={mapData} />}

            {/* Spectating Banner */}
            {spectating && (
                <div className="spectating-banner">
                    SPECTATING MODE
                </div>
            )}

            {/* Left Panel: Buildings (Hidden when spectating) */}
            {!spectating && (
                <>
                    {/* Toggle Button (Always Visible) */}
                    <button
                        onClick={() => setIsConstructionMinimized(!isConstructionMinimized)}
                        title={isConstructionMinimized ? "Show Construction" : "Hide Construction"}
                        className="build-global-toggle-btn"
                    >
                        <span style={{ fontSize: '24px' }}>🔨</span>
                    </button>

                    {!isConstructionMinimized && (
                        <div
                            className="build-menu-container"
                            style={{
                                top: buildMenuPos.y,
                                left: buildMenuPos.x,
                                right: 'auto'
                            }}
                        >
                            <div className="build-menu-panel">
                                <div
                                    className="build-menu-header"
                                    onMouseDown={handleBuildMenuDragStart}
                                    style={{ cursor: 'move' }}
                                >
                                    <h3 className="build-header-title">Construction</h3>
                                    <div className="build-header-controls" style={{ display: 'flex', gap: '5px' }}>
                                        {activeCategory && (
                                            <button
                                                onClick={() => setActiveCategory(null)}
                                                className="build-control-btn"
                                            >
                                                Back
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {!activeCategory ? (
                                    <div className="build-group">
                                        {categories.map((cat, index) => (
                                            <button
                                                key={cat.id}
                                                className="build-category-btn"
                                                onClick={() => setActiveCategory(cat.id)}
                                            >
                                                {index + 1}. {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="build-group">
                                        <p className="build-category-label">
                                            {categories.find(c => c.id === activeCategory)?.label}:
                                        </p>
                                        {categories.find(c => c.id === activeCategory)?.buildings.map((b, index) => (
                                            <button
                                                key={b.type}
                                                className="build-item-btn"
                                                onClick={() => build(b.type)}
                                            >
                                                {index + 1}. {b.icon} {b.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Hover Info Tooltip (Fixed Bottom Left) */}
            {(() => {
                // Only show hover info here. Selection info is handled by the main Details Panel.
                const displayInfo = hoverInfo;

                if (!displayInfo) return null;

                const ownerId = displayInfo.owner;
                const ownerPlayer = ownerId ? allPlayers.get(ownerId) : null;
                const ownerName = ownerPlayer ? ownerPlayer.name : (ownerId ? 'Unknown' : 'Neutral');
                const ownerColor = ownerPlayer ? ownerPlayer.color : '#fff';

                return (
                    <div className="hover-info-tooltip">
                        {displayInfo.title && <div className="hover-info-title">{displayInfo.title}</div>}
                        {displayInfo.health !== undefined && <div>HP: {Math.floor(displayInfo.health)}/{displayInfo.maxHealth}</div>}
                        {displayInfo.damage !== undefined && <div>DMG: {displayInfo.damage}</div>}
                        {displayInfo.speed !== undefined && <div>SPD: {displayInfo.speed}</div>}
                        {displayInfo.attackSpeed !== undefined && <div>ATK SPD: {Math.round(1000 / displayInfo.attackSpeed * 10) / 10}/s</div>}

                        <div>
                            Owner: <span className="hover-info-owner-name" style={{ '--owner-color': ownerColor } as React.CSSProperties}>{ownerName}</span>
                        </div>

                        <div className="hover-info-alliance">
                            Allianced with: None
                        </div>

                        {displayInfo.type && <div className="hover-info-type">{displayInfo.type}</div>}
                    </div>
                );
            })()}

            {/* Fixed Minimap */}
            <div
                className="minimap-container"
                style={{
                    top: minimapPos.y,
                    left: minimapPos.x,
                    bottom: 'auto',
                    right: 'auto',
                    cursor: 'move'
                }}
                onMouseDown={handleMouseDown}
            >
                <canvas
                    ref={canvasRef}
                    width={200}
                    height={150}
                    className="minimap-canvas"
                />
                <div className="minimap-label">Minimap</div>
            </div>

            {selectedNodeIds.length >= 2 && (
                <div className="bridge-construction-panel">
                    <div className="bridge-panel-header">
                        Bridge/Wall Construction ({selectedNodeIds.length} nodes)
                    </div>
                    {(() => {
                        const existingWall = selectedNodeIds.length === 2 && mapData?.bridges ? mapData.bridges.find(b =>
                            (b.nodeAId === selectedNodeIds[0] && b.nodeBId === selectedNodeIds[1]) ||
                            (b.nodeAId === selectedNodeIds[1] && b.nodeBId === selectedNodeIds[0])
                        ) : null;

                        if (existingWall && existingWall.type === 'wall' && existingWall.ownerId === player?.id) {
                            return (
                                <button
                                    onClick={() => {
                                        socket.emit('convert_wall_to_gate', { nodeAId: selectedNodeIds[0], nodeBId: selectedNodeIds[1] });
                                        setSelectedNodeIds([]);
                                    }}
                                    className="bridge-btn bridge-btn-upgrade"
                                >
                                    Upgrade to Gate (50g)
                                </button>
                            );
                        }

                        return (
                            <>
                                <button
                                    onClick={connectNodes}
                                    className="bridge-btn bridge-btn-connect"
                                >
                                    Connect Chain
                                </button>
                                {selectedNodeIds.length > 2 && (
                                    <button
                                        onClick={() => {
                                            if (selectedNodeIds.length >= 2) {
                                                for (let i = 0; i < selectedNodeIds.length - 1; i++) {
                                                    socket.emit('connect_nodes', { nodeAId: selectedNodeIds[i], nodeBId: selectedNodeIds[i + 1] });
                                                }
                                                // Close loop
                                                socket.emit('connect_nodes', { nodeAId: selectedNodeIds[selectedNodeIds.length - 1], nodeBId: selectedNodeIds[0] });
                                                setSelectedNodeIds([]);
                                            }
                                        }}
                                        className="bridge-btn bridge-btn-loop"
                                    >
                                        Connect Loop
                                    </button>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}

            {selectedTransport && selectedTransport.type !== 'mothership' && (
                <div className="transport-control-panel">
                    <div className="transport-header">
                        <div className="transport-title">Transport Control</div>
                        <div className="transport-stats">
                            Cargo: {selectedTransport.cargo?.length || 0} / {
                                selectedTransport.type === 'ferry' ? 10 :
                                    selectedTransport.type === 'humvee' ? 4 :
                                        ['aircraft_carrier', 'mothership'].includes(selectedTransport.type) ? 20 : 0
                            }
                        </div>
                    </div>

                    <button
                        onClick={handleLoadNearby}
                        className="transport-btn transport-btn-load"
                    >
                        Load Nearby
                    </button>

                    <button
                        onClick={handleUnloadClick}
                        disabled={!selectedTransport.cargo || selectedTransport.cargo.length === 0}
                        className={`transport-btn transport-btn-unload ${(!selectedTransport.cargo || selectedTransport.cargo.length === 0) ? 'disabled' : ''}`}
                    >
                        Unload Here...
                    </button>

                    {selectedTransport.cargo && selectedTransport.cargo.length > 0 && (
                        <div className="transport-cargo-list">
                            {selectedTransport.cargo.map((u, i) => (
                                <div key={i} className="transport-cargo-dot" title={u.type}></div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {selectedItems.length > 1 && (
                <div
                    className={`selection-panel ${(recruitOptions.length > 0 || selectedTransport || selectedNodeIds.length >= 2) ? 'raised' : ''}`}
                >
                    <div className="selection-header selection-panel-header">
                        <div className="selection-title-group">
                            <span>Selection ({selectedItems.length})</span>
                            <button
                                onClick={() => setIsSelectionMinimized(!isSelectionMinimized)}
                                className="selection-toggle-btn"
                            >
                                {isSelectionMinimized ? '▶' : '▼'}
                            </button>
                        </div>
                        <div className="selection-controls">
                            <button
                                onClick={() => {
                                    if (confirm('Are you sure you want to delete these items?')) {
                                        const ids = selectedItems.map((i: any) => i.id);
                                        socket.emit('delete_entities', { entityIds: ids });
                                        // Clear selection
                                        window.dispatchEvent(new CustomEvent('game-selection', { detail: {} }));
                                        window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
                                        window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
                                        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                                    }
                                }}
                                className="selection-btn-delete"
                            >
                                Delete All
                            </button>
                            <button
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('game-selection', { detail: {} }));
                                    window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
                                    window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
                                    window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                                }}
                                className="selection-btn-close"
                                title="Close Selection"
                            >
                                ✖
                            </button>
                        </div>
                    </div>
                    {!isSelectionMinimized && (
                        <div className="selection-list">
                            {selectedItems.map((item: any) => (
                                <div
                                    key={`${item.category}-${item.id}`}
                                    onClick={() => handleDeselect(item.id, item.category)}
                                    className="selection-item"
                                    title={`Deselect ${item.type}`}
                                >
                                    {getIconForType(item.type)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {recruitOptions.length > 0 && (
                <div
                    className={`recruit-panel ${recruitTitle === 'Mothership Recruitment' ? 'large' : 'small'}`}
                >
                    <button
                        onClick={() => {
                            // Clear selection to close panel
                            window.dispatchEvent(new CustomEvent('game-selection', { detail: {} }));
                            window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
                            window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
                        }}
                        className="recruit-close-btn"
                        title="Close Recruitment"
                    >
                        ✕
                    </button>
                    <div className="recruit-header">
                        <div className="recruit-title">
                            {recruitTitle}
                        </div>
                        <div className="recruit-button-group">
                            {recruitOptions.map(opt => {
                                const building = (selectedBuildingItem || selectedUnitItem) as any;
                                const queueCount = building?.recruitmentQueue?.filter((q: any) => q.unitType === opt.type).length || 0;

                                return (
                                    <RecruitButton
                                        key={opt.type}
                                        type={opt.type}
                                        label={opt.label}
                                        queueCount={queueCount}
                                        onClick={() => recruit(opt.type)}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    {/* Mothership Transport Controls */}
                    {recruitTitle === 'Mothership Recruitment' && selectedTransport && (
                        <div className="mothership-controls">
                            <div className="mothership-cargo-info">
                                Cargo: {selectedTransport.cargo?.length || 0} / 20
                            </div>

                            <button
                                onClick={handleLoadNearby}
                                className="transport-btn-action load"
                            >
                                Load Nearby
                            </button>

                            <button
                                onClick={handleUnloadClick}
                                disabled={!selectedTransport.cargo || selectedTransport.cargo.length === 0}
                                className="transport-btn-action unload"
                            >
                                Unload Here...
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Selection Details Panel (Base/Unit/Building) */}
            {selectedItems.length === 1 && (
                (() => {
                    const item = selectedItems[0];
                    if (!item) return null;
                    const data = item;
                    // Ensure data and ownerId exist before access to prevent crashes
                    if (!data) return null;

                    const owner = (data.ownerId) ? allPlayers.get(data.ownerId) : undefined;
                    const isMine = data.ownerId === socket.id;
                    const hpPercent = Math.max(0, Math.min(100, (data.health / data.maxHealth) * 100));

                    return (
                        <div
                            onMouseDown={handleStatsDragStart}
                            className="stats-panel"
                            style={{
                                '--stats-left': statsPanelPos ? `${statsPanelPos.x}px` : undefined,
                                '--stats-top': statsPanelPos ? `${statsPanelPos.y}px` : undefined,
                                '--stats-bottom': statsPanelPos ? 'auto' : undefined,
                                '--stats-right': statsPanelPos ? 'auto' : undefined,
                                '--owner-color': owner ? owner.color : '#555'
                            } as React.CSSProperties}
                        >
                            {/* Header */}
                            <div className={`stats-header ${!isStatsMinimized ? 'expanded' : ''} ${isStatsMinimized ? 'minimized' : ''} stats-header-inner`}>
                                <div className="stats-icon-large">{getIconForType(item.type)}</div>
                                <div>
                                    <div className="stats-title">
                                        {item.type.replace('_', ' ')}
                                    </div>
                                    <div className="stats-subtitle">
                                        Level {data.level || 1}
                                    </div>
                                </div>
                                {/* Minimize Button */}
                                <div className="stats-controls">
                                    <button
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={() => setIsStatsMinimized(!isStatsMinimized)}
                                        className="stats-control-btn"
                                        title={isStatsMinimized ? "Expand" : "Minimize"}
                                    >
                                        {isStatsMinimized ? '▶' : '▼'}
                                    </button>
                                    <button
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={() => {
                                            window.dispatchEvent(new CustomEvent('game-selection', { detail: {} }));
                                            window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
                                            window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
                                            window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                                        }}
                                        className="stats-control-btn stats-close-btn"
                                        title="Close"
                                    >
                                        ✖
                                    </button>
                                </div>
                            </div>

                            {!isStatsMinimized && (
                                <>
                                    {/* Owner Info */}
                                    <div className="stats-row">
                                        <span className="stats-label">Owner:</span>
                                        <span className="stats-value stats-owner-value">
                                            {owner ? (owner.name || (owner.id === socket.id ? 'You' : `Player ${owner.id.slice(0, 4)}`)) : 'Neutral'}
                                        </span>
                                    </div>

                                    {/* HP Bar */}
                                    <div>
                                        <div className="stats-subrow">
                                            <span>Health</span>
                                            <span>{Math.floor(data.health)} / {data.maxHealth}</span>
                                        </div>
                                        <div className="hp-bar-container">
                                            <div
                                                className={`hp-bar-fill ${hpPercent > 50 ? 'hp-fill-high' : hpPercent > 25 ? 'hp-fill-medium' : 'hp-fill-low'}`}
                                                style={{ '--hp-percent': `${hpPercent}%` } as React.CSSProperties}
                                            />
                                        </div>
                                    </div>

                                    {/* Unit Stats (Speed, Damage, Fire Rate) */}
                                    {item.type !== 'base' && item.type !== 'mine' && item.type !== 'oil_rig' && item.type !== 'wall' && item.type !== 'bridge_node' && (
                                        <div className="stats-grid">
                                            <div className="stats-grid-item" title="Movement Speed">
                                                <span className="stats-grid-icon">⚡</span>
                                                <span className="stats-grid-value">{data.speed || 0}</span>
                                            </div>
                                            <div className="stats-grid-item" title="Damage per Hit">
                                                <span className="stats-grid-icon">⚔️</span>
                                                <span className="stats-grid-value">{data.damage || 0}</span>
                                            </div>
                                            <div className="stats-grid-item" title="Attacks per Second">
                                                <span className="stats-grid-icon">🔫</span>
                                                <span className="stats-grid-value">{(data.fireRate ? (1000 / data.fireRate).toFixed(1) : '0')} /s</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Status / Extras */}
                                    {data.status && (
                                        <div className="stats-status">
                                            Status: <span className="stats-status-value">{data.status}</span>
                                        </div>
                                    )}
                                    {item.type === 'base' && (
                                        <div className="stats-note">
                                            Command Center
                                        </div>
                                    )}

                                    {/* Delete Button */}
                                    {isMine && (
                                        <button
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={() => {
                                                if (confirm(`Are you sure you want to delete this ${item.type}?`)) {
                                                    socket.emit('delete_entities', { entityIds: [item.id] });
                                                    // Clear selection
                                                    window.dispatchEvent(new CustomEvent('game-selection', { detail: {} }));
                                                }
                                            }}
                                            className="delete-entity-btn"
                                        >
                                            Delete {item.type}
                                        </button>
                                    )}

                                    {/* Base Upgrade Button */}
                                    {item.type === 'base' && isMine && !data.hasTesla && (
                                        (() => {
                                            const myResources = allPlayers.get(socket.id || '')?.resources || { gold: 0, oil: 0 };
                                            return (
                                                <button
                                                    onClick={() => socket.emit('upgradeBuilding', { buildingId: item.id })}
                                                    disabled={myResources.gold < 500}
                                                    className={`upgrade-btn ${myResources.gold >= 500 ? 'can-afford' : 'cannot-afford'}`}
                                                >
                                                    Upgrade Base (500g)
                                                    <div className="upgrade-info">Unlocks Tesla Defense & 2x HP</div>
                                                </button>
                                            );
                                        })()
                                    )}
                                </>
                            )}
                        </div>
                    );
                })()
            )}

            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} mapData={mapData} />}

            {/* Chat Toggle Button */}
            <button
                onClick={() => setIsChatVisible(!isChatVisible)}
                title={isChatVisible ? "Hide Chat" : "Show Chat"}
                className="chat-global-toggle-btn"
            >
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                </svg>
            </button>

            {/* Game Over Screen */}
            {(winnerId || gameOverReason) && (
                <div className="game-over-screen">
                    <div className="game-over-content">
                        <h1 className="game-over-title">
                            {winnerId === socket.id ? "VICTORY!" : (gameOverReason === 'draw' ? "DRAW!" : "GAME OVER")}
                        </h1>
                        <div className="game-over-details">
                            {winnerId ? (
                                <p>Winner: <span className="winner-name">{allPlayers.get(winnerId)?.id || winnerId}</span></p>
                            ) : (
                                <p>Result: {gameOverReason}</p>
                            )}
                        </div>
                        <div className="game-over-actions">
                            <button onClick={onLeave} className="game-over-btn return">
                                Return to Lobby
                            </button>
                            <button onClick={() => window.location.reload()} className="game-over-btn restart">
                                Reconnect
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Overlay in Game */}
            <ChatOverlay
                messages={chatMessages}
                onSend={(content) => socket.emit('chat_message', content)}
                myId={socket.id || ''}
                players={allPlayers}
                visible={isChatVisible}
                onClose={() => setIsChatVisible(false)}
                position={chatPos}
                onDragStart={handleChatDragStart}
            />
            {/* Bottom Footer Bar */}
            <div className="hud-bottom-bar">
                <div className="hud-footer-group">
                    <span>FPS: {fps}</span>
                    <span>PING: {ping}ms</span>
                    <span>MEM: {memory}MB</span>
                </div>
            </div>

        </div>
    );
};
