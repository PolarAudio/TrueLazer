const dgram = require('dgram');

// IDN Protocol Constants from idn-hello.h and idn-stream.h
const IDN_HELLO_UDP_PORT = 7255;
const IDN_CMD_SCAN_REQUEST = 0x10;
const IDN_CMD_SCAN_RESPONSE = 0x11;
const IDN_CMD_RT_CNLMSG = 0x40;
const IDN_CMD_RT_CNLMSG_CLOSE = 0x44;

const IDNFLG_CONTENTID_CHANNELMSG = 0x8000;
const IDNMSK_CONTENTID_CHANNELID = 0x3F00;
const IDNVAL_CNKTYPE_LPGRF_FRAME = 0x02;
const IDNVAL_SMOD_LPGRF_DISCRETE = 0x02;
const IDNFLG_CHNCFG_ROUTING = 0x01;
const IDNFLG_CHNCFG_CLOSE = 0x02;


// Helper to convert C struct to Node.js Buffer
// For simplicity, we'll manually create buffers for now.
// A more robust solution might use a library for struct packing/unpacking.

let idnSequenceNumber = 0; // Global sequence number for IDN packets

const startTime = process.hrtime.bigint();

function getMonotonicTimeUS() {
    const diff = process.hrtime.bigint() - startTime;
    return Number(diff / 1000n); // Convert nanoseconds to microseconds
}

/**
 * Constructs an IDN Scan Request packet.
 * @param {number} sequence - The sequence number for the packet.
 * @param {number} clientGroup - The client group (0-15).
 * @returns {Buffer} The constructed UDP packet.
 */
function createScanRequestPacket(sequence, clientGroup = 0) {
    // IDNHDR_PACKET structure:
    // uint8_t command;
    // uint8_t flags; (Lower 4 bits: client group)
    // uint16_t sequence; (Network byte order - big-endian)

    const buffer = Buffer.alloc(4); // 1 byte command + 1 byte flags + 2 bytes sequence
    buffer.writeUInt8(IDN_CMD_SCAN_REQUEST, 0);
    buffer.writeUInt8(clientGroup & 0x0F, 1); // Ensure only lower 4 bits are used
    buffer.writeUInt16BE(sequence, 2); // Write sequence in Big Endian (network byte order)
    return buffer;
}

/**
 * Parses an IDN Scan Response packet.
 * @param {Buffer} buffer - The incoming UDP packet buffer.
 * @returns {object|null} Parsed DAC information or null if invalid.
 */
function parseScanResponsePacket(buffer) {
    // Basic validation: must be at least the size of IDNHDR_PACKET + IDNHDR_SCAN_RESPONSE
    // IDNHDR_PACKET: 4 bytes
    // IDNHDR_SCAN_RESPONSE: (structSize, protocolVersion, status, reserved, unitID[16], hostName[20])
    // Minimum size is 4 (packet header) + 40 (scan response header) = 44 bytes

    if (buffer.length < 44) {
        console.warn('Received IDN scan response too short:', buffer.length);
        return null;
    }

    const command = buffer.readUInt8(0);
    const flags = buffer.readUInt8(1);
    const sequence = buffer.readUInt16BE(2);

    if (command !== IDN_CMD_SCAN_RESPONSE) {
        return null; // Not a scan response
    }

    // Parse IDNHDR_SCAN_RESPONSE starting at offset 4
    const structSize = buffer.readUInt8(4);
    const protocolVersion = buffer.readUInt8(5);
    const status = buffer.readUInt8(6);
    // const reserved = buffer.readUInt8(7); // Reserved byte

    const unitIDLength = buffer.readUInt8(8); // unitID[0] stores length
    let unitID = '';
    if (unitIDLength > 0 && unitIDLength <= 15) { // Max 15 bytes for ID, plus 1 for length byte
        // Convert UnitID bytes to hex string for display
        for (let i = 0; i < unitIDLength; i++) {
            unitID += buffer.readUInt8(9 + i).toString(16).padStart(2, '0').toUpperCase();
            if (i < unitIDLength - 1) unitID += ':'; // Add colon between bytes
        }
    }

    // Hostname starts after unitID (9 + 16 bytes for unitID array size)
    // HostName is 20 bytes long
    const hostNameOffset = 9 + 16;
    const hostNameBuffer = buffer.subarray(hostNameOffset, hostNameOffset + 20);
    const hostName = hostNameBuffer.toString('ascii').replace(/\0.*$/g, ''); // Trim null bytes

    return {
        command,
        flags,
        sequence,
        structSize,
        protocolVersion,
        status,
        unitID,
        hostName,
        ipAddress: '', // Will be filled by the discovery logic
        port: IDN_HELLO_UDP_PORT
    };
}

