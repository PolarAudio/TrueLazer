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
const PTS_FULL = 575;                    // points per full chunk (chunk 0); also the bench-verified point cap
const CHUNK_STAGGER_MS = 6;   // 3 chunks x 6ms = 18ms within 33ms (30fps) frame window
const TOTAL_CHUNKS = 3; // 2 data chunks + 1 completion, matches Truwave behavior
const MAX_CHUNKS = TOTAL_CHUNKS - 1;  // 2 data chunks. DMA reads 3 x 575 = 1725 slots (~1000 real pts + blanks)
// Firmware (FUN_08012310) shows each 0x1204-byte datagram carries 0x1200 (4608)
// payload bytes reassembled into a 0x4e24 (20004) frame buffer; points are 8 bytes.
//
// AUTO-SIZE: the hardware copies each chunk into the frame buffer at a fixed
// 0x1200 stride. Because a chunk is 4608 bytes and the frame header is 4 bytes,
// the first chunk fits exactly 575 points (4 + 575*8 = 4604) + 4 spare bytes.
// That 4-byte residue breaks byte alignment when a frame crosses into a second
// chunk, so the DMA injects a dark center point at the boundary -> a visible arc
// (last point -> center -> first point). The clean fix is to keep every frame
// within a single data chunk (<= PTS_FULL). FILL_TARGET is set to PTS_FULL so the
// padding/interpolation fill only targets the one-chunk budget (never 1000).
// srcPts is otherwise whatever the optimizer produces; frames whose real content
// fits in one chunk are auto-clipped below so they never trigger the 2-chunk arc.
const FILL_TARGET = PTS_FULL;
const PPS = 30;

const DAC_TYPE = 'Showbridge';

// =============== STATE ===============
let globalStatusCallback = null;
let discoveryCache = new Map();

// Per-channel state
//   "ip:channel" -> { socket, pendingTimer, heartbeatSent, running }
const channelState = new Map();
// Heartbeat timers keyed by IP (one per IP, not per channel)
const heartbeatTimers = new Map();

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

// =============== PACKET BUILDING ===============

function writePoints(buf, pointOffset, isTyped, points, ptsInChunk, ptsPerChunk, dataOff) {
    let lastX = 0, lastY = 0;
    for (let i = 0; i < ptsPerChunk; i++) {
        const off = dataOff + i * POINT_SIZE;
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
            // Hold at center so the transition to the next chunk's center hold
            // is zero-distance. The fill's lead-in blanked dwell handles the
            // approach to the first shape point in the next frame.
            x = 0;
            y = 0;
        }

        const dacBlanking = blanking > 0.5 ? 0 : 1;
        const isDark = dacBlanking === 0;
        const ix = Math.round((x + 1.0) * 2047.5);
        const iy = Math.round((y + 1.0) * 2047.5);
        buf.writeInt16LE(ix, off);
        buf.writeInt16LE(iy, off + 2);
        buf.writeUInt8(dacBlanking, off + 4);
        buf.writeUInt8(isDark ? 0 : Math.round(r * 255), off + 5);
        buf.writeUInt8(isDark ? 0 : Math.round(g * 255), off + 6);
        buf.writeUInt8(isDark ? 0 : Math.round(b * 255), off + 7);
    }
}

