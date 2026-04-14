import Phaser from 'phaser';
import { MainScene } from './scenes/MainScene';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : null;
const isElectron = Boolean((window as any)?.process?.versions?.electron)
  || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
const forceCanvasRenderer = Boolean(searchParams?.has('canvas')) || isElectron;

console.log('[GameConfig] Environment detected:', isElectron ? 'Electron' : 'Web');
console.log('[GameConfig] Renderer mode:', forceCanvasRenderer ? 'Canvas' : 'Auto');

export const gameConfig: Phaser.Types.Core.GameConfig = {
  // Packaged desktop builds need a safer fallback because WebGL initialization
  // has been crashing on some Macs before the app can reach the menu.
  type: forceCanvasRenderer ? Phaser.CANVAS : Phaser.AUTO,
  render: {
    antialias: false,
    powerPreference: forceCanvasRenderer ? 'default' : 'high-performance',
    roundPixels: true,
  },
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
