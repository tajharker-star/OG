import React, { useState, useEffect } from 'react';
import { settingsManager } from '../game/SettingsManager';
import { SFX_EFFECT_DEFINITIONS, SFX_GROUP_DEFINITIONS } from '../audio/sfxCatalog';
import { soundEffectsManager } from '../audio/soundEffects';
import {
    clearDiagnosticsLog,
    copyTextToClipboard,
    DIAGNOSTICS_LOG_UPDATED_EVENT,
    DIAGNOSTICS_STORAGE_KEY,
    formatDiagnosticsEntry,
    formatDiagnosticsLog,
    readDiagnosticsLog,
} from '../utils/diagnosticsLog';
import { Modal } from './Modal';
import type { Settings, Keybinds } from '../game/SettingsManager';
import type { GameMap } from '../types/game';
import type { DiagnosticLogEntry } from '../utils/diagnosticsLog';
import './SettingsModal.css';

interface SettingsModalProps {
    onClose: () => void;
    mapData?: GameMap | null;
}

const SFX_EFFECT_GROUPS = SFX_GROUP_DEFINITIONS.map(group => ({
    ...group,
    effects: SFX_EFFECT_DEFINITIONS.filter(effect => effect.group === group.id),
}));

type SettingsTab = 'controls' | 'audio' | 'graphics' | 'diagnostics' | 'server';

