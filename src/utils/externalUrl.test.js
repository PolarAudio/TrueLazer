import { describe, it, expect } from 'vitest';
import { EXTERNAL_URL_ALLOWLIST, isAllowedExternalUrl } from './externalUrl';

/**
 * The app can open a URL in the user's browser. That is a small capability, but
 * it is one that renderer content can ask for, so the set of hosts that may be
 * opened is a security control and is tested like one.
 */
describe('isAllowedExternalUrl', () => {
    it('allows the GitHub hosts the report window links to', () => {
        expect(isAllowedExternalUrl('https://github.com/PolarAudio/TrueLazer/issues/new')).toBe(true);
        expect(isAllowedExternalUrl('https://www.github.com/')).toBe(true);
        expect(isAllowedExternalUrl('https://polaraudio.github.io/TrueLazerDemo/')).toBe(true);
    });

    it('rejects other hosts', () => {
        expect(isAllowedExternalUrl('https://example.com/')).toBe(false);
        expect(isAllowedExternalUrl('https://github.com.evil.test/')).toBe(false);
        expect(isAllowedExternalUrl('https://notgithub.com/')).toBe(false);
    });

    it('rejects anything that is not https', () => {
        expect(isAllowedExternalUrl('http://github.com/')).toBe(false);
        expect(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
        expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedExternalUrl('mailto:someone@example.com')).toBe(false);
    });

    it('rejects values that are not URLs at all', () => {
        expect(isAllowedExternalUrl('')).toBe(false);
        expect(isAllowedExternalUrl(null)).toBe(false);
        expect(isAllowedExternalUrl(undefined)).toBe(false);
        expect(isAllowedExternalUrl('github.com')).toBe(false);
    });

    it('is not fooled by a case difference in the host', () => {
        expect(isAllowedExternalUrl('https://GitHub.com/')).toBe(true);
    });

    it('keeps the allowlist small and explicit', () => {
        expect(EXTERNAL_URL_ALLOWLIST.has('github.com')).toBe(true);
        expect(EXTERNAL_URL_ALLOWLIST.has('google.com')).toBe(false);
    });
});
