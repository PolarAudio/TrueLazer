import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { FileHoverPreview } from '../components/FileBrowser';

afterEach(() => { delete global.window; });

describe('FileHoverPreview', () => {
  it('playback when picture preview active', () => {
    const frame = { points: [], isTypedArray: false };
    const html = renderToStaticMarkup(React.createElement(FileHoverPreview, { preview: { filePath: 'a.ild', fileName: 'a.ild', x: 0, y: 0 }, data: frame, isLoading: false, noPreviewLabel: 'no', picturePreviewActive: true }));
    console.log('PLAYBACK HTML:', html);
    expect(html).toContain('clip-thumbnail');
  });
  it('static when not', () => {
    const frame = { points: [], isTypedArray: false };
    const html = renderToStaticMarkup(React.createElement(FileHoverPreview, { preview: { filePath: 'a.ild', fileName: 'a.ild', x: 0, y: 0 }, data: frame, isLoading: false, noPreviewLabel: 'no', picturePreviewActive: false }));
    console.log('STATIC HTML:', html);
    expect(html).not.toContain('clip-thumbnail');
  });
});