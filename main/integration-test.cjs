// Integration test for the new showbridge-communication module
const sb = require('./showbridge-communication.cjs');

const DAC_IP = '169.254.25.118';
const DURATION_MS = 5000;

function generateCirclePoints(numPoints) {
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
        const a = (i / numPoints) * Math.PI * 2;
        pts.push({
            x: Math.cos(a) * 0.7,
            y: Math.sin(a) * 0.7,
            r: 1.0,
            g: 0,
            b: 0,
            blanking: 1,
        });
    }
    return pts;
}

async function main() {
    console.log('=== Integration Test ===\n');

    // 1. Discovery
    console.log('--- Test 1: Discovery ---');
    const dacs = await sb.discoverDacs(3000);
    console.log(`Found ${dacs.length} DAC(s):`);
    for (const d of dacs) {
        console.log(`  ${d.name} @ ${d.ip}:${d.port}, channel ${d.channel}`);
    }

    if (dacs.length === 0) {
        console.log('No DACs found, aborting.');
        return;
    }

    // 2. Send frames to CH1 for 2 seconds
    console.log('\n--- Test 2: Stream to CH1 (red circle, 2s) ---');
    const points = generateCirclePoints(575);
    const start = Date.now();
    const intervalId = setInterval(() => {
        if (Date.now() - start >= 2000) {
            clearInterval(intervalId);
            console.log('CH1 streaming complete.');
            return;
        }
        sb.sendFrame(DAC_IP, 1, points, 30, 'Showbridge');
    }, 16);  // ~60fps

    await new Promise(r => setTimeout(r, 2500));

    // 3. Test stopSending (laser off)
    console.log('\n--- Test 3: Stop sending (laser off) ---');
    sb.stopSending(DAC_IP);
    console.log('Sent blank frame. Laser should be off.');

    await new Promise(r => setTimeout(r, 2000));

    // 4. Send to CH2 for 2 seconds
    console.log('\n--- Test 4: Stream to CH2 (green circle, 2s) ---');
    const points2 = generateCirclePoints(575);
    const start2 = Date.now();
    const intervalId2 = setInterval(() => {
        if (Date.now() - start2 >= 2000) {
            clearInterval(intervalId2);
            console.log('CH2 streaming complete.');
            return;
        }
        sb.sendFrame(DAC_IP, 2, points2, 30, 'Showbridge');
    }, 16);

    await new Promise(r => setTimeout(r, 2500));

    // 5. Close all (laser off + cleanup)
    console.log('\n--- Test 5: Close all (cleanup) ---');
    sb.closeAll();
    console.log('Cleanup complete.');

    console.log('\n=== Integration test complete ===');
}

main().catch(console.error);
