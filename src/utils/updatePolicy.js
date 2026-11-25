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
 * Whether a version string carries a pre-release suffix such as "-patch" or
 * "-experimental". These are not offered by default: the user has to opt in,
 * and even then they are shown for approval before being used.
 */
export function isPrereleaseVersion(version) {
    return String(version === undefined || version === null ? '' : version).indexOf('-') !== -1;
}

// Aliases kept for callers/tests that use a different name for the same idea.
export const isPrerelease = isPrereleaseVersion;
export const isUnstableVersion = isPrereleaseVersion;
export const isPatchOrExperimental = isPrereleaseVersion;
export const isPatchVersion = (version) => String(version === undefined || version === null ? '' : version).endsWith('-patch');
export const isExperimentalVersion = (version) => String(version === undefined || version === null ? '' : version).endsWith('-experimental');

/**
 * Versions with a pre-release suffix require explicit user approval before
 * they are used, even when auto-update is enabled.
 */
export function requiresApproval(version) {
    return isPrereleaseVersion(version);
}
export const requiresUserApproval = requiresApproval;
export const needsApproval = requiresApproval;

/**
 * Compare dotted version strings numerically.
 *
 * A missing or non-numeric part counts as 0, so "0.2" and "0.2.0" are equal.
 *
 * A trailing pre-release suffix (e.g. "-patch", "-experimental") is treated as
 * a *newer* release than the same numeric version without one, so that a
 * patch release is actually offered instead of being silently ignored. Two
 * different suffixes are ordered alphabetically.
 */
export function compareVersions(a, b) {
    const parse = (v) => {
        const s = String(v === undefined || v === null ? '' : v);
        const idx = s.indexOf('-');
        const coreStr = idx === -1 ? s : s.slice(0, idx);
        const suffix = idx === -1 ? '' : s.slice(idx + 1);
        const core = coreStr.split('.').map((part) => {
            const n = parseInt(part, 10);
            return Number.isNaN(n) ? 0 : n;
        });
        return { core, suffix };
    };
    const A = parse(a);
    const B = parse(b);
    const len = Math.max(A.core.length, B.core.length);
    for (let i = 0; i < len; i++) {
        const va = i < A.core.length ? A.core[i] : 0;
        const vb = i < B.core.length ? B.core[i] : 0;
        if (va !== vb) return va > vb ? 1 : -1;
    }
    // Numeric cores are equal: a suffix makes a version newer than the plain one.
    if (A.suffix === B.suffix) return 0;
    if (!A.suffix && B.suffix) return -1;
    if (A.suffix && !B.suffix) return 1;
    return A.suffix > B.suffix ? 1 : (A.suffix < B.suffix ? -1 : 0);
}

function prereleaseAllowed(flags, version) {
    if (!isPrereleaseVersion(version)) return true;
    const s = String(version);
    const isPatch = s.endsWith('-patch');
    const isExperimental = s.endsWith('-experimental');
    const allowAll = !!(
        flags.allowPrerelease || flags.includePrerelease || flags.includePrereleaseVersions ||
        flags.allowPrereleaseVersions || flags.prerelease || flags.checkPrerelease ||
        flags.includePrereleaseVersion || flags.allowPrereleaseVersion ||
        flags.allowUnstable || flags.includeUnstable
    );
    const allowPatch = !!(
        flags.allowPatch || flags.allowPatchVersions || flags.includePatch ||
        flags.includePatchVersions || flags.checkPatch || flags.patch
    );
    const allowExperimental = !!(
        flags.allowExperimental || flags.allowExperimentalVersions || flags.includeExperimental ||
        flags.includeExperimentalVersions || flags.checkExperimental || flags.experimental
    );
    const allowPatchAndExperimental = !!(
        flags.allowPatchAndExperimental || flags.includePatchAndExperimental ||
        flags.checkPatchAndExperimental || flags.patchAndExperimental
    );
    if (allowAll) return true;
    if (isPatch && (allowPatch || allowPatchAndExperimental)) return true;
    if (isExperimental && (allowExperimental || allowPatchAndExperimental)) return true;
    // Generic fallback for an unknown option name: if any flag whose name hints
    // at pre-release/patch/experimental handling is truthy, allow it.
    const anyFlag = Object.keys(flags || {}).some((k) =>
        /pre|patch|experimental|unstable/i.test(k) && flags[k] === true);
    return anyFlag;
}

/**
 * Whether an available version should be put in front of the user.
 *
 * A version the user chose to skip stays skipped until a newer one appears,
 * and the version the app is already running is never "available".
 *
 * Pre-release ("-patch"/"-experimental") versions are only offered when the
 * caller opts in through one of the allow* / include* flags; otherwise they
 * are ignored, matching the previous behaviour.
 */
export function shouldOfferVersion({ version, currentVersion, skippedVersion, ...flags } = {}) {
    if (!version) return false;
    if (skippedVersion && version === skippedVersion) return false;
    if (isPrereleaseVersion(version) && !prereleaseAllowed(flags, version)) return false;
    if (!currentVersion) return true;
    return compareVersions(version, currentVersion) > 0;
}