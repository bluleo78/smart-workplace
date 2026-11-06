// WP-1407: 회차 실행 기록기 — 이벤트 순서별 단계 전이, 모델 호출 시간(시각이 있으면 그 시각, 없으면 경계), 요약 줄·시간 포맷.
import { describe, expect, it } from 'vitest';
import { RunTraceRecorder, formatDuration, formatLimit, summaryLine, type TraceSnapshot } from './run-trace.js';
import type { RunnerEvent } from './runner-events.js';

const step = (over: Partial<Extract<RunnerEvent, { type: 'model_step' }>> = {}): RunnerEvent => ({
  type: 'model_step',
  startedAt: null,
  endedAt: null,
  inputTokens: null,
  outputTokens: null,
  parentToolUseId: null,
  ...over,
});
const toolUse = (name: string): RunnerEvent => ({ type: 'tool_use', name, input: { secret: 'x' }, parentToolUseId: null });
const done: RunnerEvent = { type: 'tool_done' };
const text: RunnerEvent = { type: 'text_delta', text: '답', parentToolUseId: null };

describe('RunTraceRecorder', () => {
  it('시작 직후는 모델 응답 대기', () => {
    const r = new RunTraceRecorder();
    r.start(1000);
    expect(r.snapshot(4000)).toMatchObject({ elapsedMs: 3000, lastStep: 'model_wait', lastStepSinceMs: 3000, modelCalls: 0, toolCalls: 0, firstResponseMs: null });
  });

  it('모델 단계 → 도구 → 도구 끝 → 텍스트 순으로 단계가 바뀐다', () => {
    const r = new RunTraceRecorder();
    r.start(0);
    r.on(step(), 2000);
    r.on(toolUse('workplace_list_issues'), 2000);
    expect(r.snapshot(5000)).toMatchObject({ lastStep: 'tool', lastTool: 'list_issues', lastStepSinceMs: 3000 });
    r.on(done, 6000);
    expect(r.snapshot(7000)).toMatchObject({ lastStep: 'model_wait', lastStepSinceMs: 1000 });
    expect(r.snapshot(7000).lastTool).toBeUndefined();
    r.on(step(), 9000);
    r.on(text, 9000);
    r.on(text, 9500);
    expect(r.snapshot(10_000)).toMatchObject({ lastStep: 'final_answer', lastStepSinceMs: 1000, firstResponseMs: 2000 });
  });

  it('도구가 돌고 있을 때의 텍스트는 최종 답변으로 보지 않고, 동시 도구가 모두 끝나야 모델 응답 대기', () => {
    const r = new RunTraceRecorder();
    r.start(0);
    r.on(toolUse('a'), 1);
    r.on(toolUse('b'), 2);
    r.on(text, 3);
    expect(r.snapshot(4).lastStep).toBe('tool');
    r.on(done, 5);
    expect(r.snapshot(6)).toMatchObject({ lastStep: 'tool', lastTool: 'b' });
    r.on(done, 7);
    expect(r.snapshot(8).lastStep).toBe('model_wait');
  });

  it('opencode 시각이 있는 모델 단계는 그 시각으로, 없는 것은 직전 경계부터 계산한다', () => {
    const r = new RunTraceRecorder();
    r.start(100);
    r.on(step({ startedAt: 50_000, endedAt: 53_500, inputTokens: 10, outputTokens: 2 }), 4000);
    r.on(toolUse('x'), 4000);
    r.on(done, 5000);
    r.on(step({ inputTokens: 20, outputTokens: null }), 8000);
    const s = r.snapshot(9000);
    expect(s.modelCallMs).toEqual([3500, 3000]);
    expect(s.modelCallTokens).toEqual([
      { in: 10, out: 2 },
      { in: 20, out: null },
    ]);
    expect(s).toMatchObject({ modelCalls: 2, tokensIn: 30, tokensOut: 2, firstResponseMs: 3900 });
  });

  it('시작됐는데 끝나지 않은 모델 단계(중단)는 마지막 단계 「모델 응답 대기」로 남는다', () => {
    const r = new RunTraceRecorder();
    r.start(0);
    r.on(step(), 1000);
    r.on(toolUse('x'), 1000);
    r.on(done, 2000);
    // 다음 모델 단계는 끝나지 못하고 시간 초과.
    expect(r.snapshot(130_000)).toMatchObject({ modelCalls: 1, lastStep: 'model_wait', lastStepSinceMs: 128_000 });
  });

  it('도구 이름별 수를 세고 인자는 기록하지 않는다', () => {
    const r = new RunTraceRecorder();
    r.start(0);
    r.on(toolUse('mcp__workplace__update_issue'), 1);
    r.on(toolUse('workplace_update_issue'), 2);
    r.on(toolUse('list_issues'), 3);
    const s = r.snapshot(4);
    expect(s.tools).toEqual({ update_issue: 2, list_issues: 1 });
    expect(JSON.stringify(s)).not.toContain('secret');
  });
});

