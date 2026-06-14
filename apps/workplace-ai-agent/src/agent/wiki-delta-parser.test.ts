import { describe, it, expect } from 'vitest';
import { extractTextDelta } from './wiki-delta-parser.js';

describe('extractTextDelta (실측 stream-json 모양)', () => {
  it('text_delta 만 추출', () => {
    const line = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello' } },
    };
    expect(extractTextDelta(line)).toBe('hello');
  });

  it('thinking_delta 는 무시(null)', () => {
    const line = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning' } },
    };
    expect(extractTextDelta(line)).toBeNull();
  });

  it('signature_delta·result·기타 무시', () => {
    expect(extractTextDelta({ type: 'result', subtype: 'success', result: 'x' })).toBeNull();
    expect(
      extractTextDelta({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta' } },
      }),
    ).toBeNull();
    expect(extractTextDelta({ type: 'system' })).toBeNull();
  });
});
