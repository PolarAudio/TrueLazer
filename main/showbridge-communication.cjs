const dgram = require('dgram');
const { Buffer } = require('buffer');
const os = require('os');

// =============== CONSTANTS ===============
const DAC_PORT = 8089;
const DISCOVERY_BROADCAST_PORT = 8089;
const NATIVE_RESPONSE_PORT = 8099;

// Wire format constants (from DAC firmware + Truwave.exe Ghidra reversal)
const UDP_PACKET_SIZE = 0x1204;          // 4612 bytes per chunk
const HEADER_SIZE = 4;                   // 4-byte header
const POINT_SIZE = 8;                    // 8-byte wire format point
const CHUNKS_PER_FRAME = 3;              // Matches Truwave capture (fewer fragments = less loss)
const PTS_PER_CHUNK = 575;               // Real points per chunk
const MAX_FRAME_POINTS = CHUNKS_PER_FRAME * PTS_PER_CHUNK;  // 1725

// Type tag
const DAC_TYPE = 'Showbridge';

// =============== STATE ===============
let globalStatusCallback = null;
let sendIntervals = new Map();
let discoveryCache = new Map();

// =============== HELPERS ===============
function setStatusCallback(cb) {
    globalStatusCallback = cb;
}

function getPrimaryIp() {
    const interfaces = os.networkInterfaces();
    for (const k in interfaces) {
        for (const addr of interfaces[k]) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return '127.0.0.1';
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function log(...args) {
    console.log(`[Showbridge]`, ...args);
}

// =============== NATIVE HARDWARE DISCOVERY (port 8089) ===============
async function discoverDacs(timeout = 3000) {
    return new Promise((resolve) => {
        discoveryCache.clear();

        const interfaces = os.networkInterfaces();
        const discovered = [];
        const sockets = [];

        const ifaces = [];
        for (const k in interfaces) {
            for (const addr of interfaces[k]) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    ifaces.push({ name: k, ip: addr.address });
                }
            }
        }

        if (ifaces.length === 0) {
            resolve(discovered);
            return;
        }

        let readyCount = 0;
        for (const iface of ifaces) {
            const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            sockets.push(sock);

            sock.on('message', (msg, rinfo) => {
                if (msg.length < 16) return;

                const vendor = (msg.readUInt8(0) << 8) | msg.readUInt8(1);
                const type = msg.readUInt8(2);
                const channel = msg.readUInt8(3);
                const hwId = msg.readUInt32BE(4);

                const dac = {
                    ip: rinfo.address,
                    port: rinfo.port,
                    vendorId: vendor,
                    type: type,
                    channel: channel,
                    deviceId: hwId.toString(16).padStart(8, '0'),
                    name: `Showbridge CH${channel}`,
                    rawResponse: msg.toString('hex'),
                    framePort: DAC_PORT,
                    protocol: 'Showbridge'
                };

                if (!discoveryCache.has(dac.ip)) {
                    discoveryCache.set(dac.ip, {
                        channels: new Set(),
                        vendorId: dac.vendorId,
                        deviceId: dac.deviceId,
                        name: dac.name,
                    });
                }
                discoveryCache.get(dac.ip).channels.add(dac.channel);

                const key = `${dac.ip}:${dac.channel}`;
                if (!discovered.find(d => `${d.ip}:${d.channel}` === key)) {
                    discovered.push(dac);
                }
            });

            sock.on('error', () => {});

            const ipParts = iface.ip.split('.').map(Number);
            const cmd = Buffer.alloc(6);
            cmd.writeUInt8(ipParts[0], 0);
            cmd.writeUInt8(ipParts[1], 1);
            cmd.writeUInt8(ipParts[2], 2);
            cmd.writeUInt8(ipParts[3], 3);
            cmd.writeUInt8(0xa3, 4);
            cmd.writeUInt8(0x1f, 5);

            sock.bind(NATIVE_RESPONSE_PORT, iface.ip, () => {
                sock.setBroadcast(true);
                sock.send(cmd, 0, cmd.length, DISCOVERY_BROADCAST_PORT, '255.255.255.255');
                readyCount++;
                if (readyCount >= ifaces.length) {
                    setTimeout(() => {
                        for (const s of sockets) { try { s.close(); } catch (e) {} }
                        resolve(discovered);
                    }, timeout);
                }
            });
        }
    });
}

