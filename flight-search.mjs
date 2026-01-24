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

async function toolCall(name, args = {}) {
  const reqId = ++id;
  const resp = await new Promise((resolve) => {
    pending.set(reqId, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
  return resp.result;
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  log('=== Flight Search: Wellington → Singapore → Rome ===\n');

  // Create session
  log('Creating camoufox session...');
  let r = await toolCall('session_create', { name: 'flights', type: 'camoufox' });
  log(r.content[0].text);

  // Navigate to Google Flights
  log('Navigating to Google Flights...');
  r = await toolCall('browser_navigate', { session: 'flights', url: 'https://www.google.com/travel/flights' });
  log(r.content[0].text);

  await sleep(3000);

  // Take initial screenshot
  log('Taking screenshot...');
  r = await toolCall('browser_take_screenshot', { session: 'flights' });
  if (r.content[0].type === 'image') {
    const fs = await import('fs');
    fs.writeFileSync('flight-1-initial.png', Buffer.from(r.content[0].data, 'base64'));
    log('Saved: flight-1-initial.png');
  }

  // Get snapshot to understand page structure
  log('Getting page snapshot...');
  r = await toolCall('browser_snapshot', { session: 'flights' });
  console.log('\nPage structure:\n' + r.content[0].text.substring(0, 1500) + '\n');

  // Click on "Round trip" to change to multi-city
  log('Looking for trip type selector...');
  r = await toolCall('browser_click', { session: 'flights', selector: 'text=Round trip', timeout: 10000 });
  log(r.content[0].text);
  await sleep(1000);

  // Select Multi-city
  log('Selecting Multi-city...');
  r = await toolCall('browser_click', { session: 'flights', selector: 'text=Multi-city', timeout: 5000 });
  log(r.content[0].text);
  await sleep(2000);

  // Screenshot after multi-city
  r = await toolCall('browser_take_screenshot', { session: 'flights' });
  if (r.content[0].type === 'image') {
    const fs = await import('fs');
    fs.writeFileSync('flight-2-multicity.png', Buffer.from(r.content[0].data, 'base64'));
    log('Saved: flight-2-multicity.png');
  }

  // Get updated snapshot
  r = await toolCall('browser_snapshot', { session: 'flights' });
  console.log('\nMulti-city form:\n' + r.content[0].text.substring(0, 2000) + '\n');

  // Fill in first leg: Wellington to Singapore
  log('Filling first leg: Wellington → Singapore...');

  // Click first "Where from?"
  r = await toolCall('browser_click', { session: 'flights', selector: '[placeholder="Where from?"]', timeout: 5000 });
  log('Clicked origin: ' + r.content[0].text);
  await sleep(500);

  r = await toolCall('browser_type', { session: 'flights', selector: '[placeholder="Where from?"]', text: 'Wellington' });
  log('Typed Wellington: ' + r.content[0].text);
  await sleep(1500);

  // Select from dropdown
  r = await toolCall('browser_click', { session: 'flights', selector: 'text=Wellington, New Zealand', timeout: 5000 });
  log('Selected Wellington: ' + r.content[0].text);
  await sleep(1000);

  // Fill destination
  r = await toolCall('browser_click', { session: 'flights', selector: '[placeholder="Where to?"]', timeout: 5000 });
  log('Clicked destination: ' + r.content[0].text);
  await sleep(500);

  r = await toolCall('browser_type', { session: 'flights', selector: '[placeholder="Where to?"]', text: 'Singapore' });
  log('Typed Singapore: ' + r.content[0].text);
  await sleep(1500);

  r = await toolCall('browser_click', { session: 'flights', selector: 'text=Singapore', timeout: 5000 });
  log('Selected Singapore: ' + r.content[0].text);
  await sleep(1000);

  // Screenshot progress
  r = await toolCall('browser_take_screenshot', { session: 'flights' });
  if (r.content[0].type === 'image') {
    const fs = await import('fs');
    fs.writeFileSync('flight-3-leg1.png', Buffer.from(r.content[0].data, 'base64'));
    log('Saved: flight-3-leg1.png');
  }

  log('\n✓ Browser is running. Check the screenshots and browser window.');
  log('Session "flights" is active - you can continue interacting.');
  log('Press Ctrl+C to close.\n');

  // Keep alive
  await new Promise(() => {});
}

process.on('SIGINT', () => {
  console.log('\nClosing...');
  server.kill();
  process.exit(0);
});

run().catch(e => {
  console.error('Error:', e);
  server.kill();
  process.exit(1);
});
