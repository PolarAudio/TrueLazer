const dgram = require('dgram');
const { Buffer } = require('buffer');
const os = require('os');

const IDN_HELLO_UDP_PORT = 7255;
const BROADCAST_ADDRESS = '255.255.255.255';

const IDNCMD_SCAN_REQUEST = 0x10;
const IDNCMD_SCAN_RESPONSE = 0x11;
const IDNCMD_SERVICEMAP_REQUEST = 0x12;
const IDNCMD_SERVICEMAP_RESPONSE = 0x13;
const IDNCMD_RT_CNLMSG = 0x40;
const IDNCMD_RT_CNLMSG_CLOSE = 0x44;

const IDNVAL_CNKTYPE_LPGRF_FRAME = 0x02;
const IDNVAL_SMOD_LPGRF_DISCRETE = 0x02;

let dataSocket = null;
let generalSequence = 0;
// Use a per-session client group so a fresh app session never reuses a
// still-open receiver connection and its stale nextSequence.
const sessionClientGroup = Math.floor(Math.random() * 16);
const clientGroupFlags = sessionClientGroup & 0x0F;
// Realtime sequence counters, one per destination link.
//
// The sequence lives in the IDN-RT *packet* header (command/flags/sequence) and
// is validated by the receiver per connection/link: every datagram that arrives
// from this sender must advance the same counter by exactly 1. It is NOT a
// per-channel value. Keying the counter by channel made N interleaved channels
// all restart at the same number, which a strict receiver reports as a constant
// stream of symmetric "out of sequence (N lost)" / "(N early)" errors.
const rtSequences = new Map();
const nextRtSequence = (ip) => {
  const next = ((rtSequences.get(ip) || 0) + 1) & 0xFFFF;
  rtSequences.set(ip, next);
  return next;
};
// Channel configuration headers may be sent on every message, but the spec
// recommends repeating them roughly every 200-250 ms for loss/recovery. Sending
// config+routing on every frame can make a player tear down and re-open the
// graphic output for each frame (visible as an Open/Closed cycle in its log).
const IDN_CONFIG_INTERVAL_US = 250000;
const configSentAt = new Map();
const nowMicroseconds = () => Number((process.hrtime.bigint() / 1000n) & 0xFFFFFFFFn);
const shouldSendConfig = (key, nowUS) => {
  const last = configSentAt.get(key);
  if (last === undefined) return true;
  // Unsigned subtraction keeps this correct across the 32-bit wrap.
  return ((nowUS - last) >>> 0) >= IDN_CONFIG_INTERVAL_US;
};
let isScanning = false;

function getSocket() {
  if (dataSocket) return dataSocket;
  dataSocket = dgram.createSocket('udp4');
  try { dataSocket.setSendBufferSize(1024 * 1024); } catch (e) { }
  dataSocket.on('error', (err) => {
    console.error('IDN data socket error:', err);
    closeAll();
  });
  return dataSocket;
}

function closeAll() {
  if (dataSocket) {
    try { dataSocket.close(); } catch (e) { }
    dataSocket = null;
  }
  // Re-open every channel's configuration after the link is recreated.
  configSentAt.clear();
  // The socket is gone: the next send goes out on a fresh socket/link, so
  // restart the per-link sequence counter. Keeping a stale counter would make
  // the first packet on the new link look like a sequence jump to a strict
  // receiver.
  rtSequences.clear();
}

// Loopback is offered because helper software running on this same machine may
// only be reachable on 127.0.0.1 — no external adapter will reach it.
//
// It is sorted LAST deliberately. Both consumers (DacPanel and TimelineContext)
// default to `interfaces[0]` and then bind the discovery socket to that address
// and broadcast on it, so a loopback entry in first position would make DAC
// discovery bind to loopback, where broadcast does not exist, and silently find
// no hardware. Loopback has to be an explicit choice, never a default.
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1']);

function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const external = [];
  const loopback = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (!address || address.family !== 'IPv4' || !address.address) continue;
      const isLoopback = address.internal || LOOPBACK_ADDRESSES.has(address.address);
      const entry = { name: k, address: address.address, loopback: isLoopback };
      (isLoopback ? loopback : external).push(entry);
    }
  }
  return external.concat(loopback);
}

