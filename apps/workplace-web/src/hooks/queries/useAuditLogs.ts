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
  });
}
