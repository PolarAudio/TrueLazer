import { DEFAULT_LOCALE, TRANSLATIONS } from './translations.js';

/**
 * Look up a translation and interpolate `{name}` placeholders.
 *
 * Falls back from the requested locale to English and finally to the key, so a
 * missing entry never renders as blank text.
 */
export function translate(locale, key, params = {}) {
    if (typeof key !== 'string' || key.length === 0) return '';
    const table = TRANSLATIONS[locale] || TRANSLATIONS[DEFAULT_LOCALE] || {};
    const fallback = TRANSLATIONS[DEFAULT_LOCALE] || {};
    const value = table[key] ?? fallback[key] ?? key;
    if (typeof value !== 'string') return String(value);
    return value.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params || {}, name) ? String(params[name]) : match
    ));
}
