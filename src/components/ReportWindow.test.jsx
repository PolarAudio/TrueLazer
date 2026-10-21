import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ReportWindow from './ReportWindow';

/**
 * The Report window is opened from the application menu on EVERY page, and it
 * has to survive being rendered before its async diagnostics lookup has
 * resolved. `renderToStaticMarkup` does not run effects, which is exactly
 * that state: no diagnostics, no GPU string.
 */
describe('ReportWindow', () => {
    afterEach(() => {
        delete global.window;
    });

    const render = (props = {}) =>
        renderToStaticMarkup(React.createElement(ReportWindow, { show: true, onClose: () => {}, ...props }));

    it('renders nothing when hidden', () => {
        expect(renderToStaticMarkup(React.createElement(ReportWindow, { show: false, onClose: () => {} }))).toBe('');
    });

    it('offers both kinds of report', () => {
        const html = render();
        expect(html).toContain('Report a bug');
        expect(html).toContain('Request a feature');
    });

    it('asks for the details a bug report needs', () => {
        const html = render({ mode: 'bug' });
        for (const label of ['Summary', 'Severity', 'Area', 'What happened', 'What did you expect instead?', 'Steps to reproduce']) {
            expect(html, `missing field ${label}`).toContain(label);
        }
    });

    it('asks for the details a feature request needs', () => {
        const html = render({ mode: 'feature' });
        for (const label of ['The problem you are trying to solve', 'Proposed solution', 'Why it matters']) {
            expect(html, `missing field ${label}`).toContain(label);
        }
    });

    it('makes the privacy of the collected details visible', () => {
        const html = render();
        expect(html).toContain('Redact personal paths');
        expect(html).toContain('public GitHub issue tracker');
    });

    it('offers the actions that submit or preserve a report', () => {
        const html = render();
        expect(html).toContain('Open GitHub issue');
        expect(html).toContain('Copy report');
        expect(html).toContain('Open logs folder');
    });

    it('does not render undefined while the diagnostics are still loading', () => {
        const html = render();
        expect(html).not.toContain('undefined');
    });
});
