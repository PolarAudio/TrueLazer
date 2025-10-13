const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 8089;
const SERVER_PORT = 8089;
const CLIENT_PORT = 8099;
const BROADCAST_IP = '255.255.255.255';

// --- Socket Management ---
let activeDiscoverySocket = null;
const sendingSockets = new Map();
let discoveryCallback = null;
const discoveredDacsMap = new Map();

function getFrameSendingSocket(ip, channel) {
    const key = `${ip}:${channel}`;
    if (!sendingSockets.has(key)) {
        const newSocket = dgram.createSocket('udp4');
        newSocket.on('error', (err) => {
            console.error(`Sending socket error for ${key}:`, err);
            newSocket.close();
            sendingSockets.delete(key);
        });
        sendingSockets.set(key, newSocket);
        console.log(`Created persistent sending socket for ${key}`);
    }
    return sendingSockets.get(key);
}

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

// --- DAC Discovery ---
function discoverDacs(callback, networkInterface) {
    console.log('Starting DAC discovery...');
    discoveryCallback = callback;

    if (activeDiscoverySocket) {
        console.log('Reusing existing discovery socket to send broadcast.');
        sendDiscoveryBroadcast(networkInterface);
        return;
    }

    const socket = dgram.createSocket('udp4');
    activeDiscoverySocket = socket;

    socket.on('listening', () => {
        const address = socket.address();
        console.log(`Socket listening on ${address.address}:${address.port}`);
        socket.setBroadcast(true);
        sendDiscoveryBroadcast(networkInterface);
    });

    socket.on('message', (msg, rinfo) => {
        console.log(`Received message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
        if (msg[0] === 0x16 && msg[1] === 0x1a && msg[2] === 0x01) {
            console.log('Received valid DAC response.');
            const dacIp = rinfo.address;
            const channel = msg[3];

            let dacEntry = discoveredDacsMap.get(dacIp);
            if (!dacEntry) {
                dacEntry = {
                    ip: dacIp,
                    channels: new Set(),
                    version: msg[4],
                    max_pps: msg[5] * 1000,
                    max_points: 5000,
                };
                discoveredDacsMap.set(dacIp, dacEntry);
                console.log('Newly discovered DAC:', dacEntry.ip);
            }

            if (!dacEntry.channels.has(channel)) {
                dacEntry.channels.add(channel);
                console.log(`Added new channel ${channel} to DAC: ${dacEntry.ip}`);
            }

            if (discoveryCallback) {
                const dacsForCallback = Array.from(discoveredDacsMap.values()).map(dac => ({
                    ...dac,
                    channels: Array.from(dac.channels)
                }));
                discoveryCallback(dacsForCallback);
            }
        } else {
            console.log('Received non-DAC message or invalid format.');
        }
    });

    socket.on('error', (err) => {
        console.error('Discovery socket error:', err);
        if (activeDiscoverySocket === socket) {
            activeDiscoverySocket = null;
        }
        socket.close();
    });

    socket.on('close', () => {
        console.log('Discovery socket closed.');
        if (activeDiscoverySocket === socket) {
            activeDiscoverySocket = null;
        }
    });

    if (networkInterface && networkInterface.address) {
        socket.bind(CLIENT_PORT, networkInterface.address);
    } else {
        socket.bind(CLIENT_PORT);
    }
}

function sendDiscoveryBroadcast(networkInterface) {
    const command = Buffer.alloc(6);
    const ip = (networkInterface && networkInterface.address) ? networkInterface.address : getLocalIpAddress();
    const ipParts = ip.split('.').map(Number);
    command.writeUInt8(ipParts[0], 0);
    command.writeUInt8(ipParts[1], 1);
    command.writeUInt8(ipParts[2], 2);
    command.writeUInt8(ipParts[3], 3);
    command.writeUInt8(163, 4); // Flag 1
    command.writeUInt8(31, 5);  // Flag 2

    if (activeDiscoverySocket) {
        activeDiscoverySocket.send(command, DISCOVERY_PORT, BROADCAST_IP, (err) => {
            if (err) console.error(`Error sending discovery broadcast: ${err}`);
            else console.log(`Sent discovery broadcast to ${BROADCAST_IP}:${DISCOVERY_PORT}`);
        });
    } else {
        console.error("Cannot send discovery broadcast, discovery socket is not active.");
    }
}

function stopDiscovery() {
    if (activeDiscoverySocket) {
        console.log('Stopping DAC discovery. Closing socket.');
        activeDiscoverySocket.close();
        activeDiscoverySocket = null;
        discoveredDacsMap.clear();
    }
}

// --- Frame and Command Sending ---
function sendFrame(ip, channel, frame, fps, ildaFormat = 0) {
    const socket = getFrameSendingSocket(ip, channel);
    if (!socket || !frame || !frame.points) return;

    const points = frame.points;
    const numPoints = points.length;
    let pointOffset = 0;
    let packetNum = 0;
    let frameNum = 0; // This should be managed globally or passed in

    const PACKET_SIZE = 4612;
    const SUBSEQUENT_POINTS_PER_PACKET = 576; // 4612 - 4 = 4608; 4608 / 8 = 576
    const FIRST_PACKET_POINTS = 575; // 4612 - 8 = 4604; 4604 / 8 = 575.5. Use 575 and pad.

    while (pointOffset < numPoints) {
        const paddedMessage = Buffer.alloc(PACKET_SIZE);
        let header;
        let packetPoints;

        if (packetNum === 0) {
            header = Buffer.alloc(8);
            header.writeUInt8(0x03, 0);
            header.writeUInt8(packetNum, 1);
            header.writeUInt8(frameNum, 2);
            header.writeUInt8(channel > 0 ? channel - 1 : 0, 3); // Use channel - 1, ensure non-negative
            header.writeUInt16LE(numPoints, 4);
            header.writeUInt8(ildaFormat, 6); // Use ildaFormat for vv
            header.writeUInt8(fps, 7);

            packetPoints = points.slice(pointOffset, pointOffset + FIRST_PACKET_POINTS);
            pointOffset += FIRST_PACKET_POINTS;
        } else {
            header = Buffer.alloc(4);
            header.writeUInt8(0x03, 0);
            header.writeUInt8(packetNum, 1);
            header.writeUInt8(frameNum, 2);
            header.writeUInt8(channel > 0 ? channel - 1 : 0, 3); // Use channel - 1

            packetPoints = points.slice(pointOffset, pointOffset + SUBSEQUENT_POINTS_PER_PACKET);
            pointOffset += SUBSEQUENT_POINTS_PER_PACKET;
        }

        const pointDataBuffer = Buffer.alloc(packetPoints.length * 8);
        let pointDataOffset = 0;

        for (const point of packetPoints) {
            const x_uint16 = Math.round((point.x + 1.0) / 2.0 * 4095);
            const y_uint16 = Math.round((1.0 - point.y) / 2.0 * 4095);
            const command = point.blanking ? 0x01 : 0x00;

            pointDataBuffer.writeUInt16LE(x_uint16, pointDataOffset);
            pointDataOffset += 2;
            pointDataBuffer.writeUInt16LE(y_uint16, pointDataOffset);
            pointDataOffset += 2;
            pointDataBuffer.writeUInt8(command, pointDataOffset++);
            pointDataBuffer.writeUInt8(point.r, pointDataOffset++);
            pointDataBuffer.writeUInt8(point.g, pointDataOffset++);
            pointDataBuffer.writeUInt8(point.b, pointDataOffset++);
        }

        const message = Buffer.concat([header, pointDataBuffer]);
        message.copy(paddedMessage);

        socket.send(paddedMessage, SERVER_PORT, ip, (err) => {
            if (err) console.error(`Error sending frame to ${ip}:`, err);
        });

        packetNum = (packetNum + 1) % 3;
        if (packetNum === 0) {
            frameNum = (frameNum + 1) % 256;
        }
    }
}

function sendPlayCommand(ip) {
    const socket = dgram.createSocket('udp4');
    const message = Buffer.from([0x44, 0x4D, 0x01, 0x12]); // DM0112 for play command
    socket.send(message, SERVER_PORT, ip, (err) => {
        if (err) {
            console.error(`Error sending Play Command to ${ip}:`, err);
        } else {
            console.log(`Sent Play Command to ${ip}`);
        }
        socket.close();
    });
}

function stopSending() {
    if (sendingSockets.size > 0) {
        console.log('Closing all persistent sending sockets.');
        for (const socket of sendingSockets.values()) {
            socket.close();
        }
        sendingSockets.clear();
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