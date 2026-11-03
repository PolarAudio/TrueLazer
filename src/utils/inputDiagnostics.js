/**
 * Click-path diagnostics.
 *
 * Symptom this exists for: the whole UI intermittently stops responding -
 * buttons and native <select> dropdowns do nothing, the laser previews keep
 * animating, and only a reload brings the input back.
 *
 * A renderer that keeps painting but ignores clicks means the input never
 * reached React, and there are only two ways that happens:
 *
 *   1. An element React does not own is sitting on top of the page (a portal,
 *      an overlay whose close handler never ran, ...).
 *   2. The click never reached the page at all, because an OS-level popup - a
 *      native <select> list or a context menu whose owner was unmounted while
 *      it was open - still holds it. Chromium draws those in their own window,
 *      so nothing in the DOM shows them and a reload is the only way out.
 *
 * Those need different fixes, so this module records the facts that tell them
 * apart. It is purely observational: no behaviour is changed, every entry is
 * rate limited, and it is capped so a broken state cannot flood the log.
 *
 * A third possibility is reported from the app code itself: the click arrives,
 * React runs the handler, and the handler writes nowhere because the state it
 * targets is gone (a selection index outliving its shape). That looks identical
 * to a frozen UI from the outside, so reportInputProblem() lets those paths say
 * so in the same log.
 *
 * Written through console.warn on purpose: main.js forwards renderer warnings
 * and errors into main.log, which is what a bug report carries.
 */

const RATE_LIMIT_MS = 2000;
// A window that stays unfocused is worth knowing about once, not every minute.
const BLUR_RATE_LIMIT_MS = 60000;
// Scrollbar presses are normal input, not evidence of the bug: say so once a minute.
const SCROLLBAR_RATE_LIMIT_MS = 60000;
const MAX_REPORTS = 300;
// A press only counts as an unfinished click when the pointer stayed put; a
// press that turns into a drag is a legitimate interaction and never clicks.
const CLICK_GRACE_MS = 1500;
const CLICK_MOVE_SLOP_PX = 8;

const describe = (el) => {
    if (!el) return '(none)';
    if (el.nodeType !== 1) return String(el);
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth += 1) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += `#${node.id}`;
        const cls = typeof node.className === 'string' ? node.className.trim() : '';
        if (cls) part += `.${cls.split(/\s+/).slice(0, 3).join('.')}`;
        parts.push(part);
        node = node.parentElement;
    }
    return parts.join(' < ');
};

const stylesOf = (el) => {
    try {
        const cs = window.getComputedStyle(el);
        return `position=${cs.position} z-index=${cs.zIndex} pointer-events=${cs.pointerEvents} `
            + `display=${cs.display} opacity=${cs.opacity}`;
    } catch (_) {
        return 'styles unavailable';
    }
};

const SCROLLABLE = /(auto|scroll|overlay)/;

/**
 * Is this point inside the scrollbar gutter of `el`?
 *
 * A press on a scrollbar never dispatches a click, so a "press produced no
 * click" report from there says nothing about the app being broken. Without
 * this check the panel's own scrollbar (the right-most ~15 px of a 260 px
 * sidebar) looks like a dead zone in every report.
 *
 * Returns 'vertical', 'horizontal' or null. The gutters are derived from
 * offsetWidth/Height vs clientWidth/Height, so they also include borders; the
 * band is therefore reported slightly wide on purpose.
 */
export function scrollbarBandHit(el, x, y) {
    try {
        if (!el || el.nodeType !== 1) return null;
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const vGutter = el.offsetWidth - el.clientWidth;
        const hGutter = el.offsetHeight - el.clientHeight;
        if (vGutter > 0 && SCROLLABLE.test(cs.overflowY) && el.scrollHeight > el.clientHeight
            && x >= rect.right - vGutter - 1 && x <= rect.right + 1) {
            return 'vertical';
        }
        if (hGutter > 0 && SCROLLABLE.test(cs.overflowX) && el.scrollWidth > el.clientWidth
            && y >= rect.bottom - hGutter - 1 && y <= rect.bottom + 1) {
            return 'horizontal';
        }
    } catch (_) { /* a probe must never break input */ }
    return null;
}

