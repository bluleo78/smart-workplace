import { describe, it, expect } from 'vitest';
import { mapSdkMessage, finalText, finalUsage, type RunnerEvent } from './runner-events.js';

describe('mapSdkMessage', () => {
  it('stream_event text_delta → text_delta(parent 보존, null)', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안' } },
    }, new Set());
    expect(ev).toEqual([{ type: 'text_delta', text: '안', parentToolUseId: null }]);
  });

  it('stream_event text_delta → parent_tool_use_id 값 보존(서브에이전트)', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: 'tu_sub',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '녕' } },
    }, new Set());
    expect(ev).toEqual([{ type: 'text_delta', text: '녕', parentToolUseId: 'tu_sub' }]);
  });

  it('stream_event thinking_delta 등 비-text_delta 는 빈 배열', () => {
    const ev = mapSdkMessage({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', text: '생각' } },
    }, new Set());
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
    }, new Set());
    // WP-1407: assistant 메시지 하나 = 모델 호출 하나 — 내용 이벤트 앞에 model_step.
    expect(ev).toEqual<RunnerEvent[]>([
      { type: 'model_step', startedAt: null, endedAt: null, inputTokens: null, outputTokens: null, parentToolUseId: null },
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
    }, new Set());
    expect(ev).toEqual<RunnerEvent[]>([
      { type: 'model_step', startedAt: null, endedAt: null, inputTokens: null, outputTokens: null, parentToolUseId: 'tu_parent' },
      {
        type: 'tool_use',
        name: 'mcp__workplace__list_issues',
        input: { params: {} },
        parentToolUseId: 'tu_parent',
      },
    ]);
  });

  it('assistant 빈 text 블록은 건너뛴다(모델 호출 한 단계만 남는다)', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '   ' }] },
    }, new Set());
    expect(ev).toEqual([
      { type: 'model_step', startedAt: null, endedAt: null, inputTokens: null, outputTokens: null, parentToolUseId: null },
    ]);
  });

  // WP-1407: 회차 실행 기록용 모델 호출 단계 — usage 가 있으면 토큰을 싣는다(시각은 없다 — 기록기가 경계로 계산).
  it('assistant 메시지 → model_step(usage 포함)', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: '답' }], usage: { input_tokens: 120, output_tokens: 30 } },
    }, new Set());
    expect(ev[0]).toEqual({ type: 'model_step', startedAt: null, endedAt: null, inputTokens: 120, outputTokens: 30, parentToolUseId: null });
    expect(ev[1]).toEqual({ type: 'assistant_text', text: '답' });
  });

  // WP-1407: SDK 는 API 메시지 하나를 내용 블록마다 같은 id·usage 의 assistant 메시지로 나눠 보낸다 — 실행의 집합을 넘기면 model_step 은 한 번.
  it('같은 message.id 의 assistant 메시지는 model_step 을 한 번만 낸다', () => {
    const seen = new Set<string>();
    const msg = (block: unknown) => ({
      type: 'assistant',
      message: { id: 'msg_1', content: [block], usage: { input_tokens: 100, output_tokens: 9 } },
    });
    const all = [
      ...mapSdkMessage(msg({ type: 'text', text: '보겠습니다' }), seen),
      ...mapSdkMessage(msg({ type: 'tool_use', name: 'a', input: {} }), seen),
      ...mapSdkMessage(msg({ type: 'tool_use', name: 'b', input: {} }), seen),
      ...mapSdkMessage({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: '끝' }] } }, seen),
    ];
    expect(all.filter((e) => e.type === 'model_step')).toHaveLength(2);
    expect(all.filter((e) => e.type === 'tool_use')).toHaveLength(2);
  });

  it('tool_result 블록이 여럿이면(병렬 도구) 블록마다 tool_done', () => {
    const ev = mapSdkMessage({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'x' },
          { type: 'tool_result', tool_use_id: 'b', content: 'y' },
          { type: 'text', text: '무시' },
        ],
      },
    }, new Set());
    expect(ev).toEqual([{ type: 'tool_done' }, { type: 'tool_done' }]);
  });

  it('result subtype success 여도 is_error true 면 ok:false(WP-1347 제공자 오류 문구)', () => {
    expect(mapSdkMessage({ type: 'result', subtype: 'success', is_error: true, result: '401 invalid x-api-key' }, new Set())).toEqual([
      { type: 'result', ok: false, text: '401 invalid x-api-key', usage: null },
    ]);
  });

  it('user tool_result → tool_done', () => {
    const ev = mapSdkMessage({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'ok' }] }] },
    }, new Set());
    expect(ev).toEqual([{ type: 'tool_done' }]);
  });

  it('user 메시지에 tool_result 없으면 빈 배열', () => {
    const ev = mapSdkMessage({
      type: 'user',
      message: { content: [{ type: 'text', text: '무시' }] },
    }, new Set());
    expect(ev).toEqual([]);
  });

  it('result success → result{ok:true,text,usage}(snake_case)', () => {
    const ev = mapSdkMessage({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '완료',
      usage: { input_tokens: 1234, output_tokens: 56 },
    }, new Set());
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
    }, new Set());
    expect(ev).toEqual([{ type: 'result', ok: true, text: '완료', usage: { inputTokens: 10, outputTokens: 20 } }]);
  });

  it('result: usage 누락/형식 불명이면 null', () => {
    const ev1 = mapSdkMessage({ type: 'result', subtype: 'success', result: '완료' }, new Set());
    expect((ev1[0] as { usage: unknown }).usage).toBeNull();
    const ev2 = mapSdkMessage({ type: 'result', subtype: 'success', result: '완료', usage: { foo: 'bar' } }, new Set());
    expect((ev2[0] as { usage: unknown }).usage).toBeNull();
  });

  it('result: subtype 이 success 아니면 ok:false', () => {
    const ev = mapSdkMessage({ type: 'result', subtype: 'error_max_turns', result: null }, new Set());
    expect(ev).toEqual([{ type: 'result', ok: false, text: null, usage: null }]);
  });

  it('알 수 없는 타입/비객체는 빈 배열', () => {
    expect(mapSdkMessage(null, new Set())).toEqual([]);
    expect(mapSdkMessage('str', new Set())).toEqual([]);
    expect(mapSdkMessage({ type: 'system', subtype: 'init' }, new Set())).toEqual([]);
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
