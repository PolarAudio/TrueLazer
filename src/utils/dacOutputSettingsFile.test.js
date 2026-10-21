import { describe, it, expect } from 'vitest';
import {
    OUTPUT_SETTINGS_FORMAT,
    OUTPUT_SETTINGS_VERSION,
    buildOutputSettingsFile,
    parseOutputSettingsFile,
    matchOutputs,
    describeOutputKey,
} from './dacOutputSettingsFile';

const sample = {
    '10.0.0.5:1': { name: 'Front Curtain', dimmer: 0.8 },
    '10.0.0.6:2': { safetyZones: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
};

describe('buildOutputSettingsFile', () => {
    it('wraps the map in a versioned envelope', () => {
        const f = buildOutputSettingsFile(sample, { exportedAt: '2026-01-01T00:00:00.000Z' });
        expect(f.format).toBe(OUTPUT_SETTINGS_FORMAT);
        expect(f.version).toBe(OUTPUT_SETTINGS_VERSION);
        expect(f.exportedAt).toBe('2026-01-01T00:00:00.000Z');
        expect(f.outputs).toEqual(sample);
    });

    it('stamps an export time by default', () => {
        expect(buildOutputSettingsFile(sample).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('tolerates no settings at all', () => {
        const f = buildOutputSettingsFile(undefined);
        expect(f.outputs).toEqual({});
        expect(buildOutputSettingsFile(null).outputs).toEqual({});
    });

    it('drops entries that are not objects', () => {
        const f = buildOutputSettingsFile({ a: null, b: 'oops', '10.0.0.5:1': { dimmer: 1 } });
        expect(Object.keys(f.outputs)).toEqual(['10.0.0.5:1']);
    });

    it('round-trips through the parser', () => {
        const parsed = parseOutputSettingsFile(buildOutputSettingsFile(sample));
        expect(parsed.ok).toBe(true);
        expect(parsed.outputs).toEqual(sample);
    });
});

describe('parseOutputSettingsFile', () => {
    it('rejects empty and non-object input', () => {
        for (const bad of [null, undefined, 'nope', 42]) {
            expect(parseOutputSettingsFile(bad).ok, String(bad)).toBe(false);
        }
    });

    it('rejects a different format', () => {
        const r = parseOutputSettingsFile({ format: 'truelazer-shape', outputs: { a: {} } });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('Not a TrueLazer output settings file');
    });

    it('rejects an envelope with no outputs section', () => {
        expect(parseOutputSettingsFile({ format: OUTPUT_SETTINGS_FORMAT }).ok).toBe(false);
    });

    it('rejects an empty outputs map', () => {
        expect(parseOutputSettingsFile({ format: OUTPUT_SETTINGS_FORMAT, outputs: {} }).ok).toBe(false);
    });

    it('accepts a bare settings map, with a warning', () => {
        const r = parseOutputSettingsFile(sample);
        expect(r.ok).toBe(true);
        expect(r.outputs).toEqual(sample);
        expect(r.warning).toBeTruthy();
    });

    it('warns but still loads a newer version', () => {
        const r = parseOutputSettingsFile({ format: OUTPUT_SETTINGS_FORMAT, version: 99, outputs: sample });
        expect(r.ok).toBe(true);
        expect(r.outputs).toEqual(sample);
        expect(r.warning).toContain('99');
    });
});

describe('matchOutputs', () => {
    const detected = ['10.0.0.5:1', '10.0.0.6:2'];

    it('applies entries whose address is detected', () => {
        const { matched, unmatched } = matchOutputs(sample, detected);
        expect(Object.keys(matched).sort()).toEqual(['10.0.0.5:1', '10.0.0.6:2']);
        expect(unmatched).toEqual([]);
    });

    it('reports entries with no detected output instead of silently dropping them', () => {
        // The cross-machine case: a file written where the DACs had other IPs.
        const { matched, unmatched } = matchOutputs(
            { '192.168.1.50:1': { dimmer: 0.5 }, '10.0.0.5:1': { dimmer: 1 } },
            detected
        );
        expect(Object.keys(matched)).toEqual(['10.0.0.5:1']);
        expect(unmatched).toEqual(['192.168.1.50:1']);
    });

    it('MERGES - a detected output absent from the file is not returned', () => {
        const { matched } = matchOutputs({ '10.0.0.5:1': { dimmer: 1 } }, detected);
        expect(Object.keys(matched)).toEqual(['10.0.0.5:1']);
        expect(matched['10.0.0.6:2']).toBeUndefined();
    });

    it('applies nothing when nothing is detected', () => {
        const { matched, unmatched } = matchOutputs(sample, []);
        expect(matched).toEqual({});
        expect(unmatched).toHaveLength(2);
    });

    it('ignores non-object entries', () => {
        const { matched, unmatched } = matchOutputs({ '10.0.0.5:1': null, '10.0.0.6:2': 'x' }, detected);
        expect(matched).toEqual({});
        expect(unmatched).toEqual([]);
    });

    it('is safe with no detected list supplied', () => {
        expect(matchOutputs(sample).matched).toEqual({});
        expect(matchOutputs(sample, null).unmatched).toHaveLength(2);
        expect(matchOutputs(null, detected).matched).toEqual({});
    });
});

describe('describeOutputKey', () => {
    it('splits the address from the channel', () => {
        expect(describeOutputKey('10.0.0.5:1')).toBe('10.0.0.5 channel 1');
    });

    it('uses the LAST colon, so IPv6-ish values still read correctly', () => {
        expect(describeOutputKey('fd00::5:2')).toBe('fd00::5 channel 2');
    });

    it('returns the key unchanged when there is no colon', () => {
        expect(describeOutputKey('weird')).toBe('weird');
    });
});