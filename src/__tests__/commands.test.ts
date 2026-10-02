import { describe, it, expect } from 'vitest';
import { parseCommand } from '../cli/commands.js';

describe('parseCommand: headless/headed flags (gh #1)', () => {
  it('session create has no headed/headless by default (action defaults to headless)', () => {
    const p = parseCommand(['session', 'create', 'x']);
    expect(p.spec.tool).toBe('session_create');
    expect(p.args.headed).toBeUndefined();
    expect(p.args.headless).toBeUndefined();
  });

  it('--headed sets headed:true for any browser type', () => {
    const p = parseCommand(['session', 'create', 'x', '-b', 'firefox', '--headed']);
    expect(p.args.type).toBe('firefox');
    expect(p.args.headed).toBe(true);
  });

  it('--headless still works as an explicit opt-in', () => {
    const p = parseCommand(['session', 'create', 'x', '--headless']);
    expect(p.args.headless).toBe(true);
  });

  it('parses repeatable chromium launch arguments', () => {
    const p = parseCommand([
      'session',
      'create',
      'dictation',
      '--browser',
      'chromium',
      '--browser-arg',
      '--use-fake-device-for-media-stream',
      '--browser-arg',
      '--use-file-for-fake-audio-capture=/tmp/voice.wav',
    ]);
    expect(p.args.browserArgs).toEqual([
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=/tmp/voice.wav',
    ]);
  });

  it('storage load also accepts --headed', () => {
    const p = parseCommand(['storage', 'load', 's', 'example.com', '--headed']);
    expect(p.spec.tool).toBe('storage_load');
    expect(p.args.headed).toBe(true);
  });

  it('parses tauri launch options for session create', () => {
    const p = parseCommand([
      'session',
      'create',
      'concierge',
      '--browser',
      'tauri',
      '--command',
      'pnpm',
      '--arg',
      'tauri',
      '--arg',
      'dev',
      '--cwd',
      '/tmp/concierge',
      '--env',
      'EXTRA=1',
      '--window-title',
      'Xenota Concierge',
      '--window-owner',
      'xenota-concierge',
      '--startup-timeout',
      '1000',
    ]);
    expect(p.spec.tool).toBe('session_create');
    expect(p.args).toMatchObject({
      name: 'concierge',
      type: 'tauri',
      command: 'pnpm',
      args: ['tauri', 'dev'],
      cwd: '/tmp/concierge',
      env: { EXTRA: '1' },
      windowTitle: 'Xenota Concierge',
      windowOwner: 'xenota-concierge',
      startupTimeoutMs: 1000,
    });
  });

  it('parses download list and save commands', () => {
    const list = parseCommand(['download', 'list', '--clear', '--session', 's']);
    expect(list.spec.tool).toBe('browser_downloads');
    expect(list.args).toMatchObject({ session: 's', clear: true });

    const save = parseCommand(['download', 'save', 'out.txt', '--id', 'd2', '--session', 's']);
    expect(save.spec.tool).toBe('browser_save_download');
    expect(save.args.id).toBe('d2');
    expect(save.args.session).toBe('s');
    expect(String(save.args.savePath)).toMatch(/out\.txt$/);
    expect(String(save.args.savePath).startsWith('/')).toBe(true);
  });

  it('parses capped page content output', () => {
    const parsed = parseCommand([
      'content',
      '--output',
      'page.html',
      '--max-bytes',
      '1024',
      '--session',
      's',
    ]);
    expect(parsed.spec.tool).toBe('browser_content');
    expect(parsed.args.session).toBe('s');
    expect(parsed.args.maxBytes).toBe(1024);
    expect(String(parsed.args.savePath)).toMatch(/page\.html$/);
    expect(String(parsed.args.savePath).startsWith('/')).toBe(true);
  });

  it('requires an output file for page content', () => {
    expect(() => parseCommand(['content', '--session', 's'])).toThrow(
      'content needs --output <path>',
    );
  });
});
