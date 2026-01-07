const dgram = require('dgram');
const { Buffer } = require('buffer');
const os = require('os');

const IDN_HELLO_UDP_PORT = 7255;
const BROADCAST_ADDRESS = '255.255.255.255';

const IDNCMD_SCAN_REQUEST = 0x10;
const IDNCMD_SCAN_RESPONSE = 0x11;
const IDNCMD_SERVICEMAP_REQUEST = 0x12;
const IDNCMD_SERVICEMAP_RESPONSE = 0x13;
const IDNCMD_RT_CNLMSG = 0x40;

const IDNVAL_CNKTYPE_LPGRF_FRAME = 0x02;
const IDNVAL_SMOD_LPGRF_DISCRETE = 0x02;

let dataSocket = null;
let generalSequence = 0;
let rtSequence = 0;
let isScanning = false;

function getSocket() {
    if (dataSocket) return dataSocket;
    dataSocket = dgram.createSocket('udp4');
    dataSocket.on('error', (err) => {
        console.error('IDN data socket error:', err);
        closeAll();
    });
    return dataSocket;
}

function closeAll() {
    if (dataSocket) {
        try { dataSocket.close(); } catch (e) {}
        dataSocket = null;
    }
}

function getNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
        for (const k2 in interfaces[k]) {
            const address = interfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push({ name: k, address: address.address });
            }
        }
    }
    return addresses;
}

function discoverDacs(timeout = 2000, networkInterfaceIp) {
  if (isScanning) return Promise.resolve([]);
  isScanning = true;

  return new Promise((resolve, reject) => {
    const discoveredDacs = new Map();
    const discoverySocket = dgram.createSocket('udp4');
    let scanInterval = null;
    let resolveTimeout = null;

    const cleanup = () => {
        if (scanInterval) clearInterval(scanInterval);
        if (resolveTimeout) clearTimeout(resolveTimeout);
        try { discoverySocket.close(); } catch (e) {}
        isScanning = false;
    };

    discoverySocket.on('error', (err) => {
      console.error('IDN discovery socket error:', err);
      cleanup();
      resolve(Array.from(discoveredDacs.values()));
    });

    discoverySocket.on('message', (msg, rinfo) => {
        if (msg.readUInt8(0) === IDNCMD_SCAN_RESPONSE) {
            const response = parseScanResponse(msg, rinfo);
            if (response && !discoveredDacs.has(response.unitID)) {
                discoveredDacs.set(response.unitID, response);
                
                // If we found a device, we can resolve soon (give a bit of time for others)
                if (!resolveTimeout) {
                    console.log(`[IDN] Device found, settling scan...`);
                    resolveTimeout = setTimeout(() => {
                        cleanup();
                        resolve(Array.from(discoveredDacs.values()));
                    }, 500); // 500ms settle time after first discovery
                }
            }
        }
    });
    
    const sendScanRequest = () => {
        const packet = Buffer.alloc(4);
        packet.writeUInt8(IDNCMD_SCAN_REQUEST, 0);
        packet.writeUInt8(0, 1);
        packet.writeUInt16BE(generalSequence++, 2);
        discoverySocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, BROADCAST_ADDRESS);
    };

    const bindOptions = { port: 0 };
    if (networkInterfaceIp) bindOptions.address = networkInterfaceIp;

    discoverySocket.bind(bindOptions, () => {
        discoverySocket.setBroadcast(true);
        // Initial burst for fast discovery
        for (let i = 0; i < 10; i++) {
            setTimeout(sendScanRequest, i * 20);
        }
        scanInterval = setInterval(sendScanRequest, 500);
    });

    // Absolute fallback timeout
    setTimeout(() => {
      if (isScanning) {
          cleanup();
          resolve(Array.from(discoveredDacs.values()));
      }
    }, timeout);
  });
}

function parseScanResponse(msg, rinfo) {
  try {
    if (msg.readUInt8(0) !== IDNCMD_SCAN_RESPONSE || msg.length < 28) return null;
    let offset = 4;
    const protocolVersion = msg.readUInt8(++offset);
    const status = msg.readUInt8(++offset);
    offset += 2;
    const unitIDLen = msg.readUInt8(offset++);
    const unitID = msg.slice(offset, offset + unitIDLen).toString('utf-8').replace(/\0/g, '').trim();
    offset += 15;
    const hostName = msg.slice(offset, offset + 20).toString('utf-8').replace(/\0/g, '').trim(); 
    return {
      ip: rinfo.address,
      port: rinfo.port,
      unitID,
      hostName,
      protocolVersion: `${protocolVersion >> 4}.${protocolVersion & 0x0F}`,
      status,
      type: 'idn'
    };
  } catch (error) {
    console.error('Error parsing IDN scan response:', error);
    return null;
  }
}

function sendCloseChannel(ip) {
    sendFrame(ip, 0, { points: [] }, 30);
}

