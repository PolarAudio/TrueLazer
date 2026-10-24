import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import UserManual from './UserManual';

describe('UserManual', () => {
    const render = (show = true) =>
        renderToStaticMarkup(React.createElement(UserManual, { show, onClose: () => {} }));

    it('renders nothing when hidden', () => {
        expect(render(false)).toBe('');
    });

    it('renders the manual with its major sections', () => {
        const html = render(true);
        for (const heading of ['Getting started', 'Show Control', 'Timeline Editor', 'Shape Builder']) {
            expect(html, `missing heading ${heading}`).toContain(heading);
        }
    });

    it('documents the blanking position control', () => {
        const html = render(true);
        expect(html).toContain('Blanking');
        expect(html).toContain('Position');
    });
});
