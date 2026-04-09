import React from 'react';
import { Modal } from './Modal';
import { SkinRenderPreview } from './SkinRenderPreview';
import {
    SKIN_DEFINITIONS,
    SKIN_DEFINITIONS_BY_ID,
    getSkinPreviewStyle,
    type PlayerSkinProfile,
    type SkinDefinition,
    type SkinId,
    type SkinTarget,
} from '../utils/playerSkins';
import './SkinsPanel.css';

interface SkinsPanelProps {
    profile: PlayerSkinProfile;
    unlockedSkinIds: Set<SkinId>;
    unlockedAchievementCount: number;
    totalAchievementCount: number;
    showDeveloperSkin: boolean;
    onEquip: (target: SkinTarget, skinId: SkinId) => void;
}

const FAMILY_SECTIONS: Array<{
    family: SkinDefinition['family'];
    title: string;
    copy: string;
    eyebrow: string;
}> = [
    {
        family: 'developer',
        title: 'Developer Tier',
        eyebrow: 'Owner Only',
        copy: 'Reserved for the lead developer account. This finish sits above the public reward line and stays hidden from every other player.',
    },
    {
        family: 'standard',
        title: 'Starter',
        eyebrow: 'Core Finish',
        copy: 'The original battlefield look stays ready at all times for players who want the clean classic finish.',
    },
    {
        family: 'ranked',
        title: 'Ranked Seasons',
        eyebrow: 'Season Rewards',
        copy: 'These finishes climb from premium tournament metals into rare endgame prestige looks built for the full game ranked ladder.',
    },
    {
        family: 'achievement',
        title: 'Demo Mastery',
        eyebrow: 'Completion Reward',
        copy: 'Ruby is the mastery finish for players who fully conquer the demo achievement set.',
    },
];

const getCardEyebrow = (definition: SkinDefinition) => {
    switch (definition.family) {
        case 'developer':
            return 'Developer Only';
        case 'ranked':
            return 'Season Reward';
        case 'achievement':
            return 'Mastery Reward';
        default:
            return 'Always Ready';
    }
};

const SkinSwatch: React.FC<{
    skinId: SkinId;
    className?: string;
    focus?: 'both' | 'unit' | 'building';
}> = ({ skinId, className = '', focus = 'both' }) => {
    const style = getSkinPreviewStyle(skinId);

    return (
        <div className={`skins-swatch skins-swatch--${focus} ${className}`.trim()} style={style}>
            <div className="skins-swatch__ambient" />
            <div className="skins-swatch__ground skins-swatch__ground--unit" />
            <div className="skins-swatch__ground skins-swatch__ground--building" />

            <div className="skins-swatch__unit-trail" />
            <div className="skins-swatch__unit">
                <div className="skins-swatch__unit-head" />
                <div className="skins-swatch__unit-visor" />
                <div className="skins-swatch__unit-body" />
                <div className="skins-swatch__unit-shoulder" />
                <div className="skins-swatch__unit-emblem" />
                <div className="skins-swatch__unit-weapon" />
            </div>

            <div className="skins-swatch__building-trail" />
            <div className="skins-swatch__building">
                <div className="skins-swatch__building-roof" />
                <div className="skins-swatch__building-body" />
                <div className="skins-swatch__building-tower" />
                <div className="skins-swatch__building-door" />
                <div className="skins-swatch__building-emblem" />
            </div>

            <div className="skins-swatch__shine" />
        </div>
    );
};

const LoadoutPreview: React.FC<{
    title: string;
    skinId: SkinId;
}> = ({ title, skinId }) => {
    const definition = SKIN_DEFINITIONS_BY_ID[skinId];

    return (
        <div className="skins-loadout-card">
            <div className="skins-loadout-card__label">{title}</div>
            <SkinSwatch skinId={skinId} />
            <div className="skins-loadout-card__name">{definition.title}</div>
            <div className="skins-loadout-card__summary">{definition.summary}</div>
        </div>
    );
};

