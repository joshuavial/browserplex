import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CLI = path.resolve('dist/cli/index.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;
let env: NodeJS.ProcessEnv;

/** Run `bp` as a SEPARATE process in the isolated dir. */
function bp(args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const ch = execFile('node', [CLI, ...args], { env }, (e, so, se) =>
      res({ code: (e as { code?: number } | null)?.code ?? 0, out: (so || '').trim(), err: (se || '').trim() }),
    );
    if (input !== undefined) ch.stdin?.end(input);
  });
}

describe('bp CLI e2e (separate processes, isolated daemon dir)', () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-cli-'));
    // idle disabled so the daemon persists across the separate-process commands in this suite
    env = { ...process.env, BROWSERPLEX_DIR: dir, BROWSERPLEX_IDLE_MS: '0' };
  });
  afterAll(async () => {
    await bp(['daemon', 'stop']).catch(() => {});
    // belt-and-suspenders: kill the daemon by pid if still around
    try {
      const pid = parseInt(await fs.readFile(path.join(dir, 'daemon.pid'), 'utf8'), 10);
      process.kill(pid, 'SIGTERM');
    } catch {
      /* gone */
    }
    await sleep(300);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('auto-spawns the daemon and reuses a live session across separate processes', async () => {
    const create = await bp(['session', 'create', 'app', '-b', 'chromium', '--headless']);
    expect(create.code).toBe(0);
    expect(create.out).toMatch(/Created chromium session 'app'/);

    // a SECOND process reuses the live session
    const nav = await bp(['navigate', 'data:text/html,<title>ok</title>', '-s', 'app']);
    expect(nav.code).toBe(0);
    expect(nav.out).toMatch(/Navigated to/);
  }, 60_000);

  it('persists the console buffer across separate bp processes', async () => {
    await bp(['eval', '-s', 'app', 'console.log("cli-e2e-marker"); 1']);
    const console1 = await bp(['console', '-s', 'app', '--json']);
    const parsed = JSON.parse(console1.out) as { ok: boolean; data: unknown };
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed.data)).toContain('cli-e2e-marker');
  }, 30_000);

  it('reports daemon status and stops the daemon', async () => {
    const status = await bp(['daemon', 'status']);
    expect(status.out).toMatch(/running \(pid \d+\)/);

    const stop = await bp(['daemon', 'stop']);
    expect(stop.out).toMatch(/stopped/);

    const status2 = await bp(['daemon', 'status']);
    expect(status2.out).toMatch(/not running/);
  }, 30_000);
});
