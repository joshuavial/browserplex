import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { sessionManager } from '../core/sessions.js';
import { sessionCreate, browserEvaluate, browserSnapshot } from '../core/actions.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'electron-app');

// _electron.launch opens a REAL window (not headless). Run only where Electron is
// installed AND a display is available (macOS/Windows always; Linux needs xvfb -> DISPLAY).
function canRunElectron(): boolean {
  try {
    require.resolve('electron');
  } catch {
    return false;
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) return false;
  return true;
}

const maybe = canRunElectron() ? describe : describe.skip;

maybe('electron session type', () => {
  const NAME = 'electron-fixture-test';

  afterAll(async () => {
    await sessionManager.destroy(NAME).catch(() => {});
  });

  it('launches a fixture Electron app and drives the renderer', async () => {
    // Go through the sessionCreate ACTION (the path the MCP server + daemon use): this
    // exercises the electronArgs -> launch.args threading, not just sessionManager.
    const created = await sessionCreate({ name: NAME, type: 'electron', electronArgs: [fixtureDir] });
    expect(created.text).toContain("Created electron session");

    // browser_evaluate runs IN THE RENDERER: the window marker is live.
    const evalRes = await browserEvaluate({ session: NAME, script: 'window.__bpTest' });
    expect(evalRes.data).toBe('electron-ok');

    // existing snapshot action works unchanged on the Electron window
    const snap = await browserSnapshot({ session: NAME, interactive: false });
    expect(snap.text).toContain('Electron Fixture Ready');

    // clean teardown via app.close() (the electron branch in destroy())
    await sessionManager.destroy(NAME);
    expect(sessionManager.get(NAME)).toBeUndefined();
  }, 60_000);

  it('honors an explicit executablePath (binary selection is plumbed, not ignored)', async () => {
    // require('electron') in a non-electron context returns the binary path. Passing it as
    // executablePath proves the param flows through to _electron.launch and selects the binary
    // (the real mechanism for driving an external app's own Electron).
    const electronBinary = require('electron') as string;
    expect(typeof electronBinary).toBe('string');
    const NAME2 = 'electron-exec-path-test';
    await sessionCreate({
      name: NAME2,
      type: 'electron',
      electronArgs: [fixtureDir],
      executablePath: electronBinary,
    });
    const evalRes = await browserEvaluate({ session: NAME2, script: 'window.__bpTest' });
    expect(evalRes.data).toBe('electron-ok');
    await sessionManager.destroy(NAME2);
    expect(sessionManager.get(NAME2)).toBeUndefined();
  }, 60_000);

  it('actually forwards executablePath: a bogus path makes launch fail', async () => {
    // Negative proof of forwarding: with a non-existent executablePath the launch MUST fail.
    // If the param were ignored, this would fall back to the default binary and succeed — so a
    // rejection here proves executablePath is genuinely passed through to _electron.launch.
    const NAME3 = 'electron-bad-exec-path';
    await expect(
      sessionCreate({
        name: NAME3,
        type: 'electron',
        electronArgs: [fixtureDir],
        executablePath: '/nonexistent/definitely-not-electron',
      }),
    ).rejects.toThrow();
    // and no leaked session
    expect(sessionManager.get(NAME3)).toBeUndefined();
  }, 60_000);
});
