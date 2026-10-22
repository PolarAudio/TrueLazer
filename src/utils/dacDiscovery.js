/**
 * One DAC discovery path for the whole app.
 *
 * The Show Control page and the Timeline used to scan separately and build
 * their own channel lists. That is why the Output Settings window - which is
 * bound to the Show Control list - showed nothing when it was opened from the
 * Timeline: the Timeline had discovered its own DACs and never told anyone.
 * Both now go through this helper, so both hold the same list.
 *
 * The per-channel list is what everything downstream keys off:
 *   - the Output Settings window lists one entry per channel
 *   - the timeline seeds one track per channel
 *   - the per-output settings are keyed `${ip}:${channel}`
 * so the channel NUMBERS have to be the ones the hardware actually uses.
 */

/**
 * The IDN protocol exposes service 0 as a management service rather than a
 * laser output, so it must not become a routable channel. Every other
 * backend lists exactly its laser channels, and a Showbridge is free to
 * number them 0..N-1 - dropping 0 there would silently lose its first
 * channel, which is how a two-channel unit ends up with only one routable
 * output.
 */
function isLaserService(dac, service) {
    const type = (dac.type || '').toLowerCase();
    if (type === 'idn') return service.serviceID !== 0;
    return true;
}

/**
 * Scan the network and return one entry per DAC, each carrying its channels.
 * @param {string} [networkInterfaceIp] the local address to scan from
 */
export async function discoverDacOutputs(networkInterfaceIp) {
    if (!window.electronAPI) return [];
    let localIp = networkInterfaceIp;
    if (!localIp) {
        const network = await window.electronAPI.getNetworkInterfaces?.();
        const iface = Array.isArray(network) && network.length > 0 ? network[0] : undefined;
        localIp = iface?.address;
    }
    const discovered = await window.electronAPI.discoverDacs(2000, localIp);
    return Promise.all(
        (discovered || []).map(async (dac) => {
            let services = [];
            try {
                services = await window.electronAPI.getDacServices(dac.ip, localIp, dac.type);
            } catch (e) {
                services = [];
            }
            return {
                ...dac,
                channels: (services || []).filter((s) => isLaserService(dac, s)),
            };
        })
    );
}

/**
 * Flatten a DAC list into one routable output per channel.
 * A DAC that reports no channels at all is treated as a single channel 0.
 */
export function dacOutputRows(dacList) {
    const rows = [];
    const seen = new Set();
    for (const dac of dacList || []) {
        const channels = (dac.channels && dac.channels.length > 0)
            ? dac.channels
            : [{ serviceID: 0, name: 'Main' }];
        for (const ch of channels) {
            const key = `${dac.ip}:${ch.serviceID ?? 0}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
                ip: dac.ip,
                channel: ch.serviceID ?? 0,
                type: dac.type,
                label: ch.name || ch.serviceName || `${dac.hostName || dac.ip}[${ch.serviceID ?? 0}]`,
            });
        }
    }
    return rows;
}
