const dgram = require('dgram');
const { Buffer } = require('buffer');
const os = require('os');

// ===== CONSTANTS =====
const DISCOVERY_BROADCAST_PORT = 8089;
const NATIVE_RESPONSE_PORT = 8099;
const FRAME_DATA_PORT = 8089;

// ===== HELPERS =====
function logHex(label, buf) {
    const hex = buf.toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`  [${label}] ${buf.length} bytes: ${hex}`);
}

// ===== PHASE 1: NATIVE HARDWARE DISCOVERY (port 8089 broadcast) =====
async function probeNativeDiscovery() {
    return new Promise((resolve) => {
        console.log('\n=== PHASE 1: Native Discovery (port 8089) ===');

        const interfaces = os.networkInterfaces();
        const discovered = [];
        const sockets = [];

        // Collect non-internal IPv4 interfaces
        const ifaces = [];
        for (const k in interfaces) {
            for (const addr of interfaces[k]) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    ifaces.push({ name: k, ip: addr.address });
                }
            }
        }

        if (ifaces.length === 0) {
            console.log('No suitable network interfaces found');
            resolve(discovered);
            return;
        }

        // Create one socket per interface, each bound to port 8099 on that interface.
        // reuseAddr allows multiple sockets on the same port.
        // The DAC responds to the source port of the broadcast (8099), so we MUST
        // send FROM port 8099 AND listen on 8099.
        let readyCount = 0;
        for (const iface of ifaces) {
            const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            sockets.push(sock);

            sock.on('message', (msg, rinfo) => {
                console.log(`\n<<< Response on ${iface.name} (${iface.ip}) from ${rinfo.address}:${rinfo.port}`);
                logHex('NATIVE_RESP', msg);
                discovered.push({ from: rinfo, data: Buffer.from(msg) });
            });

            sock.on('error', (err) => {
                console.error(`[${iface.name} ${iface.ip}] error: ${err.message}`);
            });

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
                console.log(`[${iface.name} ${iface.ip}] bound to port ${NATIVE_RESPONSE_PORT}, sending discovery...`);
                sock.send(cmd, 0, cmd.length, DISCOVERY_BROADCAST_PORT, '255.255.255.255', (err) => {
                    if (err) {
                        console.error(`[${iface.name} ${iface.ip}] send FAILED: ${err.message}`);
                    } else {
                        console.log(`[${iface.name} ${iface.ip}] discovery sent OK`);
                    }
                    readyCount++;
                    if (readyCount >= ifaces.length) {
                        // All sent — wait 3s for responses
                        setTimeout(() => {
                            for (const s of sockets) { try { s.close(); } catch (e) { } }
                            resolve(discovered);
                        }, 3000);
                    }
                });
            });
        }
    });
}


