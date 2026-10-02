import { useInfiniteQuery } from '@tanstack/react-query';

import { auditLogsApi } from '../../api/auditLogs';
import { nextOffsetPage } from '../../lib/offsetPaging';

/** 감사 로그 목록 — offset 페이징을 무한 스크롤로 이어 붙인다 (WP-182). */
export function useAuditLogs(
  params: {
    search?: string;
    /** 사용자 ID 정확 일치 필터 (#89) */
    userId?: number;
    actionType?: string;
    resource?: string;
    result?: string;
    /** 날짜 범위 시작 (ISO 8601) */
    startDate?: string;
    /** 날짜 범위 종료 (ISO 8601) */
    endDate?: string;
  },
  size = 50,
) {
  return useInfiniteQuery({
    queryKey: ['auditLogs', params, size],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => auditLogsApi.getAuditLogs({ ...params, page: pageParam, size }).then(r => r.data),
    getNextPageParam: nextOffsetPage,
    // WP-183: 화면을 떠나면 캐시를 바로 버린다. 무한 쿼리는 재조회 때 받아 둔 페이지를 전부 순서대로 다시 받으므로,
    // 깊이 스크롤한 뒤 돌아오면 수십 건을 연달아 요청한다. 로그 뷰어는 다시 열면 최신 첫 페이지부터 보면 충분하다.
    gcTime: 0,
  });
}
