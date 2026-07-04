import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const PROTOCOL = "xenota.concierge.automation.v0";
const require = createRequire(import.meta.url);
const HTML2CANVAS_PATH = require.resolve("html2canvas/dist/html2canvas.min.js");
let html2canvasSource: Promise<string> | undefined;

export interface TauriLaunchOptions {
  appPath?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  windowTitle?: string;
  windowOwner?: string;
  startupTimeoutMs?: number;
}

export interface TauriSession {
  kind: "tauri";
  hello: Record<string, unknown>;
  child: ChildProcess;
  server: Server;
  socket: Socket;
  command(payload: Record<string, unknown>): Promise<unknown>;
  screenshot(savePath?: string): Promise<Buffer>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export function encodeFrame(payload: string): Buffer {
  const body = Buffer.from(payload);
  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  }
  if (body.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(body.length, 6);
  return Buffer.concat([header, body]);
}

export function decodeFrame(buffer: Buffer): { text?: string; close?: boolean; bytes: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return { close: true, bytes: 2 };
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    if (high !== 0) {
      throw new Error("Tauri automation frame too large");
    }
    length = low;
    offset = 10;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  const maskOffset = masked ? 4 : 0;
  const total = offset + maskOffset + length;
  if (buffer.length < total) return null;
  let payload = buffer.subarray(offset + maskOffset, total);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  }
  return { text: payload.toString("utf8"), bytes: total };
}

async function getHtml2CanvasSource(): Promise<string> {
  html2canvasSource ??= readFile(HTML2CANVAS_PATH, "utf8");
  return html2canvasSource;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => {
    const timer = setTimeout(resolveClose, 1000);
    server.close(() => {
      clearTimeout(timer);
      resolveClose();
    });
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExited) => {
    child.once("exit", () => resolveExited());
  });
  child.kill("SIGTERM");
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Process may not be a group leader on older sessions.
    }
  }
  await Promise.race([
    exited,
    new Promise<void>((resolveKill) => {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // Process may already be gone.
            }
          }
        }
        resolveKill();
      }, 3000);
    }),
  ]);
}

async function createAgentServer(): Promise<{
  server: Server;
  wsUrl: string;
  hello: Promise<Record<string, unknown>>;
  command(payload: Record<string, unknown>): Promise<unknown>;
  socketRef: () => Socket | undefined;
}> {
  let socket: Socket | undefined;
  let pending = Buffer.alloc(0);
  let nextId = 1;
  const waiting = new Map<number, Pending>();
  let helloResolve: (value: Record<string, unknown>) => void;
  const hello = new Promise<Record<string, unknown>>((resolveHello) => {
    helloResolve = resolveHello;
  });

  const server = createServer((connection) => {
    connection.once("data", (chunk) => {
      const request = chunk.toString("utf8");
      const key = request.match(/^Sec-WebSocket-Key: (.+)$/im)?.[1]?.trim();
      if (!key) {
        connection.destroy(new Error("Missing Sec-WebSocket-Key"));
        return;
      }
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      connection.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"));
      socket = connection;
      connection.on("data", (frameChunk) => {
        pending = Buffer.concat([pending, frameChunk]);
        while (pending.length > 0) {
          const decoded = decodeFrame(pending);
          if (!decoded) break;
          pending = pending.subarray(decoded.bytes);
          if (decoded.close || !decoded.text) continue;
          const message = JSON.parse(decoded.text) as Record<string, unknown>;
          if (message.type === "hello") {
            helloResolve(message);
            continue;
          }
          const id = Number(message.id);
          const waiter = waiting.get(id);
          if (waiter) {
            waiting.delete(id);
            clearTimeout(waiter.timer);
            if (message.ok) {
              waiter.resolve(message.result);
            } else {
              const error = message.error as { name?: string; message?: string } | undefined;
              waiter.reject(new Error(`${error?.name ?? "Error"}: ${error?.message ?? "command failed"}`));
            }
          }
        }
      });
    });
  });

  const address = await new Promise<{ port: number }>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen(server.address() as { port: number });
    });
  });

  return {
    server,
    wsUrl: `ws://127.0.0.1:${address.port}/automation`,
    hello,
    command(payload: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        if (!socket) {
          reject(new Error("Tauri automation agent is not connected"));
          return;
        }
        const id = nextId++;
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`Timed out waiting for Tauri command ${String(payload.command)}`));
        }, Number(payload.timeoutMs) || 5000);
        waiting.set(id, { resolve, reject, timer });
        socket.write(encodeFrame(JSON.stringify({ id, ...payload })));
      });
    },
    socketRef: () => socket,
  };
}

