// Undo/redo history for the Output Settings window.
//
// Every edit in that window is applied live, and drags emit an update on each
// mouse move. Snapshotting on every update would turn a single zone drag into
// hundreds of Ctrl+Z steps, so the window records a drag as one transaction and
// coalesces rapid edits to the same field (slider sweeps, typing) into one
// entry.

export const HISTORY_LIMIT = 100;
export const EDIT_COALESCE_MS = 600;

// Settings objects are shallow except for the two nested documents, so they are
// the only fields that need copying. Kept per-object so an undo snapshot cannot
// be mutated by later edits.
export function cloneOutputSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;

    const copy = { ...settings };
    if (Array.isArray(settings.safetyZones)) {
        copy.safetyZones = settings.safetyZones.map((zone) =>
            zone && typeof zone === 'object' ? { ...zone } : zone
        );
    }
    if (settings.outputArea && typeof settings.outputArea === 'object') {
        copy.outputArea = { ...settings.outputArea };
    }
    return copy;
}

// Canonical form so two equal documents compare equal regardless of key order.
const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
};

export const outputSettingsEqual = (a, b) => canonical(a) === canonical(b);

export function createHistory() {
    return { undo: [], redo: [] };
}

// Store the state as it was BEFORE a change. Returns whether an entry was added.
export function pushHistory(history, snapshot, limit = HISTORY_LIMIT) {
    if (!history || !snapshot) return false;

    history.redo.length = 0;

    const top = history.undo[history.undo.length - 1];
    if (top && outputSettingsEqual(top, snapshot)) return false;

    history.undo.push(cloneOutputSettings(snapshot));
    if (history.undo.length > limit) {
        history.undo.splice(0, history.undo.length - limit);
    }
    return true;
}

// `current` is pushed onto the redo stack so Ctrl+Shift+Z can return to it.
export function undoHistory(history, current) {
    if (!history || history.undo.length === 0) return null;

    const previous = history.undo.pop();
    if (current !== undefined) history.redo.push(cloneOutputSettings(current));
    return previous;
}

export function redoHistory(history, current) {
    if (!history || history.redo.length === 0) return null;

    const next = history.redo.pop();
    if (current !== undefined) history.undo.push(cloneOutputSettings(current));
    return next;
}

// `last` is { key, time }. Consecutive edits with the same key inside the
// window extend the current entry instead of adding another one.
export function shouldCoalesceEdit(last, key, now, windowMs = EDIT_COALESCE_MS) {
    if (!last || !key) return false;
    return last.key === key && now - last.time < windowMs;
}
