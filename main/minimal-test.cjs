const dgram = require('dgram');
const { Buffer } = require('buffer');

const IP = '169.254.25.118';
const PORT = 8089;
const CH = 0x00; // CH1
const PPS = 30;

const POINT_SIZE = 8;
const PACKET_SIZE = 0x1204;
const HEADER_SIZE = 4;

// Build 5 chunks: 4×575 + 196 = 2496 pts, full circle
const CHUNKS = 5;
const PTS_FULL = 575;
const PTS_LAST = 196;
const TOTAL_PTS = 2496;

const cx = 2048, r = 1500;

const chunks = [];
for (let ci = 0; ci < CHUNKS; ci++) {
    const buf = Buffer.alloc(PACKET_SIZE);
    buf.writeUInt8(CHUNKS, 0);
    buf.writeUInt8(ci, 1);
    buf.writeUInt8(0, 2);  // seq = 0
    buf.writeUInt8(CH, 3);

    // ctrl bytes
    if (ci === 0) {
        buf.writeInt16LE(0x01D2, 4);
    } else {
        buf.writeInt16LE(0, 4);
    }
    buf.writeUInt8(0, 6);
    buf.writeUInt8(PPS, 7);

    const pts = (ci < CHUNKS - 1) ? PTS_FULL : PTS_LAST;
    for (let i = 0; i < pts; i++) {
        const off = HEADER_SIZE + 4 + i * POINT_SIZE;
        const gi = ci * PTS_FULL + i;
        const a = (gi / TOTAL_PTS) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cx + Math.sin(a) * r);
        buf.writeInt16LE(x, off);
        buf.writeInt16LE(y, off + 2);
        buf.writeUInt8(0x01, off + 4);   // blanking = 1 (not 0xFF!)
        buf.writeUInt8(255, off + 5);
        buf.writeUInt8(0, off + 6);
        buf.writeUInt8(0, off + 7);
    }
    chunks.push(buf);
}

async function sendHeartbeat(sock) {
    const hb = Buffer.alloc(6);
    hb.writeUInt8(0x03, 0);
    hb.writeUInt8(169, 1);
    hb.writeUInt8(254, 2);
    hb.writeUInt8(25, 3);
    hb.writeUInt8(104, 4);
    hb.writeUInt8(0, 5);
    return new Promise(res => {
        sock.send(hb, 0, 6, PORT, IP, () => { console.log('Heartbeat sent'); res(); });
    });
}

async function sendFrame(sock) {
    return new Promise(res => {
        let sent = 0;
        function sendChunk(ci) {
            if (ci >= CHUNKS) {
                console.log(`Frame sent (${sent} chunks)`);
                res();
                return;
            }
            chunks[ci].writeUInt8(0, 2);  // seq = 0 for first frame
            sock.send(chunks[ci], 0, PACKET_SIZE, PORT, IP, () => {
                sent++;
                setTimeout(() => sendChunk(ci + 1), 10);
            });
        }
        sendChunk(0);
    });
}

async function main() {
    const sock = dgram.createSocket('udp4');
    await new Promise(r => sock.bind(0, r));

    await sendHeartbeat(sock);
    await new Promise(r => setTimeout(r, 200));

    // Send 5 frames with 1-second intervals
    for (let f = 0; f < 5; f++) {
        console.log(`\n--- Frame ${f} ---`);
        const seq = f & 0xFF;
        for (let ci = 0; ci < CHUNKS; ci++) {
            chunks[ci].writeUInt8(seq, 2);
        }
        await sendFrame(sock);
        await new Promise(r => setTimeout(r, 1000));
    }

    sock.close();
    console.log('\nDone');
}

main().catch(console.error);
