import { describe, it, expect } from 'vitest';
import { translate } from './translate';
import { TRANSLATIONS, LOCALES, DEFAULT_LOCALE } from './translations';

describe('translate', () => {
    it('returns the English string for a known key', () => {
        expect(translate('en', 'fileBrowser.openFolder')).toBe('Open Folder');
    });

    it('falls back to English when a locale is missing or incomplete', () => {
        expect(translate('xx', 'fileBrowser.openFolder')).toBe('Open Folder');
        expect(translate('de', 'fileBrowser.openFolder')).toBe('Open Folder');
    });

    it('falls back to the key when no translation exists', () => {
        expect(translate('en', 'missing.key')).toBe('missing.key');
    });

    it('interpolates parameters', () => {
        expect(translate('en', 'greeting', { name: 'Kevin' })).toBe('greeting');
        // Add a temporary entry so the interpolation path is exercised without
        // shipping a fake key in the real table.
        TRANSLATIONS.en['test.greeting'] = 'Hello {name}, {count} clips';
        try {
            expect(translate('en', 'test.greeting', { name: 'Kevin', count: 3 }))
                .toBe('Hello Kevin, 3 clips');
            expect(translate('en', 'test.greeting', { name: 'Kevin' }))
                .toBe('Hello Kevin, {count} clips');
        } finally {
            delete TRANSLATIONS.en['test.greeting'];
        }
    });

    it('handles empty or invalid keys safely', () => {
        expect(translate('en', '')).toBe('');
        expect(translate('en', null)).toBe('');
    });

    it('ships a default locale and at least one locale descriptor', () => {
        expect(TRANSLATIONS[DEFAULT_LOCALE]).toBeDefined();
        expect(LOCALES.some((entry) => entry.id === DEFAULT_LOCALE)).toBe(true);
    });
});
