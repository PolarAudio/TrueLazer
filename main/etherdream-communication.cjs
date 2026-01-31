const { DAC } = require('@laser-dac/core');
const { EtherDream } = require('@laser-dac/ether-dream');
const { parseStandardResponse } = require('@laser-dac/ether-dream/dist/parse');
const os = require('os');
const { Buffer } = require('buffer');

// --- OPTIMIZATION & HARDWARE CONSTANTS ---
const OPT_MAX_DIST = 0.08; 
const OPT_CORNER_DWELL = 3; 
const OPT_PATH_DWELL = 3;   

const HW_RES = 65535;

// Reverting to the logic that worked for coordinates: 
// 0..1 range with Y flip and shift. 
// TrueLazer sends [-1, 1], so we convert to [0, 1] first.
const toHWPos = (n, isY = false) => {
    // Convert [-1, 1] to [0, 1]
    const normalized = (n + 1) / 2;
    // Map to 0..65535, then shift to -32768..32767
    let val = Math.floor(normalized * 65535 - 32768);
    // Apply Y flip if needed (many DACs/scanners need this)
    if (isY) val = -val;
    return Math.max(-32768, Math.min(32767, val));
};

const toHWColor = (c) => {
    const val = c > 1.0 ? c / 255 : c;
    return Math.max(0, Math.min(65535, Math.round(val * 65535)));
};

function createBlankFrame(count = 500) {
    const pts = [];
    for(let i=0; i<count; i++) {
        pts.push({ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true });
    }
    return pts;
}

// Helper to pad points.
// HYBRID STRATEGY:
// 1. If it's a closed loop (Generator), repeat the shape to keep beam moving and bright.
// 2. If it's an open path (ILDA), pad with blanking at the end to preserve timing.
function padPoints(points, targetCount) {
    if (!points || points.length === 0) return createBlankFrame(targetCount);
    if (points.length >= targetCount) return points;

    // Detect if closed loop (Generator-like)
    // Check if first and last point are close and there's no mid-frame blanking
    const isClosedLoop = points.length < 800 && 
                         Math.abs(points[0].x - points[points.length-1].x) < 0.01 && 
                         Math.abs(points[0].y - points[points.length-1].y) < 0.01 &&
                         !points.some(p => p.blanking);

    let padded = [...points];
    
    if (isClosedLoop) {
        // REPEAT SHAPE (Good for circles, squares)
        const originalPoints = [...points];
        while (padded.length < targetCount) {
            padded = padded.concat(originalPoints);
        }
    } else {
        // TRAILING BLANK (Good for animations)
        const lastPoint = points[points.length - 1];
        const padCount = targetCount - points.length;
        for (let i = 0; i < padCount; i++) {
            padded.push({ ...lastPoint, r: 0, g: 0, b: 0, blanking: true });
        }
    }
    
    return padded;
}

function parseStatus(data) {
    try {
        if (!data || data.length < 22) return null;
        return parseStandardResponse(Array.from(data));
    } catch (e) { return null; }
}

class CustomEtherDream extends EtherDream {
    constructor(ip, port = 7765) {
        super();
        this.targetIp = ip;
        this.targetPort = port;
    }

    async start() {
        console.log(`[EtherDream] CustomEtherDream.start() for ${this.targetIp}`);
        try {
            const connPromise = EtherDream.connect(this.targetIp, this.targetPort);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 3000)
            );
            const conn = await Promise.race([connPromise, timeoutPromise]);
            if (conn) {
                this.connection = conn;
                this.connection.client.setNoDelay(true);
                console.log(`[EtherDream] Connected to ${this.targetIp}`);
                return true;
            }
        } catch (err) {
            console.error(`[EtherDream] Connection failed to ${this.targetIp}: ${err.message}`);
        }
        return false;
    }
}

const dacInstances = new Map(); 
let globalStatusCallback = null;

function setStatusCallback(cb) { globalStatusCallback = cb; }

