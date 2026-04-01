import type { CSSProperties } from 'react';
import type { ActionGuide } from '../data/actionGuides';
import './ActionGuidePanel.css';

type ActionGuidePanelProps = {
    guide: ActionGuide;
    source: 'build' | 'recruit';
    style?: CSSProperties;
    panelRef?: React.Ref<HTMLElement>;
};

const renderPlacementTargetGraphic = (kind: NonNullable<ActionGuide['placementTargets']>[number]['kind']) => {
    switch (kind) {
        case 'gold-node':
            return (
                <span className="action-guide-panel__target-graphic action-guide-panel__target-graphic--gold-node" aria-hidden="true">
                    <span className="action-guide-panel__gold-dot action-guide-panel__gold-dot--one" />
                    <span className="action-guide-panel__gold-dot action-guide-panel__gold-dot--two" />
                    <span className="action-guide-panel__gold-dot action-guide-panel__gold-dot--three" />
                </span>
            );
        case 'oil-spot':
            return (
                <span className="action-guide-panel__target-graphic action-guide-panel__target-graphic--oil-spot" aria-hidden="true">
                    <span className="action-guide-panel__oil-core" />
                    <span className="action-guide-panel__oil-ring" />
                </span>
            );
        case 'grassland':
            return (
                <span className="action-guide-panel__target-graphic action-guide-panel__target-graphic--grassland" aria-hidden="true">
                    <span className="action-guide-panel__grass-blade action-guide-panel__grass-blade--one" />
                    <span className="action-guide-panel__grass-blade action-guide-panel__grass-blade--two" />
                    <span className="action-guide-panel__grass-blade action-guide-panel__grass-blade--three" />
                </span>
            );
        case 'water':
            return (
                <span className="action-guide-panel__target-graphic action-guide-panel__target-graphic--water" aria-hidden="true">
                    <span className="action-guide-panel__water-wave action-guide-panel__water-wave--one" />
                    <span className="action-guide-panel__water-wave action-guide-panel__water-wave--two" />
                </span>
            );
        case 'land':
        default:
            return (
                <span className="action-guide-panel__target-graphic action-guide-panel__target-graphic--land" aria-hidden="true">
                    <span className="action-guide-panel__land-speck action-guide-panel__land-speck--one" />
                    <span className="action-guide-panel__land-speck action-guide-panel__land-speck--two" />
                </span>
            );
    }
};