/** Scroll offsets and sizes of the nearest scroller above `el`, for reports. */
const scrollerOf = (el) => {
    try {
        let node = el;
        while (node && node.nodeType === 1) {
            const cs = window.getComputedStyle(node);
            if ((SCROLLABLE.test(cs.overflowY) && node.scrollHeight > node.clientHeight)
                || (SCROLLABLE.test(cs.overflowX) && node.scrollWidth > node.clientWidth)) {
                return ` scroller=<${describe(node)}> scroll=${node.scrollLeft},${node.scrollTop} `
                    + `client=${node.clientWidth}x${node.clientHeight} `
                    + `scrollSize=${node.scrollWidth}x${node.scrollHeight}`;
            }
            node = node.parentElement;
        }
    } catch (_) { /* ignore */ }
    return '';
};

/** Viewport and rect of `el`, so a report can be replayed against a layout. */
const geometryOf = (el) => {
    try {
        const rect = el.getBoundingClientRect();
        const view = `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}x`;
        return `view=${view} rect=${Math.round(rect.left)},${Math.round(rect.top)} `
            + `${Math.round(rect.width)}x${Math.round(rect.height)}${scrollerOf(el)}`;
    } catch (_) {
        return 'geometry unavailable';
    }
};

/**
 * Report a non-DOM input problem from application code, through the same rate
 * limited console.warn channel (and therefore into main.log).
 */
export function reportInputProblem(kind, message) {
    const diagnostics = typeof window !== 'undefined' ? window.__truelazerInputDiagnostics : null;
    if (diagnostics && typeof diagnostics.report === 'function') {
        try {
            diagnostics.report(kind, message);
            return;
        } catch (_) { /* fall through to a plain warning */ }
    }
    try {
        console.warn(`[input] ${message}`);
    } catch (_) { /* logging must never break the app */ }
}