function discoverDacs(timeout = 2000, networkInterfaceIp) {
  if (isScanning) return Promise.resolve([]);
  isScanning = true;

  return new Promise((resolve, reject) => {
    const discoveredDacs = new Map();
    const discoverySocket = dgram.createSocket('udp4');
    let scanInterval = null;
    let resolveTimeout = null;
    // Broadcast discovery is meaningless on loopback; see the bind callback.
    const scanInterfaceIsLoopback = !!(networkInterfaceIp && LOOPBACK_ADDRESSES.has(networkInterfaceIp));

    const cleanup = () => {
      if (scanInterval) clearInterval(scanInterval);
      if (resolveTimeout) clearTimeout(resolveTimeout);
      try { discoverySocket.close(); } catch (e) { }
      isScanning = false;
    };

    discoverySocket.on('error', (err) => {
      console.error('IDN discovery socket error:', err);
      cleanup();
      resolve(Array.from(discoveredDacs.values()));
    });

    discoverySocket.on('message', (msg, rinfo) => {
      if (msg.readUInt8(0) === IDNCMD_SCAN_RESPONSE) {
        const response = parseScanResponse(msg, rinfo);
        if (response && !discoveredDacs.has(response.unitID)) {
          discoveredDacs.set(response.unitID, response);

          // If we found a device, we can resolve soon (give a bit of time for others)
          if (!resolveTimeout) {
            console.log(`[IDN] Device found, settling scan...`);
            resolveTimeout = setTimeout(() => {
              cleanup();
              resolve(Array.from(discoveredDacs.values()));
            }, 500); // 500ms settle time after first discovery
          }
        }
      }
    });

    const sendScanRequest = () => {
      if (scanInterfaceIsLoopback) return;
      const packet = Buffer.alloc(4);
      packet.writeUInt8(IDNCMD_SCAN_REQUEST, 0);
      packet.writeUInt8(clientGroupFlags, 1);
      packet.writeUInt16BE(generalSequence++, 2);
      // No error callback on purpose: discoverySocket has an 'error' handler
      // above, and a broadcast this socket cannot make is not exceptional.
      discoverySocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, BROADCAST_ADDRESS);
    };

    const bindOptions = { port: 0 };
    if (networkInterfaceIp) bindOptions.address = networkInterfaceIp;

    discoverySocket.bind(bindOptions, () => {
      // There is no broadcast on loopback, so scanning through it can only ever
      // time out. Skip it rather than emit a burst of send errors, and let the
      // caller get an empty result quickly. A loopback service is addressed
      // directly, not discovered.
      if (scanInterfaceIsLoopback) {
        cleanup();
        resolve([]);
        return;
      }
      discoverySocket.setBroadcast(true);
      // Initial burst for fast discovery
      for (let i = 0; i < 10; i++) {
        setTimeout(sendScanRequest, i * 20);
      }
      scanInterval = setInterval(sendScanRequest, 500);
    });

    // Absolute fallback timeout
    setTimeout(() => {
      if (isScanning) {
        cleanup();
        resolve(Array.from(discoveredDacs.values()));
      }
    }, timeout);
  });
}

function parseScanResponse(msg, rinfo) {
  try {
    if (msg.readUInt8(0) !== IDNCMD_SCAN_RESPONSE || msg.length < 28) return null;
    let offset = 4;
    const protocolVersion = msg.readUInt8(++offset);
    const status = msg.readUInt8(++offset);
    offset += 2;
    const unitIDLen = msg.readUInt8(offset++);
    const unitID = msg.slice(offset, offset + unitIDLen).toString('utf-8').replace(/\0/g, '').trim();
    offset += 15;
    const hostName = msg.slice(offset, offset + 20).toString('utf-8').replace(/\0/g, '').trim();
    return {
      ip: rinfo.address,
      port: rinfo.port,
      unitID,
      hostName,
      protocolVersion: `${protocolVersion >> 4}.${protocolVersion & 0x0F}`,
      status,
      type: 'idn'
    };
  } catch (error) {
    console.error('Error parsing IDN scan response:', error);
    return null;
  }
}

// Gracefully close the IDN link for this destination.
//
// This used to send a zero-point frame on channel 0, which does NOT close the
// link: if its (default-service) routing was due, the receiver instead tried to
// open a second inlet on a service that was already in use ("Failed to request
// inlet, serviceMode=2"), and the real channel was only torn down by the ~10 s
// link inactivity timeout. A bare 0x44 control packet closes the connection and
// flushes/closes all of its channels right away.
function sendCloseChannel(ip) {
  if (!dataSocket) return; // nothing was ever sent on this link
  const packet = Buffer.alloc(4);
  packet.writeUInt8(IDNCMD_RT_CNLMSG_CLOSE, 0);
  packet.writeUInt8(clientGroupFlags, 1);
  packet.writeUInt16BE(nextRtSequence(ip), 2);
  dataSocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip, (err) => { if (err) console.error('IDN send error:', err); });
  // The next session on this link is a fresh connection: drop the cached
  // config so its first frame carries routing/config again.
  const prefix = `${ip}:`;
  for (const key of configSentAt.keys()) {
    if (key.startsWith(prefix)) configSentAt.delete(key);
  }
}

