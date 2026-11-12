#!/usr/bin/env node
import net from "node:net";
import { promises as fs } from "node:fs";
import { sessionManager } from "../core/sessions.js";
import { actionDispatch } from "../core/dispatch.js";
import { formatDuration } from "../core/actions.js";
import {
  reapIdleMs,
  reapIntervalMs,
  staleSessions,
  listProcesses,
  updateLedger,
  findOrphans,
  readLedger,
  writeLedger,
  ledgerPath,
  killTree,
} from "../core/reaper.js";
import {
  BASE_DIR,
  SOCKET_PATH,
  PID_PATH,
  SOCKET_MODE,
  LineDecoder,
  encodeMessage,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[browserplexd ${new Date().toISOString()}] ${msg}`);
}

// ---- lifecycle state ----
// Idle-exit grace period in ms; 0 disables idle-exit. Default 5 min.
// NB: parse explicitly so `BROWSERPLEX_IDLE_MS=0` disables (a `Number(x) || default` would map 0
// back to the default since 0 is falsy).
function parseIdleMs(): number {
  const raw = process.env.BROWSERPLEX_IDLE_MS;
  if (raw === undefined || raw === "") return 300_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 300_000;
}
const IDLE_MS = parseIdleMs();
const startedAt = Date.now();
let serverRef: net.Server; // set in main() before bind so control/idle paths can reach it
let inFlight = 0; // requests dispatched but not yet replied
let openConnections = 0; // currently-connected clients
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** True only when nothing is holding the daemon: no sessions, no in-flight requests, no clients. */
function isIdle(): boolean {
  return sessionManager.list().length === 0 && inFlight === 0 && openConnections === 0;
}

/**
 * Re-evaluate idle state on every transition (connection open/close, request complete, startup).
 * Arms a single unref'd timer when idle; clears it otherwise. On fire it re-checks isIdle() — so a
 * client/session that appeared between arming and firing cannot be dropped.
 */
function evaluateIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (IDLE_MS <= 0 || !isIdle()) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (isIdle()) {
      log(`idle for ${IDLE_MS}ms with no sessions/connections; shutting down`);
      void shutdown("idle", serverRef);
    } else {
      evaluateIdle(); // something arrived during the wait — re-arm
    }
  }, IDLE_MS);
  idleTimer.unref();
}

/** Validate a parsed line into a DaemonRequest, or throw. */
function asRequest(parsed: unknown): DaemonRequest {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("request must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.id !== "number") throw new Error("request.id must be a number");
  if (typeof obj.tool !== "string") throw new Error("request.tool must be a string");
  if (obj.args !== undefined && (typeof obj.args !== "object" || obj.args === null)) {
    throw new Error("request.args must be an object");
  }
  return { id: obj.id, tool: obj.tool, args: (obj.args as Record<string, unknown>) ?? {} };
}

/** Run one request and produce its response (never throws). */
async function handleRequest(line: string): Promise<DaemonResponse> {
  let id: number | null = null;
  try {
    const parsed = JSON.parse(line);
    // best-effort id extraction so even a shape error echoes the id when present
    if (parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "number") {
      id = (parsed as { id: number }).id;
    }
    const req = asRequest(parsed);
    id = req.id;
    // Control RPC (handled before the tool registry so no fake entries leak into it).
    if (req.tool === "__daemon_status") {
      return {
        id,
        ok: true,
        data: { pid: process.pid, sessions: sessionManager.list().map((s) => s.name), uptimeMs: Date.now() - startedAt },
      };
    }
    if (req.tool === "__daemon_stop") {
      // Reply first, then shut down on the next tick so the reply can flush.
      setImmediate(() => void shutdown("rpc", serverRef));
      return { id, ok: true, text: "stopping" };
    }
    const action = actionDispatch[req.tool];
    if (!action) {
      return { id, ok: false, error: `Unknown tool: ${req.tool}` };
    }
    // Stamp use before and after, so a long-running command (e.g. wait_for) never looks idle.
    const target = typeof req.args?.session === "string" ? req.args.session : undefined;
    if (target) sessionManager.touch(target);
    let result;
    try {
      result = await action(req.args ?? {});
    } finally {
      if (target) sessionManager.touch(target);
    }
    if (req.tool === "session_create" || req.tool === "storage_load") await recordChildren();
    return {
      id,
      ok: true,
      text: result.text,
      data: result.data,
      imageBase64: result.image?.base64,
      mimeType: result.image?.mimeType,
    };
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Safely encode a response; if its `data` is non-serializable, degrade gracefully. */
function safeEncode(res: DaemonResponse): string {
  try {
    return encodeMessage(res);
  } catch {
    return encodeMessage({
      id: res.id,
      ok: false,
      error: "response data was not JSON-serializable",
    });
  }
}

function onConnection(socket: net.Socket): void {
  const decoder = new LineDecoder();
  let closing = false; // set once we reject/close — stops all further reads + writes

  let counted = true; // guards openConnections against a double 'close' decrement
  openConnections++;
  evaluateIdle(); // a live client suppresses idle-exit

  const reply = (res: DaemonResponse) => {
    if (closing || socket.destroyed || !socket.writable) return;
    socket.write(safeEncode(res));
  };

  socket.on("data", (chunk) => {
    if (closing) return; // ignore any bytes that arrive after we've started closing
    let lines: string[];
    try {
      lines = decoder.push(chunk);
    } catch (e) {
      // line too large — stop reading, flush the error, then destroy. pause() prevents any
      // further 'data' events (and thus write-after-end) while end() drains.
      closing = true;
      socket.pause();
      socket.end(safeEncode({ id: null, ok: false, error: (e as Error).message }), () =>
        socket.destroy(),
      );
      return;
    }
    for (const line of lines) {
      // Track in-flight so idle-exit can't fire while a request (incl. session_create) is mid-flight.
      inFlight++;
      handleRequest(line)
        .then(reply)
        .catch(() => {
          /* handleRequest never throws, but guard the .then(reply) write path */
        })
        .finally(() => {
          inFlight--;
          evaluateIdle();
        });
    }
  });
  socket.on("error", () => {
    /* client vanished mid-write — ignore */
  });
  socket.on("close", () => {
    if (!counted) return; // never decrement twice for one connection
    counted = false;
    openConnections--;
    evaluateIdle();
  });
}

// ---- idle reaper ----
const REAP_IDLE_MS = reapIdleMs();
const LEDGER = ledgerPath(BASE_DIR);
let reaping = false;
let reapTimer: ReturnType<typeof setInterval> | null = null;

/**
 * One reaper pass: destroy sessions idle past the threshold (same path as `bp session destroy`),
 * then kill ledger-tracked browser/app processes that no longer belong to a live session.
 */
async function reapOnce(): Promise<void> {
  if (reaping || shuttingDown) return;
  reaping = true;
  let reapedAny = false;
  try {
    const now = Date.now();
    for (const s of staleSessions(sessionManager.list(now), now, REAP_IDLE_MS)) {
      // Re-check right before destroying: a command may have arrived since the listing.
      const live = sessionManager.get(s.name);
      if (!live || Date.now() - live.lastUsedAt.getTime() <= REAP_IDLE_MS) continue;
      try {
        await actionDispatch.session_destroy({ name: s.name });
        reapedAny = true;
        log(`reaped session '${s.name}' (${s.type}) idle ${formatDuration(s.idleMs)}, last used ${s.lastUsedAt}`);
      } catch (e) {
        log(`reaper could not destroy '${s.name}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const procs = await listProcesses();
    const ledger = updateLedger(await readLedger(LEDGER), procs, process.pid);
    const busy = sessionManager.list().length > 0 || inFlight > 0;
    for (const orphan of findOrphans(ledger, procs, process.pid, busy)) {
      const pids = await killTree(orphan, procs);
      log(`reaped orphan bp process ${orphan.pid} (+${pids.length - 1} descendants): ${orphan.command.slice(0, 160)}`);
    }
    await writeLedger(LEDGER, updateLedger(ledger, await listProcesses(), process.pid));
  } catch (e) {
    log(`reaper pass failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    reaping = false;
    // Reaping the last session lets the daemon idle-exit as usual. Only re-arm when something was
    // reaped, so a routine pass never postpones a pending idle-exit.
    if (reapedAny) evaluateIdle();
  }
}

/** Record this daemon's child processes (the browsers/apps it just launched) in the ledger. */
async function recordChildren(): Promise<void> {
  try {
    await writeLedger(LEDGER, updateLedger(await readLedger(LEDGER), await listProcesses(), process.pid));
  } catch (e) {
    log(`could not record child processes: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- shutdown (re-entrant guard + force-exit timeout) ----
let shuttingDown = false;
async function shutdown(signal: string, server: net.Server): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (idleTimer) {
    clearTimeout(idleTimer); // no stale idle fire after a signal/RPC shutdown
    idleTimer = null;
  }
  if (reapTimer) {
    clearInterval(reapTimer);
    reapTimer = null;
  }
  log(`received ${signal}, shutting down`);
  // force-exit backstop so a hung browser close can't wedge the daemon
  const force = setTimeout(() => {
    log("force-exit after timeout");
    process.exit(0);
  }, 10_000);
  force.unref();
  server.close();
  try {
    await sessionManager.destroyAll();
  } catch {
    /* ignore */
  }
  await fs.unlink(SOCKET_PATH).catch(() => {});
  await fs.unlink(PID_PATH).catch(() => {});
  process.exit(0);
}

/**
 * Probe an existing socket: resolves true if a daemon is alive there, false if
 * it's stale (connection refused / no listener).
 */
function probeSocket(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(SOCKET_PATH);
    let settled = false;
    const done = (alive: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(t); // don't leave a 2s timer dangling on fast connect/error
      c.destroy();
      resolve(alive);
    };
    // bound the probe so a wedged connect cannot hang startup
    const t = setTimeout(() => done(false), 2_000);
    t.unref();
    c.once("connect", () => done(true));
    c.once("error", () => done(false));
  });
}

