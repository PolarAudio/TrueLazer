const { DAC } = require('@laser-dac/core');
const { EtherDream } = require('@laser-dac/ether-dream');
const os = require('os');

// Optimization Constants
const OPT_MAX_DIST = 0.08; 
const OPT_ANGLE_THRESHOLD = 0.4; // ~23 degrees
const OPT_CORNER_DWELL = 5;
const OPT_PATH_DWELL = 4;

function createBlankFrame(count = 500) {
    return Array(count).fill({ x: 0.5, y: 0.5, r: 0, g: 0, b: 0 });
}

// Wrapper for EtherDream to allow specifying IP and custom search
class CustomEtherDream extends EtherDream {
    constructor(ip, port = 7765) {
        super();
        this.targetIp = ip;
        this.targetPort = port;
    }

    async start() {
        console.log(`[EtherDream] Starting connection to ${this.targetIp}:${this.targetPort}`);
        const conn = await EtherDream.connect(this.targetIp, this.targetPort);
        if (conn) {
            this.connection = conn;
            console.log(`[EtherDream] Connected to ${this.targetIp}`);
            return true;
        }
        console.error(`[EtherDream] Failed to connect to ${this.targetIp}`);
        return false;
    }
}

const dacInstances = new Map(); // ip -> { dac, device, scene, started }
let globalStatusCallback = null;

function setStatusCallback(cb) {
    globalStatusCallback = cb;
}

function getOrInitDac(ip) {
    if (dacInstances.has(ip)) return dacInstances.get(ip);

    const dac = new DAC();
    const device = new CustomEtherDream(ip);
    const scene = { points: [] };

    dac.use(device);
    
    const instance = { dac, device, scene, started: false, lastFrameTime: 0 };
    dacInstances.set(ip, instance);
    return instance;
}

async function discoverDacs(timeout = 2000) {
    try {
        console.log('[EtherDream] Starting discovery...');
        const devices = await EtherDream.find(); 
        console.log(`[EtherDream] Discovered ${devices.length} devices.`);
        return devices.map(d => {
            // Extract MAC from name like "EtherDream @ 00:11:22:33:44:55"
            const macMatch = d.name.match(/@\s+([0-9a-fA-F:]+)/);
            const mac = macMatch ? macMatch[1] : '';
            return {
                ip: d.ip,
                port: d.port,
                name: d.name,
                mac: mac,
                type: 'EtherDream'
            };
        });
    } catch (e) {
        console.error('[EtherDream] Discovery error:', e);
        return [];
    }
}

function optimizePoints(points, isTyped) {
    if (!points || points.length === 0) return [];

    const result = [];
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
        return {
            x: p.x || 0,
            y: p.y || 0,
            r: p.r || 0,
            g: p.g || 0,
            b: p.b || 0,
            blanking: p.blanking || false
        };
    };

    const firstPoint = getPoint(0);
    let prevPoint = firstPoint;
    
    // Initial path dwell (Blanked)
    for (let d = 0; d < OPT_PATH_DWELL; d++) {
        result.push({ ...firstPoint, r: 0, g: 0, b: 0, blanking: true });
    }

    for (let i = 0; i < numPoints; i++) {
        const currPoint = getPoint(i);
        
        // 1. Path Dwell (Laser state change)
        if (prevPoint.blanking !== currPoint.blanking) {
            if (currPoint.blanking) {
                for (let d = 0; d < 2; d++) result.push({ ...prevPoint });
                for (let d = 0; d < OPT_PATH_DWELL; d++) result.push({ ...prevPoint, r: 0, g: 0, b: 0, blanking: true });
            } else {
                for (let d = 0; d < OPT_PATH_DWELL; d++) result.push({ ...currPoint, r: 0, g: 0, b: 0, blanking: true });
                for (let d = 0; d < 2; d++) result.push({ ...currPoint });
            }
        }

        // 2. Interpolation (Long lines / Jumps)
        const dx = currPoint.x - prevPoint.x;
        const dy = currPoint.y - prevPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > OPT_MAX_DIST) {
            const steps = Math.floor(dist / OPT_MAX_DIST);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                result.push({
                    x: prevPoint.x + dx * t,
                    y: prevPoint.y + dy * t,
                    r: currPoint.blanking ? 0 : currPoint.r, 
                    g: currPoint.blanking ? 0 : currPoint.g, 
                    b: currPoint.blanking ? 0 : currPoint.b,
                    blanking: currPoint.blanking
                });
            }
        }

        // 3. Corner Dwell
        if (!currPoint.blanking && i > 0 && i < numPoints - 1) {
            const nextPoint = getPoint(i + 1);
            const v1x = currPoint.x - prevPoint.x;
            const v1y = currPoint.y - prevPoint.y;
            const v2x = nextPoint.x - currPoint.x;
            const v2y = nextPoint.y - currPoint.y;
            
            const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
            
            if (mag1 > 0.001 && mag2 > 0.001) {
                const dot = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
                const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                
                if (angle > OPT_ANGLE_THRESHOLD) {
                    for (let d = 0; d < OPT_CORNER_DWELL; d++) result.push({ ...currPoint });
                }
            }
        }

        result.push(currPoint);
        prevPoint = currPoint;
    }

    const lastPoint = prevPoint;
    const dx = firstPoint.x - lastPoint.x;
    const dy = firstPoint.y - lastPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    for (let d = 0; d < OPT_PATH_DWELL; d++) {
        result.push({ ...lastPoint, r: 0, g: 0, b: 0, blanking: true });
    }

    if (dist > OPT_MAX_DIST) {
        const steps = Math.floor(dist / OPT_MAX_DIST);
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            result.push({
                x: lastPoint.x + dx * t,
                y: lastPoint.y + dy * t,
                r: 0, g: 0, b: 0,
                blanking: true
            });
        }
    }

    result.push({ ...firstPoint, r: 0, g: 0, b: 0, blanking: true });

    return result;
}