function getOrInitDac(ip) {
    if (dacInstances.has(ip)) return dacInstances.get(ip);
    const dac = new DAC();
    const device = new CustomEtherDream(ip);
    const instance = { dac, device, started: false, lastFrameTime: 0, frameQueue: [] };
    dacInstances.set(ip, instance);
    return instance;
}

async function discoverDacs(timeout = 2000) {
    try {
        const devices = await EtherDream.find(); 
        return devices.map(d => {
            const macMatch = d.name.match(/@\s+([0-9a-fA-F:]+)/);
            return { ip: d.ip, port: d.port, name: d.name, mac: macMatch ? macMatch[1] : '', type: 'EtherDream' };
        });
    } catch (e) { return []; }
}

function convertPoints(points, isTyped) {
    if (!points || points.length === 0) return [];
    const numPoints = isTyped ? (points.length / 8) : points.length;
    const result = [];
    for (let i = 0; i < numPoints; i++) {
        if (isTyped) {
            const off = i * 8;
            result.push({
                x: points[off], y: points[off+1], 
                r: points[off+3], g: points[off+4], b: points[off+5],
                blanking: points[off+6] > 0.5
            });
        } else {
             const p = points[i];
             result.push({ x: p.x || 0, y: p.y || 0, r: p.r || 0, g: p.g || 0, b: p.b || 0, blanking: !!p.blanking });
        }
    }
    return result;
}

function optimizePoints(points, isTyped) {
    if (!points || points.length === 0) return [];
    const numPoints = isTyped ? (points.length / 8) : points.length;

    const getPoint = (i) => {
        if (isTyped) {
            const off = i * 8;
            return {
                x: points[off], y: points[off+1], 
                r: points[off+3], g: points[off+4], b: points[off+5],
                blanking: points[off+6] > 0.5
            };
        }
        const p = points[i];
        return { x: p.x || 0, y: p.y || 0, r: p.r || 0, g: p.g || 0, b: p.b || 0, blanking: !!p.blanking };
    };

    // --- ILDA PASSTHROUGH ---
    // Animation files already have optimization. We just pass them through.
    if (numPoints > 500) {
        const result = [];
        for (let i = 0; i < numPoints; i++) {
            result.push(getPoint(i));
        }
        return result;
    }

    const result = [];
    const firstPoint = getPoint(0);
    let prevPoint = firstPoint;

    for (let i = 0; i < numPoints; i++) {
        const currPoint = getPoint(i);
        if (prevPoint.blanking !== currPoint.blanking) {
            if (currPoint.blanking) {
                for (let d = 0; d < OPT_PATH_DWELL; d++) result.push({ ...prevPoint, r: 0, g: 0, b: 0, blanking: true });
            } else {
                result.push({ ...currPoint, r: 0, g: 0, b: 0, blanking: true });
                for (let d = 0; d < OPT_PATH_DWELL; d++) result.push({ ...currPoint, r: 0, g: 0, b: 0, blanking: true });
            }
        }
        const dx = currPoint.x - prevPoint.x; const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                result.push({
                    x: prevPoint.x + dx * t, y: prevPoint.y + dy * t,
                    r: currPoint.blanking ? 0 : currPoint.r, g: currPoint.blanking ? 0 : currPoint.g, b: currPoint.blanking ? 0 : currPoint.b,
                    blanking: currPoint.blanking
                });
            }
        }
        result.push(currPoint);
        prevPoint = currPoint;
    }
    return result;
}

function sendFrame(ip, channel, points, fps, options = {}) {
    const instance = getOrInitDac(ip);
    if (points && points.length > 0) {
        const isTyped = (points instanceof Float32Array);
        let optimized;
        if (options.skipOptimization) {
            optimized = convertPoints(points, isTyped);
        } else {
            optimized = optimizePoints(points, isTyped);
        }
        
        // Match PPS exactly to point count to maintain 60 FPS without jitter
        const pps = Math.max(1000, Math.min(40000, optimized.length * 60));
        
        instance.frameQueue.push({ points: optimized, rate: pps });
        if (instance.frameQueue.length > 30) instance.frameQueue.shift();
        instance.lastFrameTime = Date.now();
    } else {
        instance.frameQueue.push({ points: createBlankFrame(200), rate: 12000 });
        if (instance.frameQueue.length > 30) instance.frameQueue.shift();
        instance.lastFrameTime = Date.now();
    }
    if (!instance.started) startOutput(ip);
}

