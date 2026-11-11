import { describe, it, expect } from 'vitest';
import {
  fallbackReplyText,
  FALLBACK_MAX_CODE_POINTS,
  MessagingReplyTracker,
  MESSAGING_FALLBACK_NOTICE,
  normalizeToolResult,
} from './messaging-reply.js';
import {
  PROPOSE_CREATE_EVENT_ALREADY,
  PROPOSE_CREATE_EVENT_OK,
  PROPOSE_CREATE_ISSUE_ALREADY,
  PROPOSE_CREATE_ISSUE_OK,
} from '../mcp/tools.js';

// WP-1489: 답장 도구 성공 판정 — 두 러너의 도구 줄(onTool: 시작 줄에 인자, 결과 줄은 같은 seq)을 본다.
describe('MessagingReplyTracker 답장 판정', () => {
  // 채널 42 실행에서 도구 하나를 시작→결과로 흘려 replied 를 본다.
  const replied = (toolName: string, result: string, isError = false, args: Record<string, unknown> = { channelId: 42 }) => {
    const t = new MessagingReplyTracker(42);
    t.onTool({ seq: 1, event: 'tool_use_start', toolName, args });
    t.onTool({ seq: 1, event: 'tool_result', toolName, isError, result });
    return t.replied;
  };

  it('add_channel_message 는 결과가 ok 일 때만 — Claude 맨 이름·opencode 접두 이름·mcp__ 접두 모두', () => {
    expect(replied('add_channel_message', 'ok')).toBe(true);
    expect(replied('workplace_add_channel_message', 'ok')).toBe(true);
    expect(replied('mcp__workplace__add_channel_message', ' ok\n')).toBe(true);
    expect(replied('add_channel_message', 'HTTP 500', true)).toBe(false);
    // opencode 가 MCP 오류 결과를 completed 로 싣더라도 오류 문구는 성공이 아니다
    expect(replied('workplace_add_channel_message', '보낼 본문(body)이 비어 있습니다.')).toBe(false);
  });

  it('add_channel_message 는 이 실행의 채널에 쓴 것만 답장으로 센다', () => {
    expect(replied('add_channel_message', 'ok', false, { channelId: 77 })).toBe(false);
    expect(replied('add_channel_message', 'ok', false, { channelId: '42' })).toBe(true);
  });

  it('propose_* 는 성공·이미 등록 문구일 때만 — 실패 안내 문구(isError 아님)는 실패, 채널 인자는 보지 않는다', () => {
    expect(replied('propose_create_issue', PROPOSE_CREATE_ISSUE_OK, false, {})).toBe(true);
    expect(replied('propose_create_issue', PROPOSE_CREATE_ISSUE_ALREADY)).toBe(true);
    expect(replied('propose_create_issue', '이슈 제안 등록에 실패했습니다: 400')).toBe(false);
    expect(replied('workplace_propose_create_event', `"${PROPOSE_CREATE_EVENT_OK}"`)).toBe(true);
    expect(replied('propose_create_event', PROPOSE_CREATE_EVENT_ALREADY)).toBe(true);
    expect(replied('propose_create_event', '일정 제안 등록에 실패했습니다: 500')).toBe(false);
  });

  it('답장 도구가 아니면 세지 않는다', () => {
    expect(replied('list_channel_messages', 'ok')).toBe(false);
  });

  it('진행 중 답장 호출 수를 세고, 끝나기를 기다릴 수 있다', async () => {
    const t = new MessagingReplyTracker(42);
    t.onTool({ seq: 1, event: 'tool_use_start', toolName: 'list_channel_messages', args: {} });
    expect(t.inFlight).toBe(0); // 답장 도구가 아니면 세지 않는다
    t.onTool({ seq: 2, event: 'tool_use_start', toolName: 'add_channel_message', args: { channelId: 42 } });
    expect(t.inFlight).toBe(1);
    const waiting = t.waitForInFlight(1000);
    t.onTool({ seq: 2, event: 'tool_result', toolName: 'add_channel_message', isError: false, result: 'ok' });
    await expect(waiting).resolves.toBe(true);
    expect(t.inFlight).toBe(0);
    expect(t.replied).toBe(true);
  });

  it('기다리는 동안 결과가 오지 않으면 false', async () => {
    const t = new MessagingReplyTracker(42);
    t.onTool({ seq: 1, event: 'tool_use_start', toolName: 'propose_create_issue', args: {} });
    await expect(t.waitForInFlight(5)).resolves.toBe(false);
  });
});

describe('MessagingReplyTracker 마지막 텍스트·결과', () => {
  it('마지막 도구 경계 뒤의 라우터 텍스트만 — 앞 서술·서브에이전트 텍스트는 빼고, 부분 메시지가 있으면 그것', () => {
    const t = new MessagingReplyTracker(1);
    t.onEvent({ type: 'assistant_text', text: '조회해 볼게요' });
    t.onEvent({ type: 'tool_use', name: 'x', input: {}, parentToolUseId: null });
    t.onEvent({ type: 'tool_done' });
    expect(t.finalText()).toBe('');
    t.onEvent({ type: 'assistant_text', text: '서브', parentToolUseId: 'p1' });
    t.onEvent({ type: 'text_delta', text: '답', parentToolUseId: null });
    t.onEvent({ type: 'text_delta', text: '입니다', parentToolUseId: null });
    expect(t.finalText()).toBe('답입니다');
  });

  it('result.ok 를 따라간다(없으면 false)', () => {
    const t = new MessagingReplyTracker(1);
    expect(t.resultOk).toBe(false);
    t.onEvent({ type: 'result', ok: true, text: null, usage: null });
    expect(t.resultOk).toBe(true);
  });
});

describe('normalizeToolResult', () => {
  it('공백·JSON 문자열·content 블록 배열·{content} 를 안의 텍스트로 푼다', () => {
    expect(normalizeToolResult('  ok\n')).toBe('ok');
    expect(normalizeToolResult('"ok"')).toBe('ok');
    expect(normalizeToolResult('[{"type":"text","text":"ok"}]')).toBe('ok');
    expect(normalizeToolResult('{"content":[{"type":"text","text":" ok "}]}')).toBe('ok');
    expect(normalizeToolResult('{"ok":true}')).toBe('{"ok":true}');
    expect(normalizeToolResult('{broken')).toBe('{broken');
    expect(normalizeToolResult(undefined)).toBe('');
  });
});

describe('fallbackReplyText', () => {
  it('정상 종료면 마지막 텍스트, 없으면 안내', () => {
    expect(fallbackReplyText('ok', '바꿀 수 없습니다')).toBe('바꿀 수 없습니다');
    expect(fallbackReplyText('ok', '  ')).toBe(MESSAGING_FALLBACK_NOTICE);
  });

  it('오류 종료면 텍스트가 있어도 안내(제공자 오류 문구를 답으로 쓰지 않는다)', () => {
    expect(fallbackReplyText('error', 'API Error: 529')).toBe(MESSAGING_FALLBACK_NOTICE);
  });

  it('긴 텍스트는 코드 포인트 단위로 상한까지 자르고 … 를 붙인다(서로게이트 쌍을 가르지 않는다)', () => {
    const out = fallbackReplyText('ok', '😀'.repeat(FALLBACK_MAX_CODE_POINTS + 10));
    const cps = Array.from(out);
    expect(cps).toHaveLength(FALLBACK_MAX_CODE_POINTS + 1);
    expect(cps.at(-1)).toBe('…');
    expect(cps.slice(0, -1).every((c) => c === '😀')).toBe(true);
    expect(FALLBACK_MAX_CODE_POINTS).toBeLessThanOrEqual(3500);
  });
});
