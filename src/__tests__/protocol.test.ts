import { describe, it, expect } from 'vitest';
import { LineDecoder, encodeMessage, MAX_LINE_BYTES } from '../daemon/protocol.js';

describe('protocol: encodeMessage', () => {
  it('serializes one newline-terminated JSON line', () => {
    const s = encodeMessage({ id: 1, ok: true, text: 'hi' });
    expect(s.endsWith('\n')).toBe(true);
    expect(JSON.parse(s.trim())).toEqual({ id: 1, ok: true, text: 'hi' });
  });
});

describe('protocol: LineDecoder', () => {
  it('decodes one message per line', () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it('decodes multiple messages in one chunk', () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('reassembles a message split across chunks', () => {
    const d = new LineDecoder();
    expect(d.push('{"a":')).toEqual([]);
    expect(d.push('1}\n')).toEqual(['{"a":1}']);
  });

  it('skips empty lines', () => {
    const d = new LineDecoder();
    expect(d.push('\n\n{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('preserves a multi-byte UTF-8 char split across chunk boundaries', () => {
    const d = new LineDecoder();
    // '🚀' is 4 UTF-8 bytes (F0 9F 9A 80); split it across two Buffer chunks.
    const full = Buffer.from('{"x":"🚀"}\n', 'utf8');
    const cut = 7; // somewhere inside the emoji's byte sequence
    const out = [...d.push(full.subarray(0, cut)), ...d.push(full.subarray(cut))];
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ x: '🚀' });
  });

  it('round-trips encodeMessage output', () => {
    const d = new LineDecoder();
    const msg = { id: 7, tool: 'browser_navigate', args: { url: 'https://x.com' } };
    expect(JSON.parse(d.push(encodeMessage(msg))[0])).toEqual(msg);
  });

  it('throws when a single line exceeds MAX_LINE_BYTES', () => {
    const d = new LineDecoder();
    const huge = 'x'.repeat(MAX_LINE_BYTES + 1);
    expect(() => d.push(huge + '\n')).toThrow(/exceeds/);
  });

  it('throws when the unterminated buffer exceeds MAX_LINE_BYTES', () => {
    const d = new LineDecoder();
    expect(() => d.push('y'.repeat(MAX_LINE_BYTES + 1))).toThrow(/exceeds/);
  });
});
