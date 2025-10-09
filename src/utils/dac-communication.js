const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 8089;
const SERVER_PORT = 8089;
const CLIENT_PORT = 8099;
const BROADCAST_IP = '255.255.255.255'; // Added BROADCAST_IP

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
  const discoveredDacsMap = new Map(); // Map to store discovered DACs by IP
  
  function discoverDacs(callback, networkInterface) {
    console.log('Starting DAC discovery...');
    discoveryCallback = callback; // Update the callback
  
    if (activeDiscoverySocket) {
      console.log('Reusing existing discovery socket to send broadcast.');
      sendDiscoveryBroadcast(); // Call the new function
      return;
    }
  
    const socket = dgram.createSocket('udp4');
    activeDiscoverySocket = socket; // Track the new active socket
  
    socket.on('listening', () => {
      const address = socket.address();
      console.log(`Socket listening on ${address.address}:${address.port}`);
      socket.setBroadcast(true);
      sendDiscoveryBroadcast();
    });
  
    socket.on('message', (msg, rinfo) => {
      console.log(`Received message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
      if (msg[0] === 0x16 && msg[1] === 0x1a && msg[2] === 0x01) { // Vendor ID (22,26) and Type (1)
        console.log('Received valid DAC response.');
        const dacIp = rinfo.address;
        const channel = msg[3]; // Channel is msg[3]
  
        let dacEntry = discoveredDacsMap.get(dacIp);
        const isNewDac = !dacEntry;
        if (isNewDac) {
          dacEntry = {
            ip: dacIp,
            channels: new Set(),
            // Extracting version, max_pps, max_points from the message
            // Assuming version is msg[4], max_pps is msg[5] * 1000, max_points is 5000
            // These are placeholders and need to be verified with actual protocol
            version: msg[4],
            max_pps: msg[5] * 1000,
            max_points: 5000,
          };
          discoveredDacsMap.set(dacIp, dacEntry);
          console.log('Newly discovered DAC:', dacEntry.ip);
        }

        const isNewChannel = !dacEntry.channels.has(channel);
        if (isNewChannel) {
          dacEntry.channels.add(channel);
          console.log(`Added new channel ${channel} to DAC: ${dacEntry.ip}`);
        }
  
        console.log('Current state of DAC:', dacEntry); // Log the current state of the DAC
        if (discoveryCallback) {
          // Convert the Map values to an array, and channels Set to an array for the callback
          const dacsForCallback = Array.from(discoveredDacsMap.values()).map(dac => ({
            ...dac,
            channels: Array.from(dac.channels)
          }));
          console.log('DACS sent to callback:', dacsForCallback); // Log what's sent to the callback
          discoveryCallback(dacsForCallback);
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

function sendDiscoveryBroadcast() {
    const localIp = getLocalIpAddress();
    const command = Buffer.alloc(6);
    // Assuming target IP is part of the command, as per SDKSocket.h
    // This part needs to be carefully constructed based on the actual SDK
    // For now, let's use a placeholder or assume it's the local IP
    const ipParts = localIp.split('.').map(Number);
    command.writeUInt8(ipParts[0], 0);
    command.writeUInt8(ipParts[1], 1);
    command.writeUInt8(ipParts[2], 2);
    command.writeUInt8(ipParts[3], 3);
    command.writeUInt8(163, 4); // Flag 1
    command.writeUInt8(31, 5);  // Flag 2

    activeDiscoverySocket.send(command, DISCOVERY_PORT, BROADCAST_IP, (err) => {
        if (err) console.error(`Error sending discovery broadcast: ${err}`);
        else console.log(`Sent discovery broadcast to ${BROADCAST_IP}:${DISCOVERY_PORT}`);
    });
}

function stopDiscovery() {
  if (activeDiscoverySocket) {
    console.log('Stopping DAC discovery. Closing socket.');
    activeDiscoverySocket.close();
    activeDiscoverySocket = null;
    discoveredDacsMap.clear(); // Clear the map on stop
  }
}

function sendFrame(ip, frame) {
    const socket = dgram.createSocket('udp4');

    // 1. Construct the 16-byte Application Data Header
    const applicationHeader = Buffer.from('fdb41f99120c8322030040008700001e', 'hex');

    // 2. Vector Data: Multiple 8-byte vector structures (X, Y, command, RGB)
    const MAX_POINTS_PER_PACKET = 574; // Derived from (4612 total app data - 16 header) / 8 bytes per point = 574.5, so 574 points with 4 bytes padding
    const pointsToProcess = frame.points.slice(0, MAX_POINTS_PER_PACKET);

    const fixedPointDataSize = MAX_POINTS_PER_PACKET * 8; // 8 bytes per point
    const pointDataBuffer = Buffer.alloc(fixedPointDataSize);
    let pointOffset = 0;

    for (const point of pointsToProcess) {
        // Convert normalized float coordinates (-1.0 to 1.0) to uint16_t (0 to 4095)
        const x_uint16 = Math.round((point.x + 1.0) / 2.0 * 4095);
        const y_uint16 = Math.round((1.0 - point.y) / 2.0 * 4095);

        // Map blanking to command: 0x01 = Laser On, 0x00 = Laser Off
        const command = point.blanking ? 0x00 : 0x01;

        pointDataBuffer.writeUInt16LE(x_uint16, pointOffset);
        pointOffset += 2;
        pointDataBuffer.writeUInt16LE(y_uint16, pointOffset);
        pointOffset += 2;

        // DEBUG: Read back what was written
        const writtenX = pointDataBuffer.readUInt16LE(pointOffset - 4);
        const writtenY = pointDataBuffer.readUInt16LE(pointOffset - 2);

        pointDataBuffer.writeUInt8(command, pointOffset++);
        pointDataBuffer.writeUInt8(point.r, pointOffset++);
        pointDataBuffer.writeUInt8(point.g, pointOffset++);
        pointDataBuffer.writeUInt8(point.b, pointOffset++);
    }

    // Fill the remaining space with zeros to match TrueWave's 'laser off' behavior
    while (pointOffset < fixedPointDataSize) {
        pointDataBuffer.writeUInt8(0x00, pointOffset++);
    }

    // 3. Combine Application Header and Vector Data into a 4612-byte buffer
    const message = Buffer.alloc(4612); // Allocate for the full 4612 bytes of application data

    applicationHeader.copy(message, 0);
    pointDataBuffer.copy(message, applicationHeader.length);

    const fs = require('fs');
    const path = require('path');
    const logFilePath = path.join(__dirname, '..', '..', 'packet_log.txt'); // Log file in project root


    socket.send(message, SERVER_PORT, ip, (err) => {
        if (err) {
            console.error(`Error sending frame to ${ip}:`, err);
            const errorLogEntry = `--- ${new Date().toISOString()} ---\nError sending frame to ${ip}: ${err.message}\n\n`;
            fs.appendFileSync(logFilePath, errorLogEntry);
        }
        socket.close();
    });
}

function sendPlayCommand(ip) {
    const socket = dgram.createSocket('udp4');
    const message = Buffer.from([0x44, 0x4D, 0x01, 0x12]); // DM0112 for play command

    const fs = require('fs');
    const path = require('path');
    const logFilePath = path.join(__dirname, '..', '..', 'packet_log.txt');

    const logEntry = `--- ${new Date().toISOString()} ---\nSending Play Command to ${ip}:${SERVER_PORT} (size: ${message.length} bytes):\n${message.toString('hex')}\n\n`;
    fs.appendFileSync(logFilePath, logEntry);
    console.log(`Play Command logged to ${logFilePath}`);

    socket.send(message, SERVER_PORT, ip, (err) => {
        if (err) {
            console.error(`Error sending Play Command to ${ip}:`, err);
            const errorLogEntry = `--- ${new Date().toISOString()} ---\nError sending Play Command to ${ip}: ${err.message}\n\n`;
            fs.appendFileSync(logFilePath, errorLogEntry);
        }
        socket.close();
    });
}

module.exports = { getNetworkInterfaces, discoverDacs, sendFrame, stopDiscovery, sendPlayCommand };