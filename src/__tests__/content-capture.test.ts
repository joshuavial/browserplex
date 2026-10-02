import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as actions from '../core/actions.js';
import { sessionManager } from '../core/sessions.js';

describe('trusted page content capture', () => {
  afterEach(async () => {
    await sessionManager.destroyAll();
  });

  it('serializes outside the page main realm and writes a hash receipt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'browserplex-content-'));
    try {
      const session = await sessionManager.create('content-test', 'chromium');
      await session.page.setContent('<main><h1>Trusted content</h1></main>');
      await session.page.evaluate(() => {
        Object.defineProperty(Element.prototype, 'outerHTML', {
          configurable: true,
          get: () => '<html>poisoned</html>',
        });
        Object.defineProperty(globalThis, 'XMLSerializer', {
          configurable: true,
          value: class {
            serializeToString() { return '<html>poisoned</html>'; }
          },
        });
      });

      const savePath = join(dir, 'page.html');
      const result = await actions.browserContent({
        session: 'content-test',
        savePath,
        maxBytes: 2 * 1024 * 1024,
      });
      const content = await readFile(savePath);

      expect(content.toString('utf8')).toContain('<h1>Trusted content</h1>');
      expect(content.toString('utf8')).not.toContain('poisoned');
      expect(result.data).toEqual({
        path: savePath,
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
        truncated: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes an exact bounded byte prefix and flags truncation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'browserplex-content-'));
    try {
      const session = await sessionManager.create('content-test', 'chromium');
      await session.page.setContent(`<main>${'content '.repeat(100)}</main>`);

      const savePath = join(dir, 'page.html');
      const result = await actions.browserContent({
        session: 'content-test',
        savePath,
        maxBytes: 128,
      });
      const content = await readFile(savePath);

      expect(content.byteLength).toBe(128);
      expect(result.data).toMatchObject({
        path: savePath,
        bytes: 128,
        sha256: createHash('sha256').update(content).digest('hex'),
        truncated: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires an absolute output path', async () => {
    await expect(actions.browserContent({
      session: 'content-test',
      savePath: 'page.html',
    })).rejects.toThrow('savePath must be an absolute path');
  });

  it('enforces the hard byte ceiling before opening a session', async () => {
    await expect(actions.browserContent({
      session: 'content-test',
      savePath: join(tmpdir(), 'page.html'),
      maxBytes: (2 * 1024 * 1024) + 1,
    })).rejects.toThrow('maxBytes must be an integer between 1 and 2097152');
  });
});
