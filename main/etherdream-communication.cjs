const net = require('net');
const dgram = require('dgram');
const { Buffer } = require('buffer');

const ETHERDREAM_UDP_PORT = 7654;
const ETHERDREAM_TCP_PORT = 7765;
const STANDARD_RESPONSE_SIZE = 22;

const RESP_ACK = 0x61; // 'a'
const RESP_NAK_FULL = 0x46; // 'F'
const RESP_NAK_INVL = 0x49; // 'I'
const RESP_NAK_ESTOP = 0x21; // '!'

const PLAYBACK_IDLE = 0;
const PLAYBACK_PREPARED = 1;
const PLAYBACK_PLAYING = 2;

const LIGHT_ENGINE_READY = 0;
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
                
                // 1. Initial status response from DAC
                await this.waitForResponse(0, 2000);

                // 2. Sync with a ping
                await this.sendCommand(0x3F);

                // 3. Proactively clear E-Stop immediately
                console.log(`[EtherDream] Proactively clearing E-Stop for ${this.ip}...`);
                await this.sendCommand(0x63); // 'c'

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

            const handlerIndex = this.responseHandlers.findIndex(h => h.command === resp.command || h.command === 0);
            if (handlerIndex !== -1) {
                const handler = this.responseHandlers[handlerIndex];
                this.responseHandlers.splice(handlerIndex, 1);
                handler.resolve(resp);
            } else {
                this.handleStatus(resp);
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

    waitForResponse(commandByte, timeoutMs = 1500) {
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

    handleStatus(resp) {
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

    async sendCommand(cmdByte, extraData = null) {
        if (!this.connected) return null;
        const buf = extraData ? Buffer.concat([Buffer.from([cmdByte]), extraData]) : Buffer.from([cmdByte]);
        this.client.write(buf);
        const resp = await this.waitForResponse(cmdByte);
        if (resp) this.handleStatus(resp);
        return resp;
    }

    async startStreaming() {
        if (this.isStreaming) return;
        this.isStreaming = true;
        this.runStreamLoop();
    }

    async runStreamLoop() {
        console.log(`[EtherDream] Persistent loop active for ${this.ip}`);
        
        while (this.isStreaming && this.connected) {
            try {
                if (!this.laserActive) {
                    if (this.playbackState !== PLAYBACK_IDLE) {
                        await this.sendCommand(0x73); // Stop ('s')
                    }
                    await this.sendCommand(0x3F); // Ping ('?')
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }

                // 1. Recover from E-Stop (Command 'c' = 0x63)
                if (this.lightEngineState === LIGHT_ENGINE_ESTOP) {
                    console.log(`[EtherDream] E-Stop state detected, clearing...`);
                    await this.sendCommand(0x63); 
                    continue;
                }

                // 2. Prepare (Command 'p' = 0x70)
                if (this.playbackState === PLAYBACK_IDLE) {
                    console.log(`[EtherDream] Initializing DAC (Prepare)...`);
                    const pResp = await this.sendCommand(0x70);
                    if (pResp && pResp.response === RESP_NAK_INVL) {
                        // If Invalid, trace shows we should immediately try Clear E-Stop
                        console.log(`[EtherDream] Prepare rejected, attempting Clear E-Stop...`);
                        await this.sendCommand(0x63);
                    }
                    continue;
                }

                // 3. Persistent point streaming
                const TARGET_BUFFER = 1700;
                let sentData = false;
                
                while (this.connected && this.playbackState !== PLAYBACK_IDLE && this.bufferFullness < TARGET_BUFFER) {
                    let framePoints;
                    let isTyped = false;

                    if (this.frameQueue.length > 0) {
                        const frame = this.frameQueue.shift();
                        framePoints = frame.points;
                        isTyped = frame.isTypedArray;
                    } else {
                        // Continuous blanking points
                        framePoints = Array(80).fill({ x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true });
                        isTyped = false;
                    }

                    const success = await this.sendRateAndPoints(framePoints, isTyped);
                    if (!success) break;
                    sentData = true;
                    
                    // 4. Begin (Command 'b' = 0x62)
                    if (this.playbackState === PLAYBACK_PREPARED && this.bufferFullness > 400) {
                        console.log(`[EtherDream] Starting playback (Begin)...`);
                        const beginData = Buffer.alloc(6);
                        beginData.writeUInt16LE(0, 0); // LWM
                        beginData.writeUInt32LE(this.fixedRate, 2);
                        await this.sendCommand(0x62, beginData);
                    }
                }

                await new Promise(r => setTimeout(r, sentData ? 1 : 10));

                if (!sentData && this.connected) {
                    await this.sendCommand(0x3F); // Keepalive
                }

            } catch (err) {
                console.error(`[EtherDream] Loop error:`, err);
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }

    async sendRateAndPoints(points, isTyped) {
        const numPointsTotal = Math.floor(isTyped ? (points.length / 8) : points.length);
        if (numPointsTotal === 0) return true;

        let processed = 0;
        while (processed < numPointsTotal && this.connected) {
            const batchSize = Math.min(numPointsTotal - processed, 80); 
            const payload = Buffer.alloc(5 + 3 + (batchSize * 18));
            
            let offset = 0;
            payload[offset++] = 0x71; // 'q' (Rate)
            payload.writeUInt32LE(this.fixedRate, offset);
            offset += 4;
            
            payload[offset++] = 0x64; // 'd' (Data)
            payload.writeUInt16LE(batchSize, offset);
            offset += 2;
            
            for (let i = 0; i < batchSize; i++) {
                const pIdx = processed + i;
                let x, y, r, g, b, blanking;
                if (isTyped) {
                    const off = pIdx * 8;
                    x = points[off]; y = points[off+1];
                    r = points[off+3]; g = points[off+4]; b = points[off+5];
                    blanking = points[off+6] > 0.5;
                } else {
                    const p = points[pIdx];
                    x = p.x; y = p.y; r = p.r; g = p.g; b = p.b; blanking = p.blanking;
                }

                payload.writeUInt16LE(0, offset); // control
                payload.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), offset + 2);
                payload.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32767))), offset + 4);
                payload.writeUInt16LE(blanking ? 0 : Math.round(r * 257), offset + 6);
                payload.writeUInt16LE(blanking ? 0 : Math.round(g * 257), offset + 8);
                payload.writeUInt16LE(blanking ? 0 : Math.round(b * 257), offset + 10);
                payload.writeUInt16LE(blanking ? 0 : 65535, offset + 12); // intensity
                payload.writeUInt16LE(0, offset + 14); // u1
                payload.writeUInt16LE(0, offset + 16); // u2
                offset += 18;
            }
            
            this.client.write(payload);
            const r1 = await this.waitForResponse(0x71);
            const r2 = await this.waitForResponse(0x64);
            if (r2) this.handleStatus(r2);
            if (!r1 || !r2 || r1.response !== RESP_ACK || r2.response !== RESP_ACK) return false;
            processed += batchSize;
        }
        return true;
    }

    enqueueFrame(frame) {
        this.laserActive = true; 
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
    }
    if (!conn.connected && !conn.connecting) {
        conn.connect();
    }
    conn.enqueueFrame(frame);
}

function connectDac(ip) {
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
        if (conn.connected) {
            await conn.sendCommand(0x73); 
        }
    }
}

function closeAll() {
    for (const conn of connections.values()) conn.destroy();
    connections.clear();
}

module.exports = { discoverDacs, sendFrame, connectDac, closeAll, stop, setStatusCallback };