import Phaser from 'phaser';
import { socket } from '../../services/socket';
import { settingsManager } from '../SettingsManager';
import type { Settings } from '../SettingsManager';
import type { GameMap, Island, Player, Unit } from '../../types/game';

interface MenuProjectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    type: 'bullet' | 'missile';
    color: number;
    trail: {x: number, y: number, alpha: number, size: number}[];
    scale: number;
    // Movement Props
    wobblePhase: number;
    turnRate: number;
    speed: number;
    initialVy: number;
}

export class MainScene extends Phaser.Scene {
  private islandsGroup!: Phaser.GameObjects.Group;
  private unitsGroup!: Phaser.GameObjects.Group;

  // Menu Animation Props
  private isMenuMode: boolean = false;
  private isSpectating: boolean = false;
  private menuProjectiles: MenuProjectile[] = [];
  private menuSpawnTimer: number = 0;
  private menuGraphics!: Phaser.GameObjects.Graphics;
  private menuExplosions: {x: number, y: number, life: number, maxLife: number, color: number}[] = [];
  private mainMenuMusic: Phaser.Sound.BaseSound | null = null;
  private ingameMusic: Phaser.Sound.BaseSound | null = null;

  private unitContainers: Map<string, Phaser.GameObjects.Container> = new Map();
  private players: Map<string, Player> = new Map();
  private selectedUnitIds: Set<string> = new Set();
  private selectedBuildingIds: Set<string> = new Set();
  private selectedNodeIds: Set<string> = new Set();
  private currentUnits: Unit[] = [];
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private isSelecting: boolean = false;
  private selectionStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  
  private placementMode: boolean = false;
  private placementType: string | null = null;
  private placementGhost: Phaser.GameObjects.Container | null = null;
  private targetSelectionMode: boolean = false;
  private targetSelectionCallback: ((x: number, y: number) => void) | null = null;
  
  // Visuals
    private tumbleweeds: { sprite: Phaser.GameObjects.Shape, dx: number, dy: number, life: number, maxLife: number, poly: Phaser.Geom.Polygon, bounds: Phaser.Geom.Rectangle }[] = [];
    private weatherParticles: { sprite: Phaser.GameObjects.Shape, dx: number, dy: number, type: string, life: number, maxLife: number, poly: Phaser.Geom.Polygon, bounds: Phaser.Geom.Rectangle }[] = [];
    private oilAnimations: { x: number, y: number, pulse: Phaser.GameObjects.Arc, timer: number, id: string }[] = [];
    private oilSpotVisuals: Map<string, { main: Phaser.GameObjects.Shape, pulse: Phaser.GameObjects.Shape, ping?: Phaser.GameObjects.Rectangle }> = new Map();
    private revealedOilSpots: Set<string> = new Set();
    private unitUpdates: Map<string, { x: number, y: number, time: number }[]> = new Map();
    private keyCache: Map<string, Phaser.Input.Keyboard.Key> = new Map();
    private lastCameraX: number = 0;
    private lastCameraY: number = 0;
    private showOilScanner: boolean = false;
    private analyser: AnalyserNode | null = null;
    private dataArray: Uint8Array | null = null;

    private cameraInitialized: boolean = false;
  private currentMap: GameMap | null = null;
  private currentMapVersion: string | null = null;
  private rangeGraphics!: Phaser.GameObjects.Graphics;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private scannerOverlay!: Phaser.GameObjects.Graphics;
  private isComposing: boolean = false;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private debugTextGroup!: Phaser.GameObjects.Group;
    private showDebugView: boolean = false;
    private lastDebugData: any[] = [];

    // Audio Alert Handler
    private handleBuildingDamage = (data: any) => {
        if (data.ownerId === socket.id) {
            const isHQ = data.entityType === 'base';
            if (isHQ) {
                this.sound.play('explosion', { volume: 0.4, rate: 1.5 });
            } else {
                this.sound.play('shoot', { volume: 0.1, rate: 3.0 });
            }
        }
    };

    // Client-Side Prediction
  private predictedMoves: Map<string, { targetX: number, targetY: number, speed: number, type: string, intentId: string, vx?: number, vy?: number }> = new Map();
  private lastCommandTime: number = 0;

  constructor() {
    super('MainScene');
  }

  preload() {
    this.load.audio('defcat_main_menu', 'assets/audio/defcat_new_menu.mp3');
    this.load.audio('ingame_music', 'assets/audio/cut_the_wire.mp3');
    this.load.audio('shoot', 'assets/audio/shoot.wav');
    this.load.audio('explosion', 'assets/audio/explosion.wav');
    this.load.audio('recruit', 'assets/audio/recruit.wav');
    this.load.audio('move_land', 'assets/audio/move_land.wav');
    this.load.audio('move_water', 'assets/audio/move_water.wav');
    this.load.audio('move_air', 'assets/audio/move_air.wav');
  }

