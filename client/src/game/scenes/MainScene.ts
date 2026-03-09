import Phaser from 'phaser';
import { socket } from '../../services/socket';
import { settingsManager } from '../SettingsManager';
import type { Settings } from '../SettingsManager';
import type { GameMap, Island, Player, Unit } from '../../types/game';
import { createUnitArt } from '../rendering/unitArt';
import { createBuildingArt } from '../rendering/buildingArt';

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
  private attackFacingOverrides: Map<string, { angle: number; expiresAt: number }> = new Map();
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
  private currentMapStateSignature: string | null = null;
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

  private registerAttackFacing(attackerId: string | undefined, x1: number, y1: number, x2: number, y2: number, duration = 240) {
    if (!attackerId) return;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    this.attackFacingOverrides.set(attackerId, {
      angle,
      expiresAt: Date.now() + duration
    });
  }

  private getDesiredFacingAngle(unit: Unit): number | undefined {
    const override = this.attackFacingOverrides.get(unit.id);
    if (override) {
      if (override.expiresAt > Date.now()) return override.angle;
      this.attackFacingOverrides.delete(unit.id);
    }

    const prediction = this.predictedMoves.get(unit.id);
    if (prediction && prediction.vx !== undefined && prediction.vy !== undefined) {
      if (Math.hypot(prediction.vx, prediction.vy) > 5) {
        return Math.atan2(prediction.vy, prediction.vx);
      }
    }

    if (typeof unit.facingAngle === 'number') {
      return unit.facingAngle;
    }

    const history = this.unitUpdates.get(unit.id);
    if (history && history.length >= 2) {
      const current = history[history.length - 1];
      const previous = history[history.length - 2];
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (Math.hypot(dx, dy) > 1) {
        return Math.atan2(dy, dx);
      }
    }

    return undefined;
  }

  private rotateUnitArt(container: Phaser.GameObjects.Container, targetAngle: number | undefined, dtSec: number, snap = false) {
    const art = container.getByName('art') as Phaser.GameObjects.Container | null;
    if (!art || typeof targetAngle !== 'number' || Number.isNaN(targetAngle)) return;

    if (snap) {
      art.rotation = targetAngle;
      return;
    }

    art.rotation = Phaser.Math.Angle.RotateTo(art.rotation, targetAngle, 8 * dtSec);
  }

  private getMapStateSignature(mapData: GameMap) {
    const buildingState = mapData.islands
      .flatMap(island =>
        island.buildings.map(building => {
          const queue = building.recruitmentQueue?.[0];
          const queueState = queue
            ? `${queue.unitType}:${Math.round(queue.progress)}:${Math.round(queue.totalTime)}:${building.recruitmentQueue?.length || 0}`
            : 'none';
          return [
            island.id,
            building.id,
            building.type,
            building.ownerId ?? island.ownerId ?? '',
            Math.round(building.health),
            Math.round(building.maxHealth),
            building.isConstructing ? 1 : 0,
            Math.round(building.constructionProgress ?? 0),
            building.hasTesla ? 1 : 0,
            queueState
          ].join(':');
        })
      )
      .join('|');

    const oilState = mapData.oilSpots
      .map(spot => `${spot.id}:${spot.occupiedBy ?? ''}:${(spot as any).ownerId ?? ''}`)
      .join('|');

    return `${buildingState}#${oilState}`;
  }

  private handleProjectileEvent(data: {
    attackerId?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    type: string;
    speed: number;
  }, playSound = true) {
    this.registerAttackFacing(data.attackerId, data.x1, data.y1, data.x2, data.y2, data.type === 'rocket_missile' ? 420 : 220);

    if (playSound) {
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
    }

    if (data.type === 'tesla') {
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
      for (let i = 1; i < segments; i++) {
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

      this.tweens.add({
        targets: graphics,
        alpha: 0,
        duration: 150,
        onComplete: () => graphics.destroy()
      });

      return;
    }

    if (data.type === 'rocket_missile') {
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
        duration,
        onComplete: () => {
          const explosion = this.add.circle(data.x2, data.y2, 20, 0xFF4500);
          explosion.setDepth(101);

          this.tweens.add({
            targets: explosion,
            scale: 6,
            alpha: 0,
            duration: 500,
            onComplete: () => explosion.destroy()
          });

          const ring = this.add.circle(data.x2, data.y2, 20, 0xFFFFFF);
          ring.setStrokeStyle(4, 0xFFFF00);
          ring.setFillStyle(0xFFFFFF, 0);
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

      return;
    }

    const bullet = this.add.circle(data.x1, data.y1, 3, 0xFFFF00);
    bullet.setStrokeStyle(1, 0xFFAA00);
    bullet.setDepth(100);

    const dist = Math.hypot(data.x2 - data.x1, data.y2 - data.y1);
    const duration = (dist / data.speed) * 1000;

    this.tweens.add({
      targets: bullet,
      x: data.x2,
      y: data.y2,
      duration,
      onComplete: () => {
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
        this.attackFacingOverrides.clear();
        this.unitsGroup.clear(true, true);
        this.selectedUnitIds.clear();
        this.selectedBuildingIds.clear();
        this.selectedNodeIds.clear();
        this.cameraInitialized = false; // Reset camera so it centers on new base
        this.currentMapVersion = null; // Force map re-render
        this.currentMapStateSignature = null;
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
            const mapStateSignature = this.getMapStateSignature(mapData);
            const mapVersion = mapData.version;
            if (
                mapVersion &&
                mapVersion === this.currentMapVersion &&
                mapStateSignature === this.currentMapStateSignature
            ) {
                return;
            }
            
            this.currentMapVersion = mapVersion || null;
            this.currentMapStateSignature = mapStateSignature;
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
                if (me && ((me as any).canBuildHQ === false || me.status === 'eliminated' || (me as any).hqSpawnedOnce)) return;

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

    socket.on('projectile', (data: { attackerId?: string, x1: number, y1: number, x2: number, y2: number, type: string, speed: number }) => {
        this.handleProjectileEvent(data);
    });

    socket.on('projectilesBatch', (projectiles: { attackerId?: string, x1: number, y1: number, x2: number, y2: number, type: string, speed: number }[]) => {
        projectiles.forEach((projectile, index) => this.handleProjectileEvent(projectile, index === 0));
    });

    socket.on('laserBeam', (data: { attackerId: string, targetId: string, x1: number, y1: number, x2: number, y2: number, duration: number, color: number }) => {
        this.registerAttackFacing(data.attackerId, data.x1, data.y1, data.x2, data.y2, data.duration);
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

      this.currentUnits.forEach(unit => {
          const container = this.unitContainers.get(unit.id);
          if (!container) return;
          this.rotateUnitArt(container, this.getDesiredFacingAngle(unit), dtSec);
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
      return createBuildingArt(this, x, y, type as any, color, data);
  }

  drawDetailedUnit(x: number, y: number, type: string, color: number, isSelected: boolean): Phaser.GameObjects.Container {
      return createUnitArt(this, x, y, type, color, isSelected);
  }

  createUnitContainer(unit: Unit, isMine: boolean, isSelected: boolean) {
      const player = this.players.get(unit.ownerId);
      const color = player ? parseInt(player.color.replace('#', '0x')) : (isMine ? 0xAAAAFF : 0xFFAAAA);
      
      const uContainer = this.add.container(unit.x, unit.y);
      const art = this.drawDetailedUnit(0, 0, unit.type, color, isSelected);
      art.setName('art');
      uContainer.add(art);
      uContainer.setPosition(unit.x, unit.y);
      uContainer.setDepth(20); // Ensure units are above everything else
      uContainer.setData('isSelected', isSelected);
      uContainer.setData('unitType', unit.type);
      
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

      this.rotateUnitArt(uContainer, this.getDesiredFacingAngle(unit), 1 / 60, true);
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
              this.attackFacingOverrides.delete(id);
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