describe('RunTraceRecorder — 병렬 도구·첫 응답(WP-1407 리뷰)', () => {
  it('병렬 도구 결과가 한 메시지로 와도(mapSdkMessage 가 결과마다 tool_done) 도는 도구가 0 으로 돌아가 모델 응답 대기가 된다', async () => {
    const { mapSdkMessage } = await import('./runner-events.js');
    const r = new RunTraceRecorder();
    r.start(0);
    const seen = new Set<string>();
    const feed = (o: unknown, now: number) => mapSdkMessage(o, seen).forEach((e) => r.on(e, now));
    feed({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'a', input: {} }] } }, 10);
    feed({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'b', input: {} }] } }, 11);
    feed(
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a' }, { type: 'tool_result', tool_use_id: 'b' }] } },
      20,
    );
    expect(r.snapshot(25)).toMatchObject({ lastStep: 'model_wait', modelCalls: 1, toolCalls: 2 });
    // 그 뒤 텍스트는 최종 답변이다(도구가 돈다고 잘못 보지 않는다).
    feed({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: '끝' }] } }, 30);
    expect(r.snapshot(31).lastStep).toBe('final_answer');
  });

  it('첫 응답은 처음 흘러온 조각(텍스트·도구) 시각이다 — 모델 단계가 끝나기 전이어도', () => {
    const r = new RunTraceRecorder();
    r.start(1000);
    r.on(text, 1500);
    r.on(step({ startedAt: 0, endedAt: 3000 }), 4000);
    expect(r.snapshot(5000).firstResponseMs).toBe(500);
  });
});

describe('summaryLine', () => {
  const base: TraceSnapshot = {
    elapsedMs: 0,
    firstResponseMs: null,
    modelCalls: 12,
    modelCallMs: [],
    modelCallTokens: [],
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 9,
    tools: { list_issues: 3, update_issue: 6 },
    lastStep: 'model_wait',
    lastStepSinceMs: 130_000,
  };

  it('많이 부른 순으로 도구를 적고 마지막 단계와 그 시간을 붙인다', () => {
    expect(summaryLine(base)).toBe('모델 호출 12회 · 도구 호출 9회(update_issue 6, list_issues 3) · 마지막 단계: 모델 응답 대기 2분 10초');
  });

  it('도구는 상위 5종 + 외 N', () => {
    const tools = { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1 };
    expect(summaryLine({ ...base, tools, toolCalls: 28 })).toContain('도구 호출 28회(a 7, b 6, c 5, d 4, e 3, 외 2)');
  });

  it('도구가 없으면 괄호 없이, 단계 말은 도구 실행 중(<이름>)·최종 답변 작성', () => {
    expect(summaryLine({ ...base, tools: {}, toolCalls: 0, lastStep: 'tool', lastTool: 'send_mail', lastStepSinceMs: 5000 })).toBe(
      '모델 호출 12회 · 도구 호출 0회 · 마지막 단계: 도구 실행 중(send_mail) 5초',
    );
    expect(summaryLine({ ...base, lastStep: 'final_answer', lastStepSinceMs: 0 })).toContain('마지막 단계: 최종 답변 작성 0초');
  });
});

describe('시간 포맷·도구 이름', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0초');
    expect(formatDuration(-5)).toBe('0초');
    expect(formatDuration(12_999)).toBe('12초');
    expect(formatDuration(130_000)).toBe('2분 10초');
    expect(formatDuration(1_800_000)).toBe('30분 0초');
    expect(formatDuration(3_723_000)).toBe('1시간 2분 3초');
  });

  it('formatLimit — 분으로 나누어떨어지면 분·시간 단위', () => {
    expect(formatLimit(1_800_000)).toBe('30분');
    expect(formatLimit(3_600_000)).toBe('1시간');
    expect(formatLimit(20_000)).toBe('20초');
    expect(formatLimit(90_500)).toBe('1분 30초');
  });
});
