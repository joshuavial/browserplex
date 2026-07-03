import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(__dirname, '..', 'mcp', 'server.ts'), 'utf8');

describe('MCP session_create schema', () => {
  it('exposes tauri launch options', () => {
    expect(serverSource).toContain('"tauri"');
    expect(serverSource).toContain('appPath: z.string().optional()');
    expect(serverSource).toContain('command: z.string().optional()');
    expect(serverSource).toContain('args: z.array(z.string()).optional()');
    expect(serverSource).toContain('windowTitle: z.string().optional()');
    expect(serverSource).toContain('windowOwner: z.string().optional()');
    expect(serverSource).toContain('startupTimeoutMs: z.number().optional()');
  });
});

describe('MCP download schema', () => {
  it('exposes download list and save tools', () => {
    expect(serverSource).toContain('"browser_downloads"');
    expect(serverSource).toContain('clear: z.boolean().default(false)');
    expect(serverSource).toContain('"browser_save_download"');
    expect(serverSource).toContain('id: z.string().optional()');
    expect(serverSource).toContain('savePath: z.string()');
  });
});
