import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { gameConfig } from '../game/config';

export const GameCanvas: React.FC = () => {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!gameRef.current) {
      gameRef.current = new Phaser.Game(gameConfig);
    }

    return () => {
      // Optional: Clean up on unmount if needed
      // gameRef.current?.destroy(true);
      // gameRef.current = null;
    };
  }, []);

  return <div id="game-container" />;
};
