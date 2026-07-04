import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrame, encodeFrame, webviewScreenshot } from '../core/tauri.js';

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2f5WQAAAABJRU5ErkJggg==';

describe('tauri websocket framing', () => {
  it('round-trips large unmasked server frames', () => {
    const payload = JSON.stringify({ script: 'x'.repeat(100_000) });
    const frame = encodeFrame(payload);

    const decoded = decodeFrame(frame);

    expect(decoded?.text).toBe(payload);
    expect(decoded?.bytes).toBe(frame.length);
  });

  it('decodes large masked browser frames', () => {
    const payload = JSON.stringify({ result: `data:image/png;base64,${'a'.repeat(100_000)}` });
    const body = Buffer.from(payload);
    const mask = Buffer.from([1, 2, 3, 4]);
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(body.length, 6);
    const maskedBody = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]));
    const frame = Buffer.concat([header, mask, maskedBody]);

    const decoded = decodeFrame(frame);

    expect(decoded?.text).toBe(payload);
    expect(decoded?.bytes).toBe(frame.length);
  });
});

describe('tauri webview screenshot', () => {
  let dir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('captures a PNG data URL from the automation agent and writes it to disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'browserplex-tauri-shot-'));
    const savePath = join(dir, 'shot.png');
    const command = vi.fn(async () => ({ value: `data:image/png;base64,${onePixelPng}` }));

    const buffer = await webviewScreenshot(command, savePath);

    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      command: 'eval',
      timeoutMs: 30000,
    }));
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(await readFile(savePath)).toEqual(buffer);
  });

  it('falls back to the native webview snapshot command when canvas export fails', async () => {
    dir = await mkdtemp(join(tmpdir(), 'browserplex-tauri-shot-'));
    const savePath = join(dir, 'shot.png');
    const command = vi
      .fn()
      .mockResolvedValueOnce({ value: 'data:,' })
      .mockResolvedValueOnce({ dataUrl: `data:image/png;base64,${onePixelPng}` });

    const buffer = await webviewScreenshot(command, savePath);

    expect(command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'eval',
      timeoutMs: 30000,
    }));
    expect(command).toHaveBeenNthCalledWith(2, {
      command: 'screenshot',
      timeoutMs: 30000,
    });
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(await readFile(savePath)).toEqual(buffer);
  });

  it('rejects non-PNG screenshot results', async () => {
    const command = vi.fn(async () => ({ value: 'not-a-data-url' }));

    await expect(webviewScreenshot(command)).rejects.toThrow('Tauri native webview screenshot returned no PNG data');
  });
});
