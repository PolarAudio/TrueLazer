const net = require('net');
const dgram = require('dgram');
const { Buffer } = require('buffer');

const ETHERDREAM_UDP_PORT = 7654;
const ETHERDREAM_TCP_PORT = 7765;
const STANDARD_RESPONSE_SIZE = 22;

const RESP_ACK = 0x61; // 'a'
const RESP_NAK = 0x4E; // 'N'
const RESP_NAK_FULL = 0x46; // 'F'
const RESP_NAK_INVL = 0x49; // 'I'
const RESP_NAK_ESTOP = 0x21; // '!'

const PLAYBACK_IDLE = 0;
const PLAYBACK_PREPARED = 1;
const PLAYBACK_PLAYING = 2;

const LIGHT_ENGINE_READY = 0;
const LIGHT_ENGINE_WARMUP = 1;
const LIGHT_ENGINE_COOLDOWN = 2;
const LIGHT_ENGINE_ESTOP = 3;

let globalStatusCallback = null;

function setStatusCallback(cb) {
    globalStatusCallback = cb;
}

class EtherDreamConnection {
    constructor(ip, port) {
        this.ip = ip;
        this.port = port;
        this.client = null;
        this.status = null;
        this.connected = false;
        this.connecting = false;
        
        this.playbackState = PLAYBACK_IDLE;
        this.lightEngineState = LIGHT_ENGINE_READY;
        this.source = 0;
        this.bufferFullness = 0;
        
        this.responseHandlers = [];
        this.inputBuffer = Buffer.alloc(0);
        
        this.frameQueue = [];
        this.isStreaming = false;
        this.laserActive = false;
        this.isOutputRunning = false; 
        
        this.dataRate = 30000;
        this.currentRate = this.dataRate;
        
        this.lastDataReceived = 0;
        this.dataTimeout = 2000; 
        
        this.lastSendTime = 0;
        this.sendTimer = null;
        this.sendInterval = 20;
        
        this.initialized = false;
        this.connectionEstablished = false;
        this.initializationInProgress = false;
        this.lastInitTime = 0;

        // Pipeline tracking
        this.pointsInFlight = 0;
        
        // Frame repetition for buffer under-run prevention
        this.lastValidFramePoints = null;
        this.lastValidFrameIsTyped = false;
        
        console.log(`[EtherDream] Created connection for ${ip}:${port}`);
    }

    async connect() {
        if (this.connected || this.connecting) return this.connected;
        this.connecting = true;
        
        return new Promise((resolve) => {
            console.log(`[EtherDream] Connecting to ${this.ip}:${this.port}...`);
            
            const timeout = setTimeout(() => {
                if (this.connecting) {
                    console.error(`[EtherDream] Connection timeout to ${this.ip}`);
                    this.destroy();
                    resolve(false);
                }
            }, 5000);

            this.client = net.connect(this.port, this.ip, async () => {
                clearTimeout(timeout);
                this.client.setNoDelay(true);
                this.connected = true;
                this.connecting = false;
                this.connectionEstablished = true;
                console.log(`[EtherDream] Connected to ${this.ip}`);
                this.startStreaming();
                resolve(true);
            });

            this.client.on('data', (data) => {
                this.inputBuffer = Buffer.concat([this.inputBuffer, data]);
                this.processInput();
            });

            this.client.on('error', (err) => {
                console.error(`[EtherDream] Socket error (${this.ip}):`, err.message);
                this.destroy();
                resolve(false);
            });

            this.client.on('close', () => {
                console.log(`[EtherDream] Connection closed (${this.ip})`);
                this.destroy();
            });
        });
    }

    destroy() {
        this.isStreaming = false;
        this.laserActive = false;
        this.isOutputRunning = false;
        
        if (this.sendTimer) {
            clearInterval(this.sendTimer);
            this.sendTimer = null;
        }
        
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        
        this.connected = false;
        this.connecting = false;
        this.connectionEstablished = false;
        this.inputBuffer = Buffer.alloc(0);
        this.responseHandlers.forEach(handler => handler.resolve(null));
        this.responseHandlers = [];
        this.frameQueue = [];
        this.initialized = false;
        this.initializationInProgress = false;
        this.pointsInFlight = 0;
    }