// =============== DAC SERVICES ===============
function getDacServices(ip) {
    const cached = discoveryCache.get(ip);
    if (!cached || cached.channels.size === 0) {
        return Promise.resolve([{ serviceID: 0, name: 'Main' }]);
    }
    const services = [];
    for (const ch of cached.channels) {
        services.push({
            serviceID: ch,
            name: `Channel ${ch}`,
        });
    }
    return Promise.resolve(services);
}

// =============== FRAME SENDING (correct wire format) ===============

/**
 * Convert float points [-1..1] to Showbridge DAC frame packets.
 *
 * DAC firmware wire format (port 8089):
 *
 *   Packet (0x1204 = 4612 bytes):
 *     [0] total_chunks (MUST be 5)
 *     [1] chunk_index (0-4)
 *     [2] seq_counter (same for all chunks in a frame, +1 per frame)
 *     [3] type (0x00=CH1, 0x01=CH2)
 *     [4-7]   controller area (4 bytes): [laser_ctrl_low][laser_ctrl_high][0][PPS]
 *             chunk 0: laser_ctrl set, chunks 1-4: laser_ctrl=0 (dummy/boundary)
 *     [8-4607] real points: 575 × 8 = 4600 bytes
 *              int16 LE x, int16 LE y, u8 blanking, u8 r, u8 g, u8 b
 *              blanking: 0=DARK, non-zero=LIT
 *     [4608-4611] padding (4 bytes, zeroed)
 *
 *   Frame ready: DAC copies 0x1200 bytes (4 + 4600 + 4) per non-last chunk.
 *   Last chunk (4): firmware copies only 0x624 bytes = 4 + 196×8 (no padding copied).
 *
 *   Boundary points: 4 control bytes of chunk N become blanking/r/g/b of the
 *   virtual boundary point. Setting byte[4]=0x00 in chunks 1-4 keeps them DARK.
 *
 *   Chunks per frame: 3 (matches Truwave captures).
 */
