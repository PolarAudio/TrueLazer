/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds.
 * Provides trailing and leading options (both default to true).
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function throttle(func, wait) {
    let timeout = null;
    let lastArgs = null;
    let lastCallTime = 0;

    const later = () => {
        const remaining = wait - (Date.now() - lastCallTime);
        if (remaining <= 0) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            if (lastArgs) {
                func(...lastArgs);
                lastCallTime = Date.now();
                lastArgs = null;
                // Schedule one more check if there's trailing work
                timeout = setTimeout(later, wait);
            }
        } else {
            timeout = setTimeout(later, remaining);
        }
    };

    return (...args) => {
        const now = Date.now();
        const remaining = wait - (now - lastCallTime);

        if (remaining <= 0) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            func(...args);
            lastCallTime = now;
            // Schedule the trailing edge check
            timeout = setTimeout(later, wait);
        } else {
            lastArgs = args;
            if (!timeout) {
                timeout = setTimeout(later, remaining);
            }
        }
    };
}