    processInput() {
        while (this.inputBuffer.length >= STANDARD_RESPONSE_SIZE) {
            const responseData = this.inputBuffer.slice(0, STANDARD_RESPONSE_SIZE);
            const resp = this.parseResponse(responseData);
            this.inputBuffer = this.inputBuffer.slice(STANDARD_RESPONSE_SIZE);
            
            if (!resp) continue;
            this.updateStatusFromResponse(resp);
            
            const handlerIndex = this.responseHandlers.findIndex(h => h.command === resp.command);
            if (handlerIndex !== -1) {
                const handler = this.responseHandlers[handlerIndex];
                this.responseHandlers.splice(handlerIndex, 1);
                handler.resolve(resp);
            }
        }
    }

    parseResponse(data) {
        if (!data || data.length < STANDARD_RESPONSE_SIZE) return null;
        return {
            response: data[0],
            command: data[1],
            status: {
                protocol: data[2],
                light_engine_state: data[3],
                playback_state: data[4],
                source: data[5],
                light_engine_flags: data.readUInt16LE(6),
                playback_flags: data.readUInt16LE(8),
                source_flags: data.readUInt16LE(10),
                buffer_fullness: data.readUInt16LE(12),
                point_rate: data.readUInt32LE(14),
                point_count: data.readUInt32LE(18)
            }
        };
    }

    updateStatusFromResponse(resp) {
        if (!resp) return;
        
        const oldPlaybackState = this.playbackState;
        this.status = resp.status;
        this.playbackState = resp.status.playback_state;
        this.lightEngineState = resp.status.light_engine_state;
        this.bufferFullness = resp.status.buffer_fullness;
        this.source = resp.status.source;
        
        if (this.initialized && 
            oldPlaybackState === PLAYBACK_PLAYING && 
            this.playbackState === PLAYBACK_IDLE &&
            Date.now() - this.lastInitTime > 1500) {
            console.warn(`[EtherDream] Unexpected transition to IDLE state for ${this.ip}. Buffer: ${this.bufferFullness}`);
            this.initialized = false;
            this.isOutputRunning = false;
        }

        if (globalStatusCallback) {
            globalStatusCallback(this.ip, this.status);
        }
    }