/**
 * Discovers IDN DACs on the network.
 * @param {number} timeoutMs - How long to wait for responses in milliseconds.
 * @returns {Promise<Array<object>>} A promise that resolves with an array of discovered DACs.
 */
function discoverDacs(timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const discoveredDacs = new Map(); // Use Map to store unique DACs by UnitID

        // Enable broadcast
        socket.bind(() => {
            socket.setBroadcast(true);
        });

        socket.on('message', (msg, rinfo) => {
            // console.log(`Received message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
            const dacInfo = parseScanResponsePacket(msg);
            if (dacInfo && dacInfo.unitID && !discoveredDacs.has(dacInfo.unitID)) {
                // Attach IP address from rinfo
                dacInfo.ipAddress = rinfo.address;
                discoveredDacs.set(dacInfo.unitID, dacInfo);
                console.log('Discovered IDN DAC:', dacInfo);
            }
        });

        socket.on('error', (err) => {
            console.error('UDP socket error:', err);
            socket.close();
            reject(err);
        });

        // Send scan request repeatedly until timeout
        let sequence = 0;
        const sendScanRequest = () => {
            const packet = createScanRequestPacket(sequence++, 0); // Client group 0
            socket.send(packet, IDN_HELLO_UDP_PORT, '255.255.255.255', (err) => {
                if (err) console.error('Error sending scan request:', err);
            });
        };

        const interval = setInterval(sendScanRequest, 200); // Send every 200ms
        sendScanRequest(); // Send initial request immediately

        // Timeout to stop listening and resolve the promise
        setTimeout(() => {
            clearInterval(interval);
            socket.close();
            resolve(Array.from(discoveredDacs.values()));
        }, timeoutMs);
    });
}

/**
 * Sends an IDN frame to a specific DAC.
 * @param {string} ipAddress - The IP address of the target DAC.
 * @param {number} channelId - The channel ID (0-63).
 * @param {Array<object>} points - Array of point objects {x, y, r, g, b, blanking}.
 * @param {number} [frameDuration=33333] - Duration of the frame in microseconds (default 30fps).
 * @param {number} [serviceId=1] - The IDN service ID to target.
 */
function sendFrame(ipAddress, channelId, points, frameDuration = 33333, serviceId = 1) {
    const socket = dgram.createSocket('udp4');
    
    // IDNHDR_PACKET (4 bytes)
    const packetHeader = Buffer.alloc(4);
    packetHeader.writeUInt8(IDN_CMD_RT_CNLMSG, 0); // Command
    packetHeader.writeUInt8(0, 1); // Flags (client group 0)
    packetHeader.writeUInt16BE(idnSequenceNumber++, 2); // Sequence

    // IDNHDR_CHANNEL_MESSAGE (8 bytes)
    const channelMessageHeader = Buffer.alloc(8);
    // totalSize will be calculated later
    let contentID = IDNFLG_CONTENTID_CHANNELMSG | ((channelId << 8) & IDNMSK_CONTENTID_CHANNELID) | IDNVAL_CNKTYPE_LPGRF_FRAME;
    channelMessageHeader.writeUInt16BE(contentID, 2); // contentID
    channelMessageHeader.writeUInt32BE(getMonotonicTimeUS(), 4); // timestamp

    // IDNHDR_CHANNEL_CONFIG (optional, for configuring the channel) (4 bytes)
    // Only send periodically or on change. For simplicity, send always for now.
    const channelConfigHeader = Buffer.alloc(4);
    channelConfigHeader.writeUInt8(4, 0); // wordCount (4 for XYRGB descriptors)
    channelConfigHeader.writeUInt8(IDNFLG_CHNCFG_ROUTING, 1); // flags
    channelConfigHeader.writeUInt8(serviceId, 2); // serviceID
    channelConfigHeader.writeUInt8(IDNVAL_SMOD_LPGRF_DISCRETE, 3); // serviceMode

    // Standard IDTF-to-IDN descriptors (8 * 2 = 16 bytes)
    const descriptors = Buffer.alloc(16);
    descriptors.writeUInt16BE(0x4200, 0); // X
    descriptors.writeUInt16BE(0x4010, 2); // 16 bit precision
    descriptors.writeUInt16BE(0x4210, 4); // Y
    descriptors.writeUInt16BE(0x4010, 6); // 16 bit precision
    descriptors.writeUInt16BE(0x527E, 8); // Red, 638 nm
    descriptors.writeUInt16BE(0x5214, 10); // Green, 532 nm
    descriptors.writeUInt16BE(0x51CC, 12); // Blue, 460 nm
    descriptors.writeUInt16BE(0x0000, 14); // Void for alignment

    // IDNHDR_SAMPLE_CHUNK (4 bytes)
    const sampleChunkHeader = Buffer.alloc(4);
    sampleChunkHeader.writeUInt32BE(frameDuration, 0); // flagsDuration (duration for now)

    // Raw Sample Data (XYRGB points)
    const XYRGB_SAMPLE_SIZE = 8; // 2x X, 2x Y, 1x R, 1x G, 1x B, 1x I
    const samplesBuffer = Buffer.alloc(points.length * XYRGB_SAMPLE_SIZE);
    let offset = 0;

    for (const point of points) {
        const x_int16 = Math.round(point.x * 32767);
        const y_int16 = Math.round(point.y * 32767);
        const intensity = point.blanking ? 0 : 255;

        samplesBuffer.writeInt16LE(x_int16, offset);
        offset += 2;
        samplesBuffer.writeInt16LE(y_int16, offset);
        offset += 2;
        samplesBuffer.writeUInt8(point.r, offset);
        offset += 1;
        samplesBuffer.writeUInt8(point.g, offset);
        offset += 1;
        samplesBuffer.writeUInt8(point.b, offset);
        offset += 1;
        samplesBuffer.writeUInt8(intensity, offset);
        offset += 1;
    }

    const channelMessagePayload = Buffer.concat([
        channelConfigHeader,
        descriptors,
        sampleChunkHeader,
        samplesBuffer
    ]);

    // Update totalSize in channel message header
    channelMessageHeader.writeUInt16BE(channelMessagePayload.length, 0);

    const fullPacket = Buffer.concat([
        packetHeader,
        channelMessageHeader,
        channelMessagePayload
    ]);

    socket.send(fullPacket, IDN_HELLO_UDP_PORT, ipAddress, (err) => {
        if (err) console.error(`Error sending IDN frame to ${ipAddress}:`, err);
        socket.close();
    });
}

