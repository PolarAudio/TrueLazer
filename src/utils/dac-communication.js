const dgram = require('dgram');
const os = require('os');

// Showbridge specific constants (retained for now, will be removed or refactored later)
const DISCOVERY_PORT = 8089;
const SERVER_PORT = 8089;
const CLIENT_PORT = 8099;
const BROADCAST_IP = '255.255.255.255';


const { discoverDacs: idnDiscoverDacs, sendFrame: idnSendFrame, sendCloseChannel: idnSendCloseChannel } = require('./idn-communication');


// --- Network Utilities ---
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback
}

function calculateBroadcastAddress(address, netmask) {
  const ip = address.split('.').map(Number);
  const nm = netmask.split('.').map(Number);
  const broadcast = [];
  for (let i = 0; i < 4; i++) {
    broadcast[i] = (ip[i] & nm[i]) | (~nm[i] & 255);
  }
  return broadcast.join('.');
}

function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const networkInterfaces = [];

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkInterfaces.push({
          name: name,
          address: iface.address,
          netmask: iface.netmask,
          broadcast: iface.broadcast || calculateBroadcastAddress(iface.address, iface.netmask)
        });
      }
    }
  }
  return networkInterfaces;
}


// --- DAC Discovery (using IDN) ---
async function discoverDacs(callback, networkInterface) {
    console.log('Starting IDN DAC discovery...');
    try {
        const dacs = await idnDiscoverDacs();
        const formattedDacs = dacs.map(dac => ({
            ip: dac.ipAddress,
            channels: [0], // Assuming default channel 0 for IDN, or will need to query
            // You might need to map other fields from IDN discovery to your existing DAC structure
            // For now, let's keep it minimal or infer
            version: 'IDN', // Placeholder
            max_pps: 0,     // Placeholder
            max_points: 0,  // Placeholder
            unitID: dac.unitID,
            hostName: dac.hostName
        }));
        if (callback) {
            callback(formattedDacs);
        }
        return formattedDacs;
    } catch (error) {
        console.error('IDN DAC discovery failed:', error);
        if (callback) {
            callback([]); // Return empty array on error
        }
        return [];
    }
}


function stopDiscovery() {
    console.log('Stopping DAC discovery.');
    // IDN discovery handled internally by idn-communication.js, no external socket to close here.
}


// --- Frame and Command Sending (using IDN) ---
function sendFrame(ip, channel, frame, fps, ildaFormat = 0) {
    // Assuming frame.points is an array of {x, y, r, g, b, blanking}
    idnSendFrame(ip, channel, frame.points, 1000000 / fps, 1); // 1000000 us / fps = frameDuration
}

function sendPlayCommand(ip, channel) {
    // For IDN, "play" essentially means continuously sending frames.
    // If we want to simulate a "play" command, we can send a void frame or just ensure frames are sent.
    // This function might not be strictly necessary if frames are sent continuously.
    // For now, let's keep it and have it send an empty frame (no points) or a minimal frame.
    // A more accurate "play" might be handled by the application logic sending frames.
    console.log(`Simulating Play Command for IDN DAC ${ip} on channel ${channel}`);
    // Example: send a single blank point to "activate" the channel if it's idle
    idnSendFrame(ip, channel, [{x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true}], 1000000 / 30, 1);
}

function stopSending(discoveredDacs) {
    console.log('Stopping IDN sending. Sending close channel messages.');
    if (discoveredDacs && discoveredDacs.length > 0) {
        discoveredDacs.forEach(dac => {
            // Assuming channel 0 for simplicity, adjust if multiple channels are managed per DAC
            idnSendCloseChannel(dac.ip, 0); 
        });
    }
}


module.exports = {
    getNetworkInterfaces,
    discoverDacs,
    sendFrame,
    stopDiscovery,
    sendPlayCommand,
    stopSending
};