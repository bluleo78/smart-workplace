// 이슈 리스트 뷰 벌크 작업 훅 (#606) — 상태 일괄 변경/담당자 일괄 지정/일괄 삭제.
// 전용 벌크 백엔드 엔드포인트가 없어 기존 단건 엔드포인트(PATCH .../status, PUT .../assignees,
// DELETE .../{number})를 Promise.allSettled 로 병렬 순회한다(Drive #82 수정 방향 메모와 동일 전략).
// 부분 실패 시에도 성공한 항목은 반영하고, 실패 건수를 토스트로 안내한다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { issuesApi, updateIssueStatus } from '../../api/issues';
import { extractApiError } from '../../lib/api-error';
import type { IssueStatus } from '../../types/issue';
import { issueKeys } from './useIssues';

// 성공/실패 건수를 세어 결과 토스트를 띄우는 공통 헬퍼.
// 실패가 있으면 rejection 사유에서 백엔드 에러 메시지를 추출해 함께 보여준다(#710) —
// 그렇지 않으면 "N건 실패"만 뜨고 정확히 왜 막혔는지(예: EPIC 미완료 자식) 사용자가 알 수 없다.
function reportBulkResult(results: PromiseSettledResult<unknown>[], successLabel: string) {
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  const failed = rejected.length;
  const succeeded = results.length - failed;
  if (failed === 0) {
    toast.success(`${succeeded}개 ${successLabel}`);
    return;
  }
  // 실패 사유 중 첫 번째를 대표 메시지로 노출. 여러 건이 서로 다른 이유로 실패해도
  // 사용자가 "왜 막혔는지" 최소 하나의 구체적 원인을 바로 알 수 있게 한다.
  const firstReason = extractApiError(rejected[0].reason, `${successLabel} 실패`);
  if (succeeded === 0) {
    toast.error(`${successLabel} 실패 (${failed}건): ${firstReason}`);
  } else {
    toast.warning(`${succeeded}개 ${successLabel}, ${failed}건 실패: ${firstReason}`);
  }
}

// 공통 무효화 — 검색/상세 캐시를 모두 갱신.
function invalidateIssueCaches(qc: ReturnType<typeof useQueryClient>, projectKey: string) {
  qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
  qc.invalidateQueries({ queryKey: issueKeys.lists(projectKey) });
  qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
}

export function useBulkUpdateStatus(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ numbers, status }: { numbers: number[]; status: IssueStatus }) =>
      Promise.allSettled(numbers.map((n) => updateIssueStatus(projectKey, n, status))),
    onSuccess: (results) => reportBulkResult(results, '상태를 변경했습니다'),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

export function useBulkAssign(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    // userIds — 빈 배열이면 담당자 해제(미지정), 아니면 해당 집합으로 교체(단일 지정 UI 기준 1명).
    mutationFn: async ({ numbers, userIds }: { numbers: number[]; userIds: number[] }) =>
      Promise.allSettled(numbers.map((n) => replaceIssueAssignees(projectKey, n, userIds))),
    onSuccess: (results) => reportBulkResult(results, '담당자를 지정했습니다'),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}

export function useBulkDeleteIssues(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (numbers: number[]) =>
      Promise.allSettled(numbers.map((n) => issuesApi.remove(projectKey, n))),
    onSuccess: (results) => reportBulkResult(results, '삭제했습니다'),
    onSettled: () => invalidateIssueCaches(qc, projectKey),
  });
}
