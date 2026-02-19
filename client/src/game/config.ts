import Phaser from 'phaser';
import { MainScene } from './scenes/MainScene';

// Detect Electron environment
const isElectron = navigator.userAgent.includes('Electron');
console.log('[GameConfig] Environment detected:', isElectron ? 'Electron' : 'Web');

export const gameConfig: Phaser.Types.Core.GameConfig = {
  // Use AUTO to allow WebGL rendering for better performance
  type: Phaser.AUTO,
  parent: 'game-container',
  width: '100%',
  height: '100%',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  backgroundColor: '#000000',
  scene: [MainScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 }, // Top down, no gravity
      debug: false
    }
  }
};
