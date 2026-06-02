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

  it('storage load also accepts --headed', () => {
    const p = parseCommand(['storage', 'load', 's', 'example.com', '--headed']);
    expect(p.spec.tool).toBe('storage_load');
    expect(p.args.headed).toBe(true);
  });
});