  create() {
    this.cameras.main.setBackgroundColor('#006994'); // Ocean color

    // Apply initial settings
    const settings = settingsManager.getSettings();
    this.sound.volume = settings.audio.masterVolume;
    this.game.loop.targetFps = settings.graphics.targetFps || 60;

    // Audio
    this.mainMenuMusic = this.sound.add('defcat_main_menu', { loop: true, volume: settings.audio.musicVolume });
    this.ingameMusic = this.sound.add('ingame_music', { loop: true, volume: settings.audio.musicVolume });

    // Setup Audio Analyser for Shake Effect
    if (this.sound instanceof Phaser.Sound.WebAudioSoundManager) {
        try {
            this.analyser = this.sound.context.createAnalyser();
            this.analyser.fftSize = 256;
            // Connect master volume to analyser (fan-out)
            const manager = this.sound as any;
            if (manager.masterVolumeNode) {
                manager.masterVolumeNode.connect(this.analyser);
            }
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        } catch (e) {
            console.warn('Audio Analyser setup failed:', e);
        }
    }

    this.islandsGroup = this.add.group();
    this.unitsGroup = this.add.group();
    
    // Graphics for ranges (below units)
    this.rangeGraphics = this.add.graphics();
    this.rangeGraphics.setDepth(5);
    
    // Graphics for paths (below units)
    this.pathGraphics = this.add.graphics();
    this.pathGraphics.setDepth(5);

    // NEW: Global Overlay for Oil Scanner Pings (Depth 1000 - Above EVERYTHING)
    this.scannerOverlay = this.add.graphics();
    this.scannerOverlay.setDepth(1000);

    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(100); // Draw on top

    this.menuGraphics = this.add.graphics();
    this.menuGraphics.setDepth(200);

    // Debug Graphics
    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(2000);
    this.debugTextGroup = this.add.group();
    this.debugTextGroup.setDepth(2001);

    // Listen for Debug Data
    socket.on('botDebugData', (data: any[]) => {
        this.lastDebugData = data;
    });

    // Listen for Building Damage (Audio Alerts)
    socket.on('buildingDamaged', this.handleBuildingDamage);

    // Toggle Debug View
    window.addEventListener('toggle-debug-view', ((e: CustomEvent) => {
        this.showDebugView = e.detail.show;
        if (!this.showDebugView) {
            this.debugGraphics.clear();
        }
    }) as EventListener);

    // Menu Mode Handler
    window.addEventListener('game-menu-mode', ((e: CustomEvent) => {
        this.setMenuMode(e.detail);
        if (e.detail) {
            // Enter Menu: Stop Ingame, Play Menu
            if (this.ingameMusic && this.ingameMusic.isPlaying) {
                this.ingameMusic.stop();
            }
            if (this.mainMenuMusic && !this.mainMenuMusic.isPlaying) {
                this.mainMenuMusic.play();
            }
        } else {
            // Enter Game: Stop Menu, Play Ingame
            if (this.mainMenuMusic && this.mainMenuMusic.isPlaying) {
                this.mainMenuMusic.stop();
            }
            if (this.ingameMusic && !this.ingameMusic.isPlaying) {
                this.ingameMusic.play();
            }
        }
    }) as EventListener);

    // Spectator Mode Handler
    window.addEventListener('enable-spectator-mode', (() => {
        this.isSpectating = true;
        this.isMenuMode = false; // Ensure we are not in menu mode (so camera works)
        
        // Clear Selection
        this.selectedUnitIds.clear();
        this.selectedBuildingIds.clear();
        this.selectedNodeIds.clear();
        window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
        window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));

        // Disable Placement
        if (this.placementMode) {
            this.placementMode = false;
            if (this.placementGhost) this.placementGhost.destroy();
            this.placementGhost = null;
            this.placementType = null;
        }

        // Disable Selection Box
        this.isSelecting = false;
        if (this.selectionGraphics) this.selectionGraphics.clear();

        console.log('[MainScene] Spectator Mode Enabled');
    }) as EventListener);

    // Toggle Oil Scanner
    window.addEventListener('toggle-oil-scanner', ((e: CustomEvent) => {
        this.showOilScanner = e.detail.show;
        if (!this.showOilScanner) {
            // Cleanup visuals immediately
            this.rangeGraphics.clear();
            
            // Note: We do NOT hide revealed spots anymore. 
            // Once revealed, they stay revealed (Client-side persistence)
            // This allows players to build on them even if they turn off the scanner view.
        } else {
            // Force update immediately
            this.updateOilScanner();
        }
    }) as EventListener);

    // Initial State
    // Default to true (Menu Mode) if undefined to prevent flashing game state before App controls it
    // But if we are already playing (reloaded page into game), App might set it to false quickly.
    // We check the global flag set by App.tsx
    this.isMenuMode = (window as any).gameMenuMode !== false; 
    
    if (this.isMenuMode) {
        this.setMenuMode(true);
        if (this.mainMenuMusic && !this.mainMenuMusic.isPlaying) {
            this.mainMenuMusic.play();
        }
        if (this.ingameMusic && this.ingameMusic.isPlaying) {
            this.ingameMusic.stop();
        }
    } else {
        // If not in menu mode, ensure we are ready to render
        this.setMenuMode(false);
        if (this.mainMenuMusic && this.mainMenuMusic.isPlaying) {
            this.mainMenuMusic.stop();
        }
        if (this.ingameMusic && !this.ingameMusic.isPlaying) {
            this.ingameMusic.play();
        }
    }

    // Listen for settings changes
    const onSettingsChange = (newSettings: Settings) => {
        this.sound.volume = newSettings.audio.masterVolume;
        if (this.mainMenuMusic) {
            (this.mainMenuMusic as any).setVolume(newSettings.audio.musicVolume);
        }
        if (this.ingameMusic) {
            (this.ingameMusic as any).setVolume(newSettings.audio.musicVolume);
        }
        this.game.loop.targetFps = newSettings.graphics.targetFps || 60;
        
        // Re-render map to apply graphics settings (particles, weather)
        if (this.currentMap) {
            this.renderMap(this.currentMap);
            // Also re-render units to update their ranges/details if needed
            this.renderUnits(this.currentUnits);
        }
    };
    settingsManager.on('change', onSettingsChange);
    this.events.on('shutdown', () => {
        settingsManager.off('change', onSettingsChange);
        socket.off('buildingDamaged', this.handleBuildingDamage);
    });

    this.input.mouse!.disableContextMenu();

    // IME Composition Handlers (Chinese Input Optimization)
    window.addEventListener('compositionstart', () => {
        this.isComposing = true;
    });
    window.addEventListener('compositionend', () => {
        this.isComposing = false;
    });

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
        // Ignore game inputs if typing in an input field OR using IME (Chinese/Japanese/etc) OR Spectating
        if (this.isComposing || this.isSpectating) return;
        if ((event.target as HTMLElement).tagName === 'INPUT') return;

        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        const binds = settingsManager.getSettings().keybinds;

        if (key === binds.clearSelection) {
            this.selectedUnitIds.clear();
            this.selectedBuildingIds.clear();
            this.selectedNodeIds.clear();
            
            this.renderUnits(this.currentUnits);
            if (this.currentMap) this.renderMap(this.currentMap);

            window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                detail: { unitIds: [] } 
            }));
            window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                detail: { buildingIds: [] } 
            }));
            window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                detail: { nodes: [] } 
            }));
        } else if (key === binds.loadFerry) {
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            
            // Find ferry at mouse position
            const ferry = this.currentUnits.find(u => 
                u.type === 'ferry' && 
                u.ownerId === socket.id &&
                Math.hypot(u.x - worldPoint.x, u.y - worldPoint.y) < 40
            );

            if (ferry) {
                 const unitIdsToLoad = Array.from(this.selectedUnitIds).filter(id => {
                     const u = this.currentUnits.find(unit => unit.id === id);
                     // Basic validation (land unit)
                     return u && ['soldier', 'sniper', 'rocketeer', 'builder'].includes(u.type);
                 });
                 
                 if (unitIdsToLoad.length > 0) {
                     socket.emit('load', { ferryId: ferry.id, unitIds: unitIdsToLoad });
                 }
            }
        } else if (key === binds.unloadFerry) {
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            
            this.selectedUnitIds.forEach(id => {
                const unit = this.currentUnits.find(u => u.id === id);
                if (unit && unit.type === 'ferry') {
                     socket.emit('unload', { ferryId: unit.id, x: worldPoint.x, y: worldPoint.y });
                }
            });
        } else if (key === binds.cancel) {
            if (this.placementMode) {
                this.placementMode = false;
                if (this.placementGhost) this.placementGhost.destroy();
                this.placementGhost = null;
                this.placementType = null;
            }
            if (this.targetSelectionMode) {
                this.targetSelectionMode = false;
                this.targetSelectionCallback = null;
                this.input.setDefaultCursor('default');
            }
            if (this.selectedUnitIds.size > 0) {
                this.selectedUnitIds.clear();
                this.renderUnits(this.currentUnits);
                window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                    detail: { unitIds: [] } 
                }));
            }
        }
    });

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    // Cleanup when starting a new game (Fixes Ghost Units)
    const handleGameStartCleanup = () => {
        console.log('[MainScene] Clearing Game State for New Game');
        this.currentUnits = [];
        this.unitContainers.clear();
        this.unitUpdates.clear();
        this.unitsGroup.clear(true, true);
        this.selectedUnitIds.clear();
        this.selectedBuildingIds.clear();
        this.selectedNodeIds.clear();
        this.cameraInitialized = false; // Reset camera so it centers on new base
        this.currentMapVersion = null; // Force map re-render
        window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
        window.dispatchEvent(new CustomEvent('building-selection-changed', { detail: { buildingIds: [] } }));
        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
    };

    socket.on('gameStarted', handleGameStartCleanup);
    socket.on('joinedRoom', () => {
        // Only clear if joining a non-lobby room or if we want to reset state
        // Usually safe to clear when switching rooms
        // handleGameStartCleanup(); // DISABLED: Causing resets on reconnect/sync
    });

    socket.on('playersData', (players: Player[]) => {
      this.players.clear();
      players.forEach(p => this.players.set(p.id, p));
    });

            socket.on('mapData', (mapData: GameMap) => {
            // Version check to skip unnecessary re-renders
            const mapVersion = mapData.version;
            if (mapVersion && mapVersion === this.currentMapVersion) {
                // console.log('[MainScene] Map version match, skipping rebuild.');
                return;
            }
            
            this.currentMapVersion = mapVersion || null;
            this.currentMap = mapData;
            if (this.isMenuMode) return;
            this.renderMap(mapData);

            if (!this.cameraInitialized) {
                if (this.centerCameraOnBase()) {
                    this.cameraInitialized = true;
                }
            }
            
            setTimeout(() => {
                if (this.isMenuMode) return;
                if (!socket.id) return;
                const me = this.players.get(socket.id);
                if (me && (me as any).canBuildHQ === false) return;

                const bases = this.currentMap?.islands.flatMap(i => i.buildings.filter(b => b.type === 'base'));
                console.log(`[SpawnSanity] Checking for HQ. SocketID: ${socket.id}. Total Bases: ${bases?.length}`);

                const myBase = this.currentMap?.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
                if (!myBase) {
                    console.error('[SpawnSanity] NO HQ FOUND FOR PLAYER', socket.id);
                    
                    const errorText = this.add.text(this.scale.width/2, 100, 'NO HQ FOUND - ATTEMPTING RESPAWN...', {
                        fontSize: '32px',
                        color: '#ffff00',
                        backgroundColor: '#000000'
                    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);

                    socket.emit('request_spawn');

                    setTimeout(() => {
                         const retryBase = this.currentMap?.islands.some(i => i.buildings.some(b => b.type === 'base' && b.ownerId === socket.id));
                         if (retryBase) {
                             errorText.destroy();
                             console.log('[SpawnSanity] Respawn successful.');
                             this.centerCameraOnBase();
                         } else {
                             errorText.setText('SPAWN ERROR: NO HQ ASSIGNED\nATTEMPTING EMERGENCY RESPAWN...');
                             errorText.setColor('#ff0000');
                             socket.emit('force_spawn_hq');
                             setTimeout(() => {
                                 if (errorText && (errorText as any).active) {
                                     errorText.destroy();
                                 }
                             }, 10000);
                         }
                    }, 2000);
                } else {
                    console.log('[SpawnSanity] HQ confirmed.');
                }
            }, 3000);
        });

    socket.on('unitsData', (units: Unit[]) => {
      // Audio Logic: Compare old units vs new units
      if (!this.isMenuMode) {
          const oldUnitIds = new Set(this.currentUnits.map(u => u.id));
          const newUnitIds = new Set(units.map(u => u.id));
          const settings = settingsManager.getSettings();
          const volume = settings.audio.masterVolume * settings.audio.sfxVolume;

          // Check for Deaths (in old but not in new)
          this.currentUnits.forEach(u => {
              if (!newUnitIds.has(u.id)) {
                  // Unit died - Play Explosion
                  // Only play if on screen or close? For now, global if not too spammy.
                  // Or use createExplosion which handles sound + visual
                  this.createExplosion(u.x, u.y, u.ownerId === socket.id ? 0x00ff00 : 0xff0000);
              }
          });

          // Check for Recruits (in new but not in old)
          units.forEach(u => {
              if (!oldUnitIds.has(u.id)) {
                  // New unit spawned
                  if (u.ownerId === socket.id && volume > 0) {
                      try {
                          this.sound.play('recruit', { volume: volume * 0.4 });
                      } catch (e) {}
                  }
              }
          });
      }

      this.currentUnits = units;
      if (this.isMenuMode) return;

      const now = Date.now();
      units.forEach(u => {
          if (!this.unitUpdates.has(u.id)) {
              this.unitUpdates.set(u.id, []);
              // Initialize with current pos to avoid jump
              this.unitUpdates.get(u.id)!.push({ x: u.x, y: u.y, time: now - 200 }); 
          }
          const history = this.unitUpdates.get(u.id)!;
          history.push({ x: u.x, y: u.y, time: now });
          if (history.length > 20) history.shift();
      });

      this.renderUnits(units);
    });



    socket.on('projectile', (data: { x1: number, y1: number, x2: number, y2: number, type: string, speed: number }) => {
        // Play Shoot Sound
        const settings = settingsManager.getSettings();
        const volume = settings.audio.masterVolume * settings.audio.sfxVolume;
        if (volume > 0) {
            try {
                this.sound.play('shoot', { 
                    volume: volume * 0.2, 
                    detune: Phaser.Math.Between(-200, 200)
                });
            } catch (e) {}
        }

        if (data.type === 'tesla') {
            // Tesla Lightning Effect
            const graphics = this.add.graphics();
            graphics.lineStyle(2, 0x00FFFF);
            graphics.setDepth(100);
            
            const points = [];
            const segments = 8;
            const dx = data.x2 - data.x1;
            const dy = data.y2 - data.y1;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const normalX = -dy / dist;
            const normalY = dx / dist;

            points.push({ x: data.x1, y: data.y1 });
            for(let i=1; i<segments; i++) {
                const t = i / segments;
                const px = data.x1 + dx * t;
                const py = data.y1 + dy * t;
                const offset = (Math.random() - 0.5) * 20;
                points.push({ 
                    x: px + normalX * offset, 
                    y: py + normalY * offset 
                });
            }
            points.push({ x: data.x2, y: data.y2 });

            graphics.strokePoints(points);

            // Flash effect
            this.tweens.add({
                targets: graphics,
                alpha: 0,
                duration: 150,
                onComplete: () => graphics.destroy()
            });

        } else if (data.type === 'rocket_missile') {
            // Rocket Missile Visuals
            const rocket = this.add.rectangle(data.x1, data.y1, 16, 6, 0x444444);
            rocket.setStrokeStyle(1, 0x000000);
            rocket.setDepth(100);
            
            const angle = Math.atan2(data.y2 - data.y1, data.x2 - data.x1);
            rocket.rotation = angle;

            const dist = Math.hypot(data.x2 - data.x1, data.y2 - data.y1);
            const duration = (dist / data.speed) * 1000;
            
            this.tweens.add({
                targets: rocket,
                x: data.x2,
                y: data.y2,
                duration: duration,
                onComplete: () => {
                    // Explosion Effect
                    const explosion = this.add.circle(data.x2, data.y2, 20, 0xFF4500); // Orange Red
                    explosion.setDepth(101);
                    
                    this.tweens.add({
                        targets: explosion,
                        scale: 6, // Expands to ~120px radius
                        alpha: 0,
                        duration: 500,
                        onComplete: () => explosion.destroy()
                    });

                    // Shockwave ring
                    const ring = this.add.circle(data.x2, data.y2, 20, 0xFFFFFF);
                    ring.setStrokeStyle(4, 0xFFFF00);
                    ring.setFillStyle(0xFFFFFF, 0); // Transparent fill
                    ring.setDepth(101);
                    
                    this.tweens.add({
                        targets: ring,
                        scale: 5,
                        alpha: 0,
                        duration: 300,
                        onComplete: () => ring.destroy()
                    });

                    rocket.destroy();
                }
            });

        } else {
            // Standard Bullet
            const bullet = this.add.circle(data.x1, data.y1, 3, 0xFFFF00);
            bullet.setStrokeStyle(1, 0xFFAA00);
            bullet.setDepth(100);
            
            const dist = Math.hypot(data.x2 - data.x1, data.y2 - data.y1);
            const duration = (dist / data.speed) * 1000;
            
            this.tweens.add({
                targets: bullet,
                x: data.x2,
                y: data.y2,
                duration: duration,
                onComplete: () => {
                    // Small impact effect
                    const impact = this.add.circle(data.x2, data.y2, 5, 0xFFAA00);
                    this.tweens.add({
                        targets: impact,
                        scale: 0,
                        alpha: 0,
                        duration: 100,
                        onComplete: () => impact.destroy()
                    });
                    bullet.destroy();
                }
            });
        }
    });

    socket.on('laserBeam', (data: { attackerId: string, targetId: string, x1: number, y1: number, x2: number, y2: number, duration: number, color: number }) => {
        const beam = this.add.graphics();
        beam.setDepth(9999);
        
        // Initial Draw
        const drawBeam = (width: number, alpha: number) => {
            beam.clear();

            // Dynamic Positions
            let x1 = data.x1;
            let y1 = data.y1;
            let x2 = data.x2;
            let y2 = data.y2;

            const attacker = this.unitContainers.get(data.attackerId);
            if (attacker) {
                x1 = attacker.x;
                y1 = attacker.y;
            }

            const target = this.unitContainers.get(data.targetId);
            if (target) {
                x2 = target.x;
                y2 = target.y;
            }

            // Outer Glow
            beam.lineStyle(width * 2, data.color, alpha * 0.5);
            beam.beginPath();
            beam.moveTo(x1, y1);
            beam.lineTo(x2, y2);
            beam.strokePath();

            // Main Beam
            beam.lineStyle(width, data.color, alpha);
            beam.beginPath();
            beam.moveTo(x1, y1);
            beam.lineTo(x2, y2);
            beam.strokePath();
            
            // Core (White center for "laser" effect)
            beam.lineStyle(width / 3, 0xFFFFFF, 1);
            beam.beginPath();
            beam.moveTo(x1, y1);
            beam.lineTo(x2, y2);
            beam.strokePath();
        };

        // Pulse Tween
        const tween = this.tweens.addCounter({
            from: 3,
            to: 8,
            duration: 100,
            yoyo: true,
            repeat: -1,
            onUpdate: (t) => {
                if (!beam.scene) {
                    t.stop();
                    return;
                }
                const width = t.getValue() as number;
                drawBeam(width || 3, 1);
            }
        });

        // Destroy after duration
        this.time.delayedCall(data.duration, () => {
            if (beam.scene) beam.destroy();
            tween.stop();
        });
    });

    socket.on('abilityEffect', (data: { type: string, unitId: string, oilSpotIds: string[], duration: number, range?: number }) => {
        if (data.type === 'reveal_oil') {
            // Update revealed set
            data.oilSpotIds.forEach(id => this.revealedOilSpots.add(id));
            
            // Dispatch for Minimap
            window.dispatchEvent(new CustomEvent('oil-revealed', { 
                detail: { ids: Array.from(this.revealedOilSpots) } 
            }));

            data.oilSpotIds.forEach(id => {
                const visuals = this.oilSpotVisuals.get(id);
                if (visuals) {
                    visuals.main.setVisible(true);
                    visuals.pulse.setVisible(true);
                    
                    // Pop effect to make it "super easy to see"
                    this.tweens.add({
                        targets: [visuals.main, visuals.pulse],
                        scale: { from: 0, to: 1.5 }, // Scale up 50% larger than normal
                        alpha: { from: 1, to: 0.8 },
                        duration: 500,
                        yoyo: true,
                        repeat: 2,
                        onComplete: () => {
                             // Settle at slightly larger size for visibility
                             visuals.main.setScale(1.2);
                             visuals.pulse.setScale(1.2);
                        }
                    });

                    // Hide after duration
                    this.time.delayedCall(data.duration, () => {
                        // Fade out effect
                        this.tweens.add({
                            targets: [visuals.main, visuals.pulse],
                            alpha: 0,
                            scale: 0,
                            duration: 1000, // 1 second fade out
                            onComplete: () => {
                                this.revealedOilSpots.delete(id);
                                
                                // Check visuals again
                                const currentVisuals = this.oilSpotVisuals.get(id);
                                // Only hide if it's still a hidden spot (not converted to permanent)
                                if (currentVisuals && id.startsWith('hidden_oil_')) {
                                    currentVisuals.main.setVisible(false);
                                    currentVisuals.pulse.setVisible(false);
                                    // Reset scale/alpha for next time
                                    currentVisuals.main.setScale(1);
                                    currentVisuals.main.setAlpha(0.8);
                                    currentVisuals.pulse.setScale(1);
                                }
                                
                                // Dispatch update
                                window.dispatchEvent(new CustomEvent('oil-revealed', { 
                                     detail: { ids: Array.from(this.revealedOilSpots) } 
                                }));
                            }
                        });
                    });
                }
            });
            
            // Visual feedback on unit (expanding ring)
            const unit = this.currentUnits.find(u => u.id === data.unitId);
            if (unit) {
                 const ring = this.add.circle(unit.x, unit.y, 10, 0xFFFF00, 0);
                 ring.setStrokeStyle(2, 0xFFFF00);
                 this.tweens.add({
                     targets: ring,
                     radius: data.range || 300,
                     alpha: 0,
                     duration: 1000,
                     onComplete: () => ring.destroy()
                 });
            }
        }
    });

    // Placement Event
    window.addEventListener('enter-placement-mode', (e: any) => {
        this.placementMode = true;
        this.placementType = e.detail.type;
        if (this.placementGhost) this.placementGhost.destroy();
        this.placementGhost = this.drawDetailedBuilding(0, 0, this.placementType!, 0xAAFFAA);
        this.placementGhost.setAlpha(0.6);
        this.placementGhost.setDepth(200);

        // Visual Hitbox / Exclusion Zone for Farm
        if (this.placementType === 'farm') {
            // Exclusion Zone (80px radius where other farms cannot be)
            const exclusion = this.add.circle(0, 0, 80, 0xFF0000, 0.15);
            exclusion.setStrokeStyle(2, 0xFF0000, 0.5);
            this.placementGhost.add(exclusion);
            
            // Physical Hitbox (30px radius)
            const hitbox = this.add.circle(0, 0, 30, 0x00FF00, 0.2);
            hitbox.setStrokeStyle(2, 0x00FF00, 0.8);
            this.placementGhost.add(hitbox);
        }
    });

    // Ferry Events
    window.addEventListener('load-nearby', (e: any) => {
        const ferryId = e.detail.ferryId;
        const ferry = this.currentUnits.find(u => u.id === ferryId);
        if (ferry) {
             // Find nearby loadable units
             const loadable = this.currentUnits.filter(u => 
                 u.ownerId === socket.id &&
                 ['soldier', 'sniper', 'rocketeer', 'builder'].includes(u.type) &&
                 Math.hypot(u.x - ferry.x, u.y - ferry.y) < 100
             );
             const unitIds = loadable.map(u => u.id);
             if (unitIds.length > 0) {
                 socket.emit('load', { ferryId, unitIds });
             }
        }
    });

    window.addEventListener('enter-unload-mode', (e: any) => {
        const ferryId = e.detail.ferryId;
        this.targetSelectionMode = true;
        this.targetSelectionCallback = (x, y) => {
            socket.emit('unload', { ferryId, x, y });
        };
        // Visual cursor change?
        this.input.setDefaultCursor('crosshair');
    });

    window.addEventListener('request-deselect', (e: any) => {
        const { type, id } = e.detail;
        if (type === 'unit') {
            if (this.selectedUnitIds.has(id)) {
                this.selectedUnitIds.delete(id);
                this.renderUnits(this.currentUnits);
                window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                    detail: { unitIds: Array.from(this.selectedUnitIds) } 
                }));
            }
        } else if (type === 'building') {
            if (this.selectedBuildingIds.has(id)) {
                this.selectedBuildingIds.delete(id);
                if (this.currentMap) this.renderMap(this.currentMap);
                window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                    detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
                }));
            }
        } else if (type === 'node') {
            if (this.selectedNodeIds.has(id)) {
                this.selectedNodeIds.delete(id);
                if (this.currentMap) this.renderMap(this.currentMap);
                window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                    detail: { nodes: Array.from(this.selectedNodeIds) } 
                }));
            }
        }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (this.isSpectating) return;
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        
        if (this.placementMode && this.placementGhost) {
            this.placementGhost.setPosition(worldPoint.x, worldPoint.y);

            // Validation Visuals
            let isValid = true;
            if (this.placementType === 'dock') {
                isValid = this.isValidDockPlacement(worldPoint.x, worldPoint.y);
            }
            
            // Tint children based on validity
            this.placementGhost.list.forEach((child: any) => {
                if (child.setTint && child.clearTint) {
                     if (isValid) {
                         child.clearTint();
                     } else {
                         child.setTint(0xff0000);
                     }
                }
            });
        }

        if (this.isSelecting) {
            const worldStart = this.cameras.main.getWorldPoint(this.selectionStart.x, this.selectionStart.y);
            const worldEnd = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

            this.selectionGraphics.clear();
            this.selectionGraphics.lineStyle(1, 0x00ff00);
            this.selectionGraphics.fillStyle(0x00ff00, 0.3);

            const x = Math.min(worldStart.x, worldEnd.x);
            const y = Math.min(worldStart.y, worldEnd.y);
            const w = Math.abs(worldEnd.x - worldStart.x);
            const h = Math.abs(worldEnd.y - worldStart.y);

            this.selectionGraphics.fillRect(x, y, w, h);
            this.selectionGraphics.strokeRect(x, y, w, h);
        }
    });

    // Input Events
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // Ignore inputs if in menu mode or spectating
        if (this.isMenuMode || this.isSpectating) return;

        if (this.placementMode && this.placementGhost) {
            if (pointer.leftButtonDown()) {
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                socket.emit('build', { 
                    x: worldPoint.x, 
                    y: worldPoint.y, 
                    type: this.placementType 
                });
                
                if (!pointer.event.shiftKey) {
                    this.placementMode = false;
                    this.placementGhost.destroy();
                    this.placementGhost = null;
                    this.placementType = null;
                }
            } else if (pointer.rightButtonDown()) {
                this.placementMode = false;
                if (this.placementGhost) this.placementGhost.destroy();
                this.placementGhost = null;
                this.placementType = null;
            }
            return;
        }

        if (this.targetSelectionMode) {
             if (pointer.leftButtonDown()) {
                 const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                 if (this.targetSelectionCallback) {
                     this.targetSelectionCallback(worldPoint.x, worldPoint.y);
                 }
                 this.targetSelectionMode = false;
                 this.targetSelectionCallback = null;
                 this.input.setDefaultCursor('default');
             } else if (pointer.rightButtonDown()) {
                 this.targetSelectionMode = false;
                 this.targetSelectionCallback = null;
                 this.input.setDefaultCursor('default');
             }
             return;
        }

        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        if (pointer.leftButtonDown()) {
             // Move Command (Left click is now move)
             if (this.selectedUnitIds.size > 0) {
                 this.issueMoveCommand(worldPoint.x, worldPoint.y);
             }
        } else if (pointer.rightButtonDown()) {
             // Check if clicking on a unit
             const clickedUnit = this.currentUnits.find(u => 
                u.ownerId === socket.id && 
                Math.hypot(u.x - worldPoint.x, u.y - worldPoint.y) < 30 // Hitbox
             );

             if (clickedUnit) {
                 const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                 
                 if (!isMultiSelect) {
                     this.selectedUnitIds.clear();
                 }

                 // Add to selection (Toggle if multi-select?)
                 // Standard RTS: Click always selects. Shift+Click toggles or adds.
                 // For simplicity, let's just add.
                 this.selectedUnitIds.add(clickedUnit.id);
                 
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                     detail: { unitIds: Array.from(this.selectedUnitIds) } 
                 }));
                 // Don't start box selection if clicked unit
                 return;
             }
             
             // If units are selected and we click ground -> Deselect (standard RTS)
             // But we want to allow drag selection start.
             // So we just fall through to "Start box selection"


             // Otherwise start box selection
             this.isSelecting = true;
             this.selectionStart.set(pointer.x, pointer.y);
        }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (this.isSpectating) return;
        if (this.isSelecting) {
            this.isSelecting = false;
            this.selectionGraphics.clear();
            
            if (pointer.rightButtonReleased()) {
                const worldStart = this.cameras.main.getWorldPoint(this.selectionStart.x, this.selectionStart.y);
                const worldEnd = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                
                const w = Math.abs(worldEnd.x - worldStart.x);
                const h = Math.abs(worldEnd.y - worldStart.y);
                
                if (w > 10 || h > 10) {
                    // Box Selection - Add to selection
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                        this.selectedBuildingIds.clear();
                        this.selectedNodeIds.clear();
                        window.dispatchEvent(new CustomEvent('node-selection-changed', { detail: { nodes: [] } }));
                    }

                    const x = Math.min(worldStart.x, worldEnd.x);
                    const y = Math.min(worldStart.y, worldEnd.y);
                    const selectionRect = new Phaser.Geom.Rectangle(x, y, w, h);

                    // Units
                    this.currentUnits.forEach(u => {
                        if (u.ownerId === socket.id) {
                            // Use intersection instead of center point for better feel
                            const unitRect = new Phaser.Geom.Rectangle(u.x - 12, u.y - 12, 24, 24);
                            if (Phaser.Geom.Intersects.RectangleToRectangle(selectionRect, unitRect)) {
                                this.selectedUnitIds.add(u.id);
                            }
                        }
                    });
                    this.renderUnits(this.currentUnits);
                    window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                        detail: { unitIds: Array.from(this.selectedUnitIds) } 
                    }));

                    // Buildings & Nodes
                    if (this.currentMap) {
                        this.currentMap.islands.forEach(island => {
                            // Check all buildings, but only select mine
                            island.buildings.forEach(b => {
                                // Calculate absolute position
                                const bx = island.x + (b.x || 0);
                                const by = island.y + (b.y || 0);
                                
                                // Check if building is mine OR island is mine (fallback)
                                const isMine = b.ownerId === socket.id || island.ownerId === socket.id;

                                if (isMine) {
                                    const bRect = new Phaser.Geom.Rectangle(bx - 12, by - 12, 24, 24);
                                    if (Phaser.Geom.Intersects.RectangleToRectangle(selectionRect, bRect)) {
                                        if (b.type === 'bridge_node' || b.type === 'wall_node') {
                                            this.selectedNodeIds.add(b.id);
                                        } else {
                                            this.selectedBuildingIds.add(b.id);
                                        }
                                    }
                                }
                            });
                        });
                        
                        window.dispatchEvent(new CustomEvent('building-selection-changed', { 
                            detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
                        }));
                        window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                            detail: { nodes: Array.from(this.selectedNodeIds) } 
                        }));
                        this.renderMap(this.currentMap);
                    }
                }
            }
        }
    });

    // Zoom
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
        void pointer;
        void gameObjects;
        void deltaX;
        void deltaZ;
        
        let minZoom = 0.2;
        if (this.currentMap) {
            // Calculate zoom to fit map
            // Add slight padding (0.95) so edges aren't flush
            const minZoomX = this.cameras.main.width / this.currentMap.width;
            const minZoomY = this.cameras.main.height / this.currentMap.height;
            minZoom = Math.max(minZoomX, minZoomY);
        }

        const newZoom = this.cameras.main.zoom - deltaY * 0.001;
        this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, minZoom, 2));
    });

    // Steering Update Loop (20Hz)
    this.time.addEvent({
        delay: 50,
        callback: this.sendSteeringUpdates,
        callbackScope: this,
        loop: true
    });
  }

    updateOilScanner() {
        // Detection Logic (ALWAYS RUNS if map exists)
        if (!this.currentMap) return;
        
        const seekers = this.currentUnits.filter(u => u.ownerId === socket.id && u.type === 'oil_seeker');
        
        // Scan Range
        const range = Math.max(this.currentMap.width, this.currentMap.height) * 0.25;

        // Visual Range Rendering moved to renderRangeRings()


        // Determine which spots are currently visible
        const currentlyVisible = new Set<string>();
        
        this.currentMap.oilSpots.forEach(spot => {
            // If not hidden, always visible
            if (!spot.id.startsWith('hidden_oil_')) {
                 currentlyVisible.add(spot.id);
                 return;
            }

            // If already revealed, keep revealed
            if (this.revealedOilSpots.has(spot.id)) {
                currentlyVisible.add(spot.id);
                return;
            }

            let inRange = false;
            for (const s of seekers) {
                if (Math.hypot(spot.x - s.x, spot.y - s.y) <= range) {
                    inRange = true;
                    break;
                }
            }

            if (inRange) {
                console.log(`[MainScene] Hidden Spot REVEALED: ${spot.id} at (${spot.x}, ${spot.y})`);
                currentlyVisible.add(spot.id);
            }
        });

        // Update visuals
        let changed = false;
        
        // Clear overlay every frame to redraw pings
        this.scannerOverlay.clear();
        
        // Show spots that are now visible
        currentlyVisible.forEach(id => {
            // Logic for revealing (One-time state change)
            if (!this.revealedOilSpots.has(id)) {
                const visuals = this.oilSpotVisuals.get(id);
                if (visuals) {
                    visuals.main.setVisible(true);
                    // Use LOCAL coordinates (0,0) for the hit area
                    visuals.main.setInteractive(new Phaser.Geom.Circle(0, 0, visuals.main.radius), Phaser.Geom.Circle.Contains);
                    visuals.pulse.setVisible(true);
                    visuals.main.setAlpha(0.5); // Black oil standard alpha

                    // Hide original ping (we use overlay now)
                    if (visuals.ping) {
                        visuals.ping.setVisible(false); 
                    }
                }
                this.revealedOilSpots.add(id);
                changed = true;
            }

            // Continuous Visuals (Every Frame) - Draw Ping on Overlay if it's a HIDDEN spot
            if (id.startsWith('hidden_oil_')) {
                 const visuals = this.oilSpotVisuals.get(id);
                 if (visuals) {
                     // Pulse Animation for the overlay rect
                     const time = Date.now();
                     const scale = 1 + Math.sin(time * 0.005) * 0.3; // 0.7 to 1.3
                     const size = 30 * scale;
                     const offset = size / 2;

                     // Draw Red Ping Rect
                     this.scannerOverlay.lineStyle(3, 0xFF0000, 1);
                     this.scannerOverlay.strokeRect(visuals.main.x - offset, visuals.main.y - offset, size, size);
                     
                     // Optional: Draw a crosshair or filling
                     this.scannerOverlay.fillStyle(0xFF0000, 0.2);
                     this.scannerOverlay.fillRect(visuals.main.x - offset, visuals.main.y - offset, size, size);
                 }
            }
        });

        if (changed) {
             window.dispatchEvent(new CustomEvent('oil-revealed', { 
                detail: { ids: Array.from(this.revealedOilSpots) } 
            }));
        }
    }

  renderRangeRings() {
      if (!this.rangeGraphics) return;
      this.rangeGraphics.clear();

      // 1. Oil Scanner Ranges
      if (this.currentMap) {
          const seekers = this.currentUnits.filter(u => u.ownerId === socket.id && u.type === 'oil_seeker');
          if (this.showOilScanner || seekers.length > 0) {
              const range = Math.max(this.currentMap.width, this.currentMap.height) * 0.25;
              this.rangeGraphics.lineStyle(2, 0xFF0000, 0.5);
              this.rangeGraphics.fillStyle(0xFF0000, 0.05);
              seekers.forEach(s => {
                  this.rangeGraphics.strokeCircle(s.x, s.y, range);
                  this.rangeGraphics.fillCircle(s.x, s.y, range);
              });
          }
      }

      // 2. Selected Unit Ranges
      if (this.selectedUnitIds.size > 0) {
          this.selectedUnitIds.forEach(id => {
              const unit = this.currentUnits.find(u => u.id === id);
              if (unit && unit.ownerId === socket.id && unit.range && unit.range > 0) {
                  this.rangeGraphics.lineStyle(1, 0xFFFFFF, 0.5); // White ring
                  this.rangeGraphics.strokeCircle(unit.x, unit.y, unit.range);
              }
          });
      }

      // 3. Selected Building Ranges
      if (this.selectedBuildingIds.size > 0 && this.currentMap) {
          this.currentMap.islands.forEach(island => {
              island.buildings.forEach(b => {
                  if (this.selectedBuildingIds.has(b.id)) {
                       // Calculate absolute position
                       const bx = island.x + (b.x || 0);
                       const by = island.y + (b.y || 0);
                       
                       // Check range property
                       const range = b.range || 0;

                       if (range > 0) {
                           this.rangeGraphics.lineStyle(1, 0xFFFFFF, 0.5);
                           this.rangeGraphics.strokeCircle(bx, by, range);
                       }
                  }
              });
          });
      }
  }

  centerCameraOnBase(): boolean {
      if (!this.currentMap) return false;

      // Find player's base
      let myBase: { x: number, y: number } | null = null;
      
      for (const island of this.currentMap.islands) {
          const foundBase = island.buildings.find(b => b.type === 'base' && b.ownerId === socket.id);
          if (foundBase) {
              myBase = {
                  x: island.x + (foundBase.x || 0),
                  y: island.y + (foundBase.y || 0)
              };
              break;
          }
      }

      if (myBase) {
          this.cameras.main.centerOn(myBase.x, myBase.y);
          return true;
      } else {
          // Fallback to island ownership (legacy/classic mode)
          const myIsland = this.currentMap.islands.find(i => i.ownerId === socket.id);
          if (myIsland) {
              this.cameras.main.centerOn(myIsland.x, myIsland.y);
              return true;
          }
      }
      return false;
  }

  private drawDebugOverlays() {
        this.debugGraphics.clear();
        this.debugTextGroup.clear(true, true);
        if (!this.lastDebugData || this.lastDebugData.length === 0) return;
        let index = 0;
        this.lastDebugData.forEach(bot => {
            let color = 0xffffff;
            if (bot.currentGoal === 'EXPAND') color = 0x00ff00;
            else if (bot.currentGoal === 'ATTACK') color = 0xff0000;
            else if (bot.currentGoal === 'DEFEND') color = 0x0000ff;
            if (bot.target) {
                this.debugGraphics.lineStyle(2, color, 0.5);
                this.debugGraphics.strokeCircle(bot.target.x, bot.target.y, 20);
                this.debugGraphics.lineBetween(bot.target.x - 10, bot.target.y, bot.target.x + 10, bot.target.y);
                this.debugGraphics.lineBetween(bot.target.x, bot.target.y - 10, bot.target.x, bot.target.y + 10);
            }
            if (bot.intents && bot.intents.length > 0) {
                bot.intents.forEach((intent: any) => {
                    if (intent.type === 'move') {
                        this.debugGraphics.lineStyle(1, color, 0.3);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        const angle = Phaser.Math.Angle.Between(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        const arrowLen = 10;
                        this.debugGraphics.lineBetween(
                            intent.to.x, intent.to.y,
                            intent.to.x - Math.cos(angle - Math.PI/6) * arrowLen,
                            intent.to.y - Math.sin(angle - Math.PI/6) * arrowLen
                        );
                        this.debugGraphics.lineBetween(
                            intent.to.x, intent.to.y,
                            intent.to.x - Math.cos(angle + Math.PI/6) * arrowLen,
                            intent.to.y - Math.sin(angle + Math.PI/6) * arrowLen
                        );
                    } else if (intent.type === 'build') {
                        this.debugGraphics.lineStyle(2, 0xffff00, 0.5);
                        this.debugGraphics.strokeRect(intent.to.x - 20, intent.to.y - 20, 40, 40);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                    } else if (intent.type === 'debug_line') {
                        const colorHex = intent.color === 'red' ? 0xff0000 : intent.color === 'cyan' ? 0x00ffff : 0xffffff;
                        this.debugGraphics.lineStyle(2, colorHex, 0.8);
                        this.debugGraphics.lineBetween(intent.from.x, intent.from.y, intent.to.x, intent.to.y);
                        this.debugGraphics.strokeCircle(intent.to.x, intent.to.y, 5);
                        const label = intent.label || `Target: ${Math.round(intent.to.x)}, ${Math.round(intent.to.y)}`;
                        const text = this.add.text(intent.to.x, intent.to.y - 20, label, { fontSize: '12px', color: '#ffffff', backgroundColor: '#000000' });
                        text.setOrigin(0.5);
                        this.debugTextGroup.add(text);
                    }
                });
            }
            const progression = bot.progression || {};
            const defence = progression.defence || {};
            const idle = progression.idle || {};
            const mapType = progression.mapType || 'unknown';
            const towersBuilt = defence.towersBuilt ?? 0;
            const towersTarget = defence.towersTarget ?? 0;
            const wallNodesPlaced = defence.wallNodesPlaced ?? 0;
            const wallNodesTarget = defence.wallNodesTarget ?? 0;
            const wallConnections = defence.wallConnections ?? 0;
            const wallConnectionsExpected = defence.wallConnectionsExpected ?? 0;
            const skipReason = defence.lastSkipReason || 'NONE';
            const defenceStatus =
                (bot.baseDefenseStatus as string) ||
                (bot.baseDefenseStatusRaw as string) ||
                (bot.baseDefenseBuilderStatus as string) ||
                (bot.status as string) ||
                (bot.currentGoal as string) ||
                'UNKNOWN';
            const line = `Defence [${bot.playerId}] map=${mapType} state=${defenceStatus} Towers=${towersBuilt}/${towersTarget} Nodes=${wallNodesPlaced}/${wallNodesTarget} Walls=${wallConnections}/${wallConnectionsExpected} Idle=${idle.idleSeconds ?? 0}s skip=${skipReason}`;
            const overlayText = this.add.text(10, 20 + index * 16, line, { fontSize: '12px', color: '#ffffff', backgroundColor: '#000000' });
            overlayText.setScrollFactor(0);
            overlayText.setDepth(2001);
            this.debugTextGroup.add(overlayText);
            index += 1;
        });
    }

    private getKey(key: string): Phaser.Input.Keyboard.Key {
      if (!this.keyCache.has(key)) {
          this.keyCache.set(key, this.input.keyboard!.addKey(key));
      }
      return this.keyCache.get(key)!;
  }

  update(time: number, delta: number) {
        if (this.showDebugView) {
            this.drawDebugOverlays();
        }
        
        if (this.isMenuMode) {
          this.updateMenuAnimation(time, delta);
          return;
      }

      const dt = delta / 16.66; // Normalize to ~60FPS
      const dtSec = delta / 1000;

      this.updateOilScanner();
      this.renderRangeRings();

      // Pulse Animations (moved from update to ensure they run)
      this.oilAnimations.forEach(anim => {
          anim.timer += delta;
          const scale = 1 + Math.sin(anim.timer * 0.005) * 0.2;
          anim.pulse.setScale(scale);
          anim.pulse.setAlpha(0.5 - Math.sin(anim.timer * 0.005) * 0.2);
      });



    // Unit Interpolation
      const renderTime = Date.now() - 100; // 100ms interpolation delay
      
      this.currentUnits.forEach(unit => {
          const container = this.unitContainers.get(unit.id);
          if (!container) return;

          // 1. Client-Side Prediction Logic
          if (this.predictedMoves.has(unit.id)) {
              const prediction = this.predictedMoves.get(unit.id)!;
              
              // Physics Update (Arcadey: High Accel, Instant Turn)
              const ACCEL = 800; 
              const DECEL = 1600;

              if (prediction.vx === undefined) prediction.vx = 0;
              if (prediction.vy === undefined) prediction.vy = 0;

              let currentSpeed = Math.hypot(prediction.vx, prediction.vy);
              
              const dx = prediction.targetX - container.x;
              const dy = prediction.targetY - container.y;
              const distToTarget = Math.sqrt(dx*dx + dy*dy);
              
              let shouldMove = false;
              let dirX = 0, dirY = 0;

              if (distToTarget > 2) {
                   dirX = dx / distToTarget;
                   dirY = dy / distToTarget;
                   shouldMove = true;
              }

              if (shouldMove) {
                   currentSpeed += ACCEL * dtSec;
                   if (currentSpeed > prediction.speed) currentSpeed = prediction.speed;
                   prediction.vx = dirX * currentSpeed;
                   prediction.vy = dirY * currentSpeed;
              } else {
                   currentSpeed -= DECEL * dtSec;
                   if (currentSpeed < 0) currentSpeed = 0;
                   if (currentSpeed > 0 && Math.hypot(prediction.vx, prediction.vy) > 0.01) {
                        const vAngle = Math.atan2(prediction.vy, prediction.vx);
                        prediction.vx = Math.cos(vAngle) * currentSpeed;
                        prediction.vy = Math.sin(vAngle) * currentSpeed;
                   } else {
                        prediction.vx = 0;
                        prediction.vy = 0;
                   }
              }

              container.setPosition(container.x + prediction.vx * dtSec, container.y + prediction.vy * dtSec);

              if (!shouldMove && currentSpeed < 1) {
                   container.setPosition(prediction.targetX, prediction.targetY);
                   this.predictedMoves.delete(unit.id);
              }

              // Reconciliation: Check if server disagrees significantly
              const serverDist = Phaser.Math.Distance.Between(container.x, container.y, unit.x, unit.y);
              
              // Dynamic Thresholds based on Connection Type
              // Tunnel/Internet: More lenient to prevent rubber-banding due to latency/jitter
              // Local: Stricter for responsiveness
              const isTunnel = (this.game.registry.get('socket') as any)?.isTunnel; 
              const SNAP_THRESHOLD = isTunnel ? 120 : 60; 
              const SMOOTH_THRESHOLD = isTunnel ? 30 : 15;
              
              // 1. Intent Mismatch
              if (unit.intentId && unit.intentId !== prediction.intentId) {
                  this.predictedMoves.delete(unit.id);
              }
              // 2. Distance Divergence
              else if (serverDist > SNAP_THRESHOLD) { 
                  // Snap back to server authoritative state
                  this.predictedMoves.delete(unit.id);
              } 
              // 3. Smooth Correction
              else if (serverDist > SMOOTH_THRESHOLD) {
                  // Nudge towards server
                  container.x = Phaser.Math.Linear(container.x, unit.x, 0.1);
                  container.y = Phaser.Math.Linear(container.y, unit.y, 0.1);
                  return; // Still use predicted position (but nudged)
              } else {
                  return; // Skip interpolation, use predicted position
              }
          }

          const history = this.unitUpdates.get(unit.id);
          if (!history || history.length < 2) {
               container.setPosition(unit.x, unit.y);
               return;
          }

          // Find the two updates surrounding renderTime
          let p1 = history[0];
          let p2 = history[1];
          
          // If we have history, try to find the segment that contains renderTime
          for (let i = 1; i < history.length; i++) {
              if (history[i].time >= renderTime) {
                  p1 = history[i - 1];
                  p2 = history[i];
                  break;
              }
          }

          // Fix: Prevent sliding from 0,0 by detecting large jumps or invalid start positions
          const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
          
          // If distance is huge (>300) OR we are currently at 0,0 (invalid spawn), snap immediately
          if (dist > 300 || (container.x === 0 && container.y === 0 && p2.x !== 0)) {
               container.setPosition(p2.x, p2.y);
          } else if (p1.time === p2.time || renderTime <= p1.time) {
              container.setPosition(p1.x, p1.y);
          } else if (renderTime >= p2.time) {
               container.setPosition(p2.x, p2.y);
          } else {
              const t = (renderTime - p1.time) / (p2.time - p1.time);
              const x = p1.x + (p2.x - p1.x) * t;
              const y = p1.y + (p2.y - p1.y) * t;
              container.setPosition(x, y);
          }
      });

      // Tumbleweeds
      this.tumbleweeds.forEach(t => {
          t.sprite.x += t.dx * dt;
          t.sprite.y += t.dy * dt;
          t.sprite.rotation += 0.05 * dt;
          
          t.life -= dtSec;
          if (t.life <= 0) {
              // Respawn
              t.life = 5;
              if (t.bounds && t.poly) {
                  let placed = false;
                  for(let i=0; i<5; i++) {
                      const rx = t.bounds.x + Math.random() * t.bounds.width;
                      const ry = t.bounds.y + Math.random() * t.bounds.height;
                      if (Phaser.Geom.Polygon.Contains(t.poly, rx, ry)) {
                          t.sprite.x = rx;
                          t.sprite.y = ry;
                          placed = true;
                          break;
                      }
                  }
                  if (!placed) {
                      t.sprite.x = t.bounds.centerX;
                      t.sprite.y = t.bounds.centerY;
                  }
              }
          } else {
               // Keep in bounds
               if (t.bounds) {
                   if (t.sprite.x < t.bounds.x) t.sprite.x = t.bounds.right;
                   if (t.sprite.x > t.bounds.right) t.sprite.x = t.bounds.x;
                   if (t.sprite.y < t.bounds.y) t.sprite.y = t.bounds.bottom;
                   if (t.sprite.y > t.bounds.bottom) t.sprite.y = t.bounds.y;
               }
          }
      });

      // Weather Particles (Rain)
      this.weatherParticles.forEach(p => {
          p.sprite.x += p.dx * dt;
          p.sprite.y += p.dy * dt;
          
          p.life -= dtSec;
          if (p.life <= 0) {
              p.life = 5;
              // Respawn
              if (p.bounds && p.poly) {
                  let placed = false;
                  for(let i=0; i<5; i++) {
                      const rx = p.bounds.x + Math.random() * p.bounds.width;
                      const ry = p.bounds.y + Math.random() * p.bounds.height;
                      if (Phaser.Geom.Polygon.Contains(p.poly, rx, ry)) {
                          p.sprite.x = rx;
                          p.sprite.y = ry;
                          placed = true;
                          break;
                      }
                  }
                  if (!placed) {
                      p.sprite.x = p.bounds.centerX;
                      p.sprite.y = p.bounds.centerY;
                  }
              }
          } else {
               // Wrap
               if (p.bounds) {
                  if (p.sprite.y > p.bounds.bottom) p.sprite.y = p.bounds.y;
                  if (p.sprite.x > p.bounds.right) p.sprite.x = p.bounds.x;
                  if (p.sprite.x < p.bounds.x) p.sprite.x = p.bounds.right;
               }
          }
      });
      
      // Oil Animations
      const cycleTime = 5000;
      const activeTime = 3000;
      this.oilAnimations.forEach(anim => {
          // Skip if hidden
          const visuals = this.oilSpotVisuals.get(anim.id);
          if (visuals && !visuals.main.visible) {
              anim.pulse.setVisible(false);
              return;
          }

          anim.timer += delta;
          if (anim.timer >= cycleTime) {
              anim.timer = 0;
          }

          if (anim.timer < activeTime) {
              anim.pulse.setVisible(true);
              const progress = anim.timer / activeTime;
              anim.pulse.setScale(1 + (progress * 1.5)); // 1 -> 2.5
              anim.pulse.setAlpha(1 - progress); // 1 -> 0
          } else {
              anim.pulse.setVisible(false);
          }
      });

      // Camera Movement
      // Spectators get faster movement
      const baseSpeed = this.isSpectating ? 40 : 20;
      const binds = settingsManager.getSettings().keybinds;

      // Broadcast FPS (throttled to every ~500ms to avoid React churn)
      if (this.game.loop.frame % 30 === 0) {
          window.dispatchEvent(new CustomEvent('fps-update', { 
              detail: { fps: Math.round(this.game.loop.actualFps) } 
          }));
      }

      // Helper to check key status safely
      const isKeyDown = (key: string) => {
          return this.getKey(key).isDown;
      };

      const shiftMultiplier = isKeyDown('SHIFT') ? 2 : 1;
      const speed = (baseSpeed * shiftMultiplier) / this.cameras.main.zoom; 

      if (isKeyDown(binds.cameraUp) || isKeyDown('W') || isKeyDown('UP')) this.cameras.main.scrollY -= speed;
      if (isKeyDown(binds.cameraDown) || isKeyDown('S') || isKeyDown('DOWN')) this.cameras.main.scrollY += speed;
      if (isKeyDown(binds.cameraLeft) || isKeyDown('A') || isKeyDown('LEFT')) this.cameras.main.scrollX -= speed;
      if (isKeyDown(binds.cameraRight) || isKeyDown('D') || isKeyDown('RIGHT')) this.cameras.main.scrollX += speed;

      if (this.getKey(binds.centerCamera).isDown) {
          this.centerCameraOnBase();
      }

      // Minimap update (throttled to camera movement)
      if (this.cameras.main.scrollX !== this.lastCameraX || this.cameras.main.scrollY !== this.lastCameraY) {
          this.lastCameraX = this.cameras.main.scrollX;
          this.lastCameraY = this.cameras.main.scrollY;
          
          const worldView = this.cameras.main.worldView;
          window.dispatchEvent(new CustomEvent('minimap-update', { 
              detail: { 
                  x: worldView.x, 
                  y: worldView.y, 
                  width: worldView.width, 
                  height: worldView.height 
              } 
          }));
      }

      // Update Path Lines
      this.pathGraphics.clear();
      // Optimization: Only draw paths for selected units to save performance
      if (this.selectedUnitIds.size > 0) {
          this.pathGraphics.fillStyle(0x00FF00, 0.5);
          this.selectedUnitIds.forEach(id => {
              const unit = this.currentUnits.find(u => u.id === id);
              if (unit && unit.ownerId === socket.id && unit.status === 'moving' && unit.targetX !== undefined && unit.targetY !== undefined) {
                  const dist = Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y);
                  const points = Math.min(50, dist / 20); // Cap dots for performance
                  const dx = (unit.targetX - unit.x) / points;
                  const dy = (unit.targetY - unit.y) / points;

                  for (let i = 0; i < points; i++) {
                      this.pathGraphics.fillCircle(unit.x + dx * i, unit.y + dy * i, 2);
                  }
              }
          });
      }
  }

  issueMoveCommand(x: number, y: number) {
      // Throttle commands (50ms debounce)
      const now = Date.now();
      if (now - this.lastCommandTime < 50) return;
      this.lastCommandTime = now;

        // Play Move Sound
        const settings = settingsManager.getSettings();
        const volume = settings.audio.masterVolume * settings.audio.sfxVolume;
        if (volume > 0 && this.selectedUnitIds.size > 0) {
            // Determine dominant unit type in selection
            let landCount = 0;
            let waterCount = 0;
            let airCount = 0;
            
            this.currentUnits.forEach(u => {
                if (this.selectedUnitIds.has(u.id)) {
                    const type = u.type;
                    if (['ship', 'destroyer', 'carrier', 'construction_ship', 'oil_tanker'].includes(type)) {
                        waterCount++;
                    } else if (['light_plane', 'heavy_plane', 'aircraft_carrier', 'mothership'].includes(type)) {
                        airCount++;
                    } else {
                        landCount++;
                    }
                }
            });

            let soundKey = 'move_land';
            if (waterCount > landCount && waterCount > airCount) soundKey = 'move_water';
            if (airCount > landCount && airCount > waterCount) soundKey = 'move_air';

            try {
                this.sound.play(soundKey, { volume: volume * 0.4 });
            } catch (e) {}
        }

        console.log('Issuing move command to:', x, y);
        
        // Process each unit individually for Hybrid Networking (Intent-based)
        this.selectedUnitIds.forEach(id => {
            const unit = this.currentUnits.find(u => u.id === id);
            if (unit) {
                const intentId = `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Client-Side Prediction: Start moving immediately
                // Optimistic direct line (Navmesh will be handled by server/steering)
                this.predictedMoves.set(id, {
                    targetX: x,
                    targetY: y,
                    speed: unit.speed || 150, // Default speed if missing
                    type: unit.type,
                    intentId: intentId
                });

                // Send Intent
                socket.emit('moveIntent', {
                    unitId: id,
                    intentId: intentId,
                    destX: x,
                    destY: y,
                    clientTime: Date.now()
                });
            }
        });

      // Visual feedback (Circle at target)
      if (settingsManager.getSettings().graphics.showParticles) {
          const circle = this.add.circle(x, y, 5, 0x00FF00);
          this.tweens.add({
              targets: circle,
              alpha: 0,
              scale: 2,
              duration: 500,
              onComplete: () => circle.destroy()
          });
      }
  }

  sendSteeringUpdates() {
      // Send MOVE_STEER at 20Hz (called from timer)
      this.predictedMoves.forEach((pred, unitId) => {
          const container = this.unitContainers.get(unitId);
          if (container) {
              // Calculate direction
              const dx = pred.targetX - container.x;
              const dy = pred.targetY - container.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist > 1) {
                  const dirX = dx / dist;
                  const dirY = dy / dist;

                  socket.emit('moveSteer', {
                      unitId: unitId,
                      intentId: pred.intentId,
                      dirX: dirX,
                      dirY: dirY
                  });
              }
          }
      });
  }

  getAdjustedTarget(unitType: string, targetX: number, targetY: number): { x: number, y: number } {
        if (!this.currentMap) return { x: targetX, y: targetY };

        // Air units ignore terrain constraints
        const isAirUnit = ['mothership', 'light_plane', 'heavy_plane', 'alien_scout', 'heavy_alien'].includes(unitType);
        if (isAirUnit) return { x: targetX, y: targetY };

        // Land units (cannot move on water)
        const isLandUnit = ['soldier', 'sniper', 'rocketeer', 'builder', 'tank', 'humvee', 'oil_seeker', 'missile_launcher'].includes(unitType);
        
        // Find closest island
        let closestIsland: Island | null = null;
        let minDist = Infinity;

        this.currentMap.islands.forEach(island => {
            const dist = Math.hypot(targetX - island.x, targetY - island.y);
            const distToEdge = dist - island.radius;
            if (distToEdge < minDist) {
                minDist = distToEdge;
                closestIsland = island;
            }
        });

        if (!closestIsland) return { x: targetX, y: targetY };

        const island = closestIsland as Island;

        if (island.points) {
             const inside = this.isPointInPolygon({x: targetX, y: targetY}, island.points);
             
             if (isLandUnit) {
                 if (!inside) {
                     // Snap to closest edge
                     const closest = this.getClosestPointOnPolygon({x: targetX, y: targetY}, island.points);
                     return closest;
                 }
             } else {
                 // Water Unit
                 if (inside) {
                     // Snap to closest edge
                     const closest = this.getClosestPointOnPolygon({x: targetX, y: targetY}, island.points);
                     return closest;
                 }
             }
        } else {
            const dx = targetX - island.x;
            const dy = targetY - island.y;
            const distFromCenter = Math.hypot(dx, dy);

            if (isLandUnit) {
                // If on water (outside radius), snap to edge
                if (distFromCenter > island.radius) {
                    const angle = Math.atan2(dy, dx);
                    return {
                        x: island.x + Math.cos(angle) * (island.radius - 5), // Slight buffer inside
                        y: island.y + Math.sin(angle) * (island.radius - 5)
                    };
                }
            } else {
                // Water units (destroyer, construction_ship, aircraft_carrier, ferry, etc.)
                // If on land (inside radius), snap to edge
                if (distFromCenter < island.radius) {
                    const angle = Math.atan2(dy, dx);
                    return {
                        x: island.x + Math.cos(angle) * (island.radius + 15), // Buffer outside
                        y: island.y + Math.sin(angle) * (island.radius + 15)
                    };
                }
            }
        }

        return { x: targetX, y: targetY };
    }

    private isPointInPolygon(p: {x: number, y: number}, polygon: {x: number, y: number}[]): boolean {
        let isInside = false;
        let minX = polygon[0].x, maxX = polygon[0].x;
        let minY = polygon[0].y, maxY = polygon[0].y;
        for (let n = 1; n < polygon.length; n++) {
            const q = polygon[n];
            minX = Math.min(q.x, minX);
            maxX = Math.max(q.x, maxX);
            minY = Math.min(q.y, minY);
            maxY = Math.max(q.y, maxY);
        }

        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
            return false;
        }

        let i = 0;
        let j = polygon.length - 1;
        for (; i < polygon.length; j = i++) {
            if ( (polygon[i].y > p.y) !== (polygon[j].y > p.y) &&
                    p.x < (polygon[j].x - polygon[i].x) * (p.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x ) {
                isInside = !isInside;
            }
        }
        return isInside;
    }

    private isValidDockPlacement(x: number, y: number): boolean {
        if (!this.currentMap) return false;
        
        // Find closest island
        let closestIsland: Island | null = null;
        let minDist = Infinity;
        
        for (const island of this.currentMap.islands) {
            const dist = Math.hypot(x - island.x, y - island.y);
            // Quick bounding box check
            if (dist < island.radius + 100) { 
                if (dist < minDist) {
                    minDist = dist;
                    closestIsland = island;
                }
            }
        }
        
        if (!closestIsland || !closestIsland.points) return false;
        
        // Check distance to polygon edge
        // Points in Island are absolute
        const closestPoint = this.getClosestPointOnPolygon({x, y}, closestIsland.points);
        const distToEdge = Math.hypot(x - closestPoint.x, y - closestPoint.y);
        
        return distToEdge <= 20; // 20px tolerance matches server
    }

    private getClosestPointOnPolygon(p: {x: number, y: number}, points: {x: number, y: number}[]): {x: number, y: number} {
        let minD2 = Infinity;
        let closest = points[0];

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            
            const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
            if (l2 === 0) continue;
            
            let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            
            const d2 = (p.x - projX) ** 2 + (p.y - projY) ** 2;
            if (d2 < minD2) {
                minD2 = d2;
                closest = {x: projX, y: projY};
            }
        }
        return closest;
    }

  drawDetailedBuilding(x: number, y: number, type: string, color: number, data?: any): Phaser.GameObjects.Container {
      const container = this.add.container(x, y);
      
      // Base Shape
      const base = this.add.rectangle(0, 0, 24, 24, color);
      base.setStrokeStyle(2, 0x000000);
      container.add(base);

      // Detail
      if (type === 'mine') {
          const gold = this.add.circle(0, 0, 6, 0xFFD700);
          gold.setStrokeStyle(1, 0xDAA520);
          const track = this.add.rectangle(0, 8, 20, 4, 0x5C4033); // Rails
          const cart = this.add.rectangle(0, 8, 8, 6, 0x333333); // Cart
          const pick = this.add.text(-4, -6, '⛏️', { fontSize: '10px' });
          container.add(gold);
          container.add(track);
          container.add(cart);
          container.add(pick);
      } else if (type === 'tower') {
          const baseRect = this.add.rectangle(0, 5, 18, 12, 0x555555);
          const mid = this.add.rectangle(0, -2, 14, 14, 0x666666);
          const top = this.add.rectangle(0, -10, 18, 6, 0x777777);
          // Battlements
          const b1 = this.add.rectangle(-6, -14, 4, 4, 0x777777);
          const b2 = this.add.rectangle(0, -14, 4, 4, 0x777777);
          const b3 = this.add.rectangle(6, -14, 4, 4, 0x777777);
          
          const turret = this.add.circle(0, -4, 4, 0x222222);
          const cannon = this.add.line(0, -4, 0, 0, 10, 0, 0x000000);
          
          container.add(baseRect);
          container.add(mid);
          container.add(top);
          container.add(b1);
          container.add(b2);
          container.add(b3);
          container.add(turret);
          container.add(cannon);
      } else if (type === 'barracks') {
          const main = this.add.rectangle(0, 4, 22, 14, 0x8B4513);
          const roof = this.add.triangle(0, -8, -14, 4, 14, 4, 0, -10, 0xA0522D);
          const door = this.add.rectangle(0, 8, 8, 8, 0x000000);
          const window1 = this.add.rectangle(-6, 2, 4, 4, 0x87CEEB);
          const window2 = this.add.rectangle(6, 2, 4, 4, 0x87CEEB);
          const flag = this.add.rectangle(8, -8, 6, 4, 0xFF0000);
          const pole = this.add.line(8, -4, 0, 0, 0, -8, 0x000000);
          
          container.add(main);
          container.add(roof);
          container.add(door);
          container.add(window1);
          container.add(window2);
          container.add(pole);
          container.add(flag);
      } else if (type === 'dock') {
          base.setVisible(false); // Custom base for dock
          const plank = this.add.rectangle(0, 0, 28, 16, 0xDEB887);
          plank.setStrokeStyle(1, 0x8B4513);
          const post1 = this.add.circle(-12, -6, 3, 0x8B4513);
          const post2 = this.add.circle(12, -6, 3, 0x8B4513);
          const post3 = this.add.circle(-12, 6, 3, 0x8B4513);
          const post4 = this.add.circle(12, 6, 3, 0x8B4513);
          const craneBase = this.add.rectangle(-8, -4, 6, 6, 0x555555);
          const craneArm = this.add.line(-8, -4, 0, 0, 10, 10, 0x333333);
          
          container.add(plank);
          container.add(post1);
          container.add(post2);
          container.add(post3);
          container.add(post4);
          container.add(craneBase);
          container.add(craneArm);
      } else if (type === 'base') {
          // Improved Command Center Visual
          const main = this.add.rectangle(0, 0, 32, 24, 0x4B0082); // Wider base
          main.setStrokeStyle(2, 0x000000);
          
          const mid = this.add.rectangle(0, -6, 20, 16, 0x6A5ACD); // Mid tier
          mid.setStrokeStyle(1, 0x000000);
          
          // Radar Dish
          const dish = this.add.arc(8, -14, 6, 0, 180, false, 0xCCCCCC);
          dish.setStrokeStyle(1, 0x000000);
          
          // Flag
          const flagPole = this.add.line(-8, -14, 0, 0, 0, -12, 0xFFFFFF);
          const flag = this.add.rectangle(-4, -22, 8, 5, 0xFF0000);

          // Star Icon
          const star = this.add.text(-4, -4, '⭐', { fontSize: '12px', align: 'center' });
          star.setOrigin(0.5, 0.5);

          container.add(main);
          container.add(mid);
          container.add(dish);
          container.add(flagPole);
          container.add(flag);
          container.add(star);

          // Tesla Upgrade Visual
          if (data && data.hasTesla) {
              const coilBase = this.add.rectangle(0, -14, 10, 4, 0x444444);
              
              // Tesla Coil Shape (Blue glowing rings)
              const t1 = this.add.ellipse(0, -18, 12, 4, 0x00FFFF, 0.5);
              const t2 = this.add.ellipse(0, -22, 10, 4, 0x00FFFF, 0.5);
              const t3 = this.add.ellipse(0, -26, 8, 4, 0x00FFFF, 0.5);
              const topBall = this.add.circle(0, -30, 4, 0xFFFFFF);
              
              // Pulse animation
              this.tweens.add({
                  targets: [t1, t2, t3, topBall],
                  alpha: 0.2,
                  duration: 500,
                  yoyo: true,
                  repeat: -1
              });

              container.add(coilBase);
              container.add(t1);
              container.add(t2);
              container.add(t3);
              container.add(topBall);
          }
      } else if (type === 'oil_rig') {
          const platform = this.add.rectangle(0, 0, 24, 24, 0x333333);
          const drill = this.add.triangle(0, -8, -8, 8, 8, 8, 0, -10, 0x111111);
          const pipe = this.add.rectangle(0, 0, 4, 20, 0x000000);
          const flame = this.add.circle(0, -12, 3, 0xFF4500); // Burning gas
          
          this.tweens.add({
              targets: flame,
              scale: 1.5,
              alpha: 0.5,
              yoyo: true,
              repeat: -1,
              duration: 500
          });

          container.add(platform);
          container.add(pipe);
          container.add(drill);
          container.add(flame);
      } else if (type === 'oil_well') {
          // Detailed Oil Well Visual
          const base = this.add.rectangle(0, 0, 28, 24, 0x2F4F4F); // Dark Slate Grey Base
          base.setStrokeStyle(2, 0x000000);
          
          // Concrete Foundation
          const foundation = this.add.rectangle(0, 8, 32, 8, 0x555555);
          
          // Derrick Tower (Steel Lattice)
          const towerL = this.add.line(-6, 0, 0, 10, 6, -14, 0x333333);
          const towerR = this.add.line(6, 0, 0, 10, -6, -14, 0x333333);
          const cross1 = this.add.line(0, -4, -4, 0, 4, 0, 0x333333);
          const cross2 = this.add.line(0, 2, -5, 0, 5, 0, 0x333333);
          
          // Pump Jack Mechanism
          const pivot = this.add.circle(0, -6, 2, 0x111111);
          
          // Walking Beam (Animated)
          const beam = this.add.rectangle(0, -10, 20, 4, 0x8B0000); // Dark Red Beam
          const horseHead = this.add.arc(10, -10, 4, 0, 180, false, 0x8B0000);
          
          // Counterweight (Rear)
          const counterWeight = this.add.rectangle(-8, -6, 6, 8, 0x222222);
          
          // Oil Tank (Storage)
          const tank = this.add.circle(10, 6, 6, 0x4682B4); // Steel Blue Tank
          tank.setStrokeStyle(1, 0x000000);
          const pipe = this.add.line(0, 0, 4, 6, 10, 6, 0x555555); // Connecting pipe

          // Animation: Pump Jack Rocking
          this.tweens.add({
              targets: [beam, horseHead],
              angle: { from: -15, to: 15 },
              y: { from: -10, to: -8 }, // Slight bobbing
              yoyo: true,
              repeat: -1,
              duration: 1500,
              ease: 'Sine.easeInOut'
          });
          
          // Counterweight moves opposite
          this.tweens.add({
              targets: counterWeight,
              y: { from: -6, to: -2 },
              yoyo: true,
              repeat: -1,
              duration: 1500,
              ease: 'Sine.easeInOut'
          });

          container.add(base);
          container.add(foundation);
          container.add(towerL);
          container.add(towerR);
          container.add(cross1);
          container.add(cross2);
          container.add(tank);
          container.add(pipe);
          container.add(counterWeight);
          container.add(pivot);
          container.add(beam);
          container.add(horseHead);
      } else if (type === 'farm') {
          // Farm Visual - High Detail
          const base = this.add.rectangle(0, 0, 24, 24, 0x8FBC8F); // DarkSeaGreen base
          base.setStrokeStyle(1, 0x006400);
          
          // Field rows
          const row1 = this.add.rectangle(-6, 0, 2, 20, 0x3E2723);
          const row2 = this.add.rectangle(6, 0, 2, 20, 0x3E2723);

          // Crops (Wheat) with sway animation
          const crops: Phaser.GameObjects.Rectangle[] = [];
          for(let i=-8; i<=8; i+=4) {
             const c1 = this.add.rectangle(-6, i, 4, 4, 0xFFD700);
             const c2 = this.add.rectangle(6, i, 4, 4, 0xFFD700);
             crops.push(c1, c2);
          }
          
          this.tweens.add({
              targets: crops,
              angle: { from: -10, to: 10 },
              yoyo: true,
              duration: 2000,
              repeat: -1,
              ease: 'Sine.easeInOut'
          });

          // Barn/Silo (Detailed)
          const barn = this.add.rectangle(0, -2, 12, 12, 0xA52A2A); // Red Barn
          const door = this.add.rectangle(0, 0, 6, 8, 0x333333);
          const roof = this.add.triangle(0, -10, -8, 0, 8, 0, 0, -8, 0x8B0000); // Dark Red Roof
          
          // Silo
          const silo = this.add.rectangle(10, -2, 6, 14, 0xC0C0C0);
          const siloRoof = this.add.arc(10, -9, 3, 180, 360, false, 0xAAAAAA);
          
          container.add(base);
          container.add(row1);
          container.add(row2);
          crops.forEach(c => container.add(c));
          container.add(barn);
          container.add(door);
          container.add(roof);
          container.add(silo);
          container.add(siloRoof);

      } else if (type === 'wall') {
          // Wall Visual - Stone/Fortified
          const w = this.add.rectangle(0, 0, 24, 8, 0x708090); // Slate Grey
          w.setStrokeStyle(1, 0x2F4F4F);
          
          // Bricks/Stones pattern
          const b1 = this.add.rectangle(-8, -2, 6, 3, 0x808080);
          const b2 = this.add.rectangle(0, 2, 6, 3, 0x808080);
          const b3 = this.add.rectangle(8, -2, 6, 3, 0x808080);
          
          // Battle Damage (Random Cracks)
          const crack = this.add.line(0, 0, -2, -2, 2, 2, 0x000000);
          crack.setAlpha(0.5);

          container.add(w);
          container.add(b1);
          container.add(b2);
          container.add(b3);
          container.add(crack);
      } else if (type === 'bridge_node') {
          const w = this.add.circle(0, 0, 8, 0x8B4513);
          w.setStrokeStyle(2, 0x000000);
          const inner = this.add.circle(0, 0, 4, 0xDEB887);
          container.add(w);
          container.add(inner);
      } else if (type === 'wall_node') {
          const w = this.add.rectangle(0, 0, 16, 16, 0x555555);
          w.setStrokeStyle(2, 0x000000);
          const inner = this.add.rectangle(0, 0, 8, 8, 0x888888);
          container.add(w);
          container.add(inner);
      } else if (type === 'tank_factory') {
          // Advanced Tank Factory Visual
          // Main Base (Concrete/Industrial)
          const main = this.add.rectangle(0, 0, 36, 28, 0x333333); // Dark Grey Concrete
          main.setStrokeStyle(2, 0x111111);
          
          // Factory Floor Markings
          const stripe = this.add.rectangle(0, 0, 32, 24, 0x444444);
          const hazardStripes = this.add.graphics();
          hazardStripes.fillStyle(0xFFFF00, 0.5);
          for(let i=-14; i<14; i+=6) {
             hazardStripes.fillRect(i, -12, 2, 24);
          }

          // Large Assembly Bay Roof
          const roof = this.add.rectangle(0, -6, 30, 18, 0x556B2F); // Military Green
          roof.setStrokeStyle(1, 0x222222);
          
          // Skylights/Vents
          const vent1 = this.add.rectangle(-8, -8, 6, 4, 0x88CCFF);
          const vent2 = this.add.rectangle(0, -8, 6, 4, 0x88CCFF);
          const vent3 = this.add.rectangle(8, -8, 6, 4, 0x88CCFF);

          // Smokestacks (Industrial Pollution)
          const s1 = this.add.rectangle(-12, -16, 4, 10, 0x222222);
          const s2 = this.add.rectangle(-6, -16, 4, 10, 0x222222);
          
          // Smoke Particles
          const smoke1 = this.add.circle(-12, -22, 3, 0x555555, 0.6);
          const smoke2 = this.add.circle(-6, -24, 4, 0x555555, 0.6);
          
          this.tweens.add({
              targets: [smoke1, smoke2],
              y: '-=15',
              alpha: 0,
              scale: 2,
              duration: 1500,
              repeat: -1
          });

          // Large Roll-up Door (for tanks to exit)
          const doorFrame = this.add.rectangle(10, 8, 14, 12, 0x222222);
          const door = this.add.rectangle(10, 8, 12, 10, 0x333333);
          // Door slats
          const slats = this.add.graphics();
          slats.lineStyle(1, 0x111111);
          for(let i=4; i<12; i+=2) {
              slats.moveTo(4, i);
              slats.lineTo(16, i);
          }
          slats.strokePath();

          // Crane/Gantry
          const craneBase = this.add.rectangle(-14, 10, 4, 12, 0xFFFF00); // Safety Yellow
          const craneArm = this.add.rectangle(-10, 4, 12, 2, 0xFFFF00);

          container.add(main);
          container.add(stripe);
          container.add(hazardStripes);
          container.add(roof);
          container.add(vent1);
          container.add(vent2);
          container.add(vent3);
          container.add(s1);
          container.add(s2);
          container.add(smoke1);
          container.add(smoke2);
          container.add(doorFrame);
          container.add(door);
          container.add(slats);
          container.add(craneBase);
          container.add(craneArm);
      } else if (type === 'air_base') {
          // Air Base Visual
          // Concrete Tarmac
          const tarmac = this.add.rectangle(0, 0, 40, 30, 0x555555);
          tarmac.setStrokeStyle(2, 0x222222);
          
          // Runway Markings
          const runway = this.add.rectangle(0, 5, 36, 10, 0x333333);
          const line = this.add.rectangle(0, 5, 28, 1, 0xFFFFFF); // Center line
          
          // Hangar
          const hangar = this.add.rectangle(-10, -8, 18, 12, 0x4682B4); // Steel Blue Hangar
          hangar.setStrokeStyle(1, 0x000000);
          const roof = this.add.arc(-10, -14, 9, 180, 360, false, 0x87CEEB); // Rounded Roof
          (roof as Phaser.GameObjects.Arc).setClosePath(true);
          
          // Control Tower
          const towerBase = this.add.rectangle(12, -8, 8, 14, 0xAAAAAA);
          const towerTop = this.add.rectangle(12, -16, 10, 6, 0x222222); // Windows
          const towerRoof = this.add.rectangle(12, -20, 10, 2, 0x555555);
          
          // Radar Dish on Tower
          const dish = this.add.arc(12, -24, 4, 180, 360, false, 0xCCCCCC);
          this.tweens.add({
              targets: dish,
              angle: { from: -20, to: 20 },
              yoyo: true,
              duration: 1500,
              repeat: -1
          });
          
          // Windsock
          const pole = this.add.line(-16, -16, 0, 0, 0, 10, 0x000000);
          const sock = this.add.triangle(-14, -20, -16, -18, -16, -22, -8, -20, 0xFF4500); // Orange Windsock
          
          container.add(tarmac);
          container.add(runway);
          container.add(line);
          container.add(hangar);
          container.add(roof);
          container.add(towerBase);
          container.add(towerTop);
          container.add(towerRoof);
          container.add(dish);
          container.add(pole);
          container.add(sock);
      }

      return container;
  }

  drawDetailedUnit(x: number, y: number, type: string, color: number, isSelected: boolean): Phaser.GameObjects.Container {
      const container = this.add.container(x, y);

      if (type === 'soldier') {
          // Detailed Soldier
          // Legs (Dark Green)
          const leftLeg = this.add.rectangle(-4, 8, 6, 6, 0x006400);
          leftLeg.setStrokeStyle(1, 0x000000);
          const rightLeg = this.add.rectangle(4, 8, 6, 6, 0x006400);
          rightLeg.setStrokeStyle(1, 0x000000);

          // Body (Green Uniform)
          const body = this.add.rectangle(0, 0, 16, 10, 0x228B22);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Backpack (Tan)
          const backpack = this.add.rectangle(-6, 0, 4, 8, 0xD2B48C);
          backpack.setStrokeStyle(1, 0x000000);

          // Head (Skin)
          const head = this.add.circle(0, -8, 5, 0xFFD1AA);
          head.setStrokeStyle(1, 0x000000);

          // Helmet (Dark Green)
          const helmet = this.add.arc(0, -9, 6, 180, 360, false, 0x006400);
          (helmet as Phaser.GameObjects.Arc).setClosePath(true);
          helmet.setStrokeStyle(1, 0x000000);
          
          // Arms
          const leftArm = this.add.circle(-9, 0, 3, 0xFFD1AA);
          const rightArm = this.add.circle(9, 0, 3, 0xFFD1AA);

          // Rifle (Detailed)
          const rifleStock = this.add.rectangle(4, 2, 6, 3, 0x333333); 
          const rifleBarrel = this.add.rectangle(10, 2, 8, 2, 0x111111);
          
          container.add(leftLeg);
          container.add(rightLeg);
          container.add(backpack);
          container.add(body);
          container.add(leftArm);
          container.add(rightArm);
          container.add(rifleStock);
          container.add(rifleBarrel);
          container.add(head);
          container.add(helmet);
      } else if (type === 'tank') {
          // Detailed Tank Body (Green Camo Base)
          const body = this.add.rectangle(0, 0, 20, 14, 0x006400);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Camo Pattern
          const camo1 = this.add.circle(-5, -3, 3, 0x556B2F);
          const camo2 = this.add.circle(6, 4, 2, 0x556B2F);
          const camo3 = this.add.rectangle(-6, 4, 4, 3, 0x556B2F);

          // Detailed Treads
          const leftTread = this.add.rectangle(0, -8, 22, 5, 0x111111);
          const rightTread = this.add.rectangle(0, 8, 22, 5, 0x111111);
          
          // Tread Wheels (Silver dots)
          const lw1 = this.add.circle(-8, -8, 1.5, 0x555555);
          const lw2 = this.add.circle(0, -8, 1.5, 0x555555);
          const lw3 = this.add.circle(8, -8, 1.5, 0x555555);
          const rw1 = this.add.circle(-8, 8, 1.5, 0x555555);
          const rw2 = this.add.circle(0, 8, 1.5, 0x555555);
          const rw3 = this.add.circle(8, 8, 1.5, 0x555555);

          // Turret
          const turret = this.add.rectangle(0, 0, 12, 10, 0x004400);
          turret.setStrokeStyle(1, 0x000000);

          // Hatch
          const hatch = this.add.circle(-2, -2, 2.5, 0x003300);

          // Barrel (with muzzle)
          const barrel = this.add.rectangle(10, 0, 14, 3, 0x004400);
          barrel.setStrokeStyle(1, 0x000000);
          const muzzle = this.add.rectangle(17, 0, 2, 4, 0x000000);

          // Exhaust
          const exhaust = this.add.rectangle(-10, 3, 4, 2, 0x333333);

          container.add(leftTread);
          container.add(rightTread);
          container.add(lw1); container.add(lw2); container.add(lw3);
          container.add(rw1); container.add(rw2); container.add(rw3);
          container.add(body);
          container.add(camo1); container.add(camo2); container.add(camo3);
          container.add(exhaust);
          container.add(barrel);
          container.add(muzzle);
          container.add(turret);
          container.add(hatch);

      } else if (type === 'humvee') {
          // Detailed Humvee Body (Tan)
          const body = this.add.rectangle(0, 0, 20, 11, 0xD2B48C);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Hood details
          const hoodVent = this.add.rectangle(6, 0, 4, 6, 0x8B4513);
          hoodVent.setAlpha(0.5);

          // Wheels (with tread detail)
          const w1 = this.add.rectangle(-7, -7, 5, 3, 0x111111);
          const w2 = this.add.rectangle(7, -7, 5, 3, 0x111111);
          const w3 = this.add.rectangle(-7, 7, 5, 3, 0x111111);
          const w4 = this.add.rectangle(7, 7, 5, 3, 0x111111);

          // Windshield & Windows
          const windshield = this.add.rectangle(2, 0, 3, 8, 0x87CEEB);
          const rearWindow = this.add.rectangle(-8, 0, 2, 6, 0x87CEEB);

          // Roof Gun Mount
          const mount = this.add.circle(-2, 0, 3, 0x555555);
          const gun = this.add.rectangle(0, 0, 8, 1.5, 0x111111);

          // Lights
          const headlight1 = this.add.circle(9, -3, 1.5, 0xFFFFE0); // Yellowish
          const headlight2 = this.add.circle(9, 3, 1.5, 0xFFFFE0);
          const taillight1 = this.add.rectangle(-9, -3, 1, 2, 0xFF0000);
          const taillight2 = this.add.rectangle(-9, 3, 1, 2, 0xFF0000);
          
          container.add(w1);
          container.add(w2);
          container.add(w3);
          container.add(w4);
          container.add(body);
          container.add(hoodVent);
          container.add(windshield);
          container.add(rearWindow);
          container.add(mount);
          container.add(gun);
          container.add(headlight1);
          container.add(headlight2);
          container.add(taillight1);
          container.add(taillight2);

      } else if (type === 'oil_seeker') {
          // Scout Buggy
          // Body
          const body = this.add.rectangle(0, 0, 14, 8, 0xDAA520); // Golden Rod
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Wheels
          const w1 = this.add.circle(-6, -5, 3, 0x111111);
          const w2 = this.add.circle(6, -5, 3, 0x111111);
          const w3 = this.add.circle(-6, 5, 3, 0x111111);
          const w4 = this.add.circle(6, 5, 3, 0x111111);

          // Radar Dish
          const dishBase = this.add.circle(0, 0, 3, 0x555555);
          const dish = this.add.arc(0, 0, 5, 180, 360, false, 0xCCCCCC);
          
          // Rotation animation for dish
          this.tweens.add({
              targets: dish,
              angle: 360,
              duration: 2000,
              repeat: -1
          });

          container.add(w1);
          container.add(w2);
          container.add(w3);
          container.add(w4);
          container.add(body);
          container.add(dishBase);
          container.add(dish);

      } else if (type === 'missile_launcher') {
          // Long Truck Body (Camo Green)
          const body = this.add.rectangle(0, 0, 24, 10, 0x556B2F);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Cab (Armored)
          const cab = this.add.rectangle(10, 0, 6, 10, 0x445522);
          const windshield = this.add.rectangle(11, 0, 2, 8, 0x87CEEB);
          
          // Wheels (6 wheels) - Rugged
          const w1 = this.add.rectangle(-8, -6, 5, 3, 0x111111);
          const w2 = this.add.rectangle(0, -6, 5, 3, 0x111111);
          const w3 = this.add.rectangle(8, -6, 5, 3, 0x111111);
          const w4 = this.add.rectangle(-8, 6, 5, 3, 0x111111);
          const w5 = this.add.rectangle(0, 6, 5, 3, 0x111111);
          const w6 = this.add.rectangle(8, 6, 5, 3, 0x111111);

          // Hydraulic Lift System
          const lift = this.add.rectangle(-4, 0, 10, 4, 0x333333);

          // Missile Rack (angled up)
          const rack = this.add.rectangle(-2, 0, 16, 8, 0x2F4F4F);
          rack.setStrokeStyle(1, 0x000000);
          
          // Missiles (4-pack)
          const m1 = this.add.circle(4, -2, 1.5, 0xFF0000);
          const m2 = this.add.circle(4, 2, 1.5, 0xFF0000);
          const m3 = this.add.circle(0, -2, 1.5, 0xFF0000);
          const m4 = this.add.circle(0, 2, 1.5, 0xFF0000);

          // Targeting Radar
          const radarBox = this.add.rectangle(8, -4, 4, 4, 0x555555);
          const dish = this.add.arc(8, -4, 3, 180, 360, false, 0xCCCCCC);
          this.tweens.add({
              targets: dish,
              angle: { from: -30, to: 30 },
              yoyo: true,
              duration: 2000,
              repeat: -1
          });

          container.add(w1); container.add(w2); container.add(w3);
          container.add(w4); container.add(w5); container.add(w6);
          container.add(body);
          container.add(cab);
          container.add(windshield);
          container.add(lift);
          container.add(rack);
          container.add(m1); container.add(m2);
          container.add(m3); container.add(m4);
          container.add(radarBox);
          container.add(dish);
      } else if (type === 'destroyer') {
          // Improved Destroyer
          const hull = this.add.ellipse(0, 0, 32, 10, color);
          hull.setStrokeStyle(1, 0x000000);
          if (isSelected) hull.setStrokeStyle(2, 0xFFFF00);
          
          const deck = this.add.rectangle(0, 0, 20, 6, 0x555555);
          
          // Bridge
          const bridge = this.add.rectangle(0, -4, 8, 6, 0xDDDDDD);
          const windows = this.add.rectangle(0, -4, 6, 2, 0x87CEEB);
          
          // Guns
          const gunFront = this.add.circle(-10, 0, 3, 0x222222);
          const barrelFront = this.add.rectangle(-14, 0, 8, 2, 0x111111);
          const gunBack = this.add.circle(10, 0, 3, 0x222222);
          const barrelBack = this.add.rectangle(14, 0, 8, 2, 0x111111);
          
          // Radar
          const radar = this.add.circle(0, -8, 2, 0x00FF00);
          this.tweens.add({
              targets: radar,
              alpha: 0.2,
              duration: 1000,
              yoyo: true,
              repeat: -1
          });

          // Wake (Static)
          const wake = this.add.triangle(20, 0, 30, -5, 30, 5, 20, 0, 0xFFFFFF);
          wake.setAlpha(0.5);

          container.add(wake);
          container.add(hull);
          container.add(deck);
          container.add(bridge);
          container.add(windows);
          container.add(barrelFront);
          container.add(gunFront);
          container.add(barrelBack);
          container.add(gunBack);
          container.add(radar);

      } else if (type === 'construction_ship') {
          // Improved Construction Ship (Industrial)
          const hull = this.add.rectangle(0, 0, 36, 14, color); // Longer hull
          hull.setStrokeStyle(1, 0x000000);
          if (isSelected) hull.setStrokeStyle(2, 0xFFFF00);
          
          // Deck (Grey)
          const deck = this.add.rectangle(0, 0, 32, 10, 0x777777);

          // Cabin (Rear)
          const cabin = this.add.rectangle(-10, -4, 10, 8, 0xEEEEEE);
          const window = this.add.rectangle(-10, -4, 8, 4, 0x87CEEB);
          
          // Crane Base (Front)
          const craneBase = this.add.circle(8, 0, 5, 0x333333);
          const cranePivot = this.add.circle(8, 0, 2, 0x111111);
          
          // Crane Arm (Yellow/Black stripes)
          const craneArm = this.add.rectangle(16, 0, 16, 3, 0xFFA500); // Orange/Yellow
          craneArm.setRotation(-0.5);
          
          // Crane Cable & Hook
          const cable = this.add.line(0, 0, 22, -8, 22, 2, 0x000000); // Visual approximation
          
          // Cargo Area
          const crate1 = this.add.rectangle(-2, 4, 5, 5, 0x8B4513);
          const crate2 = this.add.rectangle(2, 4, 5, 5, 0xCD853F);
          
          // Hazard Stripes on Deck
          const h1 = this.add.rectangle(-14, 0, 2, 10, 0xFFA500);
          const h2 = this.add.rectangle(14, 0, 2, 10, 0xFFA500);

          container.add(hull);
          container.add(deck);
          container.add(h1); container.add(h2);
          container.add(cabin);
          container.add(window);
          container.add(craneBase);
          container.add(craneArm);
          container.add(cranePivot);
          container.add(cable);
          container.add(crate1);
          container.add(crate2);
      } else if (type === 'sniper') {
          // Detailed Sniper (Ghillie Suit)
          
          // Legs (Camo)
          const leftLeg = this.add.rectangle(-4, 8, 6, 6, 0x556B2F);
          leftLeg.setStrokeStyle(1, 0x000000);
          const rightLeg = this.add.rectangle(4, 8, 6, 6, 0x556B2F);
          rightLeg.setStrokeStyle(1, 0x000000);

          // Body (Camo)
          const body = this.add.rectangle(0, 0, 16, 10, 0x6B8E23);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Ghillie Suit details (Leaves/Rags)
          const g1 = this.add.circle(-5, -3, 3, 0x556B2F);
          const g2 = this.add.circle(6, 4, 3, 0x556B2F);
          const g3 = this.add.rectangle(0, -5, 18, 4, 0x556B2F); // Shoulder cover

          // Head (Skin)
          const head = this.add.circle(0, -8, 5, 0xFFD1AA);
          head.setStrokeStyle(1, 0x000000);

          // Cap with netting
          const cap = this.add.rectangle(0, -10, 10, 4, 0x556B2F);
          const visor = this.add.rectangle(6, -9, 4, 2, 0x556B2F);

          // Arms
          const leftArm = this.add.circle(-9, 0, 3, 0xFFD1AA);
          const rightArm = this.add.circle(9, 0, 3, 0xFFD1AA);

          // Long Sniper Rifle
          const rifleStock = this.add.rectangle(4, 1, 10, 3, 0x3E2723);
          const rifleBarrel = this.add.rectangle(16, 1, 14, 1.5, 0x111111);
          const scope = this.add.rectangle(6, -2, 8, 2, 0x000000);
          const bipod = this.add.rectangle(14, 4, 1, 4, 0x333333);

          container.add(leftLeg);
          container.add(rightLeg);
          container.add(body);
          container.add(g1); container.add(g2); container.add(g3);
          container.add(leftArm);
          container.add(rightArm);
          container.add(rifleStock);
          container.add(rifleBarrel);
          container.add(scope);
          container.add(bipod);
          container.add(head);
          container.add(cap);
          container.add(visor);

      } else if (type === 'rocketeer') {
          // Detailed Rocketeer (Heavy Armor)

          // Legs (Grey Armored)
          const leftLeg = this.add.rectangle(-4, 8, 7, 6, 0x2F4F4F);
          leftLeg.setStrokeStyle(1, 0x000000);
          const rightLeg = this.add.rectangle(4, 8, 7, 6, 0x2F4F4F);
          rightLeg.setStrokeStyle(1, 0x000000);

          // Body (Bulky Armor with Plates)
          const body = this.add.rectangle(0, 0, 18, 12, 0x708090);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);
          
          const plate = this.add.rectangle(0, 0, 10, 8, 0x555555); // Chest plate

          // Head (Skin)
          const head = this.add.circle(0, -9, 5, 0xFFD1AA);
          head.setStrokeStyle(1, 0x000000);

          // Heavy Helmet with Visor
          const helmet = this.add.rectangle(0, -10, 12, 6, 0x2F4F4F);
          const visor = this.add.rectangle(0, -9, 8, 2, 0x00FFFF);

          // Arms
          const leftArm = this.add.circle(-10, 0, 3, 0xFFD1AA);
          const rightArm = this.add.circle(10, 0, 3, 0xFFD1AA);

          // Detailed Bazooka (Shoulder mounted)
          const tube = this.add.rectangle(4, -4, 18, 6, 0x003300); // Green tube
          tube.setStrokeStyle(1, 0x000000);
          const grip = this.add.rectangle(0, -1, 2, 4, 0x111111);
          const sight = this.add.rectangle(6, -8, 4, 2, 0x111111);
          const rocketTip = this.add.triangle(15, -4, 0, -3, 0, 3, 5, 0, 0xFF0000);

          container.add(leftLeg);
          container.add(rightLeg);
          container.add(body);
          container.add(plate);
          container.add(leftArm);
          container.add(rightArm);
          container.add(tube);
          container.add(grip);
          container.add(sight);
          container.add(rocketTip);
          container.add(head);
          container.add(helmet);
          container.add(visor);
      } else if (type === 'ferry') {
          // High-detail Ferry (Vehicle Transport)
          const hull = this.add.rectangle(0, 0, 32, 18, color);
          hull.setStrokeStyle(1, 0x000000);
          if (isSelected) hull.setStrokeStyle(2, 0xFFFF00);
          
          // Bridge at the back (offset)
          const bridge = this.add.rectangle(-12, 0, 8, 14, 0xEEEEEE);
          bridge.setStrokeStyle(1, 0x000000);
          const bridgeWindow = this.add.rectangle(-12, 0, 6, 10, 0x87CEEB);
          
          // Cargo Deck (Dark Grey)
          const deck = this.add.rectangle(4, 0, 24, 14, 0x555555);
          
          // Loading Ramp (Front)
          const ramp = this.add.rectangle(16, 0, 4, 14, 0x333333);
          
          // Vehicles on deck (Visual only)
          const v1 = this.add.rectangle(0, -4, 8, 5, 0x2E8B57); // Green Truck
          v1.setStrokeStyle(1, 0x000000);
          const v2 = this.add.rectangle(8, 4, 6, 4, 0xDAA520); // Tan Car
          v2.setStrokeStyle(1, 0x000000);
          
          // Lifebuoys
          const lb1 = this.add.circle(-8, -8, 2, 0xFF0000); lb1.setStrokeStyle(1, 0xFFFFFF);
          const lb2 = this.add.circle(8, -8, 2, 0xFF0000); lb2.setStrokeStyle(1, 0xFFFFFF);
          const lb3 = this.add.circle(-8, 8, 2, 0xFF0000); lb3.setStrokeStyle(1, 0xFFFFFF);
          const lb4 = this.add.circle(8, 8, 2, 0xFF0000); lb4.setStrokeStyle(1, 0xFFFFFF);

          container.add(hull);
          container.add(deck);
          container.add(ramp);
          container.add(bridge);
          container.add(bridgeWindow);
          container.add(v1);
          container.add(v2);
          container.add(lb1); container.add(lb2); container.add(lb3); container.add(lb4);
      } else if (type === 'builder') {
          // "Bob" Style Builder Character
          
          // Feet/Legs (Dark Blue)
          const leftLeg = this.add.rectangle(-4, 8, 6, 6, 0x00008B);
          leftLeg.setStrokeStyle(1, 0x000000);
          const rightLeg = this.add.rectangle(4, 8, 6, 6, 0x00008B);
          rightLeg.setStrokeStyle(1, 0x000000);

          // Body (Blue Shirt)
          const body = this.add.rectangle(0, 0, 16, 10, 0x1E90FF);
          body.setStrokeStyle(1, 0x000000);
          if (isSelected) body.setStrokeStyle(2, 0xFFFF00);

          // Safety Vest (Orange stripes) - Improved
          const vestLeft = this.add.rectangle(-4, 0, 4, 10, 0xFF4500);
          const vestRight = this.add.rectangle(4, 0, 4, 10, 0xFF4500);
          const vestH = this.add.rectangle(0, 2, 12, 2, 0xFF4500); // Horizontal strap

          // Tool Belt
          const belt = this.add.rectangle(0, 5, 16, 3, 0x8B4513);

          // Head (Skin)
          const head = this.add.circle(0, -8, 5, 0xFFD1AA);
          head.setStrokeStyle(1, 0x000000);

          // Hard Hat (Yellow Dome) with ridge
          const helmet = this.add.arc(0, -9, 6, 180, 360, false, 0xFFFF00);
          (helmet as Phaser.GameObjects.Arc).setClosePath(true);
          helmet.setStrokeStyle(1, 0x000000);
          const ridge = this.add.rectangle(0, -13, 2, 4, 0xFFFF00);
          
          // Arms/Hands
          const leftArm = this.add.circle(-9, 0, 3, 0xFFD1AA);
          const rightArm = this.add.circle(9, 0, 3, 0xFFD1AA);

          // Wrench (Silver) in right hand
          const wHandle = this.add.rectangle(11, -4, 3, 10, 0xCCCCCC);
          wHandle.setRotation(-0.5);
          wHandle.setStrokeStyle(1, 0x000000);
          const wHead = this.add.rectangle(13, -8, 6, 4, 0xEEEEEE);
          wHead.setRotation(-0.5);
          wHead.setStrokeStyle(1, 0x000000);

          // Toolbox (Red) in left hand
          const toolbox = this.add.rectangle(-12, 4, 8, 6, 0xFF0000);
          toolbox.setStrokeStyle(1, 0x000000);
          const tbHandle = this.add.rectangle(-12, 0, 4, 2, 0x333333);

          container.add(leftLeg);
          container.add(rightLeg);
          container.add(body);
          container.add(vestLeft);
          container.add(vestRight);
          container.add(vestH);
          container.add(belt);
          container.add(leftArm);
          container.add(rightArm);
          container.add(wHandle);
          container.add(wHead);
          container.add(toolbox);
          container.add(tbHandle);
          container.add(head);
          container.add(helmet);
          container.add(ridge);
      } else if (type === 'light_plane') {
          // Delta Wing Fighter - Improved
          const wings = this.add.triangle(0, 0, -8, -12, 8, 0, -8, 12, 0xDDDDDD);
          wings.setStrokeStyle(1, 0x000000);
          
          const fuselage = this.add.rectangle(0, 0, 20, 5, 0xFFFFFF);
          fuselage.setStrokeStyle(1, 0x000000);
          if (isSelected) fuselage.setStrokeStyle(2, 0xFFFF00);

          // Cockpit (Bubble)
          const cockpit = this.add.ellipse(2, 0, 6, 4, 0x87CEEB);
          
          // Tail Fin
          const tail = this.add.triangle(-9, 0, -4, 0, -12, -6, -12, 6, 0xCCCCCC);

          // Propeller (Visual)
          const prop = this.add.rectangle(11, 0, 2, 14, 0x333333);
          this.tweens.add({
              targets: prop,
              angle: 360,
              duration: 80,
              repeat: -1
          });

          container.add(wings);
          container.add(tail);
          container.add(fuselage);
          container.add(cockpit);
          container.add(prop);

      } else if (type === 'heavy_plane') {
          // Heavy Bomber (B-52 Style)
          // Main Wing
          const wings = this.add.rectangle(2, 0, 12, 44, 0x555555);
          wings.setStrokeStyle(1, 0x000000);

          // Fuselage (Rounded)
          const fuselage = this.add.ellipse(0, 0, 30, 12, 0x444444);
          fuselage.setStrokeStyle(1, 0x000000);
          if (isSelected) fuselage.setStrokeStyle(2, 0xFFFF00);

          // Cockpit
          const cockpit = this.add.rectangle(10, 0, 6, 8, 0x222222);
          const windows = this.add.rectangle(11, 0, 2, 6, 0x87CEEB);

          // 4 Engines
          const e1 = this.add.rectangle(4, -12, 6, 4, 0x222222);
          const e2 = this.add.rectangle(4, -18, 6, 4, 0x222222);
          const e3 = this.add.rectangle(4, 12, 6, 4, 0x222222);
          const e4 = this.add.rectangle(4, 18, 6, 4, 0x222222);
          
          // Propellers for engines
          [e1, e2, e3, e4].forEach(e => {
              const p = this.add.rectangle(e.x + 4, e.y, 2, 8, 0x111111);
              this.tweens.add({
                  targets: p,
                  angle: 360,
                  duration: 100,
                  repeat: -1
              });
              container.add(p);
          });

          // Tail
          const tail = this.add.triangle(-14, 0, -8, 0, -18, -10, -18, 10, 0x555555);

          // Bomb Bay
          const bombBay = this.add.rectangle(0, 0, 10, 4, 0x222222);

          container.add(wings);
          container.add(tail);
          container.add(fuselage);
          container.add(cockpit);
          container.add(windows);
          container.add(bombBay);
          container.add(e1); container.add(e2); container.add(e3); container.add(e4);

      } else if (type === 'aircraft_carrier') {
          // Massive Flying Aircraft Carrier
          // Main Hull - Lower Deck
          const hull = this.add.rectangle(0, 0, 180, 70, 0x2F4F4F); // Dark Slate Gray
          hull.setStrokeStyle(2, 0x000000);
          if (isSelected) hull.setStrokeStyle(3, 0xFFFF00);

          // Flight Deck (Top)
          const deck = this.add.rectangle(0, 0, 170, 60, 0x4682B4); // Steel Blue
          deck.setStrokeStyle(1, 0x111111);

          // Runways (Two parallel strips)
          const runway1 = this.add.rectangle(0, -15, 160, 10, 0x222222); // Asphalt
          const line1 = this.add.rectangle(0, -15, 150, 2, 0xFFFFFF); // Center line
          
          const runway2 = this.add.rectangle(0, 15, 160, 10, 0x222222); // Asphalt
          const line2 = this.add.rectangle(0, 15, 150, 2, 0xFFFFFF); // Center line

          // Landing Pad markings
          const padH = this.add.circle(-70, 0, 10, 0x222222);
          const padHText = this.add.text(-75, -5, 'H', { fontSize: '10px', color: '#FFFF00', fontFamily: 'Arial' });
          padHText.setOrigin(0, 0);

          // Control Tower (Superstructure) - Side mounted
          const towerBase = this.add.rectangle(40, -40, 30, 15, 0x2F4F4F);
          towerBase.setStrokeStyle(1, 0x000000);
          const towerTop = this.add.rectangle(40, -40, 20, 10, 0x555555);
          const windows = this.add.rectangle(40, -40, 18, 6, 0x87CEEB); // Glass

          // Rotating Radars
          const radar1 = this.add.rectangle(35, -50, 8, 2, 0xCCCCCC);
          const radar2 = this.add.rectangle(45, -50, 10, 3, 0xCCCCCC);
          
          this.tweens.add({ targets: radar1, angle: 360, duration: 2000, repeat: -1 });
          this.tweens.add({ targets: radar2, angle: -360, duration: 3000, repeat: -1 });

          // Massive Thrusters (6 turbines)
          const thrusters = [
              { x: -80, y: -30 }, { x: -80, y: 30 },
              { x: 0, y: -40 }, { x: 0, y: 40 },
              { x: 80, y: -30 }, { x: 80, y: 30 }
          ];

          container.add(hull);
          container.add(deck);
          container.add(runway1); container.add(line1);
          container.add(runway2); container.add(line2);
          container.add(padH); container.add(padHText);

          thrusters.forEach(pos => {
              const t = this.add.circle(pos.x, pos.y, 8, 0xFFA500); // Orange Glow
              t.setStrokeStyle(1, 0x555555);
              this.tweens.add({
                  targets: t,
                  scaleX: 1.2,
                  scaleY: 1.2,
                  alpha: 0.8,
                  yoyo: true,
                  duration: 200 + Math.random() * 200,
                  repeat: -1
              });
              container.add(t);
          });

          container.add(towerBase);
          container.add(towerTop);
          container.add(windows);
          container.add(radar1);
          container.add(radar2);

          // Tiny Planes on Deck
          const planes = [
              { x: -50, y: -15 }, { x: -30, y: -15 }, 
              { x: 50, y: 15 }, { x: 70, y: 15 }
          ];
          
          planes.forEach(p => {
              const plane = this.add.triangle(p.x, p.y, 0, -4, -4, 4, 4, 4, 0xCCCCCC);
              plane.angle = 90; // Facing right
              container.add(plane);
          });

      } else if (type === 'mothership') {
          // Gigantic Sci-Fi Mothership - Saucer Style
          
          // Container for spinning parts (so HP bar doesn't spin)
          const shipBody = this.add.container(0, 0);

          // 1. Main Hull (Giant Saucer)
          const hullRadius = 80;
          const hull = this.add.circle(0, 0, hullRadius, 0x222222);
          hull.setStrokeStyle(3, 0x00FFFF); // Cyan neon rim
          if (isSelected) hull.setStrokeStyle(4, 0xFFFF00); // Yellow selection
          shipBody.add(hull);

          // 2. Line Designs (Geometric patterns)
          const graphics = this.add.graphics();
          graphics.lineStyle(2, 0x00AAAA, 0.8);
          
          // Concentric rings
          graphics.strokeCircle(0, 0, 60);
          graphics.strokeCircle(0, 0, 40);
          
          // Radial lines
          for (let i = 0; i < 8; i++) {
              const angle = Phaser.Math.DegToRad(i * 45);
              const startX = Math.cos(angle) * 20;
              const startY = Math.sin(angle) * 20;
              const endX = Math.cos(angle) * 75;
              const endY = Math.sin(angle) * 75;
              graphics.moveTo(startX, startY);
              graphics.lineTo(endX, endY);
          }
          graphics.strokePath();
          shipBody.add(graphics);

          // 3. Central Light Orb
          const orb = this.add.circle(0, 0, 15, 0x00FFFF); // Cyan glow
          this.tweens.add({
              targets: orb,
              alpha: { from: 1, to: 0.6 },
              scale: { from: 1, to: 1.3 },
              duration: 1200,
              yoyo: true,
              repeat: -1
          });
          shipBody.add(orb);

          // 4. Continuous Spinning Animation
          this.tweens.add({
              targets: shipBody,
              angle: 360,
              duration: 12000, // Slow majestic spin
              repeat: -1,
              ease: 'Linear'
          });

          container.add(shipBody);
      }

      return container;
  }

  createUnitContainer(unit: Unit, isMine: boolean, isSelected: boolean) {
      const player = this.players.get(unit.ownerId);
      const color = player ? parseInt(player.color.replace('#', '0x')) : (isMine ? 0xAAAAFF : 0xFFAAAA);
      
      const uContainer = this.drawDetailedUnit(0, 0, unit.type, color, isSelected);
      uContainer.setPosition(unit.x, unit.y);
      uContainer.setDepth(20); // Ensure units are above everything else
      uContainer.setData('isSelected', isSelected);
      
      // Add Health Bar to container
      if (unit.maxHealth > 0) {
         const hpPercent = Math.max(0, unit.health / unit.maxHealth);
         let barColor = 0x00FF00; // High (Green)
         if (hpPercent <= 0.3) barColor = 0xFF0000; // Low (Red)
         else if (hpPercent <= 0.6) barColor = 0xFFFF00; // Medium (Yellow)
         
         let hpBarWidth = 16;
         let hpBarY = -12;

         // Dynamic HP Bar Sizing
         switch (unit.type) {
             case 'mothership': hpBarWidth = 120; hpBarY = -90; break;
             case 'aircraft_carrier': hpBarWidth = 140; hpBarY = -50; break;
             case 'heavy_plane': hpBarWidth = 40; hpBarY = -25; break;
             case 'destroyer': hpBarWidth = 32; hpBarY = -15; break;
             case 'construction_ship': hpBarWidth = 36; hpBarY = -15; break;
             case 'ferry': hpBarWidth = 32; hpBarY = -15; break;
             case 'missile_launcher': hpBarWidth = 24; hpBarY = -15; break;
             case 'tank': hpBarWidth = 24; hpBarY = -15; break;
             case 'humvee': hpBarWidth = 20; hpBarY = -12; break;
         }

         const hpBar = this.add.rectangle(0, hpBarY, hpBarWidth * hpPercent, 3, barColor);
         hpBar.setName('hpBar');
         uContainer.add(hpBar);
      }

      // Dynamic Hit Area
      let width = 24;
      let height = 24;
      
      switch (unit.type) {
          case 'mothership': width = 160; height = 160; break;
          case 'aircraft_carrier': width = 180; height = 80; break;
          case 'heavy_plane': width = 50; height = 50; break;
          case 'destroyer': width = 40; height = 20; break;
          case 'construction_ship': width = 45; height = 25; break;
          case 'ferry': width = 40; height = 25; break;
          case 'tank':
          case 'missile_launcher':
          case 'humvee': width = 30; height = 30; break;
      }

      const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0); // Invisible hit area
      uContainer.add(hitArea);
      uContainer.setSize(width, height);
      uContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

      uContainer.on('pointerdown', (pointer: any) => {
        if (pointer.rightButtonDown()) {
             // Right Click: Select Unit (Fix for user request)
             pointer.event.stopPropagation(); 
             
             if (unit.ownerId === socket.id) {
                 if (this.selectedUnitIds.has(unit.id)) {
                    // Optional: Deselect if already selected? Or just keep selected.
                    // Usually right click selects single unit, clearing others unless shift held.
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                        this.selectedUnitIds.add(unit.id);
                    }
                 } else {
                    const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
                    if (!isMultiSelect) {
                        this.selectedUnitIds.clear();
                    }
                    this.selectedUnitIds.add(unit.id);
                 }
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                      detail: { unitIds: Array.from(this.selectedUnitIds) } 
                  }));
              }
        } else if (pointer.leftButtonDown()) {
             // Left Click: Move or Attack (if enemy) or Select (if desired, but we want Right Click Select)
             // If we want Left Click to be strictly Move/Action, we should ignore selection here?
             // But if we click a unit with Left Click, standard RTS selects it too usually.
             // Let's keep Left Click Select as fallback/standard, but ensure Right Click works too.
             pointer.event.stopPropagation(); 
             
             if (unit.ownerId === socket.id) {
                 if (this.selectedUnitIds.has(unit.id)) {
                    this.selectedUnitIds.delete(unit.id);
                 } else {
                    this.selectedUnitIds.add(unit.id);
                 }
                 this.renderUnits(this.currentUnits);
                 window.dispatchEvent(new CustomEvent('unit-selection-changed', { 
                      detail: { unitIds: Array.from(this.selectedUnitIds) } 
                  }));
              }
         }
      });

      uContainer.on('pointerover', () => {
          const event = new CustomEvent('game-hover', { 
              detail: { 
                  x: uContainer.x, y: uContainer.y, 
                  title: unit.type.toUpperCase(),
                  health: unit.health, maxHealth: unit.maxHealth, 
                  damage: unit.damage, speed: unit.speed, attackSpeed: unit.fireRate,
                  owner: unit.ownerId, type: unit.type
              } 
          });
          window.dispatchEvent(event);
      });
      uContainer.on('pointerout', () => {
          window.dispatchEvent(new CustomEvent('game-hover', { detail: null }));
      });

      this.unitsGroup.add(uContainer);
      this.unitContainers.set(unit.id, uContainer);
  }

  renderUnits(units: Unit[]) {
    this.currentUnits = units;
    this.rangeGraphics.clear();
    
    // Track active unit IDs to remove dead ones later
    const activeUnitIds = new Set<string>();

    units.forEach(unit => {
      activeUnitIds.add(unit.id);
      
      const isMine = unit.ownerId === socket.id;
      const isSelected = this.selectedUnitIds.has(unit.id);
      
      // Check if unit already exists
      if (this.unitContainers.has(unit.id)) {
          const container = this.unitContainers.get(unit.id)!;
          
          // Update position
          // container.setPosition(unit.x, unit.y); // Handled by interpolation in update()
          
          // Check selection change
          const wasSelected = container.getData('isSelected');
          
          if (wasSelected !== isSelected) {
              // Recreate if selection changed
              container.destroy();
              this.createUnitContainer(unit, isMine, isSelected);
          } else {
              // Update Health Bar
              const hpBar = container.getByName('hpBar') as Phaser.GameObjects.Rectangle;
              if (hpBar && unit.maxHealth > 0) {
                  const hpPercent = Math.max(0, unit.health / unit.maxHealth);
                  let barColor = 0x00FF00; // High (Green)
                  if (hpPercent <= 0.3) barColor = 0xFF0000; // Low (Red)
                  else if (hpPercent <= 0.6) barColor = 0xFFFF00; // Medium (Yellow)
                  
                  const hpBarWidth = unit.type === 'mothership' ? 100 : (unit.type === 'aircraft_carrier' ? 40 : 16);
                  hpBar.width = hpBarWidth * hpPercent;
                  hpBar.fillColor = barColor;
              }
          }
      } else {
          // Create new unit
          this.createUnitContainer(unit, isMine, isSelected);
      }

      // Draw Range - Moved to renderRangeRings()
      });


      // Cleanup dead units
      this.unitContainers.forEach((container, id) => {
          if (!activeUnitIds.has(id)) {
              container.destroy();
              this.unitContainers.delete(id);
              this.unitUpdates.delete(id);
          }
      });
    }

    drawBiomeDetails(island: Island, points: any[]) {
      const detailGraphics = this.add.graphics();
      detailGraphics.setDepth(1.05);
      this.islandsGroup.add(detailGraphics);

      let detailColor = 0x006400; // Dark Green (Forest Trees)
      if (island.type === 'desert') detailColor = 0x8B4513; // SaddleBrown (Rocks)
      if (island.type === 'snow') detailColor = 0xB0C4DE; // LightSteelBlue (Ice)
      if (island.type === 'grasslands') detailColor = 0x228B22; // ForestGreen (Grass tufts)
      
      const polyGeom = new Phaser.Geom.Polygon(points);
      const bounds = Phaser.Geom.Polygon.GetAABB(polyGeom);
      
      const graphicsSettings = settingsManager.getSettings().graphics;
       let numDetails = 0;

       if (graphicsSettings.showParticles) {
           const density = 0.002; // Base density
           const area = bounds.width * bounds.height; 
           numDetails = Math.floor(area * density);
           
           // Limit total particles based on settings
           const maxParticles = graphicsSettings.maxParticles || 500;
           numDetails = Math.min(numDetails, maxParticles);
       }
 
       detailGraphics.fillStyle(detailColor, 0.5); // Slightly more transparent

      for(let i=0; i<numDetails; i++) {
          const rx = bounds.x + Math.random() * bounds.width;
          const ry = bounds.y + Math.random() * bounds.height;
          
          if (Phaser.Geom.Polygon.Contains(polyGeom, rx, ry)) {
              // Draw small detail
              const size = Math.random() * 4 + 2;
              
              if (island.type === 'desert') {
                  // Rocks (squares) & Dunes (lines)
                  if (Math.random() > 0.7) {
                       detailGraphics.fillStyle(0x8B4513, 0.6); // Darker rock
                       detailGraphics.fillRect(rx, ry, size, size);
                  } else {
                       detailGraphics.fillStyle(0xDEB887, 0.4); // Sand dune shadow
                       detailGraphics.fillCircle(rx, ry, size * 2);
                  }
              } else if (island.type === 'snow') {
                  // Ice chunks (irregular) & Snow piles
                   detailGraphics.fillStyle(0xE0FFFF, 0.7);
                   detailGraphics.fillCircle(rx, ry, size);
              } else if (island.type === 'grasslands') {
                   // Grass tufts & Trees
                   if (Math.random() > 0.8) {
                       // Tree
                       detailGraphics.fillStyle(0x8B4513, 1); // Trunk
                       detailGraphics.fillRect(rx, ry, 4, 8);
                       detailGraphics.fillStyle(0x228B22, 1); // Leaves
                       detailGraphics.fillCircle(rx + 2, ry - 4, size + 4);
                   } else {
                       // Grass
                       detailGraphics.fillStyle(0x006400, 0.4);
                       detailGraphics.fillRect(rx, ry, 2, size);
                   }
              } else {
                  // Forest or Default Island
                  if (island.type === 'forest') {
                      // Forest: Trees
                      detailGraphics.fillStyle(0x006400, 0.6);
                      detailGraphics.fillCircle(rx, ry, size);
                      detailGraphics.fillStyle(0x004d00, 0.8);
                      detailGraphics.fillCircle(rx, ry, size/2);
                  } else {
                      // Default Island: Palm Trees
                      if (Math.random() > 0.7) {
                          // Palm Trunk
                          detailGraphics.lineStyle(2, 0x8B4513);
                          detailGraphics.beginPath();
                          detailGraphics.moveTo(rx, ry);
                          detailGraphics.lineTo(rx + 5, ry - 10);
                          detailGraphics.lineTo(rx + 10, ry - 15);
                          detailGraphics.strokePath();
                          // Palm Leaves
                          detailGraphics.fillStyle(0x32CD32, 1);
                          detailGraphics.fillCircle(rx + 10, ry - 15, size);
                      }
                  }
              }
          }
      }

      // Tumbleweeds (Desert only)
      if (island.type === 'desert' && graphicsSettings.showWeather) {
          const maxP = graphicsSettings.maxParticles || 1000;
          // Calculate density-based count, but cap by global setting roughly?
          // User wants "only have those amounts". Let's assume maxParticles is GLOBAL limit.
          // But here we are iterating islands. We need local limit.
          // Let's approximate: 50 particles per large island if max is high.
          // Or use a strict density.
          
          const area = bounds.width * bounds.height;
          const numTumbleweeds = Math.min(20, Math.floor(area / 10000 * (maxP / 500))); 
          
          for(let k=0; k<numTumbleweeds; k++) {
              const tx = bounds.x + Math.random() * bounds.width;
              const ty = bounds.y + Math.random() * bounds.height;
              if (Phaser.Geom.Polygon.Contains(polyGeom, tx, ty)) {
                   // Tumbleweed visual
                   const tw = this.add.circle(tx, ty, 3, 0x8B4513);
                   tw.setDepth(1.5);
                   this.islandsGroup.add(tw);
                   
                   this.tumbleweeds.push({
                       sprite: tw,
                       dx: (Math.random() - 0.5) * 1.5,
                       dy: (Math.random() - 0.5) * 1.5,
                       life: Math.random() * 5, // Random start life
                       maxLife: 5,
                       poly: polyGeom,
                       bounds: bounds
                   });
              }
          }
      } else if (graphicsSettings.showWeather) {
          // Rain (Non-Desert)
          const maxP = graphicsSettings.maxParticles || 1000;
          
          // Rain density
          const numDrops = Math.floor(island.radius / 5 * (maxP / 500)); 
          
          for(let k=0; k<numDrops; k++) {
              const rx = bounds.x + Math.random() * bounds.width;
              const ry = bounds.y + Math.random() * bounds.height;
              
              if (Phaser.Geom.Polygon.Contains(polyGeom, rx, ry)) {
                   const drop = this.add.rectangle(rx, ry, 1, 4, 0xAAAAFF, 0.6);
                   drop.setDepth(2);
                   this.islandsGroup.add(drop);
                   
                   this.weatherParticles.push({
                       sprite: drop,
                       dx: -0.5, // Slight wind
                       dy: 4 + Math.random() * 2, // Fall speed
                       type: 'rain',
                       life: Math.random() * 5,
                       maxLife: 5,
                       poly: polyGeom,
                       bounds: bounds
                   });
              }
          }
      }

      // Volcano Logic (Deterministic)
      // Only for default 'island' type or unspecified
      if (((island.type as string) === 'island' || island.type === 'forest') && island.radius > 150) {
          // Simple hash for consistency
          let h = 0;
          for(let i=0; i<island.id.length; i++) h = Math.imul(31, h) + island.id.charCodeAt(i) | 0;
          
          if (Math.abs(h) % 6 === 0) {
             // Draw Volcano
             const vx = island.x;
             const vy = island.y;
             const vSize = island.radius * 0.5;
             
             const volcano = this.add.graphics();
             volcano.fillStyle(0x3E2723, 1); // Dark brown cone
             volcano.fillTriangle(vx, vy - vSize, vx - vSize, vy + vSize/2, vx + vSize, vy + vSize/2);
             
             // Lava Cap
             volcano.fillStyle(0xFF4500, 1);
             volcano.fillTriangle(vx, vy - vSize, vx - vSize/4, vy - vSize/2, vx + vSize/4, vy - vSize/2);
             
             volcano.setDepth(1.2);
             this.islandsGroup.add(volcano);
          }
      }
    }

    renderMap(mapData: GameMap) {
        this.currentMap = mapData;
        this.islandsGroup.clear(true, true);
        this.tumbleweeds = [];
        this.weatherParticles = [];
        this.oilAnimations = [];
        this.oilSpotVisuals.clear();
        // this.revealedOilSpots.clear(); // Persistence Fix: Do not clear revealed spots on re-render

        // DEBUG: Count Hidden Spots
        const hiddenCount = mapData.oilSpots ? mapData.oilSpots.filter(s => s.id.startsWith('hidden_oil_')).length : 0;
        console.log(`[MainScene] Rendering Map. Total Oil Spots: ${mapData.oilSpots?.length || 0}, Hidden: ${hiddenCount}`);

        // Render Oil Spots
        if (mapData.oilSpots) {
            mapData.oilSpots.forEach(spot => {
                const isHiddenSpot = spot.id.startsWith('hidden_oil_');
                const isRevealed = this.revealedOilSpots.has(spot.id);
                const shouldShow = !isHiddenSpot || isRevealed;
                
                // Base Color is ALWAYS BLACK (0x000000)
                const color = 0x000000;
                const alpha = 0.5;

                const circle = this.add.circle(spot.x, spot.y, spot.radius, color, alpha);
                circle.setDepth(10); // Layer 10: Significantly above islands
                circle.setVisible(shouldShow);
                this.islandsGroup.add(circle);
                
                // Red Ping Marker (Only for revealed hidden spots)
                let ping: Phaser.GameObjects.Rectangle | null = null;
                if (isHiddenSpot) {
                     // A red square block "ping" on top
                     ping = this.add.rectangle(spot.x, spot.y, 20, 20, 0xFF0000);
                     ping.setDepth(11); // Above the black spot
                     ping.setVisible(isRevealed); // Only visible if revealed
                     this.islandsGroup.add(ping);
                     
                     // Animation for the ping
                     this.tweens.add({
                         targets: ping,
                         scale: 1.5,
                         alpha: 0.5,
                         yoyo: true,
                         repeat: -1,
                         duration: 800
                     });
                }
                
                // Pulse Animation (Red waves if hidden/revealed)
                const pulseColor = isHiddenSpot ? 0xFF0000 : 0x000000;
                const pulse = this.add.circle(spot.x, spot.y, spot.radius, pulseColor, 1);
                pulse.setDepth(9.9); // Layer 9.9: Just below the spot
                pulse.setVisible(shouldShow);
                this.islandsGroup.add(pulse);
                
                this.oilAnimations.push({
                    id: spot.id,
                    x: spot.x,
                    y: spot.y,
                    pulse: pulse,
                    timer: Math.random() * 1000 // Random offset
                });
                
                // Add to visuals map for scanner updates
                // We store 'ping' as well so we can toggle it
                this.oilSpotVisuals.set(spot.id, { main: circle, pulse: pulse, ping: ping || undefined });
                
                // Interaction: If hidden, DISABLE interaction initially
                if (isHiddenSpot && !isRevealed) {
                    circle.disableInteractive();
                } else {
                    // Use LOCAL coordinates (0,0) for the hit area, not World coordinates
                    circle.setInteractive(new Phaser.Geom.Circle(0, 0, spot.radius), Phaser.Geom.Circle.Contains);
                }

                circle.on('pointerover', () => {
                    window.dispatchEvent(new CustomEvent('game-hover', { detail: { title: "Oil Spot", type: "Resource" } }));
                });
                circle.on('pointerout', () => window.dispatchEvent(new CustomEvent('game-hover', { detail: null })));

                if (spot.occupiedBy) {
                    const b = (spot as any).building;
                    if (b) {
                        const bContainer = this.drawDetailedBuilding(spot.x, spot.y, b.type, 0x555555, b);
                        bContainer.setDepth(3);
                        this.islandsGroup.add(bContainer);
                        
                        const isMine = (spot as any).ownerId === socket.id;
                        if (b.isConstructing) {
                             const p = b.constructionProgress || 0;
                             const blueBar = this.add.rectangle(spot.x, spot.y - 15, 16 * (p/100), 3, 0x0000FF);
                             this.islandsGroup.add(blueBar);
                        } else {
                             const hpPercent = Math.max(0, b.health / b.maxHealth);
                             const barColor = isMine ? 0x00FF00 : 0xFF0000;
                             const hpBar = this.add.rectangle(spot.x, spot.y - 15, 16 * hpPercent, 3, barColor);
                             this.islandsGroup.add(hpBar);
                        }
                    }
                }
            });
        }

    // Render Bridges
    if (mapData.bridges) {
        mapData.bridges.forEach(bridge => {
            const islandA = mapData.islands.find(i => i.id === bridge.islandAId);
            const islandB = mapData.islands.find(i => i.id === bridge.islandBId);
            if (islandA && islandB) {
                const nodeA = islandA.buildings.find(b => b.id === bridge.nodeAId);
                const nodeB = islandB.buildings.find(b => b.id === bridge.nodeBId);
                if (nodeA && nodeB) {
                    const ax = islandA.x + (nodeA.x || 0);
                    const ay = islandA.y + (nodeA.y || 0);
                    const bx = islandB.x + (nodeB.x || 0);
                    const by = islandB.y + (nodeB.y || 0);

                    const graphics = this.add.graphics();
                    graphics.setDepth(2);
                    this.islandsGroup.add(graphics);

                    if (bridge.type === 'bridge') {
                        // Wood bridge
                        graphics.lineStyle(20, 0x8B4513);
                        graphics.lineBetween(ax, ay, bx, by);
                        graphics.lineStyle(16, 0xDEB887);
                        graphics.lineBetween(ax, ay, bx, by);
                        
                        // Planks
                        const dist = Math.hypot(bx - ax, by - ay);
                        const angle = Math.atan2(by - ay, bx - ax);
                        const steps = dist / 10;
                        graphics.lineStyle(1, 0x5C4033);
                        for(let i=0; i<steps; i++) {
                            const px = ax + Math.cos(angle) * i * 10;
                            const py = ay + Math.sin(angle) * i * 10;
                            const p1x = px + Math.cos(angle + Math.PI/2) * 8;
                            const p1y = py + Math.sin(angle + Math.PI/2) * 8;
                            const p2x = px + Math.cos(angle - Math.PI/2) * 8;
                            const p2y = py + Math.sin(angle - Math.PI/2) * 8;
                            graphics.lineBetween(p1x, p1y, p2x, p2y);
                        }
                    } else if (bridge.type === 'gate') {
                        // Gate Rendering
                        // Darker, wider base
                        graphics.lineStyle(16, 0x222222);
                        graphics.lineBetween(ax, ay, bx, by);
                        
                        // Wood/Portcullis look in center
                        graphics.lineStyle(10, 0x5D4037); // Dark Wood
                        graphics.lineBetween(ax, ay, bx, by);

                        // Vertical bars (Iron bars)
                        const dist = Math.hypot(bx - ax, by - ay);
                        const angle = Math.atan2(by - ay, bx - ax);
                        const steps = dist / 8; // Dense bars
                        graphics.lineStyle(2, 0x111111);
                        
                        for(let i=0; i<steps; i++) {
                            const px = ax + Math.cos(angle) * i * 8;
                            const py = ay + Math.sin(angle) * i * 8;
                            // Bars perpendicular to wall direction
                            const p1x = px + Math.cos(angle + Math.PI/2) * 5;
                            const p1y = py + Math.sin(angle + Math.PI/2) * 5;
                            const p2x = px + Math.cos(angle - Math.PI/2) * 5;
                            const p2y = py + Math.sin(angle - Math.PI/2) * 5;
                            graphics.lineBetween(p1x, p1y, p2x, p2y);
                        }
                    } else {
                        // Stone Wall
                        graphics.lineStyle(12, 0x444444);
                        graphics.lineBetween(ax, ay, bx, by);
                        graphics.lineStyle(8, 0x888888);
                        graphics.lineBetween(ax, ay, bx, by);
                    }
                }
            }
        });
    }

    // Render High Grounds
    if (mapData.highGrounds) {
        mapData.highGrounds.forEach(hg => {
            const points = hg.points;
            
            // 1. Stroke (Outline)
            const strokeGraphics = this.add.graphics();
            strokeGraphics.lineStyle(6, 0x3E2723); // Very Dark Brown
            strokeGraphics.strokePoints(points, true);
            strokeGraphics.setDepth(1.1); // Above Island Fill (1)
            this.islandsGroup.add(strokeGraphics);

            // 2. Fill
            const fillPoly = this.add.polygon(0, 0, points, 0x795548); // Brown
            fillPoly.setOrigin(0, 0);
            fillPoly.setDepth(1.1);
            this.islandsGroup.add(fillPoly);
        });
    }

    // Render Islands
    mapData.islands.forEach((island: Island) => {
      let color = 0x228B22; // Forest Green
      if (island.type === 'desert') color = 0xF4A460; // Sandy Brown
      if (island.type === 'snow') color = 0xFFFAFA; // Snow

      // Oil Oasis Logic
      if ((island as any).subtype === 'oil_field' || island.id === 'oil_pit') {
          color = 0x222222; // Dark Oil Color
      }

      let points = island.points;
      if (!points) {
          points = [];
          const numPoints = 32;
          for(let i=0; i<numPoints; i++) {
              const angle = (i / numPoints) * Math.PI * 2;
              points.push({
                  x: island.x + Math.cos(angle) * island.radius,
                  y: island.y + Math.sin(angle) * island.radius
              });
          }
      }

      // 1. Stroke (Background, wider)
      const strokeGraphics = this.add.graphics();
      let strokeColor = 0xDAA520;
      let strokeWidth = 3;
      
      if (island.ownerId && this.players.has(island.ownerId)) {
        const owner = this.players.get(island.ownerId)!;
        strokeColor = Phaser.Display.Color.HexStringToColor(owner.color).color;
        strokeWidth = 10; // Thicker for merging
      } else if (island.id === 'high_land') {
        // High Ground Border
        strokeColor = 0x5C4033; // Dark Brown (Cliff edge)
        strokeWidth = 8;
      }
      
      strokeGraphics.lineStyle(strokeWidth, strokeColor);
      strokeGraphics.strokePoints(points, true);
      strokeGraphics.setDepth(0);
      this.islandsGroup.add(strokeGraphics);

      // 2. Fill (Foreground)
      const fillPoly = this.add.polygon(0, 0, points, color);
      fillPoly.setOrigin(0, 0);
      fillPoly.setDepth(1);
      fillPoly.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);
      this.islandsGroup.add(fillPoly);
      
      // Biome Textures / Details
      this.drawBiomeDetails(island, points);

      // Render Gold Spots
      if (island.goldSpots) {
          island.goldSpots.forEach(spot => {
             const gx = island.x + spot.x;
             const gy = island.y + spot.y;
             
             // Detailed Gold Spot visual
             const container = this.add.container(gx, gy);
             container.setDepth(1.1);
             this.islandsGroup.add(container);
             
             // Nuggets
             const n1 = this.add.circle(-4, 2, 3, 0xFFD700);
             const n2 = this.add.circle(4, 0, 4, 0xDAA520);
             const n3 = this.add.circle(0, -4, 3, 0xFFD700);
             
             // Sparkle
             const sparkle = this.add.star(0, -8, 4, 2, 4, 0xFFFFFF);
             this.tweens.add({
                 targets: sparkle,
                 alpha: 0,
                 scale: 0.5,
                 duration: 1000 + Math.random() * 500,
                 yoyo: true,
                 repeat: -1
             });
             
             container.add([n1, n2, n3, sparkle]);
          });
      }

      // Render Buildings
      island.buildings.forEach((b) => {
        // Use relative position if available
        const bx = island.x + (b.x || 0);
        const by = island.y + (b.y || 0);
        
        const bOwnerId = b.ownerId || island.ownerId;
        const bPlayer = bOwnerId ? this.players.get(bOwnerId) : undefined;
        // Use player color by default for base/team coloring
        let bColor = bPlayer ? parseInt(bPlayer.color.replace('#', '0x')) : 0x808080;

        // Specific overrides for resource buildings if unowned
        if (b.type === 'mine' && !bPlayer) bColor = 0xFFD700; // Gold
        if (b.type === 'wall' && !bPlayer) bColor = 0x666666; // Grey
        if ((b.type === 'wall_node' || b.type === 'bridge_node') && !bPlayer) bColor = 0x666666;
        
        const bContainer = this.drawDetailedBuilding(bx, by, b.type, bColor, b);
        bContainer.setDepth(3);
        this.islandsGroup.add(bContainer);

        bContainer.setSize(24, 24);
        bContainer.setInteractive();

        const isSelected = this.selectedNodeIds.has(b.id) || this.selectedBuildingIds.has(b.id);
        const isHovered = (this as any).hoveredBuildingId === b.id;

        if (isSelected) {
            const ring = this.add.circle(0, 0, 18);
            ring.setStrokeStyle(2, 0x00FF00);
            bContainer.add(ring);
        }

        // --- BARS IMPLEMENTATION ---
        // Base Dimensions (Larger than before)
        const barW = 32; 
        const barH = 6;  
        
        // Add Construction Bar
        if (b.isConstructing) {
             const p = b.constructionProgress || 0;
             const blueBar = this.add.rectangle(0, -20, barW * (p/100), barH, 0x0000FF);
             blueBar.setName('constructionBar');
             bContainer.add(blueBar);
        } else {
             const hpPercent = Math.max(0, b.health / b.maxHealth);
             const isMine = bOwnerId === socket.id;
             const hpColor = isMine ? 0x00FF00 : 0xFF0000;
             const hpBar = this.add.rectangle(0, -20, barW * hpPercent, barH, hpColor);
             hpBar.setName('hpBar');
             bContainer.add(hpBar);
             
             // Recruitment Bar
             if (b.recruitmentQueue && b.recruitmentQueue.length > 0) {
                 const item = b.recruitmentQueue[0];
                 const rp = Math.min(1, item.progress / item.totalTime);
                 const recBar = this.add.rectangle(0, -26, barW * rp, barH - 1, 0xFFFF00);
                 recBar.setName('recruitBar');
                 bContainer.add(recBar);
             }
        }

        // Update function for hover/select
        const updateBars = (active: boolean) => {
            const scale = active ? 1.5 : 1.0; // 50% larger on hover/select
            const cBar = bContainer.getByName('constructionBar') as Phaser.GameObjects.Rectangle;
            if (cBar) {
                cBar.setScale(scale);
                cBar.y = active ? -26 : -20;
            }
            const hBar = bContainer.getByName('hpBar') as Phaser.GameObjects.Rectangle;
            if (hBar) {
                hBar.setScale(scale);
                hBar.y = active ? -26 : -20;
            }
            const rBar = bContainer.getByName('recruitBar') as Phaser.GameObjects.Rectangle;
            if (rBar) {
                rBar.setScale(scale);
                rBar.y = active ? -34 : -26;
            }
        };

        // Apply initial state
        if (isSelected || isHovered) {
             updateBars(true);
        }

        bContainer.on('pointerover', () => {
            (this as any).hoveredBuildingId = b.id;
            updateBars(true);
            window.dispatchEvent(new CustomEvent('game-hover', { 
                detail: { 
                    title: b.type.charAt(0).toUpperCase() + b.type.slice(1).replace('_', ' '),
                    owner: b.ownerId || island.ownerId, 
                    type: 'Building',
                    health: b.health,
                    maxHealth: b.maxHealth,
                    id: b.id
                } 
            }));
        });
        bContainer.on('pointerout', () => {
            if ((this as any).hoveredBuildingId === b.id) {
                (this as any).hoveredBuildingId = null;
            }
            if (!isSelected) updateBars(false);
            window.dispatchEvent(new CustomEvent('game-hover', { detail: null }));
        });


        bContainer.on('pointerdown', (pointer: any) => {
          // Allow selection of any building (for info display)
          // Stop propagation to avoid map click clearing selection
          if (pointer.event) pointer.event.stopPropagation();

          if (b.type === 'bridge_node' || b.type === 'wall_node') {
              const nodeOwner = b.ownerId || island.ownerId;
              if (nodeOwner !== socket.id) {
                  // Enemy node
              } else {
                  if (this.selectedNodeIds.has(b.id)) {
                      this.selectedNodeIds.delete(b.id);
                  } else {
                      this.selectedNodeIds.add(b.id);
                  }
                  
                  const nodes = Array.from(this.selectedNodeIds);
                  window.dispatchEvent(new CustomEvent('node-selection-changed', { 
                      detail: { nodes } 
                  }));
                  
                  this.renderMap(this.currentMap!);
                  return;
              }
          }

          // Handle Building Selection
          const isMultiSelect = pointer.event && (pointer.event.shiftKey || pointer.event.ctrlKey || pointer.event.metaKey);
          
          if (!isMultiSelect) {
             this.selectedBuildingIds.clear();
             this.selectedUnitIds.clear();
             this.renderUnits(this.currentUnits);
             window.dispatchEvent(new CustomEvent('unit-selection-changed', { detail: { unitIds: [] } }));
          }

          if (this.selectedBuildingIds.has(b.id)) {
              if (isMultiSelect) this.selectedBuildingIds.delete(b.id);
          } else {
              this.selectedBuildingIds.add(b.id);
          }

          window.dispatchEvent(new CustomEvent('building-selection-changed', { 
              detail: { buildingIds: Array.from(this.selectedBuildingIds) } 
          }));
          
          // Legacy support
          const event = new CustomEvent('game-selection', { detail: { islandId: island.id, buildingId: b.id, buildingType: b.type } });
          window.dispatchEvent(event);

          this.renderMap(this.currentMap!);
        });
      });

      // Interaction
      fillPoly.on('pointerdown', () => {
        // Select island
        const event = new CustomEvent('game-selection', { detail: { islandId: island.id } });
        window.dispatchEvent(event);
      });

      // Hover
      fillPoly.on('pointerover', () => {
         // ...
      });
    });
  }

  createExplosion(x: number, y: number, color: number) {
      // Play explosion sound
      const settings = settingsManager.getSettings();
      const volume = settings.audio.masterVolume * settings.audio.sfxVolume;
      if (volume > 0) {
          try {
              this.sound.play('explosion', { 
                  volume: volume * 0.5,
                  detune: Phaser.Math.Between(-200, 200)
              });
          } catch (e) {
              // Ignore if sound not loaded
          }
      }
      
      // Screen shake
      this.cameras.main.shake(100, 0.005);

      this.menuExplosions.push({x, y, life: 0.5, maxLife: 0.5, color});
      for(let i=0; i<8; i++) {
           this.menuExplosions.push({
               x: x + Phaser.Math.Between(-30, 30),
               y: y + Phaser.Math.Between(-30, 30),
               life: 0.2 + Math.random() * 0.3,
               maxLife: 0.5,
               color: color
           });
      }
  }

  setMenuMode(enabled: boolean) {
      this.isMenuMode = enabled;
      if (enabled) {
          // Clear game entities
          if (this.islandsGroup) this.islandsGroup.clear(true, true);
          if (this.unitsGroup) this.unitsGroup.clear(true, true);
          if (this.rangeGraphics) this.rangeGraphics.clear();
          if (this.pathGraphics) this.pathGraphics.clear();
          if (this.selectionGraphics) this.selectionGraphics.clear();
          this.unitContainers.clear();
          this.unitUpdates.clear();
          this.currentUnits = []; // Clear local unit cache
          
          this.tumbleweeds = [];
        this.weatherParticles = [];
        this.oilAnimations = [];
        this.oilSpotVisuals.clear();
        this.revealedOilSpots.clear();
        
        this.cameras.main.setBackgroundColor('#000000'); 
        // Reset camera
        this.cameras.main.setZoom(1);
          this.cameras.main.scrollX = 0;
          this.cameras.main.scrollY = 0;
      } else {
          this.menuProjectiles = [];
          this.menuExplosions = [];
          if (this.menuGraphics) this.menuGraphics.clear();
          this.cameras.main.setBackgroundColor('#006994');
          this.cameras.main.scrollX = 0;
          this.cameras.main.scrollY = 0;

          if (this.currentMap) {
              this.renderMap(this.currentMap);
              // Center camera on player base
              this.centerCameraOnBase();
              if (this.currentUnits && this.currentUnits.length > 0) {
                  this.renderUnits(this.currentUnits);
              }
          }
      }
  }

  updateMenuAnimation(_time: number, delta: number) {
       // Audio Shake Logic
       if (this.analyser && this.dataArray) {
           this.analyser.getByteFrequencyData(this.dataArray as any);
           
           // Calculate bass intensity (Low frequency bins)
          let sum = 0;
          const bassBins = 8; // Focus on deep bass
          for(let i=0; i<bassBins; i++) {
              sum += this.dataArray[i];
          }
          const avg = sum / bassBins;
          
          // Apply shake if loud enough
          // Scale threshold by volume so shake works at lower volumes too
          const currentVol = this.sound.volume;
          const threshold = 120 * currentVol;
          
          if (avg > threshold && currentVol > 0.1) {
              const shakeMultiplier = settingsManager.getSettings().graphics.screenShakeIntensity ?? 1.0;
              const intensity = Math.pow((avg - threshold) / (255 * currentVol - threshold), 2) * 15 * shakeMultiplier; 
              this.cameras.main.scrollX = (Math.random() - 0.5) * intensity;
              this.cameras.main.scrollY = (Math.random() - 0.5) * intensity;
          } else {
              this.cameras.main.scrollX = 0;
              this.cameras.main.scrollY = 0;
          }
      }

      if (!this.menuGraphics) return;
      this.menuGraphics.clear();
      
      const width = this.cameras.main.width / this.cameras.main.zoom;
      const height = this.cameras.main.height / this.cameras.main.zoom;
      const dt = delta / 1000;

      // Spawn
      this.menuSpawnTimer -= delta;
      const settings = settingsManager.getSettings();
      let percent = settings.graphics.menuProjectileMultiplierPercent ?? 100;
      if (percent < 0) percent = 0;
      if (percent > 10000) percent = 10000;
      const density = percent / 100;

      if (density <= 0) {
          this.menuSpawnTimer = 500;
      } else {
          let spawnedCount = 0;
          // Allow multiple spawns per frame for high density, but cap to avoid freeze
          while (this.menuSpawnTimer <= 0 && spawnedCount < 50) {
              spawnedCount++;
              // Add to timer instead of reset to maintain average rate
              this.menuSpawnTimer += Phaser.Math.Between(100, 300) / density;

              const side = Math.random() < 0.5 ? 'left' : 'right';
              const type = Math.random() < 0.7 ? 'bullet' : 'missile';
              const y = Phaser.Math.Between(50, height - 50);
              
              // Play shoot sound (Limit to first spawn of the frame to prevent audio death)
              const sfxVol = settings.audio.sfxVolume;
              if (sfxVol > 0 && spawnedCount === 1) {
                  try {
                      this.sound.play('shoot', {
                          volume: sfxVol * 0.3, 
                          detune: Phaser.Math.Between(-100, 100)
                      });
                  } catch (e) {
                      // Ignore
                  }
              }

              const initialVy = type === 'missile' ? Phaser.Math.Between(-50, 50) : 0;
              const vx = side === 'left' ? (type === 'bullet' ? 800 : 400) : (type === 'bullet' ? -800 : -400);

              this.menuProjectiles.push({
                  x: side === 'left' ? -50 : width + 50,
                  y: y,
                  vx: vx,
                  vy: initialVy,
                  type: type,
                  color: side === 'left' ? 0x00ff00 : 0xff0000,
                  trail: [],
                  scale: type === 'missile' ? 2 : 1,
                  wobblePhase: Math.random() * Math.PI * 2,
                  turnRate: type === 'missile' ? Phaser.Math.FloatBetween(-0.5, 0.5) : 0,
                  speed: Math.hypot(vx, initialVy),
                  initialVy: initialVy
              });
          }
      }

      // Update Projectiles
      for (let i = this.menuProjectiles.length - 1; i >= 0; i--) {
          const p = this.menuProjectiles[i];
          
          // Movement Logic
          if (p.type === 'missile') {
               // Wobble (Sine wave on VY)
               p.wobblePhase += dt * 5;
               const wobble = Math.sin(p.wobblePhase) * 100;
               
               // Turn (Curve)
               // Adjust angle slowly
               const currentAngle = Math.atan2(p.vy, p.vx);
               const newAngle = currentAngle + p.turnRate * dt;
               
               p.vx = Math.cos(newAngle) * p.speed;
               p.vy = Math.sin(newAngle) * p.speed + wobble * 0.05; // Add wobble influence
          }

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // Trail Logic
          // Add new trail point
          p.trail.unshift({
              x: p.x, 
              y: p.y, 
              alpha: 1.0, 
              size: p.type === 'missile' ? 10 : 3
          });
          
          // Limit trail length
          if (p.trail.length > 20) p.trail.pop();

          // Bounds check
          if (p.x < -100 || p.x > width + 100 || p.y < -100 || p.y > height + 100) {
              this.menuProjectiles.splice(i, 1);
              continue;
          }

          // Draw Trail
          if (p.trail.length > 1) {
              if (p.type === 'bullet') {
                  // Bullet Tracer (Fading Line)
                  for (let t = 0; t < p.trail.length - 1; t++) {
                      const pt1 = p.trail[t];
                      const pt2 = p.trail[t+1];
                      const alpha = 1 - (t / p.trail.length);
                      
                      this.menuGraphics.lineStyle(pt1.size * alpha, p.color, alpha);
                      this.menuGraphics.beginPath();
                      this.menuGraphics.moveTo(pt1.x, pt1.y);
                      this.menuGraphics.lineTo(pt2.x, pt2.y);
                      this.menuGraphics.strokePath();
                  }
              } else {
                  // Missile Smoke (Expanding Circles)
                  for (let t = 0; t < p.trail.length; t++) {
                      const pt = p.trail[t];
                      // Age the particle
                      const age = t / p.trail.length; // 0 to 1
                      const alpha = (1 - age) * 0.5;
                      const size = pt.size * (1 + age * 2); // Expand over time

                      this.menuGraphics.fillStyle(0x888888, alpha);
                      this.menuGraphics.fillCircle(pt.x, pt.y, size);
                  }
              }
          }

          // Draw Body
          this.menuGraphics.fillStyle(p.color);
          if (p.type === 'bullet') {
               this.menuGraphics.fillCircle(p.x, p.y, 3 * p.scale);
          } else {
               const angle = Math.atan2(p.vy, p.vx);
               const s = p.scale;
               this.menuGraphics.save();
               this.menuGraphics.translateCanvas(p.x, p.y);
               this.menuGraphics.rotateCanvas(angle);

               // Thruster Flame (Flickering)
               this.menuGraphics.fillStyle(0xFFA500); // Orange
               const flameLen = 4 * s + Math.random() * 4 * s;
               this.menuGraphics.fillTriangle(
                   -10 * s, -2 * s, 
                   -10 * s, 2 * s, 
                   -10 * s - flameLen, 0
               );

               // Main Body
               this.menuGraphics.fillStyle(p.color);
               this.menuGraphics.fillRect(-10 * s, -3 * s, 16 * s, 6 * s);

               // Nose Cone (Pointy)
               this.menuGraphics.fillStyle(0xFFFFFF); // White tip
               this.menuGraphics.fillTriangle(
                   6 * s, -3 * s, 
                   6 * s, 3 * s, 
                   14 * s, 0
               );

               // Fins (Top and Bottom)
               this.menuGraphics.fillStyle(0x333333); // Dark Grey Fins
               // Top Fin
               this.menuGraphics.fillTriangle(
                   -10 * s, -3 * s, 
                   -2 * s, -3 * s, 
                   -10 * s, -9 * s
               );
               // Bottom Fin
               this.menuGraphics.fillTriangle(
                   -10 * s, 3 * s, 
                   -2 * s, 3 * s, 
                   -10 * s, 9 * s
               );

               // Detail Stripe
               this.menuGraphics.fillStyle(0x111111);
               this.menuGraphics.fillRect(-4 * s, -3 * s, 2 * s, 6 * s);

               this.menuGraphics.restore();
           }
      }

      // Collisions
      for (let i = 0; i < this.menuProjectiles.length; i++) {
           for (let j = i + 1; j < this.menuProjectiles.length; j++) {
               const p1 = this.menuProjectiles[i];
               const p2 = this.menuProjectiles[j];
               
               // Opposing sides only
               if ((p1.vx > 0 && p2.vx < 0) || (p1.vx < 0 && p2.vx > 0)) {
                   const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
                   if (dist < 20) {
                       // Explosion
                       this.createExplosion((p1.x + p2.x)/2, (p1.y + p2.y)/2, 0xFFFF00);
                       
                       this.menuProjectiles.splice(j, 1);
                       this.menuProjectiles.splice(i, 1);
                       i--;
                       break;
                   }
               }
           }
      }

      // Update Explosions
      for (let i = this.menuExplosions.length - 1; i >= 0; i--) {
          const e = this.menuExplosions[i];
          e.life -= dt;
          if (e.life <= 0) {
              this.menuExplosions.splice(i, 1);
              continue;
          }
          
          this.menuGraphics.fillStyle(e.color, e.life / e.maxLife);
          this.menuGraphics.fillCircle(e.x, e.y, (1 - e.life / e.maxLife) * 30);
      }
  }
}
