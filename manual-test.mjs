#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const rl = createInterface({ input: server.stdout });

let id = 0;
const pending = new Map();

rl.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) {
      pending.delete(response.id);
      resolve(response);
    }
  } catch {}
});

async function call(method, params = {}) {
  const reqId = ++id;
  return new Promise((resolve) => {
    pending.set(reqId, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + '\n');
  });
}

async function toolCall(name, args = {}) {
  const resp = await call('tools/call', { name, arguments: args });
  return resp.result;
}

async function run() {
  console.log('=== Browserplex: Camoufox Headed Mode ===\n');

  // Create camoufox session (headed by default)
  console.log('Creating camoufox session...');
  let result = await toolCall('session_create', { name: 'interactive', type: 'camoufox' });
  console.log('→', result.content[0].text);

  // Navigate to Google Flights
  console.log('\nNavigating to Google Flights...');
  result = await toolCall('browser_navigate', { session: 'interactive', url: 'https://www.google.com/flights' });
  console.log('→', result.content[0].text);

  console.log('\n✓ Firefox browser is open!');
  console.log('  You can interact with the page manually.');
  console.log('  Press Ctrl+C to close the browser and exit.\n');

  // Keep the process alive
  await new Promise(() => {});
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n\nClosing session...');
  server.kill('SIGTERM');
  process.exit(0);
});

run().catch((err) => {
  console.error('Error:', err);
  server.kill('SIGTERM');
  process.exit(1);
});