    waitForResponse(commandByte, timeoutMs = 1000) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const idx = this.responseHandlers.findIndex(h => h.resolve === resolve);
                if (idx !== -1) {
                    this.responseHandlers.splice(idx, 1);
                    resolve(null);
                }
            }, timeoutMs);

            this.responseHandlers.push({ 
                command: commandByte, 
                resolve: (resp) => {
                    clearTimeout(timer);
                    resolve(resp);
                } 
            });
        });
    }

    async sendCommand(cmdByte, extraData = null) {
        if (!this.connected) return null;
        const buf = extraData ? Buffer.concat([Buffer.from([cmdByte]), extraData]) : Buffer.from([cmdByte]);
        const promise = this.waitForResponse(cmdByte);
        this.client.write(buf);
        return await promise;
    }

    async startStreaming() {
        if (this.isStreaming) return;
        this.isStreaming = true;
        this.sendTimer = setInterval(() => { this.streamTick(); }, this.sendInterval);
    }

    async streamTick() {
        if (!this.connected || !this.isStreaming) return;
        
        try {
            const now = Date.now();
            if (!this.laserActive) {
                if (now - this.lastSendTime > 1000) {
                    await this.sendCommand(0x3F);
                    this.lastSendTime = now;
                }
                return;
            }

            if (!this.initialized && !this.initializationInProgress) {
                await this.initializePlayback();
                return;
            }
            
            if (!this.initialized || this.initializationInProgress || !this.isOutputRunning) {
                return;
            }
            
            if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                console.warn(`[EtherDream] E-Stop detected for ${this.ip}. Resetting...`);
                this.initialized = false;
                this.isOutputRunning = false;
                return;
            }
            
            await this.sendDataBatch();
            
        } catch (err) {
            console.error(`[EtherDream] Stream tick error for ${this.ip}:`, err.message);
        }
    }

    async initializePlayback() {
        if (this.initializationInProgress) return false;
        this.initializationInProgress = true;
        let attempts = 0;
        const maxAttempts = 3;
        
        try {
            while (attempts < maxAttempts) {
                attempts++;
                console.log(`[EtherDream] Handshake attempt ${attempts} for ${this.ip}`);
                
                await this.sendCommand(0x3F); 
                if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                    await this.sendCommand(0x63); 
                    await new Promise(r => setTimeout(r, 200));
                }
                
                if (this.playbackState !== PLAYBACK_IDLE) {
                    await this.sendCommand(0x73); 
                    await new Promise(r => setTimeout(r, 150));
                }
                
                await this.sendCommand(0x3F);
                if (this.playbackState !== PLAYBACK_IDLE) continue;
                
                const prepResp = await this.sendCommand(0x70); 
                if (!prepResp || prepResp.response !== RESP_ACK) continue;

                this.currentRate = this.dataRate;
                let totalPreFilled = 0;
                const TARGET_PREFILL = 1200;

                while (totalPreFilled < TARGET_PREFILL) {
                    let count = 0;
                    let pointsToSend = [];
                    let isTyped = false;

                    if (this.frameQueue.length > 0) {
                        const f = this.frameQueue.shift();
                        pointsToSend = f.points;
                        isTyped = this.isPointsTyped(pointsToSend);
                        count = isTyped ? (pointsToSend.length / 8) : pointsToSend.length;
                        if (totalPreFilled + count > 1750) {
                            this.frameQueue.unshift(f);
                            break;
                        }
                    } else {
                        count = Math.min(400, TARGET_PREFILL - totalPreFilled);
                        pointsToSend = Array(count).fill({ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true });
                        isTyped = false;
                    }

                    const success = await this.sendPoints(pointsToSend, isTyped, count);
                    if (!success) break;
                    totalPreFilled += count;
                }
                
                const beginData = Buffer.alloc(6);
                beginData.writeUInt16LE(0, 0); 
                beginData.writeUInt32LE(this.currentRate, 2); 
                
                const beginResp = await this.sendCommand(0x62, beginData); 
                if (beginResp && beginResp.response === RESP_ACK) {
                    console.log(`[EtherDream] Playback STARTED for ${this.ip} at ${this.currentRate}pps.`);
                    this.initialized = true;
                    this.isOutputRunning = true;
                    this.lastInitTime = Date.now();
                    return true;
                }
            }
            return false;
        } finally {
            this.initializationInProgress = false;
        }
    }

    isPointsTyped(points) {
        return points instanceof Float32Array || points instanceof Float64Array || Buffer.isBuffer(points);
    }

    async sendDataBatch() {
        const MAX_CAPACITY = 1750;
        const TARGET_FILL = 1600;
        const MIN_SAFE_BUFFER = 800; // Safe margin for ~26ms at 30kpps (Tick is 20ms)
        
        while (this.connected && this.initialized && this.playbackState !== PLAYBACK_IDLE) {
            let estimatedFullness = this.bufferFullness + this.pointsInFlight;
            if (estimatedFullness >= TARGET_FILL) break;

            let pointsToSend = [];
            let isTyped = false;
            let count = 0;
            let isRepeatFrame = false;

            if (this.frameQueue.length > 0) {
                const frame = this.frameQueue.shift();
                pointsToSend = frame.points;
                isTyped = this.isPointsTyped(pointsToSend);
                
                // Store for repetition
                this.lastValidFramePoints = pointsToSend;
                this.lastValidFrameIsTyped = isTyped;
            } else {
                // Queue is empty.
                if (this.lastValidFramePoints) {
                    // REPEAT LAST FRAME: Prevents under-run / IDLE switching
                    pointsToSend = this.lastValidFramePoints;
                    isTyped = this.lastValidFrameIsTyped;
                    isRepeatFrame = true;
                } else {
                    // No data ever received? Send blanking if strictly necessary.
                    if (estimatedFullness > MIN_SAFE_BUFFER) {
                        break;
                    }
                    count = Math.max(100, Math.min(400, TARGET_FILL - estimatedFullness));
                    pointsToSend = Array(count).fill({ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true });
                    isTyped = false;
                }
            }

            count = isTyped ? (pointsToSend.length / 8) : pointsToSend.length;
            
            if (estimatedFullness + count > MAX_CAPACITY) {
                if (!isRepeatFrame) {
                    // Only put it back if it was a NEW frame from the queue
                    this.frameQueue.unshift({ points: pointsToSend });
                }
                break;
            }

            this.sendPoints(pointsToSend, isTyped, count);
            if (this.pointsInFlight > 1200) break;
        }
    }

    async sendPoints(points, isTyped, pointCount) {
        if (pointCount === 0) return true;
        if (!this.connected) return false;
        
        this.pointsInFlight += pointCount;
        
        const MAX_BATCH = 500;
        let processed = 0;
        let finalSuccess = true;
        
        while (processed < pointCount) {
            const currentBatchSize = Math.min(pointCount - processed, MAX_BATCH);
            const packetSize = 1 + 2 + (currentBatchSize * 18);
            const packet = Buffer.alloc(packetSize);
            
            packet[0] = 0x64; 
            packet.writeUInt16LE(currentBatchSize, 1);
            let offset = 3;
            
            for (let i = 0; i < currentBatchSize; i++) {
                const idx = processed + i;
                let x, y, r, g, b, blanking;
                
                if (isTyped) {
                    const baseIdx = idx * 8;
                    x = points[baseIdx]; y = points[baseIdx + 1];
                    r = points[baseIdx + 3]; g = points[baseIdx + 4]; b = points[baseIdx + 5];
                    blanking = points[baseIdx + 6] > 0.5;
                } else {
                    const point = points[idx];
                    if (!point) { x=0; y=0; r=0; g=0; b=0; blanking=true; }
                    else {
                        x = point.x || 0; y = point.y || 0;
                        blanking = point.blanking || false;
                        r = point.r || 0; g = point.g || 0; b = point.b || 0;
                    }
                }

                // Normalize Colors: Ensure r, g, b are 0.0 - 1.0
                if (r > 1.0 || g > 1.0 || b > 1.0) { r /= 255; g /= 255; b /= 255; }
                
                packet.writeUInt16LE(0, offset); offset += 2;
                packet.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), offset); offset += 2;
                packet.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32767))), offset); offset += 2;
                packet.writeUInt16LE(blanking ? 0 : Math.round(r * 65535), offset); offset += 2;
                packet.writeUInt16LE(blanking ? 0 : Math.round(g * 65535), offset); offset += 2;
                packet.writeUInt16LE(blanking ? 0 : Math.round(b * 65535), offset); offset += 2;
                packet.writeUInt16LE(blanking ? 0 : 65535, offset); offset += 2; 
                packet.writeUInt16LE(0, offset); offset += 2; 
                packet.writeUInt16LE(0, offset); offset += 2; 
            }
            
            const promise = this.waitForResponse(0x64, 1000);
            this.client.write(packet);
            
            const resp = await promise;
            if (!resp || resp.response !== RESP_ACK) {
                finalSuccess = false;
            } else {
                this.updateStatusFromResponse(resp);
            }
            processed += currentBatchSize;
        }
        
        this.pointsInFlight -= pointCount;
        this.lastSendTime = Date.now();
        return finalSuccess;
    }

    enqueueFrame(frame) {
        if (!this.connected) return;
        this.frameQueue.push(frame);
        if (this.frameQueue.length > 30) this.frameQueue.shift();
    }
}