async function startOutput(ip) {
    const instance = getOrInitDac(ip);
    if (!instance || instance.started) return;
    instance.started = true;

    try {
        console.log(`[EtherDream] Starting output for ${ip}...`);
        const success = await instance.device.start();
        if (success) {
            const conn = instance.device.connection;
            if (conn) {
                let unackedPoints = 0;
                let unackedBatches = [];
                let localPointBuffer = [];
                let currentPPS = 30000;
                let lastValidFrame = null;
                let lastStatusTime = Date.now();
                let lastLoopRun = Date.now();
                let beginSentManual = false;
                let lastBeginAttempt = 0;

                conn.waitForResponse = (size, callback) => {
                    const timer = setTimeout(() => {
                        const idx = conn.inputhandlerqueue.findIndex(h => h.callback === callback);
                        if (idx !== -1) {
                            conn.inputhandlerqueue.splice(idx, 1);
                            callback(null); 
                        }
                    }, 1500);
                    conn.inputhandlerqueue.push({ size, callback, timer });
                    conn._popinputqueue();
                };

                conn._popinputqueue = function() {
                    while (this.inputqueue.length >= 22) {
                        const data = this.inputqueue.splice(0, 22);
                        const st = parseStatus(data);
                        if (!st) continue;
                        lastStatusTime = Date.now();
                        if (st.command === 'd') {
                            const ackedSize = unackedBatches.shift() || 0;
                            unackedPoints = Math.max(0, unackedPoints - ackedSize);
                        }
                        const handlerIndex = this.inputhandlerqueue.findIndex(h => h.size === 22);
                        if (handlerIndex !== -1) {
                            const handler = this.inputhandlerqueue.splice(handlerIndex, 1)[0];
                            if (handler.timer) clearTimeout(handler.timer);
                            handler.callback(data);
                        }
                        if (st.status.playback_state === 0) beginSentManual = false;
                        this.handleStandardResponse(st);
                    }
                };

                const sendCommand = (cmd, payload, cb) => {
                    const buf = payload ? Buffer.concat([Buffer.from(cmd), payload]) : Buffer.from(cmd);
                    conn.waitForResponse(22, cb);
                    if (conn.client && !conn.client.destroyed) conn.client.write(buf);
                };

                const sendBegin = (rate, cb) => {
                    const p = Buffer.alloc(6);
                    p.writeUInt16LE(0, 0); p.writeUInt32LE(rate, 2);
                    sendCommand('b', p, cb);
                };

                const sendUpdate = (rate, cb) => {
                    const p = Buffer.alloc(6);
                    p.writeUInt16LE(0, 0); p.writeUInt32LE(rate, 2);
                    sendCommand('u', p, cb);
                };

                const loop = () => {
                    if (!instance.started || !conn.client || conn.client.destroyed) return;
                    lastLoopRun = Date.now();

                    if (conn.playback_state === 0) {
                        beginSentManual = false;
                        sendCommand('p', null, () => setTimeout(loop, 10));
                        return;
                    }

                    const elapsedMs = Date.now() - lastStatusTime;
                    const predictedConsumed = (conn.playback_state === 2) ? Math.floor((elapsedMs * conn.rate) / 1000) : 0;
                    const expectedFullness = Math.max(0, conn.fullness + unackedPoints - predictedConsumed);

                    if (conn.playback_state === 1) {
                        const now = Date.now();
                        if (expectedFullness > 800) {
                            if (!beginSentManual || (now - lastBeginAttempt > 2000)) {
                                console.log(`[EtherDream] Saturated (${expectedFullness}), sending BEGIN for ${ip}`);
                                lastBeginAttempt = now;
                                beginSentManual = true;
                                sendBegin(currentPPS, () => setImmediate(loop));
                                return;
                            }
                        }
                    }

                    const TARGET_BUF = 1700;
                    const available = TARGET_BUF - expectedFullness;

                    if (available >= 40) {
                        if (localPointBuffer.length === 0) {
                            if (instance.frameQueue.length > 0) {
                                const frame = instance.frameQueue.shift();
                                lastValidFrame = frame;
                                // PAD with blanking at the last position ONLY to preserve animation timing
                                localPointBuffer = padPoints(frame.points, Math.ceil(frame.rate / 60));
                                currentPPS = frame.rate;
                            } else if (lastValidFrame) {
                                // Repeat last valid frame if renderer is slow
                                localPointBuffer = padPoints(lastValidFrame.points, Math.ceil(currentPPS / 60));
                            } else {
                                localPointBuffer = createBlankFrame(100);
                                currentPPS = 12000;
                            }
                        }

                        const canSend = Math.min(available, 100, localPointBuffer.length);
                        const batch = localPointBuffer.splice(0, canSend);
                        unackedPoints += batch.length;
                        unackedBatches.push(batch.length);

                        const writeData = () => {
                            const pkt = Buffer.alloc(3 + (batch.length * 18));
                            pkt[0] = 0x64; pkt.writeUInt16LE(batch.length, 1);
                            let off = 3;
                            for (const p of batch) {
                                const isBlank = !!p.blanking;
                                pkt.writeUInt16LE(0, off); off += 2;
                                pkt.writeInt16LE(toHWPos(p.x), off); off += 2;
                                pkt.writeInt16LE(toHWPos(p.y, true), off); off += 2;
                                pkt.writeUInt16LE(toHWColor(isBlank ? 0 : p.r), off); off += 2;
                                pkt.writeUInt16LE(toHWColor(isBlank ? 0 : p.g), off); off += 2;
                                pkt.writeUInt16LE(toHWColor(isBlank ? 0 : p.b), off); off += 2;
                                pkt.writeUInt16LE(isBlank ? 0 : 65535, off); off += 2; // Intensity follows blanking
                                pkt.writeUInt16LE(0, off); off += 2;
                                pkt.writeUInt16LE(0, off); off += 2;
                            }
                            conn.waitForResponse(22, (d) => {});
                            if (conn.client && !conn.client.destroyed) conn.client.write(pkt);
                            setImmediate(loop);
                        };

                        if (Math.abs(conn.rate - currentPPS) > 500) {
                            sendUpdate(currentPPS, () => {
                                conn.rate = currentPPS;
                                writeData();
                            });
                        } else {
                            writeData();
                        }
                        return;
                    }
                    setTimeout(loop, expectedFullness > 1750 ? 5 : 2);
                };

                conn.pollStream = () => {}; 
                conn.rate = currentPPS;
                loop();

                const statusInterval = setInterval(() => {
                    if (!instance.started) { clearInterval(statusInterval); return; }
                    if (Date.now() - lastLoopRun > 1000) loop();
                    if (globalStatusCallback) {
                        globalStatusCallback(ip, {
                            playback_state: conn.playback_state,
                            buffer_fullness: conn.fullness,
                            buffer_capacity: 1799,
                            point_rate: conn.rate,
                            valid: conn.valid
                        });
                    }
                }, 100);
            }
        } else { instance.started = false; }
    } catch (e) {
        console.error(`[EtherDream] startOutput error:`, e);
        instance.started = false;
    }
}

function connectDac(ip) { getOrInitDac(ip); }
async function stop(ip) {
    const instance = dacInstances.get(ip);
    if (instance) {
        instance.started = false;
        try { if (instance.device && instance.device.connection) await instance.dac.stop(); } catch (e) {}
        dacInstances.delete(ip);
    }
}
function closeAll() {
    for (const [ip, instance] of dacInstances.entries()) {
        instance.started = false;
        instance.dac.stop();
    }
    dacInstances.clear();
}
module.exports = { discoverDacs, sendFrame, startOutput, connectDac, closeAll, stop, setStatusCallback };