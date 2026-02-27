import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import https from 'https';
import { GameState } from './game/GameState';
import { MapGenerator } from './game/MapGenerator';
import { BotAI } from './game/BotAI';

import os from 'os';

const app = express();
app.use(cors());

// Serve static files from client build
// In production, the client dist is often at the same level as the server executable
// or in a 'client/dist' folder relative to the root.
let clientBuildPath;
if (process.env.NODE_ENV === 'production' || process.mainModule?.filename.includes('app.asar')) {
    // If packaged, try common locations
    const locations = [
        path.join(process.cwd(), 'client', 'dist'),
        path.join(process.cwd(), '..', 'client', 'dist'),
        path.join(__dirname, '..', 'client', 'dist'),
        path.join(__dirname, 'client', 'dist')
    ];
    const fs = require('fs');
    clientBuildPath = locations.find(loc => fs.existsSync(loc)) || locations[0];
} else {
    clientBuildPath = path.join(process.cwd(), '..', 'client', 'dist');
}
console.log('[Server] Serving client build from:', clientBuildPath);

app.use(express.static(clientBuildPath));

// SPA Fallback: Serve index.html for any unknown routes
app.use((req, res) => {
    // Don't serve index.html for API requests or missing assets
    if (req.path.startsWith('/api') || req.path.includes('.')) {
        res.status(404).send('Not Found');
        return;
    }
    console.log('[Server] SPA Fallback for:', req.path);
    res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins for dev simplicity
        methods: ["GET", "POST"]
    },
    pingTimeout: 10000, // 10s timeout (wait for pong)
    pingInterval: 25000, // 25s interval (send ping)
    transports: ['websocket', 'polling'] // Force websocket preference but allow polling fallback
});

const PORT = process.env.PORT || 3001;

// Heartbeat / Connection Logging
setInterval(() => {
    const totalConnections = io.engine.clientsCount;
    if (totalConnections > 0) {
        console.log(`[Heartbeat] Active Connections: ${totalConnections}`);
        rooms.forEach((gs, roomId) => {
            const humanCount = Array.from(gs.players.values()).filter(p => !p.isBot).length;
            if (humanCount > 0) {
                console.log(`  Room ${roomId}: ${humanCount} humans, ${gs.units.length} units`);
            }
        });
    }
}, 10000); // Log every 10 seconds

// Rooms management
const rooms = new Map<string, GameState>();

const getOrCreateRoom = (roomId: string, mapType: string = 'random'): GameState => {
    if (!rooms.has(roomId)) {
        const gs = new GameState(mapType);
        gs.startGameLoop(io, roomId);
        rooms.set(roomId, gs);
    }
    return rooms.get(roomId)!;
};

const getLocalIp = () => {
    const interfaces = os.networkInterfaces();
    let bestIp = 'localhost';

    // First pass: Look for IPv4
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Prefer common LAN subnets (192.168.x.x or 10.x.x.x)
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                    return iface.address;
                }
                bestIp = iface.address;
            }
        }
    }

    // Second pass: Look for IPv6 if no good IPv4 found (and bestIp is still localhost)
    if (bestIp === 'localhost') {
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv6' && !iface.internal && !iface.scopeid) {
                    return iface.address;
                }
            }
        }
    }

    return bestIp;
};

// Helper to get Public IP for Tunnel Mode
const getPublicIp = (): Promise<string> => {
    return new Promise((resolve) => {
        https.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', (err) => {
            console.error('[Server] Failed to fetch public IP:', err);
            resolve(''); // Return empty string on failure
        });
    });
};

// Initialize default lobby
getOrCreateRoom('lobby');

const cleanupRoom = (roomId: string) => {
    if (roomId === 'lobby') return;
    const gs = rooms.get(roomId);
    if (gs) {
        const humanCount = Array.from(gs.players.values()).filter(p => !p.isBot).length;
        if (humanCount === 0) {
            gs.stopGameLoop();
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
        }
    }
};

