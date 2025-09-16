const canvases = new Map();

function renderSingle(state, currentTime) {
    const { ctx, data, lastUpdateTime, currentFrameIndex, pointIndex, lastX, lastY, wasPenUp } = state;
    const { ildaFrames, showBeamEffect, beamAlpha, drawSpeed } = data;
    const { width, height } = state.canvas;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    if (!ildaFrames || ildaFrames.length === 0) return;

    if (!state.lastUpdateTime) state.lastUpdateTime = currentTime;
    const deltaTime = currentTime - state.lastUpdateTime;

    const frameUpdateInterval = 100;
    if (deltaTime >= frameUpdateInterval) {
        state.currentFrameIndex = (state.currentFrameIndex + 1) % ildaFrames.length;
        state.lastUpdateTime = currentTime;
        self.postMessage({ type: 'frameChange', id: state.id, frameIndex: state.currentFrameIndex });
        state.pointIndex = 0;
        state.lastX = ((0 + 32768) / 65535) * width;
        state.lastY = height - (((0 + 32768) / 65535) * height);
        state.wasPenUp = true;
    }

    const frame = ildaFrames[state.currentFrameIndex];
    if (!frame || !frame.points) return;

    for (let i = 0; i < drawSpeed; i++) {
        if (state.pointIndex >= frame.points.length) {
            state.pointIndex = 0;
            state.lastX = ((0 + 32768) / 65535) * width;
            state.lastY = height - (((0 + 32768) / 65535) * height);
            state.wasPenUp = true;
        }

        const currentPoint = frame.points[state.pointIndex];
        const x = ((currentPoint.x + 32768) / 65535) * width;
        const y = height - (((currentPoint.y + 32768) / 65535) * height);

        if (!currentPoint.blanking) {
            const lineColor = `rgb(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b})`;
            if (state.wasPenUp) {
                ctx.fillStyle = lineColor;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            } else {
                if (showBeamEffect) {
                    const centerX = width / 2;
                    const centerY = height / 2;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(state.lastX, state.lastY);
                    ctx.lineTo(x, y);
                    ctx.closePath();
                    ctx.fillStyle = `rgba(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b}, ${beamAlpha})`;
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.moveTo(state.lastX, state.lastY);
                ctx.lineTo(x, y);
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 0.3;
                ctx.stroke();
            }
            state.wasPenUp = false;
        } else {
            state.wasPenUp = true;
        }
        state.lastX = x;
        state.lastY = y;
        state.pointIndex++;
    }
}

function renderWorld(state, currentTime) {
    const { ctx, data, frameIndexes, pointIndexes } = state;
    const { worldData, showBeamEffect, beamAlpha, drawSpeed } = data;
    const { width, height } = state.canvas;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    if (!worldData || worldData.length === 0) return;

    if (!state.lastUpdateTime) state.lastUpdateTime = currentTime;
    const deltaTime = currentTime - state.lastUpdateTime;

    const frameUpdateInterval = 100;
    if (deltaTime >= frameUpdateInterval) {
        state.frameIndexes = state.frameIndexes.map((frameIndex, clipIndex) => {
            const clip = worldData[clipIndex];
            if (clip && clip.frames && clip.frames.length > 0) {
                return (frameIndex + 1) % clip.frames.length;
            }
            return 0;
        });
        state.lastUpdateTime = currentTime;
    }

    worldData.forEach((clip, clipIndex) => {
        if (clip && clip.frames && clip.frames.length > 0) {
            const frameIndex = state.frameIndexes[clipIndex] || 0;
            const frame = clip.frames[frameIndex];
            if (frame && frame.points) {
                let lastX = ((0 + 32768) / 65535) * width;
                let lastY = height - (((0 + 32768) / 65535) * height);
                let wasPenUp = true;
                let currentPointIndex = state.pointIndexes[clipIndex] || 0;

                for (let i = 0; i < drawSpeed; i++) {
                    if (currentPointIndex >= frame.points.length) {
                        currentPointIndex = 0;
                        lastX = ((0 + 32768) / 65535) * width;
                        lastY = height - (((0 + 32768) / 65535) * height);
                        wasPenUp = true;
                    }

                    const currentPoint = frame.points[currentPointIndex];
                    const x = ((currentPoint.x + 32768) / 65535) * width;
                    const y = height - (((currentPoint.y + 32768) / 65535) * height);

                    if (!currentPoint.blanking) {
                        const lineColor = `rgb(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b})`;
                        if (wasPenUp) {
                            ctx.fillStyle = lineColor;
                            ctx.beginPath();
                            ctx.arc(x, y, 1, 0, Math.PI * 2);
                            ctx.fill();
                        } else {
                            if (showBeamEffect) {
                                const centerX = width / 2;
                                const centerY = height / 2;
                                ctx.beginPath();
                                ctx.moveTo(centerX, centerY);
                                ctx.lineTo(lastX, lastY);
                                ctx.lineTo(x, y);
                                ctx.closePath();
                                ctx.fillStyle = `rgba(${currentPoint.r}, ${currentPoint.g}, ${currentPoint.b}, ${beamAlpha})`;
                                ctx.fill();
                            }
                            ctx.beginPath();
                            ctx.moveTo(lastX, lastY);
                            ctx.lineTo(x, y);
                            ctx.strokeStyle = lineColor;
                            ctx.lineWidth = 0.5;
                            ctx.stroke();
                        }
                        wasPenUp = false;
                    } else {
                        wasPenUp = true;
                    }
                    lastX = x;
                    lastY = y;
                    currentPointIndex++;
                }
                state.pointIndexes[clipIndex] = currentPointIndex;
            }
        }
    });
}

function animate(currentTime) {
    for (const state of canvases.values()) {
        if (state.type === 'single') {
            renderSingle(state, currentTime);
        } else if (state.type === 'world') {
            renderWorld(state, currentTime);
        }
    }
    requestAnimationFrame(animate);
}

self.onmessage = (e) => {
    const { action, payload } = e.data;

    if (action === 'register') {
        const { id, canvas, type, data } = payload;
        const { width, height } = canvas;
        canvases.set(id, {
            id,
            canvas,
            ctx: canvas.getContext('2d'),
            type,
            data,
            lastUpdateTime: 0,
            currentFrameIndex: 0,
            pointIndex: 0,
            lastX: ((0 + 32768) / 65535) * width,
            lastY: height - (((0 + 32768) / 65535) * height),
            wasPenUp: true,
            frameIndexes: (data.worldData || []).map(() => 0),
            pointIndexes: (data.worldData || []).map(() => 0),
        });
    } else if (action === 'deregister') {
        canvases.delete(payload.id);
    } else if (action === 'update') {
        const { id, data } = payload;
        const state = canvases.get(id);
        if (state) {
            if (state.type === 'single') {
                if (state.data.ildaFrames !== data.ildaFrames) {
                    state.currentFrameIndex = 0;
                    state.lastUpdateTime = 0;
                }
            } else if (state.type === 'world') {
                const oldWorldData = state.data.worldData;
                const newFrameIndexes = [];
                const newPointIndexes = [];
                const newWorldData = data.worldData || [];
                newWorldData.forEach((newClip, newClipIndex) => {
                    const oldClipIndex = (oldWorldData || []).findIndex(oldClip => oldClip === newClip);
                    if (oldClipIndex !== -1) {
                        newFrameIndexes[newClipIndex] = state.frameIndexes[oldClipIndex] || 0;
                        newPointIndexes[newClipIndex] = state.pointIndexes[oldClipIndex] || 0;
                    } else {
                        newFrameIndexes[newClipIndex] = 0;
                        newPointIndexes[newClipIndex] = 0;
                    }
                });
                state.frameIndexes = newFrameIndexes;
                state.pointIndexes = newPointIndexes;
            }
            state.data = data;
        }
    }
};

requestAnimationFrame(animate);
