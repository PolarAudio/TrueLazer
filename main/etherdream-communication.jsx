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
        
        // Fixed rate for now - no adaptation
        this.currentRate = 12000;
        
        // Blanking mode
        this.blankingMode = true;
        this.lastDataReceived = 0;
        this.dataTimeout = 1000; // Increased to 1 second
        
        // Timing control
        this.lastSendTime = 0;
        this.sendTimer = null;
        this.sendInterval = 20;
        
        // State
        this.initialized = false;
        this.connectionEstablished = false;
        this.initializationInProgress = false;
        
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
                
                // Wait a moment for the connection to stabilize
                await new Promise(r => setTimeout(r, 100));
                
                // Start with blanking mode
                this.blankingMode = true;
                this.currentRate = 12000;
                
                // Initialize streaming
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
    }

    processInput() {
        while (this.inputBuffer.length >= STANDARD_RESPONSE_SIZE) {
            const responseData = this.inputBuffer.slice(0, STANDARD_RESPONSE_SIZE);
            const resp = this.parseResponse(responseData);
            this.inputBuffer = this.inputBuffer.slice(STANDARD_RESPONSE_SIZE);
            
            if (!resp) continue;
            
            // Update status immediately
            this.updateStatusFromResponse(resp);
            
            // Find handler for this command
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
        
        console.log(`[EtherDream] Starting streaming in blanking mode (${this.currentRate}pps)`);
        
        // Start the send loop with initial interval
        this.sendTimer = setInterval(() => {
            this.streamTick();
        }, this.sendInterval);
    }

    async streamTick() {
        if (!this.connected || !this.isStreaming) return;
        
        try {
            // Check if we should switch to blanking mode
            const now = Date.now();
            if (!this.blankingMode && now - this.lastDataReceived > this.dataTimeout) {
                console.log(`[EtherDream] No data for ${this.dataTimeout}ms, switching to blanking mode`);
                this.switchToBlankingMode();
                return;
            }
            
            // Initialize playback if needed
            if (!this.initialized && !this.initializationInProgress) {
                await this.initializePlayback();
                return;
            }
            
            // Don't send data if we're not initialized or initializing
            if (!this.initialized || this.initializationInProgress) {
                return;
            }
            
            // Handle E-Stop
            if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                console.log(`[EtherDream] Clearing E-Stop...`);
                await this.sendCommand(0x63); // Clear E-Stop
                await new Promise(r => setTimeout(r, 50));
                this.initialized = false; // Need to reinitialize
                return;
            }
            
            // Send appropriate data based on mode
            if (this.blankingMode) {
                await this.sendBlankingBatch();
            } else {
                await this.sendDataBatch();
            }
            
        } catch (err) {
            console.error(`[EtherDream] Stream tick error:`, err.message);
        }
    }
    
    async initializePlayback() {
        if (this.initializationInProgress) return false;
        
        this.initializationInProgress = true;
        console.log(`[EtherDream] Initializing playback at ${this.currentRate}pps`);
        
        try {
            // Send a ping to get current status
            const pingResp = await this.sendCommand(0x3F);
            if (!pingResp) {
                console.log(`[EtherDream] No response to ping`);
                return false;
            }
            
            console.log(`[EtherDream] Current state: playback=${this.playbackState}, light_engine=${this.lightEngineState}`);
            
            // Clear E-Stop if needed
            if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                console.log(`[EtherDream] Clearing E-Stop...`);
                await this.sendCommand(0x63); // Clear E-Stop
                await new Promise(r => setTimeout(r, 100));
            }
            
            // If we're already playing or prepared, stop first
            if (this.playbackState === PLAYBACK_PLAYING || this.playbackState === PLAYBACK_PREPARED) {
                console.log(`[EtherDream] Stopping current playback...`);
                const stopResp = await this.sendCommand(0x73); // Stop
                if (!stopResp || stopResp.response !== RESP_ACK) {
                    console.log(`[EtherDream] Stop command failed`);
                }
                await new Promise(r => setTimeout(r, 100));
            }
            
            // Wait for IDLE state
            let attempts = 0;
            while (attempts < 5 && this.playbackState !== PLAYBACK_IDLE) {
                await this.sendCommand(0x3F); // Ping for status
                await new Promise(r => setTimeout(r, 20));
                attempts++;
            }
            
            if (this.playbackState !== PLAYBACK_IDLE) {
                console.log(`[EtherDream] Could not get to IDLE state after ${attempts} attempts`);
                return false;
            }
            
            // Prepare
            const prepResp = await this.sendCommand(0x70);
            if (!prepResp) {
                console.log(`[EtherDream] No response to prepare command`);
                return false;
            }
            
            if (prepResp.response !== RESP_ACK) {
                console.log(`[EtherDream] Prepare failed with response: 0x${prepResp.response.toString(16)}`);
                return false;
            }
            
            console.log(`[EtherDream] Prepare successful`);
            
            // Begin with current rate
            const beginData = Buffer.alloc(6);
            beginData.writeUInt16LE(0, 0); // Low water mark
            beginData.writeUInt32LE(this.currentRate, 2); // Rate
            
            const beginResp = await this.sendCommand(0x62, beginData);
            if (!beginResp || beginResp.response !== RESP_ACK) {
                console.log(`[EtherDream] Begin failed`);
                return false;
            }
            
            console.log(`[EtherDream] Playback initialized at ${this.currentRate}pps`);
            this.initialized = true;
            
            // Wait a bit for playback to start
            await new Promise(r => setTimeout(r, 100));
            return true;
            
        } finally {
            this.initializationInProgress = false;
        }
    }
    
    switchToBlankingMode() {
        if (this.blankingMode) return;
        
        console.log(`[EtherDream] Switching to blanking mode at 12000pps`);
        this.blankingMode = true;
        this.currentRate = 12000;
        
        // Clear any pending frames
        this.frameQueue = [];
        
        // Adjust send interval for blanking
        this.sendInterval = 50; // 20Hz for blanking
        this.updateSendInterval();
    }
    
    switchToDataMode() {
        if (!this.blankingMode) return;
        
        console.log(`[EtherDream] Switching to data mode at ${this.currentRate}pps`);
        this.blankingMode = false;
        this.lastDataReceived = Date.now();
        
        // Adjust send interval for data
        this.sendInterval = 20; // 50Hz for data
        this.updateSendInterval();
    }
    
    updateSendInterval() {
        if (this.sendTimer) {
            clearInterval(this.sendTimer);
            this.sendTimer = setInterval(() => {
                this.streamTick();
            }, this.sendInterval);
        }
    }
    
    async sendBlankingBatch() {
        // In blanking mode, we only need to send enough points to keep the buffer from underflowing
        const TARGET_BUFFER_BLANKING = 400;
        
        if (this.bufferFullness >= TARGET_BUFFER_BLANKING) {
            return; // Buffer is full enough
        }
        
        // Only send if we're in a state that can accept data
        if (this.playbackState !== PLAYBACK_PLAYING && this.playbackState !== PLAYBACK_PREPARED) {
            return;
        }
        
        // Send a small batch of blanking points
        const blankCount = 20; // Very small batch
        const points = Array(blankCount).fill({ 
            x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true 
        });
        
        const success = await this.sendPoints(points, false, blankCount);
        if (success) {
            this.lastSendTime = Date.now();
        }
        
        // Log occasionally
        if (Math.random() < 0.01) { // 1% chance per batch
            console.log(`[EtherDream] Blanking: ${blankCount} points, buffer: ${this.bufferFullness}, state: ${this.playbackState}`);
        }
    }
    
        async sendDataBatch() {
        // In data mode, we need to maintain buffer for smooth playback
        const TARGET_BUFFER_DATA = 1200;
        
        console.log(`[EtherDream] sendDataBatch: buffer=${this.bufferFullness}, queue=${this.frameQueue.length}, state=${this.playbackState}`);
        
        if (this.bufferFullness >= TARGET_BUFFER_DATA) {
            console.log(`[EtherDream] Buffer full (${this.bufferFullness} >= ${TARGET_BUFFER_DATA})`);
            return; // Buffer is full enough
        }
        
        // Only send if we're in a state that can accept data
        if (this.playbackState !== PLAYBACK_PLAYING && this.playbackState !== PLAYBACK_PREPARED) {
            console.log(`[EtherDream] Cannot send data, state is ${this.playbackState}`);
            return;
        }
        
        let points;
        let isTyped = false;
        let pointCount = 0;
        
        if (this.frameQueue.length > 0) {
            const frame = this.frameQueue.shift();
            points = frame.points;
            isTyped = frame.isTypedArray;
            pointCount = isTyped ? (points.length / 8) : points.length;
            this.lastDataReceived = Date.now();
            
            console.log(`[EtherDream] Got frame with ${pointCount} points, first point:`, 
                isTyped ? 
                    {x: points[0], y: points[1], r: points[3], g: points[4], b: points[5]} :
                    points[0]);
        } else {
            // No data - send minimal blanking but stay in data mode
            pointCount = 10;
            points = Array(pointCount).fill({ 
                x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true 
            });
            isTyped = false;
            console.log(`[EtherDream] No frames in queue, sending ${pointCount} blanking points`);
        }
        
        // Send the points
        const success = await this.sendPoints(points, isTyped, pointCount);
        if (success) {
            this.lastSendTime = Date.now();
        } else {
            console.log(`[EtherDream] Failed to send points`);
        }
    }
    
        async sendPoints(points, isTyped, pointCount) {
        if (pointCount === 0) return false;
        
        // Only send if we're in a state that can accept data
        if (this.playbackState !== PLAYBACK_PLAYING && this.playbackState !== PLAYBACK_PREPARED) {
            console.log(`[EtherDream] Cannot send points, state is ${this.playbackState}`);
            return false;
        }
        
        // According to EtherDream protocol, we need to send 'q' (rate) command followed by 'd' (data) command
        // Packet structure: 'q' (1 byte) + rate (4 bytes) + 'd' (1 byte) + point count (2 bytes) + points (pointCount * 18 bytes)
        const packetSize = 1 + 4 + 1 + 2 + (pointCount * 18);
        const packet = Buffer.alloc(packetSize);
        
        let offset = 0;
        
        // 'q' command with rate (0x71)
        packet[offset++] = 0x71;
        packet.writeUInt32LE(this.currentRate, offset);
        offset += 4;
        
        // 'd' command with point count (0x64)
        packet[offset++] = 0x64;
        packet.writeUInt16LE(pointCount, offset);
        offset += 2;
        
        // Add points
        for (let i = 0; i < pointCount; i++) {
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
                
                // Handle missing blanking field
                blanking = point.blanking || false;
                
                // Convert colors from 0-255 to 0-1 if needed
                if (point.r !== undefined) {
                    // Check if color values are in 0-255 range
                    if (point.r > 1.0 || point.g > 1.0 || point.b > 1.0) {
                        r = point.r / 255.0;
                        g = point.g / 255.0;
                        b = point.b / 255.0;
                    } else {
                        // Already in 0-1 range
                        r = point.r;
                        g = point.g;
                        b = point.b;
                    }
                } else {
                    // Default to white if colors not specified
                    r = 1.0;
                    g = 1.0;
                    b = 1.0;
                }
            }
            
            // Control word (0 = normal point)
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
            
            // RGB colors - convert from 0-1 to 0-65535
            const rInt = blanking ? 0 : Math.round(r * 65535);
            const gInt = blanking ? 0 : Math.round(g * 65535);
            const bInt = blanking ? 0 : Math.round(b * 65535);
            
            packet.writeUInt16LE(rInt, offset);
            offset += 2;
            packet.writeUInt16LE(gInt, offset);
            offset += 2;
            packet.writeUInt16LE(bInt, offset);
            offset += 2;
            
            // Intensity - 65535 = full intensity
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
            console.warn(`[EtherDream] Missing responses for ${pointCount} points: q=${!!qResp}, d=${!!dResp}`);
            return false;
        }
        
        if (qResp.response !== RESP_ACK) {
            console.warn(`[EtherDream] 'q' command NAK: 0x${qResp.response.toString(16)}`);
            return false;
        }
        
        if (dResp.response !== RESP_ACK) {
            console.warn(`[EtherDream] 'd' command NAK: 0x${dResp.response.toString(16)}`);
            return false;
        }
        
        // Update status from 'd' response
        this.updateStatusFromResponse(dResp);
        
        // Log successful send
        console.log(`[EtherDream] Successfully sent ${pointCount} points, buffer: ${this.bufferFullness}`);
        
        return true;
    }

    enqueueFrame(frame) {
        // Don't process frames if not connected
        if (!this.connected) return;
        
        this.laserActive = true;
        this.frameQueue.push(frame);
        
        // Switch to data mode if we're in blanking mode and initialized
        if (this.blankingMode && this.initialized) {
            this.switchToDataMode();
        }
        
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
        if (conn.connected && conn.initialized) {
            await conn.sendCommand(0x73); // Stop command
        }
    }
}

function closeAll() {
    for (const conn of connections.values()) conn.destroy();
    connections.clear();
}

module.exports = { discoverDacs, sendFrame, connectDac, closeAll, stop, setStatusCallback };