// IDN's equivalent of the Showbridge continuous idle stream.
//
// Without this the always-fed send loop had nothing at all to send while a target
// was idle: dac-communication's sendIdleFrame only knew about Showbridge and
// returned null for every other type. So the IDN/StageLinq stream simply went
// silent, the player kept playing the last frame it was given, and the beam stayed
// on until the player's own idle timeout — a few seconds of light after the app had
// already stopped asking for output.
//
// A discrete frame sample array must either be empty or contain at least two
// samples (start + end). A single-sample frame is invalid and strict players
// reject it — the previous real frame then keeps repeating, leaving the beam on.
// Two blanked points are a valid frame that reads as fully off, and sending one
// every tick keeps the stream alive exactly like the Showbridge path does.
function sendIdleFrame(ip, channel, options) {
  const blank = new Float32Array(16); // two points
  blank[6] = 1;  // point 0: blanking
  blank[14] = 1; // point 1: blanking
  const fps = (options && options.fps > 0) ? options.fps : 30;
  return sendFrame(ip, channel, blank, fps);
}

function sendFrame(ip, channel, points, fps) {
  if (!points) return;

  // Ensure we have a Float32Array
  let activePoints = points;
  if (!(points instanceof Float32Array)) {
    if (Buffer.isBuffer(points) || points instanceof Uint8Array) {
      activePoints = new Float32Array(points.buffer, points.byteOffset, points.byteLength / Float32Array.BYTES_PER_ELEMENT);
    } else if (Array.isArray(points)) {
      // Fallback for legacy object-array format if still used anywhere
      // But we prefer TypedArrays for performance
      const numPts = points.length;
      activePoints = new Float32Array(numPts * 8);
      for (let i = 0; i < numPts; i++) {
        const p = points[i];
        const off = i * 8;
        activePoints[off] = p.x; activePoints[off + 1] = p.y; activePoints[off + 2] = p.z || 0;
        activePoints[off + 3] = p.r; activePoints[off + 4] = p.g; activePoints[off + 5] = p.b;
        activePoints[off + 6] = p.blanking ? 1 : 0; activePoints[off + 7] = p.lastPoint ? 1 : 0;
      }
    }
  }

  const numPoints = Math.floor(activePoints.length / 8);
  const pointSize = 8;
  const frameDataSize = numPoints * pointSize;
  const dictionary = Buffer.from('4200401042104010527e521451cc5c10', 'hex');
  const dictWordCount = 4;
  const channelConfigSize = 4 + dictionary.length;
  const frameChunkHeaderSize = 4;
  const headerSize = 4;
  const channelMessageHeaderSize = 8;
  const timestampUS = nowMicroseconds();
  const configKey = `${ip}:${channel}`;
  const includeConfig = shouldSendConfig(configKey, timestampUS);
  if (includeConfig) configSentAt.set(configKey, timestampUS);
  const configSize = includeConfig ? channelConfigSize : 0;

  const totalSize = headerSize + channelMessageHeaderSize + configSize + frameChunkHeaderSize + frameDataSize;
  const packet = Buffer.alloc(totalSize);
  let offset = 0;
  packet.writeUInt8(IDNCMD_RT_CNLMSG, offset++);
  packet.writeUInt8(clientGroupFlags, offset++);
  packet.writeUInt16BE(nextRtSequence(ip), offset);
  offset += 2;
  // Total size is the IDN message length only: it excludes the 4-byte packet
  // header (command/flags/sequence) and is big-endian, so it must equal
  // packet.length - headerSize. Strict players reject a mismatch.
  packet.writeUInt16BE(channelMessageHeaderSize + configSize + frameChunkHeaderSize + frameDataSize, offset);
  offset += 2;
  // The channel ID (contentID bits 8-13) identifies the logical IDN channel,
  // while the config header's Service ID selects the device's service. These
  // are different things: hard-coding the channel ID to 0 made every service
  // share one IDN channel, so a multi-output device re-routed it on every
  // packet and continuously closed/re-opened its graphic output.
  const contentID = 0x8000
    | (includeConfig ? 0x4000 : 0)
    | ((channel & 0x3F) << 8)
    | (IDNVAL_CNKTYPE_LPGRF_FRAME & 0xFF);
  packet.writeUInt16BE(contentID, offset);
  offset += 2;
  // Timestamp is microseconds and big-endian per the IDN stream spec. It was
  // nanoseconds little-endian, which a strict player sees as random jumps and
  // may answer by flushing its frame buffer each packet.
  packet.writeUInt32BE(timestampUS, offset);
  offset += 4;
  if (includeConfig) {
    packet.writeUInt8(dictWordCount, offset++);
    packet.writeUInt8(0x01, offset++); // routing
    packet.writeUInt8(channel, offset++); // Service ID
    packet.writeUInt8(IDNVAL_SMOD_LPGRF_DISCRETE, offset++);
    dictionary.copy(packet, offset);
    offset += dictionary.length;
  }
  const duration = Math.round(1000000 / (fps || 30));
  packet.writeUInt32BE(duration & 0x00FFFFFF, offset);
  offset += 4;
  for (let i = 0; i < numPoints; i++) {
    const pOffset = i * 8;
    const x = activePoints[pOffset];
    const y = activePoints[pOffset + 1];
    let r = activePoints[pOffset + 3];
    let g = activePoints[pOffset + 4];
    let b = activePoints[pOffset + 5];
    const blanking = activePoints[pOffset + 6] > 0.5;

    if (blanking) { r = 0; g = 0; b = 0; }
    // Color bytes must land in 0..255. Automation boosts (e.g. a brightness
    // lane) can push channels past the top of the range; round + clamp here
    // so writeUInt8 never throws ERR_OUT_OF_RANGE.
    const c255 = (c) => Math.max(0, Math.min(255, Math.round(c)));
    r = c255(r); g = c255(g); b = c255(b);
    packet.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), offset);
    offset += 2;
    packet.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(y * 32767))), offset);
    offset += 2;
    packet.writeUInt8(r, offset++);
    packet.writeUInt8(g, offset++);
    packet.writeUInt8(b, offset++);
    packet.writeUInt8(blanking ? 0 : 255, offset++);
  }
  const socket = getSocket();
  socket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip, (err) => { if (err) console.error('IDN send error:', err); });
}