function buildFrameChunks(chType, pps, points) {
    const isTyped = points instanceof Float32Array;
    let totalPoints = isTyped ? Math.floor(points.length / 8) : (points ? points.length : 0);
    if (totalPoints === 0) return [];

    const ptsPerChunk = PTS_FULL;

    // Home position: the point where the frame ends so the next frame can begin
    // seamlessly. Defaults to center (0,0); updated to first source position when
    // the interpolation fill runs.
    let homeX = 0, homeY = 0;

    // Interpolation fill: when fewer source points than FILL_TARGET, linearly
    // interpolate between consecutive points to reach the target.  This avoids
    // frame-loop repetition jumps and makes better use of 30 Kpps bandwidth.
    if (totalPoints > 0 && totalPoints < FILL_TARGET && points instanceof Float32Array) {
        const padded = new Float32Array(FILL_TARGET * 8);

        // Blanked lead-in at the first source position. The frame's end-padding
        // also sits at firstSrcX/Y, so the loop transition back to this lead-in
        // is zero-distance — no between-frame jump.
        const srcLen = totalPoints;
        const LEAD_IN = Math.min(10, FILL_TARGET - srcLen);
        const firstSrcX = points[0];
        const firstSrcY = points[1];
        homeX = firstSrcX;
        homeY = firstSrcY;
        for (let i = 0; i < LEAD_IN; i++) {
            const dstOff = i * 8;
            padded[dstOff] = firstSrcX;
            padded[dstOff + 1] = firstSrcY;
            padded[dstOff + 6] = 1;
        }

        // Detect whether the shape is closed (first ≈ last point) or open (e.g. a
        // line).  Only closed shapes are wrapped cyclically — open shapes are drawn
        // once, then the beam returns to center.  Cycling an open shape would create
        // a visible fold-back line at the cycle boundary.
        const lastSrcOff = (srcLen - 1) * 8;
        const firstX = points[0], firstY = points[1];
        const lastX = points[lastSrcOff] || 0, lastY = points[lastSrcOff + 1] || 0;
        const closeDist = Math.sqrt(Math.pow(firstX - lastX, 2) + Math.pow(firstY - lastY, 2));
        const isOpenShape = closeDist >= 0.05;

        const availableSlots = FILL_TARGET - LEAD_IN;
        let padStart;

        if (isOpenShape) {
            // Open shape: write the source once, then blanked center.
            const copyCount = Math.min(srcLen, availableSlots);
            for (let i = 0; i < copyCount; i++) {
                const srcOff = i * 8;
                const dstOff = (LEAD_IN + i) * 8;
                for (let j = 0; j < 8; j++) {
                    padded[dstOff + j] = points[srcOff + j];
                }
            }
            padStart = LEAD_IN + copyCount;
        } else {
            // Closed shape: wrap the source cyclically.
            const numCompleteCycles = Math.floor(availableSlots / srcLen);
            const totalBodyPoints = numCompleteCycles * srcLen;

            for (let i = 0; i < totalBodyPoints; i++) {
                const srcOff = (i % srcLen) * 8;
                const dstOff = (LEAD_IN + i) * 8;
                const isSrcLastPt = ((i % srcLen) === srcLen - 1);
                for (let j = 0; j < 8; j++) {
                    padded[dstOff + j] = points[srcOff + j];
                }
                // Force-blank the closing point of each source cycle so the retrace
                // between cycles is invisible.
                if (isSrcLastPt) {
                    padded[dstOff + 3] = 0;
                    padded[dstOff + 4] = 0;
                    padded[dstOff + 5] = 0;
                    padded[dstOff + 6] = 1;
                }
            }
            padStart = LEAD_IN + totalBodyPoints;
        }

        // Blanked hold at the last position.
        if (padStart < FILL_TARGET && padStart > 0) {
            const lastBodyOff = (padStart - 1) * 8;
            const holdX = padded[lastBodyOff] || 0;
            const holdY = padded[lastBodyOff + 1] || 0;
            const holdCount = Math.min(20, FILL_TARGET - padStart);
            for (let h = 0; h < holdCount; h++) {
                const off = (padStart + h) * 8;
                padded[off] = holdX;
                padded[off + 1] = holdY;
                padded[off + 6] = 1;
            }
            padStart += holdCount;
        }

        // Blanked interpolation from the last body position back to the first
        // source position.
        if (padStart < FILL_TARGET && padStart > 0) {
            const lastBodyOff = (padStart - 1) * 8;
            const lx = padded[lastBodyOff] || 0;
            const ly = padded[lastBodyOff + 1] || 0;
            const dx = firstSrcX - lx;
            const dy = firstSrcY - ly;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.02) {
                const interpSteps = Math.min(Math.ceil(dist / 0.05), FILL_TARGET - padStart);
                for (let s = 1; s <= interpSteps; s++) {
                    const t = s / (interpSteps + 1);
                    const off = (padStart + s - 1) * 8;
                    if (off >= FILL_TARGET * 8) break;
                    padded[off] = lx + dx * t;
                    padded[off + 1] = ly + dy * t;
                    padded[off + 6] = 1;
                }
                padStart += interpSteps;
            }
        }

        // Pad remaining slots blanked at the first source position.
        for (let i = padStart; i < FILL_TARGET; i++) {
            const dstOff = i * 8;
            padded[dstOff] = firstSrcX;
            padded[dstOff + 1] = firstSrcY;
            padded[dstOff + 6] = 1;
        }

        points = padded;
        totalPoints = FILL_TARGET;
    }

    const payloadLen = UDP_PACKET_SIZE - HEADER_SIZE; // 4608: bytes per chunk payload
    const logicalLen = HEADER_SIZE + totalPoints * POINT_SIZE; // frame header + all points
    const dataChunks = Math.min(Math.ceil(logicalLen / payloadLen), MAX_CHUNKS);
    // Hard protocol limit: MAX_CHUNKS data chunks must fit the full point stream
    // (chunk index TOTAL_CHUNKS-1 is the dedicated home/completion chunk and
    // cannot carry data). Without this cap a large frame (e.g. >1151 points on a
    // 2-chunk budget) would write past the end of frameBuf and throw RangeError.
    const maxFitPoints = Math.floor((dataChunks * payloadLen - HEADER_SIZE) / POINT_SIZE);
    if (totalPoints > maxFitPoints) {
        console.warn(`[Showbridge] clipping frame from ${totalPoints} to ${maxFitPoints} points (2-chunk hardware limit)`);
        totalPoints = maxFitPoints;
    }
    const chunks = [];

    // Build one contiguous point stream matching the firmware's reassembled frame
    // buffer layout: [count(2) status(1) pps(1)] followed by [N×8-byte points].
    // This buffer is sliced at 4608-byte boundaries into chunk payloads so that a
    // point straddling a chunk boundary is reassembled correctly — the firmware
    // copies each chunk's payload into the DMA buffer at a fixed 0x1200 stride
    // with NO gap, so a point split at the slice boundary is reconstructed as a
    // single contiguous 8-byte point by the DMA.  Only 1 point may straddle the
    // boundary and that point is fully preserved (zero data loss).
    const frameBuf = Buffer.alloc(dataChunks * payloadLen);
    frameBuf.writeInt16LE(totalPoints, 0);  // count (read by DMA as 16-bit LE)
    frameBuf.writeUInt8(0, 2);              // status (firmware overwrites with 0xfa when complete)
    frameBuf.writeUInt8(pps, 3);            // PPS (DMA timing)
    writePoints(frameBuf, 0, isTyped, points, totalPoints, totalPoints, HEADER_SIZE);

    for (let ci = 0; ci < TOTAL_CHUNKS; ci++) {
        const buf = Buffer.alloc(UDP_PACKET_SIZE);
        buf.writeUInt8(TOTAL_CHUNKS, 0);
        buf.writeUInt8(ci, 1);
        buf.writeUInt8(0, 2);
        buf.writeUInt8(chType, 3);

        if (ci < dataChunks) {
            frameBuf.copy(buf, HEADER_SIZE, ci * payloadLen, (ci + 1) * payloadLen);
        } else {
            const hx = Math.round((homeX + 1.0) * 2047.5);
            const hy = Math.round((homeY + 1.0) * 2047.5);
            for (let i = 0; i < ptsPerChunk; i++) {
                const off = HEADER_SIZE + 4 + i * POINT_SIZE;
                buf.writeInt16LE(hx, off);
                buf.writeInt16LE(hy, off + 2);
                buf.writeUInt8(0, off + 4);
                buf.writeUInt8(0, off + 5);
                buf.writeUInt8(0, off + 6);
                buf.writeUInt8(0, off + 7);
            }
        }

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

            sock.on('error', () => { });

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
                        for (const s of sockets) { try { s.close(); } catch (e) { } }
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
    const localIp = getPrimaryIp();
    const ipParts = localIp.split('.').map(Number);
    const buf = Buffer.alloc(6);
    buf.writeUInt8(0x03, 0);
    buf.writeUInt8(ipParts[0], 1);
    buf.writeUInt8(ipParts[1], 2);
    buf.writeUInt8(ipParts[2], 3);
    buf.writeUInt8(ipParts[3], 4);
    buf.writeUInt8(0, 5);
    for (const [key, st] of channelState) {
        if (key.startsWith(ip + ':') && st.socket) {
            st.socket.send(buf, 0, 6, DAC_PORT, ip);
            break;
        }
    }
}

