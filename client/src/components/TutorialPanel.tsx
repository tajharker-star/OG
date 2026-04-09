import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameMap, Player, Unit } from '../types/game';
import {
    TUTORIAL_BUILDING_GROUPS,
    TUTORIAL_CORE_LESSONS,
    TUTORIAL_MAP_PLAYBOOKS,
    TUTORIAL_RESOURCE_LESSONS,
    TUTORIAL_STRATEGY_LESSONS,
    TUTORIAL_UNIT_GROUPS,
    type TutorialGuideGroup,
    type TutorialLesson,
    type TutorialMapType,
    normalizeTutorialMapType,
} from '../data/tutorialGuide';
import './TutorialPanel.css';

type TutorialPanelProps = {
    player: Player;
    mapData: GameMap | null;
    units: Unit[];
    tutorialMapType?: TutorialMapType;
    onAllObjectivesComplete?: () => void;
    botChallengeStarted?: boolean;
    botChallengeCompleted?: boolean;
    panelStyle?: React.CSSProperties;
    toggleStyle?: React.CSSProperties;
};

type TutorialTabId = 'objectives' | 'resources' | 'buildings' | 'units' | 'winning';

const TUTORIAL_TABS: Array<{ id: TutorialTabId; label: string }> = [
    { id: 'objectives', label: 'Objectives' },
    { id: 'resources', label: 'Resources' },
    { id: 'buildings', label: 'Buildings' },
    { id: 'units', label: 'Units' },
    { id: 'winning', label: 'How to Win' },
];

const COMBAT_UNIT_TYPES = new Set([
    'soldier',
    'sniper',
    'rocketeer',
    'tank',
    'humvee',
    'missile_launcher',
    'pirate_ship',
    'destroyer',
    'light_plane',
    'heavy_plane',
    'aircraft_carrier',
    'mothership'
]);

const LOGISTICS_OR_SUPPORT_BUILDING_TYPES = new Set([
    'tower',
    'hospital',
    'repair_dock',
    'bridge_node',
    'wall_node',
    'naval_mine'
]);

const getIconForType = (type?: string) => {
    switch (type) {
        case 'soldier': return '💂';
        case 'sniper': return '🎯';
        case 'rocketeer': return '🚀';
        case 'destroyer': return '🚢';
        case 'pirate_ship': return '🏴';
        case 'construction_ship': return '🏗';
        case 'ferry': return '⛴';
        case 'builder': return '🛠';
        case 'base': return '🏠';
        case 'mine': return '⛏';
        case 'barracks': return '⚔';
        case 'tower': return '🏰';
        case 'dock': return '⚓';
        case 'oil_rig': return '🛢';
        case 'wall': return '🧱';
        case 'bridge_node': return '🌉';
        case 'wall_node': return '🧱';
        case 'naval_mine': return '💣';
        case 'tank_factory': return '🏭';
        case 'tank': return '🚜';
        case 'humvee': return '🚙';
        case 'missile_launcher': return '🚚';
        case 'air_base': return '🛫';
        case 'hospital': return '🏥';
        case 'repair_dock': return '🔧';
        case 'light_plane': return '🛩';
        case 'heavy_plane': return '✈';
        case 'alien_scout': return '👽';
        case 'heavy_alien': return '🛸';
        case 'aircraft_carrier': return '🛳';
        case 'mothership': return '🛸';
        case 'oil_well': return '⛽';
        case 'farm': return '🌾';
        case 'oil_seeker': return '📡';
        default: return '★';
    }
};

const renderLessonList = (lessons: TutorialLesson[]) => (
    <div className="tutorial-panel__lesson-stack">
        {lessons.map((lesson) => (
            <article key={lesson.id} className="tutorial-panel__lesson-card">
                <h4>{lesson.title}</h4>
                <p>{lesson.summary}</p>
                <ul>
                    {lesson.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                    ))}
                </ul>
            </article>
        ))}
    </div>
);

