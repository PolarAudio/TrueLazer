const idn = require('./idn-communication.cjs');
const etherdream = require('./etherdream-communication.cjs');

let globalStatusCallback = null;

function setDacStatusCallback(cb) {
    globalStatusCallback = cb;
    idn.setStatusCallback && idn.setStatusCallback(cb);
    etherdream.setStatusCallback && etherdream.setStatusCallback(cb);
}

async function discoverDacs(timeout = 2000, networkInterfaceIp) {
    const [idnDacs, edDacs] = await Promise.all([
        idn.discoverDacs(timeout, networkInterfaceIp),
        etherdream.discoverDacs(timeout)
    ]);
    
    // Type property is now set within the individual modules or ensured here
    idnDacs.forEach(d => d.type = 'idn');
    edDacs.forEach(d => d.type = 'EtherDream');
    
    return [...idnDacs, ...edDacs];
}

function getDacServices(ip, localIp, timeout = 1000, type) {
    if (type === 'EtherDream') {
        // Etherdream typically has one "service" (the DAC itself)
        return Promise.resolve([{ serviceID: 0, name: 'Main' }]);
    }
    return idn.getDacServices(ip, localIp, timeout);
}

function sendFrame(ip, channel, frame, fps, type) {
    if (!frame || !frame.points) {
        console.error(`[DacComm] Invalid frame for ${ip}:`, frame);
        return;
    }

    if (type === 'EtherDream') {
        return etherdream.sendFrame(ip, channel, frame, fps);
    }
    return idn.sendFrame(ip, channel, frame, fps);
}

function stopSending(ip, type) {
    if (type === 'EtherDream') {
        return etherdream.stop(ip);
    }
    return idn.sendCloseChannel(ip);
}

function connectDac(ip, type) {
    if (type === 'EtherDream') {
        return etherdream.connectDac(ip);
    }
}

function startOutput(ip, type) {
    if (type === 'EtherDream') {
        return etherdream.startOutput(ip);
    }
}

function closeAll() {
    idn.closeAll();
    etherdream.closeAll();
}

module.exports = {
    discoverDacs,
    getDacServices,
    sendFrame,
    connectDac,
    startOutput,
    stopSending,
    closeAll,
    getNetworkInterfaces: idn.getNetworkInterfaces,
    setDacStatusCallback
};