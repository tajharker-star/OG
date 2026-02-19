import { MapGenerator, GameMap, Island } from './MapGenerator';
import { BotAI } from './BotAI';
import { UnitData, BuildingData } from './data/Registry';
import { randomUUID } from 'crypto';

export interface Player {
  id: string;
  color: string;
  name?: string;
  resources: {
    gold: number;
    oil: number;
  };
  isBot?: boolean;
  difficulty?: number;
  status?: 'active' | 'eliminated';
  godMode?: boolean;
  canBuildHQ?: boolean;
}

export interface Unit {
  id: string;
  ownerId: string;
  type: string;
  x: number;
  y: number;
  targetIslandId?: string;
  targetX?: number;
  targetY?: number;
  status: 'idle' | 'moving' | 'fighting';
  health: number;
  maxHealth: number;
  damage: number;
  range: number;
  speed: number;
  fireRate: number;
  lastAttackTime?: number;
  cargo?: Unit[]; // Units inside
  recruitmentQueue?: { unitType: string, progress: number, totalTime: number }[];
  abilityCooldown?: number;
  laserTargetId?: string;
  laserActive?: boolean;
  laserEndTime?: number;
  laserLastTick?: number;
  intentId?: string;
  path?: {x: number, y: number}[];
}

export class GameState {
  map: GameMap;
  players: Map<string, Player>;
  units: Unit[];
  bots: BotAI[];
  startTime: number;
  gameEnded: boolean = false;
  lastTickTime: number = 0;
  lastMapEmitTime: number = 0;
  lastUnitEmitTime: number = 0;
  tickCounter: number = 0;
  pendingProjectiles: any[] = [];
  mapType: string;
  serverRegion: string;
  gameLoopInterval: any = null;

  // Match State
  matchState: 'RUNNING' | 'ENDED' = 'RUNNING';
  eliminatedPlayerIds: Set<string> = new Set();
  endReason: 'HQ_DESTROYED' | 'ALL_ENEMIES_DEFEATED' | null = null;

  // Multiplayer Lobby State
  status: 'waiting' | 'voting' | 'starting' | 'playing' = 'waiting';
  mapVotes: Map<string, string> = new Map();
  voteEndTime: number = 0;
  winnerId: string | null = null;
  requiredPlayers: number = 2;
  tunnelUrl: string | null = null;
  password: string | null = null;

  private io: any = null;
  private roomId: string | null = null;

  constructor(mapType: string = 'random') {
    this.mapType = mapType;
    this.serverRegion = 'NA-East-1';
    
    // Initial dummy map for lobby background or empty
    this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any); 
    this.map.mapType = this.mapType;
    this.map.serverRegion = this.serverRegion;
    this.map.version = randomUUID();

