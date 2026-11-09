'use strict';

/**
 * Minimal mDNS (Bonjour) announcer for the companion LAN server.
 *
 * Advertises `TrueLazer Zones._truelazer._tcp.local.` so a phone's
 * Bonjour browser can find it without the user typing an IP.
 * No dependency: Node's dgram + a small hand-rolled DNS encoder.
 *
 * Security: the PIN is NEVER put in TXT. Discovery only, auth stays
 * in HTTP (?pin=). Announce TTL is short (120s) and re-sent on a
 * timer; stop() sends a TTL-0 goodbye.
 */

const dgram = require('dgram');
const os = require('os');

const MDNS_HOST = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE = '_truelazer._tcp.local.';
const INSTANCE = `TrueLazer Zones._truelazer._tcp.local.`;
const ANNOUNCE_MS = 30000;
const TTL = 120;

function encodeName(name) {
  const parts = [];
  for (const label of name.replace(/\.$/, '').split('.')) {
    const buf = Buffer.from(label, 'utf8');
    if (!buf.length) continue;
    parts.push(Buffer.from([buf.length]), buf);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function rr(name, type, ttl, data) {
  return Buffer.concat([encodeName(name), u16(type), u16(0x0001), u32(ttl), u16(data.length), data]);
}

function txtRecord(texts) {
  const parts = [];
  for (const t of texts) {
    const buf = Buffer.from(String(t), 'utf8').slice(0, 255);
    parts.push(Buffer.from([buf.length]), buf);
  }
  return Buffer.concat(parts);
}

function ipv4Bytes(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return Buffer.from(parts);
}

function lanIps() {
  const nets = os.networkInterfaces() || {};
  const out = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.')) out.push(net.address);
    }
  }
  return [...new Set(out)];
}

function hostname() {
  const h = (os.hostname() || 'truelazer').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'truelazer';
  return `${h}.local.`;
}

function recordsFor(port, version, ttl) {
  const ips = lanIps();
  const target = hostname();
  const prt = rr(SERVICE, 12, ttl, encodeName(INSTANCE));
  const srv = rr(
    INSTANCE, 33, ttl,
    Buffer.concat([u16(0), u16(0), u16(port), encodeName(target)])
  );
  const txt = rr(INSTANCE, 16, ttl, txtRecord([`path=/`, `version=${version || '0.2.0'}`, `txtvers=1`]));
  const out = [prt, srv, txt];
  for (const ip of ips) {
    const b = ipv4Bytes(ip);
    if (b) out.push(rr(target, 1, ttl, b));
  }
  return out;
}

function buildPacket(port, version, ttl) {
  const recs = recordsFor(port, version, ttl);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // id
  header.writeUInt16BE(0x8400, 2); // response, authoritative, no truncation
  header.writeUInt16BE(0, 4); // qd
  header.writeUInt16BE(recs.length, 6); // an
  header.writeUInt16BE(0, 8); // ns
  header.writeUInt16BE(0, 10); // ar
  return Buffer.concat([header, ...recs]);
}

function startMdns(port, opts = {}) {
  const logger = opts.logger || console;
  const version = opts.version;
  let socket = null;
  let timer = null;
  let closed = false;

  const announce = (ttl) => {
    if (closed || !socket) return;
    const pkt = buildPacket(port, version, ttl);
    for (const ip of lanIps()) {
      try { socket.setMulticastInterface(ip); } catch {}
    }
    socket.send(pkt, MDNS_PORT, MDNS_HOST);
  };

  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (e) => {
      try { logger.warn && logger.warn(`[Companion-mDNS] ${e.message}`); } catch {}
    });
    socket.bind(MDNS_PORT, '0.0.0.0', () => {
      try { socket.addMembership(MDNS_HOST); } catch {}
      for (const ip of lanIps()) {
        try { socket.addMembership(MDNS_HOST, ip); } catch {}
        try { socket.setMulticastInterface(ip); } catch {}
      }
      announce(TTL);
      timer = setInterval(() => announce(TTL), ANNOUNCE_MS);
      if (timer.unref) timer.unref();
    });
    socket.on('message', (buf) => {
      // Loose match: any query mentioning our service gets an answer.
      if (!buf || !buf.includes('_truelazer._tcp')) return;
      announce(TTL);
    });
  } catch (e) {
    try { logger.warn && logger.warn(`[Companion-mDNS] disabled: ${e.message}`); } catch {}
    return { stop() {}, service: SERVICE };
  }

  return {
    stop() {
      closed = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (socket) {
        try { announce(0); } catch {} // goodbye
        try { socket.close(); } catch {}
        socket = null;
      }
    },
    service: SERVICE,
  };
}

module.exports = {
  startMdns,
  SERVICE,
  INSTANCE,
  buildPacket,
  lanIps,
};
