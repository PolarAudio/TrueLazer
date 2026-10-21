// Standalone DAC Output Settings file (`.tlo`).
//
// Output Settings are otherwise part of the Show project document, so starting
// a new project clears them and they cannot be carried to another show. This
// module defines the on-disk shape plus the matching rule used when loading one
// back.
//
// Entries are keyed `"<ip>:<serviceID>"` - the same key the app uses for
// `dacOutputSettings`. That means a file is only meaningful on a machine whose
// DACs sit at the same addresses, which is why `matchOutputs` reports what it
// could NOT place instead of silently dropping those settings.

export const OUTPUT_SETTINGS_FORMAT = 'truelazer-output';
export const OUTPUT_SETTINGS_VERSION = 1;

/**
 * Wrap a live `dacOutputSettings` map into the file envelope.
 * Entries with no content are omitted so an exported file stays readable.
 */
export function buildOutputSettingsFile(dacSettings, meta = {}) {
    const outputs = {};
    for (const [key, settings] of Object.entries(dacSettings || {})) {
        if (!settings || typeof settings !== 'object') continue;
        outputs[key] = settings;
    }
    return {
        format: OUTPUT_SETTINGS_FORMAT,
        version: OUTPUT_SETTINGS_VERSION,
        exportedAt: meta.exportedAt || new Date().toISOString(),
        outputs,
    };
}

/**
 * Parse a loaded file. Accepts the versioned envelope, and tolerates a bare
 * settings map so a hand-written or older file still loads.
 *
 * @returns {{ok: true, outputs: object, warning?: string} | {ok: false, error: string}}
 */
export function parseOutputSettingsFile(data) {
    if (!data || typeof data !== 'object') {
        return { ok: false, error: 'File is empty or not valid JSON.' };
    }

    // Bare map: { "10.0.0.5:1": {...} } - no envelope.
    if (!data.format && !data.outputs) {
        const keys = Object.keys(data);
        if (keys.length === 0) return { ok: false, error: 'File contains no output settings.' };
        return { ok: true, outputs: data, warning: 'File had no format header; loaded it as a raw settings map.' };
    }

    if (data.format !== OUTPUT_SETTINGS_FORMAT) {
        return { ok: false, error: `Not a TrueLazer output settings file (found format "${data.format || 'none'}").` };
    }
    if (!data.outputs || typeof data.outputs !== 'object') {
        return { ok: false, error: 'File is missing its "outputs" section.' };
    }
    const count = Object.keys(data.outputs).length;
    if (count === 0) return { ok: false, error: 'File contains no output settings.' };

    let warning;
    if (Number(data.version) > OUTPUT_SETTINGS_VERSION) {
        warning = `File was written by a newer version (v${data.version}); unknown settings were ignored.`;
    }
    return { ok: true, outputs: data.outputs, warning };
}

/**
 * Split imported settings into those that match a currently detected output and
 * those that do not.
 *
 * Matching is by the `"<ip>:<serviceID>"` key. An unmatched entry means no DAC
 * at that address is currently discovered, so applying it would either do
 * nothing or, worse, write a setting for hardware that is not connected.
 *
 * Import MERGES: only outputs present in the file are touched, so a partial
 * file cannot wipe the settings of an output it happens not to mention.
 *
 * @param {object} imported  parsed settings map
 * @param {string[]} detectedIds  ids of outputs currently discovered
 */
export function matchOutputs(imported, detectedIds) {
    const detected = new Set((detectedIds || []).map(String));
    const matched = {};
    const unmatched = [];

    for (const [key, settings] of Object.entries(imported || {})) {
        if (!settings || typeof settings !== 'object') continue;
        if (!detected.has(key)) {
            unmatched.push(key);
            continue;
        }
        matched[key] = settings;
    }

    return { matched, unmatched };
}

/** `"10.0.0.5:1"` -> `{ ip, channel }`, for a readable unmatched-output message. */
export function describeOutputKey(key) {
    const s = String(key);
    const i = s.lastIndexOf(':');
    if (i < 0) return s;
    return `${s.slice(0, i)} channel ${s.slice(i + 1)}`;
}