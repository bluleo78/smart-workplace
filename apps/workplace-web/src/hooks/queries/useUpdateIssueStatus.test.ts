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
