import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import OutputSettingsWindow, { DEFAULT_OUTPUT_SETTINGS } from './OutputSettingsWindow';

describe('OutputSettingsWindow', () => {
    const mockDacs = [
        {
            ip: '192.168.1.50',
            hostName: 'Projector Left',
            unitID: 'IDN-01',
            channels: [
                { serviceID: 0, name: 'Main Beam' },
                { serviceID: 1, name: 'Scanner 2' }
            ]
        },
        {
            ip: '192.168.1.51',
            hostName: 'Projector Right',
            unitID: 'IDN-02'
        }
    ];

    it('renders nothing when hidden', () => {
        const html = renderToStaticMarkup(
            React.createElement(OutputSettingsWindow, {
                show: false,
                onClose: () => {},
                dacs: mockDacs,
                dacSettings: {}
            })
        );
        expect(html).toBe('');
    });

    it('renders without throwing when dacSettings is empty', () => {
        const html = renderToStaticMarkup(
            React.createElement(OutputSettingsWindow, {
                show: true,
                onClose: () => {},
                dacs: mockDacs,
                dacSettings: {},
                initialOutputId: '192.168.1.50:0'
            })
        );
        expect(html).toContain('Output Settings');
        expect(html).toContain('Available Outputs');
        expect(html).toContain('Projector Left : Main Beam');
        expect(html).toContain('Safety Zones');
    });

    it('renders without throwing when a DAC channel has partial settings without safetyZones', () => {
        // This is the regression test for: Cannot read properties of undefined (reading 'map')
        const partialDacSettings = {
            '192.168.1.50:0': {
                name: 'Custom Channel Name',
                dimmer: 0.8
                // Notice: NO safetyZones property
            },
            '192.168.1.50:1': {
                flipX: true
                // Notice: NO safetyZones property
            }
        };

        const html = renderToStaticMarkup(
            React.createElement(OutputSettingsWindow, {
                show: true,
                onClose: () => {},
                dacs: mockDacs,
                dacSettings: partialDacSettings,
                initialOutputId: '192.168.1.50:0'
            })
        );

        expect(html).toContain('Output Settings');
        expect(html).toContain('Custom Channel Name');
        expect(html).toContain('Safety Zones');
    });

    it('renders existing safety zones correctly when present', () => {
        const dacSettingsWithZones = {
            '192.168.1.50:0': {
                name: 'Main Beam with Zone',
                safetyZones: [
                    { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
                    { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
                ]
            }
        };

        const html = renderToStaticMarkup(
            React.createElement(OutputSettingsWindow, {
                show: true,
                onClose: () => {},
                dacs: mockDacs,
                dacSettings: dacSettingsWithZones,
                initialOutputId: '192.168.1.50:0'
            })
        );

        expect(html).toContain('Zone 1');
        expect(html).toContain('Zone 2');
    });

    it('exports DEFAULT_OUTPUT_SETTINGS with expected array and object structures', () => {
        expect(Array.isArray(DEFAULT_OUTPUT_SETTINGS.safetyZones)).toBe(true);
        expect(DEFAULT_OUTPUT_SETTINGS.safetyZones.length).toBe(0);
        expect(typeof DEFAULT_OUTPUT_SETTINGS.outputArea).toBe('object');
        expect(DEFAULT_OUTPUT_SETTINGS.outputArea.w).toBe(0.8);
    });
});