async function main(): Promise<void> {
  await fs.mkdir(BASE_DIR, { recursive: true });
  // Restrict the parent dir to the owner (0o700). This protects the socket regardless of its own
  // mode — avoids mutating process-global umask across the async listen() boundary.
  await fs.chmod(BASE_DIR, 0o700).catch(() => {});

  const server = net.createServer(onConnection);
  serverRef = server;

  const startListen = () =>
    new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => reject(e);
      server.once("error", onError);
      server.listen(SOCKET_PATH, () => {
        server.removeListener("error", onError); // remove the actual handler we installed
        resolve();
      });
    });

  // Bind with bounded stale-socket recovery. On EADDRINUSE: probe — a live listener means another
  // daemon owns it (exit); a stale socket gets unlinked and we retry. If a concurrent daemon rebinds
  // between our probe and unlink, the next listen throws EADDRINUSE again and we re-probe (rather than
  // blindly unlinking a now-live socket). Bounded so a persistent failure can't loop forever.
  let bound = false;
  for (let attempt = 0; attempt < 5 && !bound; attempt++) {
    try {
      await startListen();
      bound = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      if (await probeSocket()) {
        log(`a daemon is already listening on ${SOCKET_PATH}; exiting`);
        process.exit(0);
      }
      log(`removing stale socket ${SOCKET_PATH} (attempt ${attempt + 1})`);
      await fs.unlink(SOCKET_PATH).catch(() => {}); // tolerate ENOENT / races
    }
  }
  if (!bound) throw new Error(`could not bind ${SOCKET_PATH} after stale-recovery attempts`);

  await fs.chmod(SOCKET_PATH, SOCKET_MODE).catch(() => {});
  await fs.writeFile(PID_PATH, String(process.pid));
  log(`listening on ${SOCKET_PATH} (pid ${process.pid}, idle ${IDLE_MS}ms)`);

  process.on("SIGINT", () => void shutdown("SIGINT", server));
  process.on("SIGTERM", () => void shutdown("SIGTERM", server));

  evaluateIdle(); // a daemon spawned but never used still idle-exits after the grace period

  if (REAP_IDLE_MS > 0) {
    const every = reapIntervalMs();
    log(`reaper: sessions idle > ${formatDuration(REAP_IDLE_MS)} are closed (checked every ${formatDuration(every)})`);
    reapTimer = setInterval(() => void reapOnce(), every);
    reapTimer.unref();
    void reapOnce(); // clean up orphans left by a previous daemon straight away
  } else {
    log("reaper disabled (BROWSERPLEX_REAP_IDLE_MS=0)");
  }
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
