import { describe, it, expect } from 'vitest';
import {
    UPDATE_CHECK_INTERVAL_MS,
    compareVersions,
    shouldAutoCheck,
    shouldOfferVersion,
} from './updatePolicy';

describe('compareVersions', () => {
    it('orders dotted versions numerically, not as text', () => {
        expect(compareVersions('0.2.0', '0.1.11')).toBeGreaterThan(0);
        expect(compareVersions('0.1.9', '0.1.11')).toBeLessThan(0);
        expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    });

    it('treats a missing part as zero', () => {
        expect(compareVersions('0.2', '0.2.0')).toBe(0);
        expect(compareVersions('0.2.1', '0.2')).toBeGreaterThan(0);
    });

    it('survives nonsense', () => {
        expect(compareVersions('', '')).toBe(0);
        expect(compareVersions(undefined, '0.1.0')).toBeLessThan(0);
    });
});

describe('shouldAutoCheck', () => {
    const now = 1_700_000_000_000;

    it('checks when the user has never been checked', () => {
        expect(shouldAutoCheck({ autoCheck: true, lastCheckAt: 0 }, now)).toBe(true);
    });

    it('does not check again straight away', () => {
        expect(shouldAutoCheck({ autoCheck: true, lastCheckAt: now - 1000 }, now)).toBe(false);
    });

    it('checks again once the interval has passed', () => {
        expect(shouldAutoCheck({ autoCheck: true, lastCheckAt: now - UPDATE_CHECK_INTERVAL_MS - 1 }, now)).toBe(true);
    });

    it('never checks on its own when the user turned it off', () => {
        expect(shouldAutoCheck({ autoCheck: false, lastCheckAt: 0 }, now)).toBe(false);
    });
});

describe('shouldOfferVersion', () => {
    it('offers a newer version', () => {
        expect(shouldOfferVersion({ version: '0.2.0', currentVersion: '0.1.11' })).toBe(true);
    });

    it('does not offer the version that is already running', () => {
        expect(shouldOfferVersion({ version: '0.1.11', currentVersion: '0.1.11' })).toBe(false);
        expect(shouldOfferVersion({ version: '0.1.10', currentVersion: '0.1.11' })).toBe(false);
    });

    it('keeps a skipped version skipped', () => {
        expect(shouldOfferVersion({ version: '0.2.0', currentVersion: '0.1.11', skippedVersion: '0.2.0' })).toBe(false);
    });

    it('offers a newer version after an older one was skipped', () => {
        expect(shouldOfferVersion({ version: '0.2.1', currentVersion: '0.1.11', skippedVersion: '0.2.0' })).toBe(true);
    });

    it('offers nothing when there is no version', () => {
        expect(shouldOfferVersion({ version: '', currentVersion: '0.1.11' })).toBe(false);
    });
});
