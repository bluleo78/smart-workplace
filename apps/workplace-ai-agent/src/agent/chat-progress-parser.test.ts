import { describe, it, expect } from 'vitest';
import { fromRunnerEvent } from './chat-progress-parser.js';
import type { RunnerEvent } from './runner-events.js';

describe('fromRunnerEvent', () => {
  it('tool_use 이벤트에서 도구명을 추출한다(mcp 프리픽스 제거)', () => {
    const e: RunnerEvent = { type: 'tool_use', name: 'mcp__workplace__search_wiki', input: {}, parentToolUseId: null };
    expect(fromRunnerEvent(e)).toEqual({ kind: 'tool_use', toolName: 'search_wiki' });
  });

  it('프리픽스 없는 도구명은 그대로 유지', () => {
    const e: RunnerEvent = { type: 'tool_use', name: 'Agent', input: {}, parentToolUseId: null };
    expect(fromRunnerEvent(e)).toEqual({ kind: 'tool_use', toolName: 'Agent' });
  });

  it('tool_done 이벤트를 tool_result 로 분류한다', () => {
    expect(fromRunnerEvent({ type: 'tool_done' })).toEqual({ kind: 'tool_result' });
  });

  it('result 이벤트를 종료 신호로 분류한다', () => {
    expect(fromRunnerEvent({ type: 'result', ok: true, text: null, usage: null })).toEqual({ kind: 'result' });
  });

  it('text_delta·assistant_text 는 null', () => {
    expect(fromRunnerEvent({ type: 'text_delta', text: 'hi', parentToolUseId: null })).toBeNull();
    expect(fromRunnerEvent({ type: 'assistant_text', text: 'hi' })).toBeNull();
  });
});
