import { describe, it, expect, vi } from 'vitest';
import { processArtnetLogic } from './ArtnetContext';

describe('ArtnetContext Pure Logic', () => {
    it('should process Master Intensity on Channel 1', () => {
        const onArtnetCommand = vi.fn();
        const data = { universe: 0, channel: 0, value: 200 };
        processArtnetLogic(data, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('master_intensity', 200);
    });

    it('should process Global Blackout on Channel 2', () => {
        const onArtnetCommand = vi.fn();
        
        // Test Blackout ON
        processArtnetLogic({ universe: 0, channel: 1, value: 128 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('blackout_on', 128);

        // Test Blackout OFF
        processArtnetLogic({ universe: 0, channel: 1, value: 127 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('blackout_off', 127);
    });

    it('should process Page Selection on Channel 3', () => {
        const onArtnetCommand = vi.fn();
        processArtnetLogic({ universe: 0, channel: 2, value: 40 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('middle_bar_page_1', 40);
    });

    it('should process Transport Controls on Channel 4', () => {
        const onArtnetCommand = vi.fn();
        
        processArtnetLogic({ universe: 0, channel: 3, value: 50 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('transport_play', 50);

        processArtnetLogic({ universe: 0, channel: 3, value: 100 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('transport_pause', 100);

        processArtnetLogic({ universe: 0, channel: 3, value: 200 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('transport_stop', 200);
    });

    it('should process Layer Footprint (Layer 1, Channel 11-14)', () => {
        const onArtnetCommand = vi.fn();
        
        // Intensity (CH 11)
        processArtnetLogic({ universe: 0, channel: 10, value: 255 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('layer_0_intensity', 255);

        // Toggles (CH 12)
        processArtnetLogic({ universe: 0, channel: 11, value: 30 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('layer_0_blackout_toggle', 30);

        // Clip Trigger (CH 13)
        processArtnetLogic({ universe: 0, channel: 12, value: 15 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('clip_0_0', 15);

        // Speed (CH 14)
        processArtnetLogic({ universe: 0, channel: 13, value: 128 }, {}, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('layer_0_speed', 128);
    });

    it('should handle hybrid mapping (fixed + custom)', () => {
        const onArtnetCommand = vi.fn();
        const mappings = {
            'custom_fx_param': { universe: 0, channel: 100 } // Channel 101 (Outside fixed range 1-110)
        };
        
        // Fixed: Master Intensity (CH 1)
        processArtnetLogic({ universe: 0, channel: 0, value: 255 }, mappings, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('master_intensity', 255);

        // Custom: FX Param (CH 101)
        processArtnetLogic({ universe: 0, channel: 100, value: 128 }, mappings, onArtnetCommand);
        expect(onArtnetCommand).toHaveBeenCalledWith('custom_fx_param', 128);
    });
});
