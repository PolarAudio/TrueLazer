// Which parts of a document are the DOCUMENT, and how to tell whether there
// is unsaved work.
//
// The Show Project (.tlp) is written as the WHOLE reducer state, so a naive
// "has the state changed?" check would be useless: the state also carries a
// toast notification, the playback state, the selection, the ILDA parse
// progress and the theme. Those change on their own, so a fingerprint over
// the whole state would report the document as dirty seconds after it was
// saved.
//
// The projection below is the SHOW: the grid, the clip content, the per-layer
// state, the show-level parameters and the output routing. Everything the
// user authors is in it; everything that merely happens is not. App-level
// preferences (theme, beam rendering, optimization) are excluded as well -
// they live in the settings store, and they are not the show.
//
// The Shape Builder's unsaved-changes tracking (src/components/ShapeBuilder.jsx)
// does the same thing with a curated projection, and this follows it.

export const SHOW_PROJECT_DOCUMENT_KEYS = [
    // The grid.
    'columns', 'layers', 'activePageId', 'numPages', 'pageNames',
    // Clip content.
    'clipContents', 'clipNames', 'thumbnailFrameIndexes',
    // Per-layer state.
    'layerEffects', 'layerAssignedDacs', 'layerIntensities', 'layerAutopilots',
    'layerBlackouts', 'layerSolos', 'layerEffectSpeeds', 'layerSyncSettings',
    // Show-level state.
    'masterIntensity', 'globalBlackout', 'bpm', 'playbackFps',
    // Output routing and presets.
    'dacOutputSettings', 'projectPresets', 'quickAssigns',
];

/**
 * A stable fingerprint of the Show Project's document.
 *
 * The key order is fixed by SHOW_PROJECT_DOCUMENT_KEYS, so two equal
 * documents always produce the same string.
 */
export function showProjectFingerprint(state) {
    if (!state || typeof state !== 'object') return '';
    const document_ = {};
    for (const key of SHOW_PROJECT_DOCUMENT_KEYS) {
        if (state[key] !== undefined) document_[key] = state[key];
    }
    return JSON.stringify(document_);
}

/**
 * Whether the Show Project differs from the last saved/opened version.
 *
 * `baseline` is the fingerprint of the document as it was last written. A
 * null baseline means "nothing has been saved yet", which is dirty: the
 * document only exists in memory.
 */
export function isShowProjectDirty(state, baseline) {
    if (baseline === null || baseline === undefined) return true;
    return showProjectFingerprint(state) !== baseline;
}

// Human names for the editors, in the order they are listed in a prompt.
const EDITOR_LABELS = {
    showProject: 'the Show Project',
    shapeBuilder: 'the Shape Builder',
    timeline: 'the Timeline',
};

/**
 * The editors that would lose work if the app quit right now.
 *
 * `editors` maps an editor key to a truthy value meaning "has unsaved work".
 */
export function describeUnsavedWork(editors = {}) {
    return Object.keys(EDITOR_LABELS)
        .filter((key) => !!editors[key])
        .map((key) => EDITOR_LABELS[key]);
}

export const hasUnsavedWork = (editors = {}) => describeUnsavedWork(editors).length > 0;

/**
 * The confirmation shown before quitting with work in progress.
 *
 * Phrased like the app's other destructive confirmations: OK discards and
 * continues, Cancel stays so the user can save first.
 */
export function unsavedWorkPrompt(editors = {}) {
    const items = describeUnsavedWork(editors);
    if (items.length === 0) return '';
    const list = items.length === 1
        ? items[0]
        : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
    return `TrueLazer has unsaved work in ${list}.\n\n`
        + 'OK - discard it and continue\n'
        + 'Cancel - stay here so you can save first';
}
