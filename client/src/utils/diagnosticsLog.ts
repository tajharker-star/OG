export const DIAGNOSTICS_STORAGE_KEY = 'conquerors_domination_session_diagnostics_v1';
export const DIAGNOSTICS_LOG_UPDATED_EVENT = 'diagnostics-log-updated';

const MAX_DIAGNOSTIC_LOG_ENTRIES = 150;

export type DiagnosticLogKind = 'lag';

export type DiagnosticLogEntry = {
    id: string;
    kind: DiagnosticLogKind;
    source: string;
    capturedAt: number;
    iso: string;
    detail: Record<string, unknown>;
};

export type DiagnosticsLogUpdatedEventDetail = {
    entries: DiagnosticLogEntry[];
    latestEntry: DiagnosticLogEntry | null;
};

const getSessionStorage = (): Storage | null => {
    if (typeof window === 'undefined') return null;

    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isDiagnosticLogEntry = (value: unknown): value is DiagnosticLogEntry => {
    if (!isRecord(value)) return false;

    return (
        typeof value.id === 'string' &&
        value.kind === 'lag' &&
        typeof value.source === 'string' &&
        typeof value.capturedAt === 'number' &&
        typeof value.iso === 'string' &&
        isRecord(value.detail)
    );
};

const toPlainRecord = (value: Record<string, unknown>): Record<string, unknown> => {
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return { serializationError: 'Failed to serialize diagnostic payload.' };
    }
};

const notifyDiagnosticsLogUpdated = (entries: DiagnosticLogEntry[], latestEntry: DiagnosticLogEntry | null) => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent<DiagnosticsLogUpdatedEventDetail>(DIAGNOSTICS_LOG_UPDATED_EVENT, {
        detail: {
            entries,
            latestEntry,
        },
    }));
};

export const readDiagnosticsLog = (): DiagnosticLogEntry[] => {
    const storage = getSessionStorage();
    if (!storage) return [];

    try {
        const raw = storage.getItem(DIAGNOSTICS_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];

        return parsed.filter(isDiagnosticLogEntry);
    } catch {
        return [];
    }
};

const writeDiagnosticsLog = (entries: DiagnosticLogEntry[]) => {
    const storage = getSessionStorage();
    if (!storage) return;

    try {
        storage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_DIAGNOSTIC_LOG_ENTRIES)));
    } catch {
        // If storage is full, keep the newest smaller chunk so diagnostics still remain useful.
        try {
            storage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(entries.slice(-50)));
        } catch {
            storage.removeItem(DIAGNOSTICS_STORAGE_KEY);
        }
    }
};

export const appendDiagnosticsLog = (detail: Record<string, unknown>, source = 'freeze-diagnostic'): DiagnosticLogEntry => {
    const now = Date.now();
    const entry: DiagnosticLogEntry = {
        id: typeof detail.id === 'string' ? detail.id : `${now}-${Math.round(Math.random() * 10000)}`,
        kind: 'lag',
        source,
        capturedAt: now,
        iso: new Date(now).toISOString(),
        detail: toPlainRecord(detail),
    };
    const entries = [...readDiagnosticsLog(), entry].slice(-MAX_DIAGNOSTIC_LOG_ENTRIES);
    writeDiagnosticsLog(entries);
    notifyDiagnosticsLogUpdated(entries, entry);
    return entry;
};

export const clearDiagnosticsLog = (): DiagnosticLogEntry[] => {
    const storage = getSessionStorage();
    if (storage) {
        try {
            storage.removeItem(DIAGNOSTICS_STORAGE_KEY);
        } catch {
            // Ignore storage failures; the in-memory UI will still reset.
        }
    }

    notifyDiagnosticsLogUpdated([], null);
    return [];
};

const asNumber = (value: unknown): number | null => {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const asString = (value: unknown): string | null => {
    return typeof value === 'string' && value.length > 0 ? value : null;
};

const asStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

const metric = (label: string, value: string | null) => {
    return value ? `${label}: ${value}` : `${label}: --`;
};

const msMetric = (value: unknown) => {
    const numberValue = asNumber(value);
    return numberValue === null ? null : `${Math.round(numberValue)}ms`;
};

const numberMetric = (value: unknown) => {
    const numberValue = asNumber(value);
    return numberValue === null ? null : `${Math.round(numberValue)}`;
};

const percentMetric = (value: unknown) => {
    const numberValue = asNumber(value);
    return numberValue === null ? null : `${Math.round(numberValue * 100)}%`;
};

export const formatDiagnosticsEntry = (entry: DiagnosticLogEntry): string => {
    const detail = entry.detail;
    const severity = asString(detail.severity) ?? 'info';
    const reason = asString(detail.reason) ?? 'No diagnostic reason recorded.';
    const recommendations = asStringArray(detail.recommendations);
    const pingLabel = detail.localTransport === true
        ? 'Local'
        : msMetric(detail.pingMs) ?? asString(detail.pingLabel) ?? '--';

    const lines = [
        `[${entry.iso}] ${severity.toUpperCase()} ${entry.source}`,
        `Reason: ${reason}`,
        [
            metric('Frame', msMetric(detail.frameGapMs)),
            metric('Snapshot', msMetric(detail.snapshotAgeMs)),
            metric('FPS', numberMetric(detail.fps)),
            metric('Ping', pingLabel),
        ].join(' | '),
        [
            metric('Units', numberMetric(detail.unitCount)),
            metric('Buildings', numberMetric(detail.buildingCount)),
            metric('Projectiles', numberMetric(detail.projectileBurst)),
            metric('Auto', numberMetric(detail.autoPerformanceLevel) ? `L${numberMetric(detail.autoPerformanceLevel)}` : null),
            metric('Memory', asNumber(detail.memoryMb) === null ? null : `${numberMetric(detail.memoryMb)}MB`),
        ].join(' | '),
        [
            metric('Server Load', percentMetric(detail.serverLoadFactor)),
            metric('Server Tick', msMetric(detail.serverTickMs)),
            metric('Heartbeat', msMetric(detail.serverHeartbeatAgeMs)),
            metric('Runtime', asString(detail.serverRuntimeMode)),
            metric('Status', asString(detail.serverStatus)),
            metric('Match State', asString(detail.serverMatchState)),
        ].join(' | '),
        recommendations.length > 0 ? `Recommendations: ${recommendations.join(' / ')}` : 'Recommendations: --',
        'Raw JSON:',
        JSON.stringify(detail, null, 2),
    ];

    return lines.join('\n');
};

export const formatDiagnosticsLog = (entries: DiagnosticLogEntry[]): string => {
    const header = [
        'Conquerors: Domination session diagnostics',
        `Generated: ${new Date().toISOString()}`,
        `Entries: ${entries.length}`,
        'Persistence: session only; survives Command+R reload and clears when the app window closes.',
    ].join('\n');

    if (entries.length === 0) {
        return `${header}\n\nNo diagnostics have been captured this session.`;
    }

    return `${header}\n\n${entries.map(formatDiagnosticsEntry).join('\n\n---\n\n')}`;
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the textarea copy path for older Electron contexts.
        }
    }

    if (typeof document === 'undefined') return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
};
