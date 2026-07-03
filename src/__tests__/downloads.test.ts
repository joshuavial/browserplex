import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as actions from '../core/actions.js';
import { sessionManager } from '../core/sessions.js';

async function waitForDownloads(session: string, count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await actions.browserDownloads({ session });
    const downloads = result.data as Array<{ id: string }>;
    if (downloads.length >= count) return downloads;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${count} download(s)`);
}

describe('download capture', () => {
  afterEach(async () => {
    await sessionManager.destroyAll();
  });

  it('captures a browser download and saves it to a requested path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'browserplex-download-'));
    try {
      const session = await sessionManager.create('download-test', 'chromium');
      await session.page.setContent(`
        <a id="download" download="hello.txt" href="data:text/plain;charset=utf-8,hello%20from%20browserplex">Download</a>
      `);

      await actions.browserClick({ session: 'download-test', selector: '#download' });
      const downloads = await waitForDownloads('download-test', 1);

      expect(downloads[0]).toMatchObject({
        id: 'd1',
        suggestedFilename: 'hello.txt',
      });

      const savePath = join(dir, 'saved.txt');
      const saved = await actions.browserSaveDownload({ session: 'download-test', savePath });
      expect(saved.text).toContain(savePath);
      expect(await readFile(savePath, 'utf8')).toBe('hello from browserplex');

      const listed = await actions.browserDownloads({ session: 'download-test' });
      expect(listed.data).toEqual([
        expect.objectContaining({ id: 'd1', savedPath: savePath }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires an absolute save path', async () => {
    await expect(actions.browserSaveDownload({ session: 'download-test', savePath: 'relative.txt' })).rejects.toThrow(
      'savePath must be an absolute path',
    );
  });
});