function launchChild(options: TauriLaunchOptions, wsUrl: string): ChildProcess {
  const command = options.appPath ?? options.command;
  if (!command) {
    throw new Error("tauri sessions require appPath or command");
  }
  const args = options.appPath ? [] : options.args ?? [];
  return spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: {
      ...process.env,
      ...options.env,
      TAURI_AUTOMATION: "1",
      TAURI_AUTOMATION_WS: wsUrl,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function findWindow(options: TauriLaunchOptions): Promise<{ id: string; owner: string; name: string; x: number; y: number; width: number; height: number }> {
  const dir = await mkdir(join(tmpdir(), "browserplex-tauri"), { recursive: true }).then(() => join(tmpdir(), "browserplex-tauri"));
  const helper = join(dir, "find-window.swift");
  const title = options.windowTitle ?? "Xenota Concierge";
  const owner = options.windowOwner ?? "xenota-concierge";
  await writeFile(helper, [
    "import CoreGraphics",
    "import Foundation",
    `let titleHint = ${JSON.stringify(title)}`,
    `let ownerHint = ${JSON.stringify(owner)}`,
    "let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []",
    "for window in windows {",
    "  let name = window[kCGWindowName as String] as? String ?? \"\"",
    "  let owner = window[kCGWindowOwnerName as String] as? String ?? \"\"",
    "  let layer = window[kCGWindowLayer as String] as? Int ?? -1",
    "  let alpha = window[kCGWindowAlpha as String] as? Double ?? 0",
    "  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]",
    "  let width = bounds[\"Width\"] as? Double ?? 0",
    "  let height = bounds[\"Height\"] as? Double ?? 0",
    "  if layer != 0 || alpha <= 0 || width < 100 || height < 100 { continue }",
    "  if name.contains(titleHint) || owner.contains(ownerHint) {",
    "    if let id = window[kCGWindowNumber as String] as? Int {",
    "      let x = bounds[\"X\"] as? Double ?? 0",
    "      let y = bounds[\"Y\"] as? Double ?? 0",
    "      print(\"\\(id)\\t\\(owner)\\t\\(name)\\t\\(Int(x))\\t\\(Int(y))\\t\\(Int(width))\\t\\(Int(height))\")",
    "      exit(0)",
    "    }",
    "  }",
    "}",
  ].join("\n"));
  const output = run("swift", [helper]);
  const [id, foundOwner, name, x, y, width, height] = output.split("\t");
  if (!id) throw new Error("Tauri window not found");
  return { id, owner: foundOwner, name, x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
}

async function nativeScreenshot(options: TauriLaunchOptions, savePath?: string): Promise<Buffer> {
  const dir = await mkdir(join(tmpdir(), "browserplex-tauri"), { recursive: true }).then(() => join(tmpdir(), "browserplex-tauri"));
  const fullPath = join(dir, `full-${Date.now()}.png`);
  const outPath = savePath ? resolve(savePath) : join(dir, `window-${Date.now()}.png`);
  const window = await findWindow(options);
  run("screencapture", ["-x", fullPath]);
  run("sips", [
    "--cropToHeightWidth",
    String(window.height),
    String(window.width),
    "--cropOffset",
    String(window.y),
    String(window.x),
    fullPath,
    "--out",
    outPath,
  ]);
  await stat(outPath);
  const buffer = await readFile(outPath);
  await rm(fullPath, { force: true }).catch(() => {});
  return buffer;
}

function pngBufferFromDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error(`Tauri webview screenshot did not return a PNG data URL: ${dataUrl.slice(0, 120)}`);
  }
  return Buffer.from(match[1], "base64");
}

async function html2canvasScreenshot(
  command: (payload: Record<string, unknown>) => Promise<unknown>,
): Promise<Buffer> {
  const html2canvas = await getHtml2CanvasSource();
  const expression = `(
    async () => {
      if (typeof window.html2canvas !== "function") {
        (0, eval)(${JSON.stringify(`${html2canvas}\n//# sourceURL=browserplex-html2canvas.js`)});
      }
      if (typeof window.html2canvas !== "function") {
        throw new Error("html2canvas did not install in the Tauri webview");
      }

      const width = Math.max(1, Math.ceil(window.innerWidth || document.documentElement.clientWidth || 1));
      const height = Math.max(1, Math.ceil(window.innerHeight || document.documentElement.clientHeight || 1));
      const target = document.body || document.documentElement;
      const canvas = await window.html2canvas(target, {
        backgroundColor: null,
        logging: false,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        windowWidth: width,
        windowHeight: height,
        x: window.scrollX || 0,
        y: window.scrollY || 0,
        width,
        height
      });
      if (!canvas.width || !canvas.height) {
        throw new Error(\`html2canvas returned an empty canvas: \${canvas.width}x\${canvas.height}, viewport \${width}x\${height}, target \${target.tagName}\`);
      }
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl === "data:,") {
        throw new Error(\`html2canvas could not export canvas: \${canvas.width}x\${canvas.height}, viewport \${width}x\${height}, target \${target.tagName}\`);
      }
      return dataUrl;
    }
  )()`;
  const result = await command({ command: "eval", expression, timeoutMs: 30000 }) as { value?: unknown };
  if (typeof result.value !== "string") {
    throw new Error("Tauri webview screenshot returned no PNG data");
  }
  return pngBufferFromDataUrl(result.value);
}

async function nativeWebviewScreenshot(
  command: (payload: Record<string, unknown>) => Promise<unknown>,
): Promise<Buffer> {
  const result = await command({ command: "screenshot", timeoutMs: 30000 }) as { dataUrl?: unknown };
  if (typeof result.dataUrl !== "string") {
    throw new Error("Tauri native webview screenshot returned no PNG data");
  }
  return pngBufferFromDataUrl(result.dataUrl);
}

export async function webviewScreenshot(
  command: (payload: Record<string, unknown>) => Promise<unknown>,
  savePath?: string,
): Promise<Buffer> {
  let buffer: Buffer;
  try {
    buffer = await html2canvasScreenshot(command);
  } catch {
    buffer = await nativeWebviewScreenshot(command);
  }
  if (savePath) {
    await writeFile(savePath, buffer);
  }
  return buffer;
}

export async function launchTauri(options: TauriLaunchOptions = {}): Promise<TauriSession> {
  const agent = await createAgentServer();
  const child = launchChild(options, agent.wsUrl);
  try {
    const hello = await Promise.race([
      agent.hello,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for Tauri automation hello")), options.startupTimeoutMs ?? 120000);
      }),
    ]);
    if (hello.protocol !== PROTOCOL) {
      throw new Error(`Unexpected Tauri automation protocol: ${JSON.stringify(hello)}`);
    }
    const socket = agent.socketRef();
    if (!socket) throw new Error("Tauri automation socket missing after hello");
    return {
      kind: "tauri",
      hello,
      child,
      server: agent.server,
      socket,
      command: agent.command,
      screenshot: (savePath?: string) => webviewScreenshot(agent.command, savePath),
      async close() {
        socket.destroy();
        await terminate(child);
        await closeServer(agent.server);
      },
    };
  } catch (error) {
    await terminate(child).catch(() => {});
    await closeServer(agent.server).catch(() => {});
    throw error;
  }
}
