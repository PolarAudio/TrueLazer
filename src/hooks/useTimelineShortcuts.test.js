import { describe, it, expect } from 'vitest';
import { pickPasteChannel } from './useTimelineShortcuts';

const channels = {
    ch1: { id: 'ch1', name: 'A' },
    ch2: { id: 'ch2', name: 'B' },
    ch3: { id: 'ch3', name: 'C' },
};

describe('pickPasteChannel', () => {
    it('prefers the currently selected track over the clip origin', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], 'ch2', { channelId: 'ch1' })).toBe('ch2');
    });

    it('falls back to the clip origin when nothing is selected', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], null, { channelId: 'ch3' })).toBe('ch3');
    });

    it('falls back to the first track when the origin is gone', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], null, { channelId: 'gone' })).toBe('ch1');
    });

    it('returns null when there are no tracks', () => {
        expect(pickPasteChannel({}, [], 'ch1', { channelId: 'gone' })).toBeNull();
    });

    it('ignores a selected id that does not exist', () => {
        expect(pickPasteChannel(channels, ['ch1'], 'ghost', { channelId: null })).toBe('ch1');
    });
});