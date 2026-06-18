import { describe, it, expect } from 'vitest';
import { parseProgressLine } from './chat-progress-parser.js';

describe('parseProgressLine', () => {
  it('assistant 메시지의 tool_use 블록에서 도구명을 추출한다', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'mcp__workplace__search_wiki', input: {} }] },
    });
    expect(parseProgressLine(line)).toEqual({ kind: 'tool_use', toolName: 'search_wiki' });
  });

  it('user 메시지의 tool_result 블록을 tool_result 로 분류한다', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
    });
    expect(parseProgressLine(line)).toEqual({ kind: 'tool_result' });
  });

  it('result 라인을 종료 신호로 분류한다', () => {
    expect(parseProgressLine(JSON.stringify({ type: 'result', subtype: 'success' }))).toEqual({
      kind: 'result',
    });
  });

  it('assistant 텍스트 전용/시스템/비JSON 라인은 null', () => {
    expect(parseProgressLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }))).toBeNull();
    expect(parseProgressLine(JSON.stringify({ type: 'system' }))).toBeNull();
    expect(parseProgressLine('not-json')).toBeNull();
  });
});