// ===== PHASE 2: STREAM FRAMES (DAC firmware wire format) =====
// Based on ShowBridge firmware reversal (STM32H750) + Truwave.exe Ghidra analysis.
//
// Packet (0x1204 = 4612 bytes):
//   [0] total_chunks (MUST be 5)
//   [1] chunk_index (0-4)
//   [2] seq_counter (same for all chunks, +1 per frame)
//   [3] type (0x00=CH1, 0x01=CH2)
//   [4-7]   controller area (4 bytes)
//           chunk 0: [laser_ctrl_low][laser_ctrl_high][0][PPS]
//           chunks 1-4: [0][0][0][PPS] (dummy, keeps boundary DARK)
//   [8-4607] real points: 575 × 8 = 4600 bytes
//                         int16 LE x/y, u8 blanking, u8 r/g/b
//   [4608-4611] padding (4 bytes, zeroed)
//
// blanking: 0=DARK, non-zero=LIT
// Frame buffer: 0x4E24 = 20004 bytes, DMA reads from byte 4: 2500 × 8-byte slots
// 5 chunks is CORRECT (firmware requires total_chunks = 5 to avoid memcpy overflow)
// DMA reads only ~575 points (first chunk's worth)
async function streamFrames(ip, port, durationMs, opts = {}) {
    const POINT_SIZE = 8;
    const HEADER_SIZE = 4;
    const PACKET_SIZE = 0x1204;
    const PPS = 30;
    const CENTER_X = 2048;
    const RADIUS = 1500;
    const LASER_CTRL = 0x01D2;

    // DMA only reads chunk 0 (575 pts). Use 2 chunks for frame completion.
    const CHUNKS = 2;
    const PTS_FULL = 575;
    const PTS_LAST = 575;
    const TOTAL_PTS = PTS_FULL;

    const chType = opts.channel || 0x00;

    const colorFn = opts.color || ((i) => ({ r: 255, g: 0, b: 0 }));

    const chunk0 = Buffer.alloc(PACKET_SIZE);
    const chunk1 = Buffer.alloc(PACKET_SIZE);

    chunk0.writeUInt8(CHUNKS, 0);
    chunk0.writeUInt8(0, 1);
    chunk0.writeUInt8(0, 2);
    chunk0.writeUInt8(chType, 3);
    chunk0.writeInt16LE(LASER_CTRL, 4);
    chunk0.writeUInt8(0, 6);
    chunk0.writeUInt8(PPS, 7);
    for (let i = 0; i < PTS_FULL; i++) {
        const off = HEADER_SIZE + 4 + i * POINT_SIZE;
        const a = (i / TOTAL_PTS) * Math.PI * 2;
        const x = Math.round(CENTER_X + Math.cos(a) * RADIUS);
        const y = Math.round(CENTER_X + Math.sin(a) * RADIUS);
        const { r, g, b } = colorFn(i, TOTAL_PTS);
        chunk0.writeInt16LE(x, off);
        chunk0.writeInt16LE(y, off + 2);
        chunk0.writeUInt8(0xFF, off + 4);
        chunk0.writeUInt8(r, off + 5);
        chunk0.writeUInt8(g, off + 6);
        chunk0.writeUInt8(b, off + 7);
    }

    chunk1.writeUInt8(CHUNKS, 0);
    chunk1.writeUInt8(1, 1);
    chunk1.writeUInt8(0, 2);
    chunk1.writeUInt8(chType, 3);
    chunk1.writeUInt16LE(0, 4);
    chunk1.writeUInt8(0, 6);
    chunk1.writeUInt8(PPS, 7);

    const socket = dgram.createSocket('udp4');
    let frameSeq = 0;
    const start = Date.now();

    return new Promise((resolve) => {
        function sendNextFrame() {
            const elapsed = Date.now() - start;
            if (elapsed >= durationMs) {
                setTimeout(() => {
                    socket.close();
                    console.log(`\nStreamed ${frameSeq} frames over ${elapsed}ms`);
                    resolve(true);
                }, 200);
                return;
            }
            const seq = frameSeq & 0xFF;
            chunk0.writeUInt8(seq, 2);
            chunk1.writeUInt8(seq, 2);
            socket.send(chunk0, 0, PACKET_SIZE, port, ip, () => {
                setTimeout(() => {
                    socket.send(chunk1, 0, PACKET_SIZE, port, ip, () => {
                        frameSeq++;
                        setImmediate(sendNextFrame);
                    });
                }, 10);
            });
        }
        const mode = chType === 0x00 ? 'CH1' : 'CH2';
        console.log(`Streaming (${mode}, ${TOTAL_PTS} pts)`);
        sendNextFrame();
    });
}

// Color mode factories
const COLORS = {
    red: (i) => ({ r: 255, g: 0, b: 0 }),
    green: (i) => ({ r: 0, g: 255, b: 0 }),
    blue: (i) => ({ r: 0, g: 0, b: 255 }),
    white: (i) => ({ r: 255, g: 255, b: 255 }),
    rainbow: (i, n) => {
        const hue = (i / n) * 360;
        const h = hue / 60;
        const c = 255;
        const x = Math.round(c * (1 - Math.abs((h % 2) - 1)));
        if (h < 1) return { r: 255, g: x, b: 0 };
        if (h < 2) return { r: x, g: 255, b: 0 };
        if (h < 3) return { r: 0, g: 255, b: x };
        if (h < 4) return { r: 0, g: x, b: 255 };
        if (h < 5) return { r: x, g: 0, b: 255 };
        return { r: 255, g: 0, b: x };
    }
};

