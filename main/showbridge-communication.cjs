const dgram = require('dgram');
const { Buffer } = require('buffer');
const os = require('os');

// =============== CONSTANTS ===============
const DAC_PORT = 8089;
const DISCOVERY_BROADCAST_PORT = 8089;
const NATIVE_RESPONSE_PORT = 8099;

const UDP_PACKET_SIZE = 0x1204;          // 4612 bytes
const HEADER_SIZE = 4;
const POINT_SIZE = 8;
const PTS_FULL = 575;                    // points per full chunk (chunk 0)
const CHUNK_STAGGER_MS = 3;
const MAX_CHUNKS = 2;   // max data chunks. 2×575=1150 pts @ 60fps → PPS=69. Firmware buffer: 2×575×8=9200 < 20004.
const PPS = 30;

const DAC_TYPE = 'Showbridge';

// =============== STATE ===============
let globalStatusCallback = null;
let discoveryCache = new Map();

// Per-channel state
//   "ip:channel" -> { socket, pendingTimer, heartbeatSent, running }
const channelState = new Map();

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

// =============== PACKET BUILDING ===============

function buildFrameChunks(chType, pps, points) {
    const isTyped = points instanceof Float32Array;
    const totalPoints = isTyped ? Math.floor(points.length / 8) : (points ? points.length : 0);
    if (totalPoints === 0) return [];

    const ptsPerChunk = PTS_FULL;                           // 575
    const numChunks = Math.min(Math.ceil(totalPoints / ptsPerChunk), MAX_CHUNKS);
    const chunks = [];
    let pointOffset = 0;

    // No completion chunk — seq change between frames signals the boundary
    for (let ci = 0; ci < numChunks; ci++) {
        const buf = Buffer.alloc(UDP_PACKET_SIZE);
        buf.writeUInt8(numChunks, 0);                       // total_chunks = actual count
        buf.writeUInt8(ci, 1);                               // chunk_index
        buf.writeUInt8(0, 2);                                // seq (set by caller)
        buf.writeUInt8(chType, 3);                           // type
        buf.writeInt16LE(0x01D2, 4);                         // laser_ctrl = ON
        buf.writeUInt8(0, 6);
        buf.writeUInt8(pps, 7);

        const ptsInChunk = Math.min(totalPoints - pointOffset, ptsPerChunk);
        let lastX = 0, lastY = 0;

        for (let i = 0; i < ptsPerChunk; i++) {
            const off = HEADER_SIZE + 4 + i * POINT_SIZE;
            let x = 0, y = 0, blanking = 1, r = 0, g = 0, b = 0;

            if (i < ptsInChunk) {
                const pi = pointOffset + i;
                if (isTyped) {
                    const poff = pi * 8;
                    x = points[poff] || 0;
                    y = points[poff + 1] || 0;
                    r = points[poff + 3] || 0;
                    g = points[poff + 4] || 0;
                    b = points[poff + 5] || 0;
                    blanking = (points[poff + 6] || 0) > 0.5 ? 1 : 0;
                } else {
                    const p = points[pi];
                    if (p instanceof Float32Array || Array.isArray(p)) {
                        x = p[0] || 0;
                        y = p[1] || 0;
                        r = p[3] || 0;
                        g = p[4] || 0;
                        b = p[5] || 0;
                        blanking = (p[6] || 0) > 0.5 ? 1 : 0;
                    } else if (typeof p === 'object') {
                        x = p.x || 0;
                        y = p.y || 0;
                        r = p.r || 0;
                        g = p.g || 0;
                        b = p.b || 0;
                        blanking = p.blanking ? 1 : 0;
                    }
                }

                x = clamp(x, -1.0, 1.0);
                y = clamp(y, -1.0, 1.0);
                lastX = x;
                lastY = y;
                if (r > 1) r /= 255;
                if (g > 1) g /= 255;
                if (b > 1) b /= 255;
                r = clamp(r, 0, 1);
                g = clamp(g, 0, 1);
                b = clamp(b, 0, 1);
            } else {
                x = lastX;
                y = lastY;
            }

            const dacBlanking = blanking > 0.5 ? 0 : 0xFF;

            const ix = Math.round((x + 1.0) * 2047.5);
            const iy = Math.round((y + 1.0) * 2047.5);
            buf.writeInt16LE(ix, off);
            buf.writeInt16LE(iy, off + 2);
            buf.writeUInt8(dacBlanking, off + 4);
            buf.writeUInt8(Math.round(r * 255), off + 5);
            buf.writeUInt8(Math.round(g * 255), off + 6);
            buf.writeUInt8(Math.round(b * 255), off + 7);
        }

        pointOffset += ptsInChunk;
        chunks.push(buf);
    }

    return chunks;
}

// =============== NATIVE DISCOVERY ===============
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

// =============== HEARTBEAT ===============
function sendHeartbeat(ip) {
    const socket = dgram.createSocket('udp4');
    const localIp = getPrimaryIp();
    const ipParts = localIp.split('.').map(Number);
    const buf = Buffer.alloc(6);
    buf.writeUInt8(0x03, 0);
    buf.writeUInt8(ipParts[0], 1);
    buf.writeUInt8(ipParts[1], 2);
    buf.writeUInt8(ipParts[2], 3);
    buf.writeUInt8(ipParts[3], 4);
    buf.writeUInt8(0, 5);
    socket.send(buf, 0, 6, DAC_PORT, ip, () => {
        socket.close();
    });
}

// =============== FRAME SENDING ===============

