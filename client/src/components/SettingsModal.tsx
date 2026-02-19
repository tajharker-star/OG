import React, { useState, useEffect } from 'react';
import { settingsManager } from '../game/SettingsManager';
import { Modal } from './Modal';
import type { Settings, Keybinds } from '../game/SettingsManager';
import type { GameMap } from '../types/game';
import './SettingsModal.css';

interface SettingsModalProps {
    onClose: () => void;
    mapData?: GameMap | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, mapData }) => {
    const [settings, setSettings] = useState<Settings>(settingsManager.getSettings());
    const [activeTab, setActiveTab] = useState<'controls' | 'audio' | 'graphics' | 'server'>('controls');
    const [rebindAction, setRebindAction] = useState<keyof Keybinds | null>(null);

    useEffect(() => {
        const fps = (window as any).game?.loop?.actualFps;
        console.log('[SettingsModal] Opened', { fps });
    }, []);

    useEffect(() => {
        const handleSettingsChange = (newSettings: Settings) => {
            setSettings({ ...newSettings });
        };
        settingsManager.on('change', handleSettingsChange);
        return () => settingsManager.off('change', handleSettingsChange);
    }, []);

    // Handle key rebind
    useEffect(() => {
        if (!rebindAction) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation(); // Stop game from reacting
            
            // Allow Escape to cancel rebind
            if (e.key === 'Escape') {
                setRebindAction(null);
                return;
            }

            const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            settingsManager.setKeybind(rebindAction, key);
            setRebindAction(null);
        };

        window.addEventListener('keydown', handleKeyDown, { capture: true }); // Capture to prevent game input
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [rebindAction]);

    return (
        <Modal 
            isOpen={true} 
            onClose={onClose} 
            title="⚙️ Settings"
            className="settings-modal-content"
        >
            {/* Tabs */}
            <div className="settings-tabs">
                {(['controls', 'audio', 'graphics', 'server'] as const).map(tab => (
                    // Only show server tab if mapData exists (ingame)
                    (tab === 'server' && !mapData) ? null : (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`settings-tab-btn ${activeTab === tab ? 'active' : ''}`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                    )
                ))}
            </div>

            {/* Content */}
            <div className="settings-content">
                    {activeTab === 'controls' && (
                        <div>
                            {rebindAction && (
                                <div className="rebind-overlay">
                                    <h3>Press any key to bind "{formatKeyName(rebindAction)}"</h3>
                                    <p>Press ESC to cancel</p>
                                </div>
                            )}
                            
                            <div className="settings-controls-grid">
                                {Object.entries(settings.keybinds).map(([action, key]) => (
                                    <div key={action} className="settings-control-row">
                                        <span>{formatKeyName(action)}</span>
                                        <button 
                                            onClick={() => setRebindAction(action as keyof Keybinds)}
                                            className="key-bind-btn"
                                        >
                                            {key}
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button 
                                onClick={() => settingsManager.reset()}
                                className="reset-btn"
                            >
                                Reset to Defaults
                            </button>
                        </div>
                    )}

                    {activeTab === 'audio' && (
                        <div className="settings-section">
                            <VolumeSlider 
                                label="Master Volume" 
                                value={settings.audio.masterVolume} 
                                onChange={(v) => settingsManager.setAudio('masterVolume', v)} 
                            />
                            <VolumeSlider 
                                label="Music Volume" 
                                value={settings.audio.musicVolume} 
                                onChange={(v) => settingsManager.setAudio('musicVolume', v)} 
                            />
                            <VolumeSlider 
                                label="SFX Volume" 
                                value={settings.audio.sfxVolume} 
                                onChange={(v) => settingsManager.setAudio('sfxVolume', v)} 
                            />
                        </div>
                    )}

                    {activeTab === 'graphics' && (
                        <div className="settings-section">
                            <Checkbox 
                                label="Show FPS" 
                                checked={settings.graphics.showFps} 
                                onChange={(v) => settingsManager.setGraphics('showFps', v)} 
                            />
                            <Checkbox 
                                label="High Quality" 
                                checked={settings.graphics.highQuality} 
                                onChange={(v) => settingsManager.setGraphics('highQuality', v)} 
                            />
                            <Checkbox 
                                label="Show Particles" 
                                checked={settings.graphics.showParticles} 
                                onChange={(v) => settingsManager.setGraphics('showParticles', v)} 
                            />
                            <Checkbox 
                                label="Show Weather (Rain/Tumbleweeds)" 
                                checked={settings.graphics.showWeather} 
                                onChange={(v) => settingsManager.setGraphics('showWeather', v)} 
                            />
                            
                            <div className="settings-sub-section">
                                <div className="slider-header">
                                    <span>Target FPS</span>
                                    <span>{settings.graphics.targetFps || 60}</span>
                                </div>
                                <input 
                                    type="range" min="30" max="144" step="15" 
                                    value={settings.graphics.targetFps || 60} 
                                    onChange={(e) => settingsManager.setGraphics('targetFps', parseInt(e.target.value))}
                                    className="settings-range"
                                />
                            </div>

                            <div className="settings-sub-section">
                                <div className="slider-header">
                                    <span>Menu Projectile Count</span>
                                    <span>{Math.round(Math.max(0, Math.min(10000, settings.graphics.menuProjectileMultiplierPercent ?? 100)))}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="10000" step="10" 
                                    value={Math.max(0, Math.min(10000, settings.graphics.menuProjectileMultiplierPercent ?? 100))} 
                                    onChange={(e) => settingsManager.setGraphics('menuProjectileMultiplierPercent', Math.max(0, Math.min(10000, parseInt(e.target.value))))}
                                    className="settings-range"
                                />
                                {((settings.graphics.menuProjectileMultiplierPercent ?? 100) > 2000) && (
                                    <div className="settings-warning-text">
                                        May impact performance at very high values.
                                    </div>
                                )}
                            </div>

                            <div className="settings-sub-section">
                                <div className="slider-header">
                                    <span>Screen Shake Intensity</span>
                                    <span>{Math.round((settings.graphics.screenShakeIntensity ?? 1.0) * 100)}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="2" step="0.1" 
                                    value={settings.graphics.screenShakeIntensity ?? 1.0} 
                                    onChange={(e) => settingsManager.setGraphics('screenShakeIntensity', parseFloat(e.target.value))}
                                    className="settings-range"
                                />
                            </div>

                            {settings.graphics.showParticles && (
                                <div className="settings-sub-section-indented">
                                    <div className="slider-header">
                                        <span>Max Particles</span>
                                        <span>{settings.graphics.maxParticles}</span>
                                    </div>
                                    <input 
                                        type="range" min="0" max="2000" step="50" 
                                        value={settings.graphics.maxParticles} 
                                        onChange={(e) => settingsManager.setGraphics('maxParticles', parseInt(e.target.value))}
                                        className="settings-range"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'server' && (
                        <div className="settings-section">
                            <div className="info-box">
                                <h4>Map Information</h4>
                                <div className="info-grid">
                                    <div>Type:</div>
                                    <div className="info-value-bold">{mapData?.mapType || 'Islands (Default)'}</div>
                                    <div>Dimensions:</div>
                                    <div>{mapData ? `${mapData.width}x${mapData.height}` : '-'}</div>
                                    <div>Islands:</div>
                                    <div>{mapData?.islands.length || 0}</div>
                                </div>
                            </div>

                            <div className="info-box">
                                <h4>Server Information</h4>
                                <div className="info-grid">
                                    <div>Region:</div>
                                    <div>{mapData?.serverRegion || 'Unknown'}</div>
                                    <div>Status:</div>
                                    <div className="status-online">Online</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
        </Modal>
    );
};

// Helper Components
const VolumeSlider = ({ label, value, onChange }: { label: string, value: number, onChange: (v: number) => void }) => (
    <div className="slider-container">
        <div className="slider-header">
            <span>{label}</span>
            <span>{Math.round(value * 100)}%</span>
        </div>
        <input 
            type="range" min="0" max="1" step="0.05" 
            value={value} 
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="settings-range"
        />
    </div>
);

const Checkbox = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
    <label className="settings-checkbox">
        <input 
            type="checkbox" 
            checked={checked} 
            onChange={(e) => onChange(e.target.checked)}
        />
        {label}
    </label>
);

const formatKeyName = (key: string) => {
    // camelCase to Words
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
};