const renderGuideGroups = (groups: TutorialGuideGroup[]) => (
    <div className="tutorial-panel__group-stack">
        {groups.map((group) => (
            <section key={group.id} className="tutorial-panel__group">
                <div className="tutorial-panel__group-header">
                    <div>
                        <h4>{group.title}</h4>
                        <p>{group.intro}</p>
                    </div>
                </div>
                <div className="tutorial-panel__card-grid">
                    {group.cards.map((card) => (
                        <article key={card.id} className="tutorial-panel__guide-card">
                            <div className="tutorial-panel__guide-card-header">
                                <span className="tutorial-panel__entity-icon" aria-hidden="true">
                                    {getIconForType(card.entityType)}
                                </span>
                                <div>
                                    <h5>{card.title}</h5>
                                    <p>{card.summary}</p>
                                </div>
                            </div>
                            <div className="tutorial-panel__guide-meta">
                                <div>
                                    <strong>Best for</strong>
                                    <p>{card.strengths}</p>
                                </div>
                                <div>
                                    <strong>Watch out</strong>
                                    <p>{card.caution}</p>
                                </div>
                            </div>
                            <ul className="tutorial-panel__tips">
                                {card.tips.map((tip) => (
                                    <li key={tip}>{tip}</li>
                                ))}
                            </ul>
                        </article>
                    ))}
                </div>
            </section>
        ))}
    </div>
);

const getSpotlightPriority = (card: TutorialGuideGroup['cards'][number], spotlightIds: string[]) => {
    const matchIndex = spotlightIds.findIndex((id) => id === card.id || id === card.entityType);
    return matchIndex === -1 ? Number.POSITIVE_INFINITY : matchIndex;
};

const prioritizeGuideGroups = (groups: TutorialGuideGroup[], spotlightIds: string[]) => (
    groups.map((group) => ({
        ...group,
        cards: [...group.cards].sort((a, b) => {
            const priorityDelta = getSpotlightPriority(a, spotlightIds) - getSpotlightPriority(b, spotlightIds);
            if (priorityDelta !== 0) {
                return priorityDelta;
            }

            return a.title.localeCompare(b.title);
        })
    }))
);

