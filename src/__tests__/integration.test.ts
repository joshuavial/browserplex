import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '../../dist/index.js');

describe('MCP Server Integration', () => {
  let server: ChildProcess;
  let rl: Interface;
  let requestId = 0;
  const pending = new Map<number, (response: any) => void>();

  async function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++requestId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + '\n');
    });
  }

  async function toolCall(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const resp = await call('tools/call', { name, arguments: args });
    return resp.result;
  }

  function getTextContent(result: any): string {
    return result.content[0].text;
  }

  beforeAll(async () => {
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    rl = createInterface({ input: server.stdout! });

    rl.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        const resolve = pending.get(response.id);
        if (resolve) {
          pending.delete(response.id);
          resolve(response);
        }
      } catch { /* ignore non-JSON lines */ }
    });

    // Wait for server to be ready by listing tools
    await call('tools/list');
  });

  afterAll(async () => {
    // Clean up any sessions
    try {
      await toolCall('session_destroy', { name: 'integration-test' });
    } catch { /* ignore */ }

    server.kill('SIGTERM');
    rl.close();
  });

  describe('Session Lifecycle', () => {
    it('lists no sessions initially', async () => {
      const result = await toolCall('session_list');

      expect(getTextContent(result)).toBe('No active sessions');
    });

    it('creates a new session', async () => {
      const result = await toolCall('session_create', {
        name: 'integration-test',
        type: 'chromium',
      });

      expect(getTextContent(result)).toBe("Created chromium session 'integration-test'");
    });

    it('lists the created session', async () => {
      const result = await toolCall('session_list');
      const text = getTextContent(result);

      expect(text).toContain('integration-test');
      expect(text).toContain('chromium');
    });

    it('fails to create duplicate session', async () => {
      const result = await toolCall('session_create', {
        name: 'integration-test',
        type: 'chromium',
      });

      expect(getTextContent(result)).toContain("already exists");
      expect(result.isError).toBe(true);
    });
  });

  describe('Navigation', () => {
    it('navigates to a URL', async () => {
      const result = await toolCall('browser_navigate', {
        session: 'integration-test',
        url: 'https://example.com',
      });

      expect(getTextContent(result)).toBe('Navigated to https://example.com');
    });

    it('returns snapshot of page content', async () => {
      const result = await toolCall('browser_snapshot', {
        session: 'integration-test',
      });
      const text = getTextContent(result);

      expect(text).toContain('Title: Example Domain');
      expect(text).toContain('URL: https://example.com');
      expect(text).toContain('Example Domain');
    });

    it('fails to navigate nonexistent session', async () => {
      const result = await toolCall('browser_navigate', {
        session: 'nonexistent',
        url: 'https://example.com',
      });

      expect(getTextContent(result)).toContain("not found");
      expect(result.isError).toBe(true);
    });
  });

  describe('Screenshot', () => {
    it('takes a screenshot', async () => {
      const result = await toolCall('browser_take_screenshot', {
        session: 'integration-test',
      });

      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(result.content[0].data.length).toBeGreaterThan(1000);
    });

    it('takes a full page screenshot', async () => {
      const result = await toolCall('browser_take_screenshot', {
        session: 'integration-test',
        fullPage: true,
      });

      expect(result.content[0].type).toBe('image');
      expect(result.content[0].data.length).toBeGreaterThan(1000);
    });
  });

  describe('JavaScript Evaluation', () => {
    it('evaluates JavaScript and returns result', async () => {
      const result = await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: 'document.title',
      });

      expect(getTextContent(result)).toBe('"Example Domain"');
    });

    it('evaluates complex expressions', async () => {
      const result = await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: '({ url: window.location.href, title: document.title })',
      });
      const parsed = JSON.parse(getTextContent(result));

      expect(parsed.url).toBe('https://example.com/');
      expect(parsed.title).toBe('Example Domain');
    });
  });

  describe('Keyboard Input', () => {
    it('presses a key', async () => {
      const result = await toolCall('browser_press_key', {
        session: 'integration-test',
        key: 'Tab',
      });

      expect(getTextContent(result)).toBe("Pressed 'Tab'");
    });
  });

  describe('Wait For', () => {
    it('waits for page load', async () => {
      const result = await toolCall('browser_wait_for', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toBe('Page load complete');
    });

    it('waits for element', async () => {
      const result = await toolCall('browser_wait_for', {
        session: 'integration-test',
        selector: 'h1',
        state: 'visible',
      });

      expect(getTextContent(result)).toBe("Element 'h1' is visible");
    });

    it('times out for nonexistent element', async () => {
      const result = await toolCall('browser_wait_for', {
        session: 'integration-test',
        selector: '#nonexistent-element-xyz',
        timeout: 1000,
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Click and Hover', () => {
    it('hovers over an element', async () => {
      const result = await toolCall('browser_hover', {
        session: 'integration-test',
        selector: 'a',
      });

      expect(getTextContent(result)).toBe("Hovering over 'a'");
    });

    it('clicks an element', async () => {
      // Navigate to example.com which has a clickable link
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: 'https://example.com',
      });

      const result = await toolCall('browser_click', {
        session: 'integration-test',
        selector: 'a',
      });

      expect(getTextContent(result)).toBe("Clicked 'a'");
    });

    it('fails to click nonexistent element', async () => {
      const result = await toolCall('browser_click', {
        session: 'integration-test',
        selector: '#nonexistent-button',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Type Text', () => {
    it('navigates to a page with input', async () => {
      // Navigate to a page with a search input for testing
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: 'https://www.google.com',
      });

      // Wait for page to load
      await toolCall('browser_wait_for', { session: 'integration-test' });
    });

    it('types into an input field', async () => {
      // Try to type into Google's search box
      const result = await toolCall('browser_type', {
        session: 'integration-test',
        selector: 'textarea[name="q"], input[name="q"]',
        text: 'browserplex test',
      });

      expect(getTextContent(result)).toContain("Typed into");
    });
  });

  describe('Session Cleanup', () => {
    it('destroys the session', async () => {
      const result = await toolCall('session_destroy', {
        name: 'integration-test',
      });

      expect(getTextContent(result)).toBe("Destroyed session 'integration-test'");
    });

    it('lists no sessions after cleanup', async () => {
      const result = await toolCall('session_list');

      expect(getTextContent(result)).toBe('No active sessions');
    });

    it('fails to destroy nonexistent session', async () => {
      const result = await toolCall('session_destroy', {
        name: 'integration-test',
      });

      expect(getTextContent(result)).toContain("not found");
      expect(result.isError).toBe(true);
    });
  });
});
