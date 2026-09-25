import { describe, it, expect } from 'vitest';
import { resolveMidiSyncDevice } from './useTimelineSync';

const INPUTS = [
    { id: 'gs', name: 'Microsoft GS Wavetable Synth' },
    { id: 'apc', name: 'AKAI APC40 MkII' },
    { id: 'livid', name: 'Livid LC24' },
];

describe('resolveMidiSyncDevice', () => {
    it('uses an explicitly chosen device when it is available', () => {
        expect(resolveMidiSyncDevice('apc', INPUTS, '')).toBe('apc');
    });

    it('prefers the Microsoft GS Wavetable Synth when nothing is chosen', () => {
        expect(resolveMidiSyncDevice('', INPUTS, 'apc')).toBe('gs');
    });

    it('falls back to the globally selected MIDI input', () => {
        const inputs = [INPUTS[1], INPUTS[2]];
        expect(resolveMidiSyncDevice('', inputs, 'livid')).toBe('livid');
    });

    it('falls back to the first input when nothing else matches', () => {
        expect(resolveMidiSyncDevice('', [{ id: 'apc', name: 'AKAI APC40 MkII' }], '')).toBe('apc');
    });

    it('ignores an explicit device id that is not connected', () => {
        expect(resolveMidiSyncDevice('gone', INPUTS, 'livid')).toBe('gs');
    });

    it('returns null with no devices', () => {
        expect(resolveMidiSyncDevice('', [], '')).toBeNull();
    });
});