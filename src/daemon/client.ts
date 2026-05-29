import net from "node:net";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  BASE_DIR,
  SOCKET_PATH,
  LOG_PATH,
  LineDecoder,
  encodeMessage,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The compiled daemon entry, resolved relative to this module (dist/daemon/). */
const DAEMON_ENTRY = path.resolve(__dirname, "server.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DaemonClientOptions {
  /** Per-request timeout in ms. 0 disables (default: env BROWSERPLEX_TIMEOUT or 0). */
  requestTimeoutMs?: number;
}

/**
 * Thin client to the browserplex daemon. Connects to the unix socket, auto-spawning
 * the daemon on first use, and correlates replies to requests by `id` (the daemon does
 * NOT guarantee FIFO ordering).
 */
export class DaemonClient {
  private socket: net.Socket | null = null;
  private decoder = new LineDecoder();
  private pending = new Map<number, { resolve: (r: DaemonResponse) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();
  private nextId = 1;
  private readonly requestTimeoutMs: number;

  constructor(opts: DaemonClientOptions = {}) {
    this.requestTimeoutMs =
      opts.requestTimeoutMs ?? Number(process.env.BROWSERPLEX_TIMEOUT ?? 0) ?? 0;
  }

  /** Connect, auto-spawning the daemon if it isn't running yet. */
  async connect(): Promise<void> {
    if (this.socket) return;
    let spawned = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        this.socket = await this.tryConnect();
        this.attachHandlers(this.socket);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e;
        if (!spawned) {
          await this.spawnDaemon();
          spawned = true;
        }
        await sleep(100);
      }
    }
    throw new Error(
      `could not reach the browserplex daemon at ${SOCKET_PATH} after auto-spawn. ` +
        `Check the daemon log at ${LOG_PATH}.`,
    );
  }

  private tryConnect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.connect(SOCKET_PATH);
      s.once("connect", () => {
        s.removeAllListeners("error");
        resolve(s);
      });
      s.once("error", reject);
    });
  }

  private async spawnDaemon(): Promise<void> {
    await fs.mkdir(BASE_DIR, { recursive: true }).catch(() => {});
    // Redirect the detached daemon's stdout/stderr to the log file so startup crashes
    // are debuggable (NOT "ignore", which silently discards diagnostics).
    const fh = await fs.open(LOG_PATH, "a").catch(() => null);
    const out: number | "ignore" = fh ? fh.fd : "ignore";
    const child = spawn(process.execPath, [DAEMON_ENTRY], {
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
    // The child has dup'd the fd at spawn time; close our handle so we don't leak it
    // (avoids Node's GC "Closing file descriptor" warning on this short-lived process).
    await fh?.close().catch(() => {});
  }

  private attachHandlers(socket: net.Socket): void {
    socket.on("data", (chunk) => {
      let lines: string[];
      try {
        lines = this.decoder.push(chunk);
      } catch (e) {
        this.failAll(e as Error);
        socket.destroy();
        return;
      }
      for (const line of lines) {
        let res: DaemonResponse;
        try {
          res = JSON.parse(line) as DaemonResponse;
        } catch {
          // A non-JSON line is a protocol violation by the daemon — fail outstanding
          // requests rather than letting them hang forever (default timeout is off).
          this.failAll(new Error("malformed response line from daemon"));
          socket.destroy();
          return;
        }
        if (typeof res.id === "number") {
          const p = this.pending.get(res.id);
          if (p) {
            if (p.timer) clearTimeout(p.timer);
            this.pending.delete(res.id);
            p.resolve(res);
          }
        }
      }
    });
    const onGone = () => this.failAll(new Error("daemon connection closed before reply"));
    socket.on("error", onGone);
    socket.on("close", onGone);
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** Send a request and resolve with its (id-matched) response. */
  request(tool: string, args: Record<string, unknown> = {}): Promise<DaemonResponse> {
    if (!this.socket) throw new Error("not connected");
    const id = this.nextId++;
    const req: DaemonRequest = { id, tool, args };
    return new Promise<DaemonResponse>((resolve, reject) => {
      const entry: { resolve: (r: DaemonResponse) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout } = {
        resolve,
        reject,
      };
      if (this.requestTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`request '${tool}' timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
      }
      this.pending.set(id, entry);
      try {
        this.socket!.write(encodeMessage(req));
      } catch (e) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }
}
