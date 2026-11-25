import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import MasterSettingsPanel from './MasterSettingsPanel';
import { MidiProvider } from '../contexts/MidiContext';

const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(MidiProvider, null, React.createElement(MasterSettingsPanel, props))
  );

describe('MasterSettingsPanel', () => {
  it('renders the master effects drop area', () => {
    const html = render();
    expect(html).toContain('Master Effects');
    expect(html).toContain('Drag Effects Here');
  });

  it('renders assigned master effects', () => {
    const effect = {
      id: 'rotate',
      name: 'Rotate',
      instanceId: 'master-rotate-1',
      defaultParams: { angle: 0, speed: 0, direction: 'CW' },
      params: { angle: 0, speed: 0, direction: 'CW' },
      paramControls: [
        { id: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1 },
      ],
    };
    const html = render({ masterEffects: [effect], uiState: {}, bpm: 120 });
    expect(html).not.toContain('Drag Effects Here');
    expect(html).toContain('rotate');
  });
});
