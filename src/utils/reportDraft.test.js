import { describe, it, expect } from 'vitest';
import {
    BUG_SEVERITIES,
    ISSUES_URL,
    MAX_ISSUE_URL_LENGTH,
    REPORT_AREAS,
    buildIssueUrl,
    composeBugReport,
    composeFeatureReport,
    fitIssueUrl,
    formatDacSummary,
    formatEnvironment,
    severityLabel,
    stripLogTail,
    toNumberedList,
} from './reportDraft';

// URLSearchParams encodes spaces as "+", which decodeURIComponent leaves alone.
const decodeUrl = (url) => decodeURIComponent(url).replace(/\+/g, ' ');

describe('reportDraft', () => {
    it('points at the TrueLazer issue tracker', () => {
        expect(ISSUES_URL).toBe('https://github.com/PolarAudio/TrueLazer/issues/new');
    });

    it('offers a label and an area for both kinds of report', () => {
        expect(BUG_SEVERITIES.length).toBeGreaterThan(0);
        expect(REPORT_AREAS).toContain('Timeline Editor');
        expect(REPORT_AREAS).toContain('DAC Communication');
        expect(severityLabel('show-stopper')).toContain('Show-stopper');
        // An unknown severity must not produce "undefined" in a report.
        expect(severityLabel('nonsense')).toBe('');
    });

    it('composes a bug report with the sections the issue template asks for', () => {
        const body = composeBugReport({
            title: 'Timeline freezes on replay',
            severity: 'show-stopper',
            area: 'Timeline Editor',
            whatHappened: 'The playhead stops at 00:12.',
            expected: 'The timeline loops.',
            steps: 'Open a timeline\nPress play\nWait for the loop',
        });
        for (const heading of ['## Summary', '## Severity', '## Area', '## What happened', '## What I expected', '## Steps to reproduce']) {
            expect(body, `missing ${heading}`).toContain(heading);
        }
        expect(body).toContain('Timeline freezes on replay');
        expect(body).toContain('Show-stopper');
        // Steps are renumbered so the report matches the template.
        expect(body).toContain('1. Open a timeline');
        expect(body).toContain('3. Wait for the loop');
    });

    it('composes a feature request with its own sections', () => {
        const body = composeFeatureReport({
            title: 'Per-output safety zones',
            area: 'Output Settings',
            problem: 'I cannot tell which fixture a safety zone belongs to.',
            proposal: 'Let each output own its safety zone.',
            why: 'Two projectors overlap in the middle of the room.',
        });
        for (const heading of ['## Summary', '## Area', '## The problem you are trying to solve', '## Proposed solution', '## Why it matters']) {
            expect(body, `missing ${heading}`).toContain(heading);
        }
    });

    it('omits sections the user left empty', () => {
        const body = composeBugReport({ title: 'Only a title', whatHappened: 'Something' });
        expect(body).toContain('## Summary');
        expect(body).not.toContain('## What I expected');
        expect(body).not.toContain('## Steps to reproduce');
    });

    it('appends the environment block and the log tail when they are supplied', () => {
        const body = composeBugReport(
            { title: 'x', whatHappened: 'y' },
            { environment: '- TrueLazer: 0.1.11', logTail: '[ERROR] boom' }
        );
        expect(body).toContain('## Environment');
        expect(body).toContain('- TrueLazer: 0.1.11');
        expect(body).toContain('## Log tail');
        expect(body).toContain('[ERROR] boom');
    });

    it('describes the environment without leaking undefined', () => {
        const environment = formatEnvironment({
            app: { version: '0.1.11', electron: '42.0.0', chrome: '140.0.0', node: '22.0.0' },
            system: { osName: 'Windows_NT', osRelease: '10.0.22631', platform: 'win32', arch: 'x64', cpuModel: 'Ryzen', cpuCores: 16, totalMemoryMB: 32768, freeMemoryMB: 12000 },
        }, { gpu: 'ANGLE (NVIDIA)', page: 'Timeline Editor', dac: 'Showbridge @ 192.168.1.50' });
        expect(environment).toContain('0.1.11');
        expect(environment).toContain('Windows_NT');
        expect(environment).toContain('Ryzen');
        expect(environment).toContain('ANGLE (NVIDIA)');
        expect(environment).toContain('Timeline Editor');
        expect(environment).toContain('Showbridge @ 192.168.1.50');
        expect(environment).not.toContain('undefined');
    });

    it('never puts a MAC address in the DAC summary', () => {
        const summary = formatDacSummary([
            { type: 'Showbridge', ip: '192.168.1.50', name: 'DAC-1', mac: '02:00:00:48:00:2e' },
        ]);
        expect(summary).toBe('Showbridge @ 192.168.1.50');
        expect(summary).not.toContain('02:00:00:48:00:2e');
    });

    it('numbers steps and ignores empty ones', () => {
        expect(toNumberedList('one\n\ntwo')).toBe('1. one\n2. two');
        expect(toNumberedList('')).toBe('');
    });

    it('builds a pre-filled issue URL with the title and label', () => {
        const url = buildIssueUrl({ title: '[Bug] Boom', body: 'body text', label: 'bug' });
        expect(url.startsWith(ISSUES_URL)).toBe(true);
        expect(url).toContain('labels=bug');
        expect(url).toContain('title=%5BBug%5D+Boom');
        expect(url).toContain('body=body+text');
    });

    it('removes the log tail section', () => {
        const body = composeBugReport(
            { title: 'x', whatHappened: 'y' },
            { environment: '- TrueLazer: 0.1.11', logTail: 'noise' }
        );
        const stripped = stripLogTail(body);
        expect(stripped).not.toContain('## Log tail');
        expect(stripped).toContain('## Environment');
        // A body without a log tail is returned untouched.
        expect(stripLogTail('## Summary\n\nx\n')).toBe('## Summary\n\nx\n');
    });

    it('keeps the log tail in the URL while it fits', () => {
        const body = composeBugReport(
            { title: 'x', whatHappened: 'y' },
            { logTail: 'short log line' }
        );
        const fitted = fitIssueUrl({ title: '[Bug] x', body, label: 'bug' });
        expect(fitted.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
        expect(fitted.droppedLogTail).toBe(false);
        expect(decodeUrl(fitted.url)).toContain('short log line');
    });

    it('drops the log tail when the report is too long for a URL', () => {
        const body = composeBugReport(
            { title: 'x', whatHappened: 'y' },
            { logTail: 'L'.repeat(MAX_ISSUE_URL_LENGTH * 2) }
        );
        const fitted = fitIssueUrl({ title: '[Bug] x', body, label: 'bug' });
        expect(fitted.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
        expect(fitted.droppedLogTail).toBe(true);
        expect(decodeUrl(fitted.url)).not.toContain('LLLLLLLLLL');
    });
});