function sendFrame(ip, channel, frame, fps) {
    if (!frame || !frame.points) return;
    let points = frame.points;
    let isTyped = frame.isTypedArray;
    if (isTyped && !(points instanceof Float32Array)) {
        if (Buffer.isBuffer(points) || points instanceof Uint8Array) {
            points = new Float32Array(points.buffer, points.byteOffset, points.byteLength / Float32Array.BYTES_PER_ELEMENT);
        }
    }
    const numPoints = Math.floor(isTyped ? (points.length / 8) : points.length);
    const pointSize = 8;
    const frameDataSize = numPoints * pointSize;
    const dictionary = Buffer.from('4200401042104010527e521451cc5c10', 'hex');
    const dictWordCount = 4;
    const channelConfigSize = 4 + dictionary.length;
    const frameChunkHeaderSize = 4;
    const headerSize = 4;
    const channelMessageHeaderSize = 8;
    const totalSize = headerSize + channelMessageHeaderSize + channelConfigSize + frameChunkHeaderSize + frameDataSize;
    const packet = Buffer.alloc(totalSize);
    let offset = 0;
    rtSequence = (rtSequence + 1) & 0xFFFF;
    packet.writeUInt8(IDNCMD_RT_CNLMSG, offset++);
    packet.writeUInt8(0, offset++);
    packet.writeUInt16BE(rtSequence, offset);
    offset += 2;
    packet.writeUInt16LE(channelMessageHeaderSize + channelConfigSize + frameChunkHeaderSize + frameDataSize, offset);
    offset += 2;
    const contentID = 0x8000 | 0x4000 | (0 << 8) | (IDNVAL_CNKTYPE_LPGRF_FRAME & 0xFF);
    packet.writeUInt16BE(contentID, offset);
    offset += 2;
    packet.writeUInt32LE(Number(process.hrtime.bigint() & BigInt(0xFFFFFFFF)), offset);
    offset += 4;
    packet.writeUInt8(dictWordCount, offset++);
    packet.writeUInt8(0x01, offset++);
    packet.writeUInt8(channel, offset++);
    packet.writeUInt8(IDNVAL_SMOD_LPGRF_DISCRETE, offset++);
    dictionary.copy(packet, offset);
    offset += dictionary.length;
    const duration = Math.round(1000000 / (fps || 60));
    packet.writeUInt32BE(duration & 0x00FFFFFF, offset);
    offset += 4;
    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) {
            const pOffset = i * 8;
            x = points[pOffset]; y = points[pOffset + 1];
            r = points[pOffset + 3]; g = points[pOffset + 4]; b = points[pOffset + 5];
            blanking = points[pOffset + 6] > 0.5;
        } else {
            const point = points[i];
            x = point.x; y = point.y; r = point.r; g = point.g; b = point.b; blanking = point.blanking;
        }
        if (blanking) { r = 0; g = 0; b = 0; }
        packet.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), offset);
        offset += 2;
        packet.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(y * 32767))), offset);
        offset += 2;
        packet.writeUInt8(r, offset++);
        packet.writeUInt8(g, offset++);
        packet.writeUInt8(b, offset++);
        packet.writeUInt8(blanking ? 0 : 255, offset++);
    }
    const socket = getSocket();
    socket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip);
}

function getDacServices(ip, localIp, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const services = [];
    const serviceSocket = dgram.createSocket('udp4');
    const cleanup = () => { try { serviceSocket.close(); } catch (e) {} };
    serviceSocket.on('error', (err) => { cleanup(); resolve([]); });
    serviceSocket.on('message', (msg, rinfo) => {
      if (rinfo.address === ip && msg.readUInt8(0) === IDNCMD_SERVICEMAP_RESPONSE) {
        const parsedServices = parseServiceMapResponse(msg);
        if (parsedServices) { services.push(...parsedServices); cleanup(); resolve(services); }
      }
    });
    const bindOptions = { port: 0 };
    if (localIp) bindOptions.address = localIp;
    serviceSocket.bind(bindOptions, () => {
      const packet = Buffer.alloc(4);
      packet.writeUInt8(IDNCMD_SERVICEMAP_REQUEST, 0);
      packet.writeUInt8(0, 1);
      packet.writeUInt16BE(generalSequence++, 2);
      serviceSocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip);
    });
    setTimeout(() => { cleanup(); resolve(services); }, timeout);
  });
}

function parseServiceMapResponse(msg) {
  try {
    if (msg.length < 8 || msg.readUInt8(0) !== IDNCMD_SERVICEMAP_RESPONSE) return null;
    let offset = 4;
    const entrySize = msg.readUInt8(offset + 1);
    const relayEntryCount = msg.readUInt8(offset + 2);
    const serviceEntryCount = msg.readUInt8(offset + 3);
    offset += 4;
    const services = [];
    offset += (relayEntryCount * entrySize);
    for (let i = 0; i < serviceEntryCount; i++) {
      if (offset + entrySize > msg.length) break;
      const serviceEntryOffset = offset;
      const serviceID = msg.readUInt8(serviceEntryOffset);
      const name = msg.slice(serviceEntryOffset + 4, serviceEntryOffset + 24).toString('utf8').replace(/\0/g, '').trim();
      offset += entrySize;
      services.push({ serviceID, name });
    }
    return services;
  } catch (error) {
    console.error('Error parsing IDN service map response:', error);
    return null;
  }
}

module.exports = { discoverDacs, sendFrame, getDacServices, closeAll, getNetworkInterfaces, sendCloseChannel };
