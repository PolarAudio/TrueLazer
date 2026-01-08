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
        this.fixedRate = 30000; 
        
        // Streaming state
        this.streamingActive = false;
        this.lastSendTime = 0;
        this.sendInterval = null;
        this.minBufferLevel = 500;
        this.targetBufferLevel = 1200;
        this.maxBufferLevel = 1700;
        
        // Performance monitoring
        this.packetsSent = 0;
        this.lastStatusUpdate = 0;
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
                console.log(`[EtherDream] Connected to ${this.ip}`);
                
                // Start streaming
                this.startStreaming();
                resolve(true);
            });

            this.client.on('data', (data) => {
                this.inputBuffer = Buffer.concat([this.inputBuffer, data]);
                this.processInput();
            });

            this.client.on('error', (err) => {
                console.error(`[EtherDream] Socket error (${this.ip}):`, err);
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
        this.streamingActive = false;
        
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
        
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        
        this.connected = false;
        this.connecting = false;
        this.inputBuffer = Buffer.alloc(0);
        this.responseHandlers.forEach(handler => handler.resolve(null));
        this.responseHandlers = [];
        this.frameQueue = [];
    }

    processInput() {
        while (this.inputBuffer.length >= STANDARD_RESPONSE_SIZE) {
            const responseData = this.inputBuffer.slice(0, STANDARD_RESPONSE_SIZE);
            const resp = this.parseResponse(responseData);
            this.inputBuffer = this.inputBuffer.slice(STANDARD_RESPONSE_SIZE);
            
            if (!resp) continue;
            
            // Update status immediately
            this.updateStatusFromResponse(resp);
            
            // Find handler for this specific command
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
        
        this.status = resp.status;
        this.playbackState = resp.status.playback_state;
        this.lightEngineState = resp.status.light_engine_state;
        this.bufferFullness = resp.status.buffer_fullness;
        this.source = resp.status.source;
        this.lastStatusUpdate = Date.now();
        
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
                    console.warn(`[EtherDream] Timeout waiting for 0x${commandByte.toString(16)}`);
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
        
        const resp = await promise;
        return resp;
    }

    async startStreaming() {
        if (this.isStreaming) return;
        this.isStreaming = true;
        
        // Use setInterval for consistent data sending
        this.sendInterval = setInterval(() => {
            this.sendDataLoop();
        }, 1); // Run every 1ms for high frequency updates
        
        console.log(`[EtherDream] Started streaming for ${this.ip}`);
    }

    async sendDataLoop() {
        if (!this.connected || !this.isStreaming) return;
        
        try {
            // If laser is not active, just maintain connection
            if (!this.laserActive) {
                if (this.playbackState !== PLAYBACK_IDLE) {
                    await this.sendCommand(0x73); // Stop
                }
                return;
            }

            // Handle E-Stop
            if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                await this.sendCommand(0x63); // Clear E-Stop
                return;
            }

            // Initialize playback if needed
            if (this.playbackState === PLAYBACK_IDLE) {
                await this.initializePlayback();
                return;
            }

            // Send data if we're in prepared or playing state
            if (this.playbackState === PLAYBACK_PREPARED || this.playbackState === PLAYBACK_PLAYING) {
                await this.sendDataToBuffer();
            }
            
        } catch (err) {
            console.error(`[EtherDream] Send loop error:`, err.message);
        }
    }

    async initializePlayback() {
        console.log(`[EtherDream] Initializing playback...`);
        
        // Prepare
        const prepResp = await this.sendCommand(0x70);
        if (!prepResp || prepResp.response !== RESP_ACK) {
            console.log(`[EtherDream] Prepare failed`);
            return false;
        }
        
        console.log(`[EtherDream] Prepare successful`);
        
        // Begin with rate
        const beginData = Buffer.alloc(6);
        beginData.writeUInt16LE(0, 0); // Low water mark
        beginData.writeUInt32LE(this.fixedRate, 2); // Rate
        
        const beginResp = await this.sendCommand(0x62, beginData);
        if (!beginResp || beginResp.response !== RESP_ACK) {
            console.log(`[EtherDream] Begin failed`);
            return false;
        }
        
        console.log(`[EtherDream] Playback started at ${this.fixedRate}pps`);
        return true;
    }

    async sendDataToBuffer() {
        // Only send if buffer needs more data
        if (this.bufferFullness >= this.maxBufferLevel) {
            return;
        }
        
        // Get points to send
        let points;
        let isTyped = false;
        
        if (this.frameQueue.length > 0) {
            const frame = this.frameQueue.shift();
            points = frame.points;
            isTyped = frame.isTypedArray;
        } else {
            // No data available - send minimal blanking
            const blankCount = 20; // Small batch to avoid strobing
            points = Array(blankCount).fill({ 
                x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true 
            });
            isTyped = false;
        }
        
        // Send the points
        await this.sendPoints(points, isTyped);
        this.lastSendTime = Date.now();
        this.packetsSent++;
    }

    async sendPoints(points, isTyped) {
        const pointCount = isTyped ? (points.length / 8) : points.length;
        if (pointCount === 0) return false;
        
        // Determine optimal batch size (80 points max per EtherDream spec)
        const batchSize = Math.min(pointCount, 80);
        
        // Create combined packet: 'q' + rate + 'd' + count + points
        const packetSize = 5 + 3 + (batchSize * 18);
        const packet = Buffer.alloc(packetSize);
        
        let offset = 0;
        
        // 'q' command with rate (0x71)
        packet[offset++] = 0x71;
        packet.writeUInt32LE(this.fixedRate, offset);
        offset += 4;
        
        // 'd' command with point count (0x64)
        packet[offset++] = 0x64;
        packet.writeUInt16LE(batchSize, offset);
        offset += 2;
        
        // Add points
        for (let i = 0; i < batchSize; i++) {
            let x, y, r, g, b, blanking;
            
            if (isTyped) {
                const baseIdx = i * 8;
                x = points[baseIdx];
                y = points[baseIdx + 1];
                r = points[baseIdx + 3];
                g = points[baseIdx + 4];
                b = points[baseIdx + 5];
                blanking = points[baseIdx + 6] > 0.5;
            } else {
                const point = points[i];
                x = point.x;
                y = point.y;
                r = point.r;
                g = point.g;
                b = point.b;
                blanking = point.blanking;
            }
            
            // Control word
            packet.writeUInt16LE(0, offset);
            offset += 2;
            
            // X coordinate
            const xInt = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
            packet.writeInt16LE(xInt, offset);
            offset += 2;
            
            // Y coordinate
            const yInt = Math.max(-32768, Math.min(32767, Math.round(y * 32767)));
            packet.writeInt16LE(yInt, offset);
            offset += 2;
            
            // RGB colors (0-65535, scaled from 0-255)
            packet.writeUInt16LE(blanking ? 0 : Math.round(r * 257), offset);
            offset += 2;
            packet.writeUInt16LE(blanking ? 0 : Math.round(g * 257), offset);
            offset += 2;
            packet.writeUInt16LE(blanking ? 0 : Math.round(b * 257), offset);
            offset += 2;
            
            // Intensity
            packet.writeUInt16LE(blanking ? 0 : 65535, offset);
            offset += 2;
            
            // User bytes
            packet.writeUInt16LE(0, offset);
            offset += 2;
            packet.writeUInt16LE(0, offset);
            offset += 2;
        }
        
        // Send and wait for both responses
        const qPromise = this.waitForResponse(0x71, 500);
        const dPromise = this.waitForResponse(0x64, 500);
        
        this.client.write(packet);
        
        // Wait for responses
        const [qResp, dResp] = await Promise.all([qPromise, dPromise]);
        
        // Check responses
        if (!qResp || !dResp) {
            console.warn(`[EtherDream] Missing responses for packet`);
            return false;
        }
        
        if (qResp.response !== RESP_ACK || dResp.response !== RESP_ACK) {
            console.warn(`[EtherDream] NAK received: q=0x${qResp.response.toString(16)}, d=0x${dResp.response.toString(16)}`);
            return false;
        }
        
        // Update status from 'd' response
        this.updateStatusFromResponse(dResp);
        
        return true;
    }

    enqueueFrame(frame) {
        this.laserActive = true;
        this.frameQueue.push(frame);
        
        // Limit queue size
        if (this.frameQueue.length > 30) {
            this.frameQueue.shift();
        }
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
                dacs.set(rinfo.address, {
                    ip: rinfo.address,
                    port: ETHERDREAM_TCP_PORT,
                    name: `EtherDream (${mac})`,
                    mac,
                    type: 'EtherDream'
                });
            }
        });
        server.on('error', (err) => {
            console.error('[EtherDream] Discovery error:', err);
            try { server.close(); } catch(e) {}
            resolve(Array.from(dacs.values()));
        });
        server.bind(ETHERDREAM_UDP_PORT, () => {});
        setTimeout(() => {
            try { server.close(); } catch(e) {}
            resolve(Array.from(dacs.values()));
        }, timeout);
    });
}

function sendFrame(ip, channel, frame, fps) {
    let conn = connections.get(ip);
    if (!conn) {
        conn = new EtherDreamConnection(ip, ETHERDREAM_TCP_PORT);
        connections.set(ip, conn);
        // Auto-connect when first frame is sent
        if (!conn.connected && !conn.connecting) {
            conn.connect();
        }
    }
    conn.enqueueFrame(frame);
}

function connectDac(ip) {
    console.log(`[EtherDream] Connect DAC called for ${ip}`);
    let conn = connections.get(ip);
    if (!conn) {
        conn = new EtherDreamConnection(ip, ETHERDREAM_TCP_PORT);
        connections.set(ip, conn);
    }
    if (!conn.connected && !conn.connecting) {
        conn.connect();
    }
}

async function stop(ip) {
    const conn = connections.get(ip);
    if (conn) {
        conn.laserActive = false;
        conn.frameQueue = [];
        if (conn.connected) {
            await conn.sendCommand(0x73); // Stop command
        }
    }
}

function closeAll() {
    for (const conn of connections.values()) conn.destroy();
    connections.clear();
}

module.exports = { discoverDacs, sendFrame, connectDac, closeAll, stop, setStatusCallback };