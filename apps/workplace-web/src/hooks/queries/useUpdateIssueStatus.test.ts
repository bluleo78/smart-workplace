// 이슈 상태 변경 mutation 의 요청 본문·낙관적 패치(WP-808) — 서버엔 statusId 만(일괄 바는 범주), 캐시엔 이름까지.
import { type InfiniteData, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { IssueResponse, IssueSearchResponse } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';
import { patchIssueInSearchCache } from './issueSearchCache';
import { statusCachePatch, statusRequestBody } from './useUpdateIssueStatus';

const review: ProjectStatus = { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 };

describe('statusRequestBody', () => {
  it('상태 id 가 있으면 statusId 만 보낸다', () => {
    expect(statusRequestBody('IN_PROGRESS', 12)).toEqual({ statusId: 12 });
  });
  it('상태 id 가 없으면(일괄 바) 범주(status)를 보낸다', () => {
    expect(statusRequestBody('DONE')).toEqual({ status: 'DONE' });
  });
});

describe('statusCachePatch', () => {
  it('범주·상태 id·이름을 함께 패치한다', () => {
    expect(statusCachePatch(review)).toEqual({ status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' });
  });

  // WP-873 — 완료 표식·완료일 열은 closedAt 기준이므로 낙관적 패치도 서버 규칙을 따라 한다.
  describe('closedAt (서버 규칙 모사)', () => {
    const done: ProjectStatus = { id: 13, name: '완료', category: 'DONE', position: 3 };
    const canceled: ProjectStatus = { id: 14, name: '취소', category: 'CANCELED', position: 4 };

    it('열린 상태 → DONE/CANCELED 면 closedAt 을 지금(ISO)으로 채운다', () => {
      const before = Date.now();
      for (const target of [done, canceled]) {
        const patch = statusCachePatch(target, { status: 'IN_PROGRESS', closedAt: null });
        expect(typeof patch.closedAt).toBe('string');
        expect(Date.parse(patch.closedAt as string)).toBeGreaterThanOrEqual(before);
      }
    });
    it('종료 → 열린 상태(재개) 면 closedAt 을 null 로 비운다', () => {
      expect(statusCachePatch(review, { status: 'DONE', closedAt: '2026-10-01T00:00:00Z' }).closedAt).toBeNull();
      expect(statusCachePatch(review, { status: 'CANCELED', closedAt: '2026-10-01T00:00:00Z' }).closedAt).toBeNull();
    });
    it('종료 → 종료는 기존 closedAt 을 유지한다(키를 패치에 넣지 않는다)', () => {
      const patch = statusCachePatch(canceled, { status: 'DONE', closedAt: '2026-10-01T00:00:00Z' });
      expect('closedAt' in patch).toBe(false);
    });
    it('열린 → 열린 상태나 현재 이슈를 모르면 closedAt 을 건드리지 않는다', () => {
      expect('closedAt' in statusCachePatch(review, { status: 'TODO', closedAt: null })).toBe(false);
      expect('closedAt' in statusCachePatch(done)).toBe(false);
    });
  });
});

describe('patchIssueInSearchCache — 상태 이름 반영', () => {
  it('검색 캐시의 그 이슈에 statusId·statusName 을 덮어쓴다', async () => {
    const qc = new QueryClient();
    const key = ['issues', 'search', 'WP', { statuses: [] }, 50];
    qc.setQueryData<InfiniteData<IssueSearchResponse>>(key, {
      pages: [
        {
          items: [{ number: 7, status: 'TODO', statusId: 1, statusName: '할 일' } as IssueResponse],
          nextCursor: null,
          hasMore: false,
        },
      ],
      pageParams: [null],
    });
    await patchIssueInSearchCache(qc, 'WP', 7, statusCachePatch(review));
    const it7 = qc.getQueryData<InfiniteData<IssueSearchResponse>>(key)!.pages[0].items[0];
    expect([it7.status, it7.statusId, it7.statusName]).toEqual(['IN_PROGRESS', 12, '검토 중']);
  });
});
