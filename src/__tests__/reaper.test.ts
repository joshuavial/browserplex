import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  staleSessions,
  parsePs,
  updateLedger,
  findOrphans,
  descendants,
  listProcesses,
  killTree,
  reapIdleMs,
  type LedgerEntry,
} from '../core/reaper.js';
import type { SessionInfo } from '../core/types.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-12T12:00:00Z');

function session(name: string, idleMs: number): SessionInfo {
  return {
    name,
    type: 'camoufox',
    url: 'about:blank',
    createdAt: new Date(NOW - 10 * HOUR).toISOString(),
    lastUsedAt: new Date(NOW - idleMs).toISOString(),
    idleMs,
  };
}

describe('staleSessions', () => {
  it('returns sessions idle past the threshold only', () => {
    const list = [session('old', 4 * HOUR + 1), session('fresh', 4 * HOUR - 1), session('edge', 4 * HOUR)];
    expect(staleSessions(list, NOW, 4 * HOUR).map((s) => s.name)).toEqual(['old']);
  });

  it('reaps nothing when the threshold is 0 (disabled)', () => {
    expect(staleSessions([session('old', 100 * HOUR)], NOW, 0)).toEqual([]);
  });
});

describe('reapIdleMs', () => {
  const saved = process.env.BROWSERPLEX_REAP_IDLE_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BROWSERPLEX_REAP_IDLE_MS;
    else process.env.BROWSERPLEX_REAP_IDLE_MS = saved;
  });
  it('defaults to 4 hours and honours the env override, including 0', () => {
    delete process.env.BROWSERPLEX_REAP_IDLE_MS;
    expect(reapIdleMs()).toBe(4 * HOUR);
    process.env.BROWSERPLEX_REAP_IDLE_MS = '0';
    expect(reapIdleMs()).toBe(0);
    process.env.BROWSERPLEX_REAP_IDLE_MS = '60000';
    expect(reapIdleMs()).toBe(60_000);
  });
});

// A process table: daemon 500; a live bp camoufox (child of daemon); a bp chromium left
// behind by a dead daemon (reparented to launchd); JV's own Firefox and Chrome; a project's
// Playwright test chromium; and a pid that was reused after a bp browser exited.
const PS = `
    1     0 Mon Nov  9 09:00:00 2026 /sbin/launchd
  500     1 Thu Nov 12 08:00:00 2026 node /x/browserplex/dist/daemon/server.js
  510   500 Thu Nov 12 08:05:00 2026 /Users/jv/Library/Caches/camoufox/Camoufox.app/Contents/MacOS/camoufox -juggler-pipe -profile /var/folders/T/playwright_firefoxdev_profile-a
  511   510 Thu Nov 12 08:05:01 2026 /Users/jv/Library/Caches/camoufox/Camoufox.app/Contents/MacOS/plugin-container -contentproc
  520     1 Wed Nov 11 07:00:00 2026 /Users/jv/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium --user-data-dir=/var/folders/T/playwright_chromiumdev_profile-b
  521   520 Wed Nov 11 07:00:01 2026 /Users/jv/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium Helper (Renderer) --type=renderer
  600     1 Mon Nov  9 09:10:00 2026 /Applications/Firefox.app/Contents/MacOS/firefox
  700     1 Mon Nov  9 09:11:00 2026 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  800   790 Thu Nov 12 09:00:00 2026 /Users/jv/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium --user-data-dir=/var/folders/T/playwright_chromiumdev_profile-c
  801     1 Thu Nov 12 11:00:00 2026 /Users/jv/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium --user-data-dir=/var/folders/T/playwright_chromiumdev_profile-d
`;

const ledger: LedgerEntry[] = [
  // launched by this daemon, still parented by it
  { pid: 510, started: 'Thu Nov 12 08:05:00 2026', command: 'camoufox', daemonPid: 500, recordedAt: '' },
  // launched by an earlier daemon (pid 400, now dead), reparented to launchd
  { pid: 520, started: 'Wed Nov 11 07:00:00 2026', command: 'Chromium', daemonPid: 400, recordedAt: '' },
  // pid 801 was a bp browser once, but the live 801 started later: a different process
  { pid: 801, started: 'Wed Nov 11 06:00:00 2026', command: 'Chromium', daemonPid: 400, recordedAt: '' },
];

describe('orphan filter', () => {
  const procs = parsePs(PS);

  it('parses ps output including lstart and commands with spaces', () => {
    const chrome = procs.find((p) => p.pid === 700)!;
    expect(chrome.ppid).toBe(1);
    expect(chrome.started).toBe('Mon Nov 9 09:11:00 2026');
    expect(chrome.command).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('flags only ledger browsers from a dead daemon, never non-bp browsers', () => {
    const lg = ledger.map((e) => ({ ...e, started: e.started.replace(/\s+/g, ' ') }));
    const orphans = findOrphans(lg, procs, 500, true).map((p) => p.pid);
    expect(orphans).toEqual([520]);
    // JV's Firefox/Chrome, another tool's Playwright chromium, and the reused pid are ignored,
    // even though several of them look exactly like a bp browser by command line.
    for (const pid of [600, 700, 800, 801]) expect(orphans).not.toContain(pid);
  });

  it("flags this daemon's children only when it holds no sessions", () => {
    const lg = ledger.map((e) => ({ ...e, started: e.started.replace(/\s+/g, ' ') }));
    expect(findOrphans(lg, procs, 500, true).map((p) => p.pid)).not.toContain(510);
    expect(findOrphans(lg, procs, 500, false).map((p) => p.pid).sort()).toEqual([510, 520]);
  });

  it('leaves processes still parented by another live daemon alone', () => {
    const other: LedgerEntry[] = [{ pid: 800, started: 'Thu Nov 12 09:00:00 2026', command: '', daemonPid: 790, recordedAt: '' }];
    expect(findOrphans(other, procs, 500, false)).toEqual([]);
  });

  it('ledger keeps live entries, drops dead/reused pids, and adds only daemon children', () => {
    const lg = ledger.map((e) => ({ ...e, started: e.started.replace(/\s+/g, ' ') }));
    const next = updateLedger(lg, procs, 500);
    expect(next.map((e) => e.pid).sort()).toEqual([510, 520]);
    const fresh = updateLedger([], procs, 500);
    expect(fresh.map((e) => e.pid)).toEqual([510]); // not 600/700/800/801
  });

  it('collects descendants so helper processes go with their browser', () => {
    expect(descendants(procs, 520).map((p) => p.pid)).toEqual([521]);
    expect(descendants(procs, 500).map((p) => p.pid).sort()).toEqual([510, 511]);
  });
});

describe('killTree (real processes)', () => {
  it('kills a tracked process and its children', async () => {
    const parent = spawn('/bin/sh', ['-c', 'sleep 60 & sleep 60; wait'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    const procs = await listProcesses();
    const root = procs.find((p) => p.pid === parent.pid)!;
    expect(root).toBeDefined();
    const kids = descendants(procs, root.pid).map((p) => p.pid);
    expect(kids.length).toBeGreaterThanOrEqual(1);
    await killTree(root, procs, 200);
    const after = new Set((await listProcesses()).map((p) => p.pid));
    for (const pid of [root.pid, ...kids]) expect(after.has(pid)).toBe(false);
  });
});
