const { 
    discoverDacs: discoverIdnDacs, 
    sendFrame: sendIdnFrame, 
    getDacServices: getIdnDacServices,
    closeAll: closeIdnAll
} = require('./idn-communication.cjs');
const os = require('os');

/**
 * Gets the list of available network interfaces.
 * @returns {Array<object>} An array of network interface objects.
 */
function getNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    const results = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-ipv4 and internal (i.e. 127.0.0.1) addresses
            if ('IPv4' !== iface.family || iface.internal) {
                continue;
            }
            results.push({ name: name, address: iface.address });
        }
    }
    return results;
}


/**
 * Discovers all available DACs on the network.
 * For now, this only discovers IDN DACs.
 * @param {number} timeout - The duration in milliseconds to listen for responses.
 * @param {string} networkInterfaceIp - The IP address of the network interface to use for discovery.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of discovered DAC objects.
 */
function discoverDacs(timeout = 2000, networkInterfaceIp) {
  return discoverIdnDacs(timeout, networkInterfaceIp);
}

/**
 * Sends a single frame to a DAC.
 * For now, this only sends to IDN DACs.
 * @param {string} ip - The IP address of the DAC.
 * @param {number} channel - The channel number to send to.
 * @param {object} frame - The frame object containing points.
 * @param {number} fps - The desired frames per second (scan rate).
 */
function sendFrame(ip, channel, frame, fps) {
    return sendIdnFrame(ip, channel, frame, fps);
}

/**
 * Gets the services (channels) for a specific DAC.
 * @param {string} ip - The IP address of the DAC.
 * @param {string} localIp - The IP address of the local interface to bind to.
 * @param {number} timeout - The duration in milliseconds to listen for responses.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of service objects.
 */
function getDacServices(ip, localIp, timeout = 1000) {
    return getIdnDacServices(ip, localIp, timeout);
}

function closeAll() {
    return closeIdnAll();
}

module.exports = {
    getNetworkInterfaces,
    discoverDacs,
    sendFrame,
    getDacServices,
    closeAll
};


