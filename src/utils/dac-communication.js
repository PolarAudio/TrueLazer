const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 8089;
const SERVER_PORT = 8089;
const CLIENT_PORT = 8099;

function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const networkInterfaces = [];

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Only consider IPv4 addresses that are not internal
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

function calculateBroadcastAddress(address, netmask) {
  const ip = address.split('.').map(Number);
  const nm = netmask.split('.').map(Number);
  const broadcast = [];
  for (let i = 0; i < 4; i++) {
    broadcast[i] = (ip[i] & nm[i]) | (~nm[i] & 255);
  }
  return broadcast.join('.');
}

let activeDiscoverySocket = null;
let discoveryCallback = null; // Store the callback to be used by the active socket

function discoverDacs(callback, networkInterface) {
  console.log('Starting DAC discovery...');
  discoveryCallback = callback; // Update the callback

  if (activeDiscoverySocket) {
    console.log('Reusing existing discovery socket to send broadcast.');
    sendBroadcast(activeDiscoverySocket, networkInterface);
    return;
  }

  const socket = dgram.createSocket('udp4');
  activeDiscoverySocket = socket; // Track the new active socket
  const dacs = [];

  socket.on('listening', () => {
    const address = socket.address();
    console.log(`Socket listening on ${address.address}:${address.port}`);
    socket.setBroadcast(true);
    sendBroadcast(socket, networkInterface);
  });

  socket.on('message', (msg, rinfo) => {
    console.log(`Received message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
    if (msg[0] === 0x16 && msg[1] === 0x1a && msg[2] === 0x01) { // Vendor ID (22,26) and Type (1)
      console.log('Received valid DAC response.');
      const dacInfo = {
        ip: rinfo.address,
        // Extracting version, max_pps, max_points from the message
        // Assuming version is msg[4], max_pps is msg[5] * 1000, max_points is 5000
        // These are placeholders and need to be verified with actual protocol
        version: msg[4],
        max_pps: msg[5] * 1000,
        max_points: 5000,
        channel: msg[3], // Channel is msg[3]
      };

      // Further parsing of Device ID, Value, Checksum will go here
      // For now, let's just get the basic info
      if (!dacs.some(d => d.ip === dacInfo.ip)) {
        dacs.push(dacInfo);
        console.log('Discovered DAC:', dacInfo);
        if (discoveryCallback) {
          discoveryCallback(dacs);
        }
      }
    } else {
      console.log('Received non-DAC message or invalid format.');
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
    if (activeDiscoverySocket === socket) {
      activeDiscoverySocket = null;
    }
    socket.close();
  });

  socket.on('close', () => {
    console.log('Socket closed.');
    if (activeDiscoverySocket === socket) {
      activeDiscoverySocket = null;
    }
  });

  socket.bind(CLIENT_PORT, () => {
    console.log('Binding socket to CLIENT_PORT...');
  });
}

function sendBroadcast(socket, networkInterface) {
  const broadcastAddress = '255.255.255.255';
  let targetIpBuffer = Buffer.from([0, 0, 0, 0]); // Default to 0.0.0.0

  if (networkInterface && networkInterface.address) {
    const ipParts = networkInterface.address.split('.').map(Number);
    targetIpBuffer = Buffer.from(ipParts);
  }

  // Command: 6 bytes = Target IP (4 bytes) + Flags (2 bytes)
  const command = Buffer.concat([
    targetIpBuffer, // Our station IP
    Buffer.from([163, 31]) // Flags
  ]);

  // The actual discovery message to send is just the 6-byte command
  const DISCOVERY_MESSAGE_TO_SEND = command;

  console.log(`Sending discovery message to ${broadcastAddress}:${DISCOVERY_PORT} with command: ${DISCOVERY_MESSAGE_TO_SEND.toString('hex')}`);

  socket.send(DISCOVERY_MESSAGE_TO_SEND, DISCOVERY_PORT, broadcastAddress, (err) => {
    if (err) {
      console.error('Error sending discovery message:', err);
      socket.close();
    } else {
      console.log('Discovery message sent.');
    }
  });
}

function stopDiscovery() {
  if (activeDiscoverySocket) {
    console.log('Stopping DAC discovery. Closing socket.');
    activeDiscoverySocket.close();
    activeDiscoverySocket = null;
  }
}

function sendFrame(ip, frame) {
    const socket = dgram.createSocket('udp4');
    const message = Buffer.alloc(4 + 2 + 1 + 1 + (frame.points.length * 8));

    let offset = 0;
    message.write('DM', offset, 2, 'ascii');
    offset += 2;
    message.writeUInt8(0x01, offset++); // version
    message.writeUInt8(0x10, offset++); // command for send frame

    message.writeUInt16LE(frame.points.length, offset);
    offset += 2;
    message.writeUInt8(0, offset++); // status
    message.writeUInt8(0, offset++); // delay

    for (const point of frame.points) {
        message.writeFloatLE(point.x, offset);
        offset += 4;
        message.writeFloatLE(point.y, offset);
        offset += 4;
        message.writeUInt8(point.blanking ? 1 : 0, offset++);
        message.writeUInt8(point.r, offset++);
        message.writeUInt8(point.g, offset++);
        message.writeUInt8(point.b, offset++);
    }

    socket.send(message, SERVER_PORT, ip, (err) => {
        if (err) {
            console.error(`Error sending frame to ${ip}:`, err);
        }
        socket.close();
    });
}

module.exports = { getNetworkInterfaces, discoverDacs, sendFrame, stopDiscovery };