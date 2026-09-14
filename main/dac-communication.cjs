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

    // Resolve the effective PPS/FPS target for this output. Per-channel
    // settings carried in `options` (pps, targetPps, targetFps, ppsPreset,
    // targetMode) win; otherwise fall back to the provided fps / preset default.
    const opt = options || {};
    const targetPps = (opt.targetPps && opt.targetPps > 0)
        ? opt.targetPps
        : (opt.pps && opt.pps > 0 ? opt.pps : 30000);
    const targetFps = (opt.targetFps && opt.targetFps > 0)
        ? opt.targetFps
        : (fps && fps > 0 ? fps : 30);
    const targetMode = opt.targetMode || 'varFpsFixedPps';

    const sendOptions = {
        ...opt,
        pps: targetPps,
        targetPps,
        targetFps,
        targetMode,
    };

    // Apply the user's X/Y hardware-correction invert ONLY at the physical DAC
    // boundary. The frontend preview uses the un-flipped points, so the output
    // settings canvas remains a fixed 1:1 logical reference; the invert only
    // mirrors the laser output (e.g. to compensate an inverted laser mount).
    //
    // IMPORTANT: never mutate the passed `points` in place. The same Float32Array
    // is shared with the renderer preview and is reused across frames, so an
    // in-place flip corrupts the source and causes flickering between flipped /
    // un-flipped output. Always clone, flip the clone, and let the clone be
    // consumed downstream.
    const flipX = !!sendOptions.flipX;
    const flipY = !!sendOptions.flipY;
    if (flipX || flipY) {
        const isTyped = points instanceof Float32Array;
        if (isTyped) {
            const n = Math.floor(points.length / 8);
            const flipped = new Float32Array(points.length);
            for (let i = 0; i < points.length; i++) flipped[i] = points[i];
            for (let i = 0; i < n; i++) {
                if (flipX) flipped[i * 8] = -flipped[i * 8];
                if (flipY) flipped[i * 8 + 1] = -flipped[i * 8 + 1];
            }
            points = flipped;
        } else {
            points = points.map((p) => {
                if (!p) return p;
                const cp = { ...p };
                if (flipX) cp.x = -cp.x;
                if (flipY) cp.y = -cp.y;
                return cp;
            });
        }
    }

    if (type === 'EtherDream') {
        return etherdream.sendFrame(ip, channel, points, targetFps, sendOptions);
    }
    if (type === 'Showbridge') {
        // PPS is now per-channel configurable instead of fixed 30 Kpps.
        return showbridge.sendFrame(ip, channel, points, targetFps, null, sendOptions);
    }
    return idn.sendFrame(ip, channel, points, targetFps);
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