/**
 * Sends an IDN Close Channel message.
 * @param {string} ipAddress - The IP address of the target DAC.
 * @param {number} channelId - The channel ID (0-63).
 * @param {number} [clientGroup=0] - The client group (0-15).
 */
function sendCloseChannel(ipAddress, channelId, clientGroup = 0) {
    const socket = dgram.createSocket('udp4');

    // IDNHDR_PACKET (4 bytes) for CLOSE command
    const packetHeader = Buffer.alloc(4);
    packetHeader.writeUInt8(IDN_CMD_RT_CNLMSG_CLOSE, 0);
    packetHeader.writeUInt8(clientGroup & 0x0F, 1);
    packetHeader.writeUInt16BE(idnSequenceNumber++, 2);

    // IDNHDR_CHANNEL_MESSAGE (8 bytes)
    const channelMessageHeader = Buffer.alloc(8);
    let contentID = IDNFLG_CONTENTID_CHANNELMSG | ((channelId << 8) & IDNMSK_CONTENTID_CHANNELID) | IDNVAL_CNKTYPE_LPGRF_FRAME; // Chunk type doesn't really matter for close
    channelMessageHeader.writeUInt16BE(0, 0); // totalSize = 0 for close config
    channelMessageHeader.writeUInt16BE(contentID, 2);
    channelMessageHeader.writeUInt32BE(getMonotonicTimeUS(), 4); // timestamp

    // IDNHDR_CHANNEL_CONFIG (4 bytes) for closing the channel
    const channelConfigHeader = Buffer.alloc(4);
    channelConfigHeader.writeUInt8(0, 0); // wordCount = 0
    channelConfigHeader.writeUInt8(IDNFLG_CHNCFG_CLOSE, 1); // flags to close
    channelConfigHeader.writeUInt8(0, 2); // serviceID = 0 (ignored for close)
    channelConfigHeader.writeUInt8(0, 3); // serviceMode = 0 (ignored for close)

    const channelMessagePayload = Buffer.concat([
        channelConfigHeader
    ]);

    // Update totalSize in channel message header
    channelMessageHeader.writeUInt16BE(channelMessagePayload.length, 0);

    const fullPacket = Buffer.concat([
        packetHeader,
        channelMessageHeader,
        channelMessagePayload
    ]);

    socket.send(fullPacket, IDN_HELLO_UDP_PORT, ipAddress, (err) => {
        if (err) console.error(`Error sending IDN close channel to ${ipAddress}:`, err);
        socket.close();
    });
}


module.exports = {
    discoverDacs,
    sendFrame,
    sendCloseChannel,
    createScanRequestPacket,
    parseScanResponsePacket,
    IDN_HELLO_UDP_PORT,
    IDN_CMD_SCAN_REQUEST,
    IDN_CMD_SCAN_RESPONSE
};