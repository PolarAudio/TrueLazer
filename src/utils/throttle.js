/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds.
 * Provides trailing and leading options (both default to true).
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
/**
 * Creates a debounced function that delays invoking func until `wait` ms have
 * elapsed since the last call. With `leading` enabled, the FIRST call fires
 * immediately (so discrete clicks still respond instantly); subsequent calls
 * during a continuous stream (e.g. a slider drag) only produce a trailing
 * invocation once the stream rests. This keeps state commits (and the React
 * re-renders they trigger) off the hot path while dragging.
 * @param {Function} func
 * @param {number} wait
 * @param {boolean} [leading=false]
 * @returns {Function}
 */
export function debounce(func, wait, leading = false) {
    let timeout = null;
    let lastArgs = null;
    let lastCallTime = 0;

    const invoke = (args) => {
        lastCallTime = Date.now();
        func(...args);
    };

    const later = () => {
        timeout = null;
        if (lastArgs) {
            const args = lastArgs;
            lastArgs = null;
            invoke(args);
        }
    };

    return (...args) => {
        lastArgs = args;
        const sinceLast = Date.now() - lastCallTime;

        // Leading edge: fire immediately if we're outside the wait window and
        // no trailing timer is pending (a trailing timer means we're mid-drag).
        if (leading && !timeout && sinceLast >= wait) {
            lastArgs = null;
            invoke(args);
            return;
        }

        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

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
