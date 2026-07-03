import { describe, it, expect } from 'vitest';
import { mapSdkMessage, finalText, finalUsage, type RunnerEvent } from './runner-events.js';

describe('mapSdkMessage', () => {
  it('stream_event text_delta → text_delta(parent 보존, null)', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안' } },
    });
    expect(ev).toEqual([{ type: 'text_delta', text: '안', parentToolUseId: null }]);
  });

  it('stream_event text_delta → parent_tool_use_id 값 보존(서브에이전트)', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: 'tu_sub',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '녕' } },
    });
    expect(ev).toEqual([{ type: 'text_delta', text: '녕', parentToolUseId: 'tu_sub' }]);
  });

  it('stream_event thinking_delta 등 비-text_delta 는 빈 배열', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', text: '생각' } },
    });
    expect(ev).toEqual([]);
  });

  it('assistant tool_use+text 2블록 → tool_use + assistant_text 이벤트 2개(name/input 보존)', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'mcp__workplace__show_issue_list',
            input: { params: { assignee: 'me' } },
          },
          { type: 'text', text: '이슈 목록을 보여드려요.' },
        ],
      },
    });
    expect(ev).toEqual<RunnerEvent[]>([
      {
        type: 'tool_use',
        name: 'mcp__workplace__show_issue_list',
        input: { params: { assignee: 'me' } },
        parentToolUseId: null,
      },
      { type: 'assistant_text', text: '이슈 목록을 보여드려요.' },
    ]);
  });

  it('assistant tool_use → parent_tool_use_id 값 보존(서브에이전트 자신의 도구 호출)', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      parent_tool_use_id: 'tu_parent',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_sub_1',
            name: 'mcp__workplace__list_issues',
            input: { params: {} },
          },
        ],
      },
    });
    expect(ev).toEqual<RunnerEvent[]>([
      {
        type: 'tool_use',
        name: 'mcp__workplace__list_issues',
        input: { params: {} },
        parentToolUseId: 'tu_parent',
      },
    ]);
  });

  it('assistant 빈 text 블록은 건너뛴다', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '   ' }] },
    });
    expect(ev).toEqual([]);
  });

  it('user tool_result → tool_done', () => {
    const ev = mapSdkMessage({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'ok' }] }] },
    });
    expect(ev).toEqual([{ type: 'tool_done' }]);
  });

  it('user 메시지에 tool_result 없으면 빈 배열', () => {
    const ev = mapSdkMessage({
      type: 'user',
      message: { content: [{ type: 'text', text: '무시' }] },
    });
    expect(ev).toEqual([]);
  });

  it('result success → result{ok:true,text,usage}(snake_case)', () => {
    const ev = mapSdkMessage({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '완료',
      usage: { input_tokens: 1234, output_tokens: 56 },
    });
    expect(ev).toEqual([
      { type: 'result', ok: true, text: '완료', usage: { inputTokens: 1234, outputTokens: 56 } },
    ]);
  });

  it('result success → usage camelCase 변형도 허용', () => {
    const ev = mapSdkMessage({
      type: 'result',
      subtype: 'success',
      result: '완료',
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(ev).toEqual([{ type: 'result', ok: true, text: '완료', usage: { inputTokens: 10, outputTokens: 20 } }]);
  });

  it('result: usage 누락/형식 불명이면 null', () => {
    const ev1 = mapSdkMessage({ type: 'result', subtype: 'success', result: '완료' });
    expect((ev1[0] as { usage: unknown }).usage).toBeNull();
    const ev2 = mapSdkMessage({ type: 'result', subtype: 'success', result: '완료', usage: { foo: 'bar' } });
    expect((ev2[0] as { usage: unknown }).usage).toBeNull();
  });

  it('result: subtype 이 success 아니면 ok:false', () => {
    const ev = mapSdkMessage({ type: 'result', subtype: 'error_max_turns', result: null });
    expect(ev).toEqual([{ type: 'result', ok: false, text: null, usage: null }]);
  });

  it('알 수 없는 타입/비객체는 빈 배열', () => {
    expect(mapSdkMessage(null)).toEqual([]);
    expect(mapSdkMessage('str')).toEqual([]);
    expect(mapSdkMessage({ type: 'system', subtype: 'init' })).toEqual([]);
  });
});

describe('finalText', () => {
  it('result 텍스트 우선', () => {
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: '중간 텍스트' },
      { type: 'result', ok: true, text: '최종 결과', usage: null },
    ];
    expect(finalText(events)).toBe('최종 결과');
  });

  it('result 없으면 assistant_text join+trim', () => {
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: '첫줄' },
      { type: 'assistant_text', text: '둘째줄' },
    ];
    expect(finalText(events)).toBe('첫줄\n둘째줄');
  });

  it('result.text 가 null 이면 assistant_text 로 폴백', () => {
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: '폴백 텍스트' },
      { type: 'result', ok: false, text: null, usage: null },
    ];
    expect(finalText(events)).toBe('폴백 텍스트');
  });

  it('아무 텍스트 없으면 빈 문자열', () => {
    expect(finalText([])).toBe('');
  });
});

describe('finalUsage', () => {
  it('result 이벤트의 usage 반환', () => {
    const events: RunnerEvent[] = [
      { type: 'result', ok: true, text: '완료', usage: { inputTokens: 1, outputTokens: 2 } },
    ];
    expect(finalUsage(events)).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('result 없으면 null', () => {
    expect(finalUsage([{ type: 'assistant_text', text: 'x' }])).toBeNull();
  });

  it('result 있어도 usage 없으면 null', () => {
    expect(finalUsage([{ type: 'result', ok: true, text: '완료', usage: null }])).toBeNull();
  });
});
