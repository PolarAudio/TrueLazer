const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// Test with exactly 1472 bytes application data
// This should create 1500 byte IP packet (1472 + 8 UDP + 20 IP = 1500)
// Should NOT fragment if MTU is really 1500
const testData = Buffer.alloc(1472, 0xAA);

socket.send(testData, 8089, '169.254.25.101', (err) => {
    if (err) console.error(err);
    else console.log('Sent 1472 byte test packet');
    socket.close();
});