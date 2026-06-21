import { describe, it, expect } from 'vitest';
import { parseCompose, parseComposeLines } from './compose-parser.js';

// 실제 stream-json 형상을 본뜬 fixture: system → assistant(tool_use 2개) → user(tool_result) → result.
const fixture = [
  { type: 'system', subtype: 'init', session_id: 'x' },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'mcp__workplace__show_issue_list',
          input: { params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } },
        },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'mcp__workplace__show_activity',
          input: { params: { actorKind: 'AGENT' } },
        },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: '{"displayed":true}' }] }] },
  },
  { type: 'result', subtype: 'success', is_error: false, result: '내 담당 HIGH 이슈와 AI 활동을 보여드려요.' },
];

describe('parseCompose', () => {
  it('tool_use 를 순서대로 위젯으로 수집', () => {
    const out = parseCompose(fixture);
    expect(out.widgets).toEqual([
      { type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } },
      { type: 'activity', params: { actorKind: 'AGENT' } },
    ]);
  });

  it('result.result 를 message 로 사용', () => {
    expect(parseCompose(fixture).message).toBe('내 담당 HIGH 이슈와 AI 활동을 보여드려요.');
  });

  it('result 없으면 assistant text 블록을 join 해 message 생성', () => {
    const noResult = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '진행중 이슈예요.' }, { type: 'tool_use', id: 't', name: 'show_issue_list', input: { params: { status: 'IN_PROGRESS' } } }] },
      },
    ];
    const out = parseCompose(noResult);
    expect(out.message).toBe('진행중 이슈예요.');
    expect(out.widgets).toEqual([{ type: 'issue_list', params: { status: 'IN_PROGRESS' } }]);
  });

  it('#431 show_mail_list 를 mail_list 위젯으로 수집(params 보존)', () => {
    const out = parseCompose([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'm', name: 'mcp__workplace__show_mail_list', input: { params: { folder: 'INBOX', limit: 20 } } }] } },
    ]);
    expect(out.widgets).toEqual([{ type: 'mail_list', params: { folder: 'INBOX', limit: 20 } }]);
  });

  it('params 없는 show_my_tasks 는 빈 params', () => {
    const out = parseCompose([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'show_my_tasks', input: {} }] } },
    ]);
    expect(out.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('show_ 가 아닌 tool_use 는 무시', () => {
    const out = parseCompose([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'mcp__workplace__get_issue_detail', input: {} }] } },
    ]);
    expect(out.widgets).toEqual([]);
  });

  it('빈 입력 → 빈 위젯 + 빈 message', () => {
    expect(parseCompose([])).toEqual({ message: '', widgets: [], usage: null });
  });

  it('parseComposeLines: 비 JSON·공백 줄은 건너뛰고 유효 줄만 파싱', () => {
    const lines = [
      'this is not json',
      '   ',
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'mcp__workplace__show_issue_list', input: { params: { assignee: 'me' } } }] },
      }),
      '{ broken json',
      '',
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '한 개 위젯을 보여드려요.' }),
    ];
    const out = parseComposeLines(lines);
    expect(out).toEqual({
      message: '한 개 위젯을 보여드려요.',
      widgets: [{ type: 'issue_list', params: { assignee: 'me' } }],
      usage: null,
    });
  });

  it('#432: result 이벤트의 usage(input_tokens/output_tokens) 를 추출', () => {
    const events = [
      { type: 'result', subtype: 'success', is_error: false, result: '완료', usage: { input_tokens: 1234, output_tokens: 56 } },
    ];
    expect(parseCompose(events).usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });

  it('#432: usage 누락/형식 불명이면 null', () => {
    expect(parseCompose([{ type: 'result', result: '완료' }]).usage).toBeNull();
    expect(parseCompose([{ type: 'result', result: '완료', usage: { foo: 'bar' } }]).usage).toBeNull();
  });

  it('result 가 있으면 assistant text 보다 우선', () => {
    const events = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '준비중...' }, { type: 'tool_use', id: 'a', name: 'show_issue_list', input: { params: { status: 'IN_PROGRESS' } } }] },
      },
      { type: 'result', subtype: 'success', is_error: false, result: '최종 결과예요' },
    ];
    const out = parseCompose(events);
    expect(out.message).toBe('최종 결과예요');
    expect(out.widgets).toEqual([{ type: 'issue_list', params: { status: 'IN_PROGRESS' } }]);
  });
});