function sendFrame(ip, channel, frame, fps) {
    const instance = getOrInitDac(ip);
    
    if (frame && frame.points && frame.points.length > 0) {
        const isTyped = frame.isTypedArray || (frame.points instanceof Float32Array);
        let optimized = optimizePoints(frame.points, isTyped);
        
        // Hybrid Strategy: Minimum Packet Size + Dynamic PPS
        // Very small frames (e.g. < 200 points) cause high network overhead and potential buffer underruns
        // even if the PPS is low. We duplicate points to increase packet efficiency.
        const MIN_PACKET_POINTS = 200;
        if (optimized.length > 0 && optimized.length < MIN_PACKET_POINTS) {
            const originalLength = optimized.length;
            // Duplicate until we have at least MIN_PACKET_POINTS
            while (optimized.length < MIN_PACKET_POINTS) {
                optimized = optimized.concat(optimized.slice(0, originalLength));
            }
        }

        // Calculate rate needed to play these points in ~16.6ms (60 FPS)
        // Target PPS = Total Points * 60
        let targetRate = 30000;
        if (optimized.length > 0) {
            const calculatedRate = optimized.length * 60;
            // Clamp to valid range (1k - 60k, though EtherDream usually maxes at 30k or 40k)
            targetRate = Math.max(1000, Math.min(40000, calculatedRate));
        }
        
        instance.targetRate = targetRate;

        // Convert to library format (0..1)
        instance.scene.points = optimized.map(p => {
            // Convert -1..1 to 0..1
            const nx = (p.x + 1) / 2;
            const ny = (p.y + 1) / 2;
            
            // Handle color normalization if needed
            let r = p.r, g = p.g, b = p.b;
            if (r > 1.0 || g > 1.0 || b > 1.0) {
                r /= 255; g /= 255; b /= 255;
            }
            
            return {
                x: nx,
                y: ny,
                r: p.blanking ? 0 : Math.max(0, Math.min(1, r)),
                g: p.blanking ? 0 : Math.max(0, Math.min(1, g)),
                b: p.blanking ? 0 : Math.max(0, Math.min(1, b))
            };
        });
        instance.lastFrameTime = Date.now();

        if (instance.started) {
            // CRITICAL FIX: Do NOT call stream() again, as it sends a STOP command!
            // Instead, just update the rate on the active connection.
            // The library's pull-loop will pick up the new points from instance.scene automatically.
            if (instance.device && instance.device.connection) {
                instance.device.connection.rate = instance.targetRate;
            }
        } else {
            startOutput(ip);
        }
    } else {
        // Empty frame? Send a block of blank points to keep the buffer full and prevent IDLE.
        // 500 points @ 30kpps is ~16ms, essentially one 60Hz frame.
        instance.scene.points = createBlankFrame(500); 
        instance.targetRate = 30000; // Reset rate for blanking
        
        if (instance.started) {
             if (instance.device && instance.device.connection) {
                instance.device.connection.rate = 30000;
            }
        } else {
             // If we aren't started, we might not want to start just for blanking 
             // unless we want to keep the connection alive.
             // For now, we only start if we have actual data or if explicitly requested.
        }
    }
}

