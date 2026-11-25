// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider, useKeyboard } from './KeyboardContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let keyboardApi;
let container;
let root;

const Harness = () => {
    keyboardApi = useKeyboard();
    return null;
};

const renderProvider = (onCommand) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                KeyboardProvider,
                { onCommand, enabled: true },
                React.createElement(Harness)
            )
        );
    });
};

const pressKey = (type, init = {}) => {
    act(() => {
        window.dispatchEvent(new KeyboardEvent(type, {
            bubbles: true,
            code: 'KeyA',
            key: 'a',
            ...init,
        }));
    });
};

describe('KeyboardProvider momentary keys', () => {
    beforeEach(() => {
        keyboardApi = null;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    it('ignores auto-repeat keydown events until the key is released', () => {
        const onCommand = vi.fn();
        renderProvider(onCommand);

        act(() => {
            keyboardApi.setMappings({
                quick_btn_0: { key: 'KeyA', code: 'KeyA', keyValue: 'a', label: 'A' },
            });
        });

        pressKey('keydown');
        pressKey('keydown', { repeat: true });
        pressKey('keydown');
        pressKey('keyup');
        pressKey('keydown');
        pressKey('keyup');

        expect(onCommand).toHaveBeenCalledTimes(4);
        expect(onCommand.mock.calls.map(([, , , type]) => type)).toEqual([
            'keydown',
            'keyup',
            'keydown',
            'keyup',
        ]);
    });
});
