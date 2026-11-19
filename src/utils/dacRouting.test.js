import { describe, it, expect } from 'vitest';
import { resolveClipDacs } from './dacRouting';

const ch = (ip, channel, extra = {}) => ({ ip, channel, hostName: ip, ...extra });

describe('resolveClipDacs', () => {
    it('does not route a clip that has no assignment anywhere', () => {
        // Regression: an unassigned clip used to inherit the DAC selected in
        // the DAC panel, which merged every layer's content onto that channel.
        expect(resolveClipDacs([], [])).toEqual([]);
        expect(resolveClipDacs(undefined, undefined)).toEqual([]);
    });

    it('combines layer and clip assignments', () => {
        const result = resolveClipDacs([ch('10.0.0.5', 1)], [ch('10.0.0.6', 2)]);
        expect(result.map((d) => `${d.ip}:${d.channel}`)).toEqual(['10.0.0.5:1', '10.0.0.6:2']);
    });

    it('dedupes the same output assigned to both layer and clip', () => {
        const result = resolveClipDacs(
            [ch('10.0.0.5', 1, { hostName: 'layer-entry' })],
            [ch('10.0.0.5', 1, { hostName: 'clip-entry' })]
        );
        expect(result).toHaveLength(1);
        expect(result[0].hostName).toBe('layer-entry');
    });

    it('keeps channel 0 (a valid service id) instead of skipping it', () => {
        expect(resolveClipDacs([ch('10.0.0.5', 0)], [])).toHaveLength(1);
        expect(resolveClipDacs([ch('10.0.0.5', 0)], [])[0].channel).toBe(0);
    });

    it('resolves a legacy channels[] entry to its first service id', () => {
        const result = resolveClipDacs([{ ip: '10.0.0.5', channels: [{ serviceID: 3 }] }], []);
        expect(result).toHaveLength(1);
        expect(result[0].channel).toBe(3);
    });

    it('skips malformed entries so the render loop cannot throw', () => {
        expect(resolveClipDacs([null, {}, ch('10.0.0.5', 4)], [undefined])).toHaveLength(1);
    });
});
