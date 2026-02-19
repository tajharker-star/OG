import React, { useEffect, useState } from 'react';
import { DEFEAT_TAGLINES, VICTORY_TAGLINES } from '../data/endGameTaglines';
import { Confetti } from './Confetti';
import './EndGameOverlay.css';

interface EndGameOverlayProps {
    mode: 'VICTORY' | 'DEFEAT';
    onSpectate?: () => void;
    onMainMenu: () => void;
    canSpectate?: boolean;
    reason?: string;
}

export const EndGameOverlay: React.FC<EndGameOverlayProps> = ({ mode, onSpectate, onMainMenu, canSpectate, reason }) => {
    const [tagline, setTagline] = useState('');
    
    useEffect(() => {
        const lines = mode === 'VICTORY' ? VICTORY_TAGLINES : DEFEAT_TAGLINES;
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        setTagline(randomLine);
    }, [mode]);

    // Embers for defeat
    const renderEmbers = () => {
        const embers = [];
        for (let i = 0; i < 50; i++) {
            const left = Math.random() * 100;
            const delay = Math.random() * 5;
            const duration = 2 + Math.random() * 3;
            embers.push(
                <div 
                    key={i} 
                    className="ember" 
                    style={{ 
                        left: `${left}%`, 
                        animationDelay: `${delay}s`,
                        animationDuration: `${duration}s`
                    }} 
                />
            );
        }
        return <div className="defeat-fx">{embers}</div>;
    };

    return (
        <div className={`end-game-overlay ${mode.toLowerCase()}`}>
            {/* Input blocker is implicit due to fixed overlay with pointer-events: auto */}
            
            {mode === 'VICTORY' && <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10000, pointerEvents: 'none'}}><Confetti /></div>}
            {mode === 'DEFEAT' && renderEmbers()}

            <div className="end-game-content">
                <h1 className="end-game-title">{mode}</h1>
                <p className="end-game-tagline">{tagline}</p>
                {reason && (
                    <p className="end-game-reason" style={{ color: '#ff6b6b', marginTop: '10px', fontSize: '18px' }}>
                        {reason === 'HQ_SELF_DELETED' ? 'Command Center Self-Destructed' : 
                         reason === 'HQ_DESTROYED' ? 'Command Center Destroyed' : reason}
                    </p>
                )}
                
                <div className="end-game-actions">
                    {mode === 'DEFEAT' && canSpectate && onSpectate && (
                        <button className="end-game-btn secondary" onClick={onSpectate}>
                            Spectate
                        </button>
                    )}
                    <button className="end-game-btn primary" onClick={onMainMenu}>
                        Main Menu
                    </button>
                </div>
            </div>
        </div>
    );
};
