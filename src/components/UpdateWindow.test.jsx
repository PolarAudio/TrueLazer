import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import UpdateWindow from './UpdateWindow';

describe('UpdateWindow', () => {
    const render = (props = {}) => renderToStaticMarkup(React.createElement(UpdateWindow, {
        state: { phase: 'checking' },
        onClose: () => {},
        onInstallNow: () => {},
        onInstallNextLaunch: () => {},
        onSkip: () => {},
        ...props,
    }));

    it('renders nothing without a state', () => {
        expect(render({ state: null })).toBe('');
    });

    it('renders nothing when the updater is idle', () => {
        expect(render({ state: { phase: 'idle' } })).toBe('');
    });

    it('shows the checking state', () => {
        const html = render();
        expect(html).toContain('Checking for updates');
    });

    it('names the version that is available', () => {
        const html = render({ state: { phase: 'available', version: '0.3.0' } });
        expect(html).toContain('0.3.0');
    });

    it('offers the install choices once the download is ready', () => {
        const html = render({ state: { phase: 'downloaded', version: '0.3.0' } });
        expect(html).toContain('Restart and install');
        expect(html).toContain('Install on next launch');
        expect(html).toContain('Skip this version');
    });

    it('does not offer the install choices while it is still downloading', () => {
        const html = render({ state: { phase: 'downloading', percent: 40 } });
        expect(html).toContain('40%');
        expect(html).not.toContain('Restart and install');
    });

    it('shows the error when the check failed', () => {
        const html = render({ state: { phase: 'error', error: 'No published versions' } });
        expect(html).toContain('Could not check for updates');
        expect(html).toContain('No published versions');
    });

    it('confirms that the app is up to date', () => {
        const html = render({ state: { phase: 'up-to-date', version: '0.2.0' } });
        expect(html).toContain('up to date');
        expect(html).toContain('0.2.0');
    });
});
