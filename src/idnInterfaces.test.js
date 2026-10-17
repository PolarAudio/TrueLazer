import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';

// The interface list feeds two consumers that both default to `interfaces[0]` and
// then bind a discovery socket to that address and broadcast on it. Broadcast does
// not exist on loopback, so a loopback entry in first position would silently stop
// DAC discovery from finding any hardware. The ordering is a safety property, not
// cosmetic, hence the test.
//
// The stub is installed with spyOn rather than vi.mock: idn-communication.cjs does a
// bare `require('os')` from CommonJS, which vi.mock does not intercept. A vi.mock
// that silently fails is worse than none — it made these assertions run against the
// real adapters of whatever machine the test ran on.
const MOCK_INTERFACES = {
  'Loopback Pseudo-Interface 1': [
    { family: 'IPv4', address: '127.0.0.1', internal: true, netmask: '255.0.0.0' },
  ],
  Ethernet: [
    { family: 'IPv4', address: '192.168.1.50', internal: false, netmask: '255.255.255.0' },
    { family: 'IPv6', address: 'fe80::1', internal: false },
  ],
  'Local Area Connection': [
    { family: 'IPv4', address: '169.254.25.104', internal: false, netmask: '255.255.0.0' },
  ],
  WiFi: [
    { family: 'IPv4', address: null, internal: false },
    { family: 'IPv4', address: '10.0.0.7', internal: false, netmask: '255.0.0.0' },
  ],
};

const { getNetworkInterfaces } = await import('../main/idn-communication.cjs');

describe('getNetworkInterfaces', () => {
  let spy;
  beforeEach(() => {
    spy = vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_INTERFACES);
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it('is actually reading the stub, not the real machine adapters', () => {
    // Guards the guard: a silently-ineffective stub (vi.mock does not intercept a
    // bare require('os') from CJS) would let every other assertion pass against
    // whatever adapters the host machine happens to have. The stub yields exactly
    // four entries, and 192.168.1.50 exists on no real network.
    const list = getNetworkInterfaces();
    expect(list).toHaveLength(4);
    expect(list.map((i) => i.address)).toContain('192.168.1.50');
  });

  it('includes loopback, which it previously dropped entirely', () => {
    expect(getNetworkInterfaces().map((i) => i.address)).toContain('127.0.0.1');
  });

  it('sorts loopback LAST so it can never become the default interface', () => {
    const list = getNetworkInterfaces();
    expect(list[list.length - 1].address).toBe('127.0.0.1');
    expect(list[0].address).not.toBe('127.0.0.1');
  });

  it('marks which entries are loopback', () => {
    const list = getNetworkInterfaces();
    expect(list.filter((i) => i.loopback).map((i) => i.address)).toEqual(['127.0.0.1']);
    expect(list.filter((i) => !i.loopback).every((i) => i.loopback === false)).toBe(true);
  });

  it('still lists every real external IPv4 adapter, link-local included', () => {
    // 169.254.x.x matters: a direct-Ethernet rack with no DHCP is a normal Pro DJ
    // Link / Denon setup, so those interfaces must not be filtered.
    const external = getNetworkInterfaces().filter((i) => !i.loopback).map((i) => i.address);
    expect(external).toEqual(['192.168.1.50', '169.254.25.104', '10.0.0.7']);
  });

  it('ignores IPv6 and entries with no address', () => {
    const list = getNetworkInterfaces();
    expect(list.some((i) => i.address === 'fe80::1')).toBe(false);
    expect(list.some((i) => i.address === null)).toBe(false);
  });

  it('puts every external adapter before every loopback one, whatever the OS order', () => {
    // Loopback is enumerated FIRST in the stub, which is exactly why the sort is
    // needed rather than incidental.
    const list = getNetworkInterfaces();
    const flags = list.map((i) => i.loopback);
    expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
  });
});
