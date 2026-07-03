import { describe, it, expect } from 'vitest';
import { extractTextDelta } from './wiki-delta-parser.js';
import type { RunnerEvent } from './runner-events.js';

describe('extractTextDelta (RunnerEvent)', () => {
  it('text_delta 이벤트의 text 를 추출', () => {
    const e: RunnerEvent = { type: 'text_delta', text: 'hello', parentToolUseId: null };
    expect(extractTextDelta(e)).toBe('hello');
  });

  it('parent 가 설정된(서브에이전트) text_delta 도 그대로 추출 — wiki/drive 는 parent 무시', () => {
    const e: RunnerEvent = { type: 'text_delta', text: 'sub', parentToolUseId: 'tu_1' };
    expect(extractTextDelta(e)).toBe('sub');
  });

  it('result·assistant_text·tool_use·tool_done 는 무시(null)', () => {
    // thinking/추론 델타는 애초에 RunnerEvent 로 매핑되지 않으므로 여기 텍스트로 흘러들 여지가 없다.
    expect(extractTextDelta({ type: 'result', ok: true, text: 'x', usage: null })).toBeNull();
    expect(extractTextDelta({ type: 'assistant_text', text: 'x' })).toBeNull();
    expect(extractTextDelta({ type: 'tool_use', name: 'show_x', input: {}, parentToolUseId: null })).toBeNull();
    expect(extractTextDelta({ type: 'tool_done' })).toBeNull();
  });
});
