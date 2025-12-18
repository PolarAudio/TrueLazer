const dgram = require('dgram');
const { Buffer } = require('buffer');

const IDN_HELLO_UDP_PORT = 7255;
const BROADCAST_ADDRESS = '255.255.255.255';

const IDNCMD_SCAN_REQUEST = 0x10;
const IDNCMD_SCAN_RESPONSE = 0x11;
const IDNCMD_SERVICEMAP_REQUEST = 0x12;
const IDNCMD_SERVICEMAP_RESPONSE = 0x13;
const IDNCMD_RT_CNLMSG = 0x40;

const IDNVAL_CNKTYPE_LPGRF_FRAME = 0x02;
const IDNVAL_SMOD_LPGRF_DISCRETE = 0x02;

const socket = dgram.createSocket('udp4');
let generalSequence = 0;
const sequenceMap = new Map();

socket.on('error', (err) => {
  console.error('IDN socket error:', err);
  socket.close();
});

function discoverDacs(timeout = 2000, networkInterfaceIp) {
  return new Promise((resolve, reject) => {
    const discoveredDacs = new Map();
    const discoverySocket = dgram.createSocket('udp4');
    
    discoverySocket.on('error', (err) => {
      console.error('IDN discovery socket error:', err);
      discoverySocket.close();
      reject(err);
    });

    discoverySocket.on('message', (msg, rinfo) => {
        if (msg.readUInt8(0) === IDNCMD_SCAN_RESPONSE) {
            const response = parseScanResponse(msg, rinfo);
            if (response && !discoveredDacs.has(response.unitID)) {
                discoveredDacs.set(response.unitID, response);
            }
        }
    });
    
    const bindOptions = { port: IDN_HELLO_UDP_PORT };
    if (networkInterfaceIp) {
      bindOptions.address = networkInterfaceIp;
    }

    discoverySocket.bind(bindOptions, () => {
        discoverySocket.setBroadcast(true);
        const packet = Buffer.alloc(4);
        packet.writeUInt8(IDNCMD_SCAN_REQUEST, 0);
        packet.writeUInt8(0, 1);
        packet.writeUInt16BE(generalSequence++, 2);
        discoverySocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, BROADCAST_ADDRESS, (err) => {
            if (err) {
                console.error('IDN discovery send error:', err);
                discoverySocket.close();
                reject(err);
            }
        });
    });

    setTimeout(() => {
      discoverySocket.close();
      resolve(Array.from(discoveredDacs.values()));
    }, timeout);
  });
}

function parseScanResponse(msg, rinfo) {
  try {
    if (msg.readUInt8(0) !== IDNCMD_SCAN_RESPONSE || msg.length < 28) {
      return null;
    }
    
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
      rawResponse: msg.toString('hex')
    };
  } catch (error) {
    console.error('Error parsing IDN scan response:', error);
    return null;
  }
}

function sendFrame(ip, channel, frame, fps) {
    const pointSize = 8;
    const numPoints = frame.points.length;
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
    
    const channelKey = `${ip}:${channel}`;
    let currentSequence = sequenceMap.get(channelKey) || 0;
    currentSequence++;
    sequenceMap.set(channelKey, currentSequence);

    packet.writeUInt8(IDNCMD_RT_CNLMSG, offset++);
    packet.writeUInt8(0, offset++);
    packet.writeUInt16BE(currentSequence, offset);
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
    
    // Frame Sample Chunk Header
    const duration = 32080; // From packet capture
    packet.writeUInt32BE(duration, offset); // Includes flags (0x00) and duration
    offset += 4;

    for (const point of frame.points) {
        // 1. Scale from normalized [-1, 1] to ILDA range
        let scaledX = point.x * 32767;
        let scaledY = point.y * 32767;

        // 2. Clamp to the valid signed 16-bit range
        const finalX = Math.max(-32767, Math.min(32767, Math.round(scaledX)));
        const finalY = Math.max(-32767, Math.min(32767, Math.round(scaledY)));

        // 3. Write as signed 16-bit Big Endian
        packet.writeInt16BE(finalX, offset);
        offset += 2;
        packet.writeInt16BE(finalY, offset);
        offset += 2;
        
        packet.writeUInt8(point.r, offset++);
        packet.writeUInt8(point.g, offset++);
        packet.writeUInt8(point.b, offset++);
        packet.writeUInt8(point.i !== undefined ? point.i : 255, offset++);
    }

    socket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip, (err) => {
        if (err) {
            console.error(`IDN sendFrame error to ${ip}:`, err);
        }
    });
}

function getDacServices(ip, localIp, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const services = [];
    const serviceSocket = dgram.createSocket('udp4');

    serviceSocket.on('error', (err) => {
      console.error(`IDN service discovery socket error for ${ip}:`, err);
      serviceSocket.close();
      reject(err);
    });

    serviceSocket.on('message', (msg, rinfo) => {
      if (rinfo.address === ip && msg.readUInt8(0) === IDNCMD_SERVICEMAP_RESPONSE) {
        const parsedServices = parseServiceMapResponse(msg);
        if (parsedServices) {
          services.push(...parsedServices);
        }
      }
    });

    const bindOptions = {};
    if (localIp) {
      bindOptions.address = localIp;
    }

    serviceSocket.bind(bindOptions, () => {
      const packet = Buffer.alloc(4);
      packet.writeUInt8(IDNCMD_SERVICEMAP_REQUEST, 0);
      packet.writeUInt8(0, 1);
      packet.writeUInt16BE(generalSequence++, 2);

      serviceSocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip, (err) => {
        if (err) {
          console.error(`IDN service map request send error to ${ip}:`, err);
          serviceSocket.close();
          reject(err);
        }
      });
    });

    setTimeout(() => {
      serviceSocket.close();
      resolve(services);
    }, timeout);
  });
}

function parseServiceMapResponse(msg) {
  try {
    if (msg.length < 8 || msg.readUInt8(0) !== IDNCMD_SERVICEMAP_RESPONSE) {
        return null;
    }
    
    let offset = 4;

    const entrySize = msg.readUInt8(offset + 1);
    const relayEntryCount = msg.readUInt8(offset + 2);
    const serviceEntryCount = msg.readUInt8(offset + 3);

    offset += 4;

    const services = [];

    offset += (relayEntryCount * entrySize);

    for (let i = 0; i < serviceEntryCount; i++) {
      if (offset + entrySize > msg.length) {
        break;
      }
      const serviceEntryOffset = offset;
      const serviceID = msg.readUInt8(serviceEntryOffset);
      const name = msg.slice(serviceEntryOffset + 4, serviceEntryOffset + 24).toString('utf8').replace(/\0/g, '').trim();
      
      offset += entrySize;

      services.push({
        serviceID,
        name,
      });
    }
    return services;

  } catch (error) {
    console.error('Error parsing IDN service map response:', error);
    return null;
  }
}

module.exports = {
    discoverDacs,
    sendFrame,
    getDacServices,
};