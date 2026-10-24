import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverDacOutputs, dacOutputRows } from './dacDiscovery';

// The Output Settings window lists one entry per DAC channel, and the
// per-output settings are keyed `${ip}:${channel}`. The Show Control page and
// the Timeline therefore have to agree on the channel NUMBERS - a channel
// dropped from one list is a channel whose dimmer, zones and name cannot be
// edited.
//
// The IDN protocol exposes service 0 as a management service, not a laser
// output. Every other backend lists exactly its laser channels, and a
// Showbridge may number them 0..N-1 - dropping 0 there loses its first
// channel, which is how a two-channel unit ends up with one routable output.

describe('discoverDacOutputs', () => {
    afterEach(() => {
        delete global.window;
        vi.restoreAllMocks();
    });

    it('keeps every channel of a Showbridge, including channel 0', async () => {
        global.window = { electronAPI: {
            getNetworkInterfaces: async () => [{ address: '192.168.1.10' }],
            discoverDacs: async () => [
                { ip: '192.168.1.50', type: 'Showbridge', hostName: 'SB-2' },
            ],
            getDacServices: async () => [
                { serviceID: 0, name: 'Channel 0' },
                { serviceID: 1, name: 'Channel 1' },
            ],
        } };
        const dacs = await discoverDacOutputs();
        expect(dacs).toHaveLength(1);
        expect(dacs[0].channels.map((c) => c.serviceID)).toEqual([0, 1]);
    });

    it('drops the IDN management service 0', async () => {
        global.window = { electronAPI: {
            getNetworkInterfaces: async () => [{ address: '192.168.1.10' }],
            discoverDacs: async () => [
                { ip: '192.168.1.60', type: 'idn', hostName: 'IDN-1' },
            ],
            getDacServices: async () => [
                { serviceID: 0, name: 'Main' },
                { serviceID: 1, name: 'Laser' },
            ],
        } };
        const dacs = await discoverDacOutputs();
        expect(dacs[0].channels.map((c) => c.serviceID)).toEqual([1]);
    });

    it('keeps the single EtherDream service 0', async () => {
        global.window = { electronAPI: {
            getNetworkInterfaces: async () => [{ address: '192.168.1.10' }],
            discoverDacs: async () => [
                { ip: '192.168.1.70', type: 'EtherDream', hostName: 'ED-1' },
            ],
            getDacServices: async () => [{ serviceID: 0, name: 'Main' }],
        } };
        const dacs = await discoverDacOutputs();
        expect(dacs[0].channels.map((c) => c.serviceID)).toEqual([0]);
    });

    it('survives a DAC whose services cannot be read', async () => {
        global.window = { electronAPI: {
            getNetworkInterfaces: async () => [{ address: '192.168.1.10' }],
            discoverDacs: async () => [{ ip: '192.168.1.80', type: 'Showbridge' }],
            getDacServices: async () => { throw new Error('no answer'); },
        } };
        const dacs = await discoverDacOutputs();
        expect(dacs).toHaveLength(1);
        expect(dacs[0].channels).toEqual([]);
    });
});

describe('dacOutputRows', () => {
    it('produces one row per channel', () => {
        const rows = dacOutputRows([
            { ip: '1.2.3.4', type: 'Showbridge', hostName: 'SB', channels: [{ serviceID: 1 }, { serviceID: 2 }] },
        ]);
        expect(rows.map((r) => `${r.ip}:${r.channel}`)).toEqual(['1.2.3.4:1', '1.2.3.4:2']);
    });

    it('treats a DAC without channels as a single channel 0', () => {
        const rows = dacOutputRows([{ ip: '1.2.3.4', type: 'EtherDream', channels: [] }]);
        expect(rows.map((r) => `${r.ip}:${r.channel}`)).toEqual(['1.2.3.4:0']);
    });

    it('does not repeat a channel that two scans reported twice', () => {
        const rows = dacOutputRows([
            { ip: '1.2.3.4', type: 'Showbridge', channels: [{ serviceID: 1 }, { serviceID: 2 }] },
            { ip: '1.2.3.4', type: 'Showbridge', channels: [{ serviceID: 1 }, { serviceID: 2 }] },
        ]);
        expect(rows).toHaveLength(2);
    });
});