// ===== MAIN =====
async function main() {
    console.log('========================================');
    console.log('  Showbridge/Showtower Protocol Probe');
    console.log('========================================');
    console.log(`Local IPs: ${getNetworkInterfaces().map(i => i.address).join(', ')}`);

    // Phase 1: Native discovery via broadcast
    const discovered = await probeNativeDiscovery();

    // Parse discovery responses
    if (discovered.length > 0) {
        console.log('\n=== DISCOVERY RESULTS ===');
        for (const d of discovered) {
            const msg = d.data;
            if (msg.length >= 16) {
                const vendor = (msg.readUInt8(0) << 8) | msg.readUInt8(1);
                const type = msg.readUInt8(2);
                const channel = msg.readUInt8(3);
                const hwId = msg.readUInt32BE(4);  // last 4 bytes of MAC / serial
                console.log(`  DAC: vendor=0x${vendor.toString(16)} type=${type} ch=${channel} hw_id=0x${hwId.toString(16).padStart(8, '0')}`);
                console.log(`  Raw: ${msg.toString('hex')}`);
                console.log(`  From: ${d.from.address}:${d.from.port}`);
            } else if (msg.length > 0) {
                console.log(`  Short response (${msg.length} bytes): ${msg.toString('hex')}`);
                console.log(`  From: ${d.from.address}:${d.from.port}`);
            }
        }
    }


    const dacIp = discovered.length > 0
        ? [...new Set(discovered.map(d => d.from.address))][0]
        : null;

    // Phase 2: Heartbeat (type 0x03) — registers our IP with the DAC
    if (dacIp) {
        console.log(`\n=== PHASE 2: Heartbeat to ${dacIp}:${FRAME_DATA_PORT} ===`);
        const sock = dgram.createSocket('udp4');
        const ipParts = getPrimaryIp().split('.').map(Number);
        const hb = Buffer.alloc(6);
        hb.writeUInt8(0x03, 0);           // type = heartbeat
        hb.writeUInt8(ipParts[0], 1);
        hb.writeUInt8(ipParts[1], 2);
        hb.writeUInt8(ipParts[2], 3);
        hb.writeUInt8(ipParts[3], 4);
        hb.writeUInt8(0, 5);              // padding
        sock.send(hb, 0, 6, FRAME_DATA_PORT, dacIp, () => {
            logHex('HEARTBEAT', hb);
            sock.close();
        });
        await new Promise(r => setTimeout(r, 500));
    }

    // Phase 3: Test sequence — CH1 red, CH2 green, CH1 rainbow
    if (dacIp) {
        console.log('\n=== PHASE 3: Test sequence ===');

        console.log('\n--- Test 1: CH1 Red circle (4s) ---');
        await streamFrames(dacIp, FRAME_DATA_PORT, 4000, { channel: 0x00, color: COLORS.red });

        console.log('\n--- Test 2: CH2 Green circle (4s) ---');
        await new Promise(r => setTimeout(r, 500));
        await streamFrames(dacIp, FRAME_DATA_PORT, 4000, { channel: 0x01, color: COLORS.green });

        console.log('\n--- Test 3: CH1 Rainbow circle (4s) ---');
        await new Promise(r => setTimeout(r, 500));
        await streamFrames(dacIp, FRAME_DATA_PORT, 4000, { channel: 0x00, color: COLORS.rainbow });
    } else {
        console.log('\nNo DACs discovered via native broadcast.');
        console.log('Make sure Showbridge/Showtower DACs are on the network.');
        console.log('Try running Truwave software and probing the SDK protocol.');
    }

    console.log('\n========================================');
    console.log('  Probe complete');
    console.log('========================================');
}

function getPrimaryIp() {
    const addrs = getNetworkInterfaces();
    return addrs.length > 0 ? addrs[0].address : '127.0.0.1';
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

main().catch(console.error);
