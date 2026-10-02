import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInterface, type Interface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '../../dist/mcp/server.js');

describe('MCP Server Integration', () => {
  let server: ChildProcess;
  let fixtureServer: Server;
  let fixtureBaseUrl: string;
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
    fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Browserplex Fixture</title>
            <style>body { font: 18px sans-serif; padding: 4rem; } main { max-width: 40rem; }</style>
          </head>
          <body>
            <main>
              <h1>Browserplex Fixture</h1>
              <p>Deterministic local content for browser integration tests.</p>
              <a href="/linked">Fixture link</a>
              <textarea name="q" aria-label="Search"></textarea>
            </main>
          </body>
        </html>`);
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
    const address = fixtureServer.address() as AddressInfo;
    fixtureBaseUrl = `http://127.0.0.1:${address.port}`;

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
    await new Promise<void>((resolve, reject) => {
      fixtureServer.close((error) => error ? reject(error) : resolve());
    });
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
        url: fixtureBaseUrl,
      });

      expect(getTextContent(result)).toBe(`Navigated to ${fixtureBaseUrl}`);
    });

    it('returns snapshot of page content', async () => {
      const result = await toolCall('browser_snapshot', {
        session: 'integration-test',
      });
      const text = getTextContent(result);

      // ARIA snapshot format
      expect(text).toContain('Page: Browserplex Fixture');
      expect(text).toContain(`URL: ${fixtureBaseUrl}`);
      expect(text).toContain('heading "Browserplex Fixture"');
      expect(text).toContain('[ref=');  // Should have refs
    });

    it('fails to navigate nonexistent session', async () => {
      const result = await toolCall('browser_navigate', {
        session: 'nonexistent',
        url: fixtureBaseUrl,
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

    it('saves the screenshot to disk when savePath is provided', async () => {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browserplex-shot-'));
      const savePath = path.join(dir, 'shot.png');

      const result = await toolCall('browser_take_screenshot', {
        session: 'integration-test',
        savePath,
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain(savePath);
      expect(result.content[1].type).toBe('image');

      const buf = await fs.readFile(savePath);
      expect(buf.length).toBeGreaterThan(1000);
      // PNG magic number: 89 50 4E 47
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('rejects relative savePath', async () => {
      const result = await toolCall('browser_take_screenshot', {
        session: 'integration-test',
        savePath: 'relative/path.png',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('absolute');
    });
  });

  describe('JavaScript Evaluation', () => {
    it('evaluates JavaScript and returns result', async () => {
      const result = await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: 'document.title',
      });

      expect(getTextContent(result)).toBe('"Browserplex Fixture"');
    });

    it('evaluates complex expressions', async () => {
      const result = await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: '({ url: window.location.href, title: document.title })',
      });
      const parsed = JSON.parse(getTextContent(result));

      expect(parsed.url).toBe(`${fixtureBaseUrl}/`);
      expect(parsed.title).toBe('Browserplex Fixture');
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
      // Navigate to the fixture page, which has a clickable link.
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: fixtureBaseUrl,
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
      // Navigate to the fixture page with a search input.
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: fixtureBaseUrl,
      });

      // Wait for page to load
      await toolCall('browser_wait_for', { session: 'integration-test' });
    });

    it('types into an input field', async () => {
      const result = await toolCall('browser_type', {
        session: 'integration-test',
        selector: 'textarea[name="q"]',
        text: 'browserplex test',
      });

      expect(getTextContent(result)).toContain("Typed into");
    });
  });

  describe('Navigate Back', () => {
    it('navigates back in history', async () => {
      // First navigate to one fixture route.
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: `${fixtureBaseUrl}/history-a`,
      });

      // Then navigate to another fixture route.
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: `${fixtureBaseUrl}/history-b`,
      });

      // Now go back
      const result = await toolCall('browser_navigate_back', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toContain('Navigated back');
    });
  });

  describe('Resize', () => {
    it('resizes the viewport', async () => {
      const result = await toolCall('browser_resize', {
        session: 'integration-test',
        width: 1024,
        height: 768,
      });

      expect(getTextContent(result)).toBe('Resized viewport to 1024x768');
    });
  });

  describe('Console Messages', () => {
    it('captures console messages', async () => {
      // Execute some JS that logs to console
      await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: 'console.log("test message from browserplex")',
      });

      const result = await toolCall('browser_console_messages', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toContain('test message from browserplex');
    });

    it('clears console messages when requested', async () => {
      await toolCall('browser_console_messages', {
        session: 'integration-test',
        clear: true,
      });

      const result = await toolCall('browser_console_messages', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toBe('No console messages');
    });
  });

  describe('Network Requests', () => {
    it('captures network requests', async () => {
      // Navigate to trigger network requests
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: `${fixtureBaseUrl}/network`,
      });

      const result = await toolCall('browser_network_requests', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toContain(fixtureBaseUrl);
      expect(getTextContent(result)).toContain('GET');
    });

    it('clears network requests when requested', async () => {
      await toolCall('browser_network_requests', {
        session: 'integration-test',
        clear: true,
      });

      const result = await toolCall('browser_network_requests', {
        session: 'integration-test',
      });

      expect(getTextContent(result)).toBe('No network requests');
    });
  });

  describe('Tabs', () => {
    it('lists tabs', async () => {
      const result = await toolCall('browser_tabs', {
        session: 'integration-test',
        action: 'list',
      });

      expect(getTextContent(result)).toContain('Tabs (1)');
    });

    it('creates a new tab', async () => {
      const result = await toolCall('browser_tabs', {
        session: 'integration-test',
        action: 'new',
        url: `${fixtureBaseUrl}/tab`,
      });

      expect(getTextContent(result)).toContain('Created new tab');
    });

    it('lists multiple tabs', async () => {
      const result = await toolCall('browser_tabs', {
        session: 'integration-test',
        action: 'list',
      });

      expect(getTextContent(result)).toContain('Tabs (2)');
    });

    it('switches tabs', async () => {
      const result = await toolCall('browser_tabs', {
        session: 'integration-test',
        action: 'switch',
        index: 0,
      });

      expect(getTextContent(result)).toContain('Switched to tab 0');
    });

    it('closes a tab', async () => {
      const result = await toolCall('browser_tabs', {
        session: 'integration-test',
        action: 'close',
        index: 1,
      });

      expect(getTextContent(result)).toBe('Closed tab 1');
    });
  });

  describe('Select Option', () => {
    it('selects an option by index', async () => {
      // Navigate to a page and inject a select element
      await toolCall('browser_navigate', {
        session: 'integration-test',
        url: fixtureBaseUrl,
      });

      await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: `
          const select = document.createElement('select');
          select.id = 'test-select';
          select.innerHTML = '<option value="a">Option A</option><option value="b">Option B</option>';
          document.body.appendChild(select);
        `,
      });

      const result = await toolCall('browser_select_option', {
        session: 'integration-test',
        selector: '#test-select',
        index: 1,
      });

      expect(getTextContent(result)).toContain('Selected option');
    });

    it('selects an option by value', async () => {
      const result = await toolCall('browser_select_option', {
        session: 'integration-test',
        selector: '#test-select',
        value: 'a',
      });

      expect(getTextContent(result)).toContain('Selected option');
    });
  });

  describe('Fill Form', () => {
    it('fills multiple form fields', async () => {
      // Inject form fields
      await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: `
          const form = document.createElement('form');
          form.innerHTML = '<input id="field1" type="text"><input id="field2" type="text">';
          document.body.appendChild(form);
        `,
      });

      const result = await toolCall('browser_fill_form', {
        session: 'integration-test',
        fields: [
          { selector: '#field1', value: 'value1' },
          { selector: '#field2', value: 'value2' },
        ],
      });

      expect(getTextContent(result)).toBe('Filled 2 form field(s)');
    });
  });

  describe('File Upload', () => {
    it('handles file upload selector', async () => {
      // Inject file input
      await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: `
          const input = document.createElement('input');
          input.type = 'file';
          input.id = 'file-input';
          document.body.appendChild(input);
        `,
      });

      // Note: We can't actually upload a file in tests without a real file path
      // but we can test the error handling
      const result = await toolCall('browser_file_upload', {
        session: 'integration-test',
        selector: '#file-input',
        files: ['/nonexistent/file.txt'],
      });

      // Should error because file doesn't exist
      expect(result.isError).toBe(true);
    });
  });

  describe('Drag and Drop', () => {
    it('attempts drag and drop', async () => {
      // Inject draggable elements
      await toolCall('browser_evaluate', {
        session: 'integration-test',
        script: `
          const source = document.createElement('div');
          source.id = 'drag-source';
          source.draggable = true;
          source.textContent = 'Drag me';
          const target = document.createElement('div');
          target.id = 'drag-target';
          target.textContent = 'Drop here';
          document.body.appendChild(source);
          document.body.appendChild(target);
        `,
      });

      const result = await toolCall('browser_drag', {
        session: 'integration-test',
        sourceSelector: '#drag-source',
        targetSelector: '#drag-target',
      });

      expect(getTextContent(result)).toContain('Dragged');
    });
  });

  describe('Handle Dialog', () => {
    it('sets up dialog handler', async () => {
      const result = await toolCall('browser_handle_dialog', {
        session: 'integration-test',
        action: 'accept',
      });

      expect(getTextContent(result)).toBe('Dialog handler set to accept');
    });

    it('sets up dialog handler with prompt text', async () => {
      const result = await toolCall('browser_handle_dialog', {
        session: 'integration-test',
        action: 'accept',
        promptText: 'test input',
      });

      expect(getTextContent(result)).toBe("Dialog handler set to accept with text 'test input'");
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