const connections = new Map();

function discoverDacs(timeout = 2000) {
    return new Promise((resolve) => {
        const dacs = new Map();
        const server = dgram.createSocket('udp4');
        server.on('message', (msg, rinfo) => {
            if (msg.length < 36) return;
            const mac = Array.from(msg.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join(':');
            if (!dacs.has(rinfo.address)) {
                dacs.set(rinfo.address, { ip: rinfo.address, port: ETHERDREAM_TCP_PORT, name: `EtherDream (${mac})`, mac, type: 'EtherDream' });
            }
        });
        server.on('error', (err) => { try { server.close(); } catch(e) {} resolve(Array.from(dacs.values())); });
        server.bind(ETHERDREAM_UDP_PORT, () => {});
        setTimeout(() => { try { server.close(); } catch(e) {} resolve(Array.from(dacs.values())); }, timeout);
    });
}

function sendFrame(ip, channel, frame, fps) {
    let conn = connections.get(ip);
    if (!conn) {
        conn = new EtherDreamConnection(ip, ETHERDREAM_TCP_PORT);
        connections.set(ip, conn);
    }
    if (!conn.connected && !conn.connecting) conn.connect();
    conn.enqueueFrame(frame);
}

function startOutput(ip) {
    console.log(`[EtherDream] Starting output for ${ip}`);
    let conn = connections.get(ip);
    if (!conn) {
        conn = new EtherDreamConnection(ip, ETHERDREAM_TCP_PORT);
        connections.set(ip, conn);
    }
    conn.laserActive = true;
    if (!conn.connected && !conn.connecting) conn.connect();
}

function connectDac(ip) {
    let conn = connections.get(ip);
    if (!conn) {
        conn = new EtherDreamConnection(ip, ETHERDREAM_TCP_PORT);
        connections.set(ip, conn);
    }
    if (!conn.connected && !conn.connecting) conn.connect();
}

async function stop(ip) {
    const conn = connections.get(ip);
    if (conn) {
        conn.laserActive = false;
        conn.isOutputRunning = false;
        conn.frameQueue = [];
        conn.initialized = false;
        if (conn.connected) await conn.sendCommand(0x73); 
    }
}

function closeAll() {
    for (const conn of connections.values()) conn.destroy();
    connections.clear();
}

module.exports = { discoverDacs, sendFrame, startOutput, connectDac, closeAll, stop, setStatusCallback };