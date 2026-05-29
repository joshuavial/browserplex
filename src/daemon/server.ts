#!/usr/bin/env node
import net from "node:net";
import { promises as fs } from "node:fs";
import { sessionManager } from "../core/sessions.js";
import { actionDispatch } from "../core/dispatch.js";
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
    const action = actionDispatch[req.tool];
    if (!action) {
      return { id, ok: false, error: `Unknown tool: ${req.tool}` };
    }
    const result = await action(req.args ?? {});
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
      handleRequest(line).then(reply);
    }
  });
  socket.on("error", () => {
    /* client vanished mid-write — ignore */
  });
}

// ---- shutdown (re-entrant guard + force-exit timeout) ----
let shuttingDown = false;
async function shutdown(signal: string, server: net.Server): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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

  const startListen = () =>
    new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => reject(e);
      server.once("error", onError);
      server.listen(SOCKET_PATH, () => {
        server.removeListener("error", onError); // remove the actual handler we installed
        resolve();
      });
    });

  try {
    await startListen();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      // Do NOT blindly unlink — a live daemon may own it. Probe first.
      const alive = await probeSocket();
      if (alive) {
        log(`a daemon is already listening on ${SOCKET_PATH}; exiting`);
        process.exit(0);
      }
      log(`removing stale socket ${SOCKET_PATH}`);
      await fs.unlink(SOCKET_PATH).catch(() => {});
      await startListen();
    } else {
      throw e;
    }
  }

  await fs.chmod(SOCKET_PATH, SOCKET_MODE).catch(() => {});
  await fs.writeFile(PID_PATH, String(process.pid));
  log(`listening on ${SOCKET_PATH} (pid ${process.pid})`);

  process.on("SIGINT", () => void shutdown("SIGINT", server));
  process.on("SIGTERM", () => void shutdown("SIGTERM", server));
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
