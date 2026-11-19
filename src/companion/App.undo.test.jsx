// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./client.js', async (importOriginal) => {
    const orig = await importOriginal();
    const fetchOutputs = vi.fn();
    const patchOutput = vi.fn();
    const lockOutput = vi.fn();
    return { ...orig, fetchOutputs, patchOutput, lockOutput };
});

import App from './App.jsx';
import { fetchOutputs, patchOutput, lockOutput } from './client.js';

const KEY = '10.0.0.1:0';
let rev = 1;
const baseSettings = {
    name: 'Out',
    safetyZones: [],
    outputArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
};

const firePointer = (el, type, x, y) =>
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

const buttonsByText = (host, text) =>
    [...host.querySelectorAll('button')].filter((b) => (b.textContent || '').includes(text));

const undoButton = (host) =>
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Undo');

describe('Laser Zone Tool undo (temp)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        rev = 1;
        sessionStorage.setItem('companion-pin', '123456');

        fetchOutputs.mockReset();
        fetchOutputs.mockImplementation(async () => ({
            outputs: [{ key: KEY, revision: rev, settings: { ...baseSettings, safetyZones: [] } }],
        }));
        patchOutput.mockReset();
        patchOutput.mockImplementation(async (pin, cid, key, patch) => ({
            revision: ++rev,
            settings: {
                ...baseSettings,
                safetyZones: Array.isArray(patch?.safetyZones) ? patch.safetyZones : [],
                outputArea: patch?.outputArea ?? baseSettings.outputArea,
            },
        }));
        lockOutput.mockReset();
        lockOutput.mockImplementation(async (pin, cid, key, action) => ({ locks: { [key]: { clientId: cid, owner: cid } } }));

        // EventSource stub: keep instances so the test can fire 'connected'.
        global.__esInstances = [];
        global.EventSource = class {
            constructor(url) { this.url = url; this.listeners = {}; global.__esInstances.push(this); }
            addEventListener(n, f) { this.listeners[n] = f; }
            removeEventListener() {}
            close() {}
        };

        window.HTMLCanvasElement.prototype.getContext = () => new Proxy({ canvas: { width: 600, height: 600 } }, {
            get(t, p) {
                if (p in t) return t[p];
                return () => {};
            },
        });
        window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
            left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0,
        });
    });

    afterEach(() => { document.body.innerHTML = ''; });

    async function renderAndConnect() {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        act(() => { root.render(<App />); });
        await act(async () => {}); // flush initial fetch + EventSource
        const es = global.__esInstances[0];
        await act(async () => { es.listeners['connected']({ data: JSON.stringify({ locks: {} }) }); });
        return host;
    }

    it('undoes an added zone (toolbar button)', async () => {
        const host = await renderAndConnect();
        act(() => { buttonsByText(host, '＋ Zone')[0].click(); });
        await act(async () => {});
        expect(host.textContent).toContain('1 zone(s)');

        const undo = undoButton(host);
        expect(undo.disabled).toBe(false);
        act(() => { undo.click(); });
        expect(host.textContent).toContain('0 zone(s)');
    });

    it('undoes a canvas drag of the zone', async () => {
        const host = await renderAndConnect();
        act(() => { buttonsByText(host, '＋ Zone')[0].click(); });
        await act(async () => {});
        const canvas = host.querySelector('canvas');

        act(() => { firePointer(canvas, 'pointerdown', 300, 300); });
        await act(async () => {});
        act(() => { firePointer(canvas, 'pointermove', 360, 300); });
        await act(async () => {});
        act(() => { firePointer(canvas, 'pointerup', 360, 300); });
        await act(async () => {});

        expect(patchOutput.mock.calls.length).toBeGreaterThan(0);
        const lastSend = patchOutput.mock.calls[patchOutput.mock.calls.length - 1];
        const movedX = lastSend[3].safetyZones[0].x;
        expect(movedX).toBeGreaterThan(0.4);

        const undo = undoButton(host);
        expect(undo && undo.disabled).toBe(false);
        act(() => { undo.click(); });
        const lastSendAfterUndo = patchOutput.mock.calls[patchOutput.mock.calls.length - 1];
        expect(lastSendAfterUndo[3].safetyZones[0].x).toBeCloseTo(0.4, 5);
    });

    it('undoes a nudge', async () => {
        const host = await renderAndConnect();
        act(() => { buttonsByText(host, '＋ Zone')[0].click(); });
        await act(async () => {});
        const nudgeDown = buttonsByText(host, '▼')[0];
        act(() => { nudgeDown.click(); });
        await act(async () => {});
        const lastSend = patchOutput.mock.calls[patchOutput.mock.calls.length - 1];
        expect(lastSend[3].safetyZones[0].y).toBeCloseTo(0.41, 5);

        const undo = undoButton(host);
        act(() => { undo.click(); });
        const lastSendAfterUndo = patchOutput.mock.calls[patchOutput.mock.calls.length - 1];
        expect(lastSendAfterUndo[3].safetyZones[0].y).toBeCloseTo(0.4, 5);
    });
});
