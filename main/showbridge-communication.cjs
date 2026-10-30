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

// The firmware reads the LASER ENABLE from the first two bytes of the frame
// payload (bytes 4-5 of the chunk, which land on the frame buffer's word 0):
// the high byte 0x00 means "laser off", anything else means "on". The
// bench-verified probe (main/showbridge-probe.cjs) sent 0x01d2 for a live
// frame.
//
// The POINT COUNT used to live in that word. It only read as "on" because a
// full 575-point frame happens to encode as 0x023f - but a frame with fewer
// than 256 points encodes as 0x00xx, whose high byte is 0x00, so the DAC
// switched the laser off and that output stayed dark. The count is now written
// nowhere: the enable word carries the documented value instead.
const LASER_CTRL_ON = 0x01d2;

const DAC_TYPE = 'Showbridge';

// =============== STATE ===============
let globalStatusCallback = null;
// ip -> { channels: Set<number>, order: number[], vendorId, deviceId, name }
// `order` is the sequence in which the channels answered the discovery
// broadcast. That order - not the channel number itself - is what maps a
// channel onto the firmware's channel constant.
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

// The colour scale of a frame is decided ONCE for the whole frame, not per
// channel. A single channel sitting at exactly 1.0 is ambiguous - it could be
// 1/255 in a 0..255 frame or full white in a 0..1 frame - and the old
// per-channel test read it as 0..1 and wrote full white. (The Invert effect
// produces exactly 1.0 when it inverts a 254.) A frame that uses any value
// above 1 is a 0..255 frame; a frame that never does is a 0..1 frame.
function frameUses255Scale(points, isTyped, numPoints) {
    for (let i = 0; i < numPoints; i++) {
        let r, g, b;
        if (isTyped) {
            const o = i * 8;
            r = points[o + 3] || 0;
            g = points[o + 4] || 0;
            b = points[o + 5] || 0;
        } else {
            const p = points[i];
            if (p instanceof Float32Array || Array.isArray(p)) {
                r = p[3] || 0; g = p[4] || 0; b = p[5] || 0;
            } else if (p && typeof p === 'object') {
                r = p.r || 0; g = p.g || 0; b = p.b || 0;
            } else {
                continue;
            }
        }
        if (r > 1 || g > 1 || b > 1) return true;
    }
    return false;
}

function writePoints(buf, pointOffset, isTyped, points, ptsInChunk, ptsPerChunk, dataOff, scale255) {
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
            if (scale255) { r /= 255; g /= 255; b /= 255; }
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

// Flatten the renderer's plain point list into the canonical 8-float layout
// ([x, y, z, r, g, b, blanking, 0] per point). Accepts both the array form
// ([x,y,r,g,b,blanking]) and the object form ({x,y,r,g,b,blanking}) the
// renderer uses - the same two shapes writePoints() understands.
function flattenPoints(points) {
    const out = new Float32Array(points.length * 8);
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const o = i * 8;
        if (!p) continue;
        if (Array.isArray(p) || p instanceof Float32Array) {
            out[o] = p[0] || 0;
            out[o + 1] = p[1] || 0;
            out[o + 2] = p[2] || 0;
            out[o + 3] = p[3] || 0;
            out[o + 4] = p[4] || 0;
            out[o + 5] = p[5] || 0;
            out[o + 6] = p[6] || 0;
        } else if (typeof p === 'object') {
            out[o] = p.x || 0;
            out[o + 1] = p.y || 0;
            out[o + 2] = p.z || 0;
            out[o + 3] = p.r || 0;
            out[o + 4] = p.g || 0;
            out[o + 5] = p.b || 0;
            out[o + 6] = p.blanking || 0;
        }
    }
    return out;
}