function sendFrame(ip, channel, points, fps, type, options) {
    const key = `${ip}:${channel}`;
    const chType = channel === 2 ? 0x01 : 0x00;
    const pps = (options && options.pps != null) ? options.pps : PPS;

    // Get or create per-channel state
    let st = channelState.get(key);
    if (!st) {
        st = {
            socket: dgram.createSocket('udp4'),
            pendingTimers: [],
            heartbeatSent: false,
            running: true,
            seq: 0,
        };
        st.socket.on('error', () => {});
        channelState.set(key, st);
    }

    if (!st.running) return;

    // Send heartbeat once per channel session
    if (!st.heartbeatSent) {
        sendHeartbeat(ip);
        st.heartbeatSent = true;
    }

    // Cancel any pending chunk sends from previous frame
    for (const t of st.pendingTimers) {
        clearTimeout(t);
    }
    st.pendingTimers = [];

    // Build all chunks for this frame
    const chunks = buildFrameChunks(chType, pps, points);
    if (chunks.length === 0) return;

    const seq = st.seq & 0xFF;
    st.seq = (st.seq + 1) & 0xFF;

    // Set seq on all chunks
    for (const c of chunks) {
        c.writeUInt8(seq, 2);
    }

    // Send chunk 0 immediately
    try {
        st.socket.send(chunks[0], 0, UDP_PACKET_SIZE, DAC_PORT, ip);
    } catch (e) {
        log(`send error on ${key}: ${e.message}`);
        return;
    }

    // Schedule remaining chunks with stagger
    for (let i = 1; i < chunks.length; i++) {
        const delay = i * CHUNK_STAGGER_MS;
        const timer = setTimeout(() => {
            if (!st.running) return;
            try {
                st.socket.send(chunks[i], 0, UDP_PACKET_SIZE, DAC_PORT, ip);
            } catch (e) {
                log(`send error on ${key}: ${e.message}`);
            }
            const idx = st.pendingTimers.indexOf(timer);
            if (idx >= 0) st.pendingTimers.splice(idx, 1);
        }, delay);
        st.pendingTimers.push(timer);
    }
}

// =============== BLANK FRAME ===============
function sendBlankFrame(ip, channel) {
    const key = `${ip}:${channel}`;
    const chType = channel === 2 ? 0x01 : 0x00;

    const socket = dgram.createSocket('udp4');
    socket.on('error', () => {});

    // Build blank frame: chunk 0 with center-dark points + laser OFF, chunk 1 completion
    const buf0 = Buffer.alloc(UDP_PACKET_SIZE);
    buf0.writeUInt8(2, 0);
    buf0.writeUInt8(0, 1);
    buf0.writeUInt8(0, 2);
    buf0.writeUInt8(chType, 3);
    buf0.writeInt16LE(0, 4);     // laser_ctrl = OFF
    buf0.writeUInt8(0, 6);
    buf0.writeUInt8(PPS, 7);
    for (let i = 0; i < PTS_FULL; i++) {
        const off = HEADER_SIZE + 4 + i * POINT_SIZE;
        const ix = Math.round((0 + 1.0) * 2047.5);
        const iy = Math.round((0 + 1.0) * 2047.5);
        buf0.writeInt16LE(ix, off);
        buf0.writeInt16LE(iy, off + 2);
        buf0.writeUInt8(0, off + 4);
        buf0.writeUInt8(0, off + 5);
        buf0.writeUInt8(0, off + 6);
        buf0.writeUInt8(0, off + 7);
    }

    const buf1 = Buffer.alloc(UDP_PACKET_SIZE);
    buf1.writeUInt8(2, 0);
    buf1.writeUInt8(1, 1);
    buf1.writeUInt8(0, 2);
    buf1.writeUInt8(chType, 3);
    buf1.writeInt16LE(0, 4);
    buf1.writeUInt8(0, 6);
    buf1.writeUInt8(PPS, 7);

    let closed = false;
    socket.send(buf0, 0, UDP_PACKET_SIZE, DAC_PORT, ip, () => {
        setTimeout(() => {
            if (closed) return;
            socket.send(buf1, 0, UDP_PACKET_SIZE, DAC_PORT, ip, () => {
                setTimeout(() => {
                    if (!closed) { closed = true; try { socket.close(); } catch (e) {} }
                }, 10);
            });
        }, CHUNK_STAGGER_MS);
    });
}

// =============== STOP / CLEANUP ===============
function stopSending(ip) {
    for (const [key, st] of channelState) {
        if (!key.startsWith(ip + ':')) continue;

        st.running = false;

        // Cancel all pending chunk timers
        for (const t of st.pendingTimers) {
            clearTimeout(t);
        }
        st.pendingTimers = [];

        // Send blank frames to turn off laser
        const ch = parseInt(key.split(':')[1], 10);
        sendBlankFrame(ip, ch);

        // Close the socket
        try { st.socket.close(); } catch (e) {}

        channelState.delete(key);
        log(`Stopped sending to ${key}`);
    }
}

function closeAll() {
    for (const [key, st] of channelState) {
        st.running = false;

        for (const t of st.pendingTimers) {
            clearTimeout(t);
        }
        st.pendingTimers = [];

        // Send blank frames before closing
        const [ip, chStr] = key.split(':');
        const ch = parseInt(chStr, 10);
        sendBlankFrame(ip, ch);

        try { st.socket.close(); } catch (e) {}
    }
    channelState.clear();
    discoveryCache.clear();
    log('All Showbridge channels closed');
}

// =============== EXPORTS ===============
module.exports = {
    discoverDacs,
    getDacServices,
    sendFrame,
    sendHeartbeat,
    sendBlankFrame,
    stopSending,
    closeAll,
    setStatusCallback,
};
