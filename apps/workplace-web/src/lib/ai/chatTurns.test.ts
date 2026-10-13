import { describe, expect, it } from 'vitest';

import type { ChatTurn, HomeMessage, MessageTurn } from '@/types/home';

import {
  appendDelta,
  appendProgress,
  applyDoneMessageId,
  applyDoneWidgets,
  applyTool,
  FAILED_EMPTY,
  markInterrupted,
  markMemoryUndone,
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
  it('WP-139: ASSISTANT 의 후속 질문을 턴에 싣고, 없으면 키를 두지 않는다', () => {
    expect(messageToTurn(msg({ followups: ['a 알려줘'] }))).toMatchObject({ role: 'assistant', followups: ['a 알려줘'] });
    expect(messageToTurn(msg({ followups: null }))).not.toHaveProperty('followups');
    expect(messageToTurn(msg({ role: 'USER', followups: ['x'] }))).not.toHaveProperty('followups');
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

describe('메모리 결과 줄 (WP-55)', () => {
  const memory = { action: 'saved' as const, memoryId: 12, kind: 'PREFERENCE' as const, content: '짧은 목록', source: 'AI' as const };

  it('성공 result 의 memory 는 블록으로, 오류 result 는 무시한다', () => {
    let t = applyTool(base(), { seq: 1, phase: 'start', toolName: 'remember_memory', args: {} });
    t = applyTool(t, { seq: 1, phase: 'result', toolName: 'remember_memory', isError: false, memory });
    t = applyTool(t, { seq: 2, phase: 'result', toolName: 'remember_memory', isError: true, memory: { ...memory, memoryId: 13 } });
    const last = t[1] as MessageTurn;
    expect(last.contentBlocks).toEqual([
      { kind: 'memory', action: 'saved', memoryId: 12, memoryKind: 'PREFERENCE', content: '짧은 목록', source: 'AI', undone: false },
    ]);
  });

  // I1: 서버는 memory 블록을 memoryBlocks 로 따로 보낸다(구 웹 보호) — 이력 턴에서 contentBlocks 끝에 영속 순서대로 다시 붙인다.
  it('이력의 memoryBlocks 를 contentBlocks 끝에 순서대로 다시 붙인다', () => {
    const saved = { kind: 'memory' as const, action: 'saved' as const, memoryId: 12, memoryKind: 'PREFERENCE' as const, content: '짧은 목록', source: 'AI' as const, undone: true };
    const forgotten = { ...saved, action: 'forgotten' as const, memoryId: 7, content: '표로', source: 'USER' as const, undone: false };
    const t = messageToTurn(msg({ contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [saved, forgotten] })) as MessageTurn;
    expect(t.contentBlocks).toEqual([{ kind: 'text', textStart: 0 }, saved, forgotten]);
  });

  it('표시 블록 없이(null) memoryBlocks 만 오면 memory 블록만 남겨 폴백 렌더 + 결과 줄로 그린다', () => {
    const saved = { kind: 'memory' as const, action: 'saved' as const, memoryId: 12, memoryKind: 'PREFERENCE' as const, content: '짧은 목록', source: 'AI' as const, undone: false };
    const t = messageToTurn(msg({ contentBlocks: null, memoryBlocks: [saved] })) as MessageTurn;
    expect(t.contentBlocks).toEqual([saved]);
  });

  it('memoryBlocks 가 없으면 기존과 같다(contentBlocks 없음 → undefined)', () => {
    expect((messageToTurn(msg({ contentBlocks: null, memoryBlocks: null })) as MessageTurn).contentBlocks).toBeUndefined();
    expect((messageToTurn(msg({})) as MessageTurn).contentBlocks).toBeUndefined();
    expect((messageToTurn(msg({ contentBlocks: [{ kind: 'text', textStart: 0 }] })) as MessageTurn).contentBlocks).toEqual([{ kind: 'text', textStart: 0 }]);
  });

  it('메시지 id 는 이력(ASSISTANT)과 done 에서 채운다', () => {
    expect(messageToTurn(msg({ id: 7 }))).toMatchObject({ messageId: 7 });
    expect(messageToTurn(msg({ id: 7, role: 'USER' }))).not.toHaveProperty('messageId');
    expect(applyDoneMessageId(base(), 9)[1]).toMatchObject({ messageId: 9 });
    expect(applyDoneMessageId(base(), null)).toEqual(base());
  });

  it('markMemoryUndone 은 그 메시지의 blockIndex 번째 memory 블록만 되돌림으로 — 다른 블록은 세지 않는다', () => {
    const turns: ChatTurn[] = [
      {
        role: 'assistant',
        content: '답',
        messageId: 5,
        contentBlocks: [
          { kind: 'text', textStart: 0 },
          { kind: 'memory', action: 'saved', memoryId: 1, memoryKind: 'PREFERENCE', content: 'a', source: 'AI', undone: false },
          { kind: 'memory', action: 'forgotten', memoryId: 2, memoryKind: 'CONTEXT', content: 'b', source: 'USER', undone: false },
        ],
      },
    ];
    const next = markMemoryUndone(turns, 5, 1);
    const blocks = (next[0] as MessageTurn).contentBlocks!;
    expect(blocks[1]).toMatchObject({ undone: false });
    expect(blocks[2]).toMatchObject({ undone: true });
    expect(markMemoryUndone(turns, 6, 0)).toBe(turns); // 다른 메시지
    expect(markMemoryUndone(turns, 5, 9)).toBe(turns); // 순번 밖
  });

  it('첫 토큰 전 중단돼도 memory 블록은 남는다', () => {
    const t = applyTool(base(), { seq: 1, phase: 'result', toolName: 'remember_memory', isError: false, memory });
    const stopped = markInterrupted(t, 'stopped')[1] as MessageTurn;
    expect(stopped.content).toBe(STOPPED_EMPTY);
    expect(stopped.contentBlocks).toHaveLength(1);
  });
});
