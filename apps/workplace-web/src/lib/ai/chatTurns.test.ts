import { describe, expect, it } from 'vitest';

import type { ChatTurn, HomeMessage, MessageTurn } from '@/types/home';

import {
  appendDelta,
  appendProgress,
  applyDoneWidgets,
  applyTool,
  FAILED_EMPTY,
  markInterrupted,
  messageToTurn,
  STOPPED_EMPTY,
} from './chatTurns';

const base = (): ChatTurn[] => [{ role: 'user', content: '질문' }, { role: 'assistant', content: '' }];
const msg = (p: Partial<HomeMessage>): HomeMessage => ({
  id: 1, role: 'ASSISTANT', content: '답', widgets: null, toolCalls: null, createdAt: '2026-10-05T00:00:00Z', ...p,
});

describe('messageToTurn', () => {
  it('STOPPED·FAILED 는 interrupted 로, COMPLETE·없음은 표시 없음', () => {
    expect(messageToTurn(msg({ status: 'STOPPED' }))).toMatchObject({ role: 'assistant', interrupted: 'stopped' });
    expect(messageToTurn(msg({ status: 'FAILED' }))).toMatchObject({ interrupted: 'failed' });
    expect(messageToTurn(msg({ status: 'COMPLETE' }))).not.toHaveProperty('interrupted');
    expect(messageToTurn(msg({}))).not.toHaveProperty('interrupted');
  });
  it('WP-234: 첨부를 화면 턴 첨부로 되살리고, 첨부만 보낸 메시지(content null)는 빈 문자열로', () => {
    const extraction = { status: 'NONE' as const, totalChars: null, truncated: null, reasonCode: null, reason: null };
    const t = messageToTurn(msg({
      role: 'USER', content: null,
      attachments: [{ fileId: 3, messageId: 1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5, extraction }],
    }));
    expect(t).toEqual({ role: 'user', content: '', attachments: [{ fileId: 3, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }] });
  });
  it('ACTION_* 는 결과 줄', () => {
    expect(messageToTurn(msg({ role: 'ACTION_DONE', content: '승인 완료' }))).toEqual({ role: 'action', outcome: 'done', content: '승인 완료' });
  });
});

describe('스트림 누적', () => {
  it('delta 는 마지막 어시스턴트 턴에 이어 붙이고 텍스트 블록을 연다', () => {
    const t = appendDelta(appendDelta(base(), '안녕'), '하세요');
    expect(t[1]).toMatchObject({ content: '안녕하세요', contentBlocks: [{ kind: 'text', textStart: 0 }] });
  });
  it('progress·tool 은 단계와 도구 블록을 쌓고, result 가 상태를 바꾼다', () => {
    let t = appendProgress(base(), '메일 확인 중');
    t = applyTool(t, { seq: 1, phase: 'start', toolName: 'list_mail' });
    t = applyTool(t, { seq: 1, phase: 'result', toolName: 'list_mail', isError: false });
    const last = t[1] as MessageTurn;
    expect(last.steps).toEqual([
      { kind: 'delegation', label: '메일 확인 중' },
      { kind: 'tool', seq: 1, toolName: 'list_mail', args: undefined, status: 'done' },
    ]);
  });
  it('show_* 도구는 위젯을 즉시 누적', () => {
    const t = applyTool(base(), { seq: 2, phase: 'start', toolName: 'mcp__workplace__show_issue_list', args: { params: { q: 'x' } } });
    expect((t[1] as { widgets?: unknown[] }).widgets).toEqual([{ type: 'issue_list', params: { q: 'x' } }]);
  });
  it('done 위젯이 비어 있으면 라이브 위젯을 보존', () => {
    const t = applyTool(base(), { seq: 2, phase: 'start', toolName: 'show_issue_list', args: {} });
    expect(applyDoneWidgets(t, [])).toBe(t);
    expect(applyDoneWidgets(t, null)).toBe(t);
  });
  it('마지막 턴이 어시스턴트가 아니면 그대로', () => {
    const t: ChatTurn[] = [{ role: 'user', content: 'q' }];
    expect(appendDelta(t, 'x')).toBe(t);
  });
});

describe('markInterrupted', () => {
  it('본문이 있으면 interrupted 표시만', () => {
    const t = markInterrupted(appendDelta(base(), '부분'), 'stopped');
    expect(t[1]).toMatchObject({ content: '부분', interrupted: 'stopped' });
  });
  it('빈 말풍선이면 안내 문구로 바꾼다(라벨 없음)', () => {
    expect(markInterrupted(base(), 'stopped')[1]).toEqual({ role: 'assistant', content: STOPPED_EMPTY });
    expect(markInterrupted(base(), 'failed')[1]).toEqual({ role: 'assistant', content: FAILED_EMPTY });
  });
});
