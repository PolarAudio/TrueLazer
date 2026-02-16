const { app } = require('electron');
const path = require('path');
const fs = require('fs');

async function runBenchmark() {
    console.log('--- NDI Performance Benchmark ---');
    
    const nativeModulePath = path.join(__dirname, 'native', 'build', 'Release');
    if (process.platform === 'win32') {
        process.env.PATH = nativeModulePath + path.delimiter + process.env.PATH;
    }

    let ndi;
    try {
        const ndiModule = require(path.join(nativeModulePath, 'ndi_wrapper.node'));
        ndi = new ndiModule.NdiWrapper();
        if (!ndi.initialize()) {
            throw new Error('Failed to initialize NDI');
        }
    } catch (e) {
        console.error('Failed to load NDI wrapper:', e);
        app.quit();
        return;
    }

    console.log('Searching for NDI sources...');
    const sources = ndi.findSources();
    console.log('Sources found:', sources);

    if (sources.length === 0) {
        console.log('No NDI sources found. Benchmark cannot continue with real data.');
        console.log('Please start an NDI source (e.g., NDI Test Patterns) and run again.');
        app.quit();
        return;
    }

    const sourceName = sources[0].name;
    console.log(`Connecting to: ${sourceName}`);
    if (!ndi.createReceiver(sourceName)) {
        console.error('Failed to create receiver');
        app.quit();
        return;
    }

    const iterations = 100;
    const times = [];
    const targetWidth = 1280;
    const targetHeight = 720;

    console.log(`Capturing ${iterations} frames with downsampling to ${targetWidth}x${targetHeight}...`);

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const frame = ndi.captureVideo(targetWidth, targetHeight);
        const end = performance.now();
        if (frame) {
            times.push(end - start);
        }
        // Small delay to allow NDI to provide next frame
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const max = Math.max(...times);
        const min = Math.min(...times);
        console.log(`Average capture time: ${avg.toFixed(2)}ms`);
        console.log(`Min capture time: ${min.toFixed(2)}ms`);
        console.log(`Max capture time: ${max.toFixed(2)}ms`);
        console.log(`Frames captured: ${times.length}/${iterations}`);
    } else {
        console.log('No frames captured.');
    }

    ndi.destroyReceiver();
    app.quit();
}

app.whenReady().then(runBenchmark);