async function startOutput(ip) {
    const instance = getOrInitDac(ip);
    if (!instance.started) {
        // Ensure we have at least something to stream
        if (instance.scene.points.length === 0) {
            instance.scene.points = createBlankFrame(500);
        }
        
        // Use the calculated target rate or default to 30k
        const rate = instance.targetRate || 30000;

        instance.started = true;
        console.log(`[EtherDream] Starting output for ${ip} at ${rate}pps`);
        const success = await instance.dac.start();
        if (success) {
            // PATCH: Fix library crash on stop/shutdown
            // The @laser-dac/ether-dream library's internal loop can try to send data
            // even after the socket has been destroyed. We monkey-patch _send to prevent this.
            if (instance.device && instance.device.connection) {
                const conn = instance.device.connection;
                
                // Patch _send
                const originalSend = conn._send.bind(conn);
                conn._send = (cmd) => {
                    if (conn.client && !conn.client.destroyed) {
                        originalSend(cmd);
                    }
                };

                // Patch pollStream to stop the loop on disconnect
                const originalPollStream = conn.pollStream.bind(conn);
                conn.pollStream = () => {
                    if (conn.client && !conn.client.destroyed) {
                        originalPollStream();
                    }
                };
            }

            // Start stream
            instance.device.stream(instance.scene, rate);
            
            // Status polling and Blanking Watchdog loop
            const pollStatus = () => {
                if (!instance.started) return;
                
                // Watchdog: If no new frame for 200ms, blank the output
                if (Date.now() - instance.lastFrameTime > 200) {
                    const isBlank = instance.scene.points.length === 500 && 
                                    instance.scene.points[0].r === 0 && 
                                    instance.scene.points[0].g === 0 && 
                                    instance.scene.points[0].b === 0;
                    
                    if (!isBlank) {
                        instance.scene.points = createBlankFrame(500);
                        instance.targetRate = 30000;
                        if (instance.device) instance.device.stream(instance.scene, 30000);
                    }
                }

                const conn = instance.device.connection;
                if (conn && globalStatusCallback) {
                    // STUCK STATE WATCHDOG
                    // State 0 = IDLE, 1 = PREPARED, 2 = PLAYING
                    if (instance.started && conn.playback_state !== 2) {
                        instance.stuckCounter = (instance.stuckCounter || 0) + 1;
                        if (instance.stuckCounter > 10) { // ~1 second
                            console.warn(`[EtherDream] DAC ${ip} stuck in state ${conn.playback_state} (Buf: ${conn.fullness}). Restarting stream...`);
                            // Kickstart the stream again
                            instance.device.stream(instance.scene, instance.targetRate || 30000);
                            instance.stuckCounter = 0;
                        }
                    } else {
                        instance.stuckCounter = 0;
                    }

                    if (conn.playback_state === 0 && instance.started) {
                        // console.warn(`[EtherDream] Unexpected IDLE state detected for ${ip}.`);
                    }

                    globalStatusCallback(ip, {
                        playback_state: conn.playback_state,
                        buffer_fullness: conn.fullness,
                        buffer_capacity: 1799,
                        point_rate: conn.rate,
                        valid: conn.valid
                    });
                }
                setTimeout(pollStatus, 100); 
            };
            pollStatus();
        } else {
            instance.started = false;
            console.error(`[EtherDream] Failed to start DAC for ${ip}`);
        }
    }
}


function connectDac(ip) {
    getOrInitDac(ip);
}

async function stop(ip) {
    const instance = dacInstances.get(ip);
    if (instance) {
        console.log(`[EtherDream] Stopping output for ${ip}`);
        instance.started = false;
        instance.dac.stop();
        dacInstances.delete(ip);
    }
}

function closeAll() {
    console.log('[EtherDream] Closing all connections');
    for (const [ip, instance] of dacInstances.entries()) {
        instance.started = false;
        instance.dac.stop();
    }
    dacInstances.clear();
}

module.exports = {
    discoverDacs,
    sendFrame,
    startOutput,
    connectDac,
    closeAll,
    stop,
    setStatusCallback
};