const SkinCard: React.FC<{
    definition: SkinDefinition;
    unlocked: boolean;
    activeUnit: boolean;
    activeBuilding: boolean;
    onEquip: (target: SkinTarget, skinId: SkinId) => void;
    onPreview: (skinId: SkinId) => void;
}> = ({ definition, unlocked, activeUnit, activeBuilding, onEquip, onPreview }) => {
    const equippedLabel = activeUnit && activeBuilding
        ? 'Units and towers are equipped'
        : activeUnit
            ? 'Units are equipped'
            : activeBuilding
                ? 'Towers are equipped'
                : null;

    return (
        <article className={`skin-card ${unlocked ? 'skin-card--unlocked' : 'skin-card--locked'}`}>
            <div className="skin-card__header">
                <div>
                    <div className="skin-card__eyebrow">{getCardEyebrow(definition)}</div>
                    <div className="skin-card__title">{definition.title}</div>
                </div>
                <span className={`skin-card__state ${unlocked ? 'skin-card__state--ready' : ''}`}>
                    {unlocked ? 'Unlocked' : 'Locked'}
                </span>
            </div>

            <SkinSwatch skinId={definition.id} className="skin-card__swatch" />

            <div className="skin-card__summary">{definition.summary}</div>
            <div className="skin-card__unlock">{definition.unlockText}</div>

            {equippedLabel && <div className="skin-card__equipped-note">{equippedLabel}</div>}

            <button
                type="button"
                className="skin-card__preview"
                onClick={() => onPreview(definition.id)}
            >
                Preview Skin
            </button>

            <div className="skin-card__actions">
                <button
                    type="button"
                    className={`skin-card__equip ${activeUnit ? 'skin-card__equip--active' : ''}`}
                    onClick={() => onEquip('unit', definition.id)}
                    disabled={!unlocked}
                >
                    {activeUnit ? 'Units Ready' : 'Equip Units'}
                </button>
                <button
                    type="button"
                    className={`skin-card__equip ${activeBuilding ? 'skin-card__equip--active' : ''}`}
                    onClick={() => onEquip('building', definition.id)}
                    disabled={!unlocked}
                >
                    {activeBuilding ? 'Towers Ready' : 'Equip Towers'}
                </button>
            </div>
        </article>
    );
};

