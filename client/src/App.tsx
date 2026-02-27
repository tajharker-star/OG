import { useState, useEffect, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { GameUI } from './components/GameUI';
import { SettingsModal } from './components/SettingsModal';
import { Modal } from './components/Modal';
import { ConnectionLostOverlay } from './components/ConnectionLostOverlay';
import { socket, connectToServer, connectionManager } from './services/socket';
import { steamService } from './services/steam';
import './App.css';

function App() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const ipc = (window as any).require ? (window as any).require('electron').ipcRenderer : null;
    const [lastJoinedRoom, setLastJoinedRoom] = useState<string | null>(null);
    const [gameStatus, setGameStatus] = useState<string>('waiting');
    const [connectionPhase, setConnectionPhase] = useState<string>('IDLE');

    // Campaign State
    const [isCampaignMode, setIsCampaignMode] = useState(false);
    const [isLocalMode, setIsLocalMode] = useState(false); // Campaign or Custom
    const [campaignLevel, setCampaignLevel] = useState(0);
    const [showCampaignModal, setShowCampaignModal] = useState<'victory' | 'defeat' | null>(null);

    const CAMPAIGN_LEVELS = [
        { name: "The Beginning", mapType: 'islands', botCount: 1, difficulty: 1, description: "Your first conquest. Defeat the weak local resistance." },
        { name: "Grassy Plains", mapType: 'grasslands', botCount: 2, difficulty: 3, description: "Two factions fight for control. Crush them both." },
        { name: "Desert Storm", mapType: 'desert', botCount: 3, difficulty: 5, description: "Resource rich desert. The enemy is smarter now." },
        { name: "Island Hopping", mapType: 'islands', botCount: 4, difficulty: 7, description: "A chaotic archipelago war. Speed is key." },
        { name: "World Domination", mapType: 'random', botCount: 5, difficulty: 10, description: "The final test. Face the elite coalition." }
    ];

    // New Menu States
    const [menuView, setMenuView] = useState<'main' | 'campaign' | 'multiplayer' | 'host_public'>('main');
    const [showSettings, setShowSettings] = useState(false);
    const [customConfig, setCustomConfig] = useState({
        mapType: 'islands',
        botCount: 5,
        difficulty: 5
    });

    const clientMatchState = useRef<'LOBBY' | 'STARTING' | 'IN_MATCH'>('LOBBY');

    // Host Public State
    const [localPort, setLocalPort] = useState("3001");
    const [publicEndpoint, setPublicEndpoint] = useState("");
    const [generatedJoinCode, setGeneratedJoinCode] = useState("");

    // DEV Feature: Toggle UI Visibility & Bypass
    const [isUIVisible, setIsUIVisible] = useState(true);
    const [isDevBypass, setIsDevBypass] = useState(false);

    useEffect(() => {
        // Initial connection to local/default server
        const initialUrl = (socket as any).io.uri;
        console.log('[App] Initial Connection Attempt to:', initialUrl);
        connectionManager.connect(initialUrl);

        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            socket.emit('joinByCode', roomParam);
            setLastJoinedRoom(roomParam);
            setIsPlaying(true);
        }
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
            setConnectionPhase(state.phase);
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
                if (creatingSteamLobby) {
                    console.log('[App] Creating Steam Lobby for Room:', rid);
                    steamService.createLobby(rid, 'Random', 'Standard') // Default map/mode for now
                        .then(res => {
                            if (res.success) {
                                console.log('[App] Steam Lobby Created:', res.lobbyId);
                                steamService.setRichPresence('steam_display', '#Status_WaitingForPlayers');
                                steamService.setRichPresence('connect', `+connect_lobby ${res.lobbyId}`);
                            } else {
                                console.error('[App] Failed to create Steam Lobby:', res.error);
                                alert('Failed to create Steam Lobby');
                            }
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
            if (ipc) {
                const res = await ipc.invoke('load-data');
                if (res.success && res.data) {
                    console.log('[App] Loaded Save Data:', res.data);
                    if (res.data.campaignLevel !== undefined) {
                        setCampaignLevel(res.data.campaignLevel);
                    }
                }
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

    // --- Steam Integration ---
    const [steamError, setSteamError] = useState<string | null>(null);
    const [steamUser, setSteamUser] = useState<{ name: string, steamId: string } | null>(null);
    const [creatingSteamLobby, setCreatingSteamLobby] = useState(false);

    useEffect(() => {
        // Listen for Steam Init
        const onSteamInit = (user: any) => {
            console.log('[App] Steam Initialized:', user);
            setSteamUser(user);
            // Set Rich Presence to Main Menu
            steamService.setRichPresence('steam_display', '#Status_MainMenu');
        };

        const onSteamError = (err: string) => {
            console.error('[App] Steam Error:', err);
            if (!isDevBypass) {
                setSteamError(err);
            }
        };

        const onJoinLobby = async (lobbyId: string) => {
            console.log('[App] Joining Steam Lobby:', lobbyId);
            const data = await steamService.getLobbyData(lobbyId); // Need to implement this in SteamService
            if (data.success && data.roomId) {
                console.log('[App] Steam Lobby mapped to Room:', data.roomId);
                socket.emit('joinByCode', data.roomId);
                setIsPlaying(true);
            } else {
                console.error('[App] Failed to get room from Steam Lobby', data.error);
                alert('Failed to join Steam Lobby: ' + (data.error || 'Unknown error'));
            }
        };

        steamService.on('initialized', onSteamInit);
        steamService.on('error', onSteamError);
        // We need to listen for the 'steam:join-lobby' event from main process via local listener or handle it here
        // But steamService wraps IPC. We need to add 'join-lobby' to SteamService events or listen to IPC directly?
        // Let's assume we added it to SteamService or use ipcRenderer directly if needed.
        // Actually, let's just use window.require to get ipcRenderer for this specific event if SteamService doesn't expose it.
        // Or update SteamService. 
        // For now, let's listen to the event on window if we exposed it, but we didn't.
        // We really should update SteamService to listen to 'steam:join-lobby' from main.

        // Quick fix: Direct IPC listener (since steamService is a wrapper)
        const ipc = (window as any).require ? (window as any).require('electron').ipcRenderer : null;
        if (ipc) {
            ipc.on('steam:join-lobby', (_: any, lobbyId: string) => onJoinLobby(lobbyId));
        }

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
            if (ipc) {
                ipc.removeAllListeners('steam:join-lobby');
            }
        };
    }, []);

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


    const quickJoin = (mapType: string = 'random', forceNew: boolean = false) => {
        // Ensure connected
        if (connectionManager.getState().phase !== 'READY') {
            connectionManager.connect((socket as any).io.uri);
        }
        setIsLocalMode(false);
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
            socket.emit('joinByCode', code);
            setIsPlaying(true);
            setLastJoinedRoom(code);
        }
    };

    const startHostingPublic = async () => {
        // 1. Ensure we are connected to localhost (where the server runs)
        // If we are already connected to localhost, good.
        // If we were connected to a remote server, we should switch back to local?
        // For now, assume the user is running the client locally.

        // 2. Just enter lobby
        setIsLocalMode(false);
        setIsPlaying(true);

        // 3. Start a lobby with the tunnel URL
        socket.emit('quickJoin', {
            mapType: 'random',
            tunnelUrl: generatedJoinCode || undefined
        });
    };

    const startWorldConquer = () => {
        setIsCampaignMode(true);
        setCampaignLevel(0);
        startCampaignLevel(0);
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

    const ensureLocalEngineReady = async () => {
        const targetUrl = (socket as any).io.uri;

        // Give the embedded backend time to boot on cold starts.
        for (let attempt = 0; attempt < 8; attempt++) {
            if (connectionManager.getState().phase === 'READY') {
                return true;
            }

            const result = await connectToServer(targetUrl);
            if (result.success) {
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 750));
        }

        return false;
    };

    const startCampaignLevel = async (levelIndex: number) => {
        const level = CAMPAIGN_LEVELS[levelIndex];
        if (!level) return;

        const selectedMapType = resolveMapType(level.mapType);

        setCampaignLevel(levelIndex);
        // Ensure the embedded local engine is ready.
        if (!(await ensureLocalEngineReady())) {
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
            difficulty: level.difficulty
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
        setIsLocalMode(true);

        if (!(await ensureLocalEngineReady())) {
            setIsLocalMode(false);
            alert("Failed to start the local game engine. Please restart the game.");
            return;
        }

        socket.emit('createCustomGame', customConfig);
        setIsPlaying(true);
    };

    return (
        <div className="App">
            <GameCanvas />
            {/* GameCanvas always rendered in background */}

            {/* Main Menu Layer */}
            {isUIVisible && !isPlaying && (!steamError || isDevBypass) && (
                <div className="menu">
                    <h1>Conquerors: Dominion</h1>

                    {/* Add loading indicator for local engine */}
                    {(isLocalMode || isCampaignMode) && (connectionPhase === 'CONNECTING' || connectionPhase === 'HANDSHAKING') && (
                        <div className="local-engine-loading" style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', padding: '10px 20px', borderRadius: '8px', border: '1px solid #444', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div className="spinner" style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            <p style={{ margin: 0, fontSize: '14px', color: '#fff' }}>Starting Local Game Engine...</p>
                        </div>
                    )}

                    {menuView === 'main' && (
                        <div className="menu-column">
                            <button onClick={() => setMenuView('multiplayer')} className="menu-btn primary">Multiplayer</button>
                            <button onClick={() => setMenuView('campaign')} className="menu-btn">Campaign & Custom</button>
                        </div>
                    )}

                    {menuView === 'multiplayer' && (
                        <div className="menu-column">
                            <h3 className="menu-section-title">Multiplayer</h3>

                            <div className="menu-section">
                                <h4>Host Game</h4>
                                <button onClick={() => quickJoin('random')} className="menu-btn success">Host Local (LAN)</button>
                                <button onClick={() => {
                                    // Host Steam Lobby
                                    if (!steamUser) {
                                        alert("Steam is required to host a Steam Lobby.");
                                        return;
                                    }
                                    setCreatingSteamLobby(true);
                                    quickJoin('random');
                                }} className="menu-btn primary" style={{ background: '#171a21', border: '1px solid #66c0f4' }}>
                                    <span style={{ marginRight: '5px' }}>🎮</span> Host Steam Lobby
                                </button>
                                <button onClick={() => setMenuView('host_public')} className="menu-btn warning">Host Public (Playit.gg)</button>
                            </div>

                            <div className="menu-section">
                                <h4>Join Game</h4>
                                <div className="join-row">
                                    <input
                                        placeholder="Room ID or Join Code"
                                        value={joinCode}
                                        onChange={(e) => setJoinCode(e.target.value)}
                                        className="join-input"
                                    />
                                    <button onClick={handleJoinWithCode} className="menu-btn small">Join</button>
                                </div>
                            </div>

                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'host_public' && (
                        <div className="menu-column wide-panel">
                            <h3 className="menu-section-title">Host Public Game</h3>
                            <div className="playit-instructions">
                                <p>1. Download & Run <b>playit.gg</b> agent.</p>
                                <p>2. Create a <b>TCP Tunnel (Game)</b> to local port <b>{localPort}</b>.</p>
                                <p>3. Copy the public address (e.g. <code>foo.playit.gg:12345</code>).</p>
                            </div>

                            <div className="how-to-host-panel">
                                <h4>How to Host Publicly</h4>
                                <ol>
                                    <li>Download/install <b>playit.gg</b> agent</li>
                                    <li>Run the agent</li>
                                    <li>Create <b>TCP Tunnel</b> (NOT HTTP) to <code>localhost:{localPort}</code></li>
                                    <li>Copy public address and paste it below</li>
                                </ol>
                            </div>

                            <div className="setting-row">
                                <label>Local Port:</label>
                                <input
                                    value={localPort}
                                    onChange={(e) => setLocalPort(e.target.value)}
                                    className="small-input"
                                />
                            </div>

                            <div className="setting-row">
                                <label>Public Address:</label>
                                <input
                                    value={publicEndpoint}
                                    onChange={(e) => setPublicEndpoint(e.target.value)}
                                    placeholder="e.g. mind-control.playit.gg:12345"
                                    className="wide-input"
                                />
                            </div>

                            {generatedJoinCode && (
                                <div className="join-code-display">
                                    <label>Your Join Code:</label>
                                    <div className="code-box">
                                        {generatedJoinCode}
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
                                            style={{ marginLeft: '10px' }}
                                        >
                                            Copy WS
                                        </button>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={startHostingPublic}
                                disabled={!generatedJoinCode}
                                className="menu-btn success menu-btn-full"
                            >
                                Start Hosting
                            </button>

                            <button onClick={() => setMenuView('multiplayer')} className="menu-btn secondary">Back</button>
                        </div>
                    )}

                    {menuView === 'campaign' && (
                        <div className="menu-column">
                            <h3 className="menu-section-title">Campaign</h3>

                            <div className="campaign-list">
                                {CAMPAIGN_LEVELS.map((level, index) => {
                                    const difficultyColor = getDifficultyColor(level.difficulty);
                                    return (
                                        <button
                                            key={level.name}
                                            className="campaign-card"
                                            onClick={() => startCampaignLevel(index)}
                                        >
                                            <div className="campaign-card-header">
                                                <div className="campaign-name-row">
                                                    <span className="campaign-name">{level.name}</span>
                                                    <span className="campaign-map">Map: {level.mapType === 'random' ? 'Random' : level.mapType}</span>
                                                </div>
                                            </div>
                                            <div className="campaign-card-body">
                                                <p className="campaign-description">{level.description}</p>
                                                <div className="campaign-meta-row">
                                                    <span className="campaign-bots">Bots: {level.botCount}</span>
                                                    <span
                                                        className="campaign-difficulty-pill"
                                                        style={{ backgroundColor: difficultyColor, color: '#fff' }}
                                                    >
                                                        Difficulty: {level.difficulty}/10
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <button onClick={startWorldConquer} className="menu-btn primary">World Conquer (Stages)</button>

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

                                <button onClick={startCustomGame} className="menu-btn success menu-btn-full">Start Custom Game</button>
                            </div>

                            <button onClick={() => setMenuView('main')} className="menu-btn secondary">Back</button>
                        </div>
                    )}



                    {lastJoinedRoom && (
                        <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
                            Last Joined: {lastJoinedRoom}
                        </div>
                    )}

                </div>
            )}

            {/* In-Game UI Layer - Keep mounted to preserve state, but hide if toggled/blocked */}
            <div style={{ display: (isUIVisible && isPlaying && (!steamError || isDevBypass)) ? 'block' : 'none' }}>
                <GameUI
                    onLeave={() => window.location.reload()}
                    roomId={lastJoinedRoom}
                    initialGameStatus={gameStatus as 'waiting' | 'voting' | 'playing'}
                    isLocalMode={isLocalMode}
                    isDevBypass={isDevBypass}
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
                                        <h3 className="stage-title">Stage {campaignLevel + 1} Complete</h3>
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
                        onClick={() => setShowSettings(true)}
                        className="settings-float-btn"
                        title="Settings"
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
