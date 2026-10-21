import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import AboutWindow from './aboutWindow';

/**
 * The About dialog is opened from the application menu on EVERY page, so it has
 * to survive being rendered before its async app-info lookup has resolved.
 * `renderToStaticMarkup` does not run effects, which is exactly that state:
 * `info === null`.
 *
 * This is the same "read a property before the null guard" shape that broke the
 * Clip Settings panel before.
 */
describe('AboutWindow', () => {
    afterEach(() => {
        delete global.window;
    });

    const render = (show = true) =>
        renderToStaticMarkup(React.createElement(AboutWindow, { show, onClose: () => {} }));

    it('renders nothing when hidden', () => {
        expect(render(false)).toBe('');
    });

    it('renders before app info has loaded, without crashing', () => {
        const html = render(true);
        expect(html).toContain('About');
        // Falls back rather than rendering undefined/empty fields as blanks.
        expect(html).toContain('TrueLazer');
    });

    it('documents every project format and DAC backend', () => {
        const html = render(true);
        for (const ext of ['.tlp', '.json', '.tls']) {
            expect(html, `missing format ${ext}`).toContain(ext);
        }
        for (const label of ['Show Control', 'Timeline Editor', 'Shape Builder']) {
            expect(html, `missing page ${label}`).toContain(label);
        }
        for (const backend of ['Showbridge', 'EtherDream', 'IDN']) {
            expect(html, `missing backend ${backend}`).toContain(backend);
        }
    });

    it('labels every section it presents', () => {
        const html = render(true);
        for (const section of ['Application', 'Runtime', 'Project Formats', 'DAC Backends', 'Locations', 'Project']) {
            expect(html, `missing section ${section}`).toContain(section);
        }
    });

    it('points at the project page and the report window', () => {
        const html = render(true);
        expect(html).toContain('https://github.com/PolarAudio/TrueLazer');
        expect(html).toContain('Report a Bug');
    });

    it('shows a placeholder rather than undefined when info is unavailable', () => {
        const html = render(true);
        expect(html).not.toContain('undefined');
        expect(html).toContain('—');
    });
});