export const SkinsPanel: React.FC<SkinsPanelProps> = ({
    profile,
    unlockedSkinIds,
    unlockedAchievementCount,
    totalAchievementCount,
    showDeveloperSkin,
    onEquip,
}) => {
    const [previewSkinId, setPreviewSkinId] = React.useState<SkinId | null>(null);

    const currentUnitSkin = SKIN_DEFINITIONS_BY_ID[profile.loadout.unitSkinId];
    const currentBuildingSkin = SKIN_DEFINITIONS_BY_ID[profile.loadout.buildingSkinId];
    const visibleDefinitions = SKIN_DEFINITIONS.filter((definition) => showDeveloperSkin || definition.family !== 'developer');
    const rankedDefinitions = visibleDefinitions.filter((definition) => definition.family === 'ranked');
    const rankedUnlockedCount = rankedDefinitions.filter((definition) => unlockedSkinIds.has(definition.id)).length;
    const previewDefinition = previewSkinId ? SKIN_DEFINITIONS_BY_ID[previewSkinId] : null;

    return (
        <>
            <div className="skins-panel">
                <section className="skins-panel__hero">
                    <div className="skins-panel__eyebrow">Armory</div>
                    <h3 className="skins-panel__title">Skins</h3>
                    <p className="skins-panel__copy">
                        Equip prestige finishes for your units and towers. The ranked line now ramps from polished metals to luminous endgame prestige,
                        while Ruby stays the mastery reward for fully clearing the demo.
                    </p>

                    <div className="skins-panel__summary-grid">
                        <div className="skins-panel__summary-card">
                            <span>Units Equipped</span>
                            <strong>{currentUnitSkin.title}</strong>
                        </div>
                        <div className="skins-panel__summary-card">
                            <span>Buildings Equipped</span>
                            <strong>{currentBuildingSkin.title}</strong>
                        </div>
                        <div className="skins-panel__summary-card">
                            <span>Ranked Skins</span>
                            <strong>{rankedUnlockedCount} / {rankedDefinitions.length}</strong>
                        </div>
                        <div className="skins-panel__summary-card">
                            <span>Ruby Progress</span>
                            <strong>{unlockedAchievementCount} / {totalAchievementCount} Achievements</strong>
                        </div>
                    </div>
                </section>

                <section className="skins-panel__section skins-panel__section--loadout">
                    <div className="skins-panel__section-head">
                        <div>
                            <div className="skins-panel__section-eyebrow">Live Loadout</div>
                            <div className="skins-panel__section-title">Current Armory Setup</div>
                            <p className="skins-panel__section-copy">Your equipped finish updates your own forces and towers immediately, so you can tune the look before heading into battle.</p>
                        </div>
                    </div>

                    <div className="skins-panel__loadout-grid">
                        <LoadoutPreview title="Unit Skin" skinId={profile.loadout.unitSkinId} />
                        <LoadoutPreview title="Tower Skin" skinId={profile.loadout.buildingSkinId} />
                    </div>
                </section>

                {FAMILY_SECTIONS
                    .filter((section) => showDeveloperSkin || section.family !== 'developer')
                    .map((section) => {
                    const items = visibleDefinitions.filter((definition) => definition.family === section.family);

                    if (items.length === 0) {
                        return null;
                    }

                    return (
                        <section key={section.family} className="skins-panel__section">
                            <div className="skins-panel__section-head">
                                <div>
                                    <div className="skins-panel__section-eyebrow">{section.eyebrow}</div>
                                    <div className="skins-panel__section-title">{section.title}</div>
                                    <p className="skins-panel__section-copy">{section.copy}</p>
                                </div>
                                <div className="skins-panel__section-count">{items.length} skin{items.length === 1 ? '' : 's'}</div>
                            </div>

                            <div className={`skins-panel__grid skins-panel__grid--${section.family}`}>
                                {items.map((definition) => (
                                    <SkinCard
                                        key={definition.id}
                                        definition={definition}
                                        unlocked={unlockedSkinIds.has(definition.id)}
                                        activeUnit={profile.loadout.unitSkinId === definition.id}
                                        activeBuilding={profile.loadout.buildingSkinId === definition.id}
                                        onEquip={onEquip}
                                        onPreview={setPreviewSkinId}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>

            <Modal
                isOpen={!!previewDefinition}
                onClose={() => setPreviewSkinId(null)}
                className="modal-content skins-preview-modal"
                title={previewDefinition ? `${previewDefinition.title} Preview` : 'Skin Preview'}
            >
                {previewDefinition && (
                    <div className="skins-preview-modal__body">
                        <div className="skins-preview-modal__side">
                            <div className="skins-preview-modal__hero">
                                <div className="skins-preview-modal__eyebrow">Prestige Preview</div>
                                <div className="skins-preview-modal__copy">{previewDefinition.summary}</div>
                            </div>

                            <div className="skins-preview-modal__meta">
                                <div className="skins-preview-modal__meta-card">
                                    <span>Preview Scope</span>
                                    <strong>Full roster + live roles</strong>
                                    <p>Units and buildings now show attacks, healing, economy, recruiting, transport, and placement rules.</p>
                                </div>
                                <div className="skins-preview-modal__meta-card">
                                    <span>Controls</span>
                                    <strong>Zoom, scroll, inspect</strong>
                                    <p>Use Fit, zoom for detail, scroll anywhere over the preview, and click cards to swap the live demo.</p>
                                </div>
                            </div>

                            <div className="skins-preview-modal__actions">
                                <button
                                    type="button"
                                    className={`skin-card__equip ${profile.loadout.unitSkinId === previewDefinition.id ? 'skin-card__equip--active' : ''}`}
                                    disabled={!unlockedSkinIds.has(previewDefinition.id)}
                                    onClick={() => onEquip('unit', previewDefinition.id)}
                                >
                                    {profile.loadout.unitSkinId === previewDefinition.id ? 'Units Equipped' : 'Equip Units'}
                                </button>
                                <button
                                    type="button"
                                    className={`skin-card__equip ${profile.loadout.buildingSkinId === previewDefinition.id ? 'skin-card__equip--active' : ''}`}
                                    disabled={!unlockedSkinIds.has(previewDefinition.id)}
                                    onClick={() => onEquip('building', previewDefinition.id)}
                                >
                                    {profile.loadout.buildingSkinId === previewDefinition.id ? 'Towers Equipped' : 'Equip Towers'}
                                </button>
                            </div>
                        </div>

                        <div className="skins-preview-modal__card">
                            <div className="skins-preview-modal__label">Actual In-Game Render</div>
                            <SkinRenderPreview skinId={previewDefinition.id} />
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );
};
