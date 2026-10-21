import { describe, it, expect } from 'vitest';
import { redactPrivateInfo } from './redact';

/**
 * Diagnostics end up in a PUBLIC GitHub issue, so the redaction rules are
 * part of the app's privacy promise, not a formatting detail.
 */
describe('redactPrivateInfo', () => {
    it('replaces the home directory in a path', () => {
        const out = redactPrivateInfo('Saved to C:\\Users\\Kevin\\Documents\\show.tlp', 'C:\\Users\\Kevin');
        expect(out).toBe('Saved to <user>\\Documents\\show.tlp');
        expect(out).not.toContain('Kevin');
    });

    it('replaces the account name in a Windows path even without a known home', () => {
        const out = redactPrivateInfo('C:\\Users\\Kevin\\AppData\\Roaming\\TrueLazer');
        expect(out).toBe('C:\\Users\\<user>\\AppData\\Roaming\\TrueLazer');
        expect(out).not.toContain('Kevin');
    });

    it('replaces the account name in a POSIX home path', () => {
        const out = redactPrivateInfo('/home/kevin/.config/TrueLazer/logs/main.log');
        expect(out).toBe('/home/<user>/.config/TrueLazer/logs/main.log');
        expect(out).not.toContain('kevin');
    });

    it('replaces e-mail addresses', () => {
        const out = redactPrivateInfo('reply to kevin.bahr@example.com please');
        expect(out).toBe('reply to <email> please');
        expect(out).not.toContain('kevin.bahr');
    });

    it('replaces MAC addresses', () => {
        const out = redactPrivateInfo('hw_id 02:00:00:48:00:2e');
        expect(out).toBe('hw_id <mac>');
    });

    it('keeps IP addresses, because DAC troubleshooting needs them', () => {
        const out = redactPrivateInfo('Showbridge @ 192.168.1.50');
        expect(out).toBe('Showbridge @ 192.168.1.50');
    });

    it('keeps the parts of a path that are not personal', () => {
        const out = redactPrivateInfo('C:\\Users\\Kevin\\Documents\\TrueLazer\\ILDA-FILES', 'C:\\Users\\Kevin');
        expect(out).toContain('Documents');
        expect(out).toContain('ILDA-FILES');
    });

    it('handles empty and missing values', () => {
        expect(redactPrivateInfo('')).toBe('');
        expect(redactPrivateInfo(null)).toBe('');
        expect(redactPrivateInfo(undefined)).toBe('');
    });

    it('redacts a whole log tail in one pass', () => {
        const tail = [
            '[2026-01-01T00:00:00.000Z] [ERROR] Failed to open C:\\Users\\Kevin\\show.tlp',
            '[2026-01-01T00:00:00.000Z] [ERROR] contact kevin@example.com mac 02:00:00:48:00:2e',
            '[2026-01-01T00:00:00.000Z] [LOG] dac 192.168.1.50 ready',
        ].join('\n');
        const out = redactPrivateInfo(tail, 'C:\\Users\\Kevin');
        expect(out).not.toContain('Kevin');
        expect(out).not.toContain('kevin@example.com');
        expect(out).not.toContain('02:00:00:48:00:2e');
        expect(out).toContain('192.168.1.50');
        expect(out).toContain('dac 192.168.1.50 ready');
    });
});
