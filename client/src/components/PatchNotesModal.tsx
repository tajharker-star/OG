import React, { useMemo, useState } from 'react';
import {
    PATCH_NOTE_ENTRIES,
    type PatchNoteEntry,
    type PatchNoteIconKey,
} from '../data/patchNotes';
import { Modal } from './Modal';
import './PatchNotesModal.css';

interface PatchNotesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type PatchNotesFilterKey = 'all' | 'latest' | 'balance' | 'content' | 'archive';
type PatchNotesSortKey = 'most-recent' | 'oldest' | 'title';

const FILTER_OPTIONS: Array<{ key: PatchNotesFilterKey; label: string }> = [
    { key: 'all', label: 'All Updates' },
    { key: 'latest', label: 'Latest' },
    { key: 'balance', label: 'Balance' },
    { key: 'content', label: 'Content' },
    { key: 'archive', label: 'Archive' },
];

const SORT_OPTIONS: Array<{ key: PatchNotesSortKey; label: string }> = [
    { key: 'most-recent', label: 'Most Recent' },
    { key: 'oldest', label: 'Oldest First' },
    { key: 'title', label: 'Title A-Z' },
];

const matchesFilter = (entry: PatchNoteEntry, filter: PatchNotesFilterKey) => {
    if (filter === 'all') return true;
    if (filter === 'latest') return entry.filters.includes('Latest');
    if (filter === 'balance') return entry.filters.includes('Balance');
    if (filter === 'content') return entry.filters.includes('Content');
    if (filter === 'archive') return entry.filters.includes('Archive');
    return true;
};

const sortEntries = (entries: PatchNoteEntry[], sortKey: PatchNotesSortKey) => {
    const nextEntries = [...entries];

    if (sortKey === 'title') {
        nextEntries.sort((a, b) => a.title.localeCompare(b.title));
        return nextEntries;
    }

    nextEntries.sort((a, b) => (
        sortKey === 'most-recent'
            ? b.sortOrder - a.sortOrder
            : a.sortOrder - b.sortOrder
    ));

    return nextEntries;
};

const renderPatchNoteIcon = (iconKey: PatchNoteIconKey) => {
    switch (iconKey) {
        case 'demo':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M32 10l5.8 11.8L51 24l-9.5 9.2L43.8 46 32 39.8 20.2 46l2.3-12.8L13 24l13.2-2.2L32 10z" />
                    <path d="M32 4v6M50 14l-4.5 4.5M14 14l4.5 4.5M58 32h-6M12 32H6" />
                </svg>
            );
        case 'steam':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <circle cx="42.5" cy="19.5" r="7.5" />
                    <circle cx="23" cy="41" r="6" />
                    <path d="M28 37.5L36.5 28a9 9 0 0 0 13-8.5" />
                    <path d="M23 41l-4 8" />
                    <circle cx="32" cy="32" r="25" />
                </svg>
            );
        case 'loading':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M32 12a20 20 0 1 0 18.2 11.7" />
                    <path d="M45 10h9v9" />
                    <path d="M54 10L40.5 23.5" />
                    <circle cx="32" cy="32" r="5" />
                </svg>
            );
        case 'rules':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M32 8l18 6v14c0 12.2-7.4 21.7-18 28-10.6-6.3-18-15.8-18-28V14l18-6z" />
                    <path d="M24 34h16" />
                    <path d="M26 28h12v12H26z" />
                </svg>
            );
        case 'stats':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M14 50h36" />
                    <path d="M20 50V31" />
                    <path d="M32 50V22" />
                    <path d="M44 50V14" />
                    <path d="M46 10l2.2 4.5 5 0.7-3.6 3.4 0.9 4.9L46 21l-4.5 2.5 0.9-4.9-3.6-3.4 5-0.7L46 10z" />
                </svg>
            );
        case 'audio':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M15 38h10l11 10V16L25 26H15z" />
                    <path d="M43 24a12 12 0 0 1 0 16" />
                    <path d="M49 18a20 20 0 0 1 0 28" />
                </svg>
            );
        case 'lobby':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <rect x="10" y="12" width="44" height="30" rx="6" />
                    <path d="M22 50h20" />
                    <path d="M20 22h24" />
                    <path d="M20 30h18" />
                    <path d="M20 38h12" />
                </svg>
            );
        case 'ai':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M24 18l8-6 8 6v10l8 6v10l-8 6H24l-8-6V34l8-6V18z" />
                    <circle cx="25" cy="32" r="2.5" />
                    <circle cx="39" cy="32" r="2.5" />
                    <path d="M27.5 41c1.6 1.7 3 2.5 4.5 2.5s2.9-0.8 4.5-2.5" />
                </svg>
            );
        case 'units':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M18 42l11-11" />
                    <path d="M34 26l12-12" />
                    <path d="M18 46h12l16-16V18L34 30H22z" />
                    <path d="M14 50h36" />
                    <path d="M43 13l7 7" />
                </svg>
            );
        case 'buildings':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M14 50h36" />
                    <rect x="18" y="26" width="12" height="24" />
                    <rect x="34" y="18" width="12" height="32" />
                    <path d="M22 32h4M22 38h4M38 24h4M38 30h4M38 36h4" />
                </svg>
            );
        case 'logistics':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <circle cx="14" cy="44" r="4" />
                    <circle cx="32" cy="20" r="4" />
                    <circle cx="50" cy="44" r="4" />
                    <path d="M18 41l10-14" />
                    <path d="M36 23l10 14" />
                    <path d="M14 44h36" />
                    <path d="M24 44l8-12 8 12" />
                </svg>
            );
        case 'campaign':
            return (
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M18 52V14" />
                    <path d="M18 16c8-5 16 5 24 0v20c-8 5-16-5-24 0" />
                    <path d="M42 24h8" />
                    <path d="M46 20v8" />
                </svg>
            );
        default:
            return null;
    }
};