function buildFrameChunks(chType, pps, points, mode, fps) {
    // Tolerate the ILDA worker's metadata wrapper ({ points, isTypedArray, ... })
    // so a stray wrapper can never reach the point-count math below (which
    // would compute NaN buffer sizes and crash the main process).
    if (points && typeof points === 'object' && !(points instanceof Float32Array) && !Array.isArray(points) && points.points) {
        points = points.points;
    }
    let isTyped = points instanceof Float32Array;
    // A plain point array (the Show Control grid path sends one) would skip the
    // interpolation fill below, and that fill is what pads the frame out to a
    // full chunk. Flatten it to the canonical typed layout first so every
    // frame is built the same way, whichever path produced it.
    if (!isTyped && Array.isArray(points)) {
        points = flattenPoints(points);
        isTyped = true;
    }
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
    frameBuf.writeInt16LE(LASER_CTRL_ON, 0);  // laser enable (payload bytes 4-5)
    frameBuf.writeUInt8(0, 2);              // status (firmware overwrites with 0xfa when complete)

    // Mode-aware PPS byte. The DMA loops the FULL wire frame (after fill/clip),
    // so in Variable PPS -> Fixed FPS the byte must reflect the wire point count
    // (not the source count) or the frame plays longer than 1/fps and the next
    // update overwrites it mid-play — the classic constant-PPS lag. In Variable
    // FPS -> Fixed PPS it stays at the configured Kpps value while the effective
    // frame rate follows the content.
    let ppsByte = pps;
    if (mode === 'varPpsFixedFps') {
        const effFps = (fps && fps > 0) ? fps : 30;
        ppsByte = Math.max(1, Math.min(255, Math.round((totalPoints * effFps) / 1000)));
    }
    frameBuf.writeUInt8(ppsByte, 3);        // PPS (DMA timing)
    writePoints(frameBuf, 0, isTyped, points, totalPoints, totalPoints, HEADER_SIZE,
        frameUses255Scale(points, isTyped, totalPoints));

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

    return { chunks, pointCount: totalPoints };
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
                        order: [],
                        vendorId: dac.vendorId,
                        deviceId: dac.deviceId,
                        name: dac.name,
                    });
                }
                const entry = discoveryCache.get(dac.ip);
                entry.channels.add(dac.channel);
                if (!entry.order.includes(dac.channel)) {
                    entry.order.push(dac.channel);
                }

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
                        // Report the channel -> firmware constant map so a
                        // dark channel can be checked against the unit.
                        for (const [ip, entry] of discoveryCache) {
                            const map = entry.order
                                .map((ch) => `ch ${ch} = 0x${channelTypeFor(ip, ch).toString(16).padStart(2, '0')}`)
                                .join(', ');
                            console.log(`[Showbridge] ${ip}: ${entry.order.length} channel(s) - ${map || 'none'}`);
                        }
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
    for (const ch of cached.order.length ? cached.order : cached.channels) {
        services.push({
            serviceID: ch,
            name: `Channel ${ch}`,
        });
    }
    return Promise.resolve(services);
}

// The firmware picks the target channel from header byte 3: 0x00 stores the
// frame in the CH1 buffer, 0x01 in the CH2 buffer.
//
// That constant is the channel's POSITION in the unit, not its discovery
// number. The discovery response numbers channels 1/2 on most units, but a
// unit is free to report any numbering it likes - and the old mapping
// ("channel 2 is 0x01, everything else is 0x00") got that wrong in two ways:
// a unit reporting 0/1 put BOTH channels in the CH1 buffer, and a unit
// reporting 2/3 swapped them. Either way the unit's second channel stayed
// dark. Mapping by discovery order fixes both and keeps the common 1/2 case
// byte-identical to what worked before.
//
// Only 0x00 and 0x01 are frame data - every other value is a different
// packet type on real hardware (0x02 is a settings block, 0x03 a heartbeat),
// so the constant is clamped. A unit with more channels than the firmware has
// buffers can only ever light its first two; sending anything else would
// feed the unit's config and heartbeat parsers a frame.
const MAX_CHANNEL_CONSTANT = 1;

function channelTypeFor(ip, channel) {
    const entry = discoveryCache.get(ip);
    const order = entry ? entry.order : [];
    if (order.length > 0) {
        const idx = order.indexOf(channel);
        if (idx >= 0) return Math.min(idx, MAX_CHANNEL_CONSTANT);
    }
    // No discovery info for this unit (it was never scanned): assume the
    // common 1-based numbering, so channel N is the firmware's channel N-1.
    return Math.min(Math.max(0, (channel | 0) - 1), MAX_CHANNEL_CONSTANT);
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

// Get (or lazily create) the persistent per-channel UDP socket and make sure
// the per-IP heartbeat is running. Both sendFrame and sendIdleFrame share this
// so the always-feed loop reuses one socket per channel instead of opening and
// closing sockets on every 30fps tick.
function ensureChannel(ip, key) {
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
    if (!heartbeatTimers.has(ip)) {
        sendHeartbeat(ip);
        heartbeatTimers.set(ip, setInterval(() => {
            sendHeartbeat(ip);
        }, 1000));
    }
    return st;
}

function flushChunks(st, chunks, ip) {
    const seq = st.seq & 0xFF;
    st.seq = (st.seq + 1) & 0xFF;
    for (const c of chunks) {
        c.writeUInt8(seq, 2);
    }

    // Send chunk 0 immediately
    try {
        st.socket.send(chunks[0], 0, UDP_PACKET_SIZE, DAC_PORT, ip);
    } catch (e) {
        console.error(`[Showbridge] send error on ${ip}: ${e.message}`);
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
                console.error(`[Showbridge] send error on ${ip}: ${e.message}`);
            }
            const idx = st.pendingTimers.indexOf(timer);
            if (idx >= 0) st.pendingTimers.splice(idx, 1);
        }, delay);
        st.pendingTimers.push(timer);
    }
}

// =============== DIAGNOSTICS ==============
//
// A DAC that stays dark is hard to debug from the outside: the unit simply
// ignores the frames. These logs state, per channel, exactly what the app
// puts on the wire, so a "no output" report can be checked against the DAC's
// own activity without a packet capture.
const loggedChannels = new Set();

