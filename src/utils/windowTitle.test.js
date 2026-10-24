import { describe, it, expect } from 'vitest';
import { buildWindowTitle, projectDisplayName } from './windowTitle';

describe('projectDisplayName', () => {
    it('strips the extension from Windows and POSIX paths', () => {
        expect(projectDisplayName('C:\\Shows\\Festival.tlp')).toBe('Festival');
        expect(projectDisplayName('/home/op/shows/Festival.tlp')).toBe('Festival');
        expect(projectDisplayName('C:/Shows/Festival.tlp')).toBe('Festival');
    });

    it('handles names with dots, paths with no extension, and empty values', () => {
        expect(projectDisplayName('C:\\Shows\\my.show.v2.tlp')).toBe('my.show.v2');
        expect(projectDisplayName('C:\\Shows\\untitled')).toBe('untitled');
        expect(projectDisplayName('')).toBe('');
        expect(projectDisplayName(null)).toBe('');
    });
});

describe('buildWindowTitle', () => {
    it('identifies the Show Control page and the open show project', () => {
        expect(buildWindowTitle({ page: 'main', filePath: 'C:\\Shows\\Arena.tlp' }))
            .toBe('TrueLazer - Show Control - Arena');
    });

    it('identifies the Timeline page and the open timeline project', () => {
        expect(buildWindowTitle({ page: 'timeline', filePath: 'C:\\Shows\\Arena.timeline.json' }))
            .toBe('TrueLazer - Timeline Editor - Arena.timeline');
    });

    it('identifies the Shape Builder page and the open shape project', () => {
        expect(buildWindowTitle({ page: 'shapeBuilder', filePath: 'C:\\Shapes\\Logo.tls' }))
            .toBe('TrueLazer - Shape Builder - Logo');
    });

    it('uses page-specific New Project labels when nothing is saved yet', () => {
        expect(buildWindowTitle({ page: 'main' })).toBe('TrueLazer - Show Control - New Show Project');
        expect(buildWindowTitle({ page: 'timeline' })).toBe('TrueLazer - Timeline Editor - New Timeline Project');
        expect(buildWindowTitle({ page: 'shapeBuilder' })).toBe('TrueLazer - Shape Builder - New Shape Project');
    });

    it('falls back to Show Control for an unknown page', () => {
        expect(buildWindowTitle({ page: 'nonsense' })).toBe('TrueLazer - Show Control - New Show Project');
    });
});