export function TutorialPanel({
    player,
    mapData,
    units,
    tutorialMapType,
    onAllObjectivesComplete,
    botChallengeStarted = false,
    botChallengeCompleted = false,
    panelStyle,
    toggleStyle,
}: TutorialPanelProps) {
    const [isOpen, setIsOpen] = useState(true);
    const [activeTab, setActiveTab] = useState<TutorialTabId>('objectives');
    const completionReportedRef = useRef(false);

    const activeTutorialMap = normalizeTutorialMapType(mapData?.mapType || tutorialMapType);
    const mapPlaybook = TUTORIAL_MAP_PLAYBOOKS[activeTutorialMap];

    const ownedBuildings = useMemo(() => {
        const counts = new Map<string, number>();
        const seenBuildingIds = new Set<string>();
        const register = (type?: string, id?: string) => {
            if (!type) return;
            if (id) {
                if (seenBuildingIds.has(id)) return;
                seenBuildingIds.add(id);
            }
            counts.set(type, (counts.get(type) || 0) + 1);
        };

        mapData?.islands.forEach((island) => {
            island.buildings.forEach((building) => {
                if (building.ownerId === player.id) {
                    register(building.type, building.id);
                }
            });
        });

        mapData?.waterBuildings?.forEach((building) => {
            if (building.ownerId === player.id) {
                register(building.type, building.id);
            }
        });

        mapData?.oilSpots.forEach((spot) => {
            const building = spot.building;
            if (!building) return;
            const ownerId = building.ownerId || spot.ownerId;
            if (ownerId === player.id) {
                register(building.type, building.id);
            }
        });

        return counts;
    }, [mapData, player.id]);

    const ownedUnits = useMemo(
        () => units.filter((unit) => unit.ownerId === player.id),
        [player.id, units]
    );

    const buildingGuideGroups = useMemo(
        () => prioritizeGuideGroups(TUTORIAL_BUILDING_GROUPS, mapPlaybook.buildingSpotlightIds),
        [mapPlaybook.buildingSpotlightIds]
    );

    const unitGuideGroups = useMemo(
        () => prioritizeGuideGroups(TUTORIAL_UNIT_GROUPS, mapPlaybook.unitSpotlightIds),
        [mapPlaybook.unitSpotlightIds]
    );

    const coreLessons = useMemo(
        () => [...mapPlaybook.focusLessons, ...TUTORIAL_CORE_LESSONS],
        [mapPlaybook.focusLessons]
    );

    const resourceLessons = useMemo(
        () => [...mapPlaybook.resourceLessons, ...TUTORIAL_RESOURCE_LESSONS],
        [mapPlaybook.resourceLessons]
    );

    const strategyLessons = useMemo(
        () => [...mapPlaybook.winningLessons, ...TUTORIAL_STRATEGY_LESSONS],
        [mapPlaybook.winningLessons]
    );

    const objectiveCards = useMemo(() => {
        const hasDock = (ownedBuildings.get('dock') || 0) > 0;
        const hasConstructionShip = ownedUnits.some((unit) => unit.type === 'construction_ship');
        const hasFerry = ownedUnits.some((unit) => unit.type === 'ferry');
        const hasOilSeeker = ownedUnits.some((unit) => unit.type === 'oil_seeker');
        const hasGoldProduction = ((ownedBuildings.get('mine') || 0) + (ownedBuildings.get('farm') || 0)) > 0;
        const hasOilWell = (ownedBuildings.get('oil_well') || 0) > 0;
        const hasOilRig = (ownedBuildings.get('oil_rig') || 0) > 0;
        const hasOilProduction = hasOilWell || hasOilRig;
        const economyReady = hasGoldProduction && hasOilProduction;
        const productionReady =
            (ownedBuildings.get('barracks') || 0) +
            (ownedBuildings.get('tank_factory') || 0) +
            (ownedBuildings.get('dock') || 0) +
            (ownedBuildings.get('air_base') || 0) > 0;
        const combatReady = ownedUnits.some((unit) => COMBAT_UNIT_TYPES.has(unit.type));
        const mobilityReady =
            ownedUnits.some((unit) => ['humvee', 'ferry', 'construction_ship', 'aircraft_carrier', 'mothership'].includes(unit.type)) ||
            Array.from(ownedBuildings.keys()).some((type) => LOGISTICS_OR_SUPPORT_BUILDING_TYPES.has(type));
        const techReady =
            (hasOilWell ? 1 : 0) +
            (hasOilRig ? 1 : 0) +
            (ownedBuildings.get('air_base') || 0) +
            (ownedBuildings.get('tank_factory') || 0) > 0;
        const mapSpecificObjective = activeTutorialMap === 'desert'
            ? {
                ...mapPlaybook.extraObjective,
                done: hasOilSeeker,
            }
            : activeTutorialMap === 'grasslands'
                ? {
                    ...mapPlaybook.extraObjective,
                    done: hasDock && (hasFerry || hasConstructionShip),
                }
                : {
                    ...mapPlaybook.extraObjective,
                    done: hasDock && (hasConstructionShip || hasOilRig),
                };

        return [
            {
                id: 'hq',
                done: (ownedBuildings.get('base') || 0) > 0,
                title: 'Locate and protect your HQ',
                detail: 'Your base keeps you alive, gives income, and recruits builders.'
            },
            {
                id: 'economy',
                done: economyReady,
                title: 'Start your economy',
                detail: mapPlaybook.objectiveDetails.economy
            },
            {
                id: 'production',
                done: productionReady,
                title: 'Unlock army production',
                detail: mapPlaybook.objectiveDetails.production
            },
            {
                id: mapSpecificObjective.id,
                done: mapSpecificObjective.done,
                title: mapSpecificObjective.title,
                detail: mapSpecificObjective.detail
            },
            {
                id: 'combat',
                done: combatReady,
                title: 'Train a combat unit',
                detail: 'Practice with at least one combat unit before you add pressure.'
            },
            {
                id: 'mobility',
                done: mobilityReady,
                title: 'Learn support and logistics',
                detail: mapPlaybook.objectiveDetails.mobility
            },
            {
                id: 'tech',
                done: techReady,
                title: 'Reach advanced tech',
                detail: mapPlaybook.objectiveDetails.tech
            },
            {
                id: 'tutorial-final-battle',
                done: botChallengeCompleted,
                title: 'Spawn a bot and defeat it',
                detail: botChallengeCompleted
                    ? 'Bot defeated. You reached the victory screen and completed the tutorial.'
                    : botChallengeStarted
                        ? 'Bot deployed. Defeat every bot that was added, reach the victory screen, and finish the tutorial.'
                        : 'When you are ready, press Add Bot, then defeat that bot and win the match to complete the tutorial.'
            }
        ];
    }, [activeTutorialMap, botChallengeCompleted, botChallengeStarted, mapPlaybook.extraObjective, mapPlaybook.objectiveDetails.economy, mapPlaybook.objectiveDetails.mobility, mapPlaybook.objectiveDetails.production, mapPlaybook.objectiveDetails.tech, ownedBuildings, ownedUnits]);

    const completedObjectives = objectiveCards.filter((objective) => objective.done).length;
    const progressPercent = Math.round((completedObjectives / objectiveCards.length) * 100);
    const allObjectivesComplete = objectiveCards.length > 0 && completedObjectives === objectiveCards.length;

    useEffect(() => {
        if (!allObjectivesComplete || completionReportedRef.current || !onAllObjectivesComplete) {
            return;
        }

        completionReportedRef.current = true;
        onAllObjectivesComplete();
    }, [allObjectivesComplete, onAllObjectivesComplete]);

    if (!isOpen) {
        return (
            <button
                type="button"
                className="tutorial-panel-toggle"
                onClick={() => setIsOpen(true)}
                style={toggleStyle}
            >
                Tutorial
            </button>
        );
    }

    return (
        <aside className="tutorial-panel" style={panelStyle}>
            <div className="tutorial-panel__header">
                <div>
                    <div className="tutorial-panel__eyebrow">Campaign Tutorial</div>
                    <h3>{mapPlaybook.icon} {mapPlaybook.label} Tutorial Sandbox</h3>
                    <p>
                        {mapPlaybook.headerSummary}
                    </p>
                </div>
                <button
                    type="button"
                    className="tutorial-panel__close"
                    onClick={() => setIsOpen(false)}
                    title="Hide tutorial panel"
                >
                    -
                </button>
            </div>

            <div className="tutorial-panel__progress">
                <div className="tutorial-panel__progress-bar">
                    <div
                        className="tutorial-panel__progress-fill"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <div className="tutorial-panel__progress-label">
                    {completedObjectives}/{objectiveCards.length} core lessons practiced
                </div>
            </div>

            <div className="tutorial-panel__tabs">
                {TUTORIAL_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={`tutorial-panel__tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="tutorial-panel__body">
                {activeTab === 'objectives' && (
                    <>
                        <div className="tutorial-panel__objective-callout">
                            <strong>Victory plan:</strong> {mapPlaybook.objectiveCallout}
                        </div>
                        <div className="tutorial-panel__objective-list">
                            {objectiveCards.map((objective) => (
                                <article
                                    key={objective.id}
                                    className={`tutorial-panel__objective-card ${objective.done ? 'done' : ''}`}
                                >
                                    <div className="tutorial-panel__objective-state">
                                        {objective.done ? '✓' : '○'}
                                    </div>
                                    <div>
                                        <h4>{objective.title}</h4>
                                        <p>{objective.detail}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                        {renderLessonList(coreLessons)}
                    </>
                )}

                {activeTab === 'resources' && renderLessonList(resourceLessons)}
                {activeTab === 'buildings' && renderGuideGroups(buildingGuideGroups)}
                {activeTab === 'units' && renderGuideGroups(unitGuideGroups)}
                {activeTab === 'winning' && renderLessonList(strategyLessons)}
            </div>
        </aside>
    );
}
