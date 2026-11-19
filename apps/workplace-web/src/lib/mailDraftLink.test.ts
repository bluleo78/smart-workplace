// 임시보관 딥링크(WP-1786) — 알림이 /mail?draftId=N 으로 보내면 메인 창이 그 임시보관을 쓰기 창으로 열고 주소에서 키를 뗀다.
import { describe, expect, it } from 'vitest';

import { mailDraftPath, takeDraftIdParam } from './mailDraftLink';

describe('mailDraftPath', () => {
  it('/mail?draftId=N', () => {
    expect(mailDraftPath(42)).toBe('/mail?draftId=42');
  });
});

describe('takeDraftIdParam', () => {
  it('draftId 를 꺼내고 나머지 쿼리는 남긴다', () => {
    expect(takeDraftIdParam('?draftId=42')).toEqual({ draftId: 42, search: '' });
    expect(takeDraftIdParam('?folder=drafts&draftId=7&q=a')).toEqual({ draftId: 7, search: '?folder=drafts&q=a' });
  });

  it('없거나 양의 정수가 아니면 null', () => {
    expect(takeDraftIdParam('')).toBeNull();
    expect(takeDraftIdParam('?messageId=3')).toBeNull();
    expect(takeDraftIdParam('?draftId=abc')).toBeNull();
    expect(takeDraftIdParam('?draftId=0')).toBeNull();
    expect(takeDraftIdParam('?draftId=-1')).toBeNull();
  });
});
