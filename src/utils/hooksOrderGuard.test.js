import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.join(HERE, '..', 'components');

const HOOK = /\buse(State|Ref|Memo|Effect|Callback|Reducer|ImperativeHandle|Context|LayoutEffect|SyncExternalStore)\s*\(/g;

describe('hooks must not follow an early return', () => {
    it('OutputSettingsWindow.jsx declares no hooks after its early return', () => {
        const src = fs.readFileSync(path.join(COMPONENTS, 'OutputSettingsWindow.jsx'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const guardIdx = src.indexOf('if (!show) return null;');
        expect(guardIdx, 'early return not found').toBeGreaterThan(-1);
        const before = src.slice(0, guardIdx);
        const after = src.slice(guardIdx);
        expect([...before.matchAll(HOOK)].length).toBeGreaterThan(0);
        expect([...after.matchAll(HOOK)].map(m => m[1])).toEqual([]);
    });
});
