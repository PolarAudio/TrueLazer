import { describe, it, expect, vi, beforeEach } from 'vitest';
import { throttle, debounce } from './throttle';

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

describe('debounce utility', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should not fire until the wait period elapses after the last call (trailing)', () => {
        const func = vi.fn();
        const debounced = debounce(func, 100);

        debounced('1');
        debounced('2');
        debounced('3');

        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(99);
        expect(func).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(func).toHaveBeenCalledTimes(1);
        expect(func).toHaveBeenLastCalledWith('3');
    });

    it('should fire a single call immediately when leading is enabled', () => {
        const func = vi.fn();
        const debounced = debounce(func, 100, true);

        debounced('click');
        expect(func).toHaveBeenCalledWith('click');
        expect(func).toHaveBeenCalledTimes(1);

        // A single click should not produce a trailing duplicate.
        vi.advanceTimersByTime(200);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('should fire once immediately then once with the final value after the drag rests', () => {
        const func = vi.fn();
        const debounced = debounce(func, 100, true);

        debounced('start');
        expect(func).toHaveBeenLastCalledWith('start');

        // Simulate a continuous drag stream (previous calls inside the window).
        debounced('mid1');
        debounced('mid2');
        debounced('mid3');
        vi.advanceTimersByTime(50);
        debounced('final');

        expect(func).toHaveBeenCalledTimes(1); // still just the leading call

        vi.advanceTimersByTime(100);
        expect(func).toHaveBeenCalledTimes(2);
        expect(func).toHaveBeenLastCalledWith('final');
    });

    it('should allow a new leading call after the cycle completes', () => {
        const func = vi.fn();
        const debounced = debounce(func, 100, true);

        debounced('1');
        vi.advanceTimersByTime(100);
        debounced('2');

        expect(func).toHaveBeenCalledTimes(2);
        expect(func).toHaveBeenLastCalledWith('2');
    });
});
