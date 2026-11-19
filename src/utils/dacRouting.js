// Which physical DAC channels an active clip is sent to.
//
// A layer's "Assigned DACs" and a clip's own assignments are additive: a clip
// plays on both. A clip with neither is deliberately routed NOWHERE.
//
// The channel selected in the DAC panel is a UI/settings focus, not an output
// route. Treating it as a default output silently sent every unassigned clip
// to whichever channel was last clicked, and mergeFrames() then concatenated
// all of those clips onto that one physical channel.
export function resolveClipDacs(layerDacs, clipDacs) {
    const combined = [
        ...(Array.isArray(layerDacs) ? layerDacs : []),
        ...(Array.isArray(clipDacs) ? clipDacs : []),
    ];

    const dacList = [];
    const seen = new Set();

    for (const dac of combined) {
        if (!dac || dac.ip === undefined) continue;

        // Older assignments may carry only a channel list; resolve it to a
        // concrete service id so the dedupe key and the send key agree.
        const channel = dac.channel !== undefined
            ? dac.channel
            : (dac.channels && dac.channels.length > 0 ? dac.channels[0].serviceID : 0);

        const key = `${dac.ip}:${channel}`;
        if (seen.has(key)) continue;

        seen.add(key);
        dacList.push({ ...dac, channel });
    }

    return dacList;
}