function getDacServices(ip, localIp, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const services = [];
    const serviceSocket = dgram.createSocket('udp4');
    const cleanup = () => { try { serviceSocket.close(); } catch (e) { } };
    serviceSocket.on('error', (err) => { cleanup(); resolve([]); });
    serviceSocket.on('message', (msg, rinfo) => {
      if (rinfo.address === ip && msg.readUInt8(0) === IDNCMD_SERVICEMAP_RESPONSE) {
        const parsedServices = parseServiceMapResponse(msg);
        if (parsedServices) { services.push(...parsedServices); cleanup(); resolve(services); }
      }
    });
    const bindOptions = { port: 0 };
    if (localIp) bindOptions.address = localIp;
    serviceSocket.bind(bindOptions, () => {
      const packet = Buffer.alloc(4);
      packet.writeUInt8(IDNCMD_SERVICEMAP_REQUEST, 0);
      packet.writeUInt8(clientGroupFlags, 1);
      packet.writeUInt16BE(generalSequence++, 2);
      serviceSocket.send(packet, 0, packet.length, IDN_HELLO_UDP_PORT, ip);
    });
    setTimeout(() => { cleanup(); resolve(services); }, timeout);
  });
}

function parseServiceMapResponse(msg) {
  try {
    if (msg.length < 8 || msg.readUInt8(0) !== IDNCMD_SERVICEMAP_RESPONSE) return null;
    let offset = 4;
    const entrySize = msg.readUInt8(offset + 1);
    const relayEntryCount = msg.readUInt8(offset + 2);
    const serviceEntryCount = msg.readUInt8(offset + 3);
    offset += 4;
    const services = [];
    offset += (relayEntryCount * entrySize);
    for (let i = 0; i < serviceEntryCount; i++) {
      if (offset + entrySize > msg.length) break;
      const serviceEntryOffset = offset;
      const serviceID = msg.readUInt8(serviceEntryOffset);
      const name = msg.slice(serviceEntryOffset + 4, serviceEntryOffset + 24).toString('utf8').replace(/\0/g, '').trim();
      offset += entrySize;
      services.push({ serviceID, name });
    }
    return services;
  } catch (error) {
    console.error('Error parsing IDN service map response:', error);
    return null;
  }
}

module.exports = { discoverDacs, sendFrame, sendIdleFrame, getDacServices, closeAll, getNetworkInterfaces, sendCloseChannel };