const SETTINGS_TABS: SettingsTab[] = ['controls', 'audio', 'graphics', 'diagnostics', 'server'];

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
    controls: 'Controls',
    audio: 'Audio',
    graphics: 'Graphics',
    diagnostics: 'Diagnostics',
    server: 'Server',
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, mapData }) => {
    const [settings, setSettings] = useState<Settings>(settingsManager.getSettings());
    const [activeTab, setActiveTab] = useState<SettingsTab>('controls');
    const [rebindAction, setRebindAction] = useState<keyof Keybinds | null>(null);
    const [diagnosticsLog, setDiagnosticsLog] = useState<DiagnosticLogEntry[]>(() => readDiagnosticsLog());
    const [diagnosticsCopyState, setDiagnosticsCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const visibleDiagnosticsLog = [...diagnosticsLog].reverse();

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

    useEffect(() => {
        const refreshDiagnosticsLog = () => setDiagnosticsLog(readDiagnosticsLog());
        const handleStorage = (event: StorageEvent) => {
            if (event.key === DIAGNOSTICS_STORAGE_KEY) {
                refreshDiagnosticsLog();
            }
        };

        window.addEventListener(DIAGNOSTICS_LOG_UPDATED_EVENT, refreshDiagnosticsLog as EventListener);
        window.addEventListener('storage', handleStorage);
        refreshDiagnosticsLog();

        return () => {
            window.removeEventListener(DIAGNOSTICS_LOG_UPDATED_EVENT, refreshDiagnosticsLog as EventListener);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const copyDiagnosticsText = async (text: string) => {
        const copied = await copyTextToClipboard(text);
        setDiagnosticsCopyState(copied ? 'copied' : 'failed');
    };

    const handleCopyDiagnosticsLog = () => {
        void copyDiagnosticsText(formatDiagnosticsLog(diagnosticsLog));
    };

    const handleClearDiagnosticsLog = () => {
        setDiagnosticsLog(clearDiagnosticsLog());
        setDiagnosticsCopyState('idle');
    };

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
                {SETTINGS_TABS.map(tab => (
                    // Only show server tab if mapData exists (ingame)
                    (tab === 'server' && !mapData) ? null : (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`settings-tab-btn ${activeTab === tab ? 'active' : ''}`}
                    >
                        {SETTINGS_TAB_LABELS[tab]}
                    </button>
                    )
                ))}
            </div>

            {/* Content */}
            <div className="settings-content">
                    {activeTab === 'controls' && (
                        <div className="settings-tab-panel settings-tab-panel--controls">
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
                        <div className="settings-section settings-section--audio">
                            <div className="settings-section settings-section--cards">
                                <VolumeSlider 
                                    label="Master Volume" 
                                    value={settings.audio.masterVolume} 
                                    onChange={(v) => settingsManager.setAudio('masterVolume', v)} 
                                    onCommit={() => soundEffectsManager.playSfxPreview()}
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
                                    onCommit={() => soundEffectsManager.playSfxPreview()}
                                />
                            </div>

                            <details className="settings-sfx-dropdown">
                                <summary className="settings-sfx-dropdown__summary">
                                    <div className="settings-sfx-dropdown__summary-text">
                                        <span className="settings-sfx-dropdown__title">Advanced SFX Mixer</span>
                                        <span className="settings-sfx-dropdown__meta">{SFX_EFFECT_DEFINITIONS.length} individual sound controls</span>
                                    </div>
                                    <span className="settings-sfx-dropdown__chevron" aria-hidden="true">▾</span>
                                </summary>

                                <div className="settings-sfx-groups">
                                    {SFX_EFFECT_GROUPS.map(group => (
                                        <section key={group.id} className="settings-sfx-group-card">
                                            <div className="settings-sfx-group-card__header">
                                                <h4 className="settings-sfx-group-card__title">{group.label}</h4>
                                                <span className="settings-sfx-group-card__count">{group.effects.length} sounds</span>
                                            </div>

                                            <div className="settings-sfx-rows">
                                                {group.effects.map(effect => (
                                                    <EffectVolumeRow
                                                        key={effect.id}
                                                        label={effect.label}
                                                        value={settings.audio.sfxEffectLevels[effect.id]}
                                                        onChange={(value) => settingsManager.setSfxEffectLevel(effect.id, value)}
                                                        onPreview={() => soundEffectsManager.playSfxPreview(effect.id)}
                                                    />
                                                ))}
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </details>
                        </div>
                    )}

                    {activeTab === 'graphics' && (
                        <div className="settings-section settings-section--two-column">
                            <div className="settings-panel-card settings-panel-card--stack">
                                <h4 className="settings-panel-card__title">Visual Toggles</h4>
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
                                <Checkbox
                                    label="Auto Performance Mode (FPS Saver)"
                                    checked={settings.graphics.autoPerformanceMode ?? true}
                                    onChange={(v) => settingsManager.setGraphics('autoPerformanceMode', v)}
                                />
                            </div>

                            <div className="settings-panel-card settings-panel-card--stack">
                                <h4 className="settings-panel-card__title">Performance & Camera</h4>
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

                                {(settings.graphics.autoPerformanceMode ?? true) && (
                                    <div className="settings-sub-section">
                                        <div className="slider-header">
                                            <span>Auto Performance Strength</span>
                                            <span>{Math.round(settings.graphics.autoPerformanceAggression ?? 3)} / 5</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="1"
                                            max="5"
                                            step="1"
                                            value={Math.max(1, Math.min(5, Math.round(settings.graphics.autoPerformanceAggression ?? 3)))}
                                            onChange={(e) => settingsManager.setGraphics('autoPerformanceAggression', parseInt(e.target.value))}
                                            className="settings-range"
                                        />
                                        <div className="settings-warning-text">
                                            Higher values react faster to FPS drops and cut soldier/projectile visuals more.
                                        </div>
                                    </div>
                                )}

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Bullets</span>
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
                                    <div className="settings-warning-text">
                                        Controls the total amount of lobby bullets and rockets together.
                                    </div>
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Rockets</span>
                                        <span>{Math.round(Math.max(0, Math.min(10000, settings.graphics.menuRocketMultiplierPercent ?? 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="10000" step="10"
                                        value={Math.max(0, Math.min(10000, settings.graphics.menuRocketMultiplierPercent ?? 100))}
                                        onChange={(e) => settingsManager.setGraphics('menuRocketMultiplierPercent', Math.max(0, Math.min(10000, parseInt(e.target.value))))}
                                        className="settings-range"
                                    />
                                    <div className="settings-warning-text">
                                        Adds extra rockets on top of the shared bullet chaos slider.
                                    </div>
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Explosions</span>
                                        <span>{Math.round(Math.max(0, Math.min(200, (settings.graphics.menuExplosionDensity ?? 1) * 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="2" step="0.05"
                                        value={Math.max(0, Math.min(2, settings.graphics.menuExplosionDensity ?? 1))}
                                        onChange={(e) => settingsManager.setGraphics('menuExplosionDensity', Math.max(0, Math.min(2, parseFloat(e.target.value))))}
                                        className="settings-range"
                                    />
                                    {((settings.graphics.menuExplosionDensity ?? 1) <= 0.01) && (
                                        <div className="settings-warning-text">
                                            Main menu explosion visuals are disabled.
                                        </div>
                                    )}
                                    <div className="settings-warning-text">
                                        Controls lobby blast size and overall impact intensity.
                                    </div>
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Colour Variety</span>
                                        <span>{Math.round(Math.max(0, Math.min(100, (settings.graphics.menuProjectileColorVariety ?? 0.85) * 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="1" step="0.01"
                                        value={Math.max(0, Math.min(1, settings.graphics.menuProjectileColorVariety ?? 0.85))}
                                        onChange={(e) => settingsManager.setGraphics('menuProjectileColorVariety', Math.max(0, Math.min(1, parseFloat(e.target.value))))}
                                        className="settings-range"
                                    />
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Material Variety</span>
                                        <span>{Math.round(Math.max(0, Math.min(100, (settings.graphics.menuProjectileMaterialVariety ?? 0.8) * 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="1" step="0.01"
                                        value={Math.max(0, Math.min(1, settings.graphics.menuProjectileMaterialVariety ?? 0.8))}
                                        onChange={(e) => settingsManager.setGraphics('menuProjectileMaterialVariety', Math.max(0, Math.min(1, parseFloat(e.target.value))))}
                                        className="settings-range"
                                    />
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Size Variety</span>
                                        <span>{Math.round(Math.max(0, Math.min(200, (settings.graphics.menuProjectileSizeVariance ?? 0.7) * 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="2" step="0.05"
                                        value={Math.max(0, Math.min(2, settings.graphics.menuProjectileSizeVariance ?? 0.7))}
                                        onChange={(e) => settingsManager.setGraphics('menuProjectileSizeVariance', Math.max(0, Math.min(2, parseFloat(e.target.value))))}
                                        className="settings-range"
                                    />
                                </div>

                                <div className="settings-sub-section">
                                    <div className="slider-header">
                                        <span>Main Menu Rocket Turn</span>
                                        <span>{Math.round(Math.max(0, Math.min(250, (settings.graphics.menuRocketTurnStrength ?? 1.1) * 100)))}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="2.5" step="0.05"
                                        value={Math.max(0, Math.min(2.5, settings.graphics.menuRocketTurnStrength ?? 1.1))}
                                        onChange={(e) => settingsManager.setGraphics('menuRocketTurnStrength', Math.max(0, Math.min(2.5, parseFloat(e.target.value))))}
                                        className="settings-range"
                                    />
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
                        </div>
                    )}

                    {activeTab === 'diagnostics' && (
                        <div className="settings-section settings-diagnostics-panel">
                            <div className="settings-diagnostics-hero">
                                <div>
                                    <h4>Session Diagnostics Console</h4>
                                    <p>
                                        Lag packets are saved before reload, survive Command+R, and clear when the app window closes.
                                    </p>
                                </div>
                                <div className="settings-diagnostics-hero__count">
                                    <span>{diagnosticsLog.length}</span>
                                    <small>captured</small>
                                </div>
                            </div>

                            <div className="settings-diagnostics-toolbar">
                                <button
                                    type="button"
                                    className="settings-diagnostics-action"
                                    onClick={handleCopyDiagnosticsLog}
                                >
                                    Copy All For Codex
                                </button>
                                <button
                                    type="button"
                                    className="settings-diagnostics-action settings-diagnostics-action--muted"
                                    onClick={() => setDiagnosticsLog(readDiagnosticsLog())}
                                >
                                    Refresh
                                </button>
                                <button
                                    type="button"
                                    className="settings-diagnostics-action settings-diagnostics-action--danger"
                                    onClick={handleClearDiagnosticsLog}
                                >
                                    Clear Session
                                </button>
                                <span className={`settings-diagnostics-copy-state settings-diagnostics-copy-state--${diagnosticsCopyState}`}>
                                    {diagnosticsCopyState === 'copied' && 'Copied to clipboard.'}
                                    {diagnosticsCopyState === 'failed' && 'Copy failed. Try again.'}
                                    {diagnosticsCopyState === 'idle' && 'Ready to capture lag packets.'}
                                </span>
                            </div>

                            {diagnosticsLog.length === 0 ? (
                                <div className="settings-diagnostics-empty">
                                    No lag diagnostics have been captured yet. When the top-right lag popup appears, it will also be saved here.
                                </div>
                            ) : (
                                <div className="settings-diagnostics-log" role="log" aria-label="Session lag diagnostics">
                                    {visibleDiagnosticsLog.map(entry => (
                                        <DiagnosticLogCard
                                            key={`${entry.id}-${entry.capturedAt}`}
                                            entry={entry}
                                            onCopy={(text) => {
                                                void copyDiagnosticsText(text);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'server' && (
                        <div className="settings-section settings-section--cards">
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
const getDiagnosticNumber = (detail: Record<string, unknown>, key: string): number | null => {
    const value = detail[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const getDiagnosticString = (detail: Record<string, unknown>, key: string): string | null => {
    const value = detail[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
};

const getDiagnosticRecommendations = (detail: Record<string, unknown>): string[] => {
    const value = detail.recommendations;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

const formatDiagnosticMs = (value: number | null) => value === null ? '--' : `${Math.round(value)}ms`;
const formatDiagnosticCount = (value: number | null) => value === null ? '--' : `${Math.round(value)}`;
const formatDiagnosticPercent = (value: number | null) => value === null ? '--' : `${Math.round(value * 100)}%`;

const DiagnosticLogCard = ({
    entry,
    onCopy,
}: {
    entry: DiagnosticLogEntry;
    onCopy: (text: string) => void;
}) => {
    const detail = entry.detail;
    const severity = getDiagnosticString(detail, 'severity') ?? 'info';
    const reason = getDiagnosticString(detail, 'reason') ?? 'No diagnostic reason recorded.';
    const localTransport = detail.localTransport === true;
    const pingMs = getDiagnosticNumber(detail, 'pingMs');
    const recommendations = getDiagnosticRecommendations(detail);
    const heartbeatMs = getDiagnosticNumber(detail, 'serverHeartbeatAgeMs');

    return (
        <article className={`settings-diagnostics-entry settings-diagnostics-entry--${severity}`}>
            <header className="settings-diagnostics-entry__header">
                <div>
                    <span className="settings-diagnostics-entry__time">{entry.iso}</span>
                    <strong>{severity.toUpperCase()}</strong>
                </div>
                <button
                    type="button"
                    className="settings-diagnostics-entry__copy"
                    onClick={() => onCopy(formatDiagnosticsEntry(entry))}
                >
                    Copy Entry
                </button>
            </header>

            <div className="settings-diagnostics-entry__reason">{reason}</div>

            <div className="settings-diagnostics-entry__metrics">
                <span>Frame {formatDiagnosticMs(getDiagnosticNumber(detail, 'frameGapMs'))}</span>
                <span>Snapshot {formatDiagnosticMs(getDiagnosticNumber(detail, 'snapshotAgeMs'))}</span>
                <span>FPS {formatDiagnosticCount(getDiagnosticNumber(detail, 'fps'))}</span>
                <span>Ping {localTransport ? 'Local' : formatDiagnosticMs(pingMs)}</span>
                <span>Units {formatDiagnosticCount(getDiagnosticNumber(detail, 'unitCount'))}</span>
                <span>Buildings {formatDiagnosticCount(getDiagnosticNumber(detail, 'buildingCount'))}</span>
                <span>Auto L{formatDiagnosticCount(getDiagnosticNumber(detail, 'autoPerformanceLevel'))}</span>
                <span>Server Load {formatDiagnosticPercent(getDiagnosticNumber(detail, 'serverLoadFactor'))}</span>
                <span>Server Tick {formatDiagnosticMs(getDiagnosticNumber(detail, 'serverTickMs'))}</span>
                <span>Heartbeat {formatDiagnosticMs(heartbeatMs)}</span>
            </div>

            {recommendations.length > 0 && (
                <div className="settings-diagnostics-entry__recommendations">
                    {recommendations.slice(0, 3).map((recommendation, index) => (
                        <span key={`${entry.id}-recommendation-${index}`}>{recommendation}</span>
                    ))}
                </div>
            )}

            <details className="settings-diagnostics-entry__raw">
                <summary>Raw packet</summary>
                <pre>{JSON.stringify(detail, null, 2)}</pre>
            </details>
        </article>
    );
};

const VolumeSlider = ({
    label,
    value,
    onChange,
    onCommit
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    onCommit?: () => void;
}) => (
    <div className="slider-container">
        <div className="slider-header">
            <span>{label}</span>
            <span>{Math.round(value * 100)}%</span>
        </div>
        <input 
            type="range" min="0" max="1" step="0.05" 
            value={value} 
            onChange={(e) => onChange(parseFloat(e.target.value))}
            onPointerUp={onCommit}
            onKeyUp={onCommit}
            className="settings-range"
        />
    </div>
);

const EffectVolumeRow = ({
    label,
    value,
    onChange,
    onPreview
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    onPreview: () => void;
}) => (
    <div className="settings-sfx-row">
        <div className="settings-sfx-row__header">
            <span className="settings-sfx-row__label">{label}</span>
            <div className="settings-sfx-row__tools">
                <span className="settings-sfx-row__value">{Math.round(value * 100)}%</span>
                <button
                    type="button"
                    className="settings-sfx-preview-btn"
                    onClick={onPreview}
                    data-sfx="off"
                >
                    Preview
                </button>
            </div>
        </div>
        <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            onPointerUp={onPreview}
            onKeyUp={onPreview}
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
