import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { LineDecoder, encodeMessage, type DaemonResponse } from '../daemon/protocol.js';

const DAEMON = path.resolve('dist/daemon/server.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spawn a daemon in an isolated dir; returns helpers bound to it. */
async function startDaemon(idleMs: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-daemon-'));
  const sock = path.join(dir, 'daemon.sock');
  const pidPath = path.join(dir, 'daemon.pid');
  const child = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, BROWSERPLEX_DIR: dir, BROWSERPLEX_IDLE_MS: idleMs },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50 && !(await fs.access(sock).then(() => true).catch(() => false)); i++) await sleep(100);
  return { dir, sock, pidPath, child };
}

async function readPid(pidPath: string): Promise<number> {
  return parseInt(await fs.readFile(pidPath, 'utf8'), 10);
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH
  }
}

/** A raw socket client that correlates replies by id using the real LineDecoder. */
function connect(sock: string) {
  const socket = net.connect(sock);
  const dec = new LineDecoder();
  const replies = new Map<number | string, DaemonResponse>();
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    for (const line of dec.push(chunk)) {
      const o = JSON.parse(line) as DaemonResponse;
      replies.set(o.id === null ? 'null' : o.id, o);
    }
  });
  const ready = new Promise<void>((res, rej) => {
    socket.once('connect', () => res());
    socket.once('error', rej);
  });
  return {
    socket,
    ready,
    sendRaw: (s: string) => socket.write(s),
    send: (id: number, tool: string, args: Record<string, unknown> = {}) => socket.write(encodeMessage({ id, tool, args })),
    wait: async (id: number | string) => {
      for (let i = 0; i < 200 && !replies.has(id); i++) await sleep(50);
      return replies.get(id);
    },
  };
}

describe('daemon IPC round-trip', () => {
  let d: Awaited<ReturnType<typeof startDaemon>>;
  beforeAll(async () => {
    d = await startDaemon('0'); // disable idle for these tests
  }, 30_000);
  afterAll(async () => {
    try {
      process.kill(await readPid(d.pidPath), 'SIGTERM');
    } catch {
      /* already gone */
    }
    await sleep(300);
    await fs.rm(d.dir, { recursive: true, force: true });
  });

  it('round-trips session_create + navigate + evaluate + console over the socket', async () => {
    const c = connect(d.sock);
    await c.ready;
    c.send(1, 'session_create', { name: 's', type: 'chromium', headless: true });
    expect((await c.wait(1))?.ok).toBe(true);
    c.send(2, 'browser_navigate', { session: 's', url: 'data:text/html,<title>ok</title>' });
    expect((await c.wait(2))?.ok).toBe(true);
    c.send(3, 'browser_evaluate', { session: 's', script: 'document.title' });
    expect((await c.wait(3))?.data).toBe('ok');
    c.send(4, 'browser_evaluate', { session: 's', script: 'console.log("daemon-test"); 1' });
    await c.wait(4);
    c.send(5, 'browser_console_messages', { session: 's' });
    expect(JSON.stringify((await c.wait(5))?.data)).toContain('daemon-test');
    c.send(6, 'session_destroy', { name: 's' });
    expect((await c.wait(6))?.ok).toBe(true);
    c.socket.end();
  }, 60_000);

  it('isolates bad input: unknown tool, malformed line, oversized line', async () => {
    const c = connect(d.sock);
    await c.ready;
    c.send(10, 'no_such_tool');
    const r10 = await c.wait(10);
    expect(r10?.ok).toBe(false);
    expect(r10?.error).toMatch(/Unknown tool/);
    c.sendRaw('{bad json}\n'); // malformed -> error reply (id null), connection survives
    expect((await c.wait('null'))?.ok).toBe(false);
    c.send(11, 'session_list');
    expect((await c.wait(11))?.ok).toBe(true); // still works
    c.socket.end();
  }, 30_000);

  it('exposes control RPC: __daemon_status', async () => {
    const c = connect(d.sock);
    await c.ready;
    c.send(20, '__daemon_status');
    const r = await c.wait(20);
    expect(r?.ok).toBe(true);
    const data = r?.data as { pid: number; sessions: string[] };
    expect(typeof data.pid).toBe('number');
    expect(Array.isArray(data.sessions)).toBe(true);
    c.socket.end();
  }, 30_000);
});

describe('daemon idle-exit', () => {
  it('exits after the grace period when no sessions/connections remain', async () => {
    const d = await startDaemon('800'); // short idle, no session created, no lingering connection
    const pid = await readPid(d.pidPath);
    expect(alive(pid)).toBe(true);
    await sleep(2000); // > idle + teardown, with NO socket connects (which would re-arm)
    expect(alive(pid)).toBe(false);
    await fs.rm(d.dir, { recursive: true, force: true });
  }, 30_000);
});