export const PatchNotesModal: React.FC<PatchNotesModalProps> = ({ isOpen, onClose }) => {
    const [activeFilter, setActiveFilter] = useState<PatchNotesFilterKey>('all');
    const [sortKey, setSortKey] = useState<PatchNotesSortKey>('most-recent');

    const filteredEntries = useMemo(() => {
        const visibleEntries = PATCH_NOTE_ENTRIES.filter((entry) => matchesFilter(entry, activeFilter));
        return sortEntries(visibleEntries, sortKey);
    }, [activeFilter, sortKey]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Patch Notes"
            className="patch-notes-modal"
        >
            <div className="patch-notes-body">
                <section className="patch-notes-hero">
                    <div className="patch-notes-hero__eyebrow">Lobby Intel</div>
                    <h3 className="patch-notes-hero__title">Stay current with the latest build</h3>
                    <p className="patch-notes-hero__copy">
                        This archive tracks the major systems, balance improvements, quality-of-life work,
                        and platform updates currently represented in the demo.
                    </p>
                    <div className="patch-notes-hero__stats">
                        <div className="patch-notes-hero__stat">
                            <span className="patch-notes-hero__stat-value">{PATCH_NOTE_ENTRIES.length}</span>
                            <span className="patch-notes-hero__stat-label">Tracked updates</span>
                        </div>
                        <div className="patch-notes-hero__stat">
                            <span className="patch-notes-hero__stat-value">{filteredEntries.length}</span>
                            <span className="patch-notes-hero__stat-label">Visible now</span>
                        </div>
                    </div>
                </section>

                <section className="patch-notes-toolbar">
                    <div className="patch-notes-filter-group" role="tablist" aria-label="Patch note filters">
                        {FILTER_OPTIONS.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                className={`patch-notes-filter-chip ${activeFilter === option.key ? 'patch-notes-filter-chip--active' : ''}`}
                                onClick={() => setActiveFilter(option.key)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <label className="patch-notes-sort">
                        <span className="patch-notes-sort__label">Sort</span>
                        <select
                            value={sortKey}
                            onChange={(event) => setSortKey(event.target.value as PatchNotesSortKey)}
                            className="patch-notes-sort__select"
                        >
                            {SORT_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </section>

                <div className="patch-notes-list">
                    {filteredEntries.map((entry) => {
                        const accentStyle = { '--patch-note-accent': entry.accent } as React.CSSProperties;
                        const hasArtwork = Boolean(entry.artwork);

                        return (
                        <article key={entry.id} className="patch-note-card" style={accentStyle}>
                            <div className={`patch-note-card__visual ${hasArtwork ? '' : 'patch-note-card__visual--icon-only'}`}>
                                {entry.artwork && (
                                    <img
                                        src={entry.artwork}
                                        alt={entry.artworkAlt || entry.title}
                                        className="patch-note-card__artwork"
                                    />
                                )}
                                <div className="patch-note-card__visual-scrim" aria-hidden="true" />
                                <div className="patch-note-card__visual-badge" aria-hidden="true">
                                    {renderPatchNoteIcon(entry.iconKey)}
                                </div>
                                {!hasArtwork && (
                                    <div className="patch-note-card__visual-icon-hero" aria-hidden="true">
                                        {renderPatchNoteIcon(entry.iconKey)}
                                    </div>
                                )}
                                <div className="patch-note-card__visual-meta">
                                    <span className={`patch-note-card__badge patch-note-card__badge--${entry.badge.toLowerCase()}`}>
                                        {entry.badge}
                                    </span>
                                    <span className="patch-note-card__date">{entry.dateLabel}</span>
                                </div>
                            </div>
                            <div className="patch-note-card__rail" aria-hidden="true" />
                            <div className="patch-note-card__content">
                                <h4 className="patch-note-card__title">{entry.title}</h4>
                                <p className="patch-note-card__summary">{entry.summary}</p>

                                <ul className="patch-note-card__highlights">
                                    {entry.highlights.map((highlight) => (
                                        <li key={highlight}>{highlight}</li>
                                    ))}
                                </ul>

                                <div className="patch-note-card__tags">
                                    {entry.tags.map((tag) => (
                                        <span key={tag} className="patch-note-card__tag">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        </article>
                    )})}
                </div>
            </div>
        </Modal>
    );
};
