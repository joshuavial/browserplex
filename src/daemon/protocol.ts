import * as path from "node:path";
import * as os from "node:os";
import { StringDecoder } from "node:string_decoder";

/** Base dir shared with storage (`~/.browserplex`). */
export const BASE_DIR = path.join(os.homedir(), ".browserplex");
export const SOCKET_PATH = path.join(BASE_DIR, "daemon.sock");
export const PID_PATH = path.join(BASE_DIR, "daemon.pid");
export const LOG_PATH = path.join(BASE_DIR, "daemon.log");

/** Restrictive perms — the daemon exposes full browser control. */
export const SOCKET_MODE = 0o600;

/** Max bytes for a single newline-delimited message (OOM guard). */
export const MAX_LINE_BYTES = 16 * 1024 * 1024; // 16 MiB (screenshots can be large)

export interface DaemonRequest {
  id: number;
  tool: string;
  args?: Record<string, unknown>;
}

export interface DaemonResponse {
  /** Echoes the request id; null only when the request id could not be parsed. */
  id: number | null;
  ok: boolean;
  text?: string;
  data?: unknown;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

/** Serialize a message as a single newline-terminated JSON line. */
export function encodeMessage(msg: DaemonRequest | DaemonResponse): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Buffers socket chunks and yields complete non-empty lines split on "\n".
 * Yields raw strings (not parsed) so the caller can isolate parse/shape errors
 * per message and turn them into error replies instead of crashing.
 * - Tolerates messages split across chunks and multiple messages per chunk.
 * - Skips empty lines.
 * - Throws on a single line exceeding MAX_LINE_BYTES (caller closes the socket).
 */
export class LineDecoder {
  private buffer = "";
  // StringDecoder preserves multi-byte UTF-8 sequences split across chunk boundaries.
  private sd = new StringDecoder("utf8");

  /** Push a chunk; returns the complete lines it finished. */
  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.sd.write(chunk);
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      // Cap EVERY completed line, not just the unterminated tail — a giant line
      // ending in \n must not bypass the limit.
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        throw new Error(`message exceeds ${MAX_LINE_BYTES} bytes`);
      }
      if (line.trim() === "") continue;
      out.push(line);
    }
    // Also bound an unterminated line still accumulating in the buffer.
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_LINE_BYTES) {
      const over = Buffer.byteLength(this.buffer, "utf8");
      this.buffer = "";
      throw new Error(`message exceeds ${MAX_LINE_BYTES} bytes without a newline (got ${over}+)`);
    }
    return out;
  }
}