export function installInputDiagnostics() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => { };
    // Guard against a double install; there is only ever one set of listeners.
    if (window.__truelazerInputDiagnostics) return () => { };

    const lastReportAt = Object.create(null);
    let reportCount = 0;

    const report = (kind, message) => {
        const now = Date.now();
        const limit = kind === 'blur' ? BLUR_RATE_LIMIT_MS
            : kind === 'scrollbar-press' ? SCROLLBAR_RATE_LIMIT_MS
                : RATE_LIMIT_MS;
        // The focus signal is rare by nature and must survive a long session, so
        // it does not spend the budget the interaction reports share.
        if (kind !== 'blur' && reportCount >= MAX_REPORTS) return;
        if (lastReportAt[kind] && now - lastReportAt[kind] < limit) return;
        lastReportAt[kind] = now;
        if (kind !== 'blur') reportCount += 1;
        try {
            console.warn(`[input] ${message}`);
        } catch (_) { /* logging must never break the app */ }
    };

    // These run on every press in the app. A throw here would be the very
    // "input stops working" bug this module exists to find, so nothing escapes.
    const safe = (handler) => (event) => {
        try {
            handler(event);
        } catch (_) { /* diagnostics must never break input */ }
    };

    // ---------------------------------------------------------------- focus
    // Losing focus is normal (alt-tab). Losing it and *staying* unfocused while
    // the page is still visible is not: an OS-level popup that outlived its
    // owner holds the activation and never gives it back, and while it holds it
    // the window never sees the clicks the user is making. Waiting a moment
    // before reporting keeps ordinary alt-tabbing out of the log.
    let blurTimer = null;
    const onWindowBlur = safe(() => {
        window.clearTimeout(blurTimer);
        blurTimer = window.setTimeout(() => {
            blurTimer = null;
            if (document.hasFocus()) return;
            report(
                'blur',
                `window stayed unfocused after blur (visibility=${document.visibilityState}); `
                + 'an OS-level popup may be holding the activation'
            );
        }, 3000);
    });
    const onWindowFocus = safe(() => {
        window.clearTimeout(blurTimer);
        blurTimer = null;
    });

    // ------------------------------------------------------- who got the hit
    // If the element under the cursor is not inside #root, something React did
    // not render is covering the app. elementFromPoint is used instead of the
    // event target so it also catches elements whose pointer-events: none
    // ancestor already decided the retargeting.
    //
    // React portals mount into document.body by design, so the two that do are
    // expected and are not reported.
    const PORTAL_SELECTORS = '.midi-mapping-global-overlay-container, .file-hover-preview';
    const onPointerDownCapture = safe((e) => {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (!hit) return;
        const root = document.getElementById('root');
        if (!root || hit === root || root.contains(hit)) return;
        if (hit.closest && hit.closest(PORTAL_SELECTORS)) return;
        report(
            'outside-root',
            `press landed on <${describe(hit)}>, outside #root; ${stylesOf(hit)}`
        );
    });

    // ----------------------------------------------------- cancelled default
    // preventDefault() on the press is what stops a native <select> from
    // opening and what suppresses the synthesized click. Logged separately
    // from the pointerdown variant because Chromium keys the select popup off
    // the mouse event.
    const onMouseDownBubble = safe((e) => {
        if (!e.defaultPrevented) return;
        report(
            'cancelled-mousedown',
            `mousedown default cancelled on <${describe(e.target)}>; a native <select> cannot open from this`
        );
    });
    const onPointerDownBubble = safe((e) => {
        if (!e.defaultPrevented) return;
        report(
            'cancelled-pointerdown',
            `pointerdown default cancelled on <${describe(e.target)}>; ${stylesOf(e.target)}`
        );
    });

    // ------------------------------------------- press that never became click
    // The press reached the page but the click was swallowed by an ancestor
    // (or the press was cancelled after dispatch, which never logs above).
    let pendingPress = null;
    const onPressStart = safe((e) => {
        if (e.button !== 0) return;
        if (!document.hasFocus()) {
            report(
                'unfocused-press',
                `press arrived while the document was unfocused (activeElement=`
                + `${describe(document.activeElement)})`
            );
        }
        pendingPress = { target: e.target, x: e.clientX, y: e.clientY, at: Date.now() };
    });
    const onClickCapture = safe(() => {
        pendingPress = null;
    });
    const onPressCancel = safe(() => {
        pendingPress = null;
    });
    const clickWatch = window.setInterval(() => {
        const press = pendingPress;
        if (!press) return;
        if (Date.now() - press.at < CLICK_GRACE_MS) return;
        pendingPress = null;
        // A scrollbar press is a normal scroll and never clicks; saying so once
        // keeps it from masquerading as the freeze in the next bug report.
        const band = scrollbarBandHit(press.target, press.x, press.y);
        if (band) {
            report(
                'scrollbar-press',
                `left press at ${press.x},${press.y} landed on the ${band} scrollbar of `
                + `<${describe(press.target)}>; scrollbars never dispatch a click, so this is not a frozen control`
            );
            return;
        }
        report(
            'no-click',
            `left press on <${describe(press.target)}> at ${press.x},${press.y} produced no click `
            + `within ${CLICK_GRACE_MS} ms; ${stylesOf(press.target)}; ${geometryOf(press.target)}`
        );
    }, 500);
    const onPressMove = safe((e) => {
        const press = pendingPress;
        if (!press) return;
        if (Math.abs(e.clientX - press.x) > CLICK_MOVE_SLOP_PX
            || Math.abs(e.clientY - press.y) > CLICK_MOVE_SLOP_PX) {
            pendingPress = null; // it is a drag, not a failed click
        }
    });

    // Manual probe for the next occurrence: run `__truelazerInput.whatIsOnTop()`
    // in the DevTools console while clicks are dead to dump the element stack at
    // a point, topmost first.
    const diagnostics = {
        report,
        /** Element stack at a point, topmost first. Useful when clicks are dead. */
        whatIsOnTop: (x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight / 2)) => {
            const stack = document.elementsFromPoint(x, y) || [];
            const lines = stack.map((el, i) => `${i}: <${describe(el)}> ${stylesOf(el)}`);
            console.warn(`[input] element stack at ${x},${y}\n${lines.join('\n')}`);
            return stack;
        },
        get reportCount() { return reportCount; },
    };
    window.__truelazerInputDiagnostics = diagnostics;
    window.__truelazerInput = diagnostics;

    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('pointerdown', onPointerDownBubble);
    window.addEventListener('mousedown', onMouseDownBubble);
    window.addEventListener('pointerdown', onPressStart);
    window.addEventListener('pointermove', onPressMove);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointercancel', onPressCancel);

    return () => {
        window.clearInterval(clickWatch);
        window.clearTimeout(blurTimer);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('focus', onWindowFocus);
        window.removeEventListener('pointerdown', onPointerDownCapture, true);
        window.removeEventListener('pointerdown', onPointerDownBubble);
        window.removeEventListener('mousedown', onMouseDownBubble);
        window.removeEventListener('pointerdown', onPressStart);
        window.removeEventListener('pointermove', onPressMove);
        window.removeEventListener('click', onClickCapture, true);
        window.removeEventListener('pointercancel', onPressCancel);
        delete window.__truelazerInputDiagnostics;
        delete window.__truelazerInput;
    };
}

export default installInputDiagnostics;