const renderPreview = (guide: ActionGuide) => {
    switch (guide.preview) {
        case 'deposit':
            return (
                <div className="action-guide-preview action-guide-preview--deposit">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__node action-guide-preview__node--gold">
                        <span>⛏</span>
                    </div>
                    <div className="action-guide-preview__placement-ring" />
                    <div className="action-guide-preview__support action-guide-preview__support--builder">🛠️</div>
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--left">Gold Node</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--right">Land</div>
                </div>
            );
        case 'farm-land':
            return (
                <div className="action-guide-preview action-guide-preview--farm-land">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__field">
                        <span className="action-guide-preview__field-blade action-guide-preview__field-blade--one" />
                        <span className="action-guide-preview__field-blade action-guide-preview__field-blade--two" />
                        <span className="action-guide-preview__field-blade action-guide-preview__field-blade--three" />
                    </div>
                    <div className="action-guide-preview__placement-ring" />
                    <div className="action-guide-preview__support action-guide-preview__support--builder">🛠️</div>
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--left">Grassland</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--right">Land</div>
                </div>
            );
        case 'oil-land':
            return (
                <div className="action-guide-preview action-guide-preview--oil-land">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__node action-guide-preview__node--oil">
                        <span>🛢</span>
                    </div>
                    <div className="action-guide-preview__placement-ring" />
                    <div className="action-guide-preview__support action-guide-preview__support--builder">🛠️</div>
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--left">Oil Spot</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--right">Land</div>
                </div>
            );
        case 'oil-water':
            return (
                <div className="action-guide-preview action-guide-preview--oil-water">
                    <div className="action-guide-preview__surface action-guide-preview__surface--water" />
                    <div className="action-guide-preview__node action-guide-preview__node--oil-water">
                        <span>🛢</span>
                    </div>
                    <div className="action-guide-preview__placement-ring" />
                    <div className="action-guide-preview__support action-guide-preview__support--ship">🏗️</div>
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--left">Black Oil Spot</div>
                    <div className="action-guide-preview__badge action-guide-preview__badge--right">Water Only</div>
                    <div className="action-guide-preview__callout">Construction Ship Required</div>
                </div>
            );
        case 'shoreline':
            return (
                <div className="action-guide-preview action-guide-preview--shoreline">
                    <div className="action-guide-preview__surface action-guide-preview__surface--shore">
                        <div className="action-guide-preview__shoreline" />
                    </div>
                    <div className="action-guide-preview__hero action-guide-preview__hero--shore">{guide.icon}</div>
                    <div className="action-guide-preview__support action-guide-preview__support--ship">🚢</div>
                </div>
            );
        case 'defense':
            return (
                <div className="action-guide-preview action-guide-preview--defense">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__arrow action-guide-preview__arrow--left" />
                    <div className="action-guide-preview__arrow action-guide-preview__arrow--right" />
                </div>
            );
        case 'bridge':
            return (
                <div className="action-guide-preview action-guide-preview--bridge">
                    <div className="action-guide-preview__island action-guide-preview__island--left" />
                    <div className="action-guide-preview__island action-guide-preview__island--right" />
                    <div className="action-guide-preview__bridge-beam" />
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                </div>
            );
        case 'wall':
            return (
                <div className="action-guide-preview action-guide-preview--wall">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__wall-line" />
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__arrow action-guide-preview__arrow--center" />
                </div>
            );
        case 'support':
            return (
                <div className="action-guide-preview action-guide-preview--support">
                    <div className="action-guide-preview__surface action-guide-preview__surface--land" />
                    <div className="action-guide-preview__hero">{guide.icon}</div>
                    <div className="action-guide-preview__orbit action-guide-preview__orbit--one" />
                    <div className="action-guide-preview__orbit action-guide-preview__orbit--two" />
                    <div className="action-guide-preview__support action-guide-preview__support--shield">🛡️</div>
                </div>
            );
        case 'infantry':
        case 'marksman':
        case 'rocket':
        case 'builder':
        case 'scanner':
        case 'armor':
        case 'transport':
        case 'artillery':
        case 'naval-raider':
        case 'naval-warship':
        case 'builder-ship':
        case 'air':
        case 'capital':
        default:
            return (
                <div className={`action-guide-preview action-guide-preview--unit action-guide-preview--${guide.preview}`}>
                    <div className="action-guide-preview__lane" />
                    <div className="action-guide-preview__hero action-guide-preview__hero--unit">{guide.icon}</div>
                    <div className="action-guide-preview__trail" />
                    <div className="action-guide-preview__target">
                        {guide.preview === 'builder' ? '🏗️' :
                            guide.preview === 'scanner' ? '🛢️' :
                                guide.preview === 'transport' ? '📦' :
                                    guide.preview === 'artillery' ? '🏰' :
                                        guide.preview === 'air' ? '🎯' :
                                            guide.preview === 'capital' ? '⭐' :
                                                guide.preview === 'naval-raider' || guide.preview === 'naval-warship' || guide.preview === 'builder-ship' ? '🌊' : '🎯'}
                    </div>
                    {(guide.preview === 'transport' || guide.preview === 'capital') && (
                        <div className="action-guide-preview__cargo">
                            <span />
                            <span />
                            <span />
                        </div>
                    )}
                    {guide.preview === 'scanner' && <div className="action-guide-preview__scanner-wave" />}
                </div>
            );
    }
};

export function ActionGuidePanel({ guide, source, style, panelRef }: ActionGuidePanelProps) {
    const showPlacementTargets = source === 'build' && guide.placementTargets && guide.placementTargets.length > 0;

    return (
        <aside
            ref={panelRef}
            className={`action-guide-panel action-guide-panel--${source}`}
            style={style}
        >
            <div className="action-guide-panel__eyebrow">
                {source === 'build' ? 'Build Preview' : 'Recruit Preview'}
            </div>
            <div className="action-guide-panel__top">
                <div className="action-guide-panel__title-block">
                    <div className="action-guide-panel__icon-row">
                        <div className="action-guide-panel__icon-card action-guide-panel__icon-card--build">
                            <span className="action-guide-panel__icon-symbol">{guide.icon}</span>
                            <span className="action-guide-panel__icon-label">Building</span>
                        </div>

                        {showPlacementTargets && (
                            <>
                                <span className="action-guide-panel__icon-arrow" aria-hidden="true">→</span>
                                <div className="action-guide-panel__target-group">
                                    {guide.placementTargets!.map((target) => (
                                        <div
                                            key={`${guide.id}-${target.label}`}
                                            className="action-guide-panel__icon-card action-guide-panel__icon-card--target"
                                            title={target.label}
                                        >
                                            {renderPlacementTargetGraphic(target.kind)}
                                            <span className="action-guide-panel__icon-label">{target.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <h4>{guide.icon} {guide.title}</h4>
                    <p>{guide.summary}</p>
                </div>
            </div>

            {renderPreview(guide)}

            {guide.placement && guide.placement.length > 0 && (
                <section className="action-guide-panel__section">
                    <h5>Place it like this</h5>
                    <ul>
                        {guide.placement.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="action-guide-panel__section">
                <h5>Use it for</h5>
                <ul>
                    {guide.use.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
            </section>

            <div className="action-guide-panel__meta">
                <div>
                    <span>Best for</span>
                    <strong>{guide.bestFor}</strong>
                </div>
                <div>
                    <span>Watch out</span>
                    <strong>{guide.watchOut}</strong>
                </div>
            </div>
        </aside>
    );
}
