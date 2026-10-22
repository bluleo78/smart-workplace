// 이슈 상태 변경 mutation 의 요청 본문·낙관적 패치(WP-808) — statusId 가 있으면 서버엔 statusId 만, 캐시엔 이름까지.
import { type InfiniteData, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { IssueResponse, IssueSearchResponse } from '../../types/issue';
import { patchIssueInSearchCache } from './issueSearchCache';
import { statusCachePatch, statusRequestBody } from './useUpdateIssueStatus';

describe('statusRequestBody', () => {
  it('statusId 가 있으면 statusId 만 보낸다', () => {
    expect(statusRequestBody({ number: 1, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' })).toEqual({
      statusId: 12,
    });
  });
  it('statusId 가 없으면 예전처럼 범주(status)를 보낸다', () => {
    expect(statusRequestBody({ number: 1, status: 'DONE' })).toEqual({ status: 'DONE' });
  });
});

describe('statusCachePatch', () => {
  it('statusId·statusName 이 있으면 범주와 함께 패치한다', () => {
    expect(statusCachePatch({ number: 1, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' })).toEqual({
      status: 'IN_PROGRESS',
      statusId: 12,
      statusName: '검토 중',
    });
  });
  it('범주만 오면 범주만 패치한다(이름·id 는 서버 응답 재조회가 채운다)', () => {
    expect(statusCachePatch({ number: 1, status: 'DONE' })).toEqual({ status: 'DONE' });
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
    await patchIssueInSearchCache(qc, 'WP', 7, statusCachePatch({ number: 7, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }));
    const it7 = qc.getQueryData<InfiniteData<IssueSearchResponse>>(key)!.pages[0].items[0];
    expect([it7.status, it7.statusId, it7.statusName]).toEqual(['IN_PROGRESS', 12, '검토 중']);
  });
});
