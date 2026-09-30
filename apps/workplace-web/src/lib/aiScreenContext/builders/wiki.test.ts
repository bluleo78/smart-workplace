import { describe, expect, it } from 'vitest';

import { buildWikiContext } from './wiki';

describe('buildWikiContext', () => {
  it('페이지 + 스페이스', () => {
    expect(buildWikiContext({ spaceId: 2, spaceName: '개발', page: { id: 10, title: '배포 가이드', updatedAt: '2026-09-29T05:00:00Z' } })).toEqual({
      view: '위키 페이지',
      focus: { type: '위키 페이지', label: '배포 가이드', refs: { pageId: '10' }, facts: [{ label: '수정', value: '2026-09-29 14:00' }] },
      scope: { label: '위키 스페이스 개발', refs: { spaceId: '2' } },
    });
  });
  it('빈 제목은 제목 없음, 스페이스 이름 미로딩은 id', () => {
    const ctx = buildWikiContext({ spaceId: 2, spaceName: null, page: { id: 10, title: '', updatedAt: '2026-09-29T05:00:00Z' } });
    expect(ctx.focus!.label).toBe('제목 없음');
    expect(ctx.scope!.label).toBe('위키 스페이스 #2');
  });
  it('페이지 없음(스페이스 루트)', () => {
    expect(buildWikiContext({ spaceId: 2, spaceName: '개발', page: null })).toEqual({ view: '위키', scope: { label: '위키 스페이스 개발', refs: { spaceId: '2' } } });
  });
});
