import React from 'react';
import { Modal } from './Modal';
import { SkinRenderPreview } from './SkinRenderPreview';
import { RankBadgeIcon } from './RankBadgeIcon';
import {
    SKIN_DEFINITIONS,
    SKIN_DEFINITIONS_BY_ID,
    STEAM_SKIN_ITEM_DEFS,
    getSkinCopyCount,
    getSkinEnhancementLabel,
    getSkinEnhancementLevel,
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
        family: 'leaderboard',
        title: 'Leaderboard Trophies',
        eyebrow: 'Global Top 10',
        copy: 'Leaderboard skins are awarded from live Steam leaderboards: #1, #2, #3, and a Top 10 contender finish for ranks 4-10.',
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
        case 'leaderboard':
            return 'Steam Leaderboard';
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
        <div className={`skins-swatch skins-swatch--${focus} skins-swatch--skin-${skinId} ${className}`.trim()} style={style}>
            <div className="skins-swatch__ambient" />
            <div className="skins-swatch__banner-backplate" />
            <RankBadgeIcon skinId={skinId} size="large" className="skins-swatch__rank-badge" title={`${skinId} badge`} />
            <div className="skins-swatch__banner-flame skins-swatch__banner-flame--left" />
            <div className="skins-swatch__banner-flame skins-swatch__banner-flame--right" />
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
    copyCount: number;
    enhancementLevel: number;
    activeUnit: boolean;
    activeBuilding: boolean;
    onEquip: (target: SkinTarget, skinId: SkinId) => void;
    onPreview: (skinId: SkinId) => void;
}> = ({ definition, unlocked, copyCount, enhancementLevel, activeUnit, activeBuilding, onEquip, onPreview }) => {
    const equippedLabel = activeUnit && activeBuilding
        ? 'Units and towers are equipped'
        : activeUnit
            ? 'Units are equipped'
            : activeBuilding
                ? 'Towers are equipped'
                : null;
    const steamItem = STEAM_SKIN_ITEM_DEFS[definition.id];

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

            <div className="skin-card__inventory-row">
                <span>{copyCount > 0 ? `${copyCount} owned` : 'No copies yet'}</span>
                <strong>{getSkinEnhancementLabel(copyCount)}</strong>
            </div>

            <div className="skin-card__enhancement-track" aria-label={`Enhancement level ${enhancementLevel}`}>
                {[0, 1, 2, 3].map((level) => (
                    <span key={level} className={level <= enhancementLevel ? 'is-filled' : ''} />
                ))}
            </div>

            {steamItem && (
                <div className="skin-card__steam-item">
                    Steam ItemDef #{steamItem.itemDefId} • {steamItem.rarity}
                </div>
            )}

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
    const [showLockedVault, setShowLockedVault] = React.useState(false);

    const currentUnitSkin = SKIN_DEFINITIONS_BY_ID[profile.loadout.unitSkinId];
    const currentBuildingSkin = SKIN_DEFINITIONS_BY_ID[profile.loadout.buildingSkinId];
    const visibleDefinitions = SKIN_DEFINITIONS.filter((definition) => showDeveloperSkin || definition.family !== 'developer');
    const ownedDefinitions = visibleDefinitions.filter((definition) => unlockedSkinIds.has(definition.id));
    const lockedDefinitions = visibleDefinitions.filter((definition) => !unlockedSkinIds.has(definition.id));
    const rankedDefinitions = visibleDefinitions.filter((definition) => definition.family === 'ranked');
    const rankedUnlockedCount = rankedDefinitions.filter((definition) => unlockedSkinIds.has(definition.id)).length;
    const ownedCopyCount = visibleDefinitions.reduce((total, definition) => total + getSkinCopyCount(profile, definition.id), 0);
    const previewDefinition = previewSkinId ? SKIN_DEFINITIONS_BY_ID[previewSkinId] : null;
    const renderSkinSection = (section: typeof FAMILY_SECTIONS[number], items: SkinDefinition[], lockedVault = false) => {
        if (items.length === 0) {
            return null;
        }

        return (
            <section key={`${lockedVault ? 'locked-' : ''}${section.family}`} className={`skins-panel__section ${lockedVault ? 'skins-panel__section--locked-vault' : ''}`}>
                <div className="skins-panel__section-head">
                    <div>
                        <div className="skins-panel__section-eyebrow">{lockedVault ? 'Locked Vault' : section.eyebrow}</div>
                        <div className="skins-panel__section-title">{lockedVault ? `${section.title} - Locked` : section.title}</div>
                        <p className="skins-panel__section-copy">{lockedVault ? 'Hidden until you open this section so the armory stays clean while you browse owned skins.' : section.copy}</p>
                    </div>
                    <div className="skins-panel__section-count">{items.length} skin{items.length === 1 ? '' : 's'}</div>
                </div>

                <div className={`skins-panel__grid skins-panel__grid--${section.family}`}>
                    {items.map((definition) => {
                        const copyCount = getSkinCopyCount(profile, definition.id);
                        const enhancementLevel = getSkinEnhancementLevel(profile, definition.id);

                        return (
                            <SkinCard
                                key={definition.id}
                                definition={definition}
                                unlocked={unlockedSkinIds.has(definition.id)}
                                copyCount={copyCount}
                                enhancementLevel={enhancementLevel}
                                activeUnit={profile.loadout.unitSkinId === definition.id}
                                activeBuilding={profile.loadout.buildingSkinId === definition.id}
                                onEquip={onEquip}
                                onPreview={setPreviewSkinId}
                            />
                        );
                    })}
                </div>
            </section>
        );
    };

    return (
        <>
            <div className="skins-panel">
                <section className="skins-panel__hero">
                    <div className="skins-panel__eyebrow">Armory</div>
                    <h3 className="skins-panel__title">Skins</h3>
                    <p className="skins-panel__copy">
                        Equip prestige finishes for your units and towers. Leaderboard trophies, Steam item definitions, and duplicate-copy enhancement
                        tiers now sit inside the armory, while locked skins stay tucked away until you open the vault.
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
                        <div className="skins-panel__summary-card">
                            <span>Owned Copies</span>
                            <strong>{ownedCopyCount.toLocaleString()}</strong>
                        </div>
                        <div className="skins-panel__summary-card">
                            <span>Hidden Locked</span>
                            <strong>{lockedDefinitions.length} skins</strong>
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
                        const items = ownedDefinitions.filter((definition) => definition.family === section.family);
                        return renderSkinSection(section, items);
                    })}

                <section className="skins-panel__section skins-panel__section--vault-toggle">
                    <div className="skins-panel__section-head">
                        <div>
                            <div className="skins-panel__section-eyebrow">Hidden Vault</div>
                            <div className="skins-panel__section-title">Unowned Skins</div>
                            <p className="skins-panel__section-copy">Open this only when you want to inspect skins you have not earned yet.</p>
                        </div>
                        <button
                            type="button"
                            className="skins-panel__vault-button"
                            onClick={() => setShowLockedVault((value) => !value)}
                        >
                            {showLockedVault ? 'Hide Locked Skins' : `Show ${lockedDefinitions.length} Locked Skins`}
                        </button>
                    </div>
                </section>

                {showLockedVault && FAMILY_SECTIONS
                    .filter((section) => showDeveloperSkin || section.family !== 'developer')
                    .map((section) => {
                        const items = lockedDefinitions.filter((definition) => definition.family === section.family);
                        return renderSkinSection(section, items, true);
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
