import { describe, it, expect } from 'vitest';
import { parseChatEvents } from './chat-parser.js';
import type { RunnerEvent } from './runner-events.js';

// RunnerEvent 픽스처 헬퍼 — show_* tool_use / 종료 result.
function toolUse(name: string, input: unknown): RunnerEvent {
  return { type: 'tool_use', name, input, parentToolUseId: null };
}
function result(usage: { inputTokens: number; outputTokens: number } | null = null, text: string | null = null): RunnerEvent {
  return { type: 'result', ok: true, text, usage };
}

// 실제 stream 형상을 본뜬 fixture: assistant(tool_use 2개) → result.
const fixture: RunnerEvent[] = [
  toolUse('mcp__workplace__show_issue_list', { params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } }),
  toolUse('mcp__workplace__show_activity', { params: { actorKind: 'AGENT' } }),
  result(null, '내 담당 HIGH 이슈와 AI 활동을 보여드려요.'),
];

describe('parseChatEvents', () => {
  it('tool_use 를 순서대로 위젯으로 수집(params/layout 보존)', () => {
    const out = parseChatEvents(fixture);
    expect(out.widgets).toEqual([
      { type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } },
      { type: 'activity', params: { actorKind: 'AGENT' } },
    ]);
  });

  it('assistant_text 이벤트가 섞여 있어도 위젯만 수집(텍스트는 산출하지 않음)', () => {
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: '진행중 이슈예요.' },
      toolUse('show_issue_list', { params: { status: 'IN_PROGRESS' } }),
    ];
    expect(parseChatEvents(events).widgets).toEqual([{ type: 'issue_list', params: { status: 'IN_PROGRESS' } }]);
  });

  it('#431 show_mail_list 를 mail_list 위젯으로 수집(params 보존)', () => {
    const out = parseChatEvents([toolUse('mcp__workplace__show_mail_list', { params: { folder: 'INBOX', limit: 20 } })]);
    expect(out.widgets).toEqual([{ type: 'mail_list', params: { folder: 'INBOX', limit: 20 } }]);
  });

  it('params 없는 show_my_tasks 는 빈 params', () => {
    const out = parseChatEvents([toolUse('show_my_tasks', {})]);
    expect(out.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('show_ 가 아닌 tool_use(mcp 읽기 도구·Agent 위임)는 무시', () => {
    const out = parseChatEvents([
      toolUse('mcp__workplace__get_issue_detail', {}),
      toolUse('Agent', { subagent_type: 'issue-agent' }),
    ]);
    expect(out.widgets).toEqual([]);
  });

  it('빈 입력 → 빈 위젯 + usage null', () => {
    expect(parseChatEvents([])).toEqual({ widgets: [], usage: null });
  });

  it('#432: result 이벤트의 usage(inputTokens/outputTokens) 를 추출', () => {
    const events: RunnerEvent[] = [result({ inputTokens: 1234, outputTokens: 56 }, '완료')];
    expect(parseChatEvents(events).usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });

  it('#432: usage 누락(null)이면 null', () => {
    expect(parseChatEvents([result(null, '완료')]).usage).toBeNull();
  });

  it('result 이벤트가 있어도 위젯 수집은 tool_use 순서대로 유지', () => {
    const events: RunnerEvent[] = [
      { type: 'assistant_text', text: '준비중...' },
      toolUse('show_issue_list', { params: { status: 'IN_PROGRESS' } }),
      result(null, '최종 결과예요'),
    ];
    expect(parseChatEvents(events).widgets).toEqual([{ type: 'issue_list', params: { status: 'IN_PROGRESS' } }]);
  });
});
