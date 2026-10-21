// The decisions an auto-update makes, kept out of the wiring so they can be
// tested on their own.

// How often the app may ask GitHub for a newer release. The check is a
// network round trip, and a show machine that is offline for a week should
// not hammer the API on every start.
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a background check should run now.
 *
 * `autoCheck` off means the user only ever checks by hand.
 */
export function shouldAutoCheck(prefs = {}, now = Date.now()) {
    if (!prefs || prefs.autoCheck === false) return false;
    const last = Number(prefs.lastCheckAt) || 0;
    if (!last) return true;
    return (now - last) >= UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Compare dotted version strings numerically.
 *
 * A missing or non-numeric part counts as 0, so "0.2" and "0.2.0" are equal.
 */
export function compareVersions(a, b) {
    const pa = String(a === undefined || a === null ? '' : a).split(/[.-]/);
    const pb = String(b === undefined || b === null ? '' : b).split(/[.-]/);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = parseInt(pa[i], 10);
        const nb = parseInt(pb[i], 10);
        const va = Number.isNaN(na) ? 0 : na;
        const vb = Number.isNaN(nb) ? 0 : nb;
        if (va !== vb) return va > vb ? 1 : -1;
    }
    return 0;
}

/**
 * Whether an available version should be put in front of the user.
 *
 * A version the user chose to skip stays skipped until a newer one appears,
 * and the version the app is already running is never "available".
 */
export function shouldOfferVersion({ version, currentVersion, skippedVersion } = {}) {
    if (!version) return false;
    if (skippedVersion && version === skippedVersion) return false;
    if (!currentVersion) return true;
    return compareVersions(version, currentVersion) > 0;
}
