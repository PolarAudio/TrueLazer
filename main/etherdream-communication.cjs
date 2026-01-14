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

    }

    async connect() {

    }

    destroy() {

    }

    processInput() {

    }

    parseResponse(data) {

    }

    waitForResponse(commandByte, timeoutMs = 1500) {

    }

    handleStatus(resp) {

    }

    async sendCommand(cmdByte, extraData = null) {

    }

    async startStreaming() {

    }

    async runStreamLoop() {

    }

    async sendRateAndPoints(points, isTyped) {

    }

    enqueueFrame(frame) {

    }
}

const connections = new Map();

function discoverDacs(timeout = 2000) {

}

function sendFrame(ip, channel, frame, fps) {

}

function connectDac(ip) {

}

async function stop(ip) {

}

function closeAll() {

}

module.exports = { discoverDacs, sendFrame, connectDac, closeAll, stop, setStatusCallback };