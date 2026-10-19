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