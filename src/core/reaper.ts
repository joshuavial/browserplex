import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { SessionInfo } from "./types.js";

/**
 * Idle reaper: closes bp sessions nobody has used for a while, and kills browser/app
 * processes bp launched that no longer belong to a live session.
 *
 * Proof of ownership for processes is a ledger (`browsers.json` in the bp dir) of the
 * daemon's own child processes, keyed by pid + start time so a reused pid never matches.
 * A process is only ever killed if it (or an ancestor) is in that ledger. Nothing is
 * matched by name or command line, so JV's own Firefox/Chrome and other tools'
 * Playwright browsers are never candidates.
 */

const HOUR = 3_600_000;

function parseMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Idle threshold before a session is reaped. `BROWSERPLEX_REAP_IDLE_MS`, default 4h; 0 disables reaping. */
export function reapIdleMs(): number {
  return parseMs(process.env.BROWSERPLEX_REAP_IDLE_MS, 4 * HOUR);
}

/** How often the reaper runs. `BROWSERPLEX_REAP_INTERVAL_MS`, default 5 min. */
export function reapIntervalMs(): number {
  return parseMs(process.env.BROWSERPLEX_REAP_INTERVAL_MS, 300_000) || 300_000;
}

/** Names of sessions idle for strictly longer than `thresholdMs`. */
export function staleSessions(sessions: SessionInfo[], now: number, thresholdMs: number): SessionInfo[] {
  if (thresholdMs <= 0) return [];
  return sessions.filter((s) => now - Date.parse(s.lastUsedAt) > thresholdMs);
}

// ---- process ledger ----

export interface ProcInfo {
  pid: number;
  ppid: number;
  /** `ps` lstart string; together with pid it identifies one process lifetime. */
  started: string;
  command: string;
}

export interface LedgerEntry {
  pid: number;
  started: string;
  command: string;
  daemonPid: number;
  recordedAt: string;
}

/** Parse `ps -axo pid=,ppid=,lstart=,args=` output. lstart is always 5 tokens ("Thu Nov 12 10:00:00 2026"). */
export function parsePs(out: string): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim().split(/\s+/);
    if (t.length < 7) continue;
    const pid = Number(t[0]);
    const ppid = Number(t[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    procs.push({ pid, ppid, started: t.slice(2, 7).join(" "), command: t.slice(7).join(" ") });
  }
  return procs;
}

/** Snapshot the process table. The `ps` child itself is excluded. */
export function listProcesses(): Promise<ProcInfo[]> {
  return new Promise((resolve, reject) => {
    const child = execFile("ps", ["-axo", "pid=,ppid=,lstart=,args="], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(parsePs(stdout).filter((p) => p.pid !== child.pid));
    });
  });
}

/** All descendants of `root` in a snapshot (children before parents is not guaranteed). */
export function descendants(procs: ProcInfo[], root: number): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>();
  for (const p of procs) {
    const list = byParent.get(p.ppid) ?? [];
    list.push(p);
    byParent.set(p.ppid, list);
  }
  const out: ProcInfo[] = [];
  const stack = [root];
  const seen = new Set<number>([root]);
  while (stack.length) {
    for (const c of byParent.get(stack.pop()!) ?? []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      out.push(c);
      stack.push(c.pid);
    }
  }
  return out;
}

/** Keep ledger entries whose exact process (pid + start time) is still alive; add the daemon's current children. */
export function updateLedger(ledger: LedgerEntry[], procs: ProcInfo[], daemonPid: number, now: Date = new Date()): LedgerEntry[] {
  const live = new Map(procs.map((p) => [p.pid, p]));
  const kept = ledger.filter((e) => live.get(e.pid)?.started === e.started);
  const known = new Set(kept.map((e) => `${e.pid}|${e.started}`));
  for (const p of procs) {
    if (p.ppid !== daemonPid || known.has(`${p.pid}|${p.started}`)) continue;
    kept.push({ pid: p.pid, started: p.started, command: p.command, daemonPid, recordedAt: now.toISOString() });
  }
  return kept;
}

/**
 * Ledger processes that no longer belong to a live session:
 *  - launched by a daemon that is gone (no longer a child of the current daemon), or
 *  - children of this daemon while it holds no sessions and has nothing in flight.
 * Only exact ledger matches (pid + start time) are returned; anything else is ignored.
 */
export function findOrphans(
  ledger: LedgerEntry[],
  procs: ProcInfo[],
  daemonPid: number,
  daemonBusy: boolean,
): ProcInfo[] {
  const live = new Map(procs.map((p) => [p.pid, p]));
  const out: ProcInfo[] = [];
  for (const e of ledger) {
    const p = live.get(e.pid);
    if (!p || p.started !== e.started || p.pid === daemonPid) continue;
    // Still parented by the (other, still-running) daemon that launched it: not ours to judge.
    if (e.daemonPid !== daemonPid && p.ppid === e.daemonPid) continue;
    if (p.ppid !== daemonPid || !daemonBusy) out.push(p);
  }
  return out;
}

export async function readLedger(file: string): Promise<LedgerEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as LedgerEntry[]) : [];
  } catch {
    return [];
  }
}

export async function writeLedger(file: string, ledger: LedgerEntry[]): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2));
  await fs.rename(tmp, file);
}

export function ledgerPath(baseDir: string): string {
  return path.join(baseDir, "browsers.json");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM a ledger root and its descendants, SIGKILL whatever is left after a grace period. */
export async function killTree(root: ProcInfo, procs: ProcInfo[], graceMs = 5_000): Promise<number[]> {
  const targets = [root, ...descendants(procs, root.pid)];
  for (const p of targets) {
    try {
      process.kill(p.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await sleep(graceMs);
  // Re-check identity before SIGKILL so a pid reused during the grace period is never hit.
  const after = new Map((await listProcesses()).map((p) => [p.pid, p]));
  for (const p of targets) {
    if (after.get(p.pid)?.started !== p.started) continue;
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return targets.map((p) => p.pid);
}
