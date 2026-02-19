import React, { useEffect, useState } from 'react';
import { connectionManager } from '../services/socket';
import './ConnectionLostOverlay.css';

interface ConnectionLostOverlayProps {
    onRetry: () => void;
    onMainMenu: () => void;
}

export const ConnectionLostOverlay: React.FC<ConnectionLostOverlayProps> = ({ onRetry, onMainMenu }) => {
    const [state, setState] = useState(connectionManager.getState());

    useEffect(() => {
        const unsubscribe = connectionManager.subscribe((newState) => {
            setState(newState);
        });
        return unsubscribe;
    }, []);

    if (state.phase !== 'DISCONNECTED' && state.phase !== 'FAILED') return null;

    return (
        <div className="connection-lost-overlay">
            <div className="connection-lost-modal">
                <h2 className="connection-lost-title">⚠️ Connection Lost</h2>
                <div className="connection-lost-details">
                    <p className="status-text">
                        {state.phase === 'DISCONNECTED' ? 'Attempting to reconnect...' : 'Connection Failed'}
                    </p>
                    <p className="reason-text">Reason: {state.details || state.error || 'Unknown Error'}</p>
                    <p className="endpoint-text">Server: {state.url}</p>
                    {state.retryCount !== undefined && state.retryCount > 0 && (
                        <p className="retry-text">Retry Attempt: {state.retryCount} / 20</p>
                    )}
                </div>

                <div className="connection-lost-actions">
                    <button onClick={onRetry} className="retry-btn">
                        Retry Now
                    </button>
                    <button onClick={onMainMenu} className="main-menu-btn">
                        Back to Main Menu
                    </button>
                </div>
            </div>
        </div>
    );
};
