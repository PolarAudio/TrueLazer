import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcRenderer, exposeInMainWorld } = vi.hoisted(() => ({
    ipcRenderer: {
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn(),
        invoke: vi.fn(),
    },
    exposeInMainWorld: vi.fn(),
}));

vi.mock('electron', () => ({
    ipcRenderer,
    contextBridge: { exposeInMainWorld },
}));

let api;

beforeAll(async () => {
    vi.resetModules();
    exposeInMainWorld.mockClear();
    await import('./preload');
    api = exposeInMainWorld.mock.calls.at(-1)[1];
});

beforeEach(() => {
    ipcRenderer.on.mockClear();
    ipcRenderer.removeListener.mockClear();
});

describe('preload IPC subscriptions', () => {
    it('removes the exact context-menu wrapper it registered', () => {
        const callback = vi.fn();
        const unsubscribe = api.onContextMenuActionFromMain(callback);

        const registered = ipcRenderer.on.mock.calls.find(
            ([channel]) => channel === 'context-menu-action-from-main'
        )[1];
        expect(registered).not.toBe(callback);

        const action = { type: 'toggle-quick-assign-momentary', index: 3 };
        registered({}, action);
        expect(callback).toHaveBeenCalledWith(action);

        unsubscribe();
        expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
            'context-menu-action-from-main',
            registered
        );
    });

    it('removes the exact thumbnail-mode wrapper it registered', () => {
        const callback = vi.fn();
        const unsubscribe = api.onUpdateThumbnailRenderMode(callback);

        const registered = ipcRenderer.on.mock.calls.find(
            ([channel]) => channel === 'update-thumbnail-render-mode'
        )[1];
        expect(registered).not.toBe(callback);

        registered({}, 'wireframe');
        expect(callback).toHaveBeenCalledWith('wireframe');

        unsubscribe();
        expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
            'update-thumbnail-render-mode',
            registered
        );
    });
});
