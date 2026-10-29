import { describe, expect, it } from 'vitest';

import { buildMailContext } from './mail';

const base = { accountId: 3, accountEmail: 'me@x.com', folder: 'INBOX' as const, q: '', category: null, needsReply: false, count: 12, selected: null };

describe('buildMailContext', () => {
  it('목록만 — 계정·폴더·건수', () => {
    expect(buildMailContext(base)).toEqual({
      view: '메일함',
      app: 'MAIL',
      scope: { label: 'me@x.com · 받은편지함', refs: { accountId: '3', folder: 'INBOX' }, count: 12 },
    });
  });

  // WP-961 서버 메일함 보기 — list_mail 에 메일함 인자가 없어 folder 를 싣지 않고 경로 이름만.
  it('서버 메일함 — 경로 이름 라벨, refs 에 folder 없음', () => {
    expect(buildMailContext({ ...base, serverFolder: '프로젝트 › 견적' }).scope).toEqual({
      label: 'me@x.com · 프로젝트 › 견적',
      refs: { accountId: '3' },
      count: 12,
    });
  });

  it('열린 메일 — 숫자 id 를 messageId 로, 필터 facts', () => {
    const ctx = buildMailContext({
      ...base,
      folder: 'SENT',
      q: '견적',
      needsReply: true,
      selected: { id: 91, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com', receivedAt: '2026-09-29T00:30:00Z', aiCategory: '업무', aiNeedsReply: true },
    });
    expect(ctx.focus).toEqual({
      type: '메일',
      label: '견적 요청',
      refs: { messageId: '91' },
      facts: [
        { label: '보낸이', value: '김철수 <kim@a.com>' },
        { label: '수신', value: '2026-09-29 09:30' },
        { label: 'AI 분류', value: '업무' },
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

  it('보이지 않는 글자뿐인 제목도 「(제목 없음)」 — 화면 판정과 같다(WP-1180)', () => {
    const sel = { id: 1, subject: '\u200B', fromName: null, fromAddress: 'a@b.c', receivedAt: '2026-09-29T00:00:00Z', aiCategory: null, aiNeedsReply: null };
    for (const subject of ['\u200B', ' \u200B\u2060 ', '']) {
      expect(buildMailContext({ ...base, selected: { ...sel, subject } }).focus!.label).toBe('(제목 없음)');
    }
    expect(buildMailContext({ ...base, selected: { ...sel, subject: '  견적  ' } }).focus!.label).toBe('견적');
  });

  // 분류 값은 백엔드 MailAiService.CATEGORIES 의 한글 표시값('업무' 등) 그대로 — UI 배지·사이드바와 같은 문자열.
  it('분류 필터 fact 는 화면 표시값 그대로', () => {
    expect(buildMailContext({ ...base, category: '업무' }).scope!.facts).toEqual([{ label: '분류', value: '업무' }]);
  });

  it('보낸 주소가 비면 이름만(“이름 <>” 금지)', () => {
    const sel = { id: 2, subject: 's', fromName: '김철수', fromAddress: '', receivedAt: '2026-09-29T00:00:00Z', aiCategory: null, aiNeedsReply: null };
    expect(buildMailContext({ ...base, selected: sel }).focus!.facts).toContainEqual({ label: '보낸이', value: '김철수' });
  });

  // WP-577 임시보관함 — 앱 서버 임시저장이라 MCP 도구(list_mail) folder 인자가 아니다. 이름표만 바꾸고 folder ref 는 싣지 않는다.
  it('임시보관함 — 이름표 「임시보관함」, refs 에 folder 없음, 건수는 임시저장 수', () => {
    expect(buildMailContext({ ...base, folder: 'DRAFTS', count: 2 })).toEqual({
      view: '메일함',
      app: 'MAIL',
      scope: { label: 'me@x.com · 임시보관함', refs: { accountId: '3' }, count: 2 },
    });
  });

  it('count 미제공이면 scope.count 없음', () => {
    expect(buildMailContext({ ...base, count: undefined }).scope).not.toHaveProperty('count');
  });
});
