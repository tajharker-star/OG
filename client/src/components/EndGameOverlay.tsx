import React, { useEffect, useState } from 'react';
import { DEFEAT_TAGLINES, VICTORY_TAGLINES } from '../data/endGameTaglines';
import { Confetti } from './Confetti';
import { getRankedProgressBarState } from '../utils/playerStatistics';
import './EndGameOverlay.css';

type RankedOverlaySummary = {
    placement: number;
    participantCount: number;
    pointsBefore: number;
    pointsDelta: number;
    pointsAfter: number;
};

interface EndGameOverlayProps {
    mode: 'VICTORY' | 'DEFEAT';
    onSpectate?: () => void;
    onMainMenu: () => void;
    canSpectate?: boolean;
    reason?: string;
    rankedSummary?: RankedOverlaySummary | null;
}

const formatPlacement = (placement: number) => {
    const remainder = placement % 10;
    const teens = placement % 100;
    if (teens >= 11 && teens <= 13) return `${placement}th`;
    if (remainder === 1) return `${placement}st`;
    if (remainder === 2) return `${placement}nd`;
    if (remainder === 3) return `${placement}rd`;
    return `${placement}th`;
};

export const EndGameOverlay: React.FC<EndGameOverlayProps> = ({ mode, onSpectate, onMainMenu, canSpectate, reason, rankedSummary }) => {
    const [tagline, setTagline] = useState('');
    const [animatedPoints, setAnimatedPoints] = useState(rankedSummary?.pointsAfter ?? 0);
    
    useEffect(() => {
        const lines = mode === 'VICTORY' ? VICTORY_TAGLINES : DEFEAT_TAGLINES;
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        setTagline(randomLine);
    }, [mode]);

    useEffect(() => {
        if (!rankedSummary) {
            setAnimatedPoints(0);
            return;
        }

        const startPoints = rankedSummary.pointsBefore;
        const endPoints = rankedSummary.pointsAfter;
        let frameId = 0;
        let startTime = 0;

        setAnimatedPoints(startPoints);

        const step = (timestamp: number) => {
            if (!startTime) {
                startTime = timestamp;
            }

            const elapsed = timestamp - startTime;
            const progress = Math.min(1, elapsed / 900);
            const eased = 1 - Math.pow(1 - progress, 3);
            const nextPoints = Math.round(startPoints + (endPoints - startPoints) * eased);
            setAnimatedPoints(nextPoints);

            if (progress < 1) {
                frameId = window.requestAnimationFrame(step);
            }
        };

        frameId = window.requestAnimationFrame(step);
        return () => window.cancelAnimationFrame(frameId);
    }, [rankedSummary]);

    const rankedBarState = rankedSummary
        ? getRankedProgressBarState(animatedPoints)
        : null;

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

                {rankedSummary && rankedBarState && (
                    <div className="end-game-ranked-panel">
                        <div className="end-game-ranked-topline">
                            <span>Placement</span>
                            <strong>{formatPlacement(rankedSummary.placement)} / {rankedSummary.participantCount}</strong>
                        </div>
                        <div className={`end-game-ranked-delta ${rankedSummary.pointsDelta >= 0 ? 'positive' : 'negative'}`}>
                            {rankedSummary.pointsDelta >= 0 ? '+' : ''}{rankedSummary.pointsDelta} Ranked Points
                        </div>
                        <div className="end-game-ranked-bar-head">
                            <span>{rankedBarState.floor} RP</span>
                            <strong>{animatedPoints} RP</strong>
                            <span>{rankedBarState.ceiling} RP</span>
                        </div>
                        <div className="end-game-ranked-bar">
                            <div
                                className="end-game-ranked-bar-fill"
                                style={{ width: `${rankedBarState.progressPercent}%` }}
                            />
                        </div>
                    </div>
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
