const idn = require('./idn-communication.cjs');
const etherdream = require('./etherdream-communication.cjs');
const showbridge = require('./showbridge-communication.cjs');

let globalStatusCallback = null;

function setDacStatusCallback(cb) {
    globalStatusCallback = cb;
    idn.setStatusCallback && idn.setStatusCallback(cb);
    etherdream.setStatusCallback && etherdream.setStatusCallback(cb);
    showbridge.setStatusCallback && showbridge.setStatusCallback(cb);
}

async function discoverDacs(timeout = 2000, networkInterfaceIp) {
    const [idnDacs, edDacs, sbDacs] = await Promise.all([
        idn.discoverDacs(timeout, networkInterfaceIp),
        etherdream.discoverDacs(timeout),
        showbridge.discoverDacs(timeout)
    ]);
    
    // Type property is now set within the individual modules or ensured here
    idnDacs.forEach(d => d.type = 'idn');
    edDacs.forEach(d => d.type = 'EtherDream');
    sbDacs.forEach(d => d.type = 'Showbridge');
    
    return [...idnDacs, ...edDacs, ...sbDacs];
}

function getDacServices(ip, localIp, timeout = 1000, type) {
    if (type === 'EtherDream') {
        // Etherdream typically has one "service" (the DAC itself)
        return Promise.resolve([{ serviceID: 0, name: 'Main' }]);
    }
    if (type === 'Showbridge') {
        return showbridge.getDacServices(ip);
    }
    return idn.getDacServices(ip, localIp, timeout);
}

function sendFrame(ip, channel, points, fps, type, options) {
    if (!points) {
        console.error(`[DacComm] Invalid points for ${ip}`);
        return;
    }

    if (type === 'EtherDream') {
        return etherdream.sendFrame(ip, channel, points, fps, options);
    }
    if (type === 'Showbridge') {
        return showbridge.sendFrame(ip, channel, points, fps);
    }
    return idn.sendFrame(ip, channel, points, fps);
}

function stopSending(ip, type) {
    if (type === 'EtherDream') {
        return etherdream.stop(ip);
    }
    if (type === 'Showbridge') {
        return showbridge.stopSending(ip);
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
    showbridge.closeAll();
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