io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    console.log(`[Connection] New connection: ${socket.id} from ${clientIp}`);

    // Handshake Timeout
    let handshakeReceived = false;
    const handshakeTimeout = setTimeout(() => {
        if (!handshakeReceived) {
            console.log(`[Connection] ${socket.id} timed out waiting for CLIENT_HELLO (10s)`);
            socket.disconnect(true);
        }
    }, 10000);

    socket.on('CLIENT_HELLO', (data) => {
        handshakeReceived = true;
        clearTimeout(handshakeTimeout);
        console.log(`[Connection] ${socket.id} sent HELLO:`, data);

        socket.emit('SERVER_HELLO', {
            serverVersion: '1.0.0',
            protocolVersion: 1,
            motd: 'Welcome to Conqueror\'s Dominion'
        });
    });

    let currentRoom = 'lobby'; // Default room

    // Track connection type
    (socket as any).isTunnel = true; // Default to true (safe/slow) until identified

    socket.on('identify_connection', (data: { isTunnel: boolean }) => {
        (socket as any).isTunnel = data.isTunnel;
        console.log(`[Connection] ${socket.id} identified as ${data.isTunnel ? 'TUNNEL' : 'LOCAL'}`);

        // If local, join the fast update channel for the current room
        if (!data.isTunnel && currentRoom) {
            socket.join(currentRoom + '_fast');
        }

        if (!(socket as any).isTunnel) {
            socket.emit('tunnelPassword', getLocalIp());
        }
    });

    const switchRoom = (roomId: string, mapType: string = 'random', suppressBroadcast: boolean = false) => {
        console.log(`[Server] switchRoom called for ${roomId} with mapType: ${mapType}`);
        socket.leave(currentRoom);
        socket.leave(currentRoom + '_fast'); // Leave fast channel too

        const oldGs = rooms.get(currentRoom);
        if (oldGs) {
            oldGs.removePlayer(socket.id);
            io.to(currentRoom).emit('playersData', Array.from(oldGs.players.values()));
            cleanupRoom(currentRoom);
        }

        currentRoom = roomId;
        socket.join(roomId);
        if (!(socket as any).isTunnel) {
            socket.join(roomId + '_fast');
        }

        const gs = getOrCreateRoom(roomId, mapType);

        // Fix: Ensure custom games are always in playing state to prevent lobby flash
        if (roomId.startsWith('custom_')) {
            gs.status = 'playing';
        }

        gs.addPlayer(socket.id);
        gs.checkVotingStart(io, roomId);

        if (!suppressBroadcast) {
            io.to(roomId).emit('mapData', gs.map);
            io.to(roomId).emit('playersData', Array.from(gs.players.values()));
            io.to(roomId).emit('unitsData', gs.units);
            if (gs.matchState === 'ENDED') {
                socket.emit('MATCH_ENDED', {
                    winnerPlayerId: gs.winnerId,
                    eliminatedPlayerIds: Array.from(gs.eliminatedPlayerIds),
                    endReason: gs.endReason,
                    timestamp: Date.now()
                });
            }
            if (gs.tunnelUrl) {
                socket.emit('tunnelUrl', gs.tunnelUrl);
                if (gs.password) {
                    socket.emit('tunnelPassword', gs.password);
                }
            } else {
                // LAN: Send local IP as password (valid IPv4)
                socket.emit('tunnelPassword', getLocalIp());
            }
            socket.emit('lobbySettings', { requiredPlayers: gs.requiredPlayers });
            socket.emit('gameStatus', gs.status);
            socket.emit('joinedRoom', roomId);
        }
    };

    socket.on('vote_map', (mapType: string) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.registerVote(socket.id, mapType);
        }
    });

    socket.on('request_game_state', () => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            socket.emit('gameStatus', gs.status);
            socket.emit('lobbySettings', { requiredPlayers: gs.requiredPlayers });
            socket.emit('mapData', gs.map);
            socket.emit('playersData', Array.from(gs.players.values()));
            socket.emit('unitsData', gs.units);
            if (gs.matchState === 'ENDED') {
                socket.emit('MATCH_ENDED', {
                    winnerPlayerId: gs.winnerId,
                    eliminatedPlayerIds: Array.from(gs.eliminatedPlayerIds),
                    endReason: gs.endReason,
                    timestamp: Date.now()
                });
            }
            if (gs.tunnelUrl) {
                socket.emit('tunnelUrl', gs.tunnelUrl);
                if (gs.password) {
                    socket.emit('tunnelPassword', gs.password);
                }
            } else {
                // LAN: Send local IP as password (valid IPv4)
                socket.emit('tunnelPassword', getLocalIp());
            }
            if (gs.status === 'voting') {
                const timeLeft = Math.max(0, gs.voteEndTime - Date.now());
                socket.emit('votingUpdate', {
                    timeLeft,
                    votes: Array.from(gs.mapVotes.entries())
                });
            }
        }
    });

    socket.on('request_spawn', () => {
        const gs = rooms.get(currentRoom);
        if (gs && gs.status === 'playing') {
            const player = (gs as any).players.get(socket.id);
            if (!player) {
                console.log(`[Spawn] Blocked request_spawn for unknown player ${socket.id}.`);
                return;
            }

            if (player.status === 'eliminated' || player.canBuildHQ === false) {
                console.log(`[Spawn] Blocked request_spawn for eliminated/restricted player ${socket.id}.`);
                return;
            }

            // Verify if player really needs spawn
            const existingBase = gs.map.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
            if (!existingBase) {
                console.log(`[Spawn] Client ${socket.id} requested spawn (missing base).`);
                gs.assignStartingIsland(socket.id);
                // Broadcast updates
                io.to(currentRoom).emit('mapData', gs.map);
                io.to(currentRoom).emit('unitsData', gs.units);
                io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
            } else {
                console.log(`[Spawn] Client ${socket.id} requested spawn but base ALREADY EXISTS.`);
                // Resend map data just in case
                socket.emit('mapData', gs.map);
            }
        }
    });

    socket.on('force_spawn_hq', () => {
        const gs = rooms.get(currentRoom);
        if (!gs) return;
        if (gs.status !== 'playing') {
            console.log(`[Spawn] Blocked force_spawn_hq outside playing state for ${socket.id}.`);
            return;
        }

        const existingBase = gs.map.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
        if (existingBase) {
            socket.emit('mapData', gs.map);
            return;
        }

        const player = (gs as any).players.get(socket.id);
        if (!player) {
            console.log(`[Spawn] Blocked force_spawn_hq for unknown player ${socket.id}.`);
            return;
        }

        if (player.status === 'eliminated' || player.canBuildHQ === false) {
            console.log(`[Spawn] Blocked force_spawn_hq for eliminated/restricted player ${socket.id}.`);
            return;
        }

        (gs as any).assignStartingIsland(socket.id);
        io.to(currentRoom).emit('mapData', gs.map);
        io.to(currentRoom).emit('unitsData', gs.units);
        io.to(currentRoom).emit('playersData', Array.from((gs as any).players.values()));
    });

    socket.on('set_tunnel_url', (url: string) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.tunnelUrl = url;
            // Generate a password if not set
            if (!gs.password) {
                gs.password = Math.random().toString(36).slice(-6).toUpperCase();
            }
            io.to(currentRoom).emit('tunnelUrl', url);
            io.to(currentRoom).emit('tunnelPassword', gs.password);
        }
    });

    socket.on('joinRoom', (roomId: string) => {
        switchRoom(roomId);

        // Auto-add bots for campaign and start immediately
        const gs = rooms.get(roomId)!;
        if (roomId.startsWith('campaign_') && gs.players.size === 1) {
            gs.requiredPlayers = 1; // Allow single player start

            // Add 5 Bots for Campaign (Default Difficulty 5)
            for (let i = 0; i < 5; i++) {
                const botId = `bot_${Date.now()}_${i}`;
                gs.addPlayer(botId, true, undefined, 5);
            }

            // Force start immediately (bypass voting time)
            gs.status = 'voting';
            gs.finalizeMapAndStart(io, roomId);

            // Re-emit explicitly to the socket just in case io.to(roomId) was too early
            socket.emit('gameStatus', gs.status);
            socket.emit('mapData', gs.map);
            socket.emit('playersData', Array.from(gs.players.values()));
            socket.emit('unitsData', gs.units);
        }
    });

    socket.on('createCustomGame', (data: { mapType: string, botCount: number, difficulty: number }) => {
        console.log('[Server] createCustomGame request:', data);
        const roomId = `custom_${socket.id}_${Date.now()}`;

        // Create room with specific map type
        const requestedMapType = data.mapType || 'random';

        // PRE-CREATE room and set status to playing to avoid 'waiting' flash
        const gs = getOrCreateRoom(roomId, requestedMapType);
        gs.status = 'playing';
        gs.requiredPlayers = 1;

        // Suppress initial broadcast to avoid sending empty/wrong map data before generation
        switchRoom(roomId, requestedMapType, true);

        if (gs) {
            gs.mapType = requestedMapType; // Explicitly enforce map type

            const botCount = Math.min(10, Math.max(0, data.botCount));
            const difficulty = Math.min(10, Math.max(1, data.difficulty));

            for (let i = 0; i < botCount; i++) {
                const botId = `bot_${Date.now()}_${i}`;
                const player = gs.addPlayer(botId, true, undefined, difficulty);
                if (player) player.difficulty = difficulty; // Force update difficulty
            }

            // Force Start (Bypass voting logic to ensure mapType is respected)
            gs.status = 'playing';

            // Handle Random Selection manually if needed
            if (gs.mapType === 'random') {
                const types = ['islands', 'grasslands', 'desert'];
                gs.mapType = types[Math.floor(Math.random() * types.length)];
            }

            console.log(`[CustomGame] Starting with mapType: ${gs.mapType}`);

            // Initialize Map
            gs.map = MapGenerator.generate(3200, 2400, 40, gs.mapType as any);
            gs.map.mapType = gs.mapType;
            gs.map.serverRegion = gs.serverRegion;

            // Reset Units (Clear any ghost units from pre-spawn)
            gs.units = [];

            // Initialize Players
            gs.players.forEach(p => {
                p.resources = { gold: 200, oil: 0 };
                p.status = 'active';
                p.canBuildHQ = true;
            });

            gs.startTime = Date.now();

            // Spawn Bases
            console.log(`[CustomGame] Spawning bases for ${gs.players.size} players...`);
            gs.players.forEach(p => {
                gs.assignStartingIsland(p.id);
            });

            // Re-init Bots
            const botPlayers = Array.from(gs.players.values()).filter(p => p.isBot);
            gs.bots = [];
            botPlayers.forEach(p => {
                gs.bots.push(new BotAI(p.id, p.difficulty || 5));
            });

            // Broadcast Start
            console.log(`[CustomGame] Broadcast Start to ${roomId}`);
            // Explicitly emit to the socket FIRST to ensure it gets it regardless of join status
            socket.emit('gameStatus', 'playing');
            socket.emit('joinedRoom', roomId);
            socket.emit('gameStarted', { mapType: gs.mapType });
            socket.emit('mapData', gs.map);
            socket.emit('playersData', Array.from(gs.players.values()));
            socket.emit('unitsData', gs.units);

            // Also broadcast to the room for any other players (though usually single player here)
            io.to(roomId).emit('gameStatus', 'playing');
            io.to(roomId).emit('mapData', gs.map);
            io.to(roomId).emit('playersData', Array.from(gs.players.values()));
        }
    });

    socket.on('useAbility', (data: { unitId: string, ability: string }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.handleUseAbility(socket.id, data.unitId, data.ability, io);
        }
    });

    socket.on('quickJoin', (data?: { mapType: string, tunnelUrl?: string, forceNew?: boolean }) => {
        const requestedType = data?.mapType || 'random';

        // Find least-populated public room or create a new one
        let targetId: string | null = null;
        let minCount = Infinity;

        // If tunnelUrl is provided OR forceNew is true, force a new room to host it
        if (!data?.tunnelUrl && !data?.forceNew) {
            rooms.forEach((gs, id) => {
                if (id.startsWith('public_') && gs.status === 'waiting') {
                    let match = true;
                    if (requestedType !== 'random') {
                        if (gs.mapType !== requestedType) match = false;
                    }

                    if (match) {
                        const humanCount = Array.from(gs.players.values()).filter(p => !p.isBot).length;
                        if (humanCount < minCount) {
                            minCount = humanCount;
                            targetId = id;
                        }
                    }
                }
            });
        }

        if (!targetId || minCount >= 10 || data?.tunnelUrl) { // cap room size to 10 humans or force new if tunnel
            targetId = `public_${Math.random().toString(36).slice(2, 8)}`;
        }

        // Always generate a password for new public rooms (LAN or Tunnel)
        // Only generate if we are creating a new room (targetId was just generated or we are about to create it)
        // But switchRoom -> getOrCreateRoom handles creation.
        // We need to set password AFTER creation or pass it.

        // Check if room exists first to avoid overwriting existing password?
        // Actually getOrCreateRoom will return existing or new.
        // We should set password only if it's a NEW room (or doesn't have one).

        const gs = getOrCreateRoom(targetId, requestedType);
        if (!gs.password) {
            gs.password = Math.random().toString(36).slice(-6).toUpperCase();
        }

        // If we are creating a new room with tunnelUrl
        if (data?.tunnelUrl) {
            gs.tunnelUrl = data.tunnelUrl;
        }

        switchRoom(targetId, requestedType);
    });

    socket.on('joinByCode', (roomId: string) => {
        switchRoom(roomId);
    });

    // Handle initial join to lobby if client doesn't emit joinRoom immediately
    socket.join('lobby');
    const defaultGs = getOrCreateRoom('lobby');
    defaultGs.addPlayer(socket.id);
    // Ensure lobby never starts a game
    if (defaultGs.status !== 'waiting') {
        defaultGs.status = 'waiting';
        defaultGs.voteEndTime = 0;
        defaultGs.mapVotes.clear();
        defaultGs.units = [];
        defaultGs.bots = [];
    }
    // Send initial state
    io.to('lobby').emit('mapData', defaultGs.map);
    io.to('lobby').emit('playersData', Array.from(defaultGs.players.values()));
    io.to('lobby').emit('unitsData', defaultGs.units);
    socket.emit('gameStatus', defaultGs.status);
    socket.emit('joinedRoom', 'lobby');

    socket.on('set_required_players', (count: number) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            console.log(`Setting required players to ${count} for room ${currentRoom}`);
            gs.setRequiredPlayers(count);
            io.to(currentRoom).emit('lobbySettings', { requiredPlayers: gs.requiredPlayers });
            gs.checkVotingStart(io, currentRoom);
        }
    });

    socket.on('addBot', (difficulty: number = 5) => {
        const gs = rooms.get(currentRoom);
        if (gs && gs.status === 'waiting') {
            const botCount = Array.from(gs.players.values()).filter(p => p.isBot).length;
            if (botCount < 10) {
                const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                // Add bot with provided difficulty
                gs.addPlayer(botId, true, undefined, difficulty);

                io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
                gs.checkVotingStart(io, currentRoom);
            } else {
                socket.emit('info', { message: 'Bot limit reached (10).' });
            }
        }
    });

    socket.on('force_start_match', () => {
        const gs = rooms.get(currentRoom);
        if (gs && gs.status === 'waiting') {
            console.log(`Force starting match for room ${currentRoom} by ${socket.id}`);
            gs.forceStart(io, currentRoom);
        }
    });

    socket.on('start_custom_game', (mapType: string) => {
        const gs = rooms.get(currentRoom);
        if (gs && gs.status === 'waiting') {
            console.log(`Starting custom game for room ${currentRoom} by ${socket.id}`);
            gs.startCustomGame(io, currentRoom, mapType);
        }
    });

    socket.on('chat_message', (message: string) => {
        if (!currentRoom) {
            console.warn(`[Chat] No currentRoom for socket ${socket.id}`);
            return;
        }

        const gs = rooms.get(currentRoom);
        if (!gs) {
            console.warn(`[Chat] No GameState for room ${currentRoom}`);
        }

        // Check for Cheats
        if (message.startsWith('/') && gs) {
            console.log(`[Cheat] Processing command: ${message} from ${socket.id} in ${currentRoom}`);
            const parts = message.slice(1).split(' ');
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            const result = gs.handleCheat(socket.id, command, args);

            // Send feedback only to sender
            socket.emit('chat_message', {
                sender: 'System',
                content: result,
                timestamp: Date.now()
            });

            // Also update player data immediately so UI reflects changes
            io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
            io.to(currentRoom).emit('unitsData', gs.units);
            return;
        }

        // Broadcast to everyone in the room
        io.to(currentRoom).emit('chat_message', {
            sender: socket.id,
            content: message,
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', (reason) => {
        console.log('User disconnected:', socket.id, 'Reason:', reason);
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.removePlayer(socket.id);
            io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
            cleanupRoom(currentRoom);
        }
    });

    socket.on('build', (data: { islandId?: string, type: 'barracks' | 'mine' | 'tower' | 'dock' | 'base' | 'oil_rig' | 'wall' | 'bridge_node' | 'wall_node', x?: number, y?: number }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            const success = gs.buildStructure(socket.id, data.islandId as any, data.type, data.x, data.y);
            if (success) {
                io.to(currentRoom).emit('mapData', gs.map);
                io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
            }
        }
    });

    socket.on('delete_entities', (data: { entityIds: string[] }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.deleteEntities(socket.id, data.entityIds);
            io.to(currentRoom).emit('mapData', gs.map);
            io.to(currentRoom).emit('unitsData', gs.units);
        }
    });

    socket.on('connect_nodes', (data: { nodeAId: string, nodeBId: string }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.connectNodes(socket.id, data.nodeAId, data.nodeBId);
            io.to(currentRoom).emit('mapData', gs.map);
            io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
        }
    });

    socket.on('convert_wall_to_gate', (data: { nodeAId: string, nodeBId: string }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.convertWallToGate(socket.id, data.nodeAId, data.nodeBId);
            io.to(currentRoom).emit('mapData', gs.map);
            io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
        }
    });

    socket.on('recruit', (data: { islandId: string, buildingId?: string, type: 'soldier' | 'destroyer' | 'construction_ship' | 'sniper' | 'rocketeer' | 'builder' | 'ferry' }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            const success = gs.recruitUnit(socket.id, data.islandId, data.type, data.buildingId);
            if (success) {
                io.to(currentRoom).emit('mapData', gs.map); // Update queue
            }
            io.to(currentRoom).emit('playersData', Array.from(gs.players.values()));
            io.to(currentRoom).emit('unitsData', gs.units);
        }
    });

    socket.on('upgradeBuilding', (data: { buildingId: string }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            if (gs.upgradeBuilding(socket.id, data.buildingId)) {
                io.to(currentRoom).emit('mapData', gs.map); // Map data contains buildings
                io.to(currentRoom).emit('playersData', Array.from(gs.players.values())); // Resources changed
            }
        }
    });

    socket.on('move', (data: { unitIds: string[], targetIslandId?: string, x?: number, y?: number }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            if (data.targetIslandId) {
                gs.moveUnits(socket.id, data.unitIds, data.targetIslandId);
            } else if (data.x !== undefined && data.y !== undefined) {
                gs.moveUnitsToPosition(socket.id, data.unitIds, data.x, data.y);
            }
            io.to(currentRoom).emit('unitsData', gs.units);
        }
    });

    socket.on('moveIntent', (data: { unitId: string, intentId: string, destX: number, destY: number, clientTime: number }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.handleMoveIntent(socket.id, data.unitId, data.intentId, data.destX, data.destY);
            // Don't broadcast immediately; update loop handles movement
        }
    });

    // moveSteer handler removed as steering logic is deprecated

    socket.on('load', (data: { ferryId: string, unitIds: string[] }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.loadUnits(socket.id, data.ferryId, data.unitIds);
        }
    });

    socket.on('unload', (data: { ferryId: string, x: number, y: number }) => {
        const gs = rooms.get(currentRoom);
        if (gs) {
            gs.unloadUnits(socket.id, data.ferryId, data.x, data.y);
        }
    });

    socket.on('ping_check', (timestamp: number) => {
        socket.emit('pong_check', timestamp);
    });
});

httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
