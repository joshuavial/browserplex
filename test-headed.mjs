#!/usr/bin/env node
// Direct test without MCP - just launch camoufox headed
import { Camoufox } from 'camoufox-js';

console.log('Launching Camoufox (headed)...');

const browser = await Camoufox({ headless: false });
console.log('Browser launched');

const context = await browser.newContext();
const page = await context.newPage();
console.log('Page created');

await page.goto('https://www.google.com/flights');
console.log('Navigated to Google Flights');
console.log('URL:', page.url());

console.log('\nBrowser is open. Press Ctrl+C to close.');

// Keep alive
await new Promise(() => {});
