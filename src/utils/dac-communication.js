const dgram = require('dgram');

const DISCOVERY_PORT = 8089;
const SERVER_PORT = 8089;
const CLIENT_PORT = 8099;
const DISCOVERY_MESSAGE = Buffer.from([0x44, 0x4d, 0x01, 0x00]);

function discoverDacs(callback) {
  const socket = dgram.createSocket('udp4');
  const dacs = [];

  socket.on('listening', () => {
    socket.setBroadcast(true);
    socket.send(DISCOVERY_MESSAGE, DISCOVERY_PORT, '255.255.255.255', (err) => {
      if (err) {
        console.error('Error sending discovery message:', err);
        socket.close();
      }
    });
  });

  socket.on('message', (msg, rinfo) => {
    if (msg[0] === 0x44 && msg[1] === 0x4d && msg[2] === 0x01 && msg[3] === 0x01) {
      const dacInfo = {
        ip: rinfo.address,
        version: msg[4],
        max_pps: msg[5] * 1000,
        max_points: 5000,
      };

      if (!dacs.some(d => d.ip === dacInfo.ip)) {
        dacs.push(dacInfo);
        callback(dacs);
      }
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
    socket.close();
  });

  socket.bind(CLIENT_PORT, () => {
    console.log('Listening for DAC responses...');
  });

  setTimeout(() => {
    socket.close();
  }, 5000); // Stop listening after 5 seconds
}

function sendFrame(ip, frame) {
    const socket = dgram.createSocket('udp4');
    const message = Buffer.alloc(4 + 2 + 1 + 1 + (frame.points.length * 8));

    let offset = 0;
    message.write('DM', offset, 2, 'ascii');
    offset += 2;
    message.writeUInt8(0x01, offset++); // version
    message.writeUInt8(0x10, offset++); // command for send frame

    message.writeUInt16LE(frame.points.length, offset);
    offset += 2;
    message.writeUInt8(0, offset++); // status
    message.writeUInt8(0, offset++); // delay

    for (const point of frame.points) {
        message.writeFloatLE(point.x, offset);
        offset += 4;
        message.writeFloatLE(point.y, offset);
        offset += 4;
        message.writeUInt8(point.blanking ? 1 : 0, offset++);
        message.writeUInt8(point.r, offset++);
        message.writeUInt8(point.g, offset++);
        message.writeUInt8(point.b, offset++);
    }

    socket.send(message, SERVER_PORT, ip, (err) => {
        if (err) {
            console.error(`Error sending frame to ${ip}:`, err);
        }
        socket.close();
    });
}

module.exports = { discoverDacs, sendFrame };