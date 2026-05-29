import net from "node:net";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { DaemonClient, DAEMON_ENTRY } from "../daemon/client.js";
import { SOCKET_PATH, PID_PATH } from "../daemon/protocol.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Single non-spawning connectivity probe. */
function isListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(SOCKET_PATH);
    const done = (v: boolean) => {
      c.destroy();
      resolve(v);
    };
    c.once("connect", () => done(true));
    c.once("error", () => done(false));
  });
}

/** `bp serve` — run the daemon in the foreground (logs to this terminal). */
export async function serve(): Promise<number> {
  if (await isListening()) {
    // eslint-disable-next-line no-console
    console.log("daemon already running");
    return 0;
  }
  const child = spawn(process.execPath, [DAEMON_ENTRY], { stdio: "inherit" });
  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  return await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

/** `bp daemon status`. */
export async function status(): Promise<number> {
  const client = new DaemonClient();
  if (!(await client.connectExisting())) {
    const stale = await fs
      .access(PID_PATH)
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.log(stale ? "not running (stale pid/socket)" : "not running");
    return 0;
  }
  try {
    const res = await client.request("__daemon_status");
    const d = (res.data ?? {}) as { pid?: number; sessions?: string[]; uptimeMs?: number };
    const sessions = d.sessions ?? [];
    // eslint-disable-next-line no-console
    console.log(
      `running (pid ${d.pid ?? "?"}), ${sessions.length} session(s)` +
        (sessions.length ? `: ${sessions.join(", ")}` : ""),
    );
    return 0;
  } finally {
    client.close();
  }
}

/** `bp daemon stop`. */
export async function stop(): Promise<number> {
  const client = new DaemonClient();
  if (!(await client.connectExisting())) {
    // not running; clean up a stale pid/socket if present
    await fs.unlink(SOCKET_PATH).catch(() => {});
    await fs.unlink(PID_PATH).catch(() => {});
    // eslint-disable-next-line no-console
    console.log("not running");
    return 0;
  }
  try {
    await client.request("__daemon_stop").catch(() => {}); // reply is best-effort; daemon exits
  } finally {
    client.close();
  }
  // wait for the socket to disappear (daemon's graceful shutdown unlinks it)
  for (let i = 0; i < 50; i++) {
    if (!(await isListening())) break;
    await sleep(100);
  }
  // eslint-disable-next-line no-console
  console.log("stopped");
  return 0;
}