function sendFrame(ip, channel, points, fps) {
    if (!points || points.length === 0) return;

    let numPoints;
    let srcPoints;

    if (points instanceof Float32Array) {
        numPoints = Math.floor(points.length / 8);
        srcPoints = points;
    } else if (Array.isArray(points)) {
        numPoints = points.length;
        srcPoints = points;
    } else {
        return;
    }

    numPoints = Math.min(numPoints, MAX_FRAME_POINTS);
    if (numPoints === 0) return;

    const pps = Math.round(clamp(fps || 30, 1, 255));
    const channelType = (channel === 2) ? 0x01 : 0x00;
    const laserCtrl = 0x01D2;  // non-zero = laser ON

    const chunks = [];
    for (let ci = 0; ci < CHUNKS_PER_FRAME; ci++) {
        const buf = Buffer.alloc(UDP_PACKET_SIZE);

        // 4-byte header
        buf.writeUInt8(CHUNKS_PER_FRAME, 0);
        buf.writeUInt8(ci, 1);
        buf.writeUInt8(0, 2);
        buf.writeUInt8(channelType, 3);

        if (ci === 0) {
            buf.writeInt16LE(laserCtrl, 4);
        } else {
            buf.writeInt16LE(0, 4);
        }
        buf.writeUInt8(0, 6);
        buf.writeUInt8(pps, 7);

        for (let i = 0; i < PTS_PER_CHUNK; i++) {
            const srcIdx = ci * PTS_PER_CHUNK + i;
            let x, y, blanking, r, g, b;

            if (srcIdx >= numPoints) {
                x = 0; y = 0; blanking = 0; r = 0; g = 0; b = 0;
            } else if (srcPoints instanceof Float32Array) {
                const off = srcIdx * 8;
                x = srcPoints[off];
                y = srcPoints[off + 1];
                r = srcPoints[off + 3];
                g = srcPoints[off + 4];
                b = srcPoints[off + 5];
                blanking = srcPoints[off + 6] > 0.5 ? 0xFF : 0;
            } else {
                x = srcPoints[srcIdx].x || 0;
                y = srcPoints[srcIdx].y || 0;
                r = srcPoints[srcIdx].r || 0;
                g = srcPoints[srcIdx].g || 0;
                b = srcPoints[srcIdx].b || 0;
                blanking = srcPoints[srcIdx].blanking ? 0xFF : 0;
            }

            x = clamp(x, -1.0, 1.0);
            y = clamp(y, -1.0, 1.0);
            const ix = Math.round((x + 1.0) * 2047.5);
            const iy = Math.round((y + 1.0) * 2047.5);

            if (r > 1.0) r = r / 255;
            if (g > 1.0) g = g / 255;
            if (b > 1.0) b = b / 255;
            r = clamp(r, 0, 1.0);
            g = clamp(g, 0, 1.0);
            b = clamp(b, 0, 1.0);

            const poff = HEADER_SIZE + 4 + i * POINT_SIZE;  // byte 8 + i*8
            buf.writeInt16LE(ix, poff);
            buf.writeInt16LE(iy, poff + 2);
            buf.writeUInt8(blanking, poff + 4);
            buf.writeUInt8(Math.round(r * 255), poff + 5);
            buf.writeUInt8(Math.round(g * 255), poff + 6);
            buf.writeUInt8(Math.round(b * 255), poff + 7);
        }
        chunks.push(buf);
    }

    // Send frames at the requested rate
    const targetPort = DAC_PORT;
    const socket = dgram.createSocket('udp4');
    let frameSeq = 0;
    let running = true;

    const intervalMs = Math.round(1000 / pps);
    const timer = setInterval(() => {
        if (!running) return;

        for (let ci = 0; ci < CHUNKS_PER_FRAME; ci++) {
            chunks[ci].writeUInt8(frameSeq, 2);  // set seq counter
            socket.send(chunks[ci], 0, UDP_PACKET_SIZE, targetPort, ip);
        }

        frameSeq = (frameSeq + 1) & 0xFF;
    }, intervalMs);

    const ipKey = `${ip}:${channel}`;
    const oldTimer = sendIntervals.get(ipKey);
    if (oldTimer) clearInterval(oldTimer);
    sendIntervals.set(ipKey, { timer, socket, running: () => running });

    log(`Streaming to ${ip}:${targetPort} CH${channel} at ${pps}fps`);

    return { stop: () => { running = false; clearInterval(timer); try { socket.close(); } catch (e) {} } };
}

// =============== HEARTBEAT ===============
// Sends a 6-byte heartbeat to register our IP with the DAC.
// The DAC records the sender IP and sends status responses.
function sendHeartbeat(ip) {
    const socket = dgram.createSocket('udp4');
    const localIp = getPrimaryIp();
    const ipParts = localIp.split('.').map(Number);
    const buf = Buffer.alloc(6);
    buf.writeUInt8(0x03, 0);  // type = heartbeat
    buf.writeUInt8(ipParts[0], 1);
    buf.writeUInt8(ipParts[1], 2);
    buf.writeUInt8(ipParts[2], 3);
    buf.writeUInt8(ipParts[3], 4);
    buf.writeUInt8(0, 5);     // padding
    socket.send(buf, 0, 6, DAC_PORT, ip, () => {
        socket.close();
    });
}

// =============== STOP / CLEANUP ===============
function stopSending(ip) {
    for (const [key, state] of sendIntervals) {
        if (key.startsWith(ip + ':')) {
            state.running = false;
            clearInterval(state.timer);
            try { state.socket.close(); } catch (e) {}
            sendIntervals.delete(key);
            log(`Stopped sending to ${key}`);
        }
    }
}

function closeAll() {
    for (const [key, state] of sendIntervals) {
        state.running = false;
        clearInterval(state.timer);
        try { state.socket.close(); } catch (e) {}
    }
    sendIntervals.clear();
    discoveryCache.clear();
}

// =============== EXPORTS ===============
module.exports = {
    discoverDacs,
    getDacServices,
    sendFrame,
    sendHeartbeat,
    stopSending,
    closeAll,
    setStatusCallback,
};