// =============== FRAME SENDING ===============

function sendFrame(ip, channel, points, fps, type, options) {
    const key = `${ip}:${channel}`;
    const chType = channel === 2 ? 0x01 : 0x00;
    // Showbridge control byte 3 expects Points Per Second / 1000 (Kpps),
    // e.g. 30 for 30000 PPS. options.pps arrives as full PPS, so divide here.
    const pps = (options && options.pps != null) ? Math.max(1, Math.min(255, Math.round(options.pps / 1000))) : PPS;

    // Get or create per-channel state
    let st = channelState.get(key);
    if (!st) {
        st = {
            socket: dgram.createSocket('udp4'),
            pendingTimers: [],
            running: true,
            seq: 0,
        };
        st.socket.on('error', () => { });
        channelState.set(key, st);
    }

    // Start heartbeat once per IP, not once per channel
    if (!heartbeatTimers.has(ip)) {
        sendHeartbeat(ip);
        heartbeatTimers.set(ip, setInterval(() => {
            sendHeartbeat(ip);
        }, 1000));
    }

    if (!st.running) return;

    // Cancel any pending chunk sends from previous frame
    for (const t of st.pendingTimers) {
        clearTimeout(t);
    }
    st.pendingTimers = [];

    // Build all chunks for this frame
    const chunks = buildFrameChunks(chType, pps, points);
    if (chunks.length === 0) return;

    // Seq is per-frame — same value on all 5 chunks
    const seq = st.seq & 0xFF;
    st.seq = (st.seq + 1) & 0xFF;
    for (const c of chunks) {
        c.writeUInt8(seq, 2);
    }

    // Send chunk 0 immediately
    try {
        st.socket.send(chunks[0], 0, UDP_PACKET_SIZE, DAC_PORT, ip);
    } catch (e) {
        console.error(`[Showbridge] send error on ${key}: ${e.message}`);
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
                console.error(`[Showbridge] send error on ${key}: ${e.message}`);
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
    socket.on('error', () => { });

    const chunks = [];
    const cx = Math.round((0 + 1.0) * 2047.5);
    const cy = Math.round((0 + 1.0) * 2047.5);
    for (let ci = 0; ci < TOTAL_CHUNKS; ci++) {
        const buf = Buffer.alloc(UDP_PACKET_SIZE);
        buf.writeUInt8(TOTAL_CHUNKS, 0);
        buf.writeUInt8(ci, 1);
        buf.writeUInt8(0, 2);
        buf.writeUInt8(chType, 3);
        if (ci === 0) {
            buf.writeInt16LE(0, 4);
            buf.writeUInt8(0, 6);
            buf.writeUInt8(PPS, 7);
        } else {
            buf.writeUInt16LE(0, 4);
            buf.writeUInt16LE(0, 6);
        }
        const dataOff = HEADER_SIZE + 4;
        for (let i = 0; i < PTS_FULL; i++) {
            const off = dataOff + i * POINT_SIZE;
            buf.writeInt16LE(cx, off);
            buf.writeInt16LE(cy, off + 2);
            buf.writeUInt8(0, off + 4);
            buf.writeUInt8(0, off + 5);
            buf.writeUInt8(0, off + 6);
            buf.writeUInt8(0, off + 7);
        }
        chunks.push(buf);
    }

    let closed = false;
    let idx = 0;
    function sendNext() {
        if (closed || idx >= chunks.length) {
            if (!closed) { closed = true; try { socket.close(); } catch (e) { } }
            return;
        }
        try {
            socket.send(chunks[idx], 0, UDP_PACKET_SIZE, DAC_PORT, ip, () => {
                idx++;
                if (idx < chunks.length) {
                    setTimeout(sendNext, CHUNK_STAGGER_MS);
                } else {
                    setTimeout(() => {
                        if (!closed) { closed = true; try { socket.close(); } catch (e) { } }
                    }, 10);
                }
            });
        } catch (e) {
            if (!closed) { closed = true; try { socket.close(); } catch (e) { } }
        }
    }
    sendNext();
}

// =============== STOP / CLEANUP ===============
function stopSending(ip) {
    // Stop heartbeat for this IP
    const hbTimer = heartbeatTimers.get(ip);
    if (hbTimer) {
        clearInterval(hbTimer);
        heartbeatTimers.delete(ip);
    }

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
        try { st.socket.close(); } catch (e) { }

        channelState.delete(key);
    }
}

function closeAll() {
    // Stop all heartbeat timers
    for (const [ip, timer] of heartbeatTimers) {
        clearInterval(timer);
    }
    heartbeatTimers.clear();

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

        try { st.socket.close(); } catch (e) { }
    }
    channelState.clear();
    discoveryCache.clear();
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