    this.players = new Map();
    this.units = [];
    this.bots = [];
    this.startTime = Date.now();
  }

  startVoting(io: any, roomId: string) {
      if (this.status !== 'waiting') return;
      
      console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=voting reason=start_voting humans=${this.players.size}`);
      this.status = 'voting';
      this.mapVotes.clear();
      this.voteEndTime = Date.now() + 10000; // 10 seconds
      
      io.to(roomId).emit('gameStatus', 'voting');
      io.to(roomId).emit('votingUpdate', {
          timeLeft: 10000,
          votes: []
      });
  }

  registerVote(playerId: string, mapType: string) {
      if (this.status !== 'voting') return;
      if (['islands', 'grasslands', 'desert', 'random'].includes(mapType)) {
          this.mapVotes.set(playerId, mapType);
      }
  }

  setRequiredPlayers(count: number) {
      this.requiredPlayers = Math.max(1, Math.min(10, count));
      // If we now have enough players, trigger check
      // However, checkVotingStart needs 'io' which we don't have here easily without passing it.
      // For now, the lobby loop or next join will trigger it.
      // Ideally we should check if we can start.
  }

  forceStart(io: any, roomId: string) {
      if (this.status === 'waiting') {
          // Update required players to match current count to ensure logic holds
          // FIX: Ensure host is included in human count
          const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;
          
          console.log(`[GameState] forceStart: roomId=${roomId}, humanCount=${humanCount}`);
          
          // Allow start with just 1 player (Host) for LAN/Testing
          this.requiredPlayers = Math.max(1, Math.min(10, humanCount));
          
          // Force start voting immediately
          this.startVoting(io, roomId);
      }
  }

  startCustomGame(io: any, roomId: string, mapType: string) {
      if (this.status !== 'waiting') return;
      
      console.log(`Starting Custom Game in room ${roomId} with map ${mapType}`);
      this.mapType = mapType;
      this.requiredPlayers = 1;
      
      // Skip voting, start immediately
      this.status = 'voting'; // Temporarily set to voting so finalize accepts it
      // Force finalize with specific map
      this.mapVotes.clear(); // Clear any existing votes
      this.mapVotes.set('host', mapType); // Dummy vote to ensure selection if logic used
      
      // Override the random selection in finalizeMapAndStart by setting mapType directly
      // finalizeMapAndStart uses this.mapType if maxVotes is 0 or as a fallback
      // But let's just make sure we call it and it respects our choice.
      // Actually, finalizeMapAndStart recalculates mapType based on votes.
      // Let's modify finalizeMapAndStart to accept an override or just handle it here.
      
      // Better approach: Re-implement the start logic specifically for custom game to avoid side effects
      // Reuse the generation and start logic
      
      this.mapType = mapType;
      console.log(`Custom Map selected: ${this.mapType}`);
      
      // Generate Map
      this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any);
      this.map.mapType = this.mapType;
      this.map.serverRegion = this.serverRegion;
      
      this.units = [];
      // Keep bots but reset them
      const botPlayers = Array.from(this.players.values()).filter(p => p.isBot);
      this.bots = [];
      botPlayers.forEach(p => {
          this.bots.push(new BotAI(p.id, p.difficulty || 5));
      });
      
      this.players.forEach(p => {
          p.resources = { gold: 200, oil: 0 };
          p.status = 'active';
          p.canBuildHQ = true;
      });
      
      this.status = 'playing';
      this.startTime = Date.now();
      
      this.players.forEach(p => {
          this.assignStartingIsland(p.id);
      });
      
      io.to(roomId).emit('gameStatus', 'playing');
      io.to(roomId).emit('gameStarted', { mapType: this.mapType });
      io.to(roomId).emit('mapData', this.map);
      io.to(roomId).emit('playersData', Array.from(this.players.values()));
      io.to(roomId).emit('unitsData', this.units);
  }

  finalizeMapAndStart(io: any, roomId: string) {
      if (this.status !== 'voting' && this.status !== 'starting') return;
      
      // Lock transition to prevent bounce back to lobby during generation
      if (this.status === 'voting') {
          console.log(`[LOBBY_STATE_CHANGE] from=voting to=starting reason=finalizing_map matchId=${roomId}`);
          this.status = 'starting';
          io.to(roomId).emit('gameStatus', 'starting');
      }

      if (roomId === 'lobby') {
          // Do not start games in the global lobby
          console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=waiting reason=is_global_lobby humans=${this.players.size}`);
          this.status = 'waiting';
          io.to(roomId).emit('gameStatus', 'waiting');
          return;
      }

      // Double check player count (unless testing/campaign)
      // FIX: One-way transition. Only fail if critically impossible (e.g. 0 humans)
      const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;
      if (humanCount < 1) { 
           console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=waiting reason=no_humans humans=${humanCount}`);
           this.status = 'waiting';
           io.to(roomId).emit('gameStatus', 'waiting');
           io.to(roomId).emit('MATCH_START_FAILED', { reason: 'No players in lobby' });
           return;
      }
      
      // Calculate Votes
      const votes: Record<string, number> = { islands: 0, grasslands: 0, desert: 0, random: 0 };
      this.mapVotes.forEach(v => {
          if (votes[v] !== undefined) votes[v]++;
      });

      console.log(`[GameState] Finalizing map for room ${roomId}. Current mapType: ${this.mapType}. Votes:`, votes);
      
      // Strict Majority Selection
      let maxVotes = 0;
      let winners: string[] = [];

      Object.entries(votes).forEach(([type, count]) => {
          if (count > maxVotes) {
              maxVotes = count;
              winners = [type];
          } else if (count === maxVotes) {
              winners.push(type);
          }
      });

      // If no votes (maxVotes === 0), use all types as pool
      if (maxVotes === 0) {
          // If the room was created with a specific map type, use it
          if (this.mapType && this.mapType !== 'random') {
              winners = [this.mapType];
          } else {
              winners = ['islands', 'grasslands', 'desert'];
          }
      }

      let selected = winners[Math.floor(Math.random() * winners.length)];
      
      if (selected === 'random') {
          const types = ['islands', 'grasslands', 'desert'];
          selected = types[Math.floor(Math.random() * types.length)];
      }
      
      this.mapType = selected;
      console.log(`[MATCH] creating matchId=${randomUUID()} from lobbyId=${roomId}`);
      console.log(`[MATCH] initMatch start matchId=${roomId}`);
      
      console.log(`Map selected: ${this.mapType}`);
      
      // Generate Map
      this.map = MapGenerator.generate(3200, 2400, 40, this.mapType as any);
      this.map.mapType = this.mapType;
      this.map.serverRegion = this.serverRegion;
      this.map.version = randomUUID();
      
      // Reset State but keep players
      this.units = [];
      // Bots should be re-initialized from players list
      
      // Clear player resources/status
      this.players.forEach(p => {
          p.resources = { gold: 200, oil: 0 };
          p.status = 'active';
          p.canBuildHQ = true;
      });
      
      // Start Game
      console.log(`[LOBBY_STATE_CHANGE] from=${this.status} to=playing reason=match_started humans=${humanCount}`);
      this.status = 'playing';
      this.startTime = Date.now();
      console.log(`[MATCH] state -> RUNNING matchId=${roomId}`);
      console.log(`[MATCH] MATCH_STARTED matchId=${roomId} lobbyId=${roomId}`);
      
      // Spawn Bases
      this.players.forEach(p => {
          this.assignStartingIsland(p.id);
      });
      
      // Re-add bots
      const botPlayers = Array.from(this.players.values()).filter(p => p.isBot);
      this.bots = [];
      botPlayers.forEach(p => {
          this.bots.push(new BotAI(p.id, p.difficulty || 5));
      });

      const baseCount = this.map.islands.reduce((acc, i) => acc + i.buildings.filter(b => b.type === 'base').length, 0);
      console.log(`[MATCH] initMatch complete matchId=${roomId} entitiesSpawned=${this.units.length} bases=${baseCount}`);

      // Broadcast Start
      console.log(`[MATCH] broadcast MATCH_STARTED matchId=${roomId}`);
      io.to(roomId).emit('gameStatus', 'playing'); // Explicitly update status
      io.to(roomId).emit('gameStarted', { mapType: this.mapType });
      io.to(roomId).emit('MATCH_STARTED', { matchId: roomId }); // Authoritative start event
      io.to(roomId).emit('mapData', this.map);
      io.to(roomId).emit('playersData', Array.from(this.players.values()));
      io.to(roomId).emit('unitsData', this.units);
  }



  addPlayer(id: string, isBot: boolean = false, name?: string, difficulty: number = 5): Player | null {
    if (this.players.has(id)) return this.players.get(id)!;

    // Assign a random color
    const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    
    const player: Player = {
      id,
      color,
      name: name || (isBot ? `Bot ${id.substr(-4)}` : `Player ${id.substr(0, 4)}`),
      resources: { gold: 200, oil: 0 }, 
      isBot,
      difficulty
    };
    
    this.players.set(id, player);
    
    // Only assign island if game is already playing
    if (this.status === 'playing') {
        this.assignStartingIsland(id);
        if (isBot) {
            this.bots.push(new BotAI(id, difficulty));
        }
    }

    // Check for voting trigger
    // Voting is now triggered via checkVotingStart called from index.ts
    
    return player;
  }
  
  // Helper to check voting (called from index.ts)
  checkVotingStart(io: any, roomId: string) {
      // FIX: Ensure host is included in human count
      const humanCount = Array.from(this.players.values()).filter(p => !p.isBot).length;
      
      console.log(`[GameState] checkVotingStart: roomId=${roomId}, humanCount=${humanCount}, required=${this.requiredPlayers}, status=${this.status}`);
      
      // Never auto-start voting in the global lobby
      if (roomId === 'lobby') return;
      
      // Stop watchdog if we are already voting, starting, or playing
      if (this.status !== 'waiting') return;
      
      // Allow start if we have enough humans (min 1 for LAN/testing if requiredPlayers is 1)
      if (this.status === 'waiting' && humanCount >= this.requiredPlayers) {
          console.log(`[GameState] Triggering voting start for ${roomId}`);
          this.startVoting(io, roomId);
      }
  }

  removePlayer(id: string) {
    const player = this.players.get(id);
    
    // If game is playing, mark as eliminated instead of removing
    // This ensures Game Over logic (player count) works correctly
    if (this.status === 'playing' && player) {
        player.status = 'eliminated';
        console.log(`Player ${id} disconnected during game. Marked as eliminated.`);
    } else {
        this.players.delete(id);
    }

    this.bots = this.bots.filter(b => b.playerId !== id);
    
    // Remove units
    this.units = this.units.filter(u => u.ownerId !== id);

    // Reset owned islands and remove buildings
    this.map.islands.forEach(island => {
      if (island.ownerId === id) {
        island.ownerId = undefined;
      }
      
      // Remove buildings owned by this player
      island.buildings = island.buildings.filter(b => {
          if (b.ownerId === id) {
              // Free up resources if needed
              if (b.type === 'mine') {
                  const spot = island.goldSpots.find(s => s.occupiedBy === b.id);
                  if (spot) spot.occupiedBy = undefined;
              }
              return false; // Remove building
          }
          return true;
      });
    });
    
    // Reset oil spots
    this.map.oilSpots.forEach(spot => {
        if ((spot as any).ownerId === id) {
             (spot as any).ownerId = undefined;
             (spot as any).building = undefined;
             spot.occupiedBy = undefined;
        } else if (spot.occupiedBy) {
             // Check if the building occupying it was removed?
             // Since we don't have easy access to the building list here without searching islands,
             // we rely on the fact that if the building was on an island (oil_pump), it's gone.
             // If it was an oil_rig (on water), where is it stored?
             // GameState usually stores oil_rigs in island.buildings too? 
             // Or map.oilSpots has the building directly?
        }
    });
  }

  assignStartingIsland(playerId: string) {
    // Check if player is allowed to build HQ (Anti-Exploit)
    const player = this.players.get(playerId);
    if (player && player.canBuildHQ === false) {
        console.log(`[Spawn] Player ${playerId} is blocked from spawning HQ (Eliminated/Restricted).`);
        return;
    }

    // Determine map strategy
    const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
    console.log(`Assigning starting island for player ${playerId} on map ${this.mapType}`);
    
    // Collect all existing bases to check distance
    const existingBases: {x: number, y: number}[] = [];
    this.map.islands.forEach(i => {
        i.buildings.forEach(b => {
            if (b.type === 'base') {
                existingBases.push({x: i.x + (b.x||0), y: i.y + (b.y||0)});
            }
        });
    });

    // Check if player already has a base to prevent double spawning
    const existingBase = this.map.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === playerId));
    if (existingBase) {
        console.log(`[Spawn] Player ${playerId} already has a base. Skipping spawn.`);
        return;
    }

    // Strategy Phases
    const phases = [
        { attempts: 50, buffer: 60, separation: 600, name: 'Strict' },
        { attempts: 50, buffer: 20, separation: 300, name: 'Relaxed' },
        { attempts: 20, buffer: 0, separation: 100, name: 'Minimal' }
    ];

    let bestCandidate: {island: Island, x: number, y: number, score: number} | null = null;

    for (const phase of phases) {
        if (bestCandidate) break;
        console.log(`Trying spawning phase: ${phase.name}`);

        const candidates: {island: Island, x: number, y: number, score: number}[] = [];
        
        for(let i=0; i<phase.attempts; i++) {
            // Pick an island
            let island: Island | undefined;
            
            if (isSharedMap) {
                // Pick any large island (High Land or Low Land or Grassland)
                // Filter out obstacles (High Land, Oil Pit) to prevent spawning there
                const possible = this.map.islands.filter(isl => 
                    isl.radius > 200 && 
                    isl.id !== 'oil_pit' && 
                    isl.id !== 'high_land'
                );
                if (possible.length > 0) {
                    island = possible[Math.floor(Math.random() * possible.length)];
                }
            } else {
                // Classic mode: Pick unowned island
                const unowned = this.map.islands.filter(isl => !isl.ownerId);
                if (unowned.length > 0) {
                    island = unowned[Math.floor(Math.random() * unowned.length)];
                }
            }

            if (!island) continue;

            // Generate random point on island
            const minX = Math.max(0, island.x - island.radius);
            const maxX = Math.min(this.map.width, island.x + island.radius);
            const minY = Math.max(0, island.y - island.radius);
            const maxY = Math.min(this.map.height, island.y + island.radius);

            const testX = minX + Math.random() * (maxX - minX);
            const testY = minY + Math.random() * (maxY - minY);
            
            // Validate
            let valid = true;
            if (island.points) {
                if (!MapGenerator.isPointInPolygon(testX, testY, island.points)) {
                    valid = false;
                } else {
                    // Ensure not too close to the edge (Buffer)
                    const closest = MapGenerator.getClosestPointOnPolygon(testX, testY, island.points);
                    const distToEdge = Math.hypot(testX - closest.x, testY - closest.y);
                    
                    if (distToEdge < phase.buffer) valid = false; 
                }
            } else {
                // Circle check
                if (Math.hypot(testX - island.x, testY - island.y) > Math.max(0, island.radius - phase.buffer)) {
                    valid = false;
                }
            }

            if (valid) {
                // Check High Ground Collision
                if (this.map.highGrounds) {
                    for (const hg of this.map.highGrounds) {
                        if (MapGenerator.isPointInPolygon(testX, testY, hg.points)) {
                            valid = false;
                            break;
                        }
                    }
                }
            }

            if (valid) {
                // Score based on distance to nearest base
                let minDist = Infinity;
                existingBases.forEach(base => {
                    const d = Math.hypot(testX - base.x, testY - base.y);
                    if (d < minDist) minDist = d;
                });
                
                if (minDist < phase.separation) valid = false;

                if (valid) {
                    candidates.push({
                        island,
                        x: testX - island.x,
                        y: testY - island.y,
                        score: minDist
                    });
                }
            }
        }
        
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            bestCandidate = candidates[0];
        }
    }

    // Failsafe: Force spawn somewhere if nothing found
    if (!bestCandidate) {
        console.warn(`WARN: Could not find valid spawn for ${playerId}. Using failsafe.`);
        // Try random islands instead of just [0] to avoid stacking
        const validIslands = this.map.islands.filter(i => i.id !== 'oil_pit' && i.id !== 'high_land');
        const island = validIslands[Math.floor(Math.random() * validIslands.length)];
        
    if (island) {
             let fx = 0;
             let fy = 0;
             if (island.points) {
                 // If center is not safe, find closest valid land point (edge)
                 // We use the island center as the reference point to find the closest edge
                 const p = MapGenerator.getClosestPointOnPolygon(island.x, island.y, island.points);
                 fx = p.x - island.x;
                 fy = p.y - island.y;
             }

             bestCandidate = {
                 island,
                 x: fx,
                 y: fy,
                 score: 0
             };
        }
    }

    if (bestCandidate) {
        const { island, x, y } = bestCandidate;
        
        // Assign ownership
        if (!isSharedMap) {
            island.ownerId = playerId;
        }
        
        console.log(`Spawning base for ${playerId} at ${island.x + x}, ${island.y + y} (Island: ${island.id})`);

        // Add Base
        island.buildings.push({
            id: `bld_base_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            type: 'base',
            level: 1,
            health: 500,
            maxHealth: 500,
            x: x,
            y: y,
            ownerId: playerId,
            isConstructing: false,
            constructionProgress: 500,
            range: BuildingData.base.range
        });

        // Add Builder (Find safe spot outside base collision radius)
        console.log(`[Spawn] Base rel: ${x},${y}. Finding safe spot for builder...`);
        let bx = island.x + x;
        let by = island.y + y;
        let foundSafeSpot = false;

        // Spiral Search for valid land spot
        // Start from radius 60 (Base radius ~50) up to 150
        searchLoop:
        for (let r = 60; r <= 150; r += 10) {
            const steps = Math.floor(2 * Math.PI * r / 20); // ~20px intervals
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * Math.PI * 2;
                const tx = island.x + x + Math.cos(angle) * r;
                const ty = island.y + y + Math.sin(angle) * r;

                // Check point validity
                if (this.isValidPosition(tx, ty, 'builder')) {
                    // Strict Check: Must be on the SAME island as the base
                    let onSameIsland = false;
                    if (island.points) {
                        if (MapGenerator.isPointInPolygon(tx, ty, island.points)) onSameIsland = true;
                    } else {
                        const dist = Math.hypot(tx - island.x, ty - island.y);
                        if (dist <= island.radius) onSameIsland = true;
                    }

                    if (!onSameIsland) continue;

                    // Check immediate surroundings to ensure it's not a tiny speck of land
                    const pathChecks = [
                        {dx: 10, dy: 0}, {dx: -10, dy: 0}, {dx: 0, dy: 10}, {dx: 0, dy: -10}
                    ];
                    let pathable = true;
                    for (const pc of pathChecks) {
                        if (!this.isValidPosition(tx + pc.dx, ty + pc.dy, 'builder')) {
                            pathable = false;
                            break;
                        }
                    }

                    if (pathable) {
                        bx = tx;
                        by = ty;
                        foundSafeSpot = true;
                        console.log(`[Spawn] Found safe builder spot at dist ${r}, angle ${angle.toFixed(2)}`);
                        break searchLoop;
                    }
                }
            }
        }

        if (!foundSafeSpot) {
             console.warn(`[Spawn] No safe spot found! Defaulting to base center (risk of stuck).`);
             bx = island.x + x;
             by = island.y + y;
        }

        this.units.push({
            id: `unit_${Date.now()}_builder_${Math.floor(Math.random() * 10000)}`,
            ownerId: playerId,
            type: 'builder',
            x: bx,
            y: by,
            status: 'idle',
            health: UnitData.builder.health,
            maxHealth: UnitData.builder.maxHealth,
            damage: UnitData.builder.damage,
            range: UnitData.builder.range,
            speed: UnitData.builder.speed,
            fireRate: UnitData.builder.fireRate
        });
    } else {
        console.error(`CRITICAL: Failed to spawn base for ${playerId} even with failsafe!`);
    }
  }

  buildStructure(playerId: string, locationId: string, type: 'barracks' | 'mine' | 'tower' | 'dock' | 'base' | 'oil_rig' | 'oil_well' | 'wall' | 'bridge_node' | 'wall_node' | 'farm' | 'tank_factory' | 'air_base', x?: number, y?: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    const stats = BuildingData[type];
    if (!stats) return false;

    if (type === 'base') {
        // Anti-Exploit: Explicitly notify if blocked due to elimination
        if (player.status === 'eliminated' || player.canBuildHQ === false) {
             if (this.io) {
                 this.io.to(playerId).emit('chat_message', {
                     sender: 'System',
                     content: '⛔ Construction Denied: You cannot rebuild HQ after elimination!',
                     timestamp: Date.now()
                 });
             }
        }
        return false; // Hard restrict: HQs are only spawned, not built
    }

    if (player.resources.gold < stats.cost.gold || player.resources.oil < stats.cost.oil) return false;

    // Check if location is an Island or OilSpot
    let island = this.map.islands.find(i => i.id === locationId);
    let oilSpot = this.map.oilSpots.find(o => o.id === locationId);

    // If a specific oil spot is targeted (by ID) but no coordinates provided, use the spot's coordinates
    // This allows clicking directly on a visible/hidden oil spot to place an Oil Well
    if (oilSpot && x === undefined && y === undefined) {
        x = oilSpot.x;
        y = oilSpot.y;
    }

    // If x/y provided, try to find the location if locationId is not specific enough or mismatched
    if (x !== undefined && y !== undefined) {
            // Find island at this position
            // Prioritize smaller islands (e.g. Oases on top of Desert Floor)
            const candidates = this.map.islands.filter(i => {
                 if (i.points) return MapGenerator.isPointInPolygon(x, y, i.points);
                 return Math.hypot(i.x - x, i.y - y) < i.radius + 50; 
            });
            
            // Sort by radius (ascending) to pick the most specific/smallest island (e.g. Oasis vs Low Land)
            candidates.sort((a, b) => a.radius - b.radius);
            
            if (candidates.length > 0) island = candidates[0];
            
            const foundOilSpot = this.map.oilSpots.find(o => Math.hypot(o.x - x, o.y - y) < o.radius + 20);
            if (foundOilSpot) oilSpot = foundOilSpot;
        }

        if (island) {
            // Ownership check: Strict for classic maps, relaxed for shared maps (Desert/Grasslands)
            const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
            if (!isSharedMap && island.ownerId !== playerId) return false;
            
            // Prevent building on enemy islands even in shared maps? 
            // If island has an owner and it's not us, deny.
            if (island.ownerId && island.ownerId !== playerId) return false;

            if (type === 'oil_rig') return false; 

            let targetX = 0;
            let targetY = 0;

            const hasDockWaterSpawn = (absX: number, absY: number): boolean => {
                const radii = [40, 60, 80, 100, 120, 150, 180, 200];
                for (const r of radii) {
                    for (let i = 0; i < 8; i++) {
                        const angle = (i / 8) * Math.PI * 2;
                        const tx = absX + Math.cos(angle) * r;
                        const ty = absY + Math.sin(angle) * r;
                        if (this.isValidPosition(tx, ty, 'destroyer')) {
                            return true;
                        }
                    }
                }
                return false;
            };

            if (x !== undefined && y !== undefined) {
                // Manual placement (Absolute to Relative)
                targetX = x - island.x;
                targetY = y - island.y;

                // Gold Mine Placement Fix
                if (type === 'mine') {
                    // Try to find nearest free gold spot within reasonable range
                    const nearestSpot = island.goldSpots.find(s => !s.occupiedBy && Math.hypot(s.x - targetX, s.y - targetY) < 100);
                    if (nearestSpot) {
                        targetX = nearestSpot.x;
                        targetY = nearestSpot.y;
                    } else {
                        // If no spot found near click, fail
                        return false;
                    }
                }
                
                // Validate placement
                if (island.points) {
                    const absX = island.x + targetX;
                    const absY = island.y + targetY;
                    if (type === 'mine') {
                    } else if (type === 'dock') {
                        const inside = MapGenerator.isPointInPolygon(absX, absY, island.points);
                        if (!inside) return false;
                        const closest = MapGenerator.getClosestPointOnPolygon(absX, absY, island.points);
                        const d = Math.hypot(absX - closest.x, absY - closest.y);
                        if (d > 20) return false;
                        if (!hasDockWaterSpawn(absX, absY)) return false;
                    } else {
                        const inside = MapGenerator.isPointInPolygon(absX, absY, island.points);
                        if (!inside) return false;
                    }
                } else {
                    const dist = Math.hypot(targetX, targetY);
                    if (type === 'dock') {
                        const inner = Math.max(0, island.radius - 20);
                        if (dist < inner || dist > island.radius) return false;
                        const absX = island.x + targetX;
                        const absY = island.y + targetY;
                        if (!hasDockWaterSpawn(absX, absY)) return false;
                    } else if (dist > island.radius) {
                        return false;
                    }
                }

            // Oil Well Specific Validation
            if (type === 'oil_well') {
                // Strict: Desert Land Only
                if (island.type !== 'desert') return false;

                // Check if placed on an Oil Spot (Land)
                // We allow placing on 'hidden_oil' spots too (if player found them)
                // The client ensures they can only click what they see.
                const absX = island.x + targetX;
                const absY = island.y + targetY;

                // Find valid oil spot near click
                const oilSpot = this.map.oilSpots.find(os => 
                    Math.hypot(os.x - absX, os.y - absY) < 40 && // Close enough
                    !os.occupiedBy // Not taken
                );

                if (!oilSpot) return false;

                // STRICT VALIDATION: Ensure it IS a Land Oil Spot
                // Land spots have radius >= 30, Water spots have 15.
                if (oilSpot.radius < 30) return false;

                // Distance check to other wells?
                const tooClose = this.map.oilSpots.some(os => 
                    os.id !== oilSpot.id &&
                    os.occupiedBy && 
                    (os as any).building?.type === 'oil_well' &&
                    Math.hypot(os.x - oilSpot.x, os.y - oilSpot.y) < 60
                );
                if (tooClose) return false;

                // Store reference for post-build processing
                (stats as any).targetOilSpotId = oilSpot.id;
            }

            // Farm Validation
            if (type === 'farm') {
                if (island.type !== 'forest' && island.type !== 'grasslands') return false;

                // Check overlap with other buildings
                const overlap = island.buildings.some(b => {
                    const bx = b.x || 0;
                    const by = b.y || 0;
                    // Farm radius approx 30, so check 100px distance (spacing)
                    // User requested "not able to be placed near other building... cant be spammed ontop"
                    // STRENGTHENED: Check for ANY building within 100px
                    return Math.hypot(bx - targetX, by - targetY) < 100; 
                });
                
                // Additional Check: Check overlap with Units (to prevent bots spamming on top of armies)
                // Though bots usually check isSafe, let's be strict.
                // But this might be too expensive? No, we have this.units.
                // Let's stick to building overlap for now, but ensure the check works.
                
                if (overlap) return false;
                
                // Also check if too close to center (Base) to avoid crowding spawn
                if (Math.hypot(targetX, targetY) < 100) return false;
            }

            // Check for Builder in range
            // User requested larger radius, increased to 400px
            const BUILD_RANGE = 400;
            const finalAbsX = island.x + targetX;
            const finalAbsY = island.y + targetY;

            const hasBuilderInRange = this.units.some(u => 
                u.ownerId === playerId && 
                u.type === 'builder' &&
                Math.hypot(u.x - finalAbsX, u.y - finalAbsY) <= BUILD_RANGE
            );
            
            if (!hasBuilderInRange) return false;
        } else {
             // Auto placement logic (legacy/bot)
             if (type === 'mine') {
                const freeSpot = island.goldSpots.find(s => !s.occupiedBy);
                if (!freeSpot) return false;
                targetX = freeSpot.x;
                targetY = freeSpot.y;
            } else if (type === 'dock') {
                let valid = false;
                let attempts = 0;
                while (!valid && attempts < 40) {
                    attempts++;
                    if (island.points && island.points.length > 0) {
                        const index = Math.floor(Math.random() * island.points.length);
                        const p = island.points[index];
                        const dx = p.x - island.x;
                        const dy = p.y - island.y;
                        const len = Math.hypot(dx, dy) || 1;
                        const insideOffset = 15;
                        const anchorX = p.x - (dx / len) * insideOffset;
                        const anchorY = p.y - (dy / len) * insideOffset;
                        if (!MapGenerator.isPointInPolygon(anchorX, anchorY, island.points)) {
                            continue;
                        }
                        const absX = anchorX;
                        const absY = anchorY;
                        if (!hasDockWaterSpawn(absX, absY)) {
                            continue;
                        }
                        const relX = anchorX - island.x;
                        const relY = anchorY - island.y;
                        const overlap = island.buildings.some(b => {
                            const bx = b.x || 0;
                            const by = b.y || 0;
                            return Math.hypot(bx - relX, by - relY) < 80;
                        });
                        if (overlap) {
                            continue;
                        }
                        targetX = relX;
                        targetY = relY;
                        valid = true;
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        const innerRadius = Math.max(0, island.radius - 15);
                        const tx = Math.cos(angle) * innerRadius;
                        const ty = Math.sin(angle) * innerRadius;
                        const absX = island.x + tx;
                        const absY = island.y + ty;
                        if (!hasDockWaterSpawn(absX, absY)) {
                            continue;
                        }
                        const overlap = island.buildings.some(b => {
                            const bx = b.x || 0;
                            const by = b.y || 0;
                            return Math.hypot(bx - tx, by - ty) < 80;
                        });
                        if (overlap) {
                            continue;
                        }
                        targetX = tx;
                        targetY = ty;
                        valid = true;
                    }
                }
                if (!valid) return false;
            } else {
                let valid = false;
                let attempts = 0;
                while (!valid && attempts < 50) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * (island.radius); // Full radius scan
                    const tx = Math.cos(angle) * dist;
                    const ty = Math.sin(angle) * dist;
                    
                    const absX = island.x + tx;
                    const absY = island.y + ty;

                    let isSafe = true;

                    if (island.points) {
                        if (!MapGenerator.isPointInPolygon(absX, absY, island.points)) {
                            isSafe = false;
                        } else {
                            const closest = MapGenerator.getClosestPointOnPolygon(absX, absY, island.points);
                            if (Math.hypot(absX - closest.x, absY - closest.y) < 60) isSafe = false;
                        }
                    } else {
                        if (dist > Math.max(0, island.radius - 60)) isSafe = false;
                    }
                    
                    if (isSafe) {
                        // Check building overlap
                        const overlap = island.buildings.some(b => {
                            const bx = b.x || 0;
                            const by = b.y || 0;
                            return Math.hypot(bx - tx, by - ty) < 80;
                        });
                        if (overlap) isSafe = false;
                    }

                    if (isSafe) {
                        targetX = tx;
                        targetY = ty;
                        valid = true;
                    }
                    attempts++;
                }
            }
            
            // Check if player has ANY Builder unit (Global check)
            const hasBuilder = this.units.some(u => 
                u.ownerId === playerId && 
                u.type === 'builder'
            );
            
            if (!hasBuilder) return false;
        }

        // Deduct cost
        player.resources.gold -= stats.cost.gold;
        player.resources.oil -= stats.cost.oil;

        const buildingId = `bld_${Date.now()}_${Math.random()}`;
        
        if (type === 'oil_well') {
             const targetId = (stats as any).targetOilSpotId;
             if (targetId) {
                 const spot = this.map.oilSpots.find(s => s.id === targetId);
                 if (spot) {
                    // Link spot to this well so oil income is counted like rigs
                    (spot as any).ownerId = playerId;
                    (spot as any).building = {
                        id: buildingId,
                        type: 'oil_well',
                        level: 1,
                        health: 1,
                        maxHealth: stats.maxHealth,
                        isConstructing: true,
                        constructionProgress: 0,
                        range: stats.range
                    };
                    spot.occupiedBy = buildingId;
                     // Snap to spot (relative to island)
                     targetX = spot.x - island.x;
                     targetY = spot.y - island.y;
                     
                     // PERMANENT REVEAL: Change ID so client renders it always
                     if (spot.id.startsWith('hidden_oil_')) {
                         spot.id = spot.id.replace('hidden_oil_', 'oil_revealed_');
                     }
                 }
             }
        }

        if (type === 'mine') {
             // If manual, find closest gold spot?
             let freeSpot: any = null;
             if (x !== undefined && y !== undefined) {
                 // Closest check
                 let minSpotDist = Infinity;
                 for (const s of island.goldSpots) {
                    if (!s.occupiedBy) {
                        const d = Math.hypot(s.x - targetX, s.y - targetY);
                        if (d < 100 && d < minSpotDist) {
                            minSpotDist = d;
                            freeSpot = s;
                        }
                    }
                 }
             } else {
                 freeSpot = island.goldSpots.find(s => !s.occupiedBy);
             }
             
             if (!freeSpot) {
                 // Refund
                 player.resources.gold += stats.cost.gold;
                 player.resources.oil += stats.cost.oil;
                 return false;
             }
             freeSpot.occupiedBy = buildingId;
             // Snap to spot
             targetX = freeSpot.x;
             targetY = freeSpot.y;
        }

        const isInstant = ((type as string) === 'barracks' || (type as string) === 'base');
        // console.log(`Building constructed: ${type} at ${targetX},${targetY}. Instant? ${isInstant}`);

        island.buildings.push({
          id: buildingId,
          type,
          level: 1,
          health: isInstant ? stats.maxHealth : 1, // Start full for barracks/base as requested
          maxHealth: stats.maxHealth,
          x: targetX,
          y: targetY,
          isConstructing: !isInstant, // Barracks/Base instant for now to fix user issue
          constructionProgress: isInstant ? stats.maxHealth : 0,
          ownerId: playerId, // Assign ownership
          range: stats.range
        });

        // Command closest builder to move to construction site
        const finalAbsX = island.x + targetX;
        const finalAbsY = island.y + targetY;
        
        let closestBuilder: Unit | null = null;
        let minDist = Infinity;

        this.units.forEach(u => {
            if (u.ownerId === playerId && u.type === 'builder') {
                const d = Math.hypot(u.x - finalAbsX, u.y - finalAbsY);
                if (d < minDist) {
                    minDist = d;
                    closestBuilder = u;
                }
            }
        });

        if (closestBuilder) {
            this.moveUnitsToPosition(playerId, [(closestBuilder as Unit).id], finalAbsX, finalAbsY);
        }

        return true;
    } else if (oilSpot) {
        if (type !== 'oil_rig') return false; 
        if (oilSpot.occupiedBy) return false; 
        
        // STRICT VALIDATION: Ensure it is NOT a Land Oil Spot
        if (oilSpot.id.startsWith('hidden_oil_') || oilSpot.id.startsWith('oil_revealed_')) return false;

        // Check for Construction Ship nearby
        const hasConstructionShip = this.units.some(u => 
            u.ownerId === playerId && 
            u.type === 'construction_ship' &&
            Math.hypot(u.x - oilSpot!.x, u.y - oilSpot!.y) < 150 // Range check
        );

        if (!hasConstructionShip) return false;

        // Check if any other oil rig is too close (Hitbox check)
        // User wants to prevent placing them "ontop of eachother or super close"
        const tooClose = this.map.oilSpots.some(other => 
            other.id !== oilSpot!.id && // Not this one
            other.occupiedBy && // Has a rig
            Math.hypot(other.x - oilSpot!.x, other.y - oilSpot!.y) < 80 // Distance threshold
        );
        
        if (tooClose) return false;
        
        player.resources.gold -= stats.cost.gold;
        player.resources.oil -= stats.cost.oil;

        (oilSpot as any).ownerId = playerId;
        (oilSpot as any).building = {
            id: `bld_${Date.now()}_${Math.random()}`,
            type: 'oil_rig',
            level: 1,
            health: 1,
            maxHealth: stats.maxHealth,
            isConstructing: true,
            constructionProgress: 0
        };
        oilSpot.occupiedBy = (oilSpot as any).building.id;
        
        return true;
    }

    return false;
  }

  handleUseAbility(playerId: string, unitId: string, ability: string, io: any) {
      const unit = this.units.find(u => u.id === unitId);
      if (!unit || unit.ownerId !== playerId) return;

      if (ability === 'reveal_oil' && unit.type === 'oil_seeker') {
          // Check cooldown
          const now = Date.now();
          if (unit.abilityCooldown && now < unit.abilityCooldown) return;

          // Set cooldown (30s)
          unit.abilityCooldown = now + 30000;

          // Calculate massive range (1/4 of map)
          const range = Math.max(this.map.width, this.map.height) / 4;
          const revealedIds: string[] = [];
          
          this.map.oilSpots.forEach(spot => {
              if (Math.hypot(spot.x - unit.x, spot.y - unit.y) <= range) {
                  revealedIds.push(spot.id);
              }
          });

          // Emit event to player
          io.to(playerId).emit('abilityEffect', {
              type: 'reveal_oil',
              unitId: unit.id,
              oilSpotIds: revealedIds,
              duration: 10000, // 10s
              range: range // Send range for visual feedback
          });
      }
  }

  recruitUnit(playerId: string, islandId: string, type: string, buildingId?: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    const island = this.map.islands.find(i => i.id === islandId);
    // If recruiting from Mothership, islandId might be just "current location" or irrelevant if we pass buildingId (Mothership ID)
    // But let's keep island validation if provided.
    
    // Ownership check: Strict for classic maps, relaxed for shared maps
    const isSharedMap = this.mapType === 'desert' || this.mapType === 'grasslands';
    if (island && !isSharedMap && island.ownerId !== playerId) return false;
    if (island && island.ownerId && island.ownerId !== playerId) return false;

    // Find source
    let sourceBuilding: any = undefined;
    
    if (buildingId) {
        // 1. Check buildings on island
        if (island) {
             sourceBuilding = island.buildings.find(b => b.id === buildingId);
        }
        // 2. Check units (Mothership)
        if (!sourceBuilding) {
            sourceBuilding = this.units.find(u => u.id === buildingId);
        }
    }

    if (sourceBuilding && sourceBuilding.ownerId && sourceBuilding.ownerId !== playerId) return false; // Not my building/unit

    if (buildingId && (!sourceBuilding || (sourceBuilding.isConstructing && !['mothership', 'aircraft_carrier'].includes(sourceBuilding.type)))) return false;

    const isInfantry = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(type);
    const isNaval = ['destroyer', 'construction_ship', 'ferry', 'aircraft_carrier'].includes(type);
    const isVehicle = ['tank', 'humvee', 'missile_launcher'].includes(type);
    const isAir = ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type);

    if (!sourceBuilding && island) {
      if (isNaval) {
        sourceBuilding = island.buildings.find(b => b.type === 'dock' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
      } else if (isVehicle) {
        sourceBuilding = island.buildings.find(b => b.type === 'tank_factory' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
      } else if (isAir) {
        sourceBuilding = island.buildings.find(b => b.type === 'air_base' && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
      } else {
        sourceBuilding = island.buildings.find(b => (b.type === 'barracks' || (type === 'builder' && b.type === 'base')) && !b.isConstructing && (!b.ownerId || b.ownerId === playerId));
      }
    }

    if (!sourceBuilding) return false;

    if (isNaval && sourceBuilding.type !== 'dock') return false;
    if (isVehicle && sourceBuilding.type !== 'tank_factory') return false;
    if (isAir && sourceBuilding.type !== 'air_base' && sourceBuilding.type !== 'mothership' && sourceBuilding.type !== 'aircraft_carrier') return false;
    if (isInfantry && !(sourceBuilding.type === 'barracks' || (type === 'builder' && sourceBuilding.type === 'base'))) return false;

    // Mothership restriction
    if (sourceBuilding.type === 'mothership') {
        if (!['alien_scout', 'heavy_alien', 'light_plane', 'heavy_plane'].includes(type)) return false;
    }

    // Air Carrier restriction
    if (sourceBuilding.type === 'aircraft_carrier') {
        if (!['light_plane', 'heavy_plane'].includes(type)) return false;
    }

    const stats = UnitData[type];
    if (!stats) return false;
    
    if (player.resources.gold < stats.cost.gold || player.resources.oil < stats.cost.oil) return false;

    player.resources.gold -= stats.cost.gold;
    player.resources.oil -= stats.cost.oil;

    if (sourceBuilding) {
       if (!sourceBuilding.recruitmentQueue) sourceBuilding.recruitmentQueue = [];
       
       if (sourceBuilding.recruitmentQueue.length >= 5) return false;

       // Add to queue
       sourceBuilding.recruitmentQueue.push({
           unitType: type,
           progress: 0,
           totalTime: stats.constructionTime || 100
       });
       return true;
    }
    
    return false;
  }

  spawnUnit(playerId: string, type: string, island: any, building: any) {
    const stats = UnitData[type];
    if (!stats) return;

    // Handle Unit-as-Building (Mothership)
    if (!island) {
        if (building && building.x !== undefined && building.y !== undefined) {
             // Check if source is a transport with capacity
             const canLoad = ['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(building.type);
             
             if (canLoad) {
                 // EXCEPTION: Mothership and Carrier recruiting Air units should spawn them OUTSIDE (launch them)
                 const isAirLaunch = (building.type === 'mothership' || building.type === 'aircraft_carrier') && 
                                     ['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(type);

                 if (!isAirLaunch) {
                     if (!building.cargo) building.cargo = [];
                     
                     let maxCapacity = 10;
                     if (building.type === 'humvee') maxCapacity = 4;
                     if (['aircraft_carrier', 'mothership'].includes(building.type)) maxCapacity = 20;

                     if (building.cargo.length < maxCapacity) {
                         // Add directly to cargo (skip world placement)
                         building.cargo.push({
                            id: `unit_${Date.now()}_${Math.random()}`,
                            ownerId: playerId,
                            type,
                            x: building.x, // Placeholder, will be updated on unload
                            y: building.y,
                            status: 'idle',
                            health: stats.health,
                            maxHealth: stats.maxHealth,
                            damage: stats.damage,
                            range: stats.range,
                            speed: stats.speed,
                            fireRate: stats.fireRate,
                            recruitmentQueue: [],
                            cargo: []
                        });
                        return;
                     }
                 }
             }

             // Spawn relative to the unit/building (fallback if full or not transport)
             const spawnX = building.x + (Math.random() - 0.5) * 50;
             const spawnY = building.y + (Math.random() - 0.5) * 50;
             
             this.units.push({
                id: `unit_${Date.now()}_${Math.random()}`,
                ownerId: playerId,
                type,
                x: spawnX,
                y: spawnY,
                status: 'idle',
                health: stats.health,
                maxHealth: stats.maxHealth,
                damage: stats.damage,
                range: stats.range,
                speed: stats.speed,
                fireRate: stats.fireRate
            });
            return;
        }
        return; // Invalid spawn
    }

    let spawnX = island.x;
    let spawnY = island.y;

    const bx = island.x + (building.x || 0);
    const by = island.y + (building.y || 0);
    
    const isNaval = ['destroyer', 'construction_ship', 'ferry'].includes(type);

    if (building.type === 'dock' && isNaval) {
      // Robust Water Search: Scan in expanding rings around the dock
      let foundWater = false;
      
      // Search radii: Start close, expand outward (Increased range for Carriers)
      const radii = [40, 60, 80, 100, 120, 150, 180, 200]; 
      
      // Try the "natural" direction first (center -> dock)
      const dx = bx - island.x;
      const dy = by - island.y;
      const naturalAngle = Math.atan2(dy, dx);
      
      // Angles to check: Natural direction first, then fan out
      // We'll check 8 directions (0, 45, 90...) + natural angle
      
      for (const r of radii) {
          if (foundWater) break;
          
          // Check natural direction first at this radius
          const nx = bx + Math.cos(naturalAngle) * r;
          const ny = by + Math.sin(naturalAngle) * r;
          if (this.isValidPosition(nx, ny, type)) {
              spawnX = nx;
              spawnY = ny;
              foundWater = true;
              break;
          }
          
          // Check 8 cardinal/intercardinal directions
          for (let i = 0; i < 8; i++) {
              const angle = (i / 8) * Math.PI * 2;
              const tx = bx + Math.cos(angle) * r;
              const ty = by + Math.sin(angle) * r;
              
              if (this.isValidPosition(tx, ty, type)) {
                  spawnX = tx;
                  spawnY = ty;
                  foundWater = true;
                  break;
              }
          }
      }
      
      if (!foundWater) {
          // Absolute fallback: Push outside the island polygon/radius
          if (island.points) {
               // Find closest point on the island edge from the dock
               const closest = MapGenerator.getClosestPointOnPolygon(bx, by, island.points);
               
               // Calculate vector from island center to that edge point to determine "outward" direction
               const dx = closest.x - island.x;
               const dy = closest.y - island.y;
               const len = Math.hypot(dx, dy) || 1;
               
               // Spawn 30px outside the edge
               spawnX = closest.x + (dx/len) * 30;
               spawnY = closest.y + (dy/len) * 30;
          } else {
               // Circle fallback: Push out to radius + 30
               const dx = bx - island.x;
               const dy = by - island.y;
               const len = Math.hypot(dx, dy) || 1;
               spawnX = island.x + (dx/len) * (island.radius + 30);
               spawnY = island.y + (dy/len) * (island.radius + 30);
          }
      }
    } else {
      // Try to find a valid spawn position around the building
      let foundSpot = false;
      const radius = 30; // Radius to search around building
      
      for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const tx = bx + Math.cos(angle) * radius;
          const ty = by + Math.sin(angle) * radius;
          
          if (this.isValidPosition(tx, ty, type)) {
              spawnX = tx;
              spawnY = ty;
              foundSpot = true;
              break;
          }
      }
      
      if (!foundSpot) {
          // Fallback: Spawn at building center (safe for builders as they ignore own building collision)
          spawnX = bx;
          spawnY = by;
      }
    }

    this.units.push({
      id: `unit_${Date.now()}_${Math.random()}`,
      ownerId: playerId,
      type,
      x: spawnX,
      y: spawnY,
      status: 'idle',
      health: stats.health,
      maxHealth: stats.maxHealth,
      damage: stats.damage,
      range: stats.range,
      speed: stats.speed,
      fireRate: stats.fireRate,
      recruitmentQueue: [],
      cargo: []
    });
  }

  moveUnits(playerId: string, unitIds: string[], targetIslandId: string) {
    const targetIsland = this.map.islands.find(i => i.id === targetIslandId);
    
    if (!targetIsland) return;

    unitIds.forEach(uid => {
      const unit = this.units.find(u => u.id === uid);
      if (unit && unit.ownerId === playerId) {
        const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder'].includes(unit.type);
        
        if (isLandUnit) {
            // Check if moving to a different island
            // Find current island
            const currentIsland = this.map.islands.find(i => {
                if (i.points) return MapGenerator.isPointInPolygon(unit.x, unit.y, i.points);
                return Math.hypot(unit.x - i.x, unit.y - i.y) <= i.radius + 30;
            });
            
            // Also check if currently on a bridge connected to the target

            if (currentIsland) {
                if (currentIsland.id !== targetIslandId) {
                    const tIsland = this.map.islands.find(i => i.id === targetIslandId);
                    // Check for overlap connection
                    let connectedByLand = false;
                    if (tIsland) {
                        const dist = Math.hypot(currentIsland.x - tIsland.x, currentIsland.y - tIsland.y);
                        connectedByLand = dist < (currentIsland.radius + tIsland.radius);
                    }

                    if (!connectedByLand) {
                        // Moving between islands: Must have a bridge
                        const hasBridge = this.map.bridges.some(b => 
                            b.type === 'bridge' &&
                            ((b.islandAId === currentIsland.id && b.islandBId === targetIslandId) ||
                             (b.islandAId === targetIslandId && b.islandBId === currentIsland.id))
                        );
                        
                        if (!hasBridge) {
                            // Block movement
                            unit.targetIslandId = undefined;
                            unit.status = 'idle';
                            return; 
                        }
                    }
                }
            } else {
                // Not on an island (presumably on a bridge or water)
                // If on a bridge, we should allow moving to either end.
                // We'll optimistically allow if we can find a bridge connecting to target, 
                // assuming the unit is on that bridge or a connected one.
                // But to be safe against water walking:
                const nearbyBridge = this.map.bridges.find(b => 
                    b.type === 'bridge' &&
                    // Simple distance check to bridge segment?
                    // Let's assume if not on island, and requesting move to island,
                    // we must be on a bridge connected to it.
                    (b.islandAId === targetIslandId || b.islandBId === targetIslandId)
                );
                
                if (!nearbyBridge) return; // Block if no bridge to target
            }
        }

        unit.targetIslandId = targetIslandId;
        unit.status = 'moving';
      }
    });
  }

  unloadCargo(playerId: string, carrierId: string) {
      const carrier = this.units.find(u => u.id === carrierId);
      if (!carrier || carrier.ownerId !== playerId) return;
      if (!carrier.cargo || carrier.cargo.length === 0) return;
      
      // Unload all
      carrier.cargo.forEach(u => {
          // Find valid spot around carrier
          // Try multiple times to find valid land spot
          let valid = false;
          let tx = carrier.x;
          let ty = carrier.y;

          for(let i=0; i<10; i++) {
              const angle = Math.random() * Math.PI * 2;
              const dist = 30 + Math.random() * 50;
              tx = carrier.x + Math.cos(angle) * dist;
              ty = carrier.y + Math.sin(angle) * dist;
              if (this.isValidPosition(tx, ty, u.type)) {
                  valid = true;
                  break;
              }
          }
          
          if (!valid) {
              // Fallback to carrier position (will be pushed by collision)
              tx = carrier.x;
              ty = carrier.y;
          }

          u.x = tx;
          u.y = ty;
          u.status = 'idle';
          this.units.push(u);
      });
      
      carrier.cargo = [];
  }

  cleanupDeadEntities() {
    // Remove dead units
    const initialCount = this.units.length;
    this.units = this.units.filter(u => {
        if (u.health <= 0) {
            // Check for cargo
            if (u.cargo && u.cargo.length > 0) {
                 console.log(`[Cleanup] Transport ${u.type} (${u.id}) destroyed with ${u.cargo.length} units inside.`);
                 u.cargo.forEach(c => console.log(`   - Cargo Lost: ${c.type} (${c.id})`));
            } else {
                 console.log(`[Cleanup] Removing dead unit: ${u.type} (${u.id}) Owner: ${u.ownerId} Health: ${u.health}`);
            }
            return false;
        }
        return true;
    });
    
    // Remove destroyed buildings
    this.map.islands.forEach(island => {
        island.buildings = island.buildings.filter(b => b.health > 0);
    });

    // Sync bots array with players array (Remove disconnected/stale bots)
    this.bots = this.bots.filter(b => this.players.has(b.playerId));
  }

  handleCheat(playerId: string, command: string, args: string[]): string {
      const player = this.players.get(playerId);
      if (!player) return 'Player not found';

      switch (command) {
          case 'gold':
              const gold = parseInt(args[0]);
              if (!isNaN(gold)) {
                  player.resources.gold += gold;
                  return `Added ${gold} Gold. Total: ${player.resources.gold}`;
              }
              return 'Invalid amount';
          
          case 'oil':
              const oil = parseInt(args[0]);
              if (!isNaN(oil)) {
                  player.resources.oil += oil;
                  return `Added ${oil} Oil. Total: ${player.resources.oil}`;
              }
              return 'Invalid amount';

          case 'setgold':
              const sGold = parseInt(args[0]);
              if (!isNaN(sGold)) {
                  player.resources.gold = sGold;
                  return `Set Gold to ${sGold}`;
              }
              return 'Invalid amount';

          case 'setoil':
              const sOil = parseInt(args[0]);
              if (!isNaN(sOil)) {
                  player.resources.oil = sOil;
                  return `Set Oil to ${sOil}`;
              }
              return 'Invalid amount';
            
          case 'god':
        case 'godmode':
            player.godMode = !player.godMode;
            // Also heal existing units if enabling
            if (player.godMode) {
                this.units.forEach(u => {
                    if (u.ownerId === playerId) {
                        u.health = u.maxHealth;
                    }
                });
                this.map.islands.forEach(i => {
                    i.buildings.forEach(b => {
                        if (b.ownerId === playerId) b.health = b.maxHealth;
                    });
                });
            }
            return `God Mode ${player.godMode ? 'ENABLED' : 'DISABLED'}`;

        case 'money':
        case 'cash':
             player.resources.gold += 10000;
             return `Added 10,000 Gold. Current: ${player.resources.gold}`;
 
        case 'fuel':
             player.resources.oil += 5000;
             return `Added 5,000 Oil. Current: ${player.resources.oil}`;

        case 'help':
        case 'list':
        case 'cheats':
            return 'Available Cheats: /gold [amt], /oil [amt], /setgold [amt], /setoil [amt], /god, /money, /fuel';

          default:
              return 'Unknown cheat command. Try /help or /cheats';
      }
  }

  moveUnitsToPosition(playerId: string, unitIds: string[], x: number, y: number) {
    // console.log(`[Move] Request from ${playerId} for ${unitIds.length} units to ${x},${y}`);

    // Check for Loading into Carrier/Mothership
    const targetCarrier = this.units.find(u => 
        ['aircraft_carrier', 'mothership', 'ferry', 'humvee'].includes(u.type) &&
        u.ownerId === playerId &&
        Math.hypot(u.x - x, u.y - y) < 60
    );

    if (targetCarrier) {
        // If the selection is ONLY the carrier itself, treat this as a move command, not a load command.
        // This allows moving the carrier small distances (clicking on/near itself).
        const isSelfClick = unitIds.length === 1 && unitIds[0] === targetCarrier.id;

        if (!isSelfClick) {
            // Attempt to load units
            const unitsToLoad = unitIds.map(id => this.units.find(u => u.id === id)).filter(u => u && u.ownerId === playerId) as Unit[];
            
            let loadedSomething = false;
            unitsToLoad.forEach(unit => {
                // Prevent loading into self
                if (unit.id === targetCarrier.id) return;

                const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unit.type);
                // Allow land units to load into carriers/ferries
                // Humvees can only carry soldiers/snipers/rocketeers
                if (targetCarrier.type === 'humvee' && !['soldier', 'sniper', 'rocketeer'].includes(unit.type)) return;

                if (!isLandUnit) return; 

                // Check capacity
                const capacity = targetCarrier.type === 'humvee' ? 4 : 20;
                if (!targetCarrier.cargo) targetCarrier.cargo = [];
                if (targetCarrier.cargo.length >= capacity) return;

                // Load
                targetCarrier.cargo.push(unit);
                
                // Remove from world
                const idx = this.units.findIndex(u => u.id === unit.id);
                if (idx !== -1) this.units.splice(idx, 1);
                loadedSomething = true;
            });
            
            // Only stop movement if we actually tried to load something (or if the intent was clearly loading)
            // If we selected a bunch of units and clicked a carrier, we assume loading.
            // If we selected a carrier AND other units, and clicked the carrier, we load the others. The carrier stays?
            // Existing logic returned immediately.
            return; 
        }
    }

    unitIds.forEach(uid => {
      const unit = this.units.find(u => u.id === uid);
      if (unit && unit.ownerId === playerId) {
        const adjusted = this.adjustTarget(unit.type, x, y);
        const isAirUnit = ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(unit.type);
        const isWaterUnit = ['ferry', 'construction_ship', 'destroyer', 'oil_tanker', 'aircraft_carrier'].includes(unit.type);
        const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unit.type);

        if (isAirUnit) {
            // Air units fly directly
            unit.targetX = adjusted.x;
            unit.targetY = adjusted.y;
            unit.targetIslandId = undefined;
            unit.status = 'moving';
            return;
        } 
        
        if (isWaterUnit) {
            unit.targetX = adjusted.x;
            unit.targetY = adjusted.y;
            unit.targetIslandId = undefined;
            unit.status = 'moving';
            return;
        }

        if (isLandUnit) {
             // Check if moving to a different island
             const currentIsland = this.map.islands.find(i => {
                 if (i.points) {
                     // Check if point is inside OR within buffer
                     if (MapGenerator.isPointInPolygon(unit.x, unit.y, i.points)) return true;
                     const closest = MapGenerator.getClosestPointOnPolygon(unit.x, unit.y, i.points);
                     return Math.hypot(unit.x - closest.x, unit.y - closest.y) < 40;
                 }
                 return Math.hypot(unit.x - i.x, unit.y - i.y) <= i.radius + 40;
             });
             const targetIsland = this.map.islands.find(i => {
                 if (i.points) {
                     if (MapGenerator.isPointInPolygon(adjusted.x, adjusted.y, i.points)) return true;
                     const closest = MapGenerator.getClosestPointOnPolygon(adjusted.x, adjusted.y, i.points);
                     return Math.hypot(adjusted.x - closest.x, adjusted.y - closest.y) < 40;
                 }
                 return Math.hypot(adjusted.x - i.x, adjusted.y - i.y) <= i.radius + 40;
             });

             if (unit.type === 'builder') {
                 // console.log(`[MoveDebug] Builder ${unit.id} on ${currentIsland?.id} target ${targetIsland?.id}`);
             }

             if (currentIsland && targetIsland && currentIsland.id !== targetIsland.id) {
                 // Moving between different islands
                 
                 // Check for overlap connection
                 const dist = Math.hypot(currentIsland.x - targetIsland.x, currentIsland.y - targetIsland.y);
                 const connectedByLand = dist < (currentIsland.radius + targetIsland.radius);

                 if (!connectedByLand) {
                     // Moving between different islands: Must have a bridge connecting them
                     const hasBridge = this.map.bridges.some(b => 
                         b.type === 'bridge' &&
                         ((b.islandAId === currentIsland.id && b.islandBId === targetIsland.id) ||
                          (b.islandAId === targetIsland.id && b.islandBId === currentIsland.id))
                     );
                     
                     if (!hasBridge) {
                        // If no bridge, move to the edge of the current island closest to the target
                        if (currentIsland.points) {
                            const closest = MapGenerator.getClosestPointOnPolygon(adjusted.x, adjusted.y, currentIsland.points);
                            const angle = Math.atan2(closest.y - currentIsland.y, closest.x - currentIsland.x);
                            unit.targetX = closest.x - Math.cos(angle) * 5;
                            unit.targetY = closest.y - Math.sin(angle) * 5;
                        } else {
                            const angle = Math.atan2(adjusted.y - currentIsland.y, adjusted.x - currentIsland.x);
                            unit.targetX = currentIsland.x + Math.cos(angle) * (currentIsland.radius - 10);
                            unit.targetY = currentIsland.y + Math.sin(angle) * (currentIsland.radius - 10);
                        }
                        unit.targetIslandId = undefined;
                        unit.status = 'moving';
                        return; 
                    }
                 }
             }

             // Handle Stuck Units (Not on island and not on bridge)
             // Only if NOT moving to a valid island (if we clicked land, just go there)
             if (!currentIsland && !targetIsland) {
                 const onBridge = this.isPointOnBridge(unit.x, unit.y);
                 if (!onBridge) {
                     // Fallback: If unit is stuck (not on island/bridge), allow it to move to closest island if close enough
                     const closestIsland = this.map.islands.find(i => Math.hypot(unit.x - i.x, unit.y - i.y) < i.radius + 60);
                     if (closestIsland) {
                         // Allow move to this island
                         const angle = Math.atan2(unit.y - closestIsland.y, unit.x - closestIsland.x);
                         unit.targetX = closestIsland.x + Math.cos(angle) * (closestIsland.radius - 10);
                         unit.targetY = closestIsland.y + Math.sin(angle) * (closestIsland.radius - 10);
                         unit.status = 'moving';
                         return;
                     }
                 }
             }
        }

        unit.targetX = adjusted.x;
        unit.targetY = adjusted.y;
        unit.targetIslandId = undefined; // Direct move
        unit.status = 'moving';

    if (!this.isValidPosition(adjusted.x, adjusted.y, unit.type)) {
             console.log(`[Move] WARNING: Target ${adjusted.x.toFixed(1)},${adjusted.y.toFixed(1)} is INVALID for ${unit.type}!`);
        } else {
             // console.log(`[Move] Unit ${unitIds[0]} moving to ${adjusted.x.toFixed(1)},${adjusted.y.toFixed(1)}`);
        }
      }
    });
  }

  handleMoveIntent(playerId: string, unitId: string, intentId: string, x: number, y: number) {
      const unit = this.units.find(u => u.id === unitId);
      if (!unit || unit.ownerId !== playerId) return;

      // Update Intent
      unit.intentId = intentId;

      // Reuse existing logic for target validation/setting
      this.moveUnitsToPosition(playerId, [unitId], x, y);
  }

  // handleMoveSteer removed (Steering logic deprecated)

  private logWallPair(
      playerId: string,
      nodeAId: string,
      nodeBId: string,
      type: 'bridge' | 'wall' | 'unknown',
      dist: number | null,
      maxDist: number | null,
      ok: boolean,
      reason: string
  ) {
      const distStr = dist !== null && !isNaN(dist) ? dist.toFixed(1) : 'NaN';
      const maxStr = maxDist !== null && !isNaN(maxDist) ? maxDist.toFixed(1) : 'NaN';
      console.log(
          `[WALL_PAIR] bot=${playerId} type=${type} A=${nodeAId} B=${nodeBId} dist=${distStr} maxDist=${maxStr} ok=${ok} reason=${reason}`
      );
  }

  ensureWallLoop(ownerId: string, nodeIdsOrdered: string[]) {
      const player = this.players.get(ownerId);
      if (!player) {
          console.log(
              `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${nodeIdsOrdered.length} segs=0 created=0 failed=${nodeIdsOrdered.length} reason=NO_PLAYER`
          );
          return { createdCount: 0, existingCount: 0, failedCount: nodeIdsOrdered.length };
      }

      const nodeEntries: { node: any; island: any }[] = [];
      const seenIds = new Set<string>();

      this.map.islands.forEach(island => {
          island.buildings.forEach(b => {
              if (b.type === 'wall_node' && b.ownerId === ownerId && b.id && nodeIdsOrdered.includes(b.id)) {
                  if (!seenIds.has(b.id)) {
                      seenIds.add(b.id);
                      nodeEntries.push({ node: b, island });
                  }
              }
          });
      });

      if (nodeEntries.length < 2) {
          console.log(
              `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${nodeEntries.length} segs=0 created=0 failed=${nodeEntries.length} reason=INSUFFICIENT_NODES`
          );
          return { createdCount: 0, existingCount: 0, failedCount: nodeEntries.length };
      }

      let centerX = 0;
      let centerY = 0;
      let centerCount = 0;

      const baseIsland = this.map.islands.find(i =>
          i.buildings.some(b => b.type === 'base' && b.ownerId === ownerId)
      );
      if (baseIsland) {
          const base = baseIsland.buildings.find(b => b.type === 'base' && b.ownerId === ownerId);
          if (base) {
              centerX = baseIsland.x + (base.x || 0);
              centerY = baseIsland.y + (base.y || 0);
              centerCount = 1;
          }
      }

      if (centerCount === 0) {
          nodeEntries.forEach(e => {
              centerX += e.island.x + (e.node.x || 0);
              centerY += e.island.y + (e.node.y || 0);
          });
          centerX /= nodeEntries.length;
          centerY /= nodeEntries.length;
      }

      const sorted = nodeEntries
          .map(e => {
              const wx = e.island.x + (e.node.x || 0);
              const wy = e.island.y + (e.node.y || 0);
              const angle = Math.atan2(wy - centerY, wx - centerX);
              return { node: e.node, island: e.island, angle };
          })
          .sort((a, b) => a.angle - b.angle);

      const orderedIds = sorted.map(s => s.node.id as string);
      console.log(
          `[WALL_LOOP_SET] bot=${ownerId} N=${orderedIds.length} center=${centerX.toFixed(1)},${centerY.toFixed(1)}`
      );

      let createdCount = 0;
      let existingCount = 0;
      let failedCount = 0;

      const expectedPairs: { a: string; b: string }[] = [];
      for (let i = 0; i < sorted.length; i++) {
          const current = sorted[i].node;
          const next = sorted[(i + 1) % sorted.length].node;
          if (current.id && next.id) expectedPairs.push({ a: current.id, b: next.id });
      }

      for (const p of expectedPairs) {
          const before = this.map.bridges.some(
              b =>
                  b.ownerId === ownerId &&
                  b.type === 'wall' &&
                  ((b.nodeAId === p.a && b.nodeBId === p.b) || (b.nodeAId === p.b && b.nodeBId === p.a))
          );

          this.connectNodes(ownerId, p.a, p.b);

          const after = this.map.bridges.some(
              b =>
                  b.ownerId === ownerId &&
                  b.type === 'wall' &&
                  ((b.nodeAId === p.a && b.nodeBId === p.b) || (b.nodeAId === p.b && b.nodeBId === p.a))
          );

          if (after && !before) {
              createdCount++;
          } else if (after && before) {
              existingCount++;
          } else {
              failedCount++;
          }
      }

      const segs = createdCount + existingCount;
      console.log(
          `[WALL_LOOP_RESULT] bot=${ownerId} nodes=${sorted.length} segs=${segs} created=${createdCount} failed=${failedCount}`
      );

      return { createdCount, existingCount, failedCount };
  }

  connectNodes(playerId: string, nodeAId: string, nodeBId: string) {
      const player = this.players.get(playerId);
      if (!player) {
          this.logWallPair(playerId, nodeAId, nodeBId, 'unknown', null, null, false, 'NO_PLAYER');
          return;
      }

      let nodeA: any, nodeB: any, islandA: any, islandB: any;
      
      this.map.islands.forEach(island => {
          const bA = island.buildings.find(b => b.id === nodeAId);
          if (bA) { nodeA = bA; islandA = island; }
          const bB = island.buildings.find(b => b.id === nodeBId);
          if (bB) { nodeB = bB; islandB = island; }
      });

      if (!nodeA || !nodeB || !islandA || !islandB) {
          this.logWallPair(playerId, nodeAId, nodeBId, 'unknown', null, null, false, 'INVALID_NODE');
          return;
      }
      
      const isBridge = nodeA.type === 'bridge_node' && nodeB.type === 'bridge_node';
      const isWall = nodeA.type === 'wall_node' && nodeB.type === 'wall_node';
      const type: 'bridge' | 'wall' = isBridge ? 'bridge' : 'wall';
      
      if (!isBridge && !isWall) {
          this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'INVALID_TYPE');
          return;
      }

      if (islandA.ownerId !== playerId && islandB.ownerId !== playerId) {
          this.logWallPair(playerId, nodeAId, nodeBId, type, null, null, false, 'NOT_OWNED');
          return;
      }

      const ax = islandA.x + (nodeA.x || 0);
      const ay = islandA.y + (nodeA.y || 0);
      const bx = islandB.x + (nodeB.x || 0);
      const by = islandB.y + (nodeB.y || 0);
      const dist = Math.hypot(ax - bx, ay - by);
      
      const maxDist = isBridge ? 800 : 999999;
      if (dist > maxDist) {
          console.log(
              `[WALL_LINK] player=${playerId} type=${type} a=${nodeAId} b=${nodeBId} dist=${dist.toFixed(
                  1
              )} maxAllowed=${maxDist} result=FAIL`
          );
          this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'TOO_FAR');
          return;
      }
      
      const costPerPx = isBridge ? 0.2 : 0.1;
      const cost = Math.floor(dist * costPerPx);
      
      if (player.resources.gold < cost) {
          this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'INSUFFICIENT_GOLD');
          return;
      }
      
      const existing = this.map.bridges.find(b => 
          (b.nodeAId === nodeAId && b.nodeBId === nodeBId) ||
          (b.nodeAId === nodeBId && b.nodeBId === nodeAId)
      );
      if (existing) {
          this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'ALREADY_CONNECTED');
          return;
      }

      // Intersection check (Segment-Segment)
      const intersect = (x1:number, y1:number, x2:number, y2:number, x3:number, y3:number, x4:number, y4:number) => {
          const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
          if (denom === 0) return false;
          const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
          const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
          // Strict intersection to allow shared endpoints
          return (ua > 0.01 && ua < 0.99) && (ub > 0.01 && ub < 0.99);
      };

      const overlap = this.map.bridges.some(b => {
          const iA = this.map.islands.find(i => i.id === b.islandAId);
          const iB = this.map.islands.find(i => i.id === b.islandBId);
          if (!iA || !iB) return false;
          const nA = iA.buildings.find(n => n.id === b.nodeAId);
          const nB = iB.buildings.find(n => n.id === b.nodeBId);
          if (!nA || !nB) return false;
          
          const pax = iA.x + (nA.x || 0);
          const pay = iA.y + (nA.y || 0);
          const pbx = iB.x + (nB.x || 0);
          const pby = iB.y + (nB.y || 0);
          
          return intersect(ax, ay, bx, by, pax, pay, pbx, pby);
      });
      
      if (overlap) {
          this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, false, 'SEGMENT_INTERSECTS');
          return;
      }

      player.resources.gold -= cost;

      this.map.bridges.push({
          id: `bridge_${Date.now()}_${Math.random()}`,
          type,
          nodeAId,
          nodeBId,
          islandAId: islandA.id,
          islandBId: islandB.id,
          ownerId: playerId,
          health: 500,
          maxHealth: 500
      });

      console.log(
          `[WALL_LINK] player=${playerId} type=${type} a=${nodeAId} b=${nodeBId} dist=${dist.toFixed(
              1
          )} maxAllowed=${maxDist} result=OK`
      );
      this.logWallPair(playerId, nodeAId, nodeBId, type, dist, maxDist, true, 'OK');

      // Clear path cache as connectivity changed
      if (this.pathCache) this.pathCache.clear();
  }

  convertWallToGate(playerId: string, nodeAId: string, nodeBId: string) {
      const bridge = this.map.bridges.find(b => 
          (b.nodeAId === nodeAId && b.nodeBId === nodeBId) ||
          (b.nodeAId === nodeBId && b.nodeBId === nodeAId)
      );
      
      if (!bridge || bridge.ownerId !== playerId) return;
      if (bridge.type !== 'wall') return; // Can only convert walls
      
      // Cost check? Let's say 50 gold to upgrade
      const player = this.players.get(playerId);
      if (!player || player.resources.gold < 50) return;
      
      player.resources.gold -= 50;
      bridge.type = 'gate';
  }

  // Pathfinding Cache
  private pathCache: Map<string, string[]> = new Map();

  findIslandPath(startIslandId: string, endIslandId: string): string[] | null {
      const cacheKey = `${startIslandId}-${endIslandId}`;
      if (this.pathCache.has(cacheKey)) {
          return this.pathCache.get(cacheKey)!;
      }

      // BFS
      const queue: { id: string, path: string[] }[] = [{ id: startIslandId, path: [startIslandId] }];
      const visited = new Set<string>();
      visited.add(startIslandId);

      while (queue.length > 0) {
          const { id, path } = queue.shift()!;
          if (id === endIslandId) {
              this.pathCache.set(cacheKey, path);
              return path;
          }

          const currentIsland = this.map.islands.find(i => i.id === id);
          if (!currentIsland) continue;

          // Find neighbors
          const neighbors: string[] = [];

          // 1. Connected by Bridge
          this.map.bridges.forEach(b => {
              if (b.type !== 'bridge' && b.type !== 'gate') return; // Only cross bridges/gates
              if (b.islandAId === id && !visited.has(b.islandBId)) neighbors.push(b.islandBId);
              if (b.islandBId === id && !visited.has(b.islandAId)) neighbors.push(b.islandAId);
          });

          // 2. Connected by Overlap (Land Connection)
          this.map.islands.forEach(other => {
              if (other.id === id) return;
              if (visited.has(other.id)) return;
              
              const dist = Math.hypot(currentIsland.x - other.x, currentIsland.y - other.y);
              if (dist < (currentIsland.radius + other.radius)) {
                  neighbors.push(other.id);
              }
          });

          for (const nid of neighbors) {
              if (!visited.has(nid)) {
                  visited.add(nid);
                  queue.push({ id: nid, path: [...path, nid] });
              }
          }
      }
      return null;
  }

  adjustTarget(unitType: string, targetX: number, targetY: number): { x: number, y: number } {
      // Safety check for NaN
      if (isNaN(targetX) || isNaN(targetY)) {
          return { x: 0, y: 0 }; // Default safe fallback
      }

      const isAirUnit = ['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(unitType);
      if (isAirUnit) {
          // Air units ignore obstacles and terrain snapping, just stay in bounds
          const clampedX = Math.max(0, Math.min(this.map.width, targetX));
          const clampedY = Math.max(0, Math.min(this.map.height, targetY));
          return { x: clampedX, y: clampedY };
      }

      // Check High Ground Collision (Obstacles) - Snap OUT of them
      if (this.map.highGrounds) {
          for (const hg of this.map.highGrounds) {
              if (MapGenerator.isPointInPolygon(targetX, targetY, hg.points)) {
                   // Snap to closest edge
                   const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, hg.points);
                   // Vector from obstacle center to point to push OUT
                   const angle = Math.atan2(closest.y - hg.y, closest.x - hg.x);
                   // Push out by 10px
                   targetX = closest.x + Math.cos(angle) * 10;
                   targetY = closest.y + Math.sin(angle) * 10;
                   break; // Handled
              }
          }
      }

      const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker', 'tank', 'humvee', 'missile_launcher'].includes(unitType);
      
      // Find closest island
      let closestIsland: Island | null = null;
      let minDist = Infinity;

      this.map.islands.forEach(island => {
          const dist = Math.hypot(targetX - island.x, targetY - island.y);
          const distToEdge = dist - island.radius;
          if (distToEdge < minDist) {
              minDist = distToEdge;
              closestIsland = island;
          }
      });

      if (!closestIsland) return { x: targetX, y: targetY }; // Should ideally snap to something

      // Check bridges for land units
      if (isLandUnit) {
          const onBridge = this.map.bridges.some(bridge => {
             if (bridge.type !== 'bridge') return false;
             
             const iA = this.map.islands.find(i => i.id === bridge.islandAId);
             const iB = this.map.islands.find(i => i.id === bridge.islandBId);
             if(!iA || !iB) return false;
             
             const nA = iA.buildings.find(b => b.id === bridge.nodeAId);
             const nB = iB.buildings.find(b => b.id === bridge.nodeBId);
             if(!nA || !nB) return false;

             const ax = iA.x + (nA.x || 0);
             const ay = iA.y + (nA.y || 0);
             const bx = iB.x + (nB.x || 0);
             const by = iB.y + (nB.y || 0);

             const l2 = (bx-ax)**2 + (by-ay)**2;
             if (l2 === 0) return false;
             let t = ((targetX-ax)*(bx-ax) + (targetY-ay)*(by-ay)) / l2;
             t = Math.max(0, Math.min(1, t));
             const px = ax + t * (bx - ax);
             const py = ay + t * (by - ay);
             
             const distToSegment = Math.hypot(targetX - px, targetY - py);
             return distToSegment < 25; // Bridge width/2 + margin
          });

          if (onBridge) return { x: targetX, y: targetY };
      }

      const island = closestIsland as Island;
      const dx = targetX - island.x;
      const dy = targetY - island.y;
      const distFromCenter = Math.hypot(dx, dy);

      if (isLandUnit) {
          // If on water (outside radius), snap to edge
          if (island.points) {
              if (!MapGenerator.isPointInPolygon(targetX, targetY, island.points)) {
                  const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, island.points);
                  const dist = Math.hypot(targetX - closest.x, targetY - closest.y);
                  
                  // Always snap to edge (pushed in slightly) if outside
                const angle = Math.atan2(closest.y - island.y, closest.x - island.x);
                return {
                    x: closest.x - Math.cos(angle) * 20,
                    y: closest.y - Math.sin(angle) * 20
                };
            }
        } else if (distFromCenter > island.radius) {
            const angle = Math.atan2(dy, dx);
            return {
                x: island.x + Math.cos(angle) * (island.radius - 20), 
                y: island.y + Math.sin(angle) * (island.radius - 20)
            };
        }
      } else {
          // Water units
          // If on land (inside radius), snap to edge
          if (island.points) {
               if (MapGenerator.isPointInPolygon(targetX, targetY, island.points)) {
                  const closest = MapGenerator.getClosestPointOnPolygon(targetX, targetY, island.points);
                  const angle = Math.atan2(closest.y - island.y, closest.x - island.x);
                  return {
                      x: closest.x + Math.cos(angle) * 15,
                      y: closest.y + Math.sin(angle) * 15
                  };
               }
          } else if (distFromCenter < island.radius) {
              const angle = Math.atan2(dy, dx);
              return {
                  x: island.x + Math.cos(angle) * (island.radius + 15), 
                  y: island.y + Math.sin(angle) * (island.radius + 15)
              };
          }
      }

      return { x: targetX, y: targetY };
  }

  // eliminatePlayer is now implemented near checkWinCondition

  applyUnitSeparation() {
      const getRadius = (type: string) => {
          if (type === 'mothership') return 60;
          if (type === 'aircraft_carrier') return 30;
          if (['tank', 'humvee', 'missile_launcher', 'heavy_plane', 'oil_rig'].includes(type)) return 20;
          return 15;
      };

      const getMass = (type: string) => {
          if (['oil_rig', 'oil_well'].includes(type)) return 10000; // Immovable
          if (['mothership', 'aircraft_carrier'].includes(type)) return 100;
          if (['tank', 'heavy_plane', 'destroyer', 'construction_ship'].includes(type)) return 40;
          if (['humvee', 'ferry', 'light_plane', 'missile_launcher'].includes(type)) return 20;
          return 10; // Infantry, etc.
      };

      // Soft Collision with Mass/Priority
      for (let i = 0; i < this.units.length; i++) {
          const u1 = this.units[i];
          
          // Static units (infinite mass) should not be pushed, but they can push others.
          const r1 = getRadius(u1.type);
          const m1 = getMass(u1.type);

          for (let j = i + 1; j < this.units.length; j++) {
              const u2 = this.units[j];
              const r2 = getRadius(u2.type);
              const m2 = getMass(u2.type);
              
              const separationRadius = r1 + r2; // Dynamic separation distance

              // Only collide land units with land units, ships with ships
              // Air units collide with air units
              const isU1Land = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'missile_launcher', 'oil_seeker'].includes(u1.type);
              const isU2Land = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'missile_launcher', 'oil_seeker'].includes(u2.type);
              
              const isU1Air = ['light_plane', 'heavy_plane', 'mothership'].includes(u1.type);
              const isU2Air = ['light_plane', 'heavy_plane', 'mothership'].includes(u2.type);

              const isU1Water = ['destroyer', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(u1.type);
              const isU2Water = ['destroyer', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(u2.type);

              // Check domain matching
              if (isU1Land && !isU2Land) continue;
              if (isU1Air && !isU2Air) continue;
              if (isU1Water && !isU2Water) continue;

              const distSq = (u1.x - u2.x) ** 2 + (u1.y - u2.y) ** 2;
              if (distSq < separationRadius ** 2 && distSq > 0.001) {
                  const dist = Math.sqrt(distSq);
                  let overlap = separationRadius - dist;
                  
                  // Softness factor: Allow slight overlap (e.g. 5px) before pushing
                  const SOFTNESS = 5.0;
                  if (overlap <= SOFTNESS) continue;
                  
                  // Apply push only on the excess overlap
                  // overlap -= SOFTNESS; // Optional: dampen the push, or just use full overlap but trigger later? 
                  // Spec says "can overlap slightly before strong push triggers". 
                  // Let's keep overlap as is but reduce strength if small? 
                  // Or just ignore if < softness. 
                  // Let's allow overlap up to 5px, and push based on full overlap to clear it? 
                  // No, if we allow 5px, we shouldn't push if < 5px.
                  // If > 5px, we push.
                  
                  // Push direction
                  const dx = (u1.x - u2.x) / dist;
                  const dy = (u1.y - u2.y) / dist;
                  
                  // Mass-based push (Soft Collision Rules)
                  const totalMass = m1 + m2;
                  const r1Ratio = m2 / totalMass; // Inverse mass ratio
                  const r2Ratio = m1 / totalMass;

                  // Tunable parameters
                  const PUSH_STRENGTH = 0.5; // Stronger push for responsiveness
                  const MAX_PUSH = 4.0;      // Higher cap to handle crowding

                  let push1 = overlap * r1Ratio * PUSH_STRENGTH;
                  let push2 = overlap * r2Ratio * PUSH_STRENGTH;

                  // Clamp push to avoid instability
                  push1 = Math.min(push1, MAX_PUSH);
                  push2 = Math.min(push2, MAX_PUSH);

                  // Apply to u1
                  if (m1 < 1000) { // Don't move static units
                      const nextX1 = u1.x + dx * push1;
                      const nextY1 = u1.y + dy * push1;
                      if (this.isValidPosition(nextX1, nextY1, u1.type)) {
                          u1.x = nextX1;
                          u1.y = nextY1;
                      }
                  }

                  // Apply to u2
                  if (m2 < 1000) {
                      const nextX2 = u2.x - dx * push2;
                      const nextY2 = u2.y - dy * push2;
                      if (this.isValidPosition(nextX2, nextY2, u2.type)) {
                          u2.x = nextX2;
                          u2.y = nextY2;
                      }
                  }
              }
          }
      }
  }

  resolveCombat(io: any, roomId: string) {
      // Range-based combat logic
      const now = Date.now();
      
      // Helper for Layer Logic
      const getLayer = (type: string) => {
          const stats = UnitData[type];
          if (stats && stats.height !== undefined) {
              if (stats.height === 2) return 'AIR_2';
              if (stats.height === 1) return 'AIR_1';
              return 'GROUND';
          }
          if (type === 'mothership') return 'AIR_2'; // Fallback
          if (['light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(type)) return 'AIR_1';
          return 'GROUND';
      };

      const canHit = (attackerType: string, targetType: string) => {
          const targetLayer = getLayer(targetType);
          const attackerLayer = getLayer(attackerType);

          // AIR_2 (Mothership) Rules
          if (targetLayer === 'AIR_2') {
              // Water units cannot hit High Air (Mothership) unless they have explicit anti-air
              if (['destroyer', 'construction_ship', 'ferry', 'aircraft_carrier', 'oil_tanker'].includes(attackerType)) {
                   // Check if attacker has AA capability (e.g. specialized ship?)
                   const stats = UnitData[attackerType];
                   if (stats && stats.canAttackAir) return true;
                   return false;
              }
              
              // Only Air units, AA units, Towers, and Bases can hit Mothership
              const isAA = ['missile_launcher', 'rocketeer'].includes(attackerType);
              const isAir = attackerLayer === 'AIR_1' || attackerLayer === 'AIR_2';
              const isDefense = ['tower', 'base'].includes(attackerType);
              
              if (isAA || isAir || isDefense) return true;
              
              // Check explicit canAttackAir
              const stats = UnitData[attackerType];
              if (stats && stats.canAttackAir) return true;

              return false;
          }
          
          return true;
      };

      this.units.forEach(attacker => {
          // Mothership Laser Logic
          if (attacker.type === 'mothership') {
              // Check if currently lasing
              if ((attacker as any).laserTargetId) {
                  const laserTargetId = (attacker as any).laserTargetId;
                  // Validate target exists
                  let targetUnit = this.units.find(u => u.id === laserTargetId);
                  let targetBuilding: any = null;
                  let targetIsland: any = null;

                  if (!targetUnit) {
                      for (const island of this.map.islands) {
                          const b = island.buildings.find(b => b.id === laserTargetId);
                          if (b) {
                              targetBuilding = b;
                              targetIsland = island;
                              break;
                          }
                      }
                      
                      if (!targetBuilding) {
                          const spot = this.map.oilSpots.find(s => s.occupiedBy === laserTargetId);
                          if (spot) {
                              targetBuilding = (spot as any).building;
                          }
                      }
                  }
                  
                  // Check if laser duration expired
                  if (now > ((attacker as any).laserEndTime || 0) || (!targetUnit && !targetBuilding)) {
                       // End Laser
                       (attacker as any).laserTargetId = null;
                       attacker.lastAttackTime = now; // Set cooldown after laser finishes
                  } else {
                      // Apply Damage Tick
                      if (now - ((attacker as any).lastLaserTick || 0) >= 100) { // 0.1s
                          (attacker as any).lastLaserTick = now;
                          const damage = 25;
                          
                          if (targetUnit) {
                              const targetOwner = this.players.get(targetUnit.ownerId);
                              if (!targetOwner?.godMode) {
                                  targetUnit.health -= damage;
                              }
                          } else if (targetBuilding) {
                              this.damageBuilding(targetBuilding, damage);
                              if (targetBuilding.health <= 0) {
                                  if (targetIsland) {
                                      targetIsland.buildings = targetIsland.buildings.filter((b: any) => b.id !== targetBuilding.id);
                                      if (targetBuilding.type === 'base' && targetBuilding.ownerId) {
                                          this.eliminatePlayer(targetBuilding.ownerId, 'HQ_DESTROYED');
                                      }
                                      if (targetBuilding.type === 'mine') {
                                           const spot = targetIsland.goldSpots.find((s: any) => s.occupiedBy === targetBuilding.id);
                                           if (spot) spot.occupiedBy = undefined;
                                      }
                                      if (targetBuilding.type === 'oil_rig' || targetBuilding.type === 'oil_well') {
                                           const spot = this.map.oilSpots.find(s => s.occupiedBy === targetBuilding.id);
                                           if (spot) {
                                                spot.occupiedBy = undefined;
                                                (spot as any).ownerId = undefined;
                                                (spot as any).building = undefined;
                                           }
                                      }
                                  } else {
                                      // Oil Rig/Well (No Island)
                                      if (targetBuilding.type === 'oil_rig' || targetBuilding.type === 'oil_well') {
                                           const spot = this.map.oilSpots.find(s => s.occupiedBy === targetBuilding.id);
                                           if (spot) {
                                                spot.occupiedBy = undefined;
                                                (spot as any).ownerId = undefined;
                                                (spot as any).building = undefined;
                                           }
                                      }
                                  }
                              }
                          }
                      }
                      return; // Skip normal attack
                  }
              }
          }

          // Cooldown check
          if (attacker.lastAttackTime && now - attacker.lastAttackTime < attacker.fireRate) return;
          
          // Safety: If unit has no damage (e.g. Builder), do not attack
          if (attacker.damage <= 0) return;

          const range = attacker.range;
          
          // Find enemies in range
          const enemies = this.units.filter(u => u.ownerId !== attacker.ownerId && u.health > 0);
          
          // Check buildings in range
          let buildingsInRange: any[] = [];
          this.map.islands.forEach(island => {
             island.buildings.forEach(b => {
                 if (b.ownerId && b.ownerId !== attacker.ownerId) {
                     const bx = island.x + (b.x || 0);
                     const by = island.y + (b.y || 0);
                     if (Math.hypot(bx - attacker.x, by - attacker.y) <= range) {
                         buildingsInRange.push({ ...b, realX: bx, realY: by, islandId: island.id });
                     }
                 }
             });
          });

          // Check Oil Rigs/Wells
          this.map.oilSpots.forEach(spot => {
              const b = (spot as any).building;
              if (b && (spot as any).ownerId && (spot as any).ownerId !== attacker.ownerId) {
                   if (Math.hypot(spot.x - attacker.x, spot.y - attacker.y) <= range) {
                       buildingsInRange.push({ ...b, realX: spot.x, realY: spot.y, isOilBuilding: true });
                   }
              }
          });

          // Filter enemies by range AND Layer
          let enemiesInRange = enemies.filter(u => 
              Math.hypot(u.x - attacker.x, u.y - attacker.y) <= range && 
              canHit(attacker.type, u.type)
          );
          
          if (attacker.type === 'missile_launcher') {
            enemiesInRange = []; // Missile Launcher cannot attack units
          }

          const targets = [...enemiesInRange, ...buildingsInRange];
          
          if (targets.length > 0) {
              // Find closest target
              const target = targets.reduce((closest, curr) => {
                  const tx = ('realX' in curr) ? curr.realX : curr.x;
                  const ty = ('realY' in curr) ? curr.realY : curr.y;
                  const dist = Math.hypot(tx - attacker.x, ty - attacker.y);
                  if (!closest || dist < closest.dist) return { t: curr, dist };
                  return closest;
              }, null as { t: any, dist: number } | null)?.t;

              if (attacker.type === 'mothership') {
                  // Initialize Laser
                  (attacker as any).laserTargetId = target.id;
                  (attacker as any).laserEndTime = now + 1000; // 1000ms duration
                  (attacker as any).lastLaserTick = now;
                  attacker.lastAttackTime = now; // Set cooldown
                  
                  const targetX = ('realX' in target) ? target.realX : target.x;
                  const targetY = ('realY' in target) ? target.realY : target.y;
                  
                  io.to(roomId).emit('laserBeam', {
                      attackerId: attacker.id,
                      targetId: target.id,
                      x1: attacker.x,
                      y1: attacker.y,
                      x2: targetX,
                      y2: targetY,
                      duration: 1000, // 1s beam
                      color: 0x0088FF // Brighter Blue
                  });
                return;
            }

            if (attacker.type === 'aircraft_carrier') {
                // Rocket Missile Attack (AoE)
                const targetX = ('realX' in target) ? target.realX : target.x;
                const targetY = ('realY' in target) ? target.realY : target.y;
                const speed = 600; 
                const aoeRadius = 150;
                const aoeDamage = attacker.damage;

                // Emit Projectile
                this.pendingProjectiles.push({
                    x1: attacker.x,
                    y1: attacker.y,
                    x2: targetX,
                    y2: targetY,
                    type: 'rocket_missile',
                    speed: speed
                });

                // Apply AoE Damage to Units
                this.units.forEach(u => {
                    if (u.ownerId !== attacker.ownerId && u.health > 0) {
                        const dist = Math.hypot(u.x - targetX, u.y - targetY);
                        if (dist <= aoeRadius) {
                             const targetOwner = this.players.get(u.ownerId);
                             if (!targetOwner?.godMode) {
                                 u.health -= aoeDamage;
                             }
                        }
                    }
                });

                // Apply AoE Damage to Buildings
                this.map.islands.forEach(island => {
                    island.buildings.forEach(b => {
                        if (b.ownerId && b.ownerId !== attacker.ownerId) {
                            const bx = island.x + (b.x || 0);
                            const by = island.y + (b.y || 0);
                            const dist = Math.hypot(bx - targetX, by - targetY);
                            if (dist <= aoeRadius) {
                                this.damageBuilding(b, aoeDamage);
                                if (b.health <= 0) {
                                     island.buildings = island.buildings.filter((build: any) => build.id !== b.id);
                                     if (b.type === 'base' && b.ownerId) {
                                         this.eliminatePlayer(b.ownerId, 'HQ_DESTROYED');
                                     }
                                     if (b.type === 'mine') {
                                         const spot = island.goldSpots.find((s: any) => s.occupiedBy === b.id);
                                         if (spot) spot.occupiedBy = undefined;
                                     }
                                     if (b.type === 'oil_rig' || b.type === 'oil_well') {
                                         const spot = this.map.oilSpots.find(s => s.occupiedBy === b.id);
                                         if (spot) {
                                              spot.occupiedBy = undefined;
                                              (spot as any).ownerId = undefined;
                                              (spot as any).building = undefined;
                                         }
                                     }
                                }
                            }
                        }
                    });
                });
                
                // Apply AoE Damage to Oil Spots (if not on island)
                 this.map.oilSpots.forEach(spot => {
                    const b = (spot as any).building;
                    if (b && (spot as any).ownerId && (spot as any).ownerId !== attacker.ownerId) {
                         const dist = Math.hypot(spot.x - targetX, spot.y - targetY);
                         if (dist <= aoeRadius) {
                             const targetOwner = this.players.get((spot as any).ownerId);
                             this.damageBuilding(b, aoeDamage);
                             if (b.health <= 0) {
                                  spot.occupiedBy = undefined;
                                  (spot as any).ownerId = undefined;
                                  (spot as any).building = undefined;
                             }
                         }
                    }
                });

                attacker.lastAttackTime = now;
                return;
            }

            // Emit Projectile
              const targetX = ('realX' in target) ? target.realX : target.x;
              const targetY = ('realY' in target) ? target.realY : target.y;
              this.pendingProjectiles.push({
                  x1: attacker.x,
                  y1: attacker.y,
                  x2: targetX,
                  y2: targetY,
                  type: 'bullet',
                  speed: 800
              });

              if ('realX' in target) { // It's a building copy
                  if (target.isOilBuilding) {
                       const spot = this.map.oilSpots.find(s => s.occupiedBy === target.id);
                       if (spot) {
                           const building = (spot as any).building;
                           if (building) {
                               const targetOwner = this.players.get((spot as any).ownerId || '');
                               this.damageBuilding(building, attacker.damage);
                               attacker.lastAttackTime = now;

                               if (building.health <= 0) {
                                   spot.occupiedBy = undefined;
                                   (spot as any).ownerId = undefined;
                                   (spot as any).building = undefined;
                               }
                           }
                       }
                  } else {
                      const island = this.map.islands.find(i => i.id === target.islandId);
                      if (island) {
                          const building = island.buildings.find(b => b.id === target.id);
                          if (building) {
                              this.damageBuilding(building, attacker.damage);
                              attacker.lastAttackTime = now;
                              
                              if (building.health <= 0) {
                                  island.buildings = island.buildings.filter(b => b.id !== building.id);
                                  if (building.type === 'base' && building.ownerId) {
                                      this.eliminatePlayer(building.ownerId, 'HQ_DESTROYED');
                                  }
                                  if (building.type === 'mine') {
                                      const spot = island.goldSpots.find(s => s.occupiedBy === building.id);
                                      if (spot) spot.occupiedBy = undefined;
                                  }
                              }
                          }
                      }
                  }
              } else { // Unit
                  const u = target as Unit;
                  const targetOwner = this.players.get(u.ownerId);
                  if (!targetOwner?.godMode) {
                      u.health -= attacker.damage;
                  }
                  attacker.lastAttackTime = now;
              }
          }
      });
      
      // Building Defenses (Towers/Base)
      this.map.islands.forEach(island => {
          island.buildings.forEach(b => {
              if (!b.ownerId) return;

              let stats = BuildingData[b.type];
              
              if (b.type === 'base' && b.hasTesla) {
                  stats = { ...stats, range: 400, damage: 100, fireRate: 500 };
              }

              if (stats && stats.damage && stats.range) {
                  if (b.lastAttackTime && now - b.lastAttackTime < (stats.fireRate || 1000)) return;
                  
                  const bx = island.x + (b.x || 0);
                  const by = island.y + (b.y || 0);
                  
                  // Priority: Units first, then Buildings
                  const enemies = this.units.filter(u => 
                      u.ownerId !== b.ownerId && 
                      Math.hypot(u.x - bx, u.y - by) <= stats.range! &&
                      canHit(b.type, u.type)
                  );
                  
                  const enemyBuildings: any[] = [];
                  this.map.islands.forEach(isl => {
                      isl.buildings.forEach(eb => {
                          if (eb.ownerId && eb.ownerId !== b.ownerId) {
                              const ebx = isl.x + (eb.x || 0);
                              const eby = isl.y + (eb.y || 0);
                              if (Math.hypot(ebx - bx, eby - by) <= stats.range! && canHit(b.type, eb.type)) {
                                  enemyBuildings.push({ ...eb, realX: ebx, realY: eby, islandId: isl.id });
                              }
                          }
                      });
                  });

                  this.map.oilSpots.forEach(spot => {
                      const eb = (spot as any).building;
                      if (eb && (spot as any).ownerId && (spot as any).ownerId !== b.ownerId) {
                           if (Math.hypot(spot.x - bx, spot.y - by) <= stats.range! && canHit(b.type, eb.type)) {
                               enemyBuildings.push({ ...eb, realX: spot.x, realY: spot.y, isOilBuilding: true });
                           }
                      }
                  });

                  // Priority Target Selection
                  let target: any = null;
                  if (enemies.length > 0) {
                      target = enemies[Math.floor(Math.random() * enemies.length)];
                  } else if (enemyBuildings.length > 0) {
                      target = enemyBuildings[Math.floor(Math.random() * enemyBuildings.length)];
                  }
                  
                  if (target) {
                      // Apply Damage
                      if ('realX' in target) { // Building
                          if (target.isOilBuilding) {
                               const spot = this.map.oilSpots.find(s => s.occupiedBy === target.id);
                               if (spot) {
                                   const tBuilding = (spot as any).building;
                                   if (tBuilding) {
                                       this.damageBuilding(tBuilding, stats.damage);
                                       if (tBuilding.health <= 0) {
                                           spot.occupiedBy = undefined;
                                           (spot as any).ownerId = undefined;
                                           (spot as any).building = undefined;
                                       }
                                   }
                               }
                          } else {
                              const tIsland = this.map.islands.find(i => i.id === target.islandId);
                              if (tIsland) {
                                  const tBuilding = tIsland.buildings.find(tb => tb.id === target.id);
                                  if (tBuilding) {
                                      this.damageBuilding(tBuilding, stats.damage);
                                      if (tBuilding.health <= 0) {
                                          tIsland.buildings = tIsland.buildings.filter(tb => tb.id !== tBuilding.id);
                                          if (tBuilding.type === 'base' && tBuilding.ownerId) {
                                              this.eliminatePlayer(tBuilding.ownerId, 'HQ_DESTROYED');
                                          }
                                          if (tBuilding.type === 'mine') {
                                              const spot = tIsland.goldSpots.find(s => s.occupiedBy === tBuilding.id);
                                              if (spot) spot.occupiedBy = undefined;
                                          }
                                      }
                                  }
                              }
                          }
                      } else { // Unit
                          const u = target as Unit;
                          const targetOwner = this.players.get(u.ownerId);
                          if (!targetOwner?.godMode) {
                              u.health -= stats.damage;
                          }
                      }

                      b.lastAttackTime = now;

                      const targetX = ('realX' in target) ? target.realX : target.x;
                      const targetY = ('realY' in target) ? target.realY : target.y;

                      io.to(roomId).emit('projectile', {
                          x1: bx,
                          y1: by,
                          x2: targetX,
                          y2: targetY,
                          type: (b.type === 'base' && b.hasTesla) ? 'tesla' : 'bullet',
                          speed: (b.type === 'base' && b.hasTesla) ? 1500 : 800
                      });
                  }
              }
          });
      });

      // Remove dead units
      this.units = this.units.filter(u => {
          if (u.health <= 0) {
              // If transport dies, log cargo loss
              if (u.cargo && u.cargo.length > 0) {
                   console.log(`[Death] Transport ${u.type} (${u.id}) destroyed with ${u.cargo.length} units inside.`);
                   u.cargo.forEach(c => console.log(`   - Cargo Lost: ${c.type} (${c.id})`));
              } else {
                   console.log(`[Death] Unit ${u.type} (${u.id}) died.`);
              }
              return false;
          }
          return true;
      });
  }

  loadUnits(playerId: string, transportId: string, unitIds: string[]) {
      const transport = this.units.find(u => u.id === transportId);
      if (!transport || transport.ownerId !== playerId) return;
      if (!['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(transport.type)) return;
      
      if (!transport.cargo) transport.cargo = [];

      unitIds.forEach(uid => {
          const unitIndex = this.units.findIndex(u => u.id === uid);
          if (unitIndex === -1) return;
          const unit = this.units[unitIndex];
          
          if (unit.ownerId !== playerId) return;
          
          const isInfantry = ['soldier', 'sniper', 'rocketeer', 'builder', 'oil_seeker'].includes(unit.type);
          const isVehicle = ['tank', 'humvee', 'missile_launcher'].includes(unit.type);

          if (['ferry', 'humvee'].includes(transport.type)) {
               if (!isInfantry) return;
          } else if (['aircraft_carrier', 'mothership'].includes(transport.type)) {
               // Carriers and Motherships can carry infantry and vehicles
               if (!isInfantry && !isVehicle) return;
          }

          // Check distance
          if (Math.hypot(unit.x - transport.x, unit.y - transport.y) > 100) return; // Must be close

          let maxCapacity = 10;
          if (transport.type === 'humvee') maxCapacity = 4;
          if (['aircraft_carrier', 'mothership'].includes(transport.type)) maxCapacity = 20;

          if (transport.cargo!.length >= maxCapacity) return; // Max capacity

          // Add to cargo
          transport.cargo!.push(unit);
          
          // Remove from world
          this.units.splice(unitIndex, 1);
      });
      
      // Update clients
      // We rely on the main loop emitting 'unitsData'
  }

  unloadUnits(playerId: string, transportId: string, targetX: number, targetY: number) {
      const transport = this.units.find(u => u.id === transportId);
      if (!transport || transport.ownerId !== playerId) return;
      if (!['ferry', 'humvee', 'aircraft_carrier', 'mothership'].includes(transport.type)) return;
      if (!transport.cargo || transport.cargo.length === 0) return;

      // Check range to target
      if (Math.hypot(targetX - transport.x, targetY - transport.y) > transport.range) return;

      // For air transports, we allow unloading at a distance (drop) but it must be valid land
      // For ground transports, target must be reachable?
      // Existing logic used 'soldier' check. We should check each unit type?
      // Or just check 'soldier' as a proxy for "is this land"?
      // Let's use 'tank' for vehicles if we want to be strict, but 'soldier' is generally fine for land check.
      // However, isValidPosition takes unit type for collision radius check.
      
      // We'll check the FIRST unit's validity as a proxy for the drop zone
      const sampleUnit = transport.cargo[0];
      const isValid = this.isValidPosition(targetX, targetY, sampleUnit.type);
      if (!isValid) {
          console.log(`[Unload] Failed: Invalid position for ${sampleUnit.type} at ${targetX},${targetY}`);
          return;
      }

      // ... existing bridge logic ...
      // We calculate isLand locally or assume if isValid is true and getBridgeAt is true, we might be on bridge.
      // Let's re-verify isLand to be safe, or just prefer bridge spread if on bridge.
      // If we are on an island, bridge spread is still safe (just linear).
      // But let's check strict bridge-only case if possible.
      // Re-using logic from isValidPosition:
      const closestIsland = this.map.islands.reduce((closest, island) => {
          const dist = Math.hypot(targetX - island.x, targetY - island.y) - island.radius;
          if (!closest || dist < closest.dist) return { island, dist };
          return closest;
      }, null as { island: any, dist: number } | null);
      
      const isLand = closestIsland && closestIsland.dist <= 0;
      const bridgeInfo = !isLand ? this.getBridgeAt(targetX, targetY) : null;

      // Unload all
      const spread = 20;
      transport.cargo.forEach((unit) => {
          if (bridgeInfo) {
               // Constrain spread to bridge axis
               const dx = bridgeInfo.end.x - bridgeInfo.start.x;
               const dy = bridgeInfo.end.y - bridgeInfo.start.y;
               const len = Math.hypot(dx, dy);
               if (len > 0) {
                   const nx = dx / len;
                   const ny = dy / len;
                   
                   // Spread along length
                   const longSpread = (Math.random() - 0.5) * spread * 2;
                   // Spread across width (keep it tight, bridge is ~50 wide, use +/- 10 safe zone)
                   const wideSpread = (Math.random() - 0.5) * 15;

                   // Perpendicular vector (-ny, nx)
                   unit.x = targetX + (nx * longSpread) + (-ny * wideSpread);
                   unit.y = targetY + (ny * longSpread) + (nx * wideSpread);
               } else {
                   unit.x = targetX;
                   unit.y = targetY;
               }
          } else {
               unit.x = targetX + (Math.random() - 0.5) * spread;
               unit.y = targetY + (Math.random() - 0.5) * spread;
          }

          unit.status = 'idle';
          unit.targetX = undefined;
          unit.targetY = undefined;
          this.units.push(unit);
      });
      
      transport.cargo = [];
  }

  deleteEntities(playerId: string, entityIds: string[]) {
      entityIds.forEach(id => {
          // 1. Try to find and delete unit
          const unitIndex = this.units.findIndex(u => u.id === id);
          if (unitIndex !== -1) {
              const unit = this.units[unitIndex];
              if (unit.ownerId === playerId) {
                  this.units.splice(unitIndex, 1);
                  return;
              }
          }

          // 2. Try to find and delete building
          for (const island of this.map.islands) {
              const bIndex = island.buildings.findIndex(b => b.id === id);
              if (bIndex !== -1) {
                  const building = island.buildings[bIndex];
                  if (building.ownerId === playerId) {
                      // Anti-Exploit: HQ Deletion Rules
                      if (building.type === 'base') {
                          const elapsed = Date.now() - this.startTime;
                          if (elapsed < 60000) {
                              // < 60s: Disallow delete with warning
                              if (this.io && this.roomId) {
                                  // Send system message to player
                                  const socket = Array.from(this.io.sockets.sockets.values()).find((s: any) => s.id === playerId) as any;
                                  if (socket) {
                                      socket.emit('chat_message', {
                                          sender: 'System',
                                          content: '⚠️ HQ cannot be sold/deleted in the first 60 seconds!',
                                          timestamp: Date.now()
                                      });
                                  }
                              }
                              return; // Skip deletion
                          } else {
                              // > 60s: Allow delete -> Immediate Defeat
                              const player = this.players.get(playerId);
                              if (player) {
                                  player.canBuildHQ = false;
                                  // Trigger elimination (with specific reason)
                                  this.eliminatePlayer(playerId, 'HQ_SELF_DELETED');
                              }
                          }
                      }

                      island.buildings.splice(bIndex, 1);
                      
                      // If it was a mine, free the gold spot
                      if (building.type === 'mine') {
                          const spot = island.goldSpots.find(s => s.occupiedBy === id);
                          if (spot) spot.occupiedBy = undefined;
                      }
                      
                      // If it was an oil rig, free the oil spot
                      if (building.type === 'oil_rig' || building.type === 'oil_well') {
                           const spot = this.map.oilSpots.find(s => s.occupiedBy === id);
                           if (spot) {
                               spot.occupiedBy = undefined;
                               (spot as any).ownerId = undefined;
                               (spot as any).building = undefined;
                           }
                      }
                      return;
                  }
              }
          }

          // 3. Try to find and delete wall/bridge
          if (this.map.bridges) {
              const wIndex = this.map.bridges.findIndex(b => b.id === id);
              if (wIndex !== -1) {
                  const bridge = this.map.bridges[wIndex];
                  if (bridge.ownerId === playerId) {
                      this.map.bridges.splice(wIndex, 1);
                      if ((this as any).pathCache) (this as any).pathCache.clear();
                      return;
                  }
              }
          }
      });
  }

  checkIslandCapture() {
      this.map.islands.forEach(island => {
          // Find units on this island
          const occupiers = this.units.filter(u => {
               if (island.points) return MapGenerator.isPointInPolygon(u.x, u.y, island.points);
               const dist = Math.hypot(u.x - island.x, u.y - island.y);
               return dist <= island.radius;
          });
          
          if (occupiers.length === 0) return;

          const owners = new Set(occupiers.map(u => u.ownerId));
          
          if (owners.size > 1) return; // Contested
          
          const occupierId = occupiers[0].ownerId;
          
          if (island.ownerId === occupierId) return;
          
          // Check for defenses
          const defenses = island.buildings.filter(b => b.type === 'tower' || b.type === 'base');
          if (defenses.length > 0) return;
          
          // Capture
          island.ownerId = occupierId;
      });
  }

  checkMatchEnd() {
      // Wait for game to settle (e.g. 10 seconds after start)
      if (Date.now() - this.startTime < 10000) return;
      if (this.matchState === 'ENDED') return;

      // Count active players (not eliminated)
      const activePlayers = Array.from(this.players.values()).filter(p => p.status !== 'eliminated');
      
      // If only 1 player remains (and there were originally > 1)
      if (activePlayers.length <= 1 && this.players.size > 1) {
          const winner = activePlayers[0];
          this.matchState = 'ENDED';
          this.winnerId = winner ? winner.id : null;
          this.endReason = 'ALL_ENEMIES_DEFEATED';
          
          console.log(`Match Ended! Winner: ${this.winnerId}`);
          
          if (this.io && this.roomId) {
              const payload = { 
                  winnerPlayerId: this.winnerId,
                  eliminatedPlayerIds: Array.from(this.eliminatedPlayerIds),
                  endReason: this.endReason,
                  timestamp: Date.now()
              };
              
              // Emit legacy event for compatibility if needed
              this.io.to(this.roomId).emit('gameOver', { 
                  winnerId: this.winnerId,
                  reason: 'elimination'
              });

              // Emit new authoritative event
              this.io.to(this.roomId).emit('MATCH_ENDED', payload);
              
              this.stopGameLoop();
          }
      } else if (activePlayers.length === 0 && this.players.size > 0) {
          // Draw / Everyone died?
          this.matchState = 'ENDED';
          this.endReason = 'ALL_ENEMIES_DEFEATED'; // or DRAW?
          console.log(`Match Ended! Draw.`);
          if (this.io && this.roomId) {
               const payload = { 
                  winnerPlayerId: null,
                  eliminatedPlayerIds: Array.from(this.eliminatedPlayerIds),
                  endReason: this.endReason,
                  timestamp: Date.now()
              };

               this.io.to(this.roomId).emit('gameOver', { 
                  winnerId: null,
                  reason: 'draw'
               });
               
               this.io.to(this.roomId).emit('MATCH_ENDED', payload);

               this.stopGameLoop();
          }
      }
  }

  eliminatePlayer(playerId: string, reason: string = 'HQ_DESTROYED') {
      const player = this.players.get(playerId);
      if (player && player.status !== 'eliminated') {
          player.status = 'eliminated';
          player.canBuildHQ = false;
          this.eliminatedPlayerIds.add(playerId);
          console.log(`Player ${playerId} eliminated! Reason: ${reason}`);
          
          // Check if this elimination triggers match end
          this.checkMatchEnd();
          
          if (this.matchState !== 'ENDED') {
               // If match is still running, emit just the elimination event
               if (this.io && this.roomId) {
                   this.io.to(this.roomId).emit('playerEliminated', { playerId, reason });
               }
          }

          // Mark all units as dead/neutral or delete them?
          // Usually better to delete or make neutral. Let's delete for now to clear clutter.
          this.units = this.units.filter(u => u.ownerId !== playerId);
          
          // Buildings remain but might be capturable or just inert?
          // For now, let's leave buildings (ruins) or clear them?
          // Existing logic in 'deleteEntities' does some cleanup, but let's keep buildings as "rubble" or unowned?
          // Actually, 'eliminatePlayer' is called when Base is destroyed.
          // Let's clear ownership of remaining buildings so others can capture/destroy.
          this.map.islands.forEach(island => {
              if (island.ownerId === playerId) island.ownerId = undefined;
              island.buildings.forEach(b => {
                  if (b.ownerId === playerId) {
                       // b.ownerId = undefined; // Make neutral? Or keep ownership for stats?
                       // If neutral, towers stop shooting.
                       b.ownerId = undefined;
                  }
              });
          });

          // Clear Oil Spots
          this.map.oilSpots.forEach(spot => {
              if ((spot as any).ownerId === playerId) {
                  (spot as any).ownerId = undefined;
                  (spot as any).building = undefined;
                  spot.occupiedBy = undefined;
              }
          });
          
          // If Bot, stop AI
          const botIndex = this.bots.findIndex(b => b.playerId === playerId);
          if (botIndex !== -1) {
              this.bots.splice(botIndex, 1);
          }
      }
  }

  isPointOnBridge(x: number, y: number): boolean {
      return !!this.getBridgeAt(x, y);
  }

  getBridgeAt(x: number, y: number): { bridge: any, start: {x:number, y:number}, end: {x:number, y:number} } | null {
      if (!this.map.bridges) return null;
      
      for (const bridge of this.map.bridges) {
          if (bridge.type !== 'bridge') continue;
          
          const iA = this.map.islands.find(i => i.id === bridge.islandAId);
          const iB = this.map.islands.find(i => i.id === bridge.islandBId);
          if(!iA || !iB) continue;
          
          const nA = iA.buildings.find(b => b.id === bridge.nodeAId);
          const nB = iB.buildings.find(b => b.id === bridge.nodeBId);
          if(!nA || !nB) continue;

          const ax = iA.x + (nA.x || 0);
          const ay = iA.y + (nA.y || 0);
          const bx = iB.x + (nB.x || 0);
          const by = iB.y + (nB.y || 0);

          const closest = MapGenerator.getClosestPointOnSegment(x, y, ax, ay, bx, by);
          const distToSegment = Math.hypot(x - closest.x, y - closest.y);
          if (distToSegment < 25) { // Bridge width/2 + margin
              return { bridge, start: {x: ax, y: ay}, end: {x: bx, y: by} };
          }
      }
      return null;
  }

  // Helper to check if position is valid for unit type
  isValidPosition(x: number, y: number, type: string): boolean {
      // Map Boundary Check
      if (x < 0 || x > this.map.width || y < 0 || y > this.map.height) {
          if (type === 'builder') console.log(`[ValidPos] Builder OUT OF BOUNDS: ${x},${y}`);
          return false;
      }

      // Check High Ground Collision (Obstacles)
      const isAirUnit = ['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type);
      if (this.map.highGrounds && !isAirUnit) {
          for (const hg of this.map.highGrounds) {
              if (MapGenerator.isPointInPolygon(x, y, hg.points)) {
                  if (type === 'builder') console.log(`[ValidPos] Builder HIT HIGH GROUND: ${x},${y}`);
                  return false; // Blocked for everyone
              }
          }
      }

      let isLand = false;
      
      for (const island of this.map.islands) {
          if (island.points) {
              // Add buffer for movement to prevent getting stuck on edges
              // Check if point is inside OR within small distance of edge
              if (MapGenerator.isPointInPolygon(x, y, island.points)) {
                  isLand = true;
                  break;
              }
              // Buffer check (expensive but necessary for smooth movement near edges)
              const closest = MapGenerator.getClosestPointOnPolygon(x, y, island.points);
              if (Math.hypot(x - closest.x, y - closest.y) < 1) { // Strict tolerance for invisible walls
                  isLand = true;
                  break;
              }
          } else {
              if (Math.hypot(x - island.x, y - island.y) <= island.radius) { // Strict radius
                  isLand = true;
                  break;
              }
          }
      }

      if (type === 'soldier' || type === 'sniper' || type === 'rocketeer' || type === 'builder' || type === 'oil_seeker' || type === 'tank' || type === 'humvee' || type === 'missile_launcher') {
          // Building Collision Check for Land Units
          // Find the island we are on (or moving to)
          const currentIsland = this.map.islands.find(i => {
             if (i.points) return MapGenerator.isPointInPolygon(x, y, i.points);
             return Math.hypot(x - i.x, y - i.y) <= i.radius + 15;
          });

          if (currentIsland) {
               // Check collision with buildings
               // Farm radius is 30. Most buildings are ~30-40.
               // We use a safe collision radius of 25 to prevent walking through center but allow getting close.
               const hitBuilding = currentIsland.buildings.some(b => {
                   if (b.type === 'bridge_node' || b.type === 'wall_node') return false; // Ignore nodes for now (or walls might need specific logic)
                   
                   // Base is larger (approx 50-60 radius visual)
                   // Farm is 30
                   // Others ~30
                   const bRadius = b.type === 'base' ? (type === 'builder' ? 40 : 50) : 30; 
                  // Relaxed buffer for builders to prevent getting stuck/spawn failure
                  const buffer = type === 'builder' ? 2 : 5; 
                   
                   // Allow Builders to walk through OWN buildings to prevent getting stuck
                   if (type === 'builder') return false;

                   return Math.hypot(x - (currentIsland.x + (b.x||0)), y - (currentIsland.y + (b.y||0))) < bRadius + buffer;
               });
               
               if (hitBuilding) {
                   if (type === 'builder') console.log(`[ValidPos] Builder HIT BUILDING on Island ${currentIsland.id}`);
                   return false;
               }
          }

          const onBridge = this.isPointOnBridge(x, y);
          if (!isLand && !onBridge) {
               if (type === 'builder') {
                   console.log(`[ValidPos] Builder IN WATER (Not Land, Not Bridge): ${x},${y}`);
                   const nearest = this.map.islands.map(i => ({
                       id: i.id,
                       dist: Math.hypot(x - i.x, y - i.y),
                       radius: i.radius,
                       hasPoints: !!i.points
                   })).sort((a,b) => a.dist - b.dist)[0];
                   console.log(`[ValidPos] Nearest Island: ${nearest.id} dist=${nearest.dist.toFixed(1)} rad=${nearest.radius} points=${nearest.hasPoints}`);
               }
               return false;
          }
          return true;
      } else if (['destroyer', 'construction_ship', 'ferry', 'oil_rig', 'aircraft_carrier'].includes(type)) {
          return !isLand;
      } else if (['light_plane', 'heavy_plane', 'mothership', 'alien_scout', 'heavy_alien'].includes(type)) {
          return true; // Air units can go anywhere
      }
      return true;
  }


  upgradeBuilding(playerId: string, buildingId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    for (const island of this.map.islands) {
        const building = island.buildings.find(b => b.id === buildingId);
        if (building) {
            if (building.ownerId !== playerId) return false;
            
            // Base Upgrade (Tier 2 / Tesla)
            if (building.type === 'base') {
                if (player.resources.gold >= 500) {
                    player.resources.gold -= 500;
                    building.maxHealth *= 2;
                    building.health = building.maxHealth; // Heal on upgrade? Sure
                    building.hasTesla = true;
                    building.level = (building.level || 1) + 1;
                    return true;
                }
            }
            // Add future upgrades here
            return false;
        }
    }
    return false;
  }

  startGameLoop(io: any, roomId: string) {
    this.io = io;
    this.roomId = roomId;
    this.lastTickTime = Date.now();
    // Run loop at 20 Hz (50ms)
    this.gameLoopInterval = setInterval(() => {
      if (this.gameEnded) return;

      if (this.status === 'voting') {
          if (Date.now() >= this.voteEndTime) {
              this.finalizeMapAndStart(io, roomId);
          } else {
              io.to(roomId).emit('votingUpdate', {
                  timeLeft: Math.max(0, this.voteEndTime - Date.now()),
                  votes: Array.from(this.mapVotes.entries())
              });
          }
          return;
      }

      if (this.status === 'waiting') {
          return;
      }

      const now = Date.now();
      const deltaTime = (now - this.lastTickTime) / 1000; // in seconds
      this.lastTickTime = now;

      // Debug movement
      // if (Math.random() < 0.05) {
      //     const mover = this.units.find(u => u.status === 'moving');
      //     if (mover) {
      //         console.log(`Unit ${mover.id} moving: speed=${mover.speed} dt=${deltaTime} pos=${mover.x.toFixed(1)},${mover.y.toFixed(1)} target=${mover.targetX},${mover.targetY}`);
      //     }
      // }

      // Bot Updates (Every tick, let bots throttle themselves)
      this.bots.forEach(bot => {
          try {
              bot.update(this);
          } catch (e) {
              console.error(`Bot ${bot.playerId} update failed:`, e);
          }
      });

      // Income Logic (Every 1 second approx)
      if (Math.floor(now / 1000) > Math.floor((now - 33) / 1000)) {
          this.players.forEach(player => {
            let goldIncome = 1; 
            let oilIncome = 0;

            this.map.oilSpots.forEach(spot => {
                if ((spot as any).ownerId === player.id && (spot as any).building && !(spot as any).building.isConstructing) {
                    if ((spot as any).building.type === 'oil_rig') {
                        goldIncome += 200; 
                        oilIncome += 5; 
                    } else if ((spot as any).building.type === 'oil_well') {
                        goldIncome += 200; // Same as Oil Rig
                        oilIncome += 5;    // Same as Oil Rig
                    } else {
                        oilIncome += 5;
                    }
                }
            });

            this.map.islands.forEach(island => {
                // Check if island is owned by player OR if it's a shared map/island with player's buildings
                
                if (island.ownerId === player.id) {
                    goldIncome += 1; // Island ownership bonus
                }

                island.buildings.forEach(b => {
                    if (b.ownerId !== player.id) return; // Only count player's buildings
                    if (b.isConstructing) return; 
                    if (b.type === 'mine') goldIncome += 50; 
                    if (b.type === 'base') goldIncome += 10;
                    if (b.type === 'farm') goldIncome += 25;
                    // Note: oil_well income (Gold+Oil) is handled in the oilSpots loop to match oil_rig logic
                });
            });

            player.resources.gold += goldIncome;
            player.resources.oil += oilIncome;
          });
      }

      // Construction Logic
    const processConstruction = (b: any, x: number, y: number, ownerId: string) => {
         if (b.isConstructing) {
             const stats = BuildingData[b.type];
             if (!stats) {
                 // Fallback if stats missing
                 console.log(`[Construction] Missing stats for ${b.type}, finishing instantly.`);
                 b.isConstructing = false;
                 b.health = b.maxHealth;
                 return;
             }

             // Speed up construction significantly (3x faster base speed)
             const totalTicks = stats.constructionTime || 100;
             let progressPerTick = (100 / totalTicks) * 3; 
             
             // Builder Boost
             // Ensure x/y are valid
             if (!isNaN(x) && !isNaN(y)) {
                 const builders = this.units.filter(u => 
                     u.ownerId === ownerId && 
                     (u.type === 'builder' || u.type === 'construction_ship') &&
                     Math.hypot(u.x - x, u.y - y) < 300 
                 );
                 
                 if (builders.length > 0) {
                     progressPerTick *= (1 + builders.length * 1.0); // 100% boost per builder (was 50%)
                 }
             }

             b.constructionProgress = (b.constructionProgress || 0) + progressPerTick;
             
             // Ensure health updates correctly
             const calculatedHealth = Math.floor(b.maxHealth * (b.constructionProgress / 100));
             b.health = Math.max(1, Math.min(b.maxHealth, calculatedHealth));
             
             // Debug log for stuck barracks
             // if (b.type === 'barracks' && Math.random() < 0.05) console.log(`[Construction] Barracks progress: ${b.constructionProgress.toFixed(1)}%, Health: ${b.health}`);

             if (b.constructionProgress >= 100) {
                 b.constructionProgress = 100;
                 b.isConstructing = false;
                 b.health = b.maxHealth;
             }
         }
    };

    // Repair Logic
    const processRepair = (b: any, x: number, y: number, ownerId: string) => {
        if (!b.isConstructing && b.health < b.maxHealth) {
             // Find nearby idle builders
             if (!isNaN(x) && !isNaN(y)) {
                 const builders = this.units.filter(u => 
                     u.ownerId === ownerId && 
                     u.type === 'builder' &&
                     u.status === 'idle' &&
                     Math.hypot(u.x - x, u.y - y) < 150 
                 );
                 
                 if (builders.length > 0) {
                     const count = Math.min(builders.length, 5); // Stack up to 5
                     // Repair rate: 0.5 HP per tick (15 HP/s) per builder
                     const repairAmount = 0.5 * count;
                     b.health = Math.min(b.maxHealth, b.health + repairAmount);
                 }
             }
        }
    };

      // Recruitment Logic
      const processRecruitment = (b: any, island: any) => {
          if (b.recruitmentQueue && b.recruitmentQueue.length > 0) {
              const item = b.recruitmentQueue[0];
              item.progress += 1;
              
              if (item.progress >= item.totalTime) {
                  // Prioritize building owner for unit ownership, fallback to island owner (legacy)
                  const ownerId = b.ownerId || (island ? island.ownerId : null);
                  if (ownerId) {
                      this.spawnUnit(ownerId, item.unitType, island, b);
                  }
                  b.recruitmentQueue.shift();
              }
          }
      };

      this.map.islands.forEach(island => {
          // Process all buildings regardless of island ownership (for shared maps)
          island.buildings.forEach(b => {
              if (b.ownerId) {
                  processConstruction(b, island.x + (b.x || 0), island.y + (b.y || 0), b.ownerId);
                  processRepair(b, island.x + (b.x || 0), island.y + (b.y || 0), b.ownerId);
                  processRecruitment(b, island);
              }
          });
      });

      // Process Mothership and Carrier Recruitment
      this.units.forEach(u => {
          if (u.type === 'mothership' || u.type === 'aircraft_carrier') {
              processRecruitment(u, null);
          }
      });

      this.map.oilSpots.forEach(spot => {
          const b = (spot as any).building;
          if (b && (spot as any).ownerId) {
             processConstruction(b, spot.x, spot.y, (spot as any).ownerId);
             processRepair(b, spot.x, spot.y, (spot as any).ownerId);
          }
      });

      // Unit Movement Logic
      this.units.forEach(unit => {
        if (unit.status === 'moving') {
          let targetX = unit.targetX;
          let targetY = unit.targetY;

          // NaN Safety Check
          if (isNaN(unit.x) || isNaN(unit.y)) {
              // Reset to safe spot? Or delete?
              // Try to find a safe island
              const safeIsland = this.map.islands.find(i => i.ownerId === unit.ownerId) || this.map.islands[0];
              unit.x = safeIsland.x;
              unit.y = safeIsland.y;
              unit.status = 'idle';
              return;
          }

          if (unit.targetIslandId) {
            const target = this.map.islands.find(i => i.id === unit.targetIslandId);
            if (target) {
                targetX = target.x;
                targetY = target.y;
            } else {
                unit.status = 'idle';
                return;
            }
          }

          // Path Navigation (Obstacle Avoidance)
          let activeTargetX = targetX;
          let activeTargetY = targetY;

          if (unit.path && unit.path.length > 0) {
              const pt = unit.path[0];
              if (Math.hypot(unit.x - pt.x, unit.y - pt.y) < 30) { // Reached waypoint
                  unit.path.shift();
                  if (unit.path.length > 0) {
                      activeTargetX = unit.path[0].x;
                      activeTargetY = unit.path[0].y;
                  }
              } else {
                  activeTargetX = pt.x;
                  activeTargetY = pt.y;
              }
          }

          if (activeTargetX !== undefined && activeTargetY !== undefined) {
            let dx = activeTargetX - unit.x;
            let dy = activeTargetY - unit.y;
            let dist = Math.hypot(dx, dy);

            // Physics Movement (Tight & Direct)
            
            // Determine Desired Direction
            let dirX = 0, dirY = 0;
            let shouldMove = false;

            // Direct Pathing (No Steering/Momentum)
            let moveX = 0;
            let moveY = 0;
            
            if (dist > 2) {
                dirX = dx / dist;
                dirY = dy / dist;
                shouldMove = true;
            }

            if (shouldMove) {
                moveX = dirX * unit.speed * deltaTime;
                moveY = dirY * unit.speed * deltaTime;
            }

            if (!shouldMove) {
                if (targetX !== undefined && targetY !== undefined && Math.hypot(targetX - unit.x, targetY - unit.y) < 5) {
                    unit.x = targetX;
                    unit.y = targetY;
                }
                unit.status = 'idle';
                unit.targetIslandId = undefined;
            } else {
                // Wall Collision Check (Simple)
                let blocked = false;
                let nextX = unit.x + moveX;
                let nextY = unit.y + moveY;

                // Terrain Check (Prevent walking on water / boats on land)
                if (!this.isValidPosition(nextX, nextY, unit.type)) {
                    // Obstacle Avoidance: Polygon Edge Sliding
                    let slid = false;
                    
                    let obstaclePoints: {x:number, y:number}[] | undefined = undefined;
                    // Note: Flying units are handled by isValidPosition returning true usually, but if they are restricted by map bounds, they might hit this.
                    // We treat 'aircraft_carrier' as water unit. 'mothership' is flying.
                    const isWaterUnit = ['raft', 'scout_boat', 'gunship', 'destroyer', 'oil_tanker', 'construction_ship', 'aircraft_carrier'].includes(unit.type);
                    
                    if (isWaterUnit) {
                        // Water unit hitting land (Island)
                        const hitIsland = this.map.islands.find(i => {
                             if (Math.hypot(nextX - i.x, nextY - i.y) > i.radius + 50) return false;
                             return i.points && MapGenerator.isPointInPolygon(nextX, nextY, i.points);
                        });
                        if (hitIsland) obstaclePoints = hitIsland.points;
                    } else {
                        // Land unit hitting water (Leaving Island)
                        // Find current island
                        const currentIsland = this.map.islands.find(i => {
                            if (Math.hypot(unit.x - i.x, unit.y - i.y) > i.radius + 50) return false;
                            return i.points && MapGenerator.isPointInPolygon(unit.x, unit.y, i.points);
                        });
                        if (currentIsland) obstaclePoints = currentIsland.points;
                    }

                    if (obstaclePoints) {
                        const edge = MapGenerator.getClosestEdge(unit.x, unit.y, obstaclePoints);
                        
                        let ex = edge.p2.x - edge.p1.x;
                        let ey = edge.p2.y - edge.p1.y;
                        const len = Math.hypot(ex, ey);
                        if (len > 0) {
                            ex /= len;
                            ey /= len;
                            
                            // Project velocity onto edge tangent
                            const dot = moveX * ex + moveY * ey;
                            const slideX = ex * dot;
                            const slideY = ey * dot;
                            
                            // Check if this slide is valid
                            if (this.isValidPosition(unit.x + slideX, unit.y + slideY, unit.type)) {
                                nextX = unit.x + slideX;
                                nextY = unit.y + slideY;
                                slid = true;
                            }
                        }
                    }

                    if (!slid) {
                        // Fallback to Axis Sliding (Legacy)
                        if (this.isValidPosition(nextX, unit.y, unit.type)) {
                            nextY = unit.y;
                            slid = true;
                        } else if (this.isValidPosition(unit.x, nextY, unit.type)) {
                            nextX = unit.x;
                            slid = true;
                        }
                    }

                    if (!slid) {
                        // Pathfinding Logic: Go Around
                        if (obstaclePoints && (!unit.path || unit.path.length === 0) && targetX !== undefined && targetY !== undefined) {
                            const path = MapGenerator.findPathAround({x: unit.x, y: unit.y}, {x: targetX, y: targetY}, obstaclePoints);
                            if (path.length > 0) {
                                unit.path = path;
                            }
                        }

                        // Strict Barrier Logic: Stop
                        blocked = true;
                        // Keep status as moving so it follows path next tick
                        // unit.status = 'idle'; 
                        
                        // Don't update nextX/nextY (stay at current valid pos)
                        nextX = unit.x;
                        nextY = unit.y;
                    }
                }

                // Check collision with Wall structures
                if (!blocked && this.map.bridges && !['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(unit.type)) {
                    for (const bridge of this.map.bridges) {
                        if (bridge.type === 'gate') {
                            if (bridge.ownerId === unit.ownerId) continue; // Allow owner through gate
                        } else if (bridge.type !== 'wall') {
                            continue; // Bridges don't block
                        }

                        // Get wall endpoints
                        const iA = this.map.islands.find(i => i.id === bridge.islandAId);
                        const iB = this.map.islands.find(i => i.id === bridge.islandBId);
                        if (!iA || !iB) continue;

                        const nA = iA.buildings.find(b => b.id === bridge.nodeAId);
                        const nB = iB.buildings.find(b => b.id === bridge.nodeBId);
                        if (!nA || !nB) continue;

                        const ax = iA.x + (nA.x || 0);
                        const ay = iA.y + (nA.y || 0);
                        const bx = iB.x + (nB.x || 0);
                        const by = iB.y + (nB.y || 0);

                        // Intersection check (Segment-Segment)
                        if (MapGenerator.segmentsIntersect(unit.x, unit.y, nextX, nextY, ax, ay, bx, by)) {
                            blocked = true;
                            unit.status = 'idle';
                            break;
                        }
                    }
                }

                if (!blocked) {
                    unit.x = nextX;
                    unit.y = nextY;
                }
            }
          }
        }
      });

      
      this.applyUnitSeparation();
      this.resolveCombat(io, roomId);
      this.cleanupDeadEntities(); // Ensure stale bots are removed
      this.checkIslandCapture();

      // Increment tick counter for split emission
      this.tickCounter++;

      const simplifiedUnits = this.units.map(u => ({
          id: u.id,
          ownerId: u.ownerId,
          type: u.type,
          x: Math.round(u.x),
          y: Math.round(u.y),
          status: u.status,
          health: Math.round(u.health),
          maxHealth: u.maxHealth,
          speed: u.speed,
          damage: u.damage,
          range: u.range,
          fireRate: u.fireRate,
          cargo: u.cargo ? u.cargo.map(c => ({ type: c.type })) : [],
          recruitmentQueue: u.recruitmentQueue
      }));

      // Split Emission Strategy:
      // Even Ticks: Broadcast to EVERYONE (Slow update ~15Hz)
      // Odd Ticks: Broadcast to HOST/LOCAL only (Fast update ~30Hz)
      
      if (this.tickCounter % 2 === 0) {
           // Slow Update (Base Room)
           io.to(roomId).emit('playersData', Array.from(this.players.values()));
           io.to(roomId).emit('unitsData', simplifiedUnits);
           
           // Flush Projectiles (Batch) - Only on slow ticks to save bandwidth
           if (this.pendingProjectiles.length > 0) {
               io.to(roomId).emit('projectilesBatch', this.pendingProjectiles);
               this.pendingProjectiles = [];
           }
      } else {
           // Fast Update (Fast Room - Host/Local only)
           io.to(roomId + '_fast').emit('unitsData', simplifiedUnits);
      }
      
      // Throttle map data (heavy) - Emit every 500ms -> 1000ms
      if (now - this.lastMapEmitTime > 1000) {
          io.to(roomId).emit('mapData', this.map);
          this.lastMapEmitTime = now;
      } 
      
      // Debug Data Emission (Throttle to ~2Hz)
      if (this.tickCounter % 15 === 0) {
          const debugData = this.getDebugState();
          if (debugData.length > 0) {
              io.to(roomId).emit('botDebugData', debugData);
          }
      }
      
      this.checkMatchEnd();
      
      if (this.matchState === 'ENDED') {
           this.stopGameLoop();
      }
    }, 33); // ~30Hz (33ms) -> Remote gets 15Hz, Local gets 30Hz
  }

  damageBuilding(building: any, damage: number) {
      const owner = this.players.get(building.ownerId || (this.map.oilSpots.find(s => s.occupiedBy === building.id) as any)?.ownerId || '');
      if (owner?.godMode) return;

      building.health -= damage;
      
      // Emit Event
      if (building.ownerId && this.io && this.roomId) {
           let worldX = building.x;
           let worldY = building.y;
           
           if ('realX' in building) {
               worldX = building.realX;
               worldY = building.realY;
           } else {
               const island = this.map.islands.find(i => i.buildings.includes(building));
               if (island) {
                   worldX = island.x + (building.x || 0);
                   worldY = island.y + (building.y || 0);
               } else {
                    const spot = this.map.oilSpots.find(s => (s as any).building === building);
                    if (spot) {
                        worldX = spot.x;
                        worldY = spot.y;
                    }
               }
           }

           this.io.to(this.roomId).emit('buildingDamaged', {
               entityId: building.id,
               entityType: building.type,
               ownerId: building.ownerId,
               worldX: worldX,
               worldY: worldY,
               damageAmount: damage,
               hpAfter: building.health,
               timestamp: Date.now()
           });
      }
  }

  getDebugState() {
      return this.bots.map(bot => ({
          playerId: bot.playerId,
          difficulty: bot.difficulty,
          ...bot.debugState
      }));
  }

  stopGameLoop() {
    if (this.gameLoopInterval) {
        clearInterval(this.gameLoopInterval);
        this.gameLoopInterval = null;
    }
  }
}
