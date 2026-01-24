#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const COMMAND_FILE = '/tmp/browserplex-cmd.json';
const RESULT_FILE = '/tmp/browserplex-result.json';

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

// Poll for commands
async function commandLoop() {
  while (true) {
    if (existsSync(COMMAND_FILE)) {
      try {
        const cmd = JSON.parse(readFileSync(COMMAND_FILE, 'utf8'));
        writeFileSync(COMMAND_FILE + '.processing', '');
        require('fs').unlinkSync(COMMAND_FILE);

        console.log(`Executing: ${cmd.tool}`, cmd.args);
        const result = await toolCall(cmd.tool, cmd.args);
        writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
        console.log('Result written to', RESULT_FILE);

        require('fs').unlinkSync(COMMAND_FILE + '.processing');
      } catch (e) {
        writeFileSync(RESULT_FILE, JSON.stringify({ error: e.message }));
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

console.log('MCP Driver started. Listening for commands at', COMMAND_FILE);
console.log('Results will be written to', RESULT_FILE);

// Start command loop
commandLoop();
