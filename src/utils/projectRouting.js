// Which page owns the application menu's Open / Save / Save As / New commands.
//
// The menu accelerators are registered once for the whole application, so they
// fire no matter which page is showing. Historically every one of them operated
// on the show project: pressing Ctrl+S while on the Timeline wrote a .tlp show
// file instead of saving the timeline. Routing is decided here so the rule is in
// one testable place rather than inline in a mount-once effect.

/** Pages the renderer can show. `main` is the fallback for anything unknown. */
export const APP_PAGES = ['main', 'timeline', 'shapeBuilder'];

export const PAGE_LABELS = {
    main: 'Show Control',
    timeline: 'Timeline Editor',
    shapeBuilder: 'Shape Builder',
};

/** Pages that have a clip deck (layers / columns / clips) and a full View menu. */
export function isShowEditorPage(page) {
    return normalizePage(page) === 'main';
}

export function normalizePage(page) {
    return APP_PAGES.includes(page) ? page : 'main';
}

/** The project commands the application menu can raise. */
export const PROJECT_COMMANDS = ['new', 'open', 'save', 'saveAs'];

/**
 * Pages whose document would be LOST by navigating away.
 *
 * The Shape Builder holds its document in component state and unmounts when its
 * page is left. The Timeline keeps its store above this component and persists
 * it to local storage, so it survives navigation untouched.
 */
export const PAGES_AT_RISK_ON_NAVIGATION = ['shapeBuilder'];

/**
 * Whether leaving `fromPage` for `toPage` should warn about unsaved changes.
 *
 * @param {string} fromPage
 * @param {string} toPage
 * @param {boolean} isDirty  whether the page's document has unsaved changes
 */
export function shouldWarnOnUnsavedChanges(fromPage, toPage, isDirty) {
    if (fromPage === toPage) return false;
    if (!PAGES_AT_RISK_ON_NAVIGATION.includes(normalizePage(fromPage))) return false;
    return !!isDirty;
}

/**
 * Map a keyboard event to a project command.
 *
 * The menu items carry `registerAccelerator: false`, so these keys are handled
 * here in the renderer. That makes the mapping the single place where a
 * keypress becomes an action, and keeps behaviour identical no matter which
 * element has focus.
 *
 * Returns null for anything that is not one of the four commands, so the caller
 * can ignore it without side effects.
 *
 * @param {{key?:string, ctrlKey?:boolean, metaKey?:boolean, shiftKey?:boolean, altKey?:boolean}} e
 */
export function commandForKeyEvent(e) {
    if (!e) return null;
    // Ctrl on Windows/Linux, Cmd on macOS.
    if (!(e.ctrlKey || e.metaKey)) return null;
    // Alt+key produces other characters (AltGr) - never ours.
    if (e.altKey) return null;
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (key === 'n') return 'new';
    if (key === 'o') return 'open';
    if (key === 's') return e.shiftKey ? 'saveAs' : 'save';
    return null;
}

/**
 * Decide who handles a project command.
 *
 * Returns `{ owner, handled }`:
 *  - `owner: 'timeline'` / `'shapeBuilder'` - the renderer must dispatch to that
 *    page's own implementation.
 *  - `owner: 'main', handled: false` - the show editor, whose .tlp path and
 *    dialogs are owned by the main process.
 *  - `handled: false` with `owner: 'timeline'`/`'shapeBuilder'` means that
 *    page's implementation was not available (not mounted / no actions yet), so
 *    the command should be dropped rather than falling back to the show project.
 *    Falling back would be worse than doing nothing: it would save the wrong
 *    document to the wrong file.
 *
 * @param {string} page
 * @param {'new'|'open'|'save'|'saveAs'} command
 * @param {{ timeline?: object, shapeBuilder?: object }} available
 */
export function resolveProjectCommand(page, command, available = {}) {
    const owner = normalizePage(page);
    if (!PROJECT_COMMANDS.includes(command)) {
        return { owner, command, handled: false, reason: 'unknown-command' };
    }
    if (owner === 'main') {
        return { owner, command, handled: false, reason: 'main-process' };
    }
    const impl = owner === 'timeline' ? available.timeline : available.shapeBuilder;
    const fnName = { new: 'newProject', open: 'openProject', save: 'saveProject', saveAs: 'saveProjectAs' }[command];
    if (!impl || typeof impl[fnName] !== 'function') {
        return { owner, command, handled: false, reason: 'unavailable' };
    }
    return { owner, command, handled: true, run: impl[fnName] };
}