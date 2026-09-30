import { describe, expect, it } from 'vitest';

import { buildMailContext } from './mail';

const base = { accountId: 3, accountEmail: 'me@x.com', folder: 'INBOX' as const, q: '', category: null, needsReply: false, count: 12, selected: null };

describe('buildMailContext', () => {
  it('목록만 — 계정·폴더·건수', () => {
    expect(buildMailContext(base)).toEqual({
      view: '메일함',
      scope: { label: 'me@x.com · 받은편지함', refs: { accountId: '3', folder: 'INBOX' }, count: 12 },
    });
  });

  it('열린 메일 — 숫자 id 를 messageId 로, 필터 facts', () => {
    const ctx = buildMailContext({
      ...base,
      folder: 'SENT',
      q: '견적',
      needsReply: true,
      selected: { id: 91, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com', receivedAt: '2026-09-29T00:30:00Z', aiCategory: 'WORK', aiNeedsReply: true },
    });
    expect(ctx.focus).toEqual({
      type: '메일',
      label: '견적 요청',
      refs: { messageId: '91' },
      facts: [
        { label: '보낸이', value: '김철수 <kim@a.com>' },
        { label: '수신', value: '2026-09-29 09:30' },
        { label: 'AI 분류', value: 'WORK' },
        { label: '답장 필요', value: '예' },
      ],
    });
    expect(ctx.scope).toMatchObject({ label: 'me@x.com · 보낸편지함', facts: [{ label: '검색어', value: '견적' }, { label: '답장 필요만', value: '예' }] });
  });

  it('제목 없음·300자 제목 처리', () => {
    const sel = { id: 1, subject: null, fromName: null, fromAddress: 'a@b.c', receivedAt: '2026-09-29T00:00:00Z', aiCategory: null, aiNeedsReply: null };
    expect(buildMailContext({ ...base, selected: sel }).focus!.label).toBe('(제목 없음)');
    expect(buildMailContext({ ...base, selected: { ...sel, subject: 's'.repeat(300) } }).focus!.label).toHaveLength(200);
  });
});
