import { describe, it, expect, vi, beforeEach } from 'vitest';
import { throttle } from './throttle';

describe('throttle utility', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should fire immediately on the first call (leading)', () => {
        const func = vi.fn();
        const throttled = throttle(func, 100);

        throttled('first');
        expect(func).toHaveBeenCalledWith('first');
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should not fire again within the wait period', () => {
        const func = vi.fn();
        const throttled = throttle(func, 100);

        throttled('first');
        throttled('second');
        throttled('third');

        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should fire the latest value after the wait period (trailing)', () => {
        const func = vi.fn();
        const throttled = throttle(func, 100);

        throttled('first');
        throttled('second');
        throttled('third'); // Latest value

        vi.advanceTimersByTime(100);

        expect(func).toHaveBeenCalledTimes(2);
        expect(func).toHaveBeenLastCalledWith('third');
    });

    it('should allow subsequent leading calls after the cycle completes', () => {
        const func = vi.fn();
        const throttled = throttle(func, 100);

        throttled('1');
        vi.advanceTimersByTime(100); // Completes cycle (fires trailing if any, but none here)
        
        throttled('2');
        expect(func).toHaveBeenCalledWith('2');
    });
});