function logChannelOnce(key, ip, channel, chType) {
    if (loggedChannels.has(key)) return;
    loggedChannels.add(key);
    const entry = discoveryCache.get(ip);
    const order = entry && entry.order.length ? entry.order.join(',') : 'not scanned';
    console.log(`[Showbridge] ${ip} channel ${channel} -> firmware channel constant 0x${chType.toString(16).padStart(2, '0')}` +
        ` (${chType === 0 ? 'CH1' : chType === 1 ? 'CH2' : 'CH' + (chType + 1)}), discovery order [${order}]`);
}

// The point count and the laser-enable word are the two values that decide
// whether the DAC lights up, so report them once per channel as well.
function logFrameOnce(key, ip, channel, chType, totalPoints) {
    const logKey = `${key}#pts`;
    if (loggedChannels.has(logKey)) return;
    loggedChannels.add(logKey);
    console.log(`[Showbridge] ${ip} channel ${channel}: ${totalPoints} points/frame, laser enable word 0x${LASER_CTRL_ON.toString(16).padStart(4, '0')}` +
        ` (high byte 0x${((LASER_CTRL_ON >> 8) & 0xff).toString(16).padStart(2, '0')} = on), header byte 3 = 0x${chType.toString(16).padStart(2, '0')}`);
}

function sendFrame(ip, channel, points, fps, type, options) {
    const key = `${ip}:${channel}`;
    const chType = channelTypeFor(ip, channel);
    // Showbridge control byte 3 expects Points Per Second / 1000 (Kpps),
    // e.g. 30 for 30000 PPS. options.pps arrives as full PPS, so divide here.
    const pps = (options && options.pps != null) ? Math.max(1, Math.min(255, Math.round(options.pps / 1000))) : PPS;

    const st = ensureChannel(ip, key);
    if (!st.running) return;

    logChannelOnce(key, ip, channel, chType);

    // Cancel any pending chunk sends from previous frame
    for (const t of st.pendingTimers) {
        clearTimeout(t);
    }
    st.pendingTimers = [];

    // Build all chunks for this frame. The PPS byte is mode-aware: in Variable
    // PPS -> Fixed FPS it is derived from the wire point count so the frame
    // still completes in 1/fps, in Variable FPS -> Fixed PPS it stays at the
    // configured Kpps while the effective frame rate varies with content.
    const mode = (options && options.targetMode) ? options.targetMode : 'varFpsFixedPps';
    const effFps = (options && options.targetFps && options.targetFps > 0)
        ? options.targetFps
        : (fps && fps > 0 ? fps : 30);
    const built = buildFrameChunks(chType, pps, points, mode, effFps);
    if (built.chunks.length === 0) return;

    logFrameOnce(key, ip, channel, chType, built.pointCount);

    flushChunks(st, built.chunks, ip);
}

// Always-feed idle stream: a full PTS_FULL dark frame (center hold) pushed on
// the persistent per-channel socket every loop tick so the Showbridge DMA never
// goes quiet. Same continuous-stream model EtherDream / the Truwave app use —
// the DAC stays warm and the next clip's first frame goes out immediately
// instead of after a cold start / missed-tick silence.
function sendIdleFrame(ip, channel, options) {
    const key = `${ip}:${channel}`;
    const chType = channelTypeFor(ip, channel);
    const pps = (options && options.pps != null) ? Math.max(1, Math.min(255, Math.round(options.pps / 1000))) : PPS;

    const st = ensureChannel(ip, key);
    if (!st.running) return;

    for (const t of st.pendingTimers) {
        clearTimeout(t);
    }
    st.pendingTimers = [];

    // A single blanked center point — the interpolation fill pads it to a full
    // PTS_FULL dark frame whose varPpsFixedFps byte plays it in exactly 1/30s,
    // a clean 30fps idle stream.
    const blank = new Float32Array(8);
    blank[6] = 1;
    const built = buildFrameChunks(chType, pps, blank, 'varFpsFixedPps', 30);
    if (built.chunks.length === 0) return;

    flushChunks(st, built.chunks, ip);
}

// =============== BLANK FRAME ===============
function sendBlankFrame(ip, channel) {
    const key = `${ip}:${channel}`;
    const chType = channelTypeFor(ip, channel);

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
    buildFrameChunks,
    sendIdleFrame,
    sendHeartbeat,
    sendBlankFrame,
    stopSending,
    closeAll,
    setStatusCallback,
    PTS_FULL,
    frameUses255Scale,
    // Test hook: seed the discovery order of a unit the way a scan would.
    __setDiscoveryOrder: (ip, order) => {
        if (!discoveryCache.has(ip)) {
            discoveryCache.set(ip, { channels: new Set(), order: [], vendorId: 0, deviceId: 0, name: '' });
        }
        const entry = discoveryCache.get(ip);
        entry.order = order.slice();
        entry.channels = new Set(order);
